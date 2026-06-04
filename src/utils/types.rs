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

#[derive(Default, Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerMode {
    #[default]
    Readwrite,
    Readonly,
    Writeonly,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EventModule {
    Db,
    Fs,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EventOperation {
    Read,
    Write,
    Delete,
    Any,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbEngineType {
    Postgres,
    Mysql,
    #[default]
    Sqlite,
    Mssql,
    Oracle,
    Mariadb,
    Db2,
    Cockroachdb,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FileType {
    File,
    Directory,
    All,
}

#[derive(Serialize, Debug, Clone)]
pub struct AuthContext {
    pub api_key_name: String,
    pub mode: ServerMode,
    pub db_scope: Vec<String>,
    pub fs_scope: Vec<String>,
    pub feature_scope: Vec<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub federated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_latency_ms: Option<f64>,
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
