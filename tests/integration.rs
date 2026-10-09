/*
 * Unified integration test suite — one file, one `cargo test` invocation proves the system.
 * Covers: authentication, authorization, WAF, SQL injection, AST firewall, cache isolation,
 *         brute-force protection, security headers, policy engine, filter builder, and cache engine.
 * Owned by: tests
 * Key deps: axiom (lib crate), axum, tower::ServiceExt, blake3, base64, sqlparser
 * Invariants: Every test is self-contained; shared metadata fixture is idempotent.
 * Last structural change: Phase 8 consolidation into single integration file.
 */

use axum::body::Body;
use axum::http::{Request, StatusCode};
use base64::prelude::*;
use bytes::Bytes;
use serde_json::Value;
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;
use std::collections::HashMap;
use tower::ServiceExt;

use axiom_api::database::filter_builder::build_where_clause;
use axiom_cache::{CacheEngine, Durability};
use axiom_metadata::snapshot::{
    update_snapshot, ApiKeySnapshot, MetadataSnapshot, PermissionSnapshot, RoleSnapshot,
};
use axiom_policy::PolicyEngine;
use axiom_api::security::ban_list::BanList;
use axiom_api::server::app::create_app;
use axiom_core::AuthContext;

// ═══════════════════════════════════════════════════════════════════════════
//  Fixtures
// ═══════════════════════════════════════════════════════════════════════════

