/*
 * Database abstraction types, column schemas, and strongly typed engine errors.
 * Owned by: core
 * Key deps: serde, serde_json
 * Invariants: EngineError is strongly typed to avoid Box<dyn Error> allocations on hot paths.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─── Error Handling ────────────────────────────────────────────────────────
// Typed database engine error variants replacing Box<dyn std::error::Error>.

#[derive(Debug)]
pub enum EngineError {
    Connection(String),
    Execution(String),
    Schema(String),
    Unsupported(String),
    Internal(String),
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EngineError::Connection(msg) => write!(f, "Connection error: {}", msg),
            EngineError::Execution(msg) => write!(f, "Execution error: {}", msg),
            EngineError::Schema(msg) => write!(f, "Schema error: {}", msg),
            EngineError::Unsupported(msg) => write!(f, "Unsupported dialect operation: {}", msg),
            EngineError::Internal(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for EngineError {}

impl From<&str> for EngineError {
    fn from(s: &str) -> Self {
        EngineError::Internal(s.to_string())
    }
}

impl From<String> for EngineError {
    fn from(s: String) -> Self {
        EngineError::Internal(s)
    }
}

impl From<Box<dyn std::error::Error + Send + Sync>> for EngineError {
    fn from(e: Box<dyn std::error::Error + Send + Sync>) -> Self {
        EngineError::Internal(e.to_string())
    }
}

impl From<Box<dyn std::error::Error>> for EngineError {
    fn from(e: Box<dyn std::error::Error>) -> Self {
        EngineError::Internal(e.to_string())
    }
}

impl From<url::ParseError> for EngineError {
    fn from(e: url::ParseError) -> Self {
        EngineError::Connection(e.to_string())
    }
}

// ─── Schema Metadata Types ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub r#type: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub column: String,
    pub referenced_table: String,
    pub referenced_column: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub row_count_estimate: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<ColumnInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreign_keys: Option<Vec<ForeignKeyInfo>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QueryResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_rows: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_error_display() {
        assert_eq!(
            format!("{}", EngineError::Connection("timeout".into())),
            "Connection error: timeout"
        );
        assert_eq!(
            format!("{}", EngineError::Execution("syntax".into())),
            "Execution error: syntax"
        );
        assert_eq!(
            format!("{}", EngineError::Schema("missing table".into())),
            "Schema error: missing table"
        );
        assert_eq!(
            format!("{}", EngineError::Unsupported("feature".into())),
            "Unsupported dialect operation: feature"
        );
        assert_eq!(
            format!("{}", EngineError::Internal("corrupt".into())),
            "Internal error: corrupt"
        );
    }

    #[test]
    fn test_engine_error_from() {
        let err: EngineError = "custom error".into();
        assert!(matches!(err, EngineError::Internal(_)));
        let err_str: EngineError = String::from("string error").into();
        assert!(matches!(err_str, EngineError::Internal(_)));
    }

    #[test]
    fn test_column_info_serialization() {
        let col = ColumnInfo {
            name: "id".to_string(),
            r#type: "INTEGER".to_string(),
            nullable: false,
            primary_key: true,
        };
        let json = serde_json::to_string(&col).unwrap();
        assert!(json.contains("\"name\":\"id\""));
        assert!(json.contains("\"type\":\"INTEGER\""));
        assert!(json.contains("\"nullable\":false"));
        assert!(json.contains("\"primary_key\":true"));
    }

    #[test]
    fn test_query_result_serialization_skips_none() {
        let res = QueryResult {
            columns: None,
            rows: None,
            affected_rows: Some(42),
        };
        let json = serde_json::to_string(&res).unwrap();
        assert!(!json.contains("rows\":null"));
        assert!(json.contains("\"affected_rows\":42"));
    }
}
