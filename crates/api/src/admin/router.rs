/*
 * Admin API router definition mounted under `/admin/v1`.
 * Owned by: api/admin
 * Key deps: axum, crate::admin::handlers
 * Invariants: Mounted behind authentication middleware enforcing administrative capabilities.
 * Last structural change: Phase 1 initial implementation of Admin router.
 */

use axum::{
    routing::{delete, get, patch, post},
    Router,
};
use crate::admin::handlers::*;

/// Constructs the Admin API sub-router.
/// CONTRACT:
///  - Returns Router with public endpoints (/setup/begin, /setup/account, /auth/login)
///    and protected endpoints (/status, /keys, /databases, etc.) guarded by auth_middleware.
pub fn get_router() -> Router {
    let public_routes = Router::new()
        .route("/setup/begin", get(setup_begin).post(setup_begin))
        .route("/setup/account", post(setup_account))
        .route("/setup/database/test", post(test_database_url))
        .route("/auth/login", post(login_handler));

    let protected_routes = Router::new()
        .route("/status", get(get_status))
        .route("/reload", post(reload_metadata))
        .route("/keys", get(list_keys).post(create_key))
        .route("/keys/:name/rotate", post(rotate_key))
        .route("/keys/:name", delete(delete_key))
        .route("/roles", get(list_roles).post(create_role))
        .route("/roles/:name", patch(update_role).delete(delete_role))
        .route("/databases", get(list_databases).post(add_database))
        .route("/databases/test-url", post(test_database_url))
        .route("/databases/:alias/test", get(test_database))
        .route("/databases/:alias", delete(delete_database))
        .route("/cache/stats", get(get_cache_stats))
        .route("/cache/flush", post(flush_cache))
        .route("/audit", get(get_audit_log))
        .route("/metrics", get(get_metrics))
        .route("/health", get(get_admin_health))
        .route("/setup/database", post(setup_database))
        .route("/setup/complete", post(setup_complete))
        .route("/auth/logout", post(logout_handler))
        .route("/users", get(list_users_handler))
        .layer(axum::middleware::from_fn(crate::middleware::auth::auth_middleware));

    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
}
