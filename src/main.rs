use std::net::SocketAddr;
use tokio::net::TcpListener;

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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Load config
    config::loader::ConfigManager::load("config.toml").unwrap_or_else(|e| {
        eprintln!("Failed to load config: {}", e);
    });

    // Initialize logging
    if let Err(e) = logging::setup::setup_logging() {
        eprintln!("Failed to setup logging: {}", e);
    }

    // 2. Setup Telemetry
    if let Err(e) = server::telemetry::setup_telemetry() {
        eprintln!("Failed to setup telemetry: {}", e);
    }

    // 3. Start Background Daemons
    server::lifespan::start_daemons();

    // 4. Create App Router
    crate::api::core::health::init_health_timer();
    crate::api::auth::token_engine::init_keys().await;
    let app = server::app::create_app();

    // 5. Serve
    let config = config::loader::ConfigManager::get();
    let addr = SocketAddr::from(([0, 0, 0, 0], config.server.port as u16));
    let listener = TcpListener::bind(addr).await?;

    // Start gRPC Server
    let grpc_port = config.server.port as u16 + 1;
    tokio::spawn(async move {
        grpc::server::start_grpc_server(grpc_port).await;
    });

    println!("Axiom Native Core running on http://{}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
