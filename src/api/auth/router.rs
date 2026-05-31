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
        // Anonymous Auth
        .route("/anonymous", post(handler_anonymous_login))
        .route("/anonymous/upgrade", post(handler_anonymous_upgrade))
        // TOTP
        .route("/totp/enroll", post(handler_totp_enroll))
        .route("/totp/confirm", post(handler_totp_confirm))
        .route("/totp/verify", post(handler_totp_verify))
        .route("/totp/disable", post(handler_totp_disable))
        .route("/totp/backup/verify", post(handler_totp_backup_verify))
        .route("/totp/backup/regenerate", get(handler_totp_backup_regenerate))
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
        .route("/admin/users", get(admin_list_users))
        .route("/admin/users/:uid", get(admin_get_user).patch(admin_update_user).delete(admin_delete_user))
        .route("/admin/users/:uid/sessions/revoke", post(admin_revoke_sessions))
        .route("/admin/audit", get(admin_audit_log))
        .route("/admin/templates", get(admin_list_templates))
        .route("/admin/templates/:type_name", axum::routing::put(admin_update_template).delete(admin_delete_template))
        .route("/admin/users/import", post(admin_import_users))
        .route("/admin/users/import/:job_id", get(admin_get_import_job))
        .route("/admin/users/export", get(admin_export_users))
        
        // Magic Links
        .route("/magic-link", post(handler_magic_link_send))
        .route("/magic-link/verify", post(handler_magic_link_verify))
        
        // OTP
        .route("/verify/otp", post(handler_verify_otp))
        .route("/otp/send", post(handler_otp_send))
        .route("/resend", post(handler_resend))
        
        // Additional User routes
        .route("/user", get(handler_get_me).patch(handler_update_me).delete(handler_delete_me))
        .route("/user/email", post(handler_change_email))
        .route("/user/email/confirm", post(handler_change_email_confirm))
        .route("/user/password", post(handler_change_password))
}
