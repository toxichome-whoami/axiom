/*
 * Core telemetry, readiness probes, and root health check routes.
 * Owned by: crates/api (core)
 * Key deps: axum, sysinfo
 * Invariants: Liveness and readiness endpoints do not require authentication for orchestrator probes.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

pub mod health;
