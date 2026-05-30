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
        return Err(AxiomError::new("RATE_LIMIT_BLOCKED", format!("IP address is banned: {}", reason), axum::http::StatusCode::FORBIDDEN));
    }

    // 2. Extract Bearer token
    let auth_header = req.headers().get("Authorization").and_then(|h| h.to_str().ok());

    if let Some(auth_value) = auth_header {
        if auth_value.starts_with("Bearer ") {
            let token = &auth_value[7..];

            // Basic hardcoded check for migration purposes
            if token == "admin:secret" {
                let ctx = AuthContext {
                    api_key_name: "admin".to_string(),
                    mode: ServerMode::Readwrite,
                    db_scope: vec!["*".to_string()],
                    fs_scope: vec!["*".to_string()],
                    feature_scope: vec!["*".to_string()],
                    rate_limit_override: 0,
                    full_admin: true,
                };
                req.extensions_mut().insert(ctx);
                return Ok(next.run(req).await);
            }

            let (is_key_banned, reason) = BanList::is_key_banned(token);
            if is_key_banned {
                return Err(AxiomError::new("AUTH_INVALID_KEY", format!("API key is suspended: {}", reason), axum::http::StatusCode::FORBIDDEN));
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
