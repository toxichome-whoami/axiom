use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;
use crate::security::ban_list::BanList;
use crate::utils::types::AuthContext;
use axum::{extract::Request, middleware::Next, response::Response};

pub async fn auth_middleware(mut req: Request, next: Next) -> Result<Response, AxiomError> {
    let config = req
        .extensions()
        .get::<std::sync::Arc<crate::config::schema::AxiomConfig>>()
        .cloned()
        .unwrap_or_else(|| ConfigManager::get());

    let client_ip = req
        .headers()
        .get("x-forwarded-for")
        .or_else(|| req.headers().get("x-real-ip"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("127.0.0.1")
        .to_string();

    let (is_ip_banned, reason) = BanList::is_ip_banned(&client_ip);
    if is_ip_banned {
        return Err(AxiomError::new(
            "RATE_LIMIT_BLOCKED",
            &format!("IP address is banned: {}", reason),
            axum::http::StatusCode::FORBIDDEN,
        ));
    }

    // 1. Extract token from header ONLY
    let mut auth_value = None;

    if let Some(key) = req
        .headers()
        .get("X-Axiom-Key")
        .or_else(|| req.headers().get("X-Api-Key"))
    {
        if let Ok(key_str) = key.to_str() {
            auth_value = Some(format!("Bearer {}", key_str));
        }
    }

    if auth_value.is_none() {
        auth_value = req
            .headers()
            .get("Authorization")
            .and_then(|h| h.to_str().ok().map(|s| s.to_string()));
    }

    if let Some(auth_value) = auth_value {
        if let Some(ctx) = validate_api_key(&auth_value, &config) {
            req.extensions_mut().insert(ctx);
            return Ok(next.run(req).await);
        }

        // Check if the key itself is banned
        if auth_value.starts_with("Bearer ") {
            let raw_token = &auth_value[7..];
            let (is_key_banned, reason) = BanList::is_key_banned(raw_token);
            if is_key_banned {
                return Err(AxiomError::new(
                    "AUTH_INVALID_KEY",
                    &format!("API key is suspended: {}", reason),
                    axum::http::StatusCode::FORBIDDEN,
                ));
            }
        }
    }

    // Special case: Allow WebSocket upgrades to pass through without header auth.
    // They will be authenticated via the first JSON payload in the WebSocket handler.
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

pub fn validate_api_key(
    auth_value: &str,
    config: &crate::config::schema::AxiomConfig,
) -> Option<AuthContext> {
    if !auth_value.starts_with("Bearer ") {
        return None;
    }

    let raw_token = &auth_value[7..];

    use base64::prelude::*;
    let decoded_str = BASE64_STANDARD
        .decode(raw_token)
        .ok()
        .and_then(|d| String::from_utf8(d).ok());

    if let Some(decoded) = decoded_str {
        if let Some((key_name, key_secret)) = decoded.split_once(':') {
            if let Some(key_cfg) = config.api_key.get(key_name) {
                if key_cfg.secret == key_secret && !key_cfg.secret.is_empty() {
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
                if fed_cfg.secret == key_secret && !fed_cfg.secret.is_empty() {
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
