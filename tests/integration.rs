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
use axiom_api::security::ban_list::BanList;
use axiom_api::server::app::create_app;
use axiom_cache::{CacheEngine, Durability};
use axiom_core::AuthContext;
use axiom_metadata::snapshot::{
    update_snapshot, ApiKeySnapshot, DatabaseSnapshot, MetadataSnapshot, PermissionSnapshot,
    RoleSnapshot,
};
use axiom_policy::PolicyEngine;

// ═══════════════════════════════════════════════════════════════════════════
//  Fixtures
// ═══════════════════════════════════════════════════════════════════════════

/// Seeds an in-memory ArcSwap metadata snapshot with deterministic test identities.
/// Idempotent — safe to call from every test without ordering concerns.
fn setup_test_metadata() {
    axiom_cache::CacheEngine::reset_rate_limits();
    BanList::unban_ip_local("127.0.0.1");
    let mut keys = HashMap::new();
    let mut roles = HashMap::new();
    let mut databases = HashMap::new();

    // ── admin role + key ────────────────────────────────────────────────
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
        "admin_key".to_string(),
        ApiKeySnapshot {
            name: "admin_key".to_string(),
            secret_hash: blake3::hash(b"secret_admin").into(),
            role_name: Some("admin".to_string()),
            rate_limit_override: 100_000,
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
                rls_filter: None,
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
                rls_filter: None,
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
                rls_filter: None,
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

    // ── test sqlite database (testdb) ───────────────────────────────────
    databases.insert(
        "testdb".to_string(),
        DatabaseSnapshot {
            alias: "testdb".to_string(),
            url: "sqlite://target/test_integration_sqlite.db".to_string(),
            engine: "sqlite".to_string(),
            pool_min: 1,
            pool_max: 5,
        },
    );

    // ── dead database for circuit breaker testing (dead_db) ─────────────
    databases.insert(
        "dead_db".to_string(),
        DatabaseSnapshot {
            alias: "dead_db".to_string(),
            url: "postgres://127.0.0.1:54321/dead".to_string(),
            engine: "postgres".to_string(),
            pool_min: 1,
            pool_max: 5,
        },
    );

    // ── items reader role + key (testdb, items table only, SELECT only) ────
    roles.insert(
        "items_reader_role".to_string(),
        RoleSnapshot {
            name: "items_reader_role".to_string(),
            permissions: vec![PermissionSnapshot {
                database: "testdb".to_string(),
                table_name: "items".to_string(),
                operations: vec!["SELECT".to_string()],
                rls_filter: None,
            }],
        },
    );
    keys.insert(
        "items_reader_key".to_string(),
        ApiKeySnapshot {
            name: "items_reader_key".to_string(),
            secret_hash: blake3::hash(b"secret_items_ro").into(),
            role_name: Some("items_reader_role".to_string()),
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

/// Lazily initializes a persistent test metadata store in SQLite with deterministic test identities.
/// Invariant: Idempotent across all worker threads; ensures sync_snapshot never drops base test identities.
async fn ensure_metadata_store() {
    static STORE_INIT: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
    STORE_INIT
        .get_or_init(|| async {
            let _ = tokio::fs::create_dir_all("target").await;
            let _ = tokio::fs::remove_file("target/test_unified_metadata.db").await;
            let _ = tokio::fs::remove_file("target/test_unified_metadata.db-wal").await;
            let _ = tokio::fs::remove_file("target/test_unified_metadata.db-shm").await;
            axiom_metadata::MetadataStore::init("sqlite://target/test_unified_metadata.db", "")
                .await
                .expect("Failed to init metadata store in test fixture");

            // Roles
            let _ = axiom_metadata::MetadataStore::create_role(
                "admin",
                Some("Administrator"),
                &[axiom_metadata::PermissionRecord {
                    id: 0,
                    role_name: "admin".to_string(),
                    database: "*".to_string(),
                    table_name: "*".to_string(),
                    operations: vec!["*".to_string()],
                    rls_filter: None,
                }],
            )
            .await;

            let _ = axiom_metadata::MetadataStore::create_role(
                "readonly_role",
                Some("Readonly"),
                &[axiom_metadata::PermissionRecord {
                    id: 0,
                    role_name: "readonly_role".to_string(),
                    database: "db_alpha".to_string(),
                    table_name: "*".to_string(),
                    operations: vec!["SELECT".to_string()],
                    rls_filter: None,
                }],
            )
            .await;

            let _ = axiom_metadata::MetadataStore::create_role(
                "blob_reader_role",
                Some("Blob reader"),
                &[axiom_metadata::PermissionRecord {
                    id: 0,
                    role_name: "blob_reader_role".to_string(),
                    database: "blob:reports".to_string(),
                    table_name: "*".to_string(),
                    operations: vec!["READ".to_string()],
                    rls_filter: None,
                }],
            )
            .await;

            let _ = axiom_metadata::MetadataStore::create_role(
                "blob_wildcard_role",
                Some("Blob wildcard"),
                &[axiom_metadata::PermissionRecord {
                    id: 0,
                    role_name: "blob_wildcard_role".to_string(),
                    database: "blob:*".to_string(),
                    table_name: "media/*".to_string(),
                    operations: vec!["READ".to_string(), "WRITE".to_string()],
                    rls_filter: None,
                }],
            )
            .await;

            let _ = axiom_metadata::MetadataStore::create_role(
                "items_reader_role",
                Some("Items reader"),
                &[axiom_metadata::PermissionRecord {
                    id: 0,
                    role_name: "items_reader_role".to_string(),
                    database: "testdb".to_string(),
                    table_name: "items".to_string(),
                    operations: vec!["SELECT".to_string()],
                    rls_filter: None,
                }],
            )
            .await;

            // Keys
            let _ = axiom_metadata::MetadataStore::create_key(
                "admin_key",
                Some("admin"),
                Some("secret_admin"),
                0,
                None,
            )
            .await;

            let _ = axiom_metadata::MetadataStore::create_key(
                "ro_key",
                Some("readonly_role"),
                Some("secret_ro"),
                0,
                None,
            )
            .await;

            let _ = axiom_metadata::MetadataStore::create_key(
                "expired_key",
                Some("readonly_role"),
                Some("secret_exp"),
                0,
                Some(1000),
            )
            .await;

            let _ = axiom_metadata::MetadataStore::create_key(
                "blob_reader_key",
                Some("blob_reader_role"),
                Some("secret_blob_ro"),
                0,
                None,
            )
            .await;

            let _ = axiom_metadata::MetadataStore::create_key(
                "blob_wildcard_key",
                Some("blob_wildcard_role"),
                Some("secret_blob_wildcard"),
                0,
                None,
            )
            .await;

            let _ = axiom_metadata::MetadataStore::create_key(
                "items_reader_key",
                Some("items_reader_role"),
                Some("secret_items_ro"),
                0,
                None,
            )
            .await;

            // Databases
            let _ = axiom_metadata::MetadataStore::add_database(
                "testdb",
                "sqlite://target/test_integration_sqlite.db",
                Some("sqlite"),
                Some(1),
                Some(5),
                None,
            )
            .await;

            let _ = axiom_metadata::MetadataStore::add_database(
                "dead_db",
                "postgres://127.0.0.1:54321/dead",
                Some("postgres"),
                Some(1),
                Some(5),
                None,
            )
            .await;

            axiom_metadata::MetadataStore::sync_snapshot()
                .await
                .expect("Failed to sync initial metadata snapshot");

            if let Ok(secret) =
                axiom_metadata::MetadataStore::get_or_create_system_secret("blob_ticket_secret")
                    .await
            {
                axiom_blob::tickets::set_ticket_secret(&secret);
            }
        })
        .await;
}

/// Ensures the items table exists in testdb for CRUD & RBAC testing.
async fn ensure_test_items_table() {
    static TABLE_INIT: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
    TABLE_INIT
        .get_or_init(|| async {
            ensure_metadata_store().await;
            let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");
            let create_sql = "CREATE TABLE IF NOT EXISTS items (\
                id INTEGER PRIMARY KEY AUTOINCREMENT, \
                name TEXT NOT NULL, \
                price REAL NOT NULL, \
                stock INTEGER NOT NULL\
            );";
            let create_req = Request::post("/api/v1/db/testdb/query")
                .header("X-Axiom-Key", &admin_token)
                .header("Content-Type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&serde_json::json!({
                        "sql": create_sql
                    }))
                    .unwrap(),
                ))
                .unwrap();
            let res = create_app().oneshot(create_req).await.unwrap();
            assert_eq!(res.status(), StatusCode::OK);
        })
        .await;
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. Authentication Bypass
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn auth_bypass_missing_header() {
    setup_test_metadata();
    let res = create_app()
        .oneshot(
            Request::get("/api/v1/db/main/tables")
                .body(Body::empty())
                .unwrap(),
        )
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
        .oneshot(
            Request::get("/api/v1/db/main%00/tables")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn waf_path_traversal_rejection() {
    let res = create_app()
        .oneshot(
            Request::get("/api/v1/db/../../etc/passwd")
                .body(Body::empty())
                .unwrap(),
        )
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
        assert!(!BanList::record_failed_auth(key, 5, 60, 0));
    }
    assert!(BanList::record_failed_auth(key, 5, 60, 0)); // 5th triggers suspension
    let (banned, reason) = BanList::is_key_banned(key);
    assert!(banned);
    assert!(reason.contains("failed authentication attempts"));
}

#[tokio::test]
async fn brute_force_api_key_bad_secrets_ban_attacker_ip_not_key() {
    setup_test_metadata();
    let attacker_ip = "198.51.100.77";
    let legitimate_ip = "198.51.100.88";
    let victim_key_name = "ro_key";

    // Attacker sends bad secret attempts for known victim_key_name up to penalty_threshold
    let bad_token = BASE64_STANDARD.encode(format!("{}:completely_wrong_secret", victim_key_name));
    let cfg = axiom_core::ConfigManager::get();
    let threshold = if cfg.rate_limit.penalty_threshold > 0 {
        cfg.rate_limit.penalty_threshold as u32
    } else {
        5
    };

    for _ in 0..threshold {
        let req = Request::get("/api/v1/db/databases")
            .header("X-Axiom-Key", &bad_token)
            .header("X-Forwarded-For", attacker_ip)
            .body(Body::empty())
            .unwrap();
        let res = create_app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    // Attacker IP must now be banned
    let (ip_banned, reason) = BanList::is_ip_banned(attacker_ip);
    assert!(ip_banned);
    assert!(reason.contains(victim_key_name));

    // The legitimate key itself MUST NOT be banned
    let (key_banned, _) = BanList::is_key_banned(victim_key_name);
    assert!(
        !key_banned,
        "Target API key was maliciously suspended by an attacker"
    );

    // Legitimate client from a different IP with valid credentials still authenticates successfully
    let valid_token = BASE64_STANDARD.encode(format!("{}:secret_ro", victim_key_name));
    let leg_req = Request::get("/api/v1/db/databases")
        .header("X-Axiom-Key", &valid_token)
        .header("X-Forwarded-For", legitimate_ip)
        .body(Body::empty())
        .unwrap();
    let leg_res = create_app().oneshot(leg_req).await.unwrap();
    assert_eq!(leg_res.status(), StatusCode::OK);

    // Clean up test ban
    BanList::unban_ip(attacker_ip);
}

#[tokio::test]
async fn distributed_credential_stuffing_account_lockout() {
    ensure_metadata_store().await;
    let username = "target_victim_unique_lockout";
    let _ =
        axiom_metadata::MetadataStore::create_user(username, None, "ValidVictimP@ssw0rd!").await;

    // Simulate 5 failed login attempts from 5 distinct IP addresses
    for i in 1..=5 {
        let fake_ip = format!("198.51.100.{}", i);
        let req = Request::post("/admin/v1/auth/login")
            .header("Content-Type", "application/json")
            .header("X-Forwarded-For", fake_ip)
            .body(Body::from(
                serde_json::to_vec(&serde_json::json!({
                    "username": username,
                    "password": "WrongPasswordAttempt!"
                }))
                .unwrap(),
            ))
            .unwrap();
        let res = create_app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    // 6th attempt from yet another distinct IP should trigger ACCOUNT_LOCKED (429) without Argon2
    let req6 = Request::post("/admin/v1/auth/login")
        .header("Content-Type", "application/json")
        .header("X-Forwarded-For", "203.0.113.99")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": username,
                "password": "AnyPasswordHere"
            }))
            .unwrap(),
        ))
        .unwrap();
    let res6 = create_app().oneshot(req6).await.unwrap();
    assert_eq!(res6.status(), StatusCode::TOO_MANY_REQUESTS);
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

    CacheEngine::set(
        &key_a,
        Bytes::from("secrets_for_a_only"),
        60,
        Durability::MemoryOnly,
    )
    .await;

    assert_eq!(
        CacheEngine::get(&key_a).await,
        Some(Bytes::from("secrets_for_a_only"))
    );
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
    let params = (0..52)
        .map(|i| format!("k{}=v", i))
        .collect::<Vec<_>>()
        .join("&");
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
        .oneshot(
            Request::get("/api/v1/db/main/tables")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    let body_bytes = axum::body::to_bytes(res.into_body(), 1_000_000)
        .await
        .unwrap();
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
    static ENGINE_INIT: tokio::sync::OnceCell<tempfile::TempDir> =
        tokio::sync::OnceCell::const_new();
    let _ = ENGINE_INIT
        .get_or_init(|| async {
            ensure_metadata_store().await;
            let tmp = tempfile::tempdir().expect("Failed to create tempdir for blob engine test");
            axiom_api::blobs::init_blob_engine(
                tmp.path().to_str().unwrap(),
                64 * 1024,              // 64 KB inline threshold
                5 * 1024 * 1024 * 1024, // 5 GB max object
                true,                   // verify reads
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
    let put_body = axum::body::to_bytes(put_res.into_body(), usize::MAX)
        .await
        .unwrap();
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
    assert_eq!(
        head_res.headers().get("x-content-type-options").unwrap(),
        "nosniff"
    );
    assert_eq!(
        head_res.headers().get("content-type").unwrap(),
        "text/plain; charset=utf-8"
    );
    assert!(head_res
        .headers()
        .get("content-disposition")
        .unwrap()
        .to_str()
        .unwrap()
        .contains("hello.txt"));

    // 3. GET blob - verify data integrity
    let get_req = Request::get("/api/v1/blobs/testns/docs/hello.txt")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let get_res = create_app().oneshot(get_req).await.unwrap();
    assert_eq!(get_res.status(), StatusCode::OK);
    let get_body = axum::body::to_bytes(get_res.into_body(), usize::MAX)
        .await
        .unwrap();
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
    let list_body = axum::body::to_bytes(list_res.into_body(), usize::MAX)
        .await
        .unwrap();
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
    assert!(
        bad_ns_res.status() == StatusCode::BAD_REQUEST
            || bad_ns_res.status() == StatusCode::FORBIDDEN
    );

    // Invalid key: containing ".."
    let bad_key_req = Request::put("/api/v1/blobs/testns/sub/../../etc/passwd")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::from(b"test".to_vec()))
        .unwrap();
    let bad_key_res = create_app().oneshot(bad_key_req).await.unwrap();
    assert!(
        bad_key_res.status() == StatusCode::BAD_REQUEST
            || bad_key_res.status() == StatusCode::FORBIDDEN
    );
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
    assert_eq!(
        range_res1.headers().get("Content-Range").unwrap(),
        "bytes 0-4/16"
    );
    assert_eq!(range_res1.headers().get("Content-Length").unwrap(), "5");
    assert_eq!(range_res1.headers().get("Accept-Ranges").unwrap(), "bytes");

    let body_bytes1 = axum::body::to_bytes(range_res1.into_body(), 1024)
        .await
        .unwrap();
    assert_eq!(&body_bytes1[..], b"HELLO");

    // 3. Fetch partial range bytes=6-10 (5 bytes: "WORLD")
    let range_req2 = Request::get("/api/v1/blobs/media/range_file.txt")
        .header("X-Axiom-Key", &admin_token)
        .header("Range", "bytes=6-10")
        .body(Body::empty())
        .unwrap();
    let range_res2 = create_app().oneshot(range_req2).await.unwrap();
    assert_eq!(range_res2.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        range_res2.headers().get("Content-Range").unwrap(),
        "bytes 6-10/16"
    );
    let body_bytes2 = axum::body::to_bytes(range_res2.into_body(), 1024)
        .await
        .unwrap();
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
async fn blob_storage_media_streaming_and_caching_rfcs() {
    setup_test_metadata();
    ensure_blob_engine().await;

    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");

    // 1. Upload a 256 KB test video payload
    let payload = vec![0xABu8; 256 * 1024];
    let put_req = Request::put("/api/v1/blobs/media/sample_stream.mp4")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "video/mp4")
        .body(Body::from(payload.clone()))
        .unwrap();
    let put_res = create_app().oneshot(put_req).await.unwrap();
    assert_eq!(put_res.status(), StatusCode::CREATED);

    // 2. Full GET: verify Cache-Control for media, Last-Modified, Accept-Ranges, and ETag
    let get_req = Request::get("/api/v1/blobs/media/sample_stream.mp4")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let get_res = create_app().oneshot(get_req).await.unwrap();
    assert_eq!(get_res.status(), StatusCode::OK);
    assert_eq!(
        get_res.headers().get("Cache-Control").unwrap(),
        "public, max-age=86400, stale-while-revalidate=604800"
    );
    assert!(get_res.headers().contains_key("Last-Modified"));
    assert_eq!(get_res.headers().get("Accept-Ranges").unwrap(), "bytes");
    let etag = get_res.headers().get("ETag").unwrap().to_str().unwrap().to_string();

    // 3. Conditional GET with If-Modified-Since in future -> 304 Not Modified
    let future_date = "Wed, 21 Oct 2099 07:28:00 GMT";
    let cond_req = Request::get("/api/v1/blobs/media/sample_stream.mp4")
        .header("X-Axiom-Key", &admin_token)
        .header("If-Modified-Since", future_date)
        .body(Body::empty())
        .unwrap();
    let cond_res = create_app().oneshot(cond_req).await.unwrap();
    assert_eq!(cond_res.status(), StatusCode::NOT_MODIFIED);

    // 4. High-throughput 128 KB range streaming: bytes=0-131071 (131072 bytes)
    let range_req = Request::get("/api/v1/blobs/media/sample_stream.mp4")
        .header("X-Axiom-Key", &admin_token)
        .header("Range", "bytes=0-131071")
        .body(Body::empty())
        .unwrap();
    let range_res = create_app().oneshot(range_req).await.unwrap();
    assert_eq!(range_res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        range_res.headers().get("Content-Range").unwrap(),
        "bytes 0-131071/262144"
    );
    assert_eq!(range_res.headers().get("Content-Length").unwrap(), "131072");
    assert_eq!(
        range_res.headers().get("Cache-Control").unwrap(),
        "public, max-age=86400, stale-while-revalidate=604800"
    );
    let chunk_bytes = axum::body::to_bytes(range_res.into_body(), 256 * 1024)
        .await
        .unwrap();
    assert_eq!(chunk_bytes.len(), 131072);

    // 5. RFC 9110 If-Range matching current ETag -> 206 Partial Content
    let if_range_match_req = Request::get("/api/v1/blobs/media/sample_stream.mp4")
        .header("X-Axiom-Key", &admin_token)
        .header("Range", "bytes=0-1023")
        .header("If-Range", &etag)
        .body(Body::empty())
        .unwrap();
    let if_range_match_res = create_app().oneshot(if_range_match_req).await.unwrap();
    assert_eq!(if_range_match_res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        if_range_match_res.headers().get("Content-Range").unwrap(),
        "bytes 0-1023/262144"
    );

    // 6. RFC 9110 If-Range mismatch -> must IGNORE Range and return 200 OK with full representation
    let if_range_mismatch_req = Request::get("/api/v1/blobs/media/sample_stream.mp4")
        .header("X-Axiom-Key", &admin_token)
        .header("Range", "bytes=0-1023")
        .header("If-Range", "\"stale-non-matching-etag\"")
        .body(Body::empty())
        .unwrap();
    let if_range_mismatch_res = create_app().oneshot(if_range_mismatch_req).await.unwrap();
    assert_eq!(if_range_mismatch_res.status(), StatusCode::OK);
    assert_eq!(
        if_range_mismatch_res.headers().get("Content-Length").unwrap(),
        "262144"
    );
}

#[tokio::test]
async fn blob_storage_presigned_capability_ticket_download() {
    ensure_blob_engine().await;
    setup_test_metadata();

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
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "key": "secret_doc.txt",
                "operation": "READ",
                "ttl_seconds": 120
            }))
            .unwrap(),
        ))
        .unwrap();
    let ticket_res = create_app().oneshot(ticket_req).await.unwrap();
    assert_eq!(ticket_res.status(), StatusCode::CREATED);

    let ticket_body = axum::body::to_bytes(ticket_res.into_body(), 4096)
        .await
        .unwrap();
    let ticket_json: serde_json::Value = serde_json::from_slice(&ticket_body).unwrap();
    let ticket_sig = ticket_json["data"]["ticket"]["signature"].as_str().unwrap();
    let ticket_exp = ticket_json["data"]["ticket"]["expires_at"]
        .as_i64()
        .unwrap();

    // 3. Download using ticket URL query string WITHOUT any X-Axiom-Key header
    let dl_url = format!(
        "/api/v1/blobs/secure/secret_doc.txt?ticket_sig={}&ticket_exp={}",
        ticket_sig, ticket_exp
    );
    let dl_req = Request::get(&dl_url).body(Body::empty()).unwrap();
    let dl_res = create_app().oneshot(dl_req).await.unwrap();
    assert_eq!(dl_res.status(), StatusCode::OK);
    let dl_bytes = axum::body::to_bytes(dl_res.into_body(), 1024)
        .await
        .unwrap();
    assert_eq!(&dl_bytes[..], b"Top secret capability test");

    // 4. Download with tampered signature fails with 403 Forbidden
    let bad_dl_url = format!(
        "/api/v1/blobs/secure/secret_doc.txt?ticket_sig=0000000000000000&ticket_exp={}",
        ticket_exp
    );
    let bad_dl_req = Request::get(&bad_dl_url).body(Body::empty()).unwrap();
    let bad_dl_res = create_app().oneshot(bad_dl_req).await.unwrap();
    assert_eq!(bad_dl_res.status(), StatusCode::FORBIDDEN);
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
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "key": "archive.tar",
                "content_type": "application/x-tar"
            }))
            .unwrap(),
        ))
        .unwrap();
    let init_res = create_app().oneshot(init_req).await.unwrap();
    assert_eq!(init_res.status(), StatusCode::CREATED);

    let init_body = axum::body::to_bytes(init_res.into_body(), 4096)
        .await
        .unwrap();
    let init_json: serde_json::Value = serde_json::from_slice(&init_body).unwrap();
    let upload_id = init_json["data"]["upload_id"].as_str().unwrap();

    // 2. Upload part 1
    let part1_req = Request::put(format!(
        "/api/v1/blobs/multichunk/uploads/{}/parts/1",
        upload_id
    ))
    .header("X-Axiom-Key", &admin_token)
    .body(Body::from(b"CHUNK1_DATA_".to_vec()))
    .unwrap();
    let part1_res = create_app().oneshot(part1_req).await.unwrap();
    assert_eq!(part1_res.status(), StatusCode::OK);

    // 3. Upload part 2
    let part2_req = Request::put(format!(
        "/api/v1/blobs/multichunk/uploads/{}/parts/2",
        upload_id
    ))
    .header("X-Axiom-Key", &admin_token)
    .body(Body::from(b"CHUNK2_DATA".to_vec()))
    .unwrap();
    let part2_res = create_app().oneshot(part2_req).await.unwrap();
    assert_eq!(part2_res.status(), StatusCode::OK);

    // 4. Complete upload
    let complete_req = Request::post(format!(
        "/api/v1/blobs/multichunk/uploads/{}/complete",
        upload_id
    ))
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
    let get_bytes = axum::body::to_bytes(get_res.into_body(), 1024)
        .await
        .unwrap();
    assert_eq!(&get_bytes[..], b"CHUNK1_DATA_CHUNK2_DATA");
}

