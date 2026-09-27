/*
 * HTTP request processing middleware pipeline module registry.
 * Owned by: middleware
 * Key deps: axum, tower
 * Invariants: Middlewares evaluate in strict order: WAF -> Rate Limit -> Auth -> Route handlers.
 * Last structural change: Phase 6 addition of metrics middleware.
 */

pub mod auth;
pub mod cache;
pub mod metrics;
pub mod rate_limit;
pub mod waf;
pub mod response;
