use std::net::SocketAddr;
use tokio::net::TcpListener;

pub mod api;
pub mod cache;
pub mod security;
pub mod middleware;
pub mod config;
pub mod server;
pub mod logger;
pub mod db;
mod utils;
mod webhook;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Load config
    config::loader::ConfigManager::load("config.toml").unwrap_or_else(|e| {
        eprintln!("Failed to load config: {}", e);
    });

    // Initialize logging
    if let Err(e) = logger::setup::setup_logging() {
        eprintln!("Failed to setup logging: {}", e);
    }
    
    // 2. Setup Telemetry
    if let Err(e) = server::telemetry::setup_telemetry() {
        eprintln!("Failed to setup telemetry: {}", e);
    }

    // 3. Start Background Daemons
    server::lifespan::start_daemons();

    // 4. Create App Router
    let app = server::app::create_app();

    // 5. Serve
    let config = config::loader::ConfigManager::get();
    let addr = SocketAddr::from(([0, 0, 0, 0], config.server.port as u16));
    let listener = TcpListener::bind(addr).await?;
    
    println!("🚀 Axiom Native Core running on {}", addr);
    axum::serve(listener, app).await?;
    
    Ok(())
}