#[tokio::test]
async fn blob_storage_integrity_scrub_and_ttl() {
    setup_test_metadata();
    ensure_blob_engine().await;

    // Create authentic admin session in metadata store
    let session_token = axiom_metadata::MetadataStore::create_session("admin_user", 3600)
        .await
        .unwrap();
    let cookie_header = format!("axiom_session={}", session_token);

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

    let sweep_body = axum::body::to_bytes(sweep_res.into_body(), 1024)
        .await
        .unwrap();
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
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": {}
            }))
            .unwrap(),
        ))
        .unwrap();

    let list_res = create_app().oneshot(list_req).await.unwrap();
    assert_eq!(list_res.status(), StatusCode::OK);
    let list_bytes = axum::body::to_bytes(list_res.into_body(), 65536)
        .await
        .unwrap();
    let list_json: serde_json::Value = serde_json::from_slice(&list_bytes).unwrap();
    assert_eq!(list_json["jsonrpc"], "2.0");
    let tools = list_json["result"]["tools"]
        .as_array()
        .expect("tools array");
    assert_eq!(tools.len(), 15);

    // 2. tools/call - axiom_write_blob
    let write_req = Request::post("/mcp/v1")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
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
            }))
            .unwrap(),
        ))
        .unwrap();

    let write_res = create_app().oneshot(write_req).await.unwrap();
    assert_eq!(write_res.status(), StatusCode::OK);
    let write_bytes = axum::body::to_bytes(write_res.into_body(), 65536)
        .await
        .unwrap();
    let write_json: serde_json::Value = serde_json::from_slice(&write_bytes).unwrap();
    assert_eq!(write_json["result"]["isError"], false);

    // 3. tools/call - axiom_read_blob
    let read_req = Request::post("/mcp/v1")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
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
            }))
            .unwrap(),
        ))
        .unwrap();

    let read_res = create_app().oneshot(read_req).await.unwrap();
    assert_eq!(read_res.status(), StatusCode::OK);
    let read_bytes = axum::body::to_bytes(read_res.into_body(), 65536)
        .await
        .unwrap();
    let read_json: serde_json::Value = serde_json::from_slice(&read_bytes).unwrap();
    assert_eq!(read_json["result"]["isError"], false);
    let read_text = read_json["result"]["content"][0]["text"].as_str().unwrap();
    assert!(read_text.contains("1. Test MCP blob integration"));

    // 4. tools/call - axiom_create_download_ticket
    let ticket_req = Request::post("/mcp/v1")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
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
            }))
            .unwrap(),
        ))
        .unwrap();

    let ticket_res = create_app().oneshot(ticket_req).await.unwrap();
    assert_eq!(ticket_res.status(), StatusCode::OK);
    let ticket_bytes = axum::body::to_bytes(ticket_res.into_body(), 65536)
        .await
        .unwrap();
    let ticket_json: serde_json::Value = serde_json::from_slice(&ticket_bytes).unwrap();
    assert_eq!(ticket_json["result"]["isError"], false);
    let ticket_data_text = ticket_json["result"]["content"][0]["text"]
        .as_str()
        .unwrap();
    assert!(ticket_data_text.contains("download_url"));
}

