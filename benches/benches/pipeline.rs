/*
 * Axiom Benchmark Suite (Phase 8 — Native Rust Harness)
 * Owned by: benches
 * Key deps: criterion, tokio, axiom-core, axiom-cache, axiom-api, axiom-metadata
 * Invariants: Eliminates external network jitter by benchmarking in-process hot paths and in-memory Axum dispatch.
 */

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use bytes::Bytes;
use base64::prelude::*;
use std::collections::HashMap;
use tower::ServiceExt;
use axum::{body::Body, http::Request};

use axiom_cache::{CacheEngine, Durability};
use axiom_metadata::snapshot::{
    update_snapshot, ApiKeySnapshot, MetadataSnapshot, PermissionSnapshot, RoleSnapshot,
};
use axiom_api::middleware::auth::validate_api_key;
use axiom_api::database::filter_builder::build_where_clause;
use axiom_api::server::app::create_app;

// ─── 1. Cache Engine Micro-Benchmarks ──────────────────────────────────────
fn bench_cache_operations(c: &mut Criterion) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    let mut group = c.benchmark_group("cache");

    // Pre-populate key for GET benchmark
    rt.block_on(async {
        CacheEngine::set("bench:hot_key", Bytes::from("hot_value_payload"), 3600, Durability::MemoryOnly).await;
    });

    group.bench_function("l1_get_hot", |b| {
        b.to_async(&rt).iter(|| async {
            let res = CacheEngine::get(black_box("bench:hot_key")).await;
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

    group.finish();
}

// ─── 2. Auth Snapshot Micro-Benchmarks ──────────────────────────────────────
fn bench_auth_verification(c: &mut Criterion) {
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

    let config = axiom_core::AxiomConfig::default();
    let valid_token = BASE64_STANDARD.encode("bench_admin:bench_secret_key_12345");

    c.bench_function("auth_validate_api_key_snapshot", |b| {
        b.iter(|| {
            let res = validate_api_key(black_box(&valid_token), black_box(&config));
            let _ = black_box(res);
        });
    });
}

// ─── 3. Filter Builder Micro-Benchmarks ────────────────────────────────────
fn bench_filter_builder(c: &mut Criterion) {
    let mut filter_map = HashMap::new();
    filter_map.insert("status".to_string(), serde_json::json!({ "eq": "active" }));
    filter_map.insert("age".to_string(), serde_json::json!({ "gte": 21 }));
    filter_map.insert("role".to_string(), serde_json::json!({ "in": ["admin", "operator"] }));

    c.bench_function("filter_build_where_clause", |b| {
        b.iter(|| {
            let res = build_where_clause(black_box(&filter_map));
            black_box(res);
        });
    });
}

// ─── 4. Full In-Memory HTTP Pipeline Benchmark ─────────────────────────────
fn bench_http_pipeline(c: &mut Criterion) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    let mut group = c.benchmark_group("http_pipeline");

    group.bench_function("get_ready_endpoint", |b| {
        b.to_async(&rt).iter(|| async {
            let app = create_app();
            let req = Request::get("/ready").body(Body::empty()).unwrap();
            let res = app.oneshot(req).await.unwrap();
            black_box(res);
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_cache_operations,
    bench_auth_verification,
    bench_filter_builder,
    bench_http_pipeline
);
criterion_main!(benches);
