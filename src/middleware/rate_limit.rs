use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;
use crate::middleware::cache::MemoryCache;
use axum::{extract::Request, middleware::Next, response::Response};

pub async fn rate_limit_middleware(req: Request, next: Next) -> Result<Response, AxiomError> {
    let config = req
        .extensions()
        .get::<std::sync::Arc<crate::config::schema::AxiomConfig>>()
        .cloned()
        .unwrap_or_else(ConfigManager::get);

    if !config.rate_limit.enabled {
        return Ok(next.run(req).await);
    }

    let mut client_ip = "127.0.0.1".to_string();
    if let Some(connect_info) = req.extensions().get::<axum::extract::ConnectInfo<std::net::SocketAddr>>() {
        client_ip = connect_info.0.ip().to_string();
    }

    if config.server.trusted_proxies.contains(&client_ip) || config.server.trusted_proxies.contains(&"*".to_string()) {
        if let Some(forwarded) = req.headers().get("x-forwarded-for").or_else(|| req.headers().get("x-real-ip")) {
            if let Ok(fwd_str) = forwarded.to_str() {
                client_ip = fwd_str.split(',').next().unwrap_or(&client_ip).trim().to_string();
            }
        }
    }

    let mut is_allowed = false;
    for allowed in &config.server.allowed_ips {
        if allowed.ends_with('*') {
            let prefix = &allowed[..allowed.len() - 1];
            if client_ip.starts_with(prefix) {
                is_allowed = true;
                break;
            }
        } else if allowed == &client_ip {
            is_allowed = true;
            break;
        }
    }

    if is_allowed {
        return Ok(next.run(req).await);
    }

    let limit = config.rate_limit.max_requests;
    let window = config.rate_limit.window as u32;

    let limits_key = format!("rl:ip:{}", client_ip);
    let penalty_key = format!("penalty:{}", client_ip);

    let (violated, current_count) = if config.rate_limit.backend == "turso" {
        crate::middleware::cache::TursoCache::check_rate_limit(
            &client_ip,
            window,
            limit as u32,
            config.rate_limit.burst as u32,
            config.rate_limit.penalty_cooldown as u32,
            config.rate_limit.penalty_threshold as u32,
        )
        .await
    } else {
        MemoryCache::check_rate_limit(
            &limits_key,
            window,
            limit as u32,
            &penalty_key,
            config.rate_limit.burst as u32,
            config.rate_limit.penalty_cooldown as u32,
            config.rate_limit.penalty_threshold as u32,
        )
        .await
    };

    if violated {
        return Err(AxiomError::new(
            "RATE_LIMIT_EXCEEDED",
            "Rate limit exceeded or IP temporary blocked.",
            axum::http::StatusCode::TOO_MANY_REQUESTS,
        ));
    }

    let mut response = next.run(req).await;

    let remaining = std::cmp::max(0, limit - current_count as i32);
    response
        .headers_mut()
        .insert("x-ratelimit-limit", limit.to_string().parse().unwrap());
    response.headers_mut().insert(
        "x-ratelimit-remaining",
        remaining.to_string().parse().unwrap(),
    );

    Ok(response)
}