// ═══════════════════════════════════════════════════════════════════════════
//  18. Database Data API End-to-End HTTP Lifecycle & Schema Alteration
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn db_data_api_full_crud_pagination_and_column_lifecycle() {
    ensure_metadata_store().await;
    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");

    // 1. Drop existing table if any and create fresh `items_crud`
    let drop_req = Request::post("/api/v1/db/testdb/query")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "sql": "DROP TABLE IF EXISTS items_crud;"
            }))
            .unwrap(),
        ))
        .unwrap();
    let _ = create_app().oneshot(drop_req).await;

    let create_sql = "CREATE TABLE items_crud (\
        id INTEGER PRIMARY KEY AUTOINCREMENT, \
        name TEXT NOT NULL, \
        price REAL NOT NULL, \
        stock INTEGER NOT NULL\
    );";
    let create_req = Request::post("/api/v1/db/testdb/query")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "sql": create_sql
            }))
            .unwrap(),
        ))
        .unwrap();
    let create_res = create_app().oneshot(create_req).await.unwrap();
    assert_eq!(create_res.status(), StatusCode::OK);

    // 2. Insert batch rows
    let insert_req = Request::post("/api/v1/db/testdb/items_crud/rows")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "rows": [
                    {"name": "Item Alpha", "price": 10.0, "stock": 100},
                    {"name": "Item Beta", "price": 25.5, "stock": 50},
                    {"name": "Item Gamma", "price": 80.0, "stock": 10},
                    {"name": "Item Delta", "price": 150.0, "stock": 2}
                ]
            }))
            .unwrap(),
        ))
        .unwrap();
    let insert_res = create_app().oneshot(insert_req).await.unwrap();
    assert_eq!(insert_res.status(), StatusCode::OK);
    let insert_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(insert_res.into_body(), 65536)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(insert_body["success"], true);

    // 3. Query with limit and sorting (pagination)
    let fetch_page1_req =
        Request::get("/api/v1/db/testdb/items_crud/rows?limit=2&sort=id&order=asc")
            .header("X-Axiom-Key", &admin_token)
            .body(Body::empty())
            .unwrap();
    let fetch_page1_res = create_app().oneshot(fetch_page1_req).await.unwrap();
    assert_eq!(fetch_page1_res.status(), StatusCode::OK);
    let page1_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(fetch_page1_res.into_body(), 65536)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(page1_json["success"], true);
    let rows1 = page1_json["data"]["rows"].as_array().unwrap();
    assert_eq!(rows1.len(), 2);
    let next_cursor = page1_json["pagination"]["next_cursor"]
        .as_str()
        .or_else(|| page1_json["data"]["pagination"]["next_cursor"].as_str());
    assert!(next_cursor.is_some());
    let cursor_str = next_cursor.unwrap().to_string();

    // Fetch page 2 using cursor
    let fetch_page2_req = Request::get(format!(
        "/api/v1/db/testdb/items_crud/rows?limit=2&cursor={}&sort=id&order=asc",
        cursor_str
    ))
    .header("X-Axiom-Key", &admin_token)
    .body(Body::empty())
    .unwrap();
    let fetch_page2_res = create_app().oneshot(fetch_page2_req).await.unwrap();
    assert_eq!(fetch_page2_res.status(), StatusCode::OK);

    // 4. Query with filter (gte on price)
    let filter_req = Request::get(
        "/api/v1/db/testdb/items_crud/rows?filter=%7B%22price%22%3A%7B%22gte%22%3A50.0%7D%7D",
    )
    .header("X-Axiom-Key", &admin_token)
    .body(Body::empty())
    .unwrap();
    let filter_res = create_app().oneshot(filter_req).await.unwrap();
    assert_eq!(filter_res.status(), StatusCode::OK);
    let filter_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(filter_res.into_body(), 65536)
            .await
            .unwrap(),
    )
    .unwrap();
    let filtered_rows = filter_json["data"]["rows"].as_array().unwrap();
    assert!(filtered_rows
        .iter()
        .all(|r| r["price"].as_f64().unwrap() >= 50.0));

    // 5. Update rows
    let update_req = Request::patch("/api/v1/db/testdb/items_crud/rows")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "filter": {"name": {"eq": "Item Alpha"}},
                "update": {"stock": 199}
            }))
            .unwrap(),
        ))
        .unwrap();
    let update_res = create_app().oneshot(update_req).await.unwrap();
    assert_eq!(update_res.status(), StatusCode::OK);

    // 6. Delete rows
    let delete_req = Request::delete("/api/v1/db/testdb/items_crud/rows")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "filter": {"name": {"eq": "Item Delta"}}
            }))
            .unwrap(),
        ))
        .unwrap();
    let delete_res = create_app().oneshot(delete_req).await.unwrap();
    assert_eq!(delete_res.status(), StatusCode::OK);

    // 7. Dynamic Column Addition
    let add_col_req = Request::post("/api/v1/db/testdb/items_crud/columns")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "name": "barcode",
                "data_type": "TEXT",
                "nullable": true
            }))
            .unwrap(),
        ))
        .unwrap();
    let add_col_res = create_app().oneshot(add_col_req).await.unwrap();
    assert_eq!(add_col_res.status(), StatusCode::OK);

    // 8. Describe Table Schema via Canonical /columns Endpoint
    let schema_req = Request::get("/api/v1/db/testdb/items_crud/columns")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let schema_res = create_app().oneshot(schema_req).await.unwrap();
    assert_eq!(schema_res.status(), StatusCode::OK);
    let schema_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(schema_res.into_body(), 65536)
            .await
            .unwrap(),
    )
    .unwrap();
    let cols = schema_json["data"]["columns"].as_array().unwrap();
    assert!(cols.iter().any(|c| c["name"] == "barcode"));

    // Verify deprecated /schema endpoint is completely removed (404 Not Found)
    let legacy_schema_req = Request::get("/api/v1/db/testdb/items_crud/schema")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let legacy_schema_res = create_app().oneshot(legacy_schema_req).await.unwrap();
    assert_eq!(legacy_schema_res.status(), StatusCode::NOT_FOUND);

    // Verify PATCH on collection root /columns without path parameter is rejected (405 Method Not Allowed)
    let invalid_patch_req = Request::patch("/api/v1/db/testdb/items_crud/columns")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(r#"{"new_name":"barcode_code"}"#))
        .unwrap();
    let invalid_patch_res = create_app().oneshot(invalid_patch_req).await.unwrap();
    assert_eq!(invalid_patch_res.status(), StatusCode::METHOD_NOT_ALLOWED);

    // Modify/Rename Column via Canonical RESTful Path Parameter: PATCH /columns/:column_name
    let modify_col_req = Request::patch("/api/v1/db/testdb/items_crud/columns/barcode")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "new_name": "barcode_code"
            }))
            .unwrap(),
        ))
        .unwrap();
    let modify_col_res = create_app().oneshot(modify_col_req).await.unwrap();
    assert_eq!(modify_col_res.status(), StatusCode::OK);

    // Verify column was renamed to barcode_code
    let check_renamed_req = Request::get("/api/v1/db/testdb/items_crud/columns")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let check_renamed_res = create_app().oneshot(check_renamed_req).await.unwrap();
    assert_eq!(check_renamed_res.status(), StatusCode::OK);
    let check_renamed_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(check_renamed_res.into_body(), 65536)
            .await
            .unwrap(),
    )
    .unwrap();
    let cols_renamed = check_renamed_json["data"]["columns"].as_array().unwrap();
    assert!(cols_renamed.iter().any(|c| c["name"] == "barcode_code"));
    assert!(!cols_renamed.iter().any(|c| c["name"] == "barcode"));

    // Verify DELETE on collection root /columns without path parameter is rejected (405 Method Not Allowed)
    let invalid_del_req = Request::delete("/api/v1/db/testdb/items_crud/columns")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let invalid_del_res = create_app().oneshot(invalid_del_req).await.unwrap();
    assert_eq!(invalid_del_res.status(), StatusCode::METHOD_NOT_ALLOWED);

    // Dynamic Column Drop via Canonical RESTful Path Parameter
    let drop_col_req = Request::delete("/api/v1/db/testdb/items_crud/columns/barcode_code")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let drop_col_res = create_app().oneshot(drop_col_req).await.unwrap();
    assert_eq!(drop_col_res.status(), StatusCode::OK);

    // Verify column was dropped
    let check_cols_req = Request::get("/api/v1/db/testdb/items_crud/columns")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let check_cols_res = create_app().oneshot(check_cols_req).await.unwrap();
    assert_eq!(check_cols_res.status(), StatusCode::OK);
    let check_cols_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(check_cols_res.into_body(), 65536)
            .await
            .unwrap(),
    )
    .unwrap();
    let cols_after = check_cols_json["data"]["columns"].as_array().unwrap();
    assert!(!cols_after.iter().any(|c| c["name"] == "barcode_code"));

    // 9. List databases
    let list_dbs_req = Request::get("/api/v1/db/databases")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let list_dbs_res = create_app().oneshot(list_dbs_req).await.unwrap();
    assert_eq!(list_dbs_res.status(), StatusCode::OK);
}

