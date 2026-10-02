/*
 * API key authentication and identity resolution middleware.
 * Owned by: middleware
 * Key deps: axum, base64, blake3, crate::config, axiom_metadata::snapshot, crate::security::ban_list, axiom_core::AuthContext
 * Invariants: Secrets verified using constant-time XOR comparison; data plane reads lock-free from ArcSwap snapshot with zero DB queries.
 * Last structural change: Phase 1 ArcSwap snapshot BLAKE3 verification with zero-lock hot path.
 */

use axiom_core::AxiomError;
use axiom_core::ConfigManager;
use crate::security::ban_list::BanList;
use axiom_core::AuthContext;
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
        .get::<std::sync::Arc<axiom_core::AxiomConfig>>()
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
                crate::metrics::MetricsEngine::record_auth_failure("key_suspended");
                return Err(AxiomError::new(
                    "AUTH_INVALID_KEY",
                    &format!("API key is suspended: {}", ban_reason),
                    axum::http::StatusCode::FORBIDDEN,
                ));
            }
            Err(None) => {
                // Not a valid API key token; fall through to test administrative session
            }
        }
    }

    // Check for administrative session token (via Bearer header or Cookie)
    let mut session_id_opt = None;
    if let Some(raw_token) = raw_token_opt {
        if !raw_token.contains(':') && raw_token.len() == 32 {
            session_id_opt = Some(raw_token);
        }
    }
    if session_id_opt.is_none() {
        if let Some(cookie_hdr) = req.headers().get("Cookie").and_then(|h| h.to_str().ok()) {
            for part in cookie_hdr.split(';') {
                let trimmed = part.trim();
                if let Some(val) = trimmed.strip_prefix("axiom_session=") {
                    session_id_opt = Some(val);
                    break;
                }
            }
        }
    }

    if let Some(session_id) = session_id_opt {
        // Fast-path: Check RAM cache for active session before hitting SQLite
        let cache_key = format!("sess:{}", session_id);
        if let Some(user_bytes) = axiom_cache::CacheEngine::get(&cache_key).await {
            if let Ok(username) = std::str::from_utf8(&user_bytes) {
                let ctx = AuthContext {
                    api_key_name: format!("user:{}", username),
                    role: Some("admin".to_string()),
                    full_admin: true,
                    ..Default::default()
                };
                req.extensions_mut().insert(ctx);
                return Ok(next.run(req).await);
            }
        }

        if let Ok(Some(username)) = axiom_metadata::store::MetadataStore::validate_session(session_id).await {
            // Cache active session in RAM for 60 seconds
            axiom_cache::CacheEngine::set(
                &cache_key,
                bytes::Bytes::from(username.clone()),
                60,
                axiom_cache::Durability::MemoryOnly,
            ).await;

            let ctx = AuthContext {
                api_key_name: format!("user:{}", username),
                role: Some("admin".to_string()),
                full_admin: true,
                ..Default::default()
            };
            req.extensions_mut().insert(ctx);
            return Ok(next.run(req).await);
        }
    }

    crate::metrics::MetricsEngine::record_auth_failure("invalid_credentials");

    Err(AxiomError::new(
        "UNAUTHORIZED",
        "Missing or invalid API key or administrative session.",
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
    config: &axiom_core::AxiomConfig,
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
            let snapshot = axiom_metadata::snapshot::get_snapshot();
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
                    let mut is_admin = false;
                    let mut permissions = Vec::new();

                    if let Some(ref r_name) = key_snap.role_name {
                        if let Some(role_snap) = snapshot.roles.get(r_name) {
                            permissions = role_snap.permissions.clone();
                            if r_name == "admin"
                                || r_name.contains("admin")
                                || permissions.iter().any(|p| {
                                    p.database == "*"
                                        && p.table_name == "*"
                                        && p.operations.iter().any(|op| op == "*")
                                })
                            {
                                is_admin = true;
                            }
                        }
                    }

                    return Ok(AuthContext {
                        api_key_name: key_name.to_string(),
                        mode: axiom_core::ServerMode::Readwrite,
                        db_scope: vec!["*".to_string()],
                        rate_limit_override: key_snap.rate_limit_override,
                        full_admin: is_admin,
                        role: key_snap.role_name.clone(),
                        permissions,
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
                        role: None,
                        permissions: Vec::new(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use once_cell::sync::Lazy;
    use std::sync::Mutex;
    use axiom_metadata::snapshot::{
        update_snapshot, ApiKeySnapshot, MetadataSnapshot, PermissionSnapshot, RoleSnapshot,
    };

    static TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    #[test]
    fn test_validate_api_key_invalid_base64() {
        let _guard = TEST_LOCK.lock().unwrap();
        let config = axiom_core::AxiomConfig::default();
        let result = validate_api_key("!not_valid_base64!@#", &config);
        assert_eq!(result, Err(None));
    }

    #[test]
    fn test_validate_api_key_missing_colon() {
        let _guard = TEST_LOCK.lock().unwrap();
        let config = axiom_core::AxiomConfig::default();
        let encoded = BASE64_STANDARD.encode("only_key_without_secret");
        let result = validate_api_key(&encoded, &config);
        assert_eq!(result, Err(None));
    }

    #[test]
    fn test_validate_api_key_from_snapshot_success() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut keys = HashMap::new();
        let mut roles = HashMap::new();

        roles.insert(
            "admin".to_string(),
            RoleSnapshot {
                name: "admin".to_string(),
                permissions: vec![PermissionSnapshot {
                    database: "*".to_string(),
                    table_name: "*".to_string(),
                    operations: vec!["*".to_string()],
                }],
            },
        );

        keys.insert(
            "test_user".to_string(),
            ApiKeySnapshot {
                name: "test_user".to_string(),
                secret_hash: blake3::hash(b"correct_secret").into(),
                role_name: Some("admin".to_string()),
                rate_limit_override: 50,
                expires_at: None,
            },
        );

        update_snapshot(MetadataSnapshot {
            keys,
            roles,
            databases: HashMap::new(),
            loaded_at_unix: 0,
        });

        let config = axiom_core::AxiomConfig::default();
        let valid_token = BASE64_STANDARD.encode("test_user:correct_secret");
        let result = validate_api_key(&valid_token, &config);

        assert!(result.is_ok());
        let ctx = result.unwrap();
        assert_eq!(ctx.api_key_name, "test_user");
        assert!(ctx.full_admin);
        assert_eq!(ctx.role, Some("admin".to_string()));
    }

    #[test]
    fn test_validate_api_key_wrong_secret() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut keys = HashMap::new();
        keys.insert(
            "test_wrong_secret_user".to_string(),
            ApiKeySnapshot {
                name: "test_wrong_secret_user".to_string(),
                secret_hash: blake3::hash(b"actual_secret").into(),
                role_name: None,
                rate_limit_override: 0,
                expires_at: None,
            },
        );

        update_snapshot(MetadataSnapshot {
            keys,
            roles: HashMap::new(),
            databases: HashMap::new(),
            loaded_at_unix: 0,
        });

        let config = axiom_core::AxiomConfig::default();
        let token = BASE64_STANDARD.encode("test_wrong_secret_user:wrong_password");
        let result = validate_api_key(&token, &config);
        assert_eq!(result, Err(None));
    }

    #[test]
    fn test_validate_api_key_expired() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut keys = HashMap::new();
        keys.insert(
            "expired_key".to_string(),
            ApiKeySnapshot {
                name: "expired_key".to_string(),
                secret_hash: blake3::hash(b"my_secret").into(),
                role_name: None,
                rate_limit_override: 0,
                expires_at: Some(1), // epoch + 1s, firmly in past
            },
        );

        update_snapshot(MetadataSnapshot {
            keys,
            roles: HashMap::new(),
            databases: HashMap::new(),
            loaded_at_unix: 0,
        });

        let config = axiom_core::AxiomConfig::default();
        let token = BASE64_STANDARD.encode("expired_key:my_secret");
        let result = validate_api_key(&token, &config);

        assert_eq!(result, Err(Some("API key has expired".to_string())));
    }
}
