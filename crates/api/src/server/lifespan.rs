/*
 * Background worker task supervisor coordinating log rotation, cache eviction, and metadata synchronization.
 * Owned by: server
 * Key deps: tokio::task::JoinHandle, crate::logging, crate::metadata
 * Invariants: All spawned background tasks must be registered in DAEMONS and aborted on stop_daemons.
 * Last structural change: Phase 1 periodic metadata snapshot synchronization background task.
 */

use axiom_core::logging::rotator::LogRotator;
use once_cell::sync::Lazy;
use std::sync::Mutex;
use tokio::task::JoinHandle;

static DAEMONS: Lazy<Mutex<Vec<JoinHandle<()>>>> = Lazy::new(|| Mutex::new(Vec::new()));

/// Launches all long-running background tasks.
/// CONTRACT:
///  - Side effects: Spawns Tokio tasks and registers their handles in `DAEMONS`.
///  - Idempotent: No (spawns tasks each time called).
pub async fn start_daemons() {
    let config = axiom_core::ConfigManager::get();
    let cache_needs_turso = config.cache.backend == "turso" || config.cache.backend == "hybrid";
    let rl_needs_turso = config.rate_limit.backend == "turso";

    // Initialize Unified CacheEngine (L1 RAM + L2 Persistent Storage)
    let max_l1 = if config.performance.query_cache_size > 0 {
        config.performance.query_cache_size as usize
    } else {
        10_000
    };
    if let Err(e) = axiom_cache::CacheEngine::init(&config.cache.turso_url, &config.cache.turso_token, max_l1).await {
        tracing::warn!("Failed to initialize L2 cache persistence: {}", e);
    }

    if cache_needs_turso || rl_needs_turso {
        let url = if cache_needs_turso { &config.cache.turso_url } else { &config.rate_limit.turso_url };
        let token = if cache_needs_turso { &config.cache.turso_token } else { &config.rate_limit.turso_token };
        if let Err(e) = crate::middleware::cache::TursoCache::init(url, token).await {
            tracing::error!("Failed to initialize Turso cache: {}", e);
        } else if config.cache.backend == "hybrid" && config.cache.enabled && config.cache.query_cache {
            let entries = crate::middleware::cache::TursoCache::get_all_active_query_cache().await;
            let count = entries.len();
            crate::database::handlers::warm_cache_from_turso(entries).await;
            tracing::info!("Pre-warmed L1 RAM cache with {} entries from Turso L2 storage", count);
        }
    }

    // Cache sweep daemon: purges expired entries every 60 seconds
    let cache_sweep_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            axiom_cache::CacheEngine::sweep_expired().await;
        }
    });

    // Log rotation daemon
    let rotator_handle = LogRotator::start();

    // Periodic metadata snapshot refresh daemon (reloads axiom.db every reload_interval seconds)
    let reload_interval = config.metadata.reload_interval.max(5);
    let metadata_sync_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(reload_interval));
        loop {
            interval.tick().await;
            if let Err(e) = axiom_metadata::store::MetadataStore::sync_snapshot().await {
                tracing::warn!("Periodic metadata snapshot sync failed: {}", e);
            }
        }
    });

    {
        let mut tasks = DAEMONS.lock().unwrap();
        tasks.push(cache_sweep_handle);
        tasks.push(rotator_handle);
        tasks.push(metadata_sync_handle);
    }

    // Initialize Native Blob Storage Engine if enabled in config
    if config.blob.enabled {
        let inline_max = axiom_core::parse_size(&config.blob.inline_max).unwrap_or(64 * 1024);
        let max_object = axiom_core::parse_size(&config.blob.max_object).unwrap_or(5 * 1024 * 1024 * 1024);
        if let Err(e) = crate::blobs::init_blob_engine(
            &config.blob.path,
            inline_max as u64,
            max_object as u64,
            config.blob.verify_reads,
        ).await {
            tracing::error!("Failed to initialize Native Blob Engine: {}", e);
        } else {
            tracing::info!("Native Blob Storage Engine initialized at '{}'", config.blob.path);
        }
    }
}

/// Registers an externally spawned daemon handle with the lifecycle supervisor.
pub fn register_daemon(handle: tokio::task::JoinHandle<()>) {
    if let Ok(mut tasks) = DAEMONS.lock() {
        tasks.push(handle);
    }
}

/// Aborts all active background daemon tasks during graceful server shutdown.
pub async fn stop_daemons() {
    let mut tasks = DAEMONS.lock().unwrap();
    for task in tasks.drain(..) {
        task.abort();
    }
}
