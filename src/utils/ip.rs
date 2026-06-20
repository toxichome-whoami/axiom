use crate::config::schema::AxiomConfig;
use axum::extract::Request;

/// Gets the real client IP, validating X-Forwarded-For against trusted proxies.
/// This prevents IP spoofing for rate limiting and ban checks.
pub fn get_client_ip(req: &Request, config: &AxiomConfig) -> String {
    // Try to get actual peer IP from connection info
    let peer_ip = req
        .extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map(|ci| ci.ip().to_string());

    // Check if request came through a trusted proxy
    if let Some(peer) = &peer_ip {
        let is_trusted = config.server.trusted_proxies.iter().any(|p| p == peer);
        if is_trusted {
            // Trusted proxy: use X-Forwarded-For
            if let Some(ff) = req.headers().get("x-forwarded-for") {
                if let Ok(val) = ff.to_str() {
                    // Take the first IP in the chain (client's real IP)
                    if let Some(first_ip) = val.split(',').next() {
                        return first_ip.trim().to_string();
                    }
                }
            }
            if let Some(ri) = req.headers().get("x-real-ip") {
                if let Ok(val) = ri.to_str() {
                    return val.trim().to_string();
                }
            }
        }
    }

    // Fall back to peer IP or localhost
    peer_ip.unwrap_or_else(|| "127.0.0.1".to_string())
}
