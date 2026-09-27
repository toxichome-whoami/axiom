/*
 * Request and query parameter deserialization schemas for database endpoints.
 * Owned by: crates/api (database)
 * Key deps: serde, serde_json
 * Invariants: Default values clamp query limits to prevent volumetric denial-of-service.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// Request payload for raw SQL query execution.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct QueryRequest {
    pub sql: String,
    pub params: Option<HashMap<String, Value>>,
    pub timeout: Option<i32>,
}

/// Query parameters for listing database tables with cursor pagination.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ListTablesParams {
    #[serde(default = "default_limit")]
    pub limit: i32,
    pub cursor: Option<String>,
}

/// Request payload for single or batch row insertion.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_query_request_deserialization() {
        let json = r#"{"sql": "SELECT 1", "timeout": 30}"#;
        let parsed: QueryRequest = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.sql, "SELECT 1");
        assert_eq!(parsed.timeout, Some(30));
        assert!(parsed.params.is_none());
    }

    #[test]
    fn test_fetch_rows_params_defaults() {
        let json = r#"{}"#;
        let parsed: FetchRowsParams = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.page, 1);
        assert_eq!(parsed.limit, 50);
        assert_eq!(parsed.order, "asc");
        assert!(parsed.sort.is_none());
        assert!(parsed.filter.is_none());
    }

    #[test]
    fn test_update_request_structure() {
        let json = r#"{"filter": {"id": 1}, "update": {"name": "alice"}}"#;
        let parsed: UpdateRequest = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.filter.get("id"), Some(&serde_json::json!(1)));
        assert_eq!(parsed.update.get("name"), Some(&serde_json::json!("alice")));
    }
}
