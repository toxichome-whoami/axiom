#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum HealthStatusEnum {
    Healthy,
    Degraded,
    Unhealthy,
    Up,
    Down,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum StatusEnum {
    Online,
    Offline,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ServerMode {
    Readwrite,
    Readonly,
    Writeonly,
}

impl Default for ServerMode {
    fn default() -> Self {
        ServerMode::Readwrite
    }
}



#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DbEngineType {
    Postgres,
    Mysql,
    Sqlite,
    Mssql,
    Oracle,
    Mariadb,
    Db2,
    Cockroachdb,
}

impl Default for DbEngineType {
    fn default() -> Self {
        DbEngineType::Sqlite
    }
}

#[derive(Serialize, Debug, Clone)]
pub struct AuthContext {
    pub api_key_name: String,
    pub mode: ServerMode,
    pub db_scope: Vec<String>,
    pub rate_limit_override: u32,
    #[serde(default)]
    pub full_admin: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RequestMeta {
    pub request_id: String,
    pub timestamp: String,
    pub duration_ms: f64,
    pub server: String,
    pub version: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ErrorDetails {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ResponseEnvelope {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorDetails>,
    pub meta: RequestMeta,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub links: Option<HashMap<String, String>>,
}
