/*
 * Top-level API module exposing core health probes, admin control plane, and database data plane.
 * Owned by: api
 * Key deps: axum
 * Invariants: Routes are structured by operational plane and API version.
 * Last structural change: Phase 4 addition of Model Context Protocol (MCP) engine.
 */

pub mod admin;
pub mod core;
pub mod database;
pub mod errors;
pub mod mcp;
pub mod ui;
