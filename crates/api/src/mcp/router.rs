/*
 * Model Context Protocol (MCP) route registration and router factory.
 * Owned by: api/mcp
 * Key deps: axum, crate::mcp::handlers::handle_mcp
 * Invariants: MCP endpoint is exclusively POST; authenticated and rate-limited at root level.
 * Last structural change: Phase 4 initial implementation of MCP router.
 */

use axum::{routing::post, Router};
use crate::mcp::handlers::handle_mcp;

/// Returns an Axum Router binding the JSON-RPC Model Context Protocol handler.
/// CONTRACT:
///  - Returns Router configured for `POST /` (matching `/mcp/v1` when nested).
///  - Side effects: None.
///  - Idempotent: Yes.
pub fn get_router() -> Router {
    Router::new()
        .route("/", post(handle_mcp))
}
