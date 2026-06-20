use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::signal;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

pub mod api;
pub mod config;
pub mod db;
pub mod grpc;
pub mod logging;
pub mod middleware;
pub mod security;
pub mod server;
mod utils;
mod webhook;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    config::loader::ConfigManager::load("config.toml").unwrap_or_else(|e| {
        eprintln!("Failed to load config: {}", e);
    });

    let config = config::loader::ConfigManager::get();
    let worker_count = if config.server.workers > 0 {
        config.server.workers as usize
    } else {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
    };

    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(worker_count)
        .enable_all()
        .build()?;

    rt.block_on(async { main_impl().await })
}

async fn main_impl() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Config already loaded in main()
    let config = config::loader::ConfigManager::get();

    // Initialize logging
    if let Err(e) = logging::setup::setup_logging() {
        eprintln!("Failed to setup logging: {}", e);
    }

    // 3. Start Background Daemons
    server::lifespan::start_daemons();

    // 4. Create App Router
    crate::api::core::health::init_health_timer();
    crate::api::auth::token_engine::init_keys().await;
    let app = server::app::create_app();

    // 5. Serve
    let addr = SocketAddr::from(([0, 0, 0, 0], config.server.port as u16));
    let listener = TcpListener::bind(addr).await?;

    // Start gRPC Server
    let grpc_port = config.server.port as u16 + 1;
    tokio::spawn(async move {
        grpc::server::start_grpc_server(grpc_port).await;
    });

    println!("Axiom Native Core running on http://{}", addr);

    // Graceful shutdown
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            signal::ctrl_c()
                .await
                .expect("Failed to install CTRL+C handler");
            println!("\nShutdown signal received, draining connections...");
        })
        .await?;

    println!("Server shutdown complete.");
    Ok(())
}
