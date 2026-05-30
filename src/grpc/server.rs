use std::net::SocketAddr;
use tonic::transport::Server;
use tonic_health::server::health_reporter;
use tracing::{info, error};

pub async fn start_grpc_server(port: u16) {
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    info!("Starting gRPC server on {}", addr);

    // health_reporter creates the standard gRPC health check service.
    // We don't call set_serving<T> here to avoid cross-crate version conflicts.
    let (_health_reporter, health_service) = health_reporter();

    let result = Server::builder()
        .add_service(health_service)
        .serve(addr)
        .await;

    if let Err(e) = result {
        error!("gRPC server error: {}", e);
    }
}
