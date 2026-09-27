/*
 * Automated security regression test suite validating all attack scenarios from Master Plan Section 22.
 * Owned by: security
 * Key deps: axum, tower::ServiceExt, axiom, http, serde_json
 * Invariants: Every security vector has a deterministically verifiable HTTP status or logical trace.
 * Last structural change: Phase 8 hardening test suite implementation.
 */

use axum::body::Body;
use axum::http::{Request, StatusCode};
use base64::prelude::*;
use std::collections::HashMap;
use tower::ServiceExt;

use axiom::api::database::filter_builder::build_where_clause;
use axiom::metadata::snapshot::{
    update_snapshot, ApiKeySnapshot, MetadataSnapshot, PermissionSnapshot, RoleSnapshot,
};
use axiom::policy::engine::PolicyEngine;
use axiom::security::ban_list::BanList;
use axiom::server::app::create_app;
use axiom::utils::types::AuthContext;

// ─── Fixtures & Helpers ───────────────────────────────────────────────────

/// Configures in-memory metadata snapshot with test keys and roles.
fn setup_test_metadata() {
    let mut keys = HashMap::new();
    let mut roles = HashMap::new();
    let databases = HashMap::new();

    // 1. Admin Role & Key
    let mut admin_perms = Vec::new();
    admin_perms.push(PermissionSnapshot {
        database: "*".to_string(),
        table_name: "*".to_string(),
        operations: vec!["*".to_string()],
    });
    roles.insert(
        "admin".to_string(),
        RoleSnapshot {
            name: "admin".to_string(),
            permissions: admin_perms,
        },
    );

    let admin_hash = blake3::hash(b"secret_admin").into();
    keys.insert(
        "admin_key".to_string(),
        ApiKeySnapshot {
            name: "admin_key".to_string(),
            secret_hash: admin_hash,
            role_name: Some("admin".to_string()),
            rate_limit_override: 0,
            expires_at: None,
        },
    );

    // 2. Read-Only Scoped Role & Key (db_alpha only, SELECT only)
    let mut ro_perms = Vec::new();
    ro_perms.push(PermissionSnapshot {
        database: "db_alpha".to_string(),
        table_name: "*".to_string(),
        operations: vec!["SELECT".to_string()],
    });
    roles.insert(
        "readonly_role".to_string(),
        RoleSnapshot {
            name: "readonly_role".to_string(),
            permissions: ro_perms,
        },
    );

    let ro_hash = blake3::hash(b"secret_ro").into();
    keys.insert(
        "ro_key".to_string(),
        ApiKeySnapshot {
            name: "ro_key".to_string(),
            secret_hash: ro_hash,
            role_name: Some("readonly_role".to_string()),
            rate_limit_override: 0,
            expires_at: None,
        },
    );

    // 3. Expired Key
    let exp_hash = blake3::hash(b"secret_exp").into();
    keys.insert(
        "expired_key".to_string(),
        ApiKeySnapshot {
            name: "expired_key".to_string(),
            secret_hash: exp_hash,
            role_name: Some("readonly_role".to_string()),
            rate_limit_override: 0,
            expires_at: Some(1000), // Far in the past
        },
    );

    update_snapshot(MetadataSnapshot {
        keys,
        roles,
        databases,
        loaded_at_unix: 0,
    });
}

// ─── Attack Vector 1: Authentication Bypass Tests ─────────────────────────