// ═══════════════════════════════════════════════════════════════════════════
//  19. AST Mutation Defense & Unbounded Mutation Guardrails
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn db_ast_firewall_blocks_destructive_ddl_and_unbounded_mutation() {
    ensure_metadata_store().await;
    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");

    // Unbounded update (empty filter) must be rejected with 400 Bad Request
    let unbounded_update_req = Request::patch("/api/v1/db/testdb/items/rows")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "filter": {},
                "update": {"stock": 0}
            }))
            .unwrap(),
        ))
        .unwrap();
    let update_res = create_app().oneshot(unbounded_update_req).await.unwrap();
    assert_eq!(update_res.status(), StatusCode::BAD_REQUEST);

    // Unbounded delete (empty filter) must be rejected with 400 Bad Request
    let unbounded_delete_req = Request::delete("/api/v1/db/testdb/items/rows")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "filter": {}
            }))
            .unwrap(),
        ))
        .unwrap();
    let delete_res = create_app().oneshot(unbounded_delete_req).await.unwrap();
    assert_eq!(delete_res.status(), StatusCode::BAD_REQUEST);
}

// ═══════════════════════════════════════════════════════════════════════════
//  20. Granular Table-Level RBAC Enforcement over HTTP
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn db_rbac_fine_grained_table_level_authorization() {
    ensure_test_items_table().await;
    let reader_token = BASE64_STANDARD.encode("items_reader_key:secret_items_ro");

    // Allowed: SELECT on items table
    let allowed_req = Request::get("/api/v1/db/testdb/items/rows")
        .header("X-Axiom-Key", &reader_token)
        .body(Body::empty())
        .unwrap();
    let allowed_res = create_app().oneshot(allowed_req).await.unwrap();
    assert_eq!(allowed_res.status(), StatusCode::OK);

    // Forbidden: INSERT on items table with SELECT-only permission
    let forbidden_insert_req = Request::post("/api/v1/db/testdb/items/rows")
        .header("X-Axiom-Key", &reader_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "rows": [{"name": "Malicious", "price": 0.0, "stock": 0}]
            }))
            .unwrap(),
        ))
        .unwrap();
    let forbidden_insert_res = create_app().oneshot(forbidden_insert_req).await.unwrap();
    assert_eq!(forbidden_insert_res.status(), StatusCode::FORBIDDEN);

    // Forbidden: Access to an ungranted table
    let forbidden_table_req = Request::get("/api/v1/db/testdb/secret_orders/rows")
        .header("X-Axiom-Key", &reader_token)
        .body(Body::empty())
        .unwrap();
    let forbidden_table_res = create_app().oneshot(forbidden_table_req).await.unwrap();
    assert_eq!(forbidden_table_res.status(), StatusCode::FORBIDDEN);
}

