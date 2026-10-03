/*
 * Axiom Comprehensive System & Pipeline Benchmark Suite
 * Owned by: benches
 * Key deps: criterion, tokio, axiom-core, axiom-policy, axiom-cache, axiom-db, axiom-api, axiom-metadata
 * Invariants: Hoists Axum router & runtime out of iteration loops to measure true request latency;
 *             covers Core (Group A), Policy (Group B), Cache (Group C), Middleware (Group D),
 *             Database/Filter (Group E), Metadata (Group F), and HTTP Pipeline (Group G).
 */

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use bytes::Bytes;
use base64::prelude::*;
use std::collections::HashMap;
use std::sync::Arc;
use tower::ServiceExt;
use axum::{body::Body, http::Request};

use axiom_core::{
    parse_size, format_size, AxiomConfig, AxiomError, AuthContext, ConfigManager, PermissionSnapshot,
};
use axiom_policy::PolicyEngine;
use axiom_cache::{CacheEngine, Durability};
use axiom_metadata::snapshot::{
    update_snapshot, ApiKeySnapshot, MetadataSnapshot, RoleSnapshot,
};
use axiom_api::middleware::auth::validate_api_key;
use axiom_api::database::filter_builder::build_where_clause;
use axiom_api::server::app::create_app;

// ─── Group A: Core Foundational Micro-Benchmarks ───────────────────────────

fn bench_core_operations(c: &mut Criterion) {
    let mut group = c.benchmark_group("core");

    group.bench_function("parse_size_hot", |b| {
        b.iter(|| {
            let s1 = parse_size(black_box("10mb"));
            let s2 = parse_size(black_box("1gb"));
            let s3 = parse_size(black_box("512kb"));
            let _ = black_box(s1);
            let _ = black_box(s2);
            let _ = black_box(s3);
        });
    });

    group.bench_function("parse_size_hostile", |b| {
        b.iter(|| {
            let s1 = parse_size(black_box("1000000000000000PB"));
            let s2 = parse_size(black_box("nan"));
            let s3 = parse_size(black_box("-500mb"));
            let _ = black_box(s1);
            let _ = black_box(s2);
            let _ = black_box(s3);
        });
    });

    group.bench_function("format_size", |b| {
        b.iter(|| {
            let f1 = format_size(black_box(10 * 1024 * 1024));
            let f2 = format_size(black_box(500 * 1024));
            black_box((f1, f2));
        });
    });

    group.bench_function("config_manager_get", |b| {
        b.iter(|| {
            let cfg = ConfigManager::get();
            black_box(cfg);
        });
    });

    group.bench_function("error_creation", |b| {
        b.iter(|| {
            let err = AxiomError::new(
                black_box("FORBIDDEN"),
                black_box("Access denied for requested resource"),
                black_box(axum::http::StatusCode::FORBIDDEN),
            );
            black_box(err);
        });
    });

    group.finish();
}

// ─── Group B: RBAC Policy Engine Micro-Benchmarks ───────────────────────────

