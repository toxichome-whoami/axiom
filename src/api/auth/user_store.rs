use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::Utc;
use dashmap::DashMap;
use once_cell::sync::Lazy;
use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions},
    Row,
};
use std::collections::HashMap;
use std::str::FromStr;

use crate::api::errors::AxiomError;
use axum::http::StatusCode;

static POOLS: Lazy<DashMap<String, SqlitePool>> = Lazy::new(DashMap::new);

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    display_name TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    email_verified INTEGER DEFAULT 0,
    disabled INTEGER DEFAULT 0,
    is_anonymous INTEGER DEFAULT 0,
    anonymous_expires_at TEXT,
    totp_secret TEXT,
    totp_enabled INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_sign_in TEXT,
    sign_in_count INTEGER DEFAULT 0,
    metadata TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    family_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked INTEGER DEFAULT 0,
    ip_address TEXT,
    user_agent TEXT,
    device_name TEXT
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    id TEXT PRIMARY KEY,
    uid TEXT REFERENCES users(uid) ON DELETE CASCADE,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_type TEXT NOT NULL,
    otp_code TEXT,
    otp_attempts INTEGER DEFAULT 0,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    resend_count INTEGER DEFAULT 0,
    last_resent_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS totp_backup_codes (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    code_hash TEXT NOT NULL UNIQUE,
    used INTEGER DEFAULT 0,
    used_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_templates (
    type TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT,
    event TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
);
"#;

pub fn utc_now_iso() -> String {
    Utc::now().to_rfc3339()
}

pub fn hash_sha256(data: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(data.as_bytes()))
}