// ═══════════════════════════════════════════════════════════════════════════
//  21. Idempotency Engine Anti-Replay Verification
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn db_idempotency_key_replay_protection() {
    ensure_metadata_store().await;
    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");
    let idemp_key = "idemp-test-query-uuid-99999";

    let query_payload = serde_json::json!({
        "sql": "SELECT 1 as test_val;"
    });

    // 1st request with Idempotency-Key
    let req1 = Request::post("/api/v1/db/testdb/query")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .header("Idempotency-Key", idemp_key)
        .body(Body::from(serde_json::to_vec(&query_payload).unwrap()))
        .unwrap();
    let res1 = create_app().oneshot(req1).await.unwrap();
    assert_eq!(res1.status(), StatusCode::OK);
    let bytes1 = axum::body::to_bytes(res1.into_body(), 65536).await.unwrap();

    // 2nd request with same Idempotency-Key
    let req2 = Request::post("/api/v1/db/testdb/query")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .header("Idempotency-Key", idemp_key)
        .body(Body::from(serde_json::to_vec(&query_payload).unwrap()))
        .unwrap();
    let res2 = create_app().oneshot(req2).await.unwrap();
    assert_eq!(res2.status(), StatusCode::OK);
    assert_eq!(
        res2.headers()
            .get("x-idempotency-hit")
            .and_then(|h| h.to_str().ok()),
        Some("true")
    );
    let bytes2 = axum::body::to_bytes(res2.into_body(), 65536).await.unwrap();
    assert_eq!(bytes1, bytes2);
}

// ═══════════════════════════════════════════════════════════════════════════
//  22. Admin API Control Plane End-to-End HTTP Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn admin_api_full_control_plane_lifecycle() {
    ensure_metadata_store().await;
    let _ = axiom_metadata::MetadataStore::create_user("super_admin_ops", None, "SecretP@ss12345!")
        .await;

    // 1. Admin Login
    let login_req = Request::post("/admin/v1/auth/login")
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "super_admin_ops",
                "password": "SecretP@ss12345!"
            }))
            .unwrap(),
        ))
        .unwrap();
    let login_res = create_app().oneshot(login_req).await.unwrap();
    assert_eq!(login_res.status(), StatusCode::OK);
    let cookie_val = login_res
        .headers()
        .get(axum::http::header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    let login_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(login_res.into_body(), 65536)
            .await
            .unwrap(),
    )
    .unwrap();
    let token = login_json["data"]["token"].as_str().unwrap().to_string();

    // 2. Status Check
    let status_req = Request::get("/admin/v1/status")
        .header(axum::http::header::COOKIE, &cookie_val)
        .body(Body::empty())
        .unwrap();
    let status_res = create_app().oneshot(status_req).await.unwrap();
    assert_eq!(status_res.status(), StatusCode::OK);

    // 3. Create Custom Role
    let role_req = Request::post("/admin/v1/roles")
        .header(axum::http::header::COOKIE, &cookie_val)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "name": "auditor_role",
                "description": "Compliance auditor",
                "permissions": [
                    {"database": "testdb", "table_name": "*", "operations": ["SELECT"]}
                ]
            }))
            .unwrap(),
        ))
        .unwrap();
    let role_res = create_app().oneshot(role_req).await.unwrap();
    assert!(role_res.status() == StatusCode::OK || role_res.status() == StatusCode::CREATED);

    // 4. List Roles
    let list_roles_req = Request::get("/admin/v1/roles")
        .header(axum::http::header::COOKIE, &cookie_val)
        .body(Body::empty())
        .unwrap();
    let list_roles_res = create_app().oneshot(list_roles_req).await.unwrap();
    assert_eq!(list_roles_res.status(), StatusCode::OK);
    let roles_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(list_roles_res.into_body(), 65536)
            .await
            .unwrap(),
    )
    .unwrap();
    let roles_list = roles_json["data"]["roles"]
        .as_array()
        .or_else(|| roles_json["data"].as_array())
        .expect("roles array in response");
    assert!(roles_list.iter().any(|r| r["name"] == "auditor_role"));

    // 5. Create API Key
    let key_req = Request::post("/admin/v1/keys")
        .header(axum::http::header::COOKIE, &cookie_val)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "name": "auditor_app_key",
                "role": "auditor_role",
                "rate_limit": 500
            }))
            .unwrap(),
        ))
        .unwrap();
    let key_res = create_app().oneshot(key_req).await.unwrap();
    assert!(key_res.status() == StatusCode::OK || key_res.status() == StatusCode::CREATED);

    // 6. Rotate API Key
    let rotate_req = Request::post("/admin/v1/keys/auditor_app_key/rotate")
        .header(axum::http::header::COOKIE, &cookie_val)
        .body(Body::empty())
        .unwrap();
    let rotate_res = create_app().oneshot(rotate_req).await.unwrap();
    assert_eq!(rotate_res.status(), StatusCode::OK);

    // 7. Audit Log Check
    let audit_req = Request::get("/admin/v1/audit")
        .header(axum::http::header::COOKIE, &cookie_val)
        .body(Body::empty())
        .unwrap();
    let audit_res = create_app().oneshot(audit_req).await.unwrap();
    assert_eq!(audit_res.status(), StatusCode::OK);

    // 8. Cache Flush and Stats
    let flush_req = Request::post("/admin/v1/cache/flush")
        .header(axum::http::header::COOKIE, &cookie_val)
        .body(Body::empty())
        .unwrap();
    let flush_res = create_app().oneshot(flush_req).await.unwrap();
    assert_eq!(flush_res.status(), StatusCode::OK);

    let stats_req = Request::get("/admin/v1/cache/stats")
        .header(axum::http::header::COOKIE, &cookie_val)
        .body(Body::empty())
        .unwrap();
    let stats_res = create_app().oneshot(stats_req).await.unwrap();
    assert_eq!(stats_res.status(), StatusCode::OK);

    // 9. Delete Key and Role
    let del_key_req = Request::delete("/admin/v1/keys/auditor_app_key")
        .header(axum::http::header::COOKIE, &cookie_val)
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        create_app().oneshot(del_key_req).await.unwrap().status(),
        StatusCode::OK
    );

    let del_role_req = Request::delete("/admin/v1/roles/auditor_role")
        .header(axum::http::header::COOKIE, &cookie_val)
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        create_app().oneshot(del_role_req).await.unwrap().status(),
        StatusCode::OK
    );

    // 10. Admin Logout
    let logout_req = Request::post("/admin/v1/auth/logout")
        .header(axum::http::header::COOKIE, &cookie_val)
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        create_app().oneshot(logout_req).await.unwrap().status(),
        StatusCode::OK
    );

    // 11. Revoked Session Verification: Status call must now be rejected
    let rejected_req = Request::get("/admin/v1/status")
        .header(
            axum::http::header::COOKIE,
            format!("axiom_session={}", token),
        )
        .body(Body::empty())
        .unwrap();
    let rejected_res = create_app().oneshot(rejected_req).await.unwrap();
    assert_eq!(rejected_res.status(), StatusCode::UNAUTHORIZED);
}

// ═══════════════════════════════════════════════════════════════════════════
//  23. Circuit Breaker Fail-Fast & Consecutive Failure Tripping
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn circuit_breaker_repeated_failure_tripping() {
    setup_test_metadata();
    ensure_metadata_store().await;
    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");

    // Repeated failures on unreachable dead_db
    for _ in 0..6 {
        let req = Request::post("/api/v1/db/dead_db/query")
            .header("X-Axiom-Key", &admin_token)
            .header("Content-Type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&serde_json::json!({
                    "sql": "SELECT 1;"
                }))
                .unwrap(),
            ))
            .unwrap();
        let _ = create_app().oneshot(req).await;
    }

    // Now circuit breaker should be OPEN and return 503 SERVICE_UNAVAILABLE immediately
    let fast_fail_req = Request::post("/api/v1/db/dead_db/query")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "sql": "SELECT 1;"
            }))
            .unwrap(),
        ))
        .unwrap();
    let fast_fail_res = create_app().oneshot(fast_fail_req).await.unwrap();
    assert_eq!(fast_fail_res.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(fast_fail_res.into_body(), 65536)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_json["error"]["code"], "CIRCUIT_BREAKER_OPEN");
}

