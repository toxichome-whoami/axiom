use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct QueryRequest {
    pub sql: String,
    pub params: Option<HashMap<String, Value>>,
    pub timeout: Option<i32>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ListTablesParams {
    #[serde(default = "default_limit")]
    pub limit: i32,
    pub cursor: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct InsertRequest {
    pub rows: Option<Vec<HashMap<String, Value>>>,
    pub row: Option<HashMap<String, Value>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UpdateRequest {
    pub filter: HashMap<String, Value>,
    pub update: HashMap<String, Value>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DeleteRequest {
    pub filter: HashMap<String, Value>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct FetchRowsParams {
    #[serde(default = "default_page")]
    pub page: i32,
    #[serde(default = "default_limit")]
    pub limit: i32,
    pub cursor: Option<String>,
    pub fields: Option<String>,
    pub sort: Option<String>,
    #[serde(default = "default_order")]
    pub order: String,
    pub filter: Option<String>,
    pub search: Option<String>,
    pub search_fields: Option<String>,
}

fn default_page() -> i32 {
    1
}
fn default_limit() -> i32 {
    50
}
fn default_order() -> String {
    "asc".to_string()
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct VectorSearchRequest {
    pub table: String,
    pub vector: Vec<f32>,
    #[serde(default = "default_k")]
    pub k: i32,
    pub filter: Option<HashMap<String, Value>>,
}

fn default_k() -> i32 {
    10
}
