/*
 * API key authentication and identity resolution middleware.
 * Owned by: middleware
 * Key deps: axum, base64, blake3, crate::config, crate::metadata::snapshot, crate::security::ban_list, crate::utils::types::AuthContext
 * Invariants: Secrets verified using constant-time XOR comparison; data plane reads lock-free from ArcSwap snapshot with zero DB queries.
 * Last structural change: Phase 1 ArcSwap snapshot BLAKE3 verification with zero-lock hot path.
 */

use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;
use crate::security::ban_list::BanList;
use crate::utils::types::AuthContext;
use axum::{extract::Request, middleware::Next, response::Response};
use base64::prelude::*;

// ─── Authentication Middleware ─────────────────────────────────────────────
// Intercepts inbound requests, extracts API key tokens, and populates request extensions
// with a verified AuthContext for downstream policy enforcement.

/// Authenticates the request via X-Axiom-Key, X-Api-Key, or Bearer Authorization headers.
/// CONTRACT:
///  - Precondition: Upstream IP rate-limit and ban checks have already completed.
///  - Injects `AuthContext` into request extensions upon successful verification.
///  - Throws `AxiomError(UNAUTHORIZED, 401)` on missing/invalid credentials,
///    or `AxiomError(AUTH_INVALID_KEY, 403)` if key identity is suspended.
///  - Side effects: Updates failure/success counters in BanList.
///  - Idempotent: Yes on success; increments failure bucket on invalid credentials.
pub async fn auth_middleware(mut req: Request, next: Next) -> Result<Response, AxiomError> {
    let config = req
        .extensions()
        .get::<std::sync::Arc<crate::config::schema::AxiomConfig>>()
        .cloned()
        .unwrap_or_else(ConfigManager::get);

    // Extract raw token from header (prefer dedicated Axiom headers over generic Bearer)
    let mut raw_token_opt = None;

    if let Some(key) = req
        .headers()
        .get("X-Axiom-Key")
        .or_else(|| req.headers().get("X-Api-Key"))
    {
        if let Ok(key_str) = key.to_str() {
            raw_token_opt = Some(key_str);
        }
    }

    if raw_token_opt.is_none() {
        if let Some(auth_hdr) = req.headers().get("Authorization").and_then(|h| h.to_str().ok()) {
            if let Some(stripped) = auth_hdr.strip_prefix("Bearer ") {
                raw_token_opt = Some(stripped);
            }
        }
    }

    if let Some(raw_token) = raw_token_opt {
        match validate_api_key(raw_token, &config) {
            Ok(ctx) => {
                BanList::record_successful_auth(&ctx.api_key_name);
                req.extensions_mut().insert(ctx);
                return Ok(next.run(req).await);
            }
            Err(Some(ban_reason)) => {
                return Err(AxiomError::new(
                    "AUTH_INVALID_KEY",
                    &format!("API key is suspended: {}", ban_reason),
                    axum::http::StatusCode::FORBIDDEN,
                ));
            }
            Err(None) => {
                // Invalid credentials or unparseable token
            }
        }
    }

    Err(AxiomError::new(
        "UNAUTHORIZED",
        "Missing or invalid API key.",
        axum::http::StatusCode::UNAUTHORIZED,
    ))
}

/// Parses base64 encoded `name:secret` token and verifies secret in constant time.
/// CONTRACT:
///  - Precondition: `raw_token` must be a base64 encoded string.
///  - Returns `Ok(AuthContext)` on valid credentials.
///  - Returns `Err(Some(reason))` if the key exists but is currently suspended.
///  - Returns `Err(None)` if key format is invalid, unknown, or secret mismatch.
///  - Side effects: Increments failure counter for recognized key names when secret fails.
///  - Idempotent: No (modifies BanList failure tracking state).
pub fn validate_api_key(
    raw_token: &str,
    config: &crate::config::schema::AxiomConfig,
) -> Result<AuthContext, Option<String>> {
    let decoded_str = BASE64_STANDARD
        .decode(raw_token)
        .ok()
        .and_then(|d| String::from_utf8(d).ok());

    if let Some(decoded) = decoded_str {
        if let Some((key_name, key_secret)) = decoded.split_once(':') {
            // Check if key identifier is currently suspended
            let (is_banned, reason) = BanList::is_key_banned(key_name);
            if is_banned {
                return Err(Some(reason));
            }

            // 1. Check live ArcSwap metadata snapshot (zero-lock hot path)
            let snapshot = crate::metadata::snapshot::get_snapshot();
            if let Some(key_snap) = snapshot.keys.get(key_name) {
                // Check key expiration if configured
                if let Some(exp) = key_snap.expires_at {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs() as i64;
                    if now > exp {
                        return Err(Some("API key has expired".to_string()));
                    }
                }

                // Compute BLAKE3 hash of incoming secret and compare constant-time
                let computed_hash = blake3::hash(key_secret.as_bytes());
                let mut match_result = 0;
                for (a, b) in computed_hash.as_bytes().iter().zip(key_snap.secret_hash.iter()) {
                    match_result |= a ^ b;
                }

                if match_result == 0 {
                    let is_admin = key_snap.role_name.as_deref().map(|r| r.contains("admin")).unwrap_or(false);
                    return Ok(AuthContext {
                        api_key_name: key_name.to_string(),
                        mode: crate::utils::types::ServerMode::Readwrite,
                        db_scope: vec!["*".to_string()],
                        rate_limit_override: key_snap.rate_limit_override,
                        full_admin: is_admin,
                    });
                }
            }

            // 2. Fallback check for static config.toml entries (backward compatibility)
            if let Some(key_cfg) = config.api_key.get(key_name) {
                // Constant-time comparison preventing timing-attack oracle on secret bytes
                let mut match_result = 0;
                if key_cfg.secret.len() == key_secret.len() {
                    for (a, b) in key_cfg.secret.bytes().zip(key_secret.bytes()) {
                        match_result |= a ^ b;
                    }
                } else {
                    match_result = 1;
                }

                if !key_cfg.secret.is_empty() && match_result == 0 {
                    return Ok(AuthContext {
                        api_key_name: key_name.to_string(),
                        mode: key_cfg.mode.clone(),
                        db_scope: key_cfg.db_scope.clone(),
                        rate_limit_override: key_cfg.rate_limit_override as u32,
                        full_admin: key_cfg.full_admin,
                    });
                } else {
                    // S3: Track distributed auth failures against recognized key name
                    let penalty_threshold = if config.rate_limit.penalty_threshold > 0 {
                        config.rate_limit.penalty_threshold as u32
                    } else {
                        5
                    };
                    BanList::record_failed_auth(key_name, penalty_threshold, 60);
                }
            } else if snapshot.keys.contains_key(key_name) {
                // Key exists in metadata snapshot but secret hash check failed
                let penalty_threshold = if config.rate_limit.penalty_threshold > 0 {
                    config.rate_limit.penalty_threshold as u32
                } else {
                    5
                };
                BanList::record_failed_auth(key_name, penalty_threshold, 60);
            }
        }
    }

    Err(None)
}