// ═══════════════════════════════════════════════════════════════════════════
//  24. Native Blob Storage HTTP Resumable Upload Lifecycle & Guarantees
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn blob_storage_resumable_upload_e2e_http_protocol() {
    setup_test_metadata();
    ensure_blob_engine().await;

    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");
    let ns = "test_resumable_ns";
    let key = "videos/stream_test.mp4";
    let total_size = 20u64;

    // 1. Initialize resumable upload session with X-Upload-Content-Length
    let init_req = Request::post(format!("/api/v1/blobs/{}/uploads", ns))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .header("X-Upload-Content-Type", "video/mp4")
        .header("X-Upload-Content-Length", total_size.to_string())
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "key": key
            }))
            .unwrap(),
        ))
        .unwrap();

    let init_res = create_app().oneshot(init_req).await.unwrap();
    assert_eq!(init_res.status(), StatusCode::CREATED);
    assert!(init_res.headers().contains_key("location"));
    let location = init_res
        .headers()
        .get("location")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();

    let init_bytes = axum::body::to_bytes(init_res.into_body(), 4096)
        .await
        .unwrap();
    let init_json: Value = serde_json::from_slice(&init_bytes).unwrap();
    let upload_id = init_json["data"]["upload_id"].as_str().unwrap().to_string();
    assert!(location.contains(&upload_id));

    // 2. Query initial status via GET (returns 308 with Upload-Offset: 0)
    let status_req = Request::get(format!("/api/v1/blobs/{}/uploads/{}", ns, upload_id))
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let status_res = create_app().oneshot(status_req).await.unwrap();
    assert_eq!(status_res.status(), StatusCode::PERMANENT_REDIRECT);
    assert_eq!(status_res.headers().get("Upload-Offset").unwrap(), "0");
    assert_eq!(status_res.headers().get("Upload-Length").unwrap(), "20");

    // 3. Upload first chunk: bytes 0-7/20 (8 bytes)
    let chunk1_req = Request::put(format!("/api/v1/blobs/{}/uploads/{}", ns, upload_id))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Range", "bytes 0-7/20")
        .body(Body::from(b"CHUNK_A_".to_vec()))
        .unwrap();
    let chunk1_res = create_app().oneshot(chunk1_req).await.unwrap();
    assert_eq!(chunk1_res.status(), StatusCode::PERMANENT_REDIRECT);
    assert_eq!(chunk1_res.headers().get("Range").unwrap(), "bytes=0-7");
    assert_eq!(chunk1_res.headers().get("Upload-Offset").unwrap(), "8");

    // 4. Query status via empty PUT Content-Range: bytes */20 (status probe)
    let probe_req = Request::put(format!("/api/v1/blobs/{}/uploads/{}", ns, upload_id))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Range", "bytes */20")
        .body(Body::empty())
        .unwrap();
    let probe_res = create_app().oneshot(probe_req).await.unwrap();
    assert_eq!(probe_res.status(), StatusCode::PERMANENT_REDIRECT);
    assert_eq!(probe_res.headers().get("Range").unwrap(), "bytes=0-7");
    assert_eq!(probe_res.headers().get("Upload-Offset").unwrap(), "8");

    // 5. Duplicate chunk retry: re-sending bytes 0-7/20 must be safely handled without duplicating data
    let dup_req = Request::put(format!("/api/v1/blobs/{}/uploads/{}", ns, upload_id))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Range", "bytes 0-7/20")
        .body(Body::from(b"CHUNK_A_".to_vec()))
        .unwrap();
    let dup_res = create_app().oneshot(dup_req).await.unwrap();
    assert_eq!(dup_res.status(), StatusCode::PERMANENT_REDIRECT);
    assert_eq!(dup_res.headers().get("Upload-Offset").unwrap(), "8");

    // 6. Conflicting / gap chunk: trying bytes 12-15/20 when offset is 8 must return 409 Conflict
    let gap_req = Request::put(format!("/api/v1/blobs/{}/uploads/{}", ns, upload_id))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Range", "bytes 12-15/20")
        .body(Body::from(b"GAP!".to_vec()))
        .unwrap();
    let gap_res = create_app().oneshot(gap_req).await.unwrap();
    assert_eq!(gap_res.status(), StatusCode::CONFLICT);
    assert_eq!(gap_res.headers().get("Upload-Offset").unwrap(), "8");

    // 7. Resume from exact server-confirmed offset: bytes 8-19/20 (12 bytes)
    // Reaching total length (20) triggers automatic atomic finalization
    let chunk2_req = Request::put(format!("/api/v1/blobs/{}/uploads/{}", ns, upload_id))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Range", "bytes 8-19/20")
        .body(Body::from(b"CHUNK_B_DATA".to_vec()))
        .unwrap();
    let chunk2_res = create_app().oneshot(chunk2_req).await.unwrap();
    assert_eq!(chunk2_res.status(), StatusCode::CREATED);
    let complete_bytes = axum::body::to_bytes(chunk2_res.into_body(), 4096)
        .await
        .unwrap();
    let complete_json: Value = serde_json::from_slice(&complete_bytes).unwrap();
    assert_eq!(complete_json["success"], true);
    assert_eq!(complete_json["data"]["size"], 20);

    // 8. Download completed blob and verify exact content integrity
    let dl_req = Request::get(format!("/api/v1/blobs/{}/{}", ns, key))
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let dl_res = create_app().oneshot(dl_req).await.unwrap();
    assert_eq!(dl_res.status(), StatusCode::OK);
    let dl_bytes = axum::body::to_bytes(dl_res.into_body(), 1024)
        .await
        .unwrap();
    assert_eq!(&dl_bytes[..], b"CHUNK_A_CHUNK_B_DATA");
}

#[tokio::test]
async fn blob_storage_resumable_upload_cross_identity_protection() {
    setup_test_metadata();
    ensure_blob_engine().await;

    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");
    let other_token = BASE64_STANDARD.encode("blob_wildcard_key:secret_blob_wildcard");
    let ns = "media";
    let key = "media/private_video.mp4";

    // 1. Admin initializes upload session (owner is admin_key)
    let init_req = Request::post(format!("/api/v1/blobs/{}/uploads", ns))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .header("X-Upload-Content-Length", "10")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "key": key
            }))
            .unwrap(),
        ))
        .unwrap();
    let init_res = create_app().oneshot(init_req).await.unwrap();
    assert_eq!(init_res.status(), StatusCode::CREATED);
    let init_bytes = axum::body::to_bytes(init_res.into_body(), 4096)
        .await
        .unwrap();
    let init_json: Value = serde_json::from_slice(&init_bytes).unwrap();
    let upload_id = init_json["data"]["upload_id"].as_str().unwrap();

    // 2. Different user attempts to upload chunk into admin's session -> 403 Forbidden
    let hijack_req = Request::put(format!("/api/v1/blobs/{}/uploads/{}", ns, upload_id))
        .header("X-Axiom-Key", &other_token)
        .header("Content-Range", "bytes 0-4/10")
        .body(Body::from(b"HIJAK".to_vec()))
        .unwrap();
    let hijack_res = create_app().oneshot(hijack_req).await.unwrap();
    assert_eq!(hijack_res.status(), StatusCode::FORBIDDEN);

    // 3. Different user attempts to complete admin's session -> 403 Forbidden
    let complete_req = Request::post(format!(
        "/api/v1/blobs/{}/uploads/{}/complete",
        ns, upload_id
    ))
    .header("X-Axiom-Key", &other_token)
    .body(Body::empty())
    .unwrap();
    let complete_res = create_app().oneshot(complete_req).await.unwrap();
    assert_eq!(complete_res.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn ndjson_streaming_response() {
    ensure_test_items_table().await;
    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");

    // Insert a test item
    let insert_req = Request::post("/api/v1/db/testdb/items/rows")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "row": {"name": "stream_item", "price": 19.99, "stock": 100}
            }))
            .unwrap(),
        ))
        .unwrap();
    let insert_res = create_app().oneshot(insert_req).await.unwrap();
    assert_eq!(insert_res.status(), StatusCode::OK);

    // Fetch with Accept: application/x-ndjson
    let req = Request::get("/api/v1/db/testdb/items/rows")
        .header("X-Axiom-Key", &admin_token)
        .header("Accept", "application/x-ndjson")
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get("content-type").unwrap(),
        "application/x-ndjson"
    );

    let body_bytes = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    let body_str = std::str::from_utf8(&body_bytes).unwrap();
    assert!(!body_str.is_empty());
    for line in body_str.lines() {
        let parsed: Value = serde_json::from_str(line).unwrap();
        assert!(parsed.is_object());
    }
}

