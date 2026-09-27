/*
 * Database abstraction layer defining schema metadata types, engine traits, and typed errors.
 * Owned by: db/engines
 * Key deps: async_trait, axiom_core
 * Invariants: Trait methods return strongly-typed EngineError (never Box<dyn Error>) to avoid hot-path heap allocations.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use async_trait::async_trait;
use serde_json::Value;

pub use axiom_core::{ColumnInfo, EngineError, ForeignKeyInfo, QueryResult, TableInfo};

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
