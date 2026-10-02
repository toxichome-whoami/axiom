/*
 * Axiom Unified Server Runner — embedded server daemon logic for the single-binary CLI.
 * Owned by: cli
 * Key deps: tokio, axum, axiom_core, axiom_metadata, axiom_api
 * Invariants: Initializes logging, stores, and background daemons before binding TCP listener;
 *             graceful shutdown drains in-flight requests before exiting.
 * Last structural change: Unified single-binary out-of-the-box architecture (Phase 8 -> v4.0).
 */

use std::net::SocketAddr;
use tokio::net::TcpListener;

/// Runs the embedded Axiom server daemon within the unified binary process.
/// CONTRACT:
///  - Precondition: `axiom_core::ConfigManager::load("config.toml")` has been called.
///  - Initializes structured tracing logger and guarantees log guard remains active until shutdown.
///  - Bootstraps the embedded SQLite/libsql metadata store and runs auto-seeding if empty.
///  - Spawns background lifespan daemons (cache TTL evictions, metrics, Turso sync).
///  - Binds TCP listener on configured host and port, serving both REST API and embedded Web UI.
///  - Returns `Ok(())` on clean shutdown, or `Err` if TCP binding or serving fails.
pub async fn run_server() -> Result<(), Box<dyn std::error::Error>> {
    let config = axiom_core::ConfigManager::get();

    // 1. Initialize structured logging. Guard is preserved in this scope to guarantee
    // disk flushes during graceful process termination.
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

    // 3. Start Background Daemons (TTL sweeper, metrics flusher, etc.)
    axiom_api::server::lifespan::start_daemons().await;

    // 4. Create Axum App Router with REST endpoints, Admin API, and embedded Web UI
    axiom_api::core::health::init_health_timer();
    let app = axiom_api::server::app::create_app();

    // 5. Resolve host and port from configuration with safe fallback
    let config = axiom_core::ConfigManager::get();
    let host_str = config.server.host.trim();
    let host_ip = if host_str.eq_ignore_ascii_case("localhost") {
        std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1))
    } else {
        host_str.parse::<std::net::IpAddr>().unwrap_or_else(|_| {
            eprintln!(
                "Invalid host IP '{}' in config.toml, falling back to 0.0.0.0",
                config.server.host
            );
            std::net::IpAddr::V4(std::net::Ipv4Addr::new(0, 0, 0, 0))
        })
    };
    let addr = SocketAddr::new(host_ip, config.server.port as u16);
    let listener = TcpListener::bind(addr).await?;

    tracing::info!(
        "Axiom Unified Server v{} running on http://{}",
        env!("CARGO_PKG_VERSION"),
        addr
    );
    println!("Axiom Server v{} running on http://{}", env!("CARGO_PKG_VERSION"), addr);
    println!("Web UI dashboard available at http://{}/system", addr);

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

/// Waits for SIGINT (Ctrl+C) or SIGTERM and coordinates daemon shutdown.
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

    tracing::warn!("Shutdown signal received. Gracefully stopping Axiom daemons...");
    axiom_api::server::lifespan::stop_daemons().await;

    // Force exit after configured shutdown_timeout seconds to avoid lingering blocked connections
    let timeout = axiom_core::ConfigManager::get().server.shutdown_timeout as u64;
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(timeout)).await;
        std::process::exit(0);
    });
}
