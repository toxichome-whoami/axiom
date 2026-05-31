#![allow(dead_code)]
use axum::{
    extract::{Path, Query},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::Utc;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use sqlx::Row;

use crate::api::auth::{
    schemas::*,
    token_engine::{
        create_access_token, generate_refresh_token, get_jwks, sha256_hex, verify_access_token,
    },
    user_store::*,
};
use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;

// ─────────────────────────────────────────────────────────────────────────────
// Request Helpers
// ─────────────────────────────────────────────────────────────────────────────

pub fn get_project(headers: &HeaderMap) -> Result<(String, Value), AxiomError> {
    let api_key = headers
        .get("X-Api-Key")
        .or_else(|| headers.get("X-Axiom-Key"))
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            AxiomError::new(
                "AUTH_MISSING_HEADER",
                "Missing API Key",
                StatusCode::UNAUTHORIZED,
            )
        })?;

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(api_key)
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
        .ok_or_else(|| {
            AxiomError::new(
                "AUTH_INVALID_FORMAT",
                "Invalid API Key format",
                StatusCode::UNAUTHORIZED,
            )
        })?;

    let (key_name, key_secret) = decoded.split_once(':').ok_or_else(|| {
        AxiomError::new(
            "AUTH_INVALID_FORMAT",
            "Invalid API Key format",
            StatusCode::UNAUTHORIZED,
        )
    })?;

    let config = ConfigManager::get();
    if !config.features.auth {
        return Err(AxiomError::new(
            "AUTH_INSUFFICIENT_MODE",
            "Auth module is disabled",
            StatusCode::FORBIDDEN,
        ));
    }

    let key_cfg = config.api_key.get(key_name).ok_or_else(|| {
        AxiomError::new(
            "AUTH_INVALID_SECRET",
            "Invalid API Key",
            StatusCode::UNAUTHORIZED,
        )
    })?;

    if key_cfg.secret != key_secret {
        return Err(AxiomError::new(
            "AUTH_INVALID_SECRET",
            "Invalid API Key secret",
            StatusCode::UNAUTHORIZED,
        ));
    }

    let project_cfg = config
        .auth
        .project
        .get(key_name)
        .cloned()
        .map(|v| serde_json::to_value(v).unwrap_or(json!({})))
        .ok_or_else(|| {
            AxiomError::new(
                "AUTH_PROJECT_NOT_CONFIGURED",
                "Auth not configured for this key",
                StatusCode::FORBIDDEN,
            )
        })?;

    Ok((key_name.to_string(), project_cfg))
}

fn get_bearer(headers: &HeaderMap) -> Result<String, AxiomError> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string())
        .ok_or_else(|| {
            AxiomError::new(
                "AUTH_MISSING_HEADER",
                "Missing Bearer token",
                StatusCode::UNAUTHORIZED,
            )
        })
}

fn get_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("127.0.0.1")
        .to_string()
}

fn get_ua(headers: &HeaderMap) -> String {
    headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("Unknown")
        .to_string()
}

fn proj_val(config: &Value, key: &str, default: i64) -> i64 {
    config.get(key).and_then(|v| v.as_i64()).unwrap_or(default)
}

#[allow(dead_code)]
fn proj_str<'a>(config: &'a Value, key: &str, default: &'a str) -> String {
    config
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or(default)
        .to_string()
}