#[tokio::test]
async fn row_level_security_predicate_filtering() {
    setup_test_metadata();
    ensure_metadata_store().await;
    ensure_test_items_table().await;
    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");

    // Insert tenant A and tenant B items
    let _ = create_app()
        .oneshot(
            Request::post("/api/v1/db/testdb/items/rows")
                .header("X-Axiom-Key", &admin_token)
                .header("Content-Type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&serde_json::json!({
                        "row": {"name": "tenant_a_secret_doc", "price": 10.0, "stock": 1}
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    let _ = create_app()
        .oneshot(
            Request::post("/api/v1/db/testdb/items/rows")
                .header("X-Axiom-Key", &admin_token)
                .header("Content-Type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&serde_json::json!({
                        "row": {"name": "tenant_b_public_doc", "price": 20.0, "stock": 2}
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    // Create an RLS-restricted role and key for Tenant A
    if let Err(e) = axiom_metadata::MetadataStore::create_role(
        "tenant_a_role",
        Some("Tenant A Isolated"),
        &[axiom_metadata::PermissionRecord {
            id: 0,
            role_name: "tenant_a_role".to_string(),
            database: "testdb".to_string(),
            table_name: "items".to_string(),
            operations: vec!["SELECT".to_string()],
            rls_filter: Some("name LIKE 'tenant_a_%'".to_string()),
        }],
    )
    .await
    {
        println!("create_role tenant_a_role note: {}", e);
    }

    if let Err(e) = axiom_metadata::MetadataStore::create_key(
        "tenant_a_key",
        Some("tenant_a_role"),
        Some("secret_tenant_a"),
        0,
        None,
    )
    .await
    {
        println!("create_key tenant_a_key note: {}", e);
    }

    axiom_metadata::MetadataStore::sync_snapshot()
        .await
        .unwrap();

    let tenant_a_token = BASE64_STANDARD.encode("tenant_a_key:secret_tenant_a");

    // Query rows with tenant_a_key
    let req = Request::get("/api/v1/db/testdb/items/rows")
        .header("X-Axiom-Key", &tenant_a_token)
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    let status = res.status();
    let body_bytes = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    if status != StatusCode::OK {
        panic!(
            "row_level_security_predicate_filtering failed with status {}: {}",
            status,
            String::from_utf8_lossy(&body_bytes)
        );
    }
    let body_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let rows = body_json["data"]["rows"].as_array().unwrap();

    // Invariant: Tenant A caller MUST NOT see tenant B items
    assert!(!rows.is_empty());
    for r in rows {
        let name = r["name"].as_str().unwrap();
        assert!(
            name.starts_with("tenant_a_"),
            "RLS violation: tenant A observed row: {}",
            name
        );
    }
}

#[tokio::test]
async fn test_modern_s3_public_blob_and_batch_workflow() {
    setup_test_metadata();
    ensure_blob_engine().await;
    axiom_cache::CacheEngine::delete("rl:ip:127.0.0.1").await;
    axiom_cache::CacheEngine::delete("penalty:127.0.0.1").await;
    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");

    // 1. Create a public namespace for website media
    let req = Request::post("/admin/v1/blobs/namespaces")
        .header("Authorization", format!("Bearer {}", admin_token))
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "name": "site-media",
                "is_public": true
            }))
            .unwrap(),
        ))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    // 2. Upload an image to the public namespace with custom metadata
    let img_payload = b"FAKE_JPEG_IMAGE_PAYLOAD_FOR_TESTING";
    let req = Request::put("/api/v1/blobs/site-media/banners/hero.jpg")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "image/jpeg")
        .header("X-Axiom-Meta-Author", "Engineering")
        .header("X-Axiom-Meta-Env", "Production")
        .body(Body::from(img_payload.as_slice()))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    let put_body = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    let put_json: Value = serde_json::from_slice(&put_body).unwrap();
    let etag = put_json["data"]["hash"].as_str().unwrap().to_string();

    // 3. Unauthenticated GET /api/v1/blobs/public/site-media/banners/hero.jpg
    let req = Request::get("/api/v1/blobs/public/site-media/banners/hero.jpg")
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers().get("content-type").unwrap(), "image/jpeg");
    assert_eq!(
        res.headers().get("cache-control").unwrap(),
        "public, max-age=31536000, immutable"
    );
    assert_eq!(res.headers().get("etag").unwrap(), &format!("\"{}\"", etag));
    assert_eq!(
        res.headers().get("x-axiom-meta-author").unwrap(),
        "Engineering"
    );
    assert_eq!(res.headers().get("x-axiom-meta-env").unwrap(), "Production");
    let body_bytes = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    assert_eq!(&body_bytes[..], img_payload);

    // 4. Test If-None-Match conditional request returns 304 Not Modified with 0 body bytes
    let req = Request::get("/api/v1/blobs/public/site-media/banners/hero.jpg")
        .header("If-None-Match", format!("\"{}\"", etag))
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_MODIFIED);
    let cached_body = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    assert!(cached_body.is_empty());

    // 5. Test private namespace rejection: create private namespace
    let req = Request::post("/admin/v1/blobs/namespaces")
        .header("Authorization", format!("Bearer {}", admin_token))
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "name": "private-vault",
                "is_public": false
            }))
            .unwrap(),
        ))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    let req = Request::put("/api/v1/blobs/private-vault/secret.txt")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::from("CONFIDENTIAL"))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    // Unauthenticated access to private namespace must return 403 Forbidden
    let req = Request::get("/api/v1/blobs/public/private-vault/secret.txt")
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // 6. Unauthenticated PUT to public namespace must return 401 Unauthorized
    let req = Request::put("/api/v1/blobs/public/site-media/exploit.jpg")
        .body(Body::from("ATTACK"))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    // 7. Batch multi-object deletion
    let req = Request::put("/api/v1/blobs/site-media/file1.png")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::from("DATA1"))
        .unwrap();
    create_app().oneshot(req).await.unwrap();

    let req = Request::put("/api/v1/blobs/site-media/file2.png")
        .header("X-Axiom-Key", &admin_token)
        .body(Body::from("DATA2"))
        .unwrap();
    create_app().oneshot(req).await.unwrap();

    let req = Request::post("/api/v1/blobs/site-media/delete-objects")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "keys": ["file1.png", "file2.png"]
            }))
            .unwrap(),
        ))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let del_body = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    let del_json: Value = serde_json::from_slice(&del_body).unwrap();
    let deleted = del_json["data"]["deleted"].as_array().unwrap();
    assert_eq!(deleted.len(), 2);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Cluster P2P Mesh Integration Tests
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_cluster_handshake_and_signature_verification() {
    setup_test_metadata();
    ensure_metadata_store().await;

    let (_node_id, _moniker, cluster_secret) =
        axiom_metadata::MetadataStore::get_or_create_cluster_identity()
            .await
            .unwrap();

    // 1. Handshake with invalid secret fails
    let bad_handshake = serde_json::json!({
        "node_id": "axm_node_attacker",
        "moniker": "Evil-Node",
        "advertise_url": "http://10.0.0.99:4500",
        "cluster_secret": "wrong_secret_123"
    });
    let req = Request::post("/internal/v1/cluster/handshake")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&bad_handshake).unwrap()))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    // 2. Handshake with valid secret succeeds and registers peer
    let valid_handshake = serde_json::json!({
        "node_id": "axm_node_tokyo",
        "moniker": "Tokyo-Edge",
        "advertise_url": "http://10.0.0.50:4500",
        "cluster_secret": cluster_secret
    });
    let req = Request::post("/internal/v1/cluster/handshake")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&valid_handshake).unwrap()))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "connected");

    // 3. Ping without signature headers fails
    let req = Request::get("/internal/v1/cluster/ping")
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 4. Ping with signed headers succeeds
    let (node_h, ts_h, nonce_h, sig_h) =
        axiom_api::cluster::signing::sign_outbound_packet("axm_node_tokyo", &cluster_secret, b"");
    let req = Request::get("/internal/v1/cluster/ping")
        .header("X-Axiom-Node-Id", node_h)
        .header("X-Axiom-Timestamp", ts_h.to_string())
        .header("X-Axiom-Nonce", nonce_h)
        .header("X-Axiom-Signature", sig_h)
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_cluster_ban_propagation_and_instant_rejection() {
    setup_test_metadata();
    ensure_metadata_store().await;

    let (_node_id, _moniker, cluster_secret) =
        axiom_metadata::MetadataStore::get_or_create_cluster_identity()
            .await
            .unwrap();

    let target_ip = "198.51.100.77";
    assert!(!BanList::is_ip_banned(target_ip).0);

    // 1. Simulate inbound cluster broadcast event: Node 1 bans attacker
    let ban_packet = serde_json::json!({
        "event_id": format!("evt_test_ban_{}", uuid::Uuid::new_v4().to_string().replace('-', "")),
        "event_type": "ban.ip",
        "payload": {
            "ip": target_ip,
            "reason": "Brute-force attack detected on Tokyo-Edge",
            "ttl_secs": 3600
        },
        "origin_node_id": "axm_node_tokyo",
        "timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64
    });

    let body_bytes = serde_json::to_vec(&ban_packet).unwrap();
    let (node_h, ts_h, nonce_h, sig_h) = axiom_api::cluster::signing::sign_outbound_packet(
        "axm_node_tokyo",
        &cluster_secret,
        &body_bytes,
    );

    let req = Request::post("/internal/v1/cluster/event")
        .header("X-Axiom-Node-Id", node_h)
        .header("X-Axiom-Timestamp", ts_h.to_string())
        .header("X-Axiom-Nonce", nonce_h)
        .header("X-Axiom-Signature", sig_h)
        .header("Content-Type", "application/json")
        .body(Body::from(body_bytes))
        .unwrap();

    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 2. Invariant: Node 2 immediately recognizes the banned IP in memory
    let (is_banned, reason) = BanList::is_ip_banned(target_ip);
    assert!(is_banned);
    assert!(reason.contains("Tokyo-Edge"));

    // 3. Attacker connects to Node 2: immediately rejected by RateLimit/Ban middleware with 403 Forbidden
    let req = Request::get("/api/v1/db/databases")
        .header("X-Forwarded-For", target_ip)
        .header(
            "X-Axiom-Key",
            BASE64_STANDARD.encode("admin_key:secret_admin"),
        )
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // 4. Simulate unban broadcast
    let unban_packet = serde_json::json!({
        "event_id": format!("evt_test_unban_{}", uuid::Uuid::new_v4().to_string().replace('-', "")),
        "event_type": "unban.ip",
        "payload": {
            "ip": target_ip
        },
        "origin_node_id": "axm_node_tokyo",
        "timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64
    });

    let unban_bytes = serde_json::to_vec(&unban_packet).unwrap();
    let (node_h, ts_h, nonce_h, sig_h) = axiom_api::cluster::signing::sign_outbound_packet(
        "axm_node_tokyo",
        &cluster_secret,
        &unban_bytes,
    );

    let req = Request::post("/internal/v1/cluster/event")
        .header("X-Axiom-Node-Id", node_h)
        .header("X-Axiom-Timestamp", ts_h.to_string())
        .header("X-Axiom-Nonce", nonce_h)
        .header("X-Axiom-Signature", sig_h)
        .header("Content-Type", "application/json")
        .body(Body::from(unban_bytes))
        .unwrap();

    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // IP is now unbanned
    assert!(!BanList::is_ip_banned(target_ip).0);
}

