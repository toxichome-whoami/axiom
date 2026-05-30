use axum::{
    extract::Request,
    middleware::Next,
    response::Response,
};
use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;
use crate::security::ban_list::BanList;
use crate::utils::types::{AuthContext, ServerMode};

pub async fn auth_middleware(
    mut req: Request,
    next: Next,
) -> Result<Response, AxiomError> {
    let _config = ConfigManager::get();

    // 1. IP Ban Check
    let client_ip = "127.0.0.1"; // TODO: Extract real IP
    let (is_ip_banned, reason) = BanList::is_ip_banned(client_ip);
    if is_ip_banned {
        return Err(AxiomError::new("RATE_LIMIT_BLOCKED", &format!("IP address is banned: {}", reason), axum::http::StatusCode::FORBIDDEN));
    }

    // 2. Extract Bearer token
    let auth_header = req.headers().get("Authorization").and_then(|h| h.to_str().ok());

    if let Some(auth_value) = auth_header {
        if auth_value.starts_with("Bearer ") {
            let token = &auth_value[7..];

            let config = ConfigManager::get();
            // Check if the token matches any API key's secret or name:secret format
            for (key_name, key_cfg) in &config.api_key {
                let is_match = token == key_cfg.secret || token == format!("{}:{}", key_name, key_cfg.secret);
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
                return Err(AxiomError::new("AUTH_INVALID_KEY", &format!("API key is suspended: {}", reason), axum::http::StatusCode::FORBIDDEN));
            }
        }
    }

    // Unauthenticated fallback
    let ctx = AuthContext {
        api_key_name: "anonymous".to_string(),
        mode: ServerMode::Readonly,
        db_scope: vec![],
        fs_scope: vec![],
        feature_scope: vec![],
        rate_limit_override: 0,
        full_admin: false,
    };
    req.extensions_mut().insert(ctx);

    Ok(next.run(req).await)
}