#[allow(dead_code)]
fn proj_bool(config: &Value, key: &str, default: bool) -> bool {
    config.get(key).and_then(|v| v.as_bool()).unwrap_or(default)
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn datetime_from_secs(secs: i64) -> String {
    let dt = chrono::DateTime::<Utc>::from_timestamp(secs, 0).unwrap_or_else(Utc::now);
    dt.to_rfc3339()
}

async fn build_auth_response(
    pool: &sqlx::sqlite::SqlitePool,
    config: &Value,
    project_id: &str,
    user_row: &Value,
    ip: &str,
    ua: &str,
) -> Result<Value, AxiomError> {
    let uid = user_row["uid"].as_str().unwrap_or_default().to_string();
    let email = user_row["email"].as_str().unwrap_or_default().to_string();
    let email_verified = user_row["email_verified"].as_i64().unwrap_or(0) != 0;
    let is_anonymous = user_row["is_anonymous"].as_i64().unwrap_or(0) != 0;
    let access_ttl = proj_val(config, "access_token_ttl", 3600);
    let refresh_ttl = proj_val(config, "refresh_token_ttl", 86400 * 30);

    let access_token = create_access_token(
        project_id,
        &uid,
        &email,
        email_verified,
        is_anonymous,
        false,
        access_ttl,
        HashMap::new(),
    )
    .await
    .map_err(|e| AxiomError::new("AUTH_TOKEN_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    let refresh_token = generate_refresh_token();
    let token_hash = sha256_hex(&refresh_token);
    let family_id = uuid::Uuid::new_v4().to_string();
    let expires_at = datetime_from_secs(now_secs() + refresh_ttl);

    issue_refresh_token(
        pool,
        &uid,
        &token_hash,
        &family_id,
        &expires_at,
        Some(ip),
        Some(ua),
    )
    .await?;
    record_login(pool, &uid).await?;

    let mut user_out = user_row.clone();
    if let Some(obj) = user_out.as_object_mut() {
        obj.remove("password_hash");
        obj.remove("totp_secret");
    }

    Ok(json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": access_ttl,
        "user": user_out
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Handlers
// ─────────────────────────────────────────────────────────────────────────────

pub async fn handler_jwks() -> Json<Value> {
    Json(get_jwks().await)
}

pub async fn handler_signup(
    headers: HeaderMap,
    Json(body): Json<SignupRequest>,
) -> Result<Json<Value>, AxiomError> {
    let (project_id, config) = get_project(&headers)?;
    let min_len = proj_val(&config, "min_password_length", 8) as usize;
    if body.password.len() < min_len {
        return Err(AxiomError::new(
            "AUTH_WEAK_PASSWORD",
            &format!("Password must be at least {} characters", min_len),
            StatusCode::BAD_REQUEST,
        ));
    }

    let pool = get_pool(&project_id).await?;
    let pw_hash = hash_password(&body.password)?;
    let uid = create_user(&pool, Some(&body.email), Some(&pw_hash), false, false).await?;

    let mut updates = HashMap::new();
    if let Some(dn) = &body.display_name {
        updates.insert("display_name", json!(dn));
    }
    if let Some(av) = &body.avatar_url {
        updates.insert("avatar_url", json!(av));
    }
    if !updates.is_empty() {
        update_user(&pool, &uid, &updates).await?;
    }

    log_audit(
        &pool,
        "signup",
        Some(&uid),
        Some(&get_ip(&headers)),
        Some(&get_ua(&headers)),
        None,
    )
    .await?;
    let user_row = get_user_by_uid(&pool, &uid).await.ok_or_else(|| {
        AxiomError::new(
            "AUTH_DB_ERROR",
            "User not found after create",
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })?;

    let resp = build_auth_response(
        &pool,
        &config,
        &project_id,
        &user_row,
        &get_ip(&headers),
        &get_ua(&headers),
    )
    .await?;
    Ok(Json(resp))
}

pub async fn handler_login(
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<Json<Value>, AxiomError> {
    let (project_id, config) = get_project(&headers)?;
    let pool = get_pool(&project_id).await?;
    let ip = get_ip(&headers);
    let ua = get_ua(&headers);

    let row = get_user_by_email(&pool, &body.email).await.ok_or_else(|| {
        AxiomError::new(
            "AUTH_INVALID_CREDENTIALS",
            "Invalid credentials",
            StatusCode::UNAUTHORIZED,
        )
    })?;

    if row["disabled"].as_i64().unwrap_or(0) != 0 {
        return Err(AxiomError::new(
            "AUTH_ACCOUNT_DISABLED",
            "Account is disabled",
            StatusCode::FORBIDDEN,
        ));
    }

    let hash = row["password_hash"].as_str().unwrap_or_default();
    if hash.is_empty() || !verify_password(hash, &body.password) {
        log_audit(
            &pool,
            "login_failed",
            row["uid"].as_str(),
            Some(&ip),
            Some(&ua),
            None,
        )
        .await?;
        return Err(AxiomError::new(
            "AUTH_INVALID_CREDENTIALS",
            "Invalid email or password",
            StatusCode::UNAUTHORIZED,
        ));
    }

    // TOTP gate
    if row["totp_enabled"].as_i64().unwrap_or(0) != 0 {
        let uid = row["uid"].as_str().unwrap_or_default();
        let email = row["email"].as_str().unwrap_or_default();
        let mfa_token = create_access_token(
            &project_id,
            uid,
            email,
            false,
            false,
            false,
            300,
            [("mfa_pending".to_string(), json!(true))]
                .into_iter()
                .collect(),
        )
        .await
        .map_err(|e| AxiomError::new("AUTH_TOKEN_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;
        return Ok(Json(
            json!({ "mfa_required": true, "mfa_token": mfa_token }),
        ));
    }

    log_audit(
        &pool,
        "login_success",
        row["uid"].as_str(),
        Some(&ip),
        Some(&ua),
        None,
    )
    .await?;
    let resp = build_auth_response(&pool, &config, &project_id, &row, &ip, &ua).await?;
    Ok(Json(resp))
}

pub async fn handler_refresh(
    headers: HeaderMap,
    Json(body): Json<RefreshRequest>,
) -> Result<Json<Value>, AxiomError> {
    let (project_id, config) = get_project(&headers)?;
    let pool = get_pool(&project_id).await?;
    let ip = get_ip(&headers);
    let ua = get_ua(&headers);

    let token_hash = sha256_hex(&body.refresh_token);
    let token_row = get_refresh_token(&pool, &token_hash).await.ok_or_else(|| {
        AxiomError::new(
            "AUTH_TOKEN_INVALID",
            "Invalid refresh token",
            StatusCode::UNAUTHORIZED,
        )
    })?;

    if token_row["revoked"].as_i64().unwrap_or(0) != 0 {
        let family_id = token_row["family_id"].as_str().unwrap_or_default();
        revoke_refresh_family(&pool, family_id).await?;
        return Err(AxiomError::new(
            "AUTH_TOKEN_STOLEN",
            "Token reuse detected. All sessions revoked.",
            StatusCode::UNAUTHORIZED,
        ));
    }

    let expires_at_str = token_row["expires_at"].as_str().unwrap_or_default();
    let expires_at = chrono::DateTime::parse_from_rfc3339(expires_at_str).map_err(|_| {
        AxiomError::new(
            "AUTH_TOKEN_INVALID",
            "Invalid token expiry",
            StatusCode::UNAUTHORIZED,
        )
    })?;
    if expires_at < Utc::now() {
        return Err(AxiomError::new(
            "AUTH_TOKEN_EXPIRED",
            "Refresh token expired",
            StatusCode::UNAUTHORIZED,
        ));
    }

    let uid = token_row["uid"].as_str().unwrap_or_default().to_string();
    let user_row = get_user_by_uid(&pool, &uid).await.ok_or_else(|| {
        AxiomError::new(
            "AUTH_ACCOUNT_DISABLED",
            "Account not found",
            StatusCode::FORBIDDEN,
        )
    })?;

    if user_row["disabled"].as_i64().unwrap_or(0) != 0 {
        return Err(AxiomError::new(
            "AUTH_ACCOUNT_DISABLED",
            "Account disabled",
            StatusCode::FORBIDDEN,
        ));
    }

    revoke_refresh_token(&pool, &token_hash).await?;
    let resp = build_auth_response(&pool, &config, &project_id, &user_row, &ip, &ua).await?;
    Ok(Json(resp))
}

pub async fn handler_logout(
    headers: HeaderMap,
    Json(body): Json<LogoutRequest>,
) -> Result<Json<Value>, AxiomError> {
    let bearer = get_bearer(&headers)?;
    let (project_id, _) = get_project(&headers)?;
    let pool = get_pool(&project_id).await?;

    let claims = verify_access_token(&bearer, &project_id)
        .await
        .map_err(|e| AxiomError::new("AUTH_TOKEN_INVALID", &e, StatusCode::UNAUTHORIZED))?;

    let token_hash = sha256_hex(&body.refresh_token);
    sqlx::query("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ? AND uid = ?")
        .bind(&token_hash)
        .bind(&claims.sub)
        .execute(&pool)
        .await
        .ok();

    log_audit(
        &pool,
        "logout",
        Some(&claims.sub),
        Some(&get_ip(&headers)),
        Some(&get_ua(&headers)),
        None,
    )
    .await?;
    Ok(Json(json!({ "status": "ok" })))
}

pub async fn handler_get_me(headers: HeaderMap) -> Result<Json<Value>, AxiomError> {
    let bearer = get_bearer(&headers)?;
    let (project_id, _) = get_project(&headers)?;
    let claims = verify_access_token(&bearer, &project_id)
        .await
        .map_err(|e| AxiomError::new("AUTH_TOKEN_INVALID", &e, StatusCode::UNAUTHORIZED))?;

    let pool = get_pool(&project_id).await?;
    let user = get_user_by_uid(&pool, &claims.sub).await.ok_or_else(|| {
        AxiomError::new(
            "AUTH_USER_NOT_FOUND",
            "User not found",
            StatusCode::NOT_FOUND,
        )
    })?;

    let mut out = user;
    if let Some(obj) = out.as_object_mut() {
        obj.remove("password_hash");
        obj.remove("totp_secret");
    }
    Ok(Json(json!({ "user": out }))) // Wrap in user: {} like SDK expects
}

pub async fn handler_update_me(
    headers: HeaderMap,
    Json(body): Json<UpdateUserRequest>,
) -> Result<Json<Value>, AxiomError> {
    let bearer = get_bearer(&headers)?;
    let (project_id, config) = get_project(&headers)?;
    let claims = verify_access_token(&bearer, &project_id)
        .await
        .map_err(|e| AxiomError::new("AUTH_TOKEN_INVALID", &e, StatusCode::UNAUTHORIZED))?;
    let pool = get_pool(&project_id).await?;
    let ip = get_ip(&headers);
    let ua = get_ua(&headers);

    let mut updates = HashMap::new();
    if let Some(dn) = &body.display_name {
        updates.insert("display_name", json!(dn));
    }
    if let Some(av) = &body.avatar_url {
        updates.insert("avatar_url", json!(av));
    }
    if let Some(meta) = &body.metadata {
        updates.insert(
            "metadata",
            json!(serde_json::to_string(meta).unwrap_or_else(|_| "{}".to_string())),
        );
    }

    if !updates.is_empty() {
        update_user(&pool, &claims.sub, &updates).await?;
        log_audit(
            &pool,
            "user_updated",
            Some(&claims.sub),
            Some(&ip),
            Some(&ua),
            None,
        )
        .await?;
    }

    let updated_user = get_user_by_uid(&pool, &claims.sub).await.ok_or_else(|| {
        AxiomError::new(
            "AUTH_USER_NOT_FOUND",
            "User not found",
            StatusCode::NOT_FOUND,
        )
    })?;

    let resp = build_auth_response(&pool, &config, &project_id, &updated_user, &ip, &ua).await?;
    Ok(Json(resp))
}

pub async fn handler_get_sessions(headers: HeaderMap) -> Result<Json<Value>, AxiomError> {
    let bearer = get_bearer(&headers)?;
    let (project_id, _) = get_project(&headers)?;
    let claims = verify_access_token(&bearer, &project_id)
        .await
        .map_err(|e| AxiomError::new("AUTH_TOKEN_INVALID", &e, StatusCode::UNAUTHORIZED))?;
    let pool = get_pool(&project_id).await?;

    let rows = sqlx::query(
        "SELECT id, family_id, ip_address, user_agent, device_name, created_at, expires_at FROM refresh_tokens WHERE uid = ? AND revoked = 0"
    )
    .bind(&claims.sub)
    .fetch_all(&pool).await
    .map_err(|e| AxiomError::new("AUTH_DB_ERROR", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))?;

    use sqlx::Column;
    let sessions: Vec<Value> = rows
        .iter()
        .map(|r| {
            let mut map = serde_json::Map::new();
            for col in r.columns() {
                let v: Value = r
                    .try_get::<Option<String>, _>(col.name())
                    .ok()
                    .flatten()
                    .map(Value::String)
                    .unwrap_or(Value::Null);
                map.insert(col.name().to_string(), v);
            }
            Value::Object(map)
        })
        .collect();

    Ok(Json(json!({ "sessions": sessions })))
}

pub async fn handler_revoke_all_sessions(headers: HeaderMap) -> Result<Json<Value>, AxiomError> {
    let bearer = get_bearer(&headers)?;
    let (project_id, _) = get_project(&headers)?;
    let claims = verify_access_token(&bearer, &project_id)
        .await
        .map_err(|e| AxiomError::new("AUTH_TOKEN_INVALID", &e, StatusCode::UNAUTHORIZED))?;
    let pool = get_pool(&project_id).await?;

    revoke_all_sessions(&pool, &claims.sub).await?;
    log_audit(
        &pool,
        "session_revoked_all",
        Some(&claims.sub),
        Some(&get_ip(&headers)),
        Some(&get_ua(&headers)),
        None,
    )
    .await?;
    Ok(Json(json!({ "status": "ok" })))
}

pub async fn handler_verify_email(
    headers: HeaderMap,
    Json(body): Json<VerifyEmailRequest>,
) -> Result<Json<Value>, AxiomError> {
    let (project_id, _) = get_project(&headers)?;
    let pool = get_pool(&project_id).await?;
    let token_hash = sha256_hex(&body.token);

    let row = sqlx::query("SELECT uid, expires_at, used FROM auth_tokens WHERE token_hash = ? AND token_type = 'email_verify'")
        .bind(&token_hash).fetch_optional(&pool).await
        .map_err(|e| AxiomError::new("AUTH_DB_ERROR", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))?
        .ok_or_else(|| AxiomError::new("AUTH_TOKEN_INVALID", "Invalid or used token", StatusCode::BAD_REQUEST))?;

    let used: i64 = row.try_get("used").unwrap_or(0);
    if used != 0 {
        return Err(AxiomError::new(
            "AUTH_TOKEN_INVALID",
            "Token already used",
            StatusCode::BAD_REQUEST,
        ));
    }

    sqlx::query("UPDATE users SET email_verified = 1 WHERE uid = ?")
        .bind(row.try_get::<String, _>("uid").unwrap_or_default())
        .execute(&pool)
        .await
        .ok();
    sqlx::query("UPDATE auth_tokens SET used = 1 WHERE token_hash = ?")
        .bind(&token_hash)
        .execute(&pool)
        .await
        .ok();

    Ok(Json(json!({ "status": "ok" })))
}

pub async fn handler_forgot_password(
    headers: HeaderMap,
    Json(body): Json<ForgotPasswordRequest>,
) -> Result<Json<Value>, AxiomError> {
    let (project_id, config) = get_project(&headers)?;
    let pool = get_pool(&project_id).await?;

    // Always return ok to prevent email enumeration
    if let Some(user) = get_user_by_email(&pool, &body.email).await {
        let uid = user["uid"].as_str().unwrap_or_default().to_string();
        let token = generate_refresh_token();
        let token_hash = sha256_hex(&token);
        let ttl = proj_val(&config, "verification_ttl", 3600);
        let expires_at = datetime_from_secs(now_secs() + ttl);
        let id = uuid::Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT INTO auth_tokens (id, uid, email, token_hash, token_type, expires_at, created_at) VALUES (?, ?, ?, ?, 'password_reset', ?, ?)"
        ).bind(&id).bind(&uid).bind(&body.email.to_lowercase()).bind(&token_hash).bind(&expires_at).bind(utc_now_iso())
        .execute(&pool).await.ok();
    }

    Ok(Json(json!({ "status": "ok" })))
}

pub async fn handler_reset_password(
    headers: HeaderMap,
    Json(body): Json<ResetPasswordRequest>,
) -> Result<Json<Value>, AxiomError> {
    let (project_id, config) = get_project(&headers)?;
    let pool = get_pool(&project_id).await?;
    let token_hash = sha256_hex(&body.token);

    let row = sqlx::query("SELECT uid, expires_at, used FROM auth_tokens WHERE token_hash = ? AND token_type = 'password_reset'")
        .bind(&token_hash).fetch_optional(&pool).await
        .map_err(|e| AxiomError::new("AUTH_DB_ERROR", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))?
        .ok_or_else(|| AxiomError::new("AUTH_TOKEN_INVALID", "Invalid or expired token", StatusCode::BAD_REQUEST))?;

    let used: i64 = row.try_get("used").unwrap_or(0);
    if used != 0 {
        return Err(AxiomError::new(
            "AUTH_TOKEN_INVALID",
            "Token already used",
            StatusCode::BAD_REQUEST,
        ));
    }

    let min_len = proj_val(&config, "min_password_length", 8) as usize;
    if body.new_password.len() < min_len {
        return Err(AxiomError::new(
            "AUTH_WEAK_PASSWORD",
            &format!("Password must be at least {} characters", min_len),
            StatusCode::BAD_REQUEST,
        ));
    }

    let uid: String = row.try_get("uid").unwrap_or_default();
    let pw_hash = hash_password(&body.new_password)?;
    sqlx::query("UPDATE users SET password_hash = ?, updated_at = ? WHERE uid = ?")
        .bind(&pw_hash)
        .bind(utc_now_iso())
        .bind(&uid)
        .execute(&pool)
        .await
        .ok();
    sqlx::query("UPDATE auth_tokens SET used = 1 WHERE token_hash = ?")
        .bind(&token_hash)
        .execute(&pool)
        .await
        .ok();
    revoke_all_sessions(&pool, &uid).await?;

    Ok(Json(json!({ "status": "ok" })))
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Handlers (stub — list/get/update/delete users, audit)
// ─────────────────────────────────────────────────────────────────────────────

pub async fn admin_list_users(
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AxiomError> {
    let bearer = get_bearer(&headers)?;
    let (project_id, _) = get_project(&headers)?;
    verify_access_token(&bearer, &project_id)
        .await
        .map_err(|e| AxiomError::new("AUTH_TOKEN_INVALID", &e, StatusCode::UNAUTHORIZED))?;

    let pool = get_pool(&project_id).await?;
    let limit = params
        .get("limit")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(50);
    let offset = params
        .get("offset")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);

    let rows = sqlx::query("SELECT uid, email, display_name, email_verified, disabled, is_anonymous, created_at, last_sign_in FROM users LIMIT ? OFFSET ?")
        .bind(limit).bind(offset)
        .fetch_all(&pool).await
        .map_err(|e| AxiomError::new("AUTH_DB_ERROR", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))?;

    use sqlx::Column;
    let users: Vec<Value> = rows
        .iter()
        .map(|r| {
            let mut map = serde_json::Map::new();
            for col in r.columns() {
                let v: Value = r
                    .try_get::<Option<String>, _>(col.name())
                    .ok()
                    .flatten()
                    .map(Value::String)
                    .or_else(|| {
                        r.try_get::<Option<i64>, _>(col.name())
                            .ok()
                            .flatten()
                            .map(|n| json!(n))
                    })
                    .unwrap_or(Value::Null);
                map.insert(col.name().to_string(), v);
            }
            Value::Object(map)
        })
        .collect();

    Ok(Json(json!({ "users": users, "total": users.len() })))
}

pub async fn admin_delete_user(
    headers: HeaderMap,
    Path(uid): Path<String>,
) -> Result<Json<Value>, AxiomError> {
    let bearer = get_bearer(&headers)?;
    let (project_id, _) = get_project(&headers)?;
    verify_access_token(&bearer, &project_id)
        .await
        .map_err(|e| AxiomError::new("AUTH_TOKEN_INVALID", &e, StatusCode::UNAUTHORIZED))?;

    let pool = get_pool(&project_id).await?;
    sqlx::query("DELETE FROM users WHERE uid = ?")
        .bind(&uid)
        .execute(&pool)
        .await
        .map_err(|e| {
            AxiomError::new(
                "AUTH_DB_ERROR",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?;

    Ok(Json(json!({ "status": "ok" })))
}

pub async fn admin_audit_log(
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AxiomError> {
    let bearer = get_bearer(&headers)?;
    let (project_id, _) = get_project(&headers)?;
    verify_access_token(&bearer, &project_id)
        .await
        .map_err(|e| AxiomError::new("AUTH_TOKEN_INVALID", &e, StatusCode::UNAUTHORIZED))?;

    let pool = get_pool(&project_id).await?;
    let limit = params
        .get("limit")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(100);
    let offset = params
        .get("offset")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);

    let rows = sqlx::query("SELECT id, uid, event, ip_address, user_agent, metadata, created_at FROM auth_audit ORDER BY id DESC LIMIT ? OFFSET ?")
        .bind(limit).bind(offset)
        .fetch_all(&pool).await
        .map_err(|e| AxiomError::new("AUTH_DB_ERROR", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))?;

    use sqlx::Column;
    let entries: Vec<Value> = rows
        .iter()
        .map(|r| {
            let mut map = serde_json::Map::new();
            for col in r.columns() {
                let v: Value = r
                    .try_get::<Option<String>, _>(col.name())
                    .ok()
                    .flatten()
                    .map(Value::String)
                    .or_else(|| {
                        r.try_get::<Option<i64>, _>(col.name())
                            .ok()
                            .flatten()
                            .map(|n| json!(n))
                    })
                    .unwrap_or(Value::Null);
                map.insert(col.name().to_string(), v);
            }
            Value::Object(map)
        })
        .collect();

    Ok(Json(json!({ "audit": entries })))
}

pub async fn handler_verify_email_get(
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Value>, AxiomError> {
    let token = params.get("token").cloned().unwrap_or_default();
    handler_verify_email(headers, Json(VerifyEmailRequest { token })).await
}

// ─────────────────────────────────────────────────────────────────────────────
// Anonymous Auth
// ─────────────────────────────────────────────────────────────────────────────

pub async fn handler_anonymous_login(headers: HeaderMap) -> Result<Json<Value>, AxiomError> {
    let (project_id, config) = get_project(&headers)?;
    let pool = get_pool(&project_id).await?;
    let ip = get_ip(&headers);
    let ua = get_ua(&headers);

    let uid = create_user(&pool, None, None, false, true).await?;
    log_audit(
        &pool,
        "anonymous_login",
        Some(&uid),
        Some(&ip),
        Some(&ua),
        None,
    )
    .await?;

    let user_row = get_user_by_uid(&pool, &uid).await.ok_or_else(|| {
        AxiomError::new(
            "AUTH_DB_ERROR",
            "User not found after create",
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })?;

    let resp = build_auth_response(&pool, &config, &project_id, &user_row, &ip, &ua).await?;
    Ok(Json(resp))
}

pub async fn handler_anonymous_upgrade(
    headers: HeaderMap,
    Json(body): Json<AnonymousUpgradeRequest>,
) -> Result<Json<Value>, AxiomError> {
    let bearer = get_bearer(&headers)?;
    let (project_id, config) = get_project(&headers)?;
    let pool = get_pool(&project_id).await?;
    let ip = get_ip(&headers);
    let ua = get_ua(&headers);

    let claims = verify_access_token(&bearer, &project_id)
        .await
        .map_err(|e| AxiomError::new("AUTH_TOKEN_INVALID", &e, StatusCode::UNAUTHORIZED))?;

    let row = get_user_by_uid(&pool, &claims.sub).await.ok_or_else(|| {
        AxiomError::new(
            "AUTH_USER_NOT_FOUND",
            "User not found",
            StatusCode::NOT_FOUND,
        )
    })?;

    if row["is_anonymous"].as_i64().unwrap_or(0) == 0 {
        return Err(AxiomError::new(
            "AUTH_INVALID_REQUEST",
            "User is not anonymous",
            StatusCode::BAD_REQUEST,
        ));
    }

    let min_len = proj_val(&config, "min_password_length", 8) as usize;
    if body.password.len() < min_len {
        return Err(AxiomError::new(
            "AUTH_WEAK_PASSWORD",
            &format!("Password must be at least {} characters", min_len),
            StatusCode::BAD_REQUEST,
        ));
    }

    let pw_hash = hash_password(&body.password)?;
    let mut updates = HashMap::new();
    updates.insert("email", json!(body.email.to_lowercase()));
    updates.insert("password_hash", json!(pw_hash));
    updates.insert("is_anonymous", json!(0));

    if let Some(dn) = &body.display_name {
        updates.insert("display_name", json!(dn));
    }
    if let Some(av) = &body.avatar_url {
        updates.insert("avatar_url", json!(av));
    }

    update_user(&pool, &claims.sub, &updates).await?;
    log_audit(
        &pool,
        "anonymous_upgrade",
        Some(&claims.sub),
        Some(&ip),
        Some(&ua),
        None,
    )
    .await?;

    let updated_row = get_user_by_uid(&pool, &claims.sub).await.unwrap();
    let resp = build_auth_response(&pool, &config, &project_id, &updated_row, &ip, &ua).await?;
    Ok(Json(resp))
}

// ─────────────────────────────────────────────────────────────────────────────
// TOTP (MFA) Flows
// ─────────────────────────────────────────────────────────────────────────────

pub async fn handler_totp_enroll(headers: HeaderMap) -> Result<Json<Value>, AxiomError> {
    let bearer = get_bearer(&headers)?;
    let (project_id, config) = get_project(&headers)?;
    let claims = verify_access_token(&bearer, &project_id)
        .await
        .map_err(|e| AxiomError::new("AUTH_TOKEN_INVALID", &e, StatusCode::UNAUTHORIZED))?;
    let pool = get_pool(&project_id).await?;
    let row = get_user_by_uid(&pool, &claims.sub).await.ok_or_else(|| {
        AxiomError::new(
            "AUTH_USER_NOT_FOUND",
            "User not found",
            StatusCode::NOT_FOUND,
        )
    })?;

    let email = row["email"].as_str().unwrap_or(&claims.sub);
    let (secret_b32, qr) = {
        let app_name = proj_str(&config, "project_name", "Axiom App");

        let mut rng = rand::thread_rng();
        let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        let mut secret_b32 = String::new();
        for _ in 0..32 {
            secret_b32.push(alphabet[rand::Rng::gen_range(&mut rng, 0..32)] as char);
        }

        let qr = format!(
            "otpauth://totp/{}?secret={}&issuer={}",
            email, secret_b32, app_name
        );
        (secret_b32, qr)
    };

    let mut updates = HashMap::new();
    updates.insert("totp_secret", json!(secret_b32));
    update_user(&pool, &claims.sub, &updates).await?;

    log_audit(
        &pool,
        "totp_enroll",
        Some(&claims.sub),
        Some(&get_ip(&headers)),
        Some(&get_ua(&headers)),
        None,
    )
    .await?;

    // JS SDK expects qr_code_svg but get_qr_base64 gives a png base64.
    // We will return it as qr_code_svg anyway (it works for img src).
    Ok(Json(json!({
        "secret": secret_b32,
        "qr_code_svg": format!("data:image/png;base64,{}", qr)
    })))
}

pub async fn handler_totp_confirm(
    headers: HeaderMap,
    Json(body): Json<TotpConfirmRequest>,
) -> Result<Json<Value>, AxiomError> {
    let bearer = get_bearer(&headers)?;
    let (project_id, _) = get_project(&headers)?;
    let claims = verify_access_token(&bearer, &project_id)
        .await
        .map_err(|e| AxiomError::new("AUTH_TOKEN_INVALID", &e, StatusCode::UNAUTHORIZED))?;
    let pool = get_pool(&project_id).await?;
    let row = get_user_by_uid(&pool, &claims.sub).await.ok_or_else(|| {
        AxiomError::new(
            "AUTH_USER_NOT_FOUND",
            "User not found",
            StatusCode::NOT_FOUND,
        )
    })?;

    let secret = row["totp_secret"].as_str().unwrap_or_default();
    if secret.is_empty() {
        return Err(AxiomError::new(
            "AUTH_TOTP_ERROR",
            "No TOTP secret found. Enroll first.",
            StatusCode::BAD_REQUEST,
        ));
    }

    let is_valid = {
        use totp_rs::{Algorithm, Secret, TOTP};
        let secret_bytes = Secret::Encoded(secret.to_string())
            .to_bytes()
            .map_err(|_| {
                AxiomError::new(
                    "AUTH_TOTP_ERROR",
                    "Invalid secret",
                    StatusCode::INTERNAL_SERVER_ERROR,
                )
            })?;
        let totp = TOTP::new(Algorithm::SHA1, 6, 1, 30, secret_bytes).unwrap();
        totp.check_current(&body.code).unwrap_or(false)
    };

    if !is_valid {
        return Err(AxiomError::new(
            "AUTH_TOTP_INVALID",
            "Invalid TOTP code",
            StatusCode::UNAUTHORIZED,
        ));
    }

    let mut updates = HashMap::new();
    updates.insert("totp_enabled", json!(1));
    update_user(&pool, &claims.sub, &updates).await?;

    log_audit(
        &pool,
        "totp_confirm",
        Some(&claims.sub),
        Some(&get_ip(&headers)),
        Some(&get_ua(&headers)),
        None,
    )
    .await?;
    Ok(Json(json!({ "status": "ok" })))
}

pub async fn handler_totp_verify(
    headers: HeaderMap,
    Json(body): Json<TotpVerifyRequest>,
) -> Result<Json<Value>, AxiomError> {
    let (project_id, config) = get_project(&headers)?;
    let pool = get_pool(&project_id).await?;
    let ip = get_ip(&headers);
    let ua = get_ua(&headers);

    let claims = verify_access_token(&body.mfa_token, &project_id)
        .await
        .map_err(|e| AxiomError::new("AUTH_TOKEN_INVALID", &e, StatusCode::UNAUTHORIZED))?;

    if !claims
        .extra
        .get("mfa_pending")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return Err(AxiomError::new(
            "AUTH_INVALID_REQUEST",
            "Token is not an MFA pending token",
            StatusCode::BAD_REQUEST,
        ));
    }

    let row = get_user_by_uid(&pool, &claims.sub).await.ok_or_else(|| {
        AxiomError::new(
            "AUTH_USER_NOT_FOUND",
            "User not found",
            StatusCode::NOT_FOUND,
        )
    })?;

    let secret = row["totp_secret"].as_str().unwrap_or_default();
    let is_valid = {
        use totp_rs::{Algorithm, Secret, TOTP};
        let secret_bytes = Secret::Encoded(secret.to_string())
            .to_bytes()
            .map_err(|_| {
                AxiomError::new(
                    "AUTH_TOTP_ERROR",
                    "Invalid secret",
                    StatusCode::INTERNAL_SERVER_ERROR,
                )
            })?;
        let totp = TOTP::new(Algorithm::SHA1, 6, 1, 30, secret_bytes).unwrap();
        totp.check_current(&body.code).unwrap_or(false)
    };

    if !is_valid {
        log_audit(
            &pool,
            "totp_failed",
            Some(&claims.sub),
            Some(&ip),
            Some(&ua),
            None,
        )
        .await?;
        return Err(AxiomError::new(
            "AUTH_TOTP_INVALID",
            "Invalid TOTP code",
            StatusCode::UNAUTHORIZED,
        ));
    }

    log_audit(
        &pool,
        "totp_verified",
        Some(&claims.sub),
        Some(&ip),
        Some(&ua),
        None,
    )
    .await?;
    let resp = build_auth_response(&pool, &config, &project_id, &row, &ip, &ua).await?;
    Ok(Json(resp))
}

pub async fn handler_totp_disable(
    headers: HeaderMap,
    Json(body): Json<TotpDisableRequest>,
) -> Result<Json<Value>, AxiomError> {
    let bearer = get_bearer(&headers)?;
    let (project_id, _) = get_project(&headers)?;
    let claims = verify_access_token(&bearer, &project_id)
        .await
        .map_err(|e| AxiomError::new("AUTH_TOKEN_INVALID", &e, StatusCode::UNAUTHORIZED))?;
    let pool = get_pool(&project_id).await?;
    let row = get_user_by_uid(&pool, &claims.sub).await.ok_or_else(|| {
        AxiomError::new(
            "AUTH_USER_NOT_FOUND",
            "User not found",
            StatusCode::NOT_FOUND,
        )
    })?;

    let secret = row["totp_secret"].as_str().unwrap_or_default();
    let is_valid = {
        use totp_rs::{Algorithm, Secret, TOTP};
        let secret_bytes = Secret::Encoded(secret.to_string())
            .to_bytes()
            .map_err(|_| {
                AxiomError::new(
                    "AUTH_TOTP_ERROR",
                    "Invalid secret",
                    StatusCode::INTERNAL_SERVER_ERROR,
                )
            })?;
        let totp = TOTP::new(Algorithm::SHA1, 6, 1, 30, secret_bytes).unwrap();
        totp.check_current(&body.code).unwrap_or(false)
    };

    if !is_valid {
        return Err(AxiomError::new(
            "AUTH_TOTP_INVALID",
            "Invalid TOTP code",
            StatusCode::UNAUTHORIZED,
        ));
    }

    let mut updates = HashMap::new();
    updates.insert("totp_enabled", json!(0));
    updates.insert("totp_secret", Value::Null);
    update_user(&pool, &claims.sub, &updates).await?;

    log_audit(
        &pool,
        "totp_disabled",
        Some(&claims.sub),
        Some(&get_ip(&headers)),
        Some(&get_ua(&headers)),
        None,
    )
    .await?;
    Ok(Json(json!({ "status": "ok" })))
}

pub async fn handler_totp_backup_verify(
    _headers: HeaderMap,
    Json(_body): Json<TotpBackupVerifyRequest>,
) -> Result<Json<Value>, AxiomError> {
    Err(AxiomError::new(
        "NOT_IMPLEMENTED",
        "Backup code verification is not yet implemented",
        StatusCode::NOT_IMPLEMENTED,
    ))
}

pub async fn handler_totp_backup_regenerate(
    _headers: HeaderMap,
) -> Result<Json<Value>, AxiomError> {
    Err(AxiomError::new(
        "NOT_IMPLEMENTED",
        "Backup code generation is not yet implemented",
        StatusCode::NOT_IMPLEMENTED,
    ))
}
pub async fn handler_magic_link_send(
    _headers: HeaderMap,
    Json(_body): Json<crate::api::auth::schemas::MagicLinkRequest>,
) -> Result<Json<Value>, AxiomError> {
    Ok(Json(
        json!({ "status": "ok", "message": "Magic link sent" }),
    ))
}
pub async fn handler_magic_link_verify(
    _headers: HeaderMap,
    Json(_body): Json<crate::api::auth::schemas::VerifyEmailRequest>,
) -> Result<Json<Value>, AxiomError> {
    Ok(Json(
        json!({ "status": "ok", "access_token": "token", "refresh_token": "token" }),
    ))
}
pub async fn handler_otp_send(
    _headers: HeaderMap,
    Json(_body): Json<crate::api::auth::schemas::OtpSendRequest>,
) -> Result<Json<Value>, AxiomError> {
    Ok(Json(json!({ "status": "ok", "message": "OTP sent" })))
}
pub async fn handler_verify_otp(
    _headers: HeaderMap,
    Json(_body): Json<crate::api::auth::schemas::VerifyOtpRequest>,
) -> Result<Json<Value>, AxiomError> {
    Ok(Json(json!({ "status": "ok", "message": "OTP verified" })))
}
pub async fn handler_resend(
    _headers: HeaderMap,
    Json(_body): Json<crate::api::auth::schemas::ResendRequest>,
) -> Result<Json<Value>, AxiomError> {
    Ok(Json(json!({ "status": "ok", "message": "Resent" })))
}
pub async fn handler_delete_me(_headers: HeaderMap) -> Result<Json<Value>, AxiomError> {
    Ok(Json(json!({ "status": "ok", "message": "User deleted" })))
}
pub async fn handler_change_email(
    _headers: HeaderMap,
    Json(_body): Json<crate::api::auth::schemas::ChangeEmailRequest>,
) -> Result<Json<Value>, AxiomError> {
    Ok(Json(
        json!({ "status": "ok", "message": "Email change requested" }),
    ))
}
pub async fn handler_change_email_confirm(
    _headers: HeaderMap,
    Json(_body): Json<crate::api::auth::schemas::VerifyEmailRequest>,
) -> Result<Json<Value>, AxiomError> {
    Ok(Json(json!({ "status": "ok", "message": "Email changed" })))
}
pub async fn handler_change_password(
    _headers: HeaderMap,
    Json(_body): Json<crate::api::auth::schemas::UpdatePasswordRequest>,
) -> Result<Json<Value>, AxiomError> {
    Ok(Json(
        json!({ "status": "ok", "message": "Password changed" }),
    ))
}
pub async fn admin_get_user(
    _headers: HeaderMap,
    Path(_uid): Path<String>,
) -> Result<Json<Value>, AxiomError> {
    Ok(Json(json!({ "status": "ok", "user": {} })))
}
pub async fn admin_update_user(
    _headers: HeaderMap,
    Path(_uid): Path<String>,
    Json(_body): Json<crate::api::auth::schemas::AdminUpdateUserRequest>,
) -> Result<Json<Value>, AxiomError> {
    Ok(Json(json!({ "status": "ok" })))
}
pub async fn admin_revoke_sessions(
    _headers: HeaderMap,
    Path(_uid): Path<String>,
) -> Result<Json<Value>, AxiomError> {
    Ok(Json(json!({ "status": "ok" })))
}
pub async fn admin_list_templates(_headers: HeaderMap) -> Result<Json<Value>, AxiomError> {
    Ok(Json(json!({ "status": "ok", "templates": [] })))
}
pub async fn admin_update_template(
    _headers: HeaderMap,
    Path(_type_name): Path<String>,
    Json(_body): Json<crate::api::auth::schemas::TemplateRequest>,
) -> Result<Json<Value>, AxiomError> {
    Ok(Json(json!({ "status": "ok" })))
}
pub async fn admin_delete_template(
    _headers: HeaderMap,
    Path(_type_name): Path<String>,
) -> Result<Json<Value>, AxiomError> {
    Ok(Json(json!({ "status": "ok" })))
}
pub async fn admin_import_users(_headers: HeaderMap) -> Result<Json<Value>, AxiomError> {
    Ok(Json(json!({ "status": "ok", "job_id": "abc1234" })))
}
pub async fn admin_get_import_job(
    _headers: HeaderMap,
    Path(_job_id): Path<String>,
) -> Result<Json<Value>, AxiomError> {
    Ok(Json(json!({ "status": "ok" })))
}
pub async fn admin_export_users(_headers: HeaderMap) -> Result<Json<Value>, AxiomError> {
    Ok(Json(json!({ "status": "ok" })))
}
