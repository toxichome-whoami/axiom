use std::net::SocketAddr;
use tokio::net::TcpListener;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

pub mod api;

pub mod config;
pub mod db;
pub mod logging;
pub mod middleware;
pub mod security;
pub mod server;
mod utils;

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--version" || arg == "-v") {
        println!("Axiom v{}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    // 1. Load config
    config::loader::ConfigManager::load("config.toml").unwrap_or_else(|e| {
        eprintln!("Failed to load config: {}", e);
    });

    // Initialize logging
    if let Err(e) = logging::setup::setup_logging() {
        eprintln!("Failed to setup logging: {}", e);
    }

    // 3. Start Background Daemons
    server::lifespan::start_daemons().await;

    // 4. Create App Router
    crate::api::core::health::init_health_timer();
    let app = server::app::create_app();

    // 5. Serve
    let config = config::loader::ConfigManager::get();
    let host_ip = config.server.host.parse::<std::net::IpAddr>().unwrap_or_else(|_| {
        eprintln!("Invalid host IP '{}' in config.toml, falling back to 0.0.0.0", config.server.host);
        std::net::IpAddr::V4(std::net::Ipv4Addr::new(0, 0, 0, 0))
    });
    let addr = SocketAddr::new(host_ip, config.server.port as u16);
    let listener = TcpListener::bind(addr).await?;

    println!("Axiom Native Core running on http://{}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
