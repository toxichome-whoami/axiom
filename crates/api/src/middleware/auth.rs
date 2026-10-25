/*
 * API key authentication and identity resolution middleware.
 * Owned by: middleware
 * Key deps: axum, base64, blake3, crate::config, axiom_metadata::snapshot, crate::security::ban_list, axiom_core::AuthContext
 * Invariants: Secrets verified using constant-time XOR comparison; data plane reads lock-free from ArcSwap snapshot with zero DB queries.
 * Last structural change: Phase 1 ArcSwap snapshot BLAKE3 verification with zero-lock hot path.
 */

use crate::security::ban_list::BanList;
use axiom_core::AuthContext;
use axiom_core::AxiomError;
use axiom_core::ConfigManager;
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
        if let Some(auth_hdr) = req
            .headers()
            .get("Authorization")
            .and_then(|h| h.to_str().ok())
        {
            if let Some(stripped) = auth_hdr.strip_prefix("Bearer ") {
                raw_token_opt = Some(stripped);
            }
        }
    }

    if let Some(raw_token) = raw_token_opt {
        let client_ip = crate::middleware::rate_limit::resolve_client_ip(&req, &config);
        match validate_api_key_with_client_ip(raw_token, &config, Some(&client_ip)) {
            Ok(ctx) => {
                BanList::record_successful_auth_for_ip(&client_ip, &ctx.api_key_name);
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

    // Check for explicit Capability Ticket invocation on native blob endpoints (/api/v1/blobs/*).
    // MUST execute before session check: capability URLs carrying ticket_sig MUST be validated against
    // the capability ticket registry and signature, and CANNOT bypass ticket revocation/deletion via ambient session cookies.
    let path = req.uri().path();
    let stripped_blob_path = path
        .strip_prefix("/api/v1/blobs/")
        .or_else(|| path.strip_prefix("/blobs/"));

    let has_ticket_sig = stripped_blob_path.is_some()
        && req
            .uri()
            .query()
            .map(|q| q.contains("ticket_sig="))
            .unwrap_or(false);

    if let (Some(raw_stripped), true) = (stripped_blob_path, has_ticket_sig) {
        let stripped = raw_stripped
            .strip_prefix("objects/")
            .or_else(|| raw_stripped.strip_prefix("public/"))
            .unwrap_or(raw_stripped);
        let query = req.uri().query().unwrap_or("");
        let mut ticket_sig: Option<String> = None;
        let mut ticket_exp_str: Option<String> = None;
        for pair in query.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                if k == "ticket_sig" {
                    ticket_sig = Some(
                        urlencoding::decode(v)
                            .unwrap_or(std::borrow::Cow::Borrowed(v))
                            .into_owned(),
                    );
                } else if k == "ticket_exp" {
                    ticket_exp_str = Some(
                        urlencoding::decode(v)
                            .unwrap_or(std::borrow::Cow::Borrowed(v))
                            .into_owned(),
                    );
                }
            }
        }

        let sig = match ticket_sig {
            Some(s) if !s.trim().is_empty() => s,
            _ => {
                return Err(AxiomError::new(
                    "AUTH_TICKET_INVALID",
                    "Missing or empty capability ticket signature",
                    axum::http::StatusCode::FORBIDDEN,
                ));
            }
        };

        let exp = ticket_exp_str
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);

        let (ns, key) = match stripped.split_once('/') {
            Some((n, k)) => (n, k),
            None => {
                return Err(AxiomError::new(
                    "BAD_REQUEST",
                    "Invalid blob path structure",
                    axum::http::StatusCode::BAD_REQUEST,
                ));
            }
        };

        let decoded_ns = urlencoding::decode(ns).unwrap_or(std::borrow::Cow::Borrowed(ns));
        let decoded_key = urlencoding::decode(key).unwrap_or(std::borrow::Cow::Borrowed(key));

        let op = match *req.method() {
            axum::http::Method::GET | axum::http::Method::HEAD => "READ",
            axum::http::Method::PUT => "WRITE",
            _ => "UNKNOWN",
        };

        let secret = axiom_blob::tickets::get_ticket_secret();

        // 1. Verify cryptographic HMAC signature
        if let Err(e) =
            axiom_blob::tickets::verify_ticket(secret, &decoded_ns, &decoded_key, op, exp, &sig)
        {
            return Err(AxiomError::new(
                "AUTH_TICKET_INVALID",
                &format!("Capability ticket verification failed: {}", e),
                axum::http::StatusCode::FORBIDDEN,
            ));
        }

        // 2. Instant cache check: if marked revoked or deleted in RAM, reject immediately
        let cache_revoked_key = format!("ticket:revoked:{}", sig);
        if axiom_cache::CacheEngine::get(&cache_revoked_key)
            .await
            .is_some()
        {
            return Err(AxiomError::new(
                "AUTH_TICKET_REVOKED",
                "Capability ticket has been revoked or deleted by an administrator",
                axum::http::StatusCode::FORBIDDEN,
            ));
        }

        // 3. Check active validity cache or SQLite registry
        let cache_valid_key = format!("ticket:valid:{}", sig);
        let is_cached_valid = axiom_cache::CacheEngine::get(&cache_valid_key)
            .await
            .is_some();

        if !is_cached_valid {
            let is_active = axiom_metadata::MetadataStore::is_blob_ticket_active(&sig)
                .await
                .unwrap_or(false);

            if !is_active {
                // Immediately register tombstone in RAM cache so repeated checks are instant
                axiom_cache::CacheEngine::set(
                    &cache_revoked_key,
                    bytes::Bytes::from_static(b"1"),
                    86_400,
                    axiom_cache::Durability::MemoryOnly,
                )
                .await;

                return Err(AxiomError::new(
                    "AUTH_TICKET_REVOKED",
                    "Capability ticket has been revoked or deleted by an administrator",
                    axum::http::StatusCode::FORBIDDEN,
                ));
            }

            // Positive cache active status for min(remaining TTL, 300) seconds
            let now_unix = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            let ttl = (exp - now_unix).clamp(5, 300) as u64;
            axiom_cache::CacheEngine::set(
                &cache_valid_key,
                bytes::Bytes::from_static(b"1"),
                ttl,
                axiom_cache::Durability::MemoryOnly,
            )
            .await;
        }

        // Inject ticket identity context; role is set to "ticket" which PolicyEngine
        // strictly restricts from executing DELETE mutations.
        let ctx = AuthContext {
            api_key_name: format!("ticket:{}:{}", decoded_ns, decoded_key),
            role: Some("ticket".to_string()),
            mode: if op == "READ" {
                axiom_core::ServerMode::Readonly
            } else {
                axiom_core::ServerMode::Readwrite
            },
            db_scope: vec![decoded_ns.to_string()],
            ..Default::default()
        };
        req.extensions_mut().insert(ctx);
        return Ok(next.run(req).await);
    }

    // Check for administrative session token (via Bearer header or Cookie).
    // Session tokens have the "axm_sess_" prefix. Match on prefix, not fixed length,
    // so the check stays correct even if the UUID representation changes.
    let mut session_id_opt = None;
    if let Some(raw_token) = raw_token_opt {
        if raw_token.starts_with("axm_sess_") {
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
                    is_session: true,
                    ..Default::default()
                };
                req.extensions_mut().insert(ctx);
                return Ok(next.run(req).await);
            }
        }

        if let Ok(Some(username)) =
            axiom_metadata::store::MetadataStore::validate_session(session_id).await
        {
            // Cache active session in RAM for 60 seconds
            axiom_cache::CacheEngine::set(
                &cache_key,
                bytes::Bytes::from(username.clone()),
                60,
                axiom_cache::Durability::MemoryOnly,
            )
            .await;

            let ctx = AuthContext {
                api_key_name: format!("user:{}", username),
                role: Some("admin".to_string()),
                is_session: true,
                ..Default::default()
            };
            req.extensions_mut().insert(ctx);
            return Ok(next.run(req).await);
        }
    }

    // Fast-path: Unauthenticated public blob reads (/api/v1/blobs/public/:namespace/*key)
    // Handler validates that target namespace has is_public == true.
    if let Some(stripped) = stripped_blob_path {
        if stripped.starts_with("public/")
            && (*req.method() == axum::http::Method::GET
                || *req.method() == axum::http::Method::HEAD)
        {
            let ctx = AuthContext {
                api_key_name: "public:anonymous".to_string(),
                role: Some("public".to_string()),
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

// ─── API Key Validation (Snapshot & Config Fallback) ────────────────────────

/// Parses base64 encoded `name:secret` token and verifies secret in constant time.
/// CONTRACT:
///  - Precondition: `raw_token` must be a base64 encoded string.
///  - Returns `Ok(AuthContext)` on valid credentials.
///  - Returns `Err(Some(reason))` if the key exists but is currently suspended.
///  - Returns `Err(None)` if key format is invalid, unknown, or secret mismatch.
///  - Side effects: Increments failure counter for recognized key names when secret fails.
///  - Concurrency: Zero database locks on hot path via ArcSwap metadata snapshot.
pub fn validate_api_key_with_client_ip(
    raw_token: &str,
    config: &axiom_core::AxiomConfig,
    client_ip: Option<&str>,
) -> Result<AuthContext, Option<String>> {
    let decoded_str = BASE64_STANDARD
        .decode(raw_token)
        .ok()
        .and_then(|d| String::from_utf8(d).ok());

    if let Some(decoded) = decoded_str {
        if let Some((key_name, key_secret)) = decoded.split_once(':') {
            // Check if key identifier is currently suspended in BanList
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
                for (a, b) in computed_hash
                    .as_bytes()
                    .iter()
                    .zip(key_snap.secret_hash.iter())
                {
                    match_result |= a ^ b;
                }

                if match_result == 0 {
                    let mut permissions = Vec::new();

                    if let Some(ref r_name) = key_snap.role_name {
                        if let Some(role_snap) = snapshot.roles.get(r_name) {
                            permissions = role_snap.permissions.clone();
                        }
                    }

                    return Ok(AuthContext {
                        api_key_name: key_name.to_string(),
                        mode: axiom_core::ServerMode::Readwrite,
                        db_scope: vec!["*".to_string()],
                        rate_limit_override: key_snap.rate_limit_override,
                        is_session: false,
                        role: key_snap.role_name.clone(),
                        permissions,
                    });
                } else {
                    // Key exists in metadata snapshot but secret hash check failed
                    let penalty_threshold = if config.rate_limit.penalty_threshold > 0 {
                        config.rate_limit.penalty_threshold as u32
                    } else {
                        5
                    };
                    let window_secs = if config.rate_limit.window > 0 {
                        config.rate_limit.window as u64
                    } else {
                        60
                    };
                    let cooldown_secs = if config.rate_limit.penalty_cooldown > 0 {
                        config.rate_limit.penalty_cooldown as u64
                    } else {
                        0
                    };

                    // SECURITY (Anti-DoS): If client_ip is known, ban the attacking client IP
                    // rather than globally suspending the API key, preventing 3rd-party lockout of legitimate keys.
                    if let Some(ip) = client_ip {
                        BanList::record_failed_auth_for_ip(
                            ip,
                            key_name,
                            penalty_threshold,
                            window_secs,
                            cooldown_secs,
                        );
                    } else {
                        BanList::record_failed_auth(
                            key_name,
                            penalty_threshold,
                            window_secs,
                            cooldown_secs,
                        );
                    }
                }
            }
        }
    }

    Err(None)
}

/// Backwards-compatible validator for API key tokens without explicit client IP context.
pub fn validate_api_key(
    raw_token: &str,
    config: &axiom_core::AxiomConfig,
) -> Result<AuthContext, Option<String>> {
    validate_api_key_with_client_ip(raw_token, config, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axiom_metadata::snapshot::{
        update_snapshot, ApiKeySnapshot, MetadataSnapshot, PermissionSnapshot, RoleSnapshot,
    };
    use once_cell::sync::Lazy;
    use std::collections::HashMap;
    use std::sync::Mutex;

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
                    rls_filter: None,
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
        assert!(!ctx.is_session);
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
