/*
 * Axiom Server Daemon — Main process entrypoint, runtime bootstrap, and lifespan coordinator.
 * Owned by: server
 * Key deps: tokio, mimalloc, axiom_core, axiom_metadata, axiom_api
 * Invariants: Config loaded synchronously before runtime build; daemons clean up on shutdown signal.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use std::net::SocketAddr;
use tokio::net::TcpListener;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--version" || arg == "-v") {
        println!("Axiom Server v{}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    axiom_core::ConfigManager::load("config.toml").unwrap_or_else(|e| {
        eprintln!("Failed to load config: {}", e);
        std::process::exit(1);
    });

    let config = axiom_core::ConfigManager::get();
    let workers = config.server.workers as usize;
    let mut builder = tokio::runtime::Builder::new_multi_thread();
    builder.enable_all();
    if workers > 0 {
        builder.worker_threads(workers);
    }

    let rt = builder.build()?;
    rt.block_on(async_main())
}

async fn async_main() -> Result<(), Box<dyn std::error::Error>> {
    let config = axiom_core::ConfigManager::get();

    // 1. Initialize structured logging
    let _log_guard = match axiom_core::logging::setup::setup_logging() {
        Ok(guard) => Some(guard),
        Err(e) => {
            eprintln!("Failed to setup logging: {}", e);
            None
        }
    };

    // 2. Initialize Persistent Metadata Store (axiom.db) and publish initial ArcSwap snapshot
    let metadata_url = &config.metadata.url;
    let metadata_token = &config.metadata.token;
    if let Err(e) = axiom_metadata::MetadataStore::init(metadata_url, metadata_token).await {
        tracing::error!("Failed to initialize metadata store ({}): {}", metadata_url, e);
    } else {
        // Auto-seed legacy api_key and database entries on first boot if store is empty
        if let Err(e) = axiom_metadata::MetadataStore::seed_from_config(&config).await {
            tracing::error!("Failed to auto-seed metadata: {}", e);
        }
    }

    // 3. Start Background Daemons
    axiom_api::server::lifespan::start_daemons().await;

    // 4. Create App Router
    axiom_api::core::health::init_health_timer();
    let app = axiom_api::server::app::create_app();

    // 5. Serve
    let config = axiom_core::ConfigManager::get();
    let host_ip = config.server.host.parse::<std::net::IpAddr>().unwrap_or_else(|_| {
        eprintln!("Invalid host IP '{}' in config.toml, falling back to 0.0.0.0", config.server.host);
        std::net::IpAddr::V4(std::net::Ipv4Addr::new(0, 0, 0, 0))
    });
    let addr = SocketAddr::new(host_ip, config.server.port as u16);
    let listener = TcpListener::bind(addr).await?;

    tracing::info!("Axiom Server v{} running on http://{}", env!("CARGO_PKG_VERSION"), addr);

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::warn!("Shutdown signal received. Gracefully stopping Axiom...");
    axiom_api::server::lifespan::stop_daemons().await;

    // Force exit after shutdown_timeout seconds to drop lingering keep-alive connections
    let timeout = axiom_core::ConfigManager::get().server.shutdown_timeout as u64;
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(timeout)).await;
        std::process::exit(0);
    });
}