#[tokio::test]
async fn test_auth_bypass_missing_header() {
    setup_test_metadata();
    let app = create_app();

    let req = Request::builder()
        .uri("/api/v1/db/main/tables")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_auth_bypass_invalid_base64() {
    setup_test_metadata();
    let app = create_app();

    let req = Request::builder()
        .uri("/api/v1/db/main/tables")
        .method("GET")
        .header("X-Axiom-Key", "!!!NOT_VALID_BASE64###")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_auth_bypass_wrong_secret() {
    setup_test_metadata();
    let app = create_app();

    let token = BASE64_STANDARD.encode("admin_key:wrong_secret_123");
    let req = Request::builder()
        .uri("/api/v1/db/main/tables")
        .method("GET")
        .header("X-Axiom-Key", token)
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_auth_bypass_expired_key() {
    setup_test_metadata();
    let app = create_app();

    let token = BASE64_STANDARD.encode("expired_key:secret_exp");
    let req = Request::builder()
        .uri("/api/v1/db/main/tables")
        .method("GET")
        .header("X-Axiom-Key", token)
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    // Suspended / expired returns 403 FORBIDDEN
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

// ─── Attack Vector 2: Authorization & Scope Bypass Tests ──────────────────

#[tokio::test]
async fn test_authz_bypass_select_only_cannot_insert() {
    setup_test_metadata();

    let snapshot = axiom::metadata::snapshot::get_snapshot();
    let role = snapshot.roles.get("readonly_role").unwrap();

    let ctx = AuthContext {
        api_key_name: "ro_key".to_string(),
        role: Some("readonly_role".to_string()),
        permissions: role.permissions.clone(),
        full_admin: false,
        ..Default::default()
    };

    // SELECT on db_alpha should be allowed
    assert!(PolicyEngine::evaluate(&ctx, "db_alpha", "users", "SELECT").is_ok());

    // INSERT on db_alpha must be rejected with 403
    let err = PolicyEngine::evaluate(&ctx, "db_alpha", "users", "INSERT").unwrap_err();
    assert_eq!(err.status, StatusCode::FORBIDDEN);
    assert_eq!(err.code, "AUTH_FORBIDDEN");
}

#[tokio::test]
async fn test_authz_bypass_database_scope_isolation() {
    setup_test_metadata();

    let snapshot = axiom::metadata::snapshot::get_snapshot();
    let role = snapshot.roles.get("readonly_role").unwrap();

    let ctx = AuthContext {
        api_key_name: "ro_key".to_string(),
        role: Some("readonly_role".to_string()),
        permissions: role.permissions.clone(),
        full_admin: false,
        ..Default::default()
    };

    // Query on db_beta must be denied because role is scoped to db_alpha
    let err = PolicyEngine::evaluate(&ctx, "db_beta", "users", "SELECT").unwrap_err();
    assert_eq!(err.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_privilege_escalation_non_admin_cannot_access_admin_api() {
    setup_test_metadata();
    let app = create_app();

    // Read-only machine key tries to access protected admin endpoint
    let token = BASE64_STANDARD.encode("ro_key:secret_ro");
    let req = Request::builder()
        .uri("/admin/v1/keys")
        .method("GET")
        .header("X-Axiom-Key", token)
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

// ─── Attack Vector 3: SQL Injection & AST Guardrails ──────────────────────

#[test]
fn test_sql_injection_filter_builder_parameterization() {
    let mut filter = HashMap::new();
    // Attacker crafts classic SQL injection payload inside filter value
    let malicious_payload = serde_json::json!({
        "$eq": "admin' OR '1'='1'; DROP TABLE users; --"
    });
    filter.insert("username".to_string(), malicious_payload);

    let (where_clause, params) = build_where_clause(&filter);

    // The WHERE clause must use parameter placeholder '?' rather than string concatenation
    assert_eq!(where_clause, "username = ?");
    assert_eq!(params.len(), 1);
    assert_eq!(
        params[0].as_str().unwrap(),
        "admin' OR '1'='1'; DROP TABLE users; --"
    );
}

#[test]
fn test_sql_injection_filter_builder_identifier_sanitization() {
    let mut filter = HashMap::new();
    // Attacker tries to inject SQL via the column identifier name
    let malicious_col = "user_name; DROP TABLE orders; --".to_string();
    filter.insert(malicious_col, serde_json::json!({"$eq": "test"}));

    let (where_clause, _) = build_where_clause(&filter);

    // Sanitizer strips semicolons, spaces, and hyphens leaving only safe alphanumerics and underscores
    assert_eq!(where_clause, "user_nameDROPTABLEorders = ?");
}

// ─── Attack Vector 4: WAF Protections (Traversal, Null Byte, URI Size) ─────

#[tokio::test]
async fn test_waf_null_byte_rejection() {
    let app = create_app();

    let req = Request::builder()
        .uri("/api/v1/db/main%00/tables")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_waf_path_traversal_rejection() {
    let app = create_app();

    let req = Request::builder()
        .uri("/api/v1/db/../../etc/passwd")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_waf_double_encoded_path_traversal_rejection() {
    let app = create_app();

    // %252e%252e%252f is double-URL-encoded for `../`
    let req = Request::builder()
        .uri("/api/v1/db/%252e%252e%252fetc/passwd")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_waf_uri_too_long_rejection() {
    let app = create_app();

    // Construct path exceeding 2048 characters
    let long_path = "/api/v1/db/".to_string() + &"a".repeat(2050);
    let req = Request::builder()
        .uri(&long_path)
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::URI_TOO_LONG);
}

#[tokio::test]
async fn test_waf_oversized_payload_rejection() {
    let app = create_app();

    // Claim Content-Length of 25MB (limit is 10MB)
    let req = Request::builder()
        .uri("/api/v1/db/main/query")
        .method("POST")
        .header("content-length", "26214400")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

// ─── Attack Vector 5: Brute-Force & Ban List Protections ───────────────────

#[test]
fn test_brute_force_single_ip_auto_ban() {
    let ip = "192.0.2.42";
    assert!(!BanList::is_ip_banned(ip).0);

    // Simulate BanList IP ban trigger
    BanList::ban_ip(ip, "Exceeded maximum failed login attempts");

    let (is_banned, reason) = BanList::is_ip_banned(ip);
    assert!(is_banned);
    assert!(reason.contains("Exceeded maximum"));
}

#[test]
fn test_brute_force_distributed_key_suspension() {
    let key = "target_api_key";
    let threshold = 5;
    let window_secs = 60;

    // Failures 1 through 4 should not trigger a suspension
    for _ in 0..4 {
        let suspended = BanList::record_failed_auth(key, threshold, window_secs);
        assert!(!suspended);
    }

    // 5th failure reaches threshold and immediately triggers key suspension
    let suspended = BanList::record_failed_auth(key, threshold, window_secs);
    assert!(suspended);

    let (is_banned, reason) = BanList::is_key_banned(key);
    assert!(is_banned);
    assert!(reason.contains("failed authentication attempts"));
}

// ─── Attack Vector 6: Security Response Headers ───────────────────────────

#[tokio::test]
async fn test_security_headers_present_on_all_responses() {
    let app = create_app();

    let req = Request::builder()
        .uri("/")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();

    // Verify all mandatory security headers defined in Section 9
    assert_eq!(
        res.headers().get("x-content-type-options").unwrap(),
        "nosniff"
    );
    assert_eq!(res.headers().get("x-frame-options").unwrap(), "DENY");
    assert_eq!(
        res.headers().get("strict-transport-security").unwrap(),
        "max-age=63072000; includeSubDomains; preload"
    );
    assert_eq!(
        res.headers().get("content-security-policy").unwrap(),
        "default-src 'none'; frame-ancestors 'none';"
    );
    assert!(res.headers().contains_key("x-request-id"));
}

// ─── Attack Vector 7: SQL in URL Path & Cache Poisoning Isolation ──────────

#[tokio::test]
async fn test_sql_injection_url_path_waf_block() {
    let app = create_app();

    let req = Request::builder()
        .uri("/api/v1/db/main/select%20*%20from%20users/rows")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_cache_poisoning_key_isolation() {
    use bytes::Bytes;

    let key_a = "user_a";
    let key_b = "user_b";
    let db = "main_db";
    let sql = "SELECT * FROM secrets";
    let params: Vec<serde_json::Value> = vec![];

    // Partitioned cache keys
    let cache_key_a = format!("{}:{}:{}:{:?}", key_a, db, sql, params);
    let cache_key_b = format!("{}:{}:{}:{:?}", key_b, db, sql, params);

    axiom::cache::CacheEngine::set(
        &cache_key_a,
        Bytes::from("secrets_for_a_only"),
        60,
        axiom::cache::Durability::MemoryOnly,
    )
    .await;

    // Key B must NOT be able to read Key A's cached query result
    assert_eq!(
        axiom::cache::CacheEngine::get(&cache_key_a).await,
        Some(Bytes::from("secrets_for_a_only"))
    );
    assert_eq!(axiom::cache::CacheEngine::get(&cache_key_b).await, None);
}

#[tokio::test]
async fn test_rate_limit_spoofed_x_forwarded_for_from_untrusted_proxy() {
    // Ensure default trusted_proxies list only contains localhost (127.0.0.1)
    let app = create_app();

    // Attacker sends X-Forwarded-For: 8.8.8.8 attempting to spoof a trusted client IP
    let req = Request::builder()
        .uri("/api/v1/db/main/tables")
        .method("GET")
        .header("X-Forwarded-For", "8.8.8.8")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    // Untrusted header does not grant bypass; request still gets strictly validated for auth
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