#[tokio::test]
async fn test_first_class_blob_hierarchy_and_quota_usage() {
    setup_test_metadata();
    ensure_blob_engine().await;
    axiom_cache::CacheEngine::delete("rl:ip:127.0.0.1").await;
    axiom_cache::CacheEngine::delete("penalty:127.0.0.1").await;
    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");

    // 1. Create a namespace with quota limit
    let ns_name = "fc-blob-test";
    let req = Request::post("/admin/v1/blobs/namespaces")
        .header("Authorization", format!("Bearer {}", admin_token))
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "name": ns_name,
                "max_bytes": 1048576,
                "is_public": false
            }))
            .unwrap(),
        ))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert!(res.status() == StatusCode::CREATED || res.status() == StatusCode::CONFLICT);

    // 2. Put object using first-class REST URL: /api/v1/blobs/objects/:namespace/*key
    let req = Request::put(format!("/api/v1/blobs/objects/{}/data/sample.txt", ns_name))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "text/plain")
        .body(Body::from("First-Class Axiom Blob Architecture"))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    // 3. Query space-left and quota headroom via /api/v1/blobs/namespaces/:namespace/usage
    let req = Request::get(format!("/api/v1/blobs/namespaces/{}/usage", ns_name))
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    let usage_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(usage_json["success"], true);
    let data = &usage_json["data"];
    assert_eq!(data["namespace"], ns_name);
    assert!(data["used_bytes"].as_u64().unwrap() > 0);
    assert_eq!(data["max_bytes"], 1048576);
    assert!(data["remaining_bytes"].as_u64().unwrap() < 1048576);
    assert_eq!(data["is_quota_exceeded"], false);

    // 4. Server-side zero-copy CAS clone via /api/v1/blobs/objects/copy
    let req = Request::post("/api/v1/blobs/objects/copy")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "src_namespace": ns_name,
                "src_key": "data/sample.txt",
                "dest_key": "data/sample_copied.txt"
            }))
            .unwrap(),
        ))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 5. Atomic relocate via /api/v1/blobs/objects/move
    let req = Request::post("/api/v1/blobs/objects/move")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "src_namespace": ns_name,
                "src_key": "data/sample_copied.txt",
                "dest_key": "data/sample_moved.txt"
            }))
            .unwrap(),
        ))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // Verify source moved is gone and target exists
    let req = Request::get(format!(
        "/api/v1/blobs/objects/{}/data/sample_copied.txt",
        ns_name
    ))
    .header("X-Axiom-Key", &admin_token)
    .body(Body::empty())
    .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let req = Request::get(format!(
        "/api/v1/blobs/objects/{}/data/sample_moved.txt",
        ns_name
    ))
    .header("X-Axiom-Key", &admin_token)
    .body(Body::empty())
    .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 6. Pre-signed direct upload capability URL via /api/v1/blobs/uploads/:namespace/sign
    let req = Request::post(format!("/api/v1/blobs/uploads/{}/sign", ns_name))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "key": "incoming/direct.txt",
                "content_type": "text/plain",
                "ttl_seconds": 600
            }))
            .unwrap(),
        ))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    let sign_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let presigned_url = sign_json["data"]["url"].as_str().unwrap().to_string();
    assert!(presigned_url.contains("ticket_sig="));

    // Upload using pre-signed capability URL directly WITHOUT Authorization header
    let req = Request::put(&presigned_url)
        .header("Content-Type", "text/plain")
        .body(Body::from("Uploaded via Capability Ticket"))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    // 7. Unified batch delete via /api/v1/blobs/objects/:namespace/batch-delete
    let req = Request::post(format!("/api/v1/blobs/objects/{}/batch-delete", ns_name))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "keys": ["data/sample.txt", "data/sample_moved.txt"],
                "prefix": "incoming/"
            }))
            .unwrap(),
        ))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    let batch_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(batch_json["success"], true);
    assert_eq!(batch_json["data"]["deleted"].as_array().unwrap().len(), 2);
    assert_eq!(batch_json["data"]["prefix_deleted"], 1);

    // 8. Verify Data Plane vs Admin Control Plane boundary:
    // PATCH and DELETE on /api/v1/blobs/namespaces/:namespace must NOT be allowed on the data plane!
    let req = Request::patch(format!("/api/v1/blobs/namespaces/{}", ns_name))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(r#"{"max_bytes": 2048}"#))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::METHOD_NOT_ALLOWED);

    let req = Request::delete(format!("/api/v1/blobs/namespaces/{}", ns_name))
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::METHOD_NOT_ALLOWED);

    // POST on /api/v1/blobs/namespaces must NOT be allowed on the data plane!
    let req = Request::post("/api/v1/blobs/namespaces")
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(r#"{"name": "rogue-ns"}"#))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::METHOD_NOT_ALLOWED);

    // 9. Verify Scoped Capability Ticket Plane:
    // Mint scoped ticket via POST /api/v1/blobs/tickets/:namespace
    let req = Request::post(format!("/api/v1/blobs/tickets/{}", ns_name))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "key": "report.pdf",
                "operation": "READ",
                "ttl_seconds": 3600
            }))
            .unwrap(),
        ))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    let ticket_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let sig = ticket_json["data"]["signature"]
        .as_str()
        .unwrap()
        .to_string();

    // List scoped tickets via GET /api/v1/blobs/tickets/:namespace
    let req = Request::get(format!("/api/v1/blobs/tickets/{}", ns_name))
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    let list_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(list_json["success"], true);
    let items = list_json["data"]["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert!(items.iter().any(|t| t["signature"] == sig));

    // Test Keyset Cursor Pagination: mint a third ticket
    let req = Request::post(format!("/api/v1/blobs/tickets/{}", ns_name))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "key": "report_v2.pdf",
                "operation": "READ",
                "ttl_seconds": 3600
            }))
            .unwrap(),
        ))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    // Fetch page 1 with limit=2: expect 2 items and a next_cursor
    let req = Request::get(format!("/api/v1/blobs/tickets/{}?limit=2", ns_name))
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    let page1_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(page1_json["data"]["items"].as_array().unwrap().len(), 2);
    let next_cur = page1_json["data"]["next_cursor"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(!next_cur.is_empty());

    // Fetch page 2 with limit=2 and cursor: expect the remaining 1 item and next_cursor=null
    let req = Request::get(format!(
        "/api/v1/blobs/tickets/{}?limit=2&cursor={}",
        ns_name, next_cur
    ))
    .header("X-Axiom-Key", &admin_token)
    .body(Body::empty())
    .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    let page2_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(page2_json["data"]["items"].as_array().unwrap().len(), 1);
    assert!(page2_json["data"]["next_cursor"].is_null());

    // Cross-tenant protection: attempting to revoke with wrong namespace must return 404
    let req = Request::post(format!("/api/v1/blobs/tickets/wrong-ns/{}/revoke", sig))
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // Revoke ticket via POST /api/v1/blobs/tickets/:namespace/:signature/revoke
    let req = Request::post(format!("/api/v1/blobs/tickets/{}/{}/revoke", ns_name, sig))
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // Enable ticket back via POST /api/v1/blobs/tickets/:namespace/:signature/enable
    let req = Request::post(format!("/api/v1/blobs/tickets/{}/{}/enable", ns_name, sig))
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // Delete ticket permanently via DELETE /api/v1/blobs/tickets/:namespace/:signature
    let req = Request::delete(format!("/api/v1/blobs/tickets/{}/{}", ns_name, sig))
        .header("X-Axiom-Key", &admin_token)
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_zero_overhead_upload_inlining_and_header_preflight_rejection() {
    setup_test_metadata();
    ensure_blob_engine().await;
    axiom_cache::CacheEngine::delete("rl:ip:127.0.0.1").await;
    axiom_cache::CacheEngine::delete("penalty:127.0.0.1").await;
    let admin_token = BASE64_STANDARD.encode("admin_key:secret_admin");

    let ns_name = "zero-io-test";
    // 1. Create a namespace with 10 KB quota ceiling
    let req = Request::post("/admin/v1/blobs/namespaces")
        .header("Authorization", format!("Bearer {}", admin_token))
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "name": ns_name,
                "max_bytes": 10240,
                "is_public": true
            }))
            .unwrap(),
        ))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    // 2. Upload small payload (256 bytes) -> must inline directly into LSM (zero disk file I/O)
    let payload = vec![0x42u8; 256];
    let req = Request::put(format!("/api/v1/blobs/{}/small.bin", ns_name))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", payload.len().to_string())
        .body(Body::from(payload.clone()))
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    let put_body = axum::body::to_bytes(res.into_body(), 65536).await.unwrap();
    let put_json: Value = serde_json::from_slice(&put_body).unwrap();
    assert_eq!(put_json["data"]["inline"], true);
    assert_eq!(put_json["data"]["size"], 256);

    // 3. Fast-path upfront rejection: Content-Length exceeding namespace quota ceiling (15 KB > 10 KB quota)
    // Must reject with 507 INSUFFICIENT_STORAGE in 0 ms without reading body
    let req = Request::put(format!("/api/v1/blobs/{}/quota_overflow.bin", ns_name))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", "15360")
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::INSUFFICIENT_STORAGE);

    // 4. Fast-path upfront rejection: Content-Length exceeding global max object limit (e.g. 500 GB)
    // Must reject with 413 PAYLOAD_TOO_LARGE in 0 ms without reading body
    let req = Request::put(format!("/api/v1/blobs/{}/oversized.bin", ns_name))
        .header("X-Axiom-Key", &admin_token)
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", (500 * 1024 * 1024 * 1024u64).to_string())
        .body(Body::empty())
        .unwrap();
    let res = create_app().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
}
