/*
 * Model Context Protocol (MCP) engine module exposing tools and resources for AI agents.
 * Owned by: api/mcp
 * Key deps: axum, serde_json
 * Invariants: Single unified endpoint `/mcp/v1` accepting JSON-RPC 2.0 payloads.
 * Last structural change: Phase 4 initial implementation of the MCP module.
 */

pub mod handlers;
pub mod router;
pub mod schema;

pub use router::get_router;
