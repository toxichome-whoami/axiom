use axum::http::StatusCode;
use std::net::IpAddr;
use url::Url;

use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;

/// SSRF guard — blocks private/loopback/link-local addresses
pub fn is_safe_url(raw_url: &str) -> bool {
    let parsed = match Url::parse(raw_url) {
        Ok(u) => u,
        Err(_) => return false,
    };

    let host = match parsed.host_str() {
        Some(h) => h,
        None => return false,
    };

    match host.to_lowercase().as_str() {
        "localhost" | "127.0.0.1" | "0.0.0.0" | "::1" => return false,
        _ => {}
    }

    // If the host is a raw IP, check it isn't private
    if let Ok(ip) = host.parse::<IpAddr>() {
        if ip.is_loopback() || ip.is_multicast() {
            return false;
        }
        match ip {
            IpAddr::V4(v4) => {
                if v4.is_private() || v4.is_link_local() || v4.is_broadcast() {
                    return false;
                }
            }
            IpAddr::V6(v6) => {
                if v6.is_loopback() {
                    return false;
                }
            }
        }
    }

    true
}

/// Resolve a federated alias (e.g. "node1_mydb") to the server alias ("node1")
/// and return the target sub-alias ("mydb").
pub fn resolve_alias(full_alias: &str) -> Option<(String, String)> {
    let config = ConfigManager::get();
    let fed = &config.federation;

    for srv_alias in fed.server.keys() {
        let prefix = format!("{}_", srv_alias);
        if full_alias.starts_with(&prefix) {
            let target = full_alias[prefix.len()..].to_string();
            return Some((srv_alias.to_string(), target));
        }
    }
    None
}

/// Build federation auth headers for an outgoing request to a peer node
pub fn build_fed_headers(node_id: &str, secret: &str) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(secret.as_bytes());
    if let (Ok(sec), Ok(nid)) = (
        reqwest::header::HeaderValue::from_str(&b64),
        reqwest::header::HeaderValue::from_str(node_id),
    ) {
        headers.insert("X-Federation-Secret", sec);
        headers.insert("X-Federation-Node", nid);
    }
    headers
}

/// Stream-proxy a request to the upstream federated server.
/// Returns the body bytes and upstream status code.
pub async fn proxy_request(
    full_alias: &str,
    path: &str,
    query: &str,
    method: &str,
    body: Option<bytes::Bytes>,
    is_database: bool,
    original_headers: &reqwest::header::HeaderMap,
) -> Result<(u16, bytes::Bytes, String), AxiomError> {
    let config = ConfigManager::get();

    let (srv_alias, target_alias) = resolve_alias(full_alias)
        .ok_or_else(|| AxiomError::new("FED_ALIAS_NOT_FOUND", "Federated alias not found", StatusCode::NOT_FOUND))?;

    let fed = &config.federation;

    let srv_cfg = fed.server.get(&srv_alias)
        .ok_or_else(|| AxiomError::new("FED_SERVER_NOT_FOUND", "Federation server config missing", StatusCode::NOT_FOUND))?;

    let base = srv_cfg.url.trim_end_matches('/');
    let subpath = path.trim_start_matches('/');
    let resource = if is_database { "db" } else { "fs" };
    let remote_url = if query.is_empty() {
        format!("{}/api/v1/{}/{}/{}", base, resource, target_alias, subpath)
    } else {
        format!("{}/api/v1/{}/{}/{}?{}", base, resource, target_alias, subpath, query)
    };

    if !is_safe_url(&remote_url) {
        return Err(AxiomError::new(
            "FED_SSRF_BLOCKED",
            "SSRF blocked: federation target resolves to an internal or restricted network",
            StatusCode::FORBIDDEN,
        ));
    }

    let mut fed_headers = build_fed_headers(&srv_cfg.node_id, &srv_cfg.secret);
    // Forward original auth header
    if let Some(auth) = original_headers.get("authorization") {
        fed_headers.insert("authorization", auth.clone());
    }

    let verify_ssl = srv_cfg.trust_mode == "verify";
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(!verify_ssl)
        .timeout(std::time::Duration::from_secs(30))
        .default_headers(fed_headers)
        .build()
        .map_err(|e| AxiomError::new("FED_CLIENT_ERROR", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))?;

    let req = match method.to_uppercase().as_str() {
        "POST" => client.post(&remote_url).body(body.unwrap_or_default()),
        "PUT" => client.put(&remote_url).body(body.unwrap_or_default()),
        "DELETE" => client.delete(&remote_url),
        _ => client.get(&remote_url),
    };

    let resp = req.send().await
        .map_err(|e| AxiomError::new("FED_SERVER_DOWN", &e.to_string(), StatusCode::BAD_GATEWAY))?;

    let status = resp.status().as_u16();
    let content_type = resp.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/json")
        .to_string();

    let body_bytes = resp.bytes().await
        .map_err(|e| AxiomError::new("FED_READ_ERROR", &e.to_string(), StatusCode::BAD_GATEWAY))?;

    Ok((status, body_bytes, content_type))
}
