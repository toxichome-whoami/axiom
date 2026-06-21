use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;
use crate::security::ban_list::BanList;
use crate::utils::ip::get_client_ip;
use crate::utils::types::AuthContext;
use axum::{extract::Request, middleware::Next, response::Response};

/// Compare two byte slices in constant time to prevent timing attacks.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut result = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        result |= x ^ y;
    }
    result == 0
}

pub async fn auth_middleware(mut req: Request, next: Next) -> Result<Response, AxiomError> {
    let config = req
        .extensions()
        .get::<std::sync::Arc<crate::config::schema::AxiomConfig>>()
        .cloned()
        .unwrap_or_else(ConfigManager::get);

    let client_ip = get_client_ip(&req, &config);

    let (is_ip_banned, reason) = BanList::is_ip_banned(&client_ip);
    if is_ip_banned {
        return Err(AxiomError::new(
            "RATE_LIMIT_BLOCKED",
            &format!("IP address is banned: {}", reason),
            axum::http::StatusCode::FORBIDDEN,
        ));
    }

    // 1. Extract token from header ONLY
    let mut raw_token = None;

    if let Some(key) = req
        .headers()
        .get("X-Axiom-Key")
        .or_else(|| req.headers().get("X-Api-Key"))
    {
        if let Ok(key_str) = key.to_str() {
            raw_token = Some(key_str.to_string());
        }
    }

    if raw_token.is_none() {
        raw_token = req
            .headers()
            .get("Authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer "))
            .map(|s| s.to_string());
    }

    // 2. Presigned URL Interception (if no header auth)
    if raw_token.is_none() {
        if let Some(query) = req.uri().query() {
            let params: std::collections::HashMap<String, String> =
                url::form_urlencoded::parse(query.as_bytes())
                    .into_owned()
                    .collect();

            if let (Some(sig), Some(exp_str), Some(key_name)) = (
                params.get("signature"),
                params.get("expires"),
                params.get("X-Axiom-Key-Name"),
            ) {
                if let Ok(expires) = exp_str.parse::<u64>() {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs();

                    if now < expires {
                        let secret_opt = if let Some(k) = config.api_key.get(key_name) {
                            Some((
                                &k.secret,
                                k.mode.clone(),
                                k.db_scope.clone(),
                                k.fs_scope.clone(),
                                k.feature_scope.clone(),
                                k.rate_limit_override as u32,
                                k.full_admin,
                            ))
                        } else {
                            config.federation.incoming.get(key_name).map(|f| {
                                (
                                    &f.secret,
                                    f.mode.clone(),
                                    f.db_scope.clone(),
                                    f.fs_scope.clone(),
                                    f.feature_scope.clone(),
                                    0,
                                    false,
                                )
                            })
                        };

                        if let Some((
                            secret,
                            mode,
                            db_scope,
                            fs_scope,
                            feature_scope,
                            rate_limit_override,
                            full_admin,
                        )) = secret_opt
                        {
                            if !secret.is_empty() {
                                let mut path = req.uri().path();
                                // Axum may strip the prefix if the middleware is in a nested router
                                if path.starts_with("/api/v1") {
                                    path = &path["/api/v1".len()..];
                                }

                                if path.starts_with("/fs/") {
                                    let parts: Vec<&str> = path.splitn(4, '/').collect(); // "", "fs", "alias", "download/file.txt"
                                    if parts.len() >= 4 {
                                        let alias = parts[2];
                                        let mut subpath = parts[3].to_string();
                                        if subpath.starts_with("download/") {
                                            subpath = subpath["download/".len()..].to_string();
                                        } else if subpath.starts_with("upload") {
                                            if let Some(p) = params.get("path") {
                                                subpath = p.clone();
                                            }
                                        }

                                        let string_to_sign = format!(
                                            "{}:{}:{}:{}",
                                            req.method().as_str().to_uppercase(),
                                            alias,
                                            subpath.trim_start_matches('/'),
                                            expires
                                        );

                                        use hmac::Mac;
                                        if let Ok(mut mac) =
                                            hmac::Hmac::<sha2::Sha256>::new_from_slice(
                                                secret.as_bytes(),
                                            )
                                        {
                                            mac.update(string_to_sign.as_bytes());
                                            let expected_sig =
                                                hex::encode(mac.finalize().into_bytes());

                                            if constant_time_eq(
                                                expected_sig.as_bytes(),
                                                sig.as_bytes(),
                                            ) {
                                                let ctx = AuthContext {
                                                    api_key_name: key_name.clone(),
                                                    mode,
                                                    db_scope,
                                                    fs_scope,
                                                    feature_scope,
                                                    rate_limit_override,
                                                    full_admin,
                                                };
                                                req.extensions_mut().insert(ctx);
                                                return Ok(next.run(req).await);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        return Err(AxiomError::new(
                            "AUTH_EXPIRED",
                            "Presigned URL has expired",
                            axum::http::StatusCode::UNAUTHORIZED,
                        ));
                    }
                }
            }
        }
    }

    if let Some(token) = &raw_token {
        if let Some(ctx) = validate_raw_token(token, &config) {
            req.extensions_mut().insert(ctx);
            return Ok(next.run(req).await);
        }

        // Check if the key itself is banned
        let (is_key_banned, reason) = BanList::is_key_banned(token);
        if is_key_banned {
            return Err(AxiomError::new(
                "AUTH_INVALID_KEY",
                &format!("API key is suspended: {}", reason),
                axum::http::StatusCode::FORBIDDEN,
            ));
        }
    }

    // Special case: Allow WebSocket upgrades to pass through without header auth.
    // Browser WebSocket API cannot send custom headers, so auth is handled via
    // the first JSON message in the WebSocket handler.
    // DoS protection is provided by bounded channels and max connection limits.
    let is_ws = req
        .headers()
        .get(axum::http::header::UPGRADE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_lowercase() == "websocket")
        .unwrap_or(false);

    if is_ws {
        return Ok(next.run(req).await);
    }

    Err(AxiomError::new(
        "UNAUTHORIZED",
        "Missing or invalid API key.",
        axum::http::StatusCode::UNAUTHORIZED,
    ))
}

pub fn validate_raw_token(
    raw_token: &str,
    config: &crate::config::schema::AxiomConfig,
) -> Option<AuthContext> {
    use base64::prelude::*;
    let decoded_str = BASE64_STANDARD
        .decode(raw_token)
        .ok()
        .and_then(|d| String::from_utf8(d).ok());

    if let Some(decoded) = decoded_str {
        if let Some((key_name, key_secret)) = decoded.split_once(':') {
            if let Some(key_cfg) = config.api_key.get(key_name) {
                let secret_ok = !key_cfg.secret.is_empty()
                    && key_cfg.secret.len() == key_secret.len()
                    && constant_time_eq(key_cfg.secret.as_bytes(), key_secret.as_bytes());

                if secret_ok {
                    return Some(AuthContext {
                        api_key_name: key_name.to_string(),
                        mode: key_cfg.mode.clone(),
                        db_scope: key_cfg.db_scope.clone(),
                        fs_scope: key_cfg.fs_scope.clone(),
                        feature_scope: key_cfg.feature_scope.clone(),
                        rate_limit_override: key_cfg.rate_limit_override as u32,
                        full_admin: key_cfg.full_admin,
                    });
                }
            } else if let Some(fed_cfg) = config.federation.incoming.get(key_name) {
                let secret_ok = !fed_cfg.secret.is_empty()
                    && fed_cfg.secret.len() == key_secret.len()
                    && constant_time_eq(fed_cfg.secret.as_bytes(), key_secret.as_bytes());

                if secret_ok {
                    return Some(AuthContext {
                        api_key_name: key_name.to_string(),
                        mode: fed_cfg.mode.clone(),
                        db_scope: fed_cfg.db_scope.clone(),
                        fs_scope: fed_cfg.fs_scope.clone(),
                        feature_scope: fed_cfg.feature_scope.clone(),
                        rate_limit_override: 0,
                        full_admin: false,
                    });
                }
            }
        }
    }

    None
}