fn bench_policy_evaluation(c: &mut Criterion) {
    let mut group = c.benchmark_group("policy");

    let auth_single = AuthContext {
        api_key_name: "test_key".to_string(),
        role: Some("operator".to_string()),
        is_session: false,
        permissions: vec![PermissionSnapshot {
            database: "main_db".to_string(),
            table_name: "users".to_string(),
            operations: vec!["SELECT".to_string(), "UPDATE".to_string()],
        }],
        ..Default::default()
    };

    group.bench_function("allow_single_exact_match", |b| {
        b.iter(|| {
            let res = PolicyEngine::evaluate(
                black_box(&auth_single),
                black_box("main_db"),
                black_box("users"),
                black_box("SELECT"),
            );
            let _ = black_box(res);
        });
    });

    let mut rules_10k = Vec::with_capacity(10_000);
    for i in 0..10_000 {
        rules_10k.push(PermissionSnapshot {
            database: format!("db_{}", i),
            table_name: format!("tbl_{}", i),
            operations: vec!["SELECT".to_string()],
        });
    }

    let auth_10k = AuthContext {
        api_key_name: "test_key_10k".to_string(),
        role: Some("restricted".to_string()),
        is_session: false,
        permissions: rules_10k,
        ..Default::default()
    };

    // Fast length-mismatch rejection: db_i string length (4..8) != "nonexistent_db" (14),
    // demonstrating fast-path rejection via pointer/length bounds check.
    group.bench_function("deny_scan_10k_rules_fast_rejection", |b| {
        b.iter(|| {
            let res = PolicyEngine::evaluate(
                black_box(&auth_10k),
                black_box("nonexistent_db"),
                black_box("nonexistent_table"),
                black_box("INSERT"),
            );
            let _ = black_box(res);
        });
    });

    // True worst-case linear scan: database and table_name match all 10,000 entries,
    // forcing complete string comparisons and operations array scans before final denial.
    let mut rules_10k_worst = Vec::with_capacity(10_000);
    for _ in 0..10_000 {
        rules_10k_worst.push(PermissionSnapshot {
            database: "target_database".to_string(),
            table_name: "target_table".to_string(),
            operations: vec!["SELECT".to_string(), "UPDATE".to_string()],
        });
    }

    let auth_10k_worst = AuthContext {
        api_key_name: "test_key_10k_worst".to_string(),
        role: Some("restricted".to_string()),
        is_session: false,
        permissions: rules_10k_worst,
        ..Default::default()
    };

    group.bench_function("deny_scan_10k_rules_worst_case", |b| {
        b.iter(|| {
            let res = PolicyEngine::evaluate(
                black_box(&auth_10k_worst),
                black_box("target_database"),
                black_box("target_table"),
                black_box("INSERT"),
            );
            let _ = black_box(res);
        });
    });

    let auth_wildcard = AuthContext {
        api_key_name: "admin_wildcard".to_string(),
        role: Some("admin".to_string()),
        is_session: false,
        permissions: vec![PermissionSnapshot {
            database: "*".to_string(),
            table_name: "*".to_string(),
            operations: vec!["*".to_string()],
        }],
        ..Default::default()
    };

    group.bench_function("wildcard_union_match", |b| {
        b.iter(|| {
            let res = PolicyEngine::evaluate(
                black_box(&auth_wildcard),
                black_box("arbitrary_db"),
                black_box("arbitrary_table"),
                black_box("DELETE"),
            );
            let _ = black_box(res);
        });
    });

    group.finish();
}

// ─── Group C: Cache Engine Micro-Benchmarks ────────────────────────────────

fn bench_cache_operations(c: &mut Criterion) {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()
        .unwrap();

    let mut group = c.benchmark_group("cache");

    // Pre-populate keys for GET benchmarks
    rt.block_on(async {
        CacheEngine::set("bench:hot_key", Bytes::from("hot_value_payload"), 3600, Durability::MemoryOnly).await;
    });

    group.bench_function("l1_get_hot_hit", |b| {
        b.to_async(&rt).iter(|| async {
            let res = CacheEngine::get(black_box("bench:hot_key")).await;
            black_box(res);
        });
    });

    group.bench_function("l1_get_miss", |b| {
        b.to_async(&rt).iter(|| async {
            let res = CacheEngine::get(black_box("bench:nonexistent_key")).await;
            black_box(res);
        });
    });

    group.bench_function("l1_set_memory_only", |b| {
        let val = Bytes::from("benchmark_value_payload");
        b.to_async(&rt).iter(|| async {
            CacheEngine::set(
                black_box("bench:write_key"),
                black_box(val.clone()),
                black_box(300),
                black_box(Durability::MemoryOnly),
            )
            .await;
        });
    });

    group.bench_function("check_rate_limit_contended", |b| {
        b.iter(|| {
            let (is_banned, count) = CacheEngine::check_rate_limit(
                black_box("bench:rl_ip:127.0.0.1"),
                black_box(60),
                black_box(100_000),
                black_box("bench:rl_pen:127.0.0.1"),
                black_box(300),
                black_box(5),
            );
            black_box((is_banned, count));
        });
    });

    group.bench_function("sweep_expired", |b| {
        b.to_async(&rt).iter(|| async {
            CacheEngine::sweep_expired().await;
        });
    });

    group.finish();
}

// ─── Group D: Authentication & Middleware Micro-Benchmarks ───────────────────

