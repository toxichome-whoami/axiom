/*
 * Database abstraction layer defining schema metadata types, engine traits, and typed errors.
 * Owned by: db/engines
 * Key deps: async_trait, serde, serde_json
 * Invariants: Trait methods return strongly-typed EngineError (never Box<dyn Error>) to avoid hot-path heap allocations.
 * Last structural change: Phase 0 cleanup introducing EngineError enum to resolve Debt #2.
 */

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─── Error Handling ────────────────────────────────────────────────────────
// Typed database engine error variants replacing Box<dyn std::error::Error> across all engines.

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_rows: Option<u64>,
}

// ─── Database Engine Trait ─────────────────────────────────────────────────

#[async_trait]
pub trait DatabaseEngine: Send + Sync {
    /// Establishes the initial connection pool to the underlying database.
    /// CONTRACT:
    ///  - Precondition: Connection configuration must be valid.
    ///  - Returns `Ok(())` or `Err(EngineError::Connection)`.
    ///  - Side effects: Opens network sockets and creates connection pool.
    ///  - Idempotent: Yes.
    async fn connect(&mut self) -> Result<(), EngineError>;

    /// Gracefully closes all connections in the pool.
    /// CONTRACT:
    ///  - Side effects: Closes sockets and terminates driver workers.
    ///  - Idempotent: Yes.
    async fn disconnect(&self) -> Result<(), EngineError>;

    /// Probes database liveness with a lightweight ping query (e.g. `SELECT 1`).
    /// CONTRACT:
    ///  - Returns `true` if responsive, `false` on any failure or timeout.
    ///  - Side effects: None.
    ///  - Idempotent: Yes.
    async fn health_check(&self) -> bool;

    /// Lists tables accessible within the default database schema with pagination.
    /// CONTRACT:
    ///  - Precondition: `limit` must be clamped between 1 and 500 upstream.
    ///  - Returns `Vec<TableInfo>` ordered deterministically by table name.
    ///  - Side effects: Queries system catalog / information_schema.
    ///  - Idempotent: Yes.
    async fn list_tables(&self, cursor: Option<String>, limit: usize) -> Result<Vec<TableInfo>, EngineError>;

    /// Returns the total count of user-defined tables in the schema.
    /// CONTRACT:
    ///  - Returns count as `i64`.
    ///  - Idempotent: Yes.
    async fn count_tables(&self) -> Result<i64, EngineError>;

    /// Introspects column definitions and data types for a given table.
    /// CONTRACT:
    ///  - Precondition: Table name must exist in target database.
    ///  - Returns `Vec<ColumnInfo>` describing nullability, types, and primary key flags.
    ///  - Idempotent: Yes.
    async fn describe_table(&self, table: &str) -> Result<Vec<ColumnInfo>, EngineError>;

    /// Retrieves foreign key constraints linking this table to external relations.
    /// CONTRACT:
    ///  - Returns `Vec<ForeignKeyInfo>` containing source/target column mappings.
    ///  - Idempotent: Yes.
    async fn get_foreign_keys(&self, table: &str) -> Result<Vec<ForeignKeyInfo>, EngineError>;

    /// Executes an arbitrary parameterized SQL statement.
    /// CONTRACT:
    ///  - Precondition: SQL statement pre-validated by AST parser.
    ///  - Returns `QueryResult` containing tabular rows or rows affected count.
    ///  - Throws `EngineError::Execution` on syntax, constraint, or driver errors.
    ///  - Side effects: Modifies database state on INSERT/UPDATE/DELETE/DDL queries.
    ///  - Idempotent: Depends on query SQL.
    async fn execute(&self, sql: &str, params: &[Value]) -> Result<QueryResult, EngineError>;

    /// Returns the canonical dialect identifier string (e.g. "postgres", "mysql", "sqlite").
    /// CONTRACT:
    ///  - Returns static dialect string slice.
    ///  - Idempotent: Yes.
    fn dialect(&self) -> &str;
}