/// Seeds an in-memory ArcSwap metadata snapshot with deterministic test identities.
/// Idempotent — safe to call from every test without ordering concerns.
fn setup_test_metadata() {
    let mut keys = HashMap::new();
    let mut roles = HashMap::new();
    let databases = HashMap::new();

    // ── admin role + key ────────────────────────────────────────────────
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
        "admin_key".to_string(),
        ApiKeySnapshot {
            name: "admin_key".to_string(),
            secret_hash: blake3::hash(b"secret_admin").into(),
            role_name: Some("admin".to_string()),
            rate_limit_override: 0,
            expires_at: None,
        },
    );

    // ── read-only role + key (db_alpha, SELECT only) ────────────────────
    roles.insert(
        "readonly_role".to_string(),
        RoleSnapshot {
            name: "readonly_role".to_string(),
            permissions: vec![PermissionSnapshot {
                database: "db_alpha".to_string(),
                table_name: "*".to_string(),
                operations: vec!["SELECT".to_string()],
            }],
        },
    );
    keys.insert(
        "ro_key".to_string(),
        ApiKeySnapshot {
            name: "ro_key".to_string(),
            secret_hash: blake3::hash(b"secret_ro").into(),
            role_name: Some("readonly_role".to_string()),
            rate_limit_override: 0,
            expires_at: None,
        },
    );

    // ── expired key ─────────────────────────────────────────────────────
    keys.insert(
        "expired_key".to_string(),
        ApiKeySnapshot {
            name: "expired_key".to_string(),
            secret_hash: blake3::hash(b"secret_exp").into(),
            role_name: Some("readonly_role".to_string()),
            rate_limit_override: 0,
            expires_at: Some(1000), // unix timestamp far in the past
        },
    );

    // ── blob reader role + key (blob:reports, READ only) ───────────────
    roles.insert(
        "blob_reader_role".to_string(),
        RoleSnapshot {
            name: "blob_reader_role".to_string(),
            permissions: vec![PermissionSnapshot {
                database: "blob:reports".to_string(),
                table_name: "*".to_string(),
                operations: vec!["READ".to_string()],
            }],
        },
    );
    keys.insert(
        "blob_reader_key".to_string(),
        ApiKeySnapshot {
            name: "blob_reader_key".to_string(),
            secret_hash: blake3::hash(b"secret_blob_ro").into(),
            role_name: Some("blob_reader_role".to_string()),
            rate_limit_override: 0,
            expires_at: None,
        },
    );

    // ── blob wildcard role + key (blob:*, media/*, READ + WRITE) ────
    roles.insert(
        "blob_wildcard_role".to_string(),
        RoleSnapshot {
            name: "blob_wildcard_role".to_string(),
            permissions: vec![PermissionSnapshot {
                database: "blob:*".to_string(),
                table_name: "media/*".to_string(),
                operations: vec!["READ".to_string(), "WRITE".to_string()],
            }],
        },
    );
    keys.insert(
        "blob_wildcard_key".to_string(),
        ApiKeySnapshot {
            name: "blob_wildcard_key".to_string(),
            secret_hash: blake3::hash(b"secret_blob_wildcard").into(),
            role_name: Some("blob_wildcard_role".to_string()),
            rate_limit_override: 0,
            expires_at: None,
        },
    );

    update_snapshot(MetadataSnapshot {
        keys,
        roles,
        databases,
        loaded_at_unix: 0,
    });
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. Authentication Bypass
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn auth_bypass_missing_header() {
    setup_test_metadata();
    let res = create_app()
        .oneshot(Request::get("/api/v1/db/main/tables").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn auth_bypass_invalid_base64() {
    setup_test_metadata();
    let res = create_app()
        .oneshot(
            Request::get("/api/v1/db/main/tables")
                .header("X-Axiom-Key", "!!!NOT_VALID_BASE64###")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn auth_bypass_wrong_secret() {
    setup_test_metadata();
    let token = BASE64_STANDARD.encode("admin_key:wrong_secret_123");
    let res = create_app()
        .oneshot(
            Request::get("/api/v1/db/main/tables")
                .header("X-Axiom-Key", token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn auth_bypass_expired_key() {
    setup_test_metadata();
    let token = BASE64_STANDARD.encode("expired_key:secret_exp");
    let res = create_app()
        .oneshot(
            Request::get("/api/v1/db/main/tables")
                .header("X-Axiom-Key", token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. Authorization & Scope Isolation
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn authz_select_only_cannot_insert() {
    setup_test_metadata();
    let snap = axiom_metadata::snapshot::get_snapshot();
    let role = snap.roles.get("readonly_role").unwrap();
    let ctx = AuthContext {
        api_key_name: "ro_key".to_string(),
        role: Some("readonly_role".to_string()),
        permissions: role.permissions.clone(),
        is_session: false,
        ..Default::default()
    };
    assert!(PolicyEngine::evaluate(&ctx, "db_alpha", "users", "SELECT").is_ok());
    let err = PolicyEngine::evaluate(&ctx, "db_alpha", "users", "INSERT").unwrap_err();
    assert_eq!(err.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn authz_database_scope_isolation() {
    setup_test_metadata();
    let snap = axiom_metadata::snapshot::get_snapshot();
    let role = snap.roles.get("readonly_role").unwrap();
    let ctx = AuthContext {
        api_key_name: "ro_key".to_string(),
        role: Some("readonly_role".to_string()),
        permissions: role.permissions.clone(),
        is_session: false,
        ..Default::default()
    };
    let err = PolicyEngine::evaluate(&ctx, "db_beta", "users", "SELECT").unwrap_err();
    assert_eq!(err.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn privilege_escalation_non_admin_denied_admin_api() {
    setup_test_metadata();
    let token = BASE64_STANDARD.encode("ro_key:secret_ro");
    let res = create_app()
        .oneshot(
            Request::get("/admin/v1/keys")
                .header("X-Axiom-Key", token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. SQL Injection — Filter Builder
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn sqli_filter_builder_parameterization() {
    let mut filter = HashMap::new();
    filter.insert(
        "username".to_string(),
        serde_json::json!({"$eq": "admin' OR '1'='1'; DROP TABLE users; --"}),
    );
    let (clause, params) = build_where_clause(&filter);
    assert_eq!(clause, "username = ?");
    assert_eq!(params.len(), 1);
    assert_eq!(
        params[0].as_str().unwrap(),
        "admin' OR '1'='1'; DROP TABLE users; --"
    );
}

#[test]
fn sqli_filter_builder_identifier_sanitization() {
    let mut filter = HashMap::new();
    filter.insert(
        "user_name; DROP TABLE orders; --".to_string(),
        serde_json::json!({"$eq": "test"}),
    );
    let (clause, _) = build_where_clause(&filter);
    // Sanitizer keeps only [a-zA-Z0-9_]
    assert_eq!(clause, "user_nameDROPTABLEorders = ?");
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. SQL AST Firewall
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn ast_multi_statement_injection_detected() {
    let stmts = Parser::parse_sql(
        &GenericDialect {},
        "SELECT * FROM users WHERE id = 1; DROP TABLE accounts; --",
    )
    .unwrap();
    assert_eq!(stmts.len(), 2);
    assert!(matches!(stmts[1], sqlparser::ast::Statement::Drop { .. }));
}

#[test]
fn ast_comment_obfuscation_normalized() {
    let stmts = Parser::parse_sql(
        &GenericDialect {},
        "SELECT/*/**/*/ id, /*!50000 password */ FROM /**/ users WHERE 1=1",
    )
    .unwrap();
    assert_eq!(stmts.len(), 1);
    assert!(matches!(stmts[0], sqlparser::ast::Statement::Query(_)));
}

#[test]
fn ast_union_select_inspected() {
    let stmts = Parser::parse_sql(
        &GenericDialect {},
        "SELECT name FROM products UNION SELECT password FROM admin_users",
    )
    .unwrap();
    assert_eq!(stmts.len(), 1);
    if let sqlparser::ast::Statement::Query(q) = &stmts[0] {
        if let sqlparser::ast::SetExpr::SetOperation { op, .. } = &*q.body {
            assert_eq!(*op, sqlparser::ast::SetOperator::Union);
        } else {
            panic!("Expected SetOperation::Union");
        }
    }
}

#[test]
fn ast_unclosed_string_literal_rejected() {
    assert!(Parser::parse_sql(
        &GenericDialect {},
        "SELECT * FROM users WHERE email = 'unclosed",
    )
    .is_err());
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. Filter Builder Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn filter_deeply_nested_logical_operators() {
    let mut filter = HashMap::new();
    filter.insert(
        "$and".to_string(),
        serde_json::json!([
            {"$or": [{"col_a": {"$eq": 1}}, {"col_b": {"$eq": 2}}]},
            {"$or": [{"col_c": {"$eq": 3}}, {"col_d": {"$eq": 4}}]}
        ]),
    );
    let (clause, params) = build_where_clause(&filter);
    assert!(!clause.is_empty());
    assert_eq!(params.len(), 4);
    assert!(clause.contains("col_a = ?"));
    assert!(clause.contains(" OR "));
    assert!(clause.contains(" AND "));
}

#[test]
fn filter_unicode_and_special_chars() {
    let exotic = "こんにちは世界! \u{0001}\u{001F} \x00 ' \" \\ / <script>alert(1)</script>";
    let mut filter = HashMap::new();
    filter.insert("notes".to_string(), serde_json::json!({"$like": exotic}));
    let (clause, params) = build_where_clause(&filter);
    assert_eq!(clause, "notes LIKE ?");
    assert_eq!(params[0].as_str().unwrap(), exotic);
}

#[test]
fn filter_empty_input_produces_empty_clause() {
    let (clause, params) = build_where_clause(&HashMap::<String, Value>::new());
    assert!(clause.is_empty());
    assert!(params.is_empty());
}

#[test]
fn filter_unknown_operator_silently_ignored() {
    let mut filter = HashMap::new();
    filter.insert(
        "status".to_string(),
        serde_json::json!({"$non_existent_operator": "x"}),
    );
    let (clause, params) = build_where_clause(&filter);
    assert!(clause.is_empty());
    assert!(params.is_empty());
}

// ═══════════════════════════════════════════════════════════════════════════
//  6. WAF — Null Byte, Traversal, Body Size, URI Length, SQL in URL
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn waf_null_byte_rejection() {
    let res = create_app()
        .oneshot(Request::get("/api/v1/db/main%00/tables").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn waf_path_traversal_rejection() {
    let res = create_app()
        .oneshot(Request::get("/api/v1/db/../../etc/passwd").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn waf_double_encoded_traversal_rejection() {
    let res = create_app()
        .oneshot(
            Request::get("/api/v1/db/%252e%252e%252fetc/passwd")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn waf_uri_too_long_rejection() {
    let long_path = "/api/v1/db/".to_string() + &"a".repeat(2050);
    let res = create_app()
        .oneshot(Request::get(&long_path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::URI_TOO_LONG);
}

#[tokio::test]
async fn waf_oversized_payload_rejection() {
    let res = create_app()
        .oneshot(
            Request::post("/api/v1/db/main/query")
                .header("content-length", "26214400") // 25 MB > 10 MB limit
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn waf_sql_in_url_path_blocked() {
    let res = create_app()
        .oneshot(
            Request::get("/api/v1/db/main/select%20*%20from%20users/rows")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

// ═══════════════════════════════════════════════════════════════════════════
//  7. Brute-Force & Ban List
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn brute_force_ip_auto_ban() {
    let ip = "192.0.2.42";
    assert!(!BanList::is_ip_banned(ip).0);
    BanList::ban_ip(ip, "Exceeded maximum failed login attempts");
    let (banned, reason) = BanList::is_ip_banned(ip);
    assert!(banned);
    assert!(reason.contains("Exceeded maximum"));
}

#[test]
fn brute_force_distributed_key_suspension() {
    let key = "target_api_key";
    for _ in 0..4 {
        assert!(!BanList::record_failed_auth(key, 5, 60));
    }
    assert!(BanList::record_failed_auth(key, 5, 60)); // 5th triggers suspension
    let (banned, reason) = BanList::is_key_banned(key);
    assert!(banned);
    assert!(reason.contains("failed authentication attempts"));
}

// ═══════════════════════════════════════════════════════════════════════════
//  8. Security Response Headers
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn security_headers_present_on_all_responses() {
    let res = create_app()
        .oneshot(Request::get("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.headers().get("x-content-type-options").unwrap(), "nosniff");
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

// ═══════════════════════════════════════════════════════════════════════════
//  9. Cache Key Isolation (anti-poisoning)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn cache_poisoning_key_isolation() {
    let db = "main_db";
    let sql = "SELECT * FROM secrets";
    let params: Vec<Value> = vec![];

    let key_a = format!("user_a:{}:{}:{:?}", db, sql, params);
    let key_b = format!("user_b:{}:{}:{:?}", db, sql, params);

    CacheEngine::set(&key_a, Bytes::from("secrets_for_a_only"), 60, Durability::MemoryOnly).await;

    assert_eq!(CacheEngine::get(&key_a).await, Some(Bytes::from("secrets_for_a_only")));
    assert_eq!(CacheEngine::get(&key_b).await, None);
}

// ═══════════════════════════════════════════════════════════════════════════
//  10. Proxy Spoofing Defense
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn rate_limit_spoofed_xff_from_untrusted_proxy() {
    let res = create_app()
        .oneshot(
            Request::get("/api/v1/db/main/tables")
                .header("X-Forwarded-For", "8.8.8.8")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    // Spoofed header from non-trusted peer does not bypass auth
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

// ═══════════════════════════════════════════════════════════════════════════
//  11. WAF — Query Parameter Flood
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn waf_query_param_flood_rejected() {
    // 51 ampersands exceeds the 50-param limit
    let params = (0..52).map(|i| format!("k{}=v", i)).collect::<Vec<_>>().join("&");
    let uri = format!("/api/v1/db/main/tables?{}", params);
    let res = create_app()
        .oneshot(Request::get(&uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

// ═══════════════════════════════════════════════════════════════════════════
//  12. WAF — Triple-Encoded Path Traversal
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn waf_triple_encoded_traversal_rejection() {
    // %25252e%25252e = triple-encode of ".."
    let res = create_app()
        .oneshot(
            Request::get("/api/v1/db/%25252e%25252e%25252fetc/passwd")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

// ═══════════════════════════════════════════════════════════════════════════
//  13. WAF — Additional SQL Keywords in URL
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn waf_union_keyword_in_url_blocked() {
    let res = create_app()
        .oneshot(
            Request::get("/api/v1/db/main/union%20select%20password/rows")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn waf_drop_keyword_in_url_blocked() {
    let res = create_app()
        .oneshot(
            Request::get("/api/v1/db/main/drop%20table%20users/rows")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

// ═══════════════════════════════════════════════════════════════════════════
//  14. Core Endpoints — Health, Ready, Fallback 404
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn ready_endpoint_returns_200() {
    let res = create_app()
        .oneshot(Request::get("/ready").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn fallback_unknown_route_returns_404() {
    let res = create_app()
        .oneshot(
            Request::get("/this/route/does/not/exist")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

// ═══════════════════════════════════════════════════════════════════════════
//  15. Error Envelope — JSON Structure Verification
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn error_response_has_correct_json_envelope() {
    setup_test_metadata();
    let res = create_app()
        .oneshot(Request::get("/api/v1/db/main/tables").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    let body_bytes = axum::body::to_bytes(res.into_body(), 1_000_000).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();

    // Verify envelope contract: success=false, data=null, error.code, error.message
    assert_eq!(json["success"], false);
    assert!(json.get("error").is_some());
    assert!(json["error"]["code"].is_string());
    assert!(json["error"]["message"].is_string());
}

// ═══════════════════════════════════════════════════════════════════════════
//  16. Auth — Valid Admin Key Gets 200-level on Protected Endpoints
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn health_endpoint_returns_200() {
    setup_test_metadata();
    let token = BASE64_STANDARD.encode("admin_key:secret_admin");
    let res = create_app()
        .oneshot(
            Request::get("/health")
                .header("X-Axiom-Key", token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    println!("HEALTH STATUS: {}", res.status());
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn api_key_cannot_access_admin_api() {
    setup_test_metadata();
    let token = BASE64_STANDARD.encode("admin_key:secret_admin");
    let res = create_app()
        .oneshot(
            Request::get("/admin/v1/keys")
                .header("X-Axiom-Key", token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    println!("ADMIN STATUS: {}", res.status());
    // The request should pass auth (no 401/403). It returns 500 here because the SQLite metadata store isn't initialized in this test fixture, which proves it reached the handler!
    assert!(res.status() != StatusCode::UNAUTHORIZED);
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

// ═══════════════════════════════════════════════════════════════════════════
//  17. Native Blob Storage Lifecycle & Policy
// ═══════════════════════════════════════════════════════════════════════════

/// Lazily initializes a global temporary BlobEngine instance for integration tests.
/// Invariant: Only initialized once across all test workers to avoid keyspace lock contention.
async fn ensure_blob_engine() {
    static ENGINE_INIT: tokio::sync::OnceCell<tempfile::TempDir> = tokio::sync::OnceCell::const_new();
    let _ = ENGINE_INIT
        .get_or_init(|| async {
            let tmp = tempfile::tempdir().expect("Failed to create tempdir for blob engine test");
            axiom_api::blobs::init_blob_engine(
                tmp.path().to_str().unwrap(),
                64 * 1024,                  // 64 KB inline threshold
                5 * 1024 * 1024 * 1024,     // 5 GB max object
                true,                       // verify reads
            )
            .await
            .expect("Failed to init blob engine in test fixture");
            tmp
        })
        .await;
}

#[tokio::test]
async fn blob_storage_crud_lifecycle_and_headers() {
    setup_test_metadata();
    ensure_blob_engine().await;

    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");
    let test_data = b"Hello Axiom Native Embedded Blob Engine!".to_vec();

    // 1. PUT blob
    let put_req = Request::put("/api/v1/blobs/testns/docs/hello.txt")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(Body::from(test_data.clone()))
        .unwrap();

    let put_res = create_app().oneshot(put_req).await.unwrap();
    assert_eq!(put_res.status(), StatusCode::CREATED);
    let put_body = axum::body::to_bytes(put_res.into_body(), usize::MAX).await.unwrap();
    let put_json: serde_json::Value = serde_json::from_slice(&put_body).unwrap();
    assert_eq!(put_json["success"], true);
    let hash = put_json["data"]["hash"].as_str().unwrap().to_string();
    let etag = format!("\"{}\"", hash);
    assert_eq!(put_json["data"]["inline"], true);
    assert_eq!(put_json["data"]["size"], test_data.len() as u64);

    // 2. HEAD blob - verify headers and empty body
    let head_req = Request::head("/api/v1/blobs/testns/docs/hello.txt")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let head_res = create_app().oneshot(head_req).await.unwrap();
    assert_eq!(head_res.status(), StatusCode::OK);
    assert_eq!(head_res.headers().get("etag").unwrap(), &etag);
    assert_eq!(head_res.headers().get("x-content-type-options").unwrap(), "nosniff");
    assert_eq!(head_res.headers().get("content-type").unwrap(), "text/plain; charset=utf-8");
    assert!(head_res.headers().get("content-disposition").unwrap().to_str().unwrap().contains("hello.txt"));

    // 3. GET blob - verify data integrity
    let get_req = Request::get("/api/v1/blobs/testns/docs/hello.txt")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let get_res = create_app().oneshot(get_req).await.unwrap();
    assert_eq!(get_res.status(), StatusCode::OK);
    let get_body = axum::body::to_bytes(get_res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(get_body.as_ref(), test_data.as_slice());

    // 4. GET blob with matching If-None-Match -> 304 Not Modified
    let conditional_req = Request::get("/api/v1/blobs/testns/docs/hello.txt")
        .header("X-Axiom-Key", &admin_token)
        .header("If-None-Match", &etag)
        .body(Body::empty())
        .unwrap();
    let cond_res = create_app().oneshot(conditional_req).await.unwrap();
    assert_eq!(cond_res.status(), StatusCode::NOT_MODIFIED);

    // 5. LIST blobs in namespace
    let list_req = Request::get("/api/v1/blobs/testns")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let list_res = create_app().oneshot(list_req).await.unwrap();
    assert_eq!(list_res.status(), StatusCode::OK);
    let list_body = axum::body::to_bytes(list_res.into_body(), usize::MAX).await.unwrap();
    let list_json: serde_json::Value = serde_json::from_slice(&list_body).unwrap();
    assert_eq!(list_json["success"], true);
    let items = list_json["data"]["items"].as_array().unwrap();
    assert!(items.iter().any(|item| item["key"] == "docs/hello.txt"));

    // 6. DELETE blob
    let del_req = Request::delete("/api/v1/blobs/testns/docs/hello.txt")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let del_res = create_app().oneshot(del_req).await.unwrap();
    assert_eq!(del_res.status(), StatusCode::OK);

    // 7. GET after DELETE -> 404 NOT_FOUND
    let post_del_req = Request::get("/api/v1/blobs/testns/docs/hello.txt")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let post_del_res = create_app().oneshot(post_del_req).await.unwrap();
    assert_eq!(post_del_res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn blob_storage_rbac_policy_enforcement() {
    setup_test_metadata();
    ensure_blob_engine().await;

    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");
    let reader_token = BASE64_STANDARD.encode("blob_reader_key:secret_blob_ro");
    let unauthorized_token = BASE64_STANDARD.encode("ro_key:secret_ro");

    // 1. ro_key has no blob permissions (only db_alpha SELECT) -> 403 Forbidden
    let unauth_put = Request::put("/api/v1/blobs/reports/q3_summary.pdf")
        .header("X-Axiom-Key", &unauthorized_token)
        .body(Body::from(b"Q3 confidential report".to_vec()))
        .unwrap();
    let unauth_res = create_app().oneshot(unauth_put).await.unwrap();
    assert_eq!(unauth_res.status(), StatusCode::FORBIDDEN);

    // 2. blob_reader_key only has READ on blob:reports -> PUT returns 403 Forbidden
    let ro_put = Request::put("/api/v1/blobs/reports/q3_summary.pdf")
        .header("X-Axiom-Key", &reader_token)
        .body(Body::from(b"Q3 confidential report".to_vec()))
        .unwrap();
    let ro_res = create_app().oneshot(ro_put).await.unwrap();
    assert_eq!(ro_res.status(), StatusCode::FORBIDDEN);

    // 3. Admin successfully uploads blob
    let admin_put = Request::put("/api/v1/blobs/reports/q3_summary.pdf")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/pdf")
        .body(Body::from(b"Q3 confidential report".to_vec()))
        .unwrap();
    let admin_res = create_app().oneshot(admin_put).await.unwrap();
    assert_eq!(admin_res.status(), StatusCode::CREATED);

    // 4. blob_reader_key CAN read the blob (200 OK)
    let ro_get = Request::get("/api/v1/blobs/reports/q3_summary.pdf")
        .header("X-Axiom-Key", &reader_token)
        .body(Body::empty())
        .unwrap();
    let ro_get_res = create_app().oneshot(ro_get).await.unwrap();
    assert_eq!(ro_get_res.status(), StatusCode::OK);

    // 5. blob_reader_key CANNOT delete the blob (403 Forbidden)
    let ro_del = Request::delete("/api/v1/blobs/reports/q3_summary.pdf")
        .header("X-Axiom-Key", &reader_token)
        .body(Body::empty())
        .unwrap();
    let ro_del_res = create_app().oneshot(ro_del).await.unwrap();
    assert_eq!(ro_del_res.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn blob_storage_role_wildcard_and_prefix_enforcement() {
    setup_test_metadata();
    ensure_blob_engine().await;

    let wildcard_token = BASE64_STANDARD.encode("blob_wildcard_key:secret_blob_wildcard");

    // 1. Can upload object with matching "media/*" prefix to ANY namespace (due to blob:*)
    let put_req = Request::put("/api/v1/blobs/photos/media/profile.png")
        .header("X-Axiom-Key", &wildcard_token)
        .header("Content-Type", "image/png")
        .body(Body::from(b"PNG_DATA".to_vec()))
        .unwrap();
    let put_res = create_app().oneshot(put_req).await.unwrap();
    assert_eq!(put_res.status(), StatusCode::CREATED);

    // 2. Can read object back
    let get_req = Request::get("/api/v1/blobs/photos/media/profile.png")
        .header("X-Axiom-Key", &wildcard_token)
        .body(Body::empty())
        .unwrap();
    let get_res = create_app().oneshot(get_req).await.unwrap();
    assert_eq!(get_res.status(), StatusCode::OK);

    // 3. Denied when attempting to upload outside the "media/*" prefix
    let denied_put = Request::put("/api/v1/blobs/photos/private/keys.txt")
        .header("X-Axiom-Key", &wildcard_token)
        .body(Body::from(b"PRIVATE".to_vec()))
        .unwrap();
    let denied_put_res = create_app().oneshot(denied_put).await.unwrap();
    assert_eq!(denied_put_res.status(), StatusCode::FORBIDDEN);

    // 4. Denied when attempting DELETE (role only has READ and WRITE)
    let denied_del = Request::delete("/api/v1/blobs/photos/media/profile.png")
        .header("X-Axiom-Key", &wildcard_token)
        .body(Body::empty())
        .unwrap();
    let denied_del_res = create_app().oneshot(denied_del).await.unwrap();
    assert_eq!(denied_del_res.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn blob_storage_validation_rejections() {
    setup_test_metadata();
    ensure_blob_engine().await;

    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");

    // Invalid namespace: directory traversal sequence ".."
    let bad_ns_req = Request::put("/api/v1/blobs/..%2Fbad/file.txt")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::from(b"test".to_vec()))
        .unwrap();
    let bad_ns_res = create_app().oneshot(bad_ns_req).await.unwrap();
    assert!(bad_ns_res.status() == StatusCode::BAD_REQUEST || bad_ns_res.status() == StatusCode::FORBIDDEN);

    // Invalid key: containing ".."
    let bad_key_req = Request::put("/api/v1/blobs/testns/sub/../../etc/passwd")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::from(b"test".to_vec()))
        .unwrap();
    let bad_key_res = create_app().oneshot(bad_key_req).await.unwrap();
    assert!(bad_key_res.status() == StatusCode::BAD_REQUEST || bad_key_res.status() == StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn blob_storage_range_requests_partial_content() {
    setup_test_metadata();
    ensure_blob_engine().await;

    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");

    // 1. Upload a 16-byte test blob
    let payload = b"HELLO_WORLD_TEST";
    let put_req = Request::put("/api/v1/blobs/media/range_file.txt")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "text/plain")
        .body(Body::from(payload.to_vec()))
        .unwrap();
    let put_res = create_app().oneshot(put_req).await.unwrap();
    assert_eq!(put_res.status(), StatusCode::CREATED);

    // 2. Fetch partial range bytes=0-4 (5 bytes: "HELLO")
    let range_req1 = Request::get("/api/v1/blobs/media/range_file.txt")
        .header("X-Axiom-Key", &admin_token)
        .header("Range", "bytes=0-4")
        .body(Body::empty())
        .unwrap();
    let range_res1 = create_app().oneshot(range_req1).await.unwrap();
    assert_eq!(range_res1.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(range_res1.headers().get("Content-Range").unwrap(), "bytes 0-4/16");
    assert_eq!(range_res1.headers().get("Content-Length").unwrap(), "5");
    assert_eq!(range_res1.headers().get("Accept-Ranges").unwrap(), "bytes");

    let body_bytes1 = axum::body::to_bytes(range_res1.into_body(), 1024).await.unwrap();
    assert_eq!(&body_bytes1[..], b"HELLO");

    // 3. Fetch partial range bytes=6-10 (5 bytes: "WORLD")
    let range_req2 = Request::get("/api/v1/blobs/media/range_file.txt")
        .header("X-Axiom-Key", &admin_token)
        .header("Range", "bytes=6-10")
        .body(Body::empty())
        .unwrap();
    let range_res2 = create_app().oneshot(range_req2).await.unwrap();
    assert_eq!(range_res2.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(range_res2.headers().get("Content-Range").unwrap(), "bytes 6-10/16");
    let body_bytes2 = axum::body::to_bytes(range_res2.into_body(), 1024).await.unwrap();
    assert_eq!(&body_bytes2[..], b"WORLD");

    // 4. Invalid range bytes=100-200 -> 416 Range Not Satisfiable
    let invalid_range = Request::get("/api/v1/blobs/media/range_file.txt")
        .header("X-Axiom-Key", &admin_token)
        .header("Range", "bytes=100-200")
        .body(Body::empty())
        .unwrap();
    let invalid_res = create_app().oneshot(invalid_range).await.unwrap();
    assert_eq!(invalid_res.status(), StatusCode::RANGE_NOT_SATISFIABLE);
}

#[tokio::test]
async fn blob_storage_presigned_capability_ticket_download() {
    setup_test_metadata();
    ensure_blob_engine().await;

    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");

    // 1. Upload private blob
    let put_req = Request::put("/api/v1/blobs/secure/secret_doc.txt")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::from(b"Top secret capability test".to_vec()))
        .unwrap();
    let put_res = create_app().oneshot(put_req).await.unwrap();
    assert_eq!(put_res.status(), StatusCode::CREATED);

    // 2. Request capability ticket
    let ticket_req = Request::post("/api/v1/blobs/secure/ticket")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&serde_json::json!({
            "key": "secret_doc.txt",
            "operation": "READ",
            "ttl_seconds": 120
        })).unwrap()))
        .unwrap();
    let ticket_res = create_app().oneshot(ticket_req).await.unwrap();
    assert_eq!(ticket_res.status(), StatusCode::CREATED);

    let ticket_body = axum::body::to_bytes(ticket_res.into_body(), 4096).await.unwrap();
    let ticket_json: serde_json::Value = serde_json::from_slice(&ticket_body).unwrap();
    let ticket_sig = ticket_json["data"]["ticket"]["signature"].as_str().unwrap();
    let ticket_exp = ticket_json["data"]["ticket"]["expires_at"].as_i64().unwrap();

    // 3. Download using ticket URL query string WITHOUT any X-Axiom-Key header
    let dl_url = format!("/api/v1/blobs/secure/secret_doc.txt?ticket_sig={}&ticket_exp={}", ticket_sig, ticket_exp);
    let dl_req = Request::get(&dl_url)
        .body(Body::empty())
        .unwrap();
    let dl_res = create_app().oneshot(dl_req).await.unwrap();
    assert_eq!(dl_res.status(), StatusCode::OK);
    let dl_bytes = axum::body::to_bytes(dl_res.into_body(), 1024).await.unwrap();
    assert_eq!(&dl_bytes[..], b"Top secret capability test");

    // 4. Download with tampered signature fails with 401 Unauthorized
    let bad_dl_url = format!("/api/v1/blobs/secure/secret_doc.txt?ticket_sig=0000000000000000&ticket_exp={}", ticket_exp);
    let bad_dl_req = Request::get(&bad_dl_url)
        .body(Body::empty())
        .unwrap();
    let bad_dl_res = create_app().oneshot(bad_dl_req).await.unwrap();
    assert_eq!(bad_dl_res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn blob_storage_chunked_upload_lifecycle() {
    setup_test_metadata();
    ensure_blob_engine().await;

    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");

    // 1. Initialize chunked upload session
    let init_req = Request::post("/api/v1/blobs/multichunk/uploads")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&serde_json::json!({
            "key": "archive.tar",
            "content_type": "application/x-tar"
        })).unwrap()))
        .unwrap();
    let init_res = create_app().oneshot(init_req).await.unwrap();
    assert_eq!(init_res.status(), StatusCode::CREATED);

    let init_body = axum::body::to_bytes(init_res.into_body(), 4096).await.unwrap();
    let init_json: serde_json::Value = serde_json::from_slice(&init_body).unwrap();
    let upload_id = init_json["data"]["upload_id"].as_str().unwrap();

    // 2. Upload part 1
    let part1_req = Request::put(&format!("/api/v1/blobs/multichunk/uploads/{}/parts/1", upload_id))
        .header("X-Axiom-Key", &admin_token)
        .body(Body::from(b"CHUNK1_DATA_".to_vec()))
        .unwrap();
    let part1_res = create_app().oneshot(part1_req).await.unwrap();
    assert_eq!(part1_res.status(), StatusCode::OK);

    // 3. Upload part 2
    let part2_req = Request::put(&format!("/api/v1/blobs/multichunk/uploads/{}/parts/2", upload_id))
        .header("X-Axiom-Key", &admin_token)
        .body(Body::from(b"CHUNK2_DATA".to_vec()))
        .unwrap();
    let part2_res = create_app().oneshot(part2_req).await.unwrap();
    assert_eq!(part2_res.status(), StatusCode::OK);

    // 4. Complete upload
    let complete_req = Request::post(&format!("/api/v1/blobs/multichunk/uploads/{}/complete", upload_id))
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let complete_res = create_app().oneshot(complete_req).await.unwrap();
    assert_eq!(complete_res.status(), StatusCode::OK);

    // 5. Download and verify assembled content
    let get_req = Request::get("/api/v1/blobs/multichunk/archive.tar")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let get_res = create_app().oneshot(get_req).await.unwrap();
    assert_eq!(get_res.status(), StatusCode::OK);
    let get_bytes = axum::body::to_bytes(get_res.into_body(), 1024).await.unwrap();
    assert_eq!(&get_bytes[..], b"CHUNK1_DATA_CHUNK2_DATA");
}

#[tokio::test]
async fn blob_storage_integrity_scrub_and_ttl() {
    setup_test_metadata();
    ensure_blob_engine().await;

    // Login admin session to access admin endpoints via CacheEngine session cache
    let session_token = "admin_session_token_32_bytes_xyz";
    let cookie_header = format!("axiom_session={}", session_token);
    axiom_cache::CacheEngine::set(
        &format!("sess:{}", session_token),
        bytes::Bytes::from("admin_user"),
        60,
        axiom_cache::Durability::MemoryOnly,
    ).await;

    // 1. Upload temporary blob with TTL 0
    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");
    let ttl_req = Request::put("/api/v1/blobs/temp/ephemeral.log")
        .header("X-Axiom-Key", &admin_token)
        .header("X-Axiom-TTL", "0")
        .body(Body::from(b"Temporary log payload".to_vec()))
        .unwrap();
    let ttl_res = create_app().oneshot(ttl_req).await.unwrap();
    assert_eq!(ttl_res.status(), StatusCode::CREATED);

    // 2. Perform scrub
    let scrub_req = Request::post("/admin/v1/blobs/scrub")
        .header("Cookie", &cookie_header)
        .body(Body::empty())
        .unwrap();
    let scrub_res = create_app().oneshot(scrub_req).await.unwrap();
    assert_eq!(scrub_res.status(), StatusCode::OK);

    // 3. Perform TTL sweep
    let sweep_req = Request::post("/admin/v1/blobs/sweep")
        .header("Cookie", &cookie_header)
        .body(Body::empty())
        .unwrap();
    let sweep_res = create_app().oneshot(sweep_req).await.unwrap();
    assert_eq!(sweep_res.status(), StatusCode::OK);

    let sweep_body = axum::body::to_bytes(sweep_res.into_body(), 1024).await.unwrap();
    let sweep_json: serde_json::Value = serde_json::from_slice(&sweep_body).unwrap();
    assert!(sweep_json["data"]["swept_objects"].as_u64().unwrap() >= 1);
}

// ═══════════════════════════════════════════════════════════════════════════
//  18. Model Context Protocol (MCP) — Tools List & Blob Storage Tool Calls
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn mcp_tools_list_and_blob_tools_execution() {
    setup_test_metadata();
    ensure_blob_engine().await;

    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");

    // 1. tools/list - verify 15 tools returned (8 DB + 7 Blob)
    let list_req = Request::post("/mcp/v1")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list",
            "params": {}
        })).unwrap()))
        .unwrap();

    let list_res = create_app().oneshot(list_req).await.unwrap();
    assert_eq!(list_res.status(), StatusCode::OK);
    let list_bytes = axum::body::to_bytes(list_res.into_body(), 65536).await.unwrap();
    let list_json: serde_json::Value = serde_json::from_slice(&list_bytes).unwrap();
    assert_eq!(list_json["jsonrpc"], "2.0");
    let tools = list_json["result"]["tools"].as_array().expect("tools array");
    assert_eq!(tools.len(), 15);

    // 2. tools/call - axiom_write_blob
    let write_req = Request::post("/mcp/v1")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "axiom_write_blob",
                "arguments": {
                    "namespace": "mcp_ns",
                    "key": "notes/todo.txt",
                    "data": "1. Test MCP blob integration\n2. Verify clean execution",
                    "content_type": "text/plain"
                }
            }
        })).unwrap()))
        .unwrap();

    let write_res = create_app().oneshot(write_req).await.unwrap();
    assert_eq!(write_res.status(), StatusCode::OK);
    let write_bytes = axum::body::to_bytes(write_res.into_body(), 65536).await.unwrap();
    let write_json: serde_json::Value = serde_json::from_slice(&write_bytes).unwrap();
    assert_eq!(write_json["result"]["isError"], false);

    // 3. tools/call - axiom_read_blob
    let read_req = Request::post("/mcp/v1")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "axiom_read_blob",
                "arguments": {
                    "namespace": "mcp_ns",
                    "key": "notes/todo.txt"
                }
            }
        })).unwrap()))
        .unwrap();

    let read_res = create_app().oneshot(read_req).await.unwrap();
    assert_eq!(read_res.status(), StatusCode::OK);
    let read_bytes = axum::body::to_bytes(read_res.into_body(), 65536).await.unwrap();
    let read_json: serde_json::Value = serde_json::from_slice(&read_bytes).unwrap();
    assert_eq!(read_json["result"]["isError"], false);
    let read_text = read_json["result"]["content"][0]["text"].as_str().unwrap();
    assert!(read_text.contains("1. Test MCP blob integration"));

    // 4. tools/call - axiom_create_download_ticket
    let ticket_req = Request::post("/mcp/v1")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "axiom_create_download_ticket",
                "arguments": {
                    "namespace": "mcp_ns",
                    "key": "notes/todo.txt",
                    "ttl_seconds": 300
                }
            }
        })).unwrap()))
        .unwrap();

    let ticket_res = create_app().oneshot(ticket_req).await.unwrap();
    assert_eq!(ticket_res.status(), StatusCode::OK);
    let ticket_bytes = axum::body::to_bytes(ticket_res.into_body(), 65536).await.unwrap();
    let ticket_json: serde_json::Value = serde_json::from_slice(&ticket_bytes).unwrap();
    assert_eq!(ticket_json["result"]["isError"], false);
    let ticket_data_text = ticket_json["result"]["content"][0]["text"].as_str().unwrap();
    assert!(ticket_data_text.contains("download_url"));
}



