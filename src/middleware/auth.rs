use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;
use crate::security::ban_list::BanList;
use crate::utils::types::AuthContext;
use axum::{extract::Request, middleware::Next, response::Response};
use url::form_urlencoded;

pub async fn auth_middleware(mut req: Request, next: Next) -> Result<Response, AxiomError> {
    let _config = req
        .extensions()
        .get::<std::sync::Arc<crate::config::schema::AxiomConfig>>()
        .cloned()
        .unwrap_or_else(|| ConfigManager::get());

    // 1. IP Ban Check
    let client_ip = "127.0.0.1"; // TODO: Extract real IP
    let (is_ip_banned, reason) = BanList::is_ip_banned(client_ip);
    if is_ip_banned {
        return Err(AxiomError::new(
            "RATE_LIMIT_BLOCKED",
            &format!("IP address is banned: {}", reason),
            axum::http::StatusCode::FORBIDDEN,
        ));
    }

    // 2. Extract token from header or query
    let mut auth_value = req
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok().map(|s| s.to_string()));

    if auth_value.is_none() {
        if let Some(query) = req.uri().query() {
            let params: std::collections::HashMap<String, String> =
                form_urlencoded::parse(query.as_bytes())
                    .into_owned()
                    .collect();
            if let Some(token) = params.get("token").or(params.get("key")) {
                auth_value = Some(format!("Bearer {}", token));
            }
        }
    }

    if let Some(auth_value) = auth_value {
        if auth_value.starts_with("Bearer ") {
            let raw_token = &auth_value[7..];

            // Auto-detect and decode Base64 tokens from legacy demo scripts
            let decoded_token = if !raw_token.contains(':') && raw_token.len() > 30 {
                use base64::prelude::*;
                BASE64_STANDARD
                    .decode(raw_token)
                    .ok()
                    .and_then(|d| String::from_utf8(d).ok())
            } else {
                None
            };

            let token = decoded_token.as_deref().unwrap_or(raw_token);

            let config = req
                .extensions()
                .get::<std::sync::Arc<crate::config::schema::AxiomConfig>>()
                .cloned()
                .unwrap_or_else(|| ConfigManager::get());
            // Check if the token matches any API key's secret or name:secret format
            for (key_name, key_cfg) in &config.api_key {
                let is_match =
                    token == key_cfg.secret || token == format!("{}:{}", key_name, key_cfg.secret);
                if is_match {
                    let ctx = AuthContext {
                        api_key_name: key_name.clone(),
                        mode: key_cfg.mode.clone(),
                        db_scope: key_cfg.db_scope.clone(),
                        fs_scope: key_cfg.fs_scope.clone(),
                        feature_scope: key_cfg.feature_scope.clone(),
                        rate_limit_override: key_cfg.rate_limit_override as u32,
                        full_admin: key_cfg.full_admin,
                    };
                    req.extensions_mut().insert(ctx);
                    return Ok(next.run(req).await);
                }
            }

            let (is_key_banned, reason) = BanList::is_key_banned(token);
            if is_key_banned {
                return Err(AxiomError::new(
                    "AUTH_INVALID_KEY",
                    &format!("API key is suspended: {}", reason),
                    axum::http::StatusCode::FORBIDDEN,
                ));
            }
        }
    }

    Err(AxiomError::new(
        "UNAUTHORIZED",
        "Missing or invalid API key.",
        axum::http::StatusCode::UNAUTHORIZED,
    ))
}