fn bench_auth_verification(c: &mut Criterion) {
    let mut group = c.benchmark_group("middleware");

    let mut keys = HashMap::new();
    let mut roles = HashMap::new();

    roles.insert(
        "admin".to_string(),
        RoleSnapshot {
            name: "admin".to_string(),
            permissions: vec![axiom_metadata::snapshot::PermissionSnapshot {
                database: "*".to_string(),
                table_name: "*".to_string(),
                operations: vec!["*".to_string()],
            }],
        },
    );

    keys.insert(
        "bench_admin".to_string(),
        ApiKeySnapshot {
            name: "bench_admin".to_string(),
            secret_hash: blake3::hash(b"bench_secret_key_12345").into(),
            role_name: Some("admin".to_string()),
            rate_limit_override: 0,
            expires_at: None,
        },
    );

    update_snapshot(MetadataSnapshot {
        keys,
        roles,
        databases: HashMap::new(),
        loaded_at_unix: 0,
    });

    let config = AxiomConfig::default();
    let valid_token = BASE64_STANDARD.encode("bench_admin:bench_secret_key_12345");
    let invalid_token = BASE64_STANDARD.encode("bench_admin:wrong_password");

    group.bench_function("auth_snapshot_valid_hit", |b| {
        b.iter(|| {
            let res = validate_api_key(black_box(&valid_token), black_box(&config));
            let _ = black_box(res);
        });
    });

    group.bench_function("auth_snapshot_wrong_secret", |b| {
        b.iter(|| {
            let res = validate_api_key(black_box(&invalid_token), black_box(&config));
            let _ = black_box(res);
        });
    });

    group.finish();
}

// ─── Group E: Database & Filter Builder Micro-Benchmarks ────────────────────

fn bench_filter_builder(c: &mut Criterion) {
    let mut group = c.benchmark_group("database");

    // Simple multi-field filter with $eq, $gte, and small $in array
    let mut simple_filter = HashMap::new();
    simple_filter.insert("status".to_string(), serde_json::json!({ "$eq": "active" }));
    simple_filter.insert("age".to_string(), serde_json::json!({ "$gte": 21 }));
    simple_filter.insert("role".to_string(), serde_json::json!({ "$in": ["admin", "operator"] }));

    group.bench_function("filter_build_simple", |b| {
        b.iter(|| {
            let (sql, params) = build_where_clause(black_box(&simple_filter));
            black_box((sql.len(), params.len()));
        });
    });

    // 500-element $in array stress test: verifies full placeholder generation (?, ?, ...)
    // and parameter extraction without lazy drops or dead-code elimination.
    let in_items: Vec<String> = (0..500).map(|i| format!("item_{}", i)).collect();
    let mut in_500_filter = HashMap::new();
    in_500_filter.insert("item_id".to_string(), serde_json::json!({ "$in": in_items }));

    group.bench_function("filter_build_in_500", |b| {
        b.iter(|| {
            let (sql, params) = build_where_clause(black_box(&in_500_filter));
            black_box((sql.len(), params.len()));
        });
    });

    // Multi-clause mixed comparison filter
    let mut nested_filter = HashMap::new();
    nested_filter.insert("group1".to_string(), serde_json::json!({ "$eq": "alpha" }));
    nested_filter.insert("group2".to_string(), serde_json::json!({ "$ne": "beta" }));
    nested_filter.insert("group3".to_string(), serde_json::json!({ "$gt": 100 }));
    nested_filter.insert("group4".to_string(), serde_json::json!({ "$lte": 500 }));
    nested_filter.insert("group5".to_string(), serde_json::json!({ "$like": "%search%" }));

    group.bench_function("filter_build_multi_clause", |b| {
        b.iter(|| {
            let (sql, params) = build_where_clause(black_box(&nested_filter));
            black_box((sql.len(), params.len()));
        });
    });

    // AST Validation: Uncached SQL AST parse vs Cached AST metadata lookup
    let sql_stmt = "SELECT id, name, email, created_at FROM users WHERE status = ? AND age >= ? ORDER BY created_at DESC";
    group.bench_function("ast_uncached_parse", |b| {
        b.iter(|| {
            let res = sqlparser::parser::Parser::parse_sql(&sqlparser::dialect::PostgreSqlDialect {}, black_box(sql_stmt));
            black_box(res.map(|s| s.len()).unwrap_or(0));
        });
    });

    let ast_cache = dashmap::DashMap::new();
    let sample_info = std::sync::Arc::new(axiom_api::database::handlers::CachedAstInfo {
        is_mutation: false,
        operations: vec![("SELECT", vec!["users".to_string()])],
        formatted_sql: Some(sql_stmt.replace('?', "$1")),
        multiple_statements: None,
    });
    ast_cache.insert(format!("postgres:{}", sql_stmt), sample_info);

    group.bench_function("ast_cache_lookup_hot", |b| {
        let key = format!("postgres:{}", sql_stmt);
        b.iter(|| {
            let entry = ast_cache.get(black_box(&key));
            black_box(entry.is_some());
        });
    });

    group.finish();
}

