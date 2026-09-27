/*
 * Axiom core library crate providing API, auth, policy, cache, DB, and admin subsystems.
 * Owned by: core
 * Key deps: axum, tokio, libsql, dashmap, arc-swap, blake3, argon2
 * Invariants: Decoupled library architecture enabling standalone binary dispatch and integration testing.
 * Last structural change: Phase 8 hardening integration.
 */

pub mod api;
pub mod cache;
pub mod cli;
pub mod config;
pub mod db;
pub mod logging;
pub mod metadata;
pub mod metrics;
pub mod middleware;
pub mod policy;
pub mod security;
pub mod server;
pub mod utils;
