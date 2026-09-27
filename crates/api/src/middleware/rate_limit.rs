/*
 * Rate limiting middleware enforcing dual-bucket (IP and API key) request throttling.
 * Owned by: middleware
 * Key deps: axum, crate::config, crate::middleware::cache, crate::security::ban_list
 * Invariants: Volumetric IP limits evaluate before downstream handlers; proxy headers only trusted for configured peer IPs.
 * Last structural change: Phase 0 cleanup adding S1 wildcard proxy warning and S2 per-key throttling bucket.
 */

use axiom_core::AxiomError;
use axiom_core::ConfigManager;
use axum::{extract::Request, middleware::Next, response::Response};
use base64::prelude::*;
use std::sync::atomic::{AtomicBool, Ordering};

// ─── Startup Security Warnings ─────────────────────────────────────────────
// Emitted once if an insecure wildcard proxy configuration is detected.
static WILDCARD_PROXY_WARNED: AtomicBool = AtomicBool::new(false);

/// Evaluates client rate limits across IP and API-key buckets before allowing request downstream.
/// CONTRACT:
///  - Precondition: Request must be accepted by upstream WAF.
///  - Returns `Ok(Response)` with `x-ratelimit-*` headers attached on success.
///  - Throws `AxiomError(RATE_LIMIT_EXCEEDED, 429)` or `AxiomError(BANNED, 403)`.
///  - Side effects: Increments hit counters in cache backend; may record IP penalties.
///  - Idempotent: No (modifies sliding window counter state).
pub async fn rate_limit_middleware(req: Request, next: Next) -> Result<Response, AxiomError> {
    let config = req
        .extensions()
        .get::<std::sync::Arc<axiom_core::AxiomConfig>>()
        .cloned()
        .unwrap_or_else(ConfigManager::get);

    if !config.rate_limit.enabled {
        return Ok(next.run(req).await);
    }

    // ─── IP Resolution ─────────────────────────────────────────────────────
    // Resolve peer TCP address. Only trust forwarding headers if peer is in trusted_proxies list.
    let mut client_ip = "127.0.0.1".to_string();
    if let Some(connect_info) = req.extensions().get::<axum::extract::ConnectInfo<std::net::SocketAddr>>() {
        client_ip = connect_info.0.ip().to_string();
    }

    let has_wildcard_proxy = config.server.trusted_proxies.iter().any(|p| p == "*");
    if has_wildcard_proxy && !WILDCARD_PROXY_WARNED.swap(true, Ordering::Relaxed) {
        // Warning: trusted_proxies = ["*"] allows arbitrary IP spoofing via X-Forwarded-For
        tracing::warn!("SECURITY WARNING: trusted_proxies contains '*' — client IP can be spoofed via X-Forwarded-For headers! Do NOT use '*' in production!");
    }

    if config.server.trusted_proxies.contains(&client_ip) || has_wildcard_proxy {
        if let Some(forwarded) = req.headers().get("x-forwarded-for").or_else(|| req.headers().get("x-real-ip")) {
            if let Ok(fwd_str) = forwarded.to_str() {
                client_ip = fwd_str.split(',').next().unwrap_or(&client_ip).trim().to_string();
            }
        }
    }

    // Short-circuit banned IP addresses immediately
    let (is_banned, reason) = crate::security::ban_list::BanList::is_ip_banned(&client_ip);
    if is_banned {
        return Err(AxiomError::new("BANNED", &format!("Your IP is banned: {}", reason), axum::http::StatusCode::FORBIDDEN));
    }

    // Check IP allowlist bypass (e.g., internal monitoring or metrics scrapers)
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

    let ip_limit = config.rate_limit.max_requests;
    let window = config.rate_limit.window as u32;

    // ─── IP Rate Limit Evaluation ──────────────────────────────────────────
    let ip_limits_key = format!("rl:ip:{}", client_ip);
    let ip_penalty_key = format!("penalty:{}", client_ip);

    let (ip_violated, ip_current_count) = if config.rate_limit.backend == "turso" {
        crate::middleware::cache::TursoCache::check_rate_limit(
            &client_ip,
            window,
            ip_limit as u32,
            config.rate_limit.burst as u32,
            config.rate_limit.penalty_cooldown as u32,
            config.rate_limit.penalty_threshold as u32,
        )
        .await
    } else {
        axiom_cache::CacheEngine::check_rate_limit(
            &ip_limits_key,
            window,
            ip_limit as u32,
            &ip_penalty_key,
            config.rate_limit.penalty_cooldown as u32,
            config.rate_limit.penalty_threshold as u32,
        )
    };

    if ip_violated {
        crate::metrics::MetricsEngine::record_rate_limit_rejection();
        return Err(AxiomError::new(
            "RATE_LIMIT_EXCEEDED",
            "Rate limit exceeded or IP temporarily blocked.",
            axum::http::StatusCode::TOO_MANY_REQUESTS,
        ));
    }

    // ─── Key-Based Rate Limit Evaluation (S2 Bypass Defense) ───────────────
    // Throttles by API key identifier even if the attacker rotates source IP addresses.
    let mut effective_limit = ip_limit;
    let mut effective_count = ip_current_count as i32;

    if let Some(key_header) = req.headers().get("x-axiom-key").or_else(|| req.headers().get("x-api-key")) {
        if let Ok(token_str) = key_header.to_str() {
            if let Ok(decoded) = BASE64_STANDARD.decode(token_str) {
                if let Ok(ident) = String::from_utf8(decoded) {
                    if let Some((key_name, _)) = ident.split_once(':') {
                        let key_limit = config
                            .api_key
                            .get(key_name)
                            .map(|k| if k.rate_limit_override > 0 { k.rate_limit_override as i32 } else { ip_limit })
                            .unwrap_or(ip_limit);

                        let key_rl_key = format!("rl:key:{}", key_name);
                        let key_penalty_key = format!("penalty:key:{}", key_name);

                        let (key_violated, key_count) = axiom_cache::CacheEngine::check_rate_limit(
                            &key_rl_key,
                            window,
                            key_limit as u32,
                            &key_penalty_key,
                            config.rate_limit.penalty_cooldown as u32,
                            config.rate_limit.penalty_threshold as u32,
                        );

                        if key_violated {
                            crate::metrics::MetricsEngine::record_rate_limit_rejection();
                            return Err(AxiomError::new(
                                "RATE_LIMIT_EXCEEDED",
                                "API key rate limit exceeded.",
                                axum::http::StatusCode::TOO_MANY_REQUESTS,
                            ));
                        }

                        // Enforce the more restrictive of the two counters for telemetry headers
                        if key_limit < effective_limit {
                            effective_limit = key_limit;
                            effective_count = key_count as i32;
                        }
                    }
                }
            }
        }
    }

    let mut response = next.run(req).await;

    let remaining = std::cmp::max(0, effective_limit - effective_count);
    response
        .headers_mut()
        .insert("x-ratelimit-limit", effective_limit.to_string().parse().unwrap());
    response.headers_mut().insert(
        "x-ratelimit-remaining",
        remaining.to_string().parse().unwrap(),
    );

    Ok(response)
}