// ─── Group F: Metadata Snapshot Micro-Benchmarks ───────────────────────────

fn bench_metadata_snapshot(c: &mut Criterion) {
    let mut group = c.benchmark_group("metadata");

    group.bench_function("snapshot_read_atomic", |b| {
        b.iter(|| {
            let snap = axiom_metadata::snapshot::get_snapshot();
            black_box(snap);
        });
    });

    let mut roles = HashMap::new();
    for i in 0..100 {
        roles.insert(
            format!("role_{}", i),
            RoleSnapshot {
                name: format!("role_{}", i),
                permissions: vec![axiom_metadata::snapshot::PermissionSnapshot {
                    database: "db".to_string(),
                    table_name: "tbl".to_string(),
                    operations: vec!["SELECT".to_string()],
                }],
            },
        );
    }

    let snap_to_publish = MetadataSnapshot {
        keys: HashMap::new(),
        roles,
        databases: HashMap::new(),
        loaded_at_unix: 12345678,
    };

    group.bench_function("snapshot_publish_update", |b| {
        b.iter(|| {
            update_snapshot(black_box(snap_to_publish.clone()));
        });
    });

    group.finish();
}

// ─── Group G: Hoisted Axum HTTP Pipeline Benchmarks ────────────────────────

fn bench_http_pipeline(c: &mut Criterion) {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()
        .unwrap();

    let mut group = c.benchmark_group("http_pipeline");

    // CRITICAL: Hoist create_app() outside the benchmark iteration loop!
    // Building the app inside iter() measures router construction rather than request latency.
    let app = Arc::new(create_app());

    group.bench_function("get_ready_endpoint", |b| {
        let app = Arc::clone(&app);
        b.to_async(&rt).iter(|| {
            let app = Arc::clone(&app);
            async move {
                let req = Request::get("/ready").body(Body::empty()).unwrap();
                let res = (*app).clone().oneshot(req).await.unwrap();
                black_box(res);
            }
        });
    });

    group.bench_function("get_health_endpoint", |b| {
        let app = Arc::clone(&app);
        b.to_async(&rt).iter(|| {
            let app = Arc::clone(&app);
            async move {
                let req = Request::get("/health").body(Body::empty()).unwrap();
                let res = (*app).clone().oneshot(req).await.unwrap();
                black_box(res);
            }
        });
    });

    group.bench_function("get_metrics_endpoint", |b| {
        let app = Arc::clone(&app);
        b.to_async(&rt).iter(|| {
            let app = Arc::clone(&app);
            async move {
                let req = Request::get("/metrics").body(Body::empty()).unwrap();
                let res = (*app).clone().oneshot(req).await.unwrap();
                black_box(res);
            }
        });
    });

    group.bench_function("unauthorized_admin_rejection", |b| {
        let app = Arc::clone(&app);
        b.to_async(&rt).iter(|| {
            let app = Arc::clone(&app);
            async move {
                let req = Request::get("/admin/v1/keys").body(Body::empty()).unwrap();
                let res = (*app).clone().oneshot(req).await.unwrap();
                black_box(res);
            }
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_core_operations,
    bench_policy_evaluation,
    bench_cache_operations,
    bench_auth_verification,
    bench_filter_builder,
    bench_metadata_snapshot,
    bench_http_pipeline
);
criterion_main!(benches);