pub async fn get_pool(project_id: &str) -> Result<SqlitePool, AxiomError> {
    if let Some(pool) = POOLS.get(project_id) {
        return Ok(pool.clone());
    }

    let dir = format!("data/auth/{}", project_id);
    std::fs::create_dir_all(&dir).ok();
    let db_path = format!("{}/auth.db", dir);

    let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}?mode=rwc", db_path))
        .map_err(|e| {
            AxiomError::new(
                "AUTH_DB_ERROR",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .synchronous(sqlx::sqlite::SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(std::time::Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(10)
        .connect_with(opts)
        .await
        .map_err(|e| {
            AxiomError::new(
                "AUTH_DB_ERROR",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?;

    sqlx::query(SCHEMA).execute(&pool).await.map_err(|e| {
        AxiomError::new(
            "AUTH_DB_INIT",
            &e.to_string(),
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })?;

    POOLS.insert(project_id.to_string(), pool.clone());
    Ok(pool)
}

pub fn hash_password(password: &str) -> Result<String, AxiomError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| {
            AxiomError::new(
                "AUTH_HASH_ERROR",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })
}

pub fn verify_password(hash: &str, password: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(p) => p,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

pub async fn get_user_by_email(pool: &SqlitePool, email: &str) -> Option<Value> {
    let row = sqlx::query("SELECT * FROM users WHERE email = ?")
        .bind(email.to_lowercase())
        .fetch_optional(pool)
        .await
        .ok()??;

    Some(row_to_json(&row))
}

pub async fn get_user_by_uid(pool: &SqlitePool, uid: &str) -> Option<Value> {
    let row = sqlx::query("SELECT * FROM users WHERE uid = ?")
        .bind(uid)
        .fetch_optional(pool)
        .await
        .ok()??;

    Some(row_to_json(&row))
}

pub async fn create_user(
    pool: &SqlitePool,
    email: Option<&str>,
    password_hash: Option<&str>,
    email_verified: bool,
    is_anonymous: bool,
) -> Result<String, AxiomError> {
    let uid = uuid::Uuid::new_v4().to_string();
    let now = utc_now_iso();

    let res = sqlx::query(
        "INSERT INTO users (uid, email, password_hash, email_verified, is_anonymous, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&uid)
    .bind(email.map(|e| e.to_lowercase()))
    .bind(password_hash)
    .bind(email_verified as i32)
    .bind(is_anonymous as i32)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await;

    match res {
        Ok(_) => Ok(uid),
        Err(sqlx::Error::Database(e)) if e.message().contains("UNIQUE") => Err(AxiomError::new(
            "AUTH_USER_EXISTS",
            "User with this email already exists",
            StatusCode::CONFLICT,
        )),
        Err(e) => Err(AxiomError::new(
            "AUTH_DB_ERROR",
            &e.to_string(),
            StatusCode::INTERNAL_SERVER_ERROR,
        )),
    }
}

pub async fn update_user(
    pool: &SqlitePool,
    uid: &str,
    updates: &HashMap<&str, Value>,
) -> Result<(), AxiomError> {
    if updates.is_empty() {
        return Ok(());
    }
    let now = utc_now_iso();
    let set_clause: Vec<String> = updates.keys().map(|k| format!("{} = ?", k)).collect();
    let sql = format!(
        "UPDATE users SET {}, updated_at = ? WHERE uid = ?",
        set_clause.join(", ")
    );

    let mut q = sqlx::query(&sql);
    for v in updates.values() {
        q = match v {
            Value::String(s) => q.bind(s.as_str()),
            Value::Number(n) => q.bind(n.as_i64().unwrap_or(0)),
            Value::Bool(b) => q.bind(*b as i32),
            Value::Null => q.bind(Option::<String>::None),
            other => q.bind(other.to_string()),
        };
    }
    q.bind(&now)
        .bind(uid)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| {
            AxiomError::new(
                "AUTH_DB_ERROR",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })
}

pub async fn issue_refresh_token(
    pool: &SqlitePool,
    uid: &str,
    token_hash: &str,
    family_id: &str,
    expires_at: &str,
    ip: Option<&str>,
    user_agent: Option<&str>,
) -> Result<(), AxiomError> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO refresh_tokens (id, uid, token_hash, family_id, expires_at, created_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id).bind(uid).bind(token_hash).bind(family_id)
    .bind(expires_at).bind(utc_now_iso()).bind(ip).bind(user_agent)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| AxiomError::new("AUTH_DB_ERROR", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))
}

pub async fn get_refresh_token(pool: &SqlitePool, token_hash: &str) -> Option<Value> {
    let row = sqlx::query("SELECT * FROM refresh_tokens WHERE token_hash = ?")
        .bind(token_hash)
        .fetch_optional(pool)
        .await
        .ok()??;
    Some(row_to_json(&row))
}

pub async fn revoke_refresh_token(pool: &SqlitePool, token_hash: &str) -> Result<(), AxiomError> {
    sqlx::query("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?")
        .bind(token_hash)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| {
            AxiomError::new(
                "AUTH_DB_ERROR",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })
}

pub async fn revoke_refresh_family(pool: &SqlitePool, family_id: &str) -> Result<(), AxiomError> {
    sqlx::query("UPDATE refresh_tokens SET revoked = 1 WHERE family_id = ?")
        .bind(family_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| {
            AxiomError::new(
                "AUTH_DB_ERROR",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })
}

pub async fn revoke_all_sessions(pool: &SqlitePool, uid: &str) -> Result<(), AxiomError> {
    sqlx::query("UPDATE refresh_tokens SET revoked = 1 WHERE uid = ?")
        .bind(uid)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| {
            AxiomError::new(
                "AUTH_DB_ERROR",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })
}

pub async fn record_login(pool: &SqlitePool, uid: &str) -> Result<(), AxiomError> {
    sqlx::query(
        "UPDATE users SET last_sign_in = ?, sign_in_count = sign_in_count + 1 WHERE uid = ?",
    )
    .bind(utc_now_iso())
    .bind(uid)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| {
        AxiomError::new(
            "AUTH_DB_ERROR",
            &e.to_string(),
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })
}

pub async fn log_audit(
    pool: &SqlitePool,
    event: &str,
    uid: Option<&str>,
    ip: Option<&str>,
    user_agent: Option<&str>,
    metadata: Option<&serde_json::Value>,
) -> Result<(), AxiomError> {
    let meta_str = metadata
        .map(|m| m.to_string())
        .unwrap_or_else(|| "{}".into());
    sqlx::query(
        "INSERT INTO auth_audit (uid, event, ip_address, user_agent, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(uid).bind(event).bind(ip).bind(user_agent).bind(&meta_str).bind(utc_now_iso())
    .execute(pool).await
    .map(|_| ())
    .map_err(|e| AxiomError::new("AUTH_DB_ERROR", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))
}

fn row_to_json(row: &sqlx::sqlite::SqliteRow) -> Value {
    use sqlx::Column;
    let mut map = serde_json::Map::new();
    for col in row.columns() {
        let name = col.name();
        let val: Value = if let Ok(v) = row.try_get::<Option<String>, _>(name) {
            v.map(Value::String).unwrap_or(Value::Null)
        } else if let Ok(v) = row.try_get::<Option<i64>, _>(name) {
            v.map(|n| Value::Number(n.into())).unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        map.insert(name.to_string(), val);
    }
    Value::Object(map)
}
