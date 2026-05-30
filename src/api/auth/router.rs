use axum::{
    routing::{delete, get, post},
    Router,
};

use crate::api::auth::handlers::*;

pub fn get_router() -> Router {
    Router::new()
        // JWKS
        .route("/.well-known/jwks.json", get(handler_jwks))
        // Core Auth
        .route("/signup", post(handler_signup))
        .route("/login", post(handler_login))
        .route("/refresh", post(handler_refresh))
        .route("/logout", post(handler_logout))
        // Session management
        .route("/user/sessions", get(handler_get_sessions))
        .route("/user/sessions", delete(handler_revoke_all_sessions))
        // Email verification
        .route("/verify/email", post(handler_verify_email))
        .route("/verify", get(handler_verify_email_get))
        // Password flows
        .route("/password/forgot", post(handler_forgot_password))
        .route("/password/reset", post(handler_reset_password))
        // User profile
        .route("/user", get(handler_get_me))
        // Admin routes
        .route("/admin/users", get(admin_list_users))
        .route("/admin/users/:uid", delete(admin_delete_user))
        .route("/admin/audit", get(admin_audit_log))
}
