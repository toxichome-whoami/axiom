/*
 * Database abstraction layer defining schema metadata types, engine traits, and typed errors.
 * Owned by: db/engines
 * Key deps: async_trait, axiom_core
 * Invariants: Trait methods return strongly-typed EngineError (never Box<dyn Error>) to avoid hot-path heap allocations.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use async_trait::async_trait;
use serde_json::Value;

pub use axiom_core::{
    extract_next_cursor, ColumnInfo, CreateColumnRequest, DropColumnRequest, EngineError,
    ForeignKeyDef, ForeignKeyInfo, ModifyColumnRequest, QueryResult, TableInfo,
    DEFAULT_MAX_QUERY_ROWS,
};

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
    async fn list_tables(
        &self,
        cursor: Option<String>,
        limit: usize,
    ) -> Result<Vec<TableInfo>, EngineError>;

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

    /// Adds a new column to a table with dialect-safe DDL generation.
    /// CONTRACT:
    ///  - Precondition: Table exists and column name is valid.
    ///  - Side effects: Modifies table schema in target database.
    async fn add_column(&self, table: &str, req: &CreateColumnRequest) -> Result<(), EngineError>;

    /// Drops an existing column from a table with dialect-safe DDL generation.
    /// CONTRACT:
    ///  - Precondition: Table and column exist in target database.
    ///  - Side effects: Modifies table schema by removing the specified column.
    async fn drop_column(&self, table: &str, column: &str) -> Result<(), EngineError> {
        let col_clean: String = column
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if col_clean.is_empty() {
            return Err(EngineError::Schema("Invalid column name".into()));
        }

        let (q_open, q_close) = match self.dialect() {
            "mysql" | "clickhouse" => ("`", "`"),
            "mssql" => ("[", "]"),
            _ => ("\"", "\""),
        };
        let escaped_table = format!(
            "{}{}{}",
            q_open,
            table.replace(q_close, &format!("{}{}", q_close, q_close)),
            q_close
        );
        let escaped_col = format!(
            "{}{}{}",
            q_open,
            col_clean.replace(q_close, &format!("{}{}", q_close, q_close)),
            q_close
        );
        let sql = format!("ALTER TABLE {} DROP COLUMN {}", escaped_table, escaped_col);

        self.execute(&sql, &[]).await?;
        Ok(())
    }

    /// Modifies or renames an existing column with dialect-safe DDL generation.
    /// CONTRACT:
    ///  - Precondition: Table and source column exist in target database.
    ///  - Side effects: Renames column or changes column data type.
    async fn modify_column(
        &self,
        table: &str,
        req: &ModifyColumnRequest,
    ) -> Result<(), EngineError> {
        let col_clean: String = req
            .name
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if col_clean.is_empty() {
            return Err(EngineError::Schema("Invalid column name".into()));
        }

        let (q_open, q_close) = match self.dialect() {
            "mysql" | "clickhouse" => ("`", "`"),
            "mssql" => ("[", "]"),
            _ => ("\"", "\""),
        };
        let escaped_table = format!(
            "{}{}{}",
            q_open,
            table.replace(q_close, &format!("{}{}", q_close, q_close)),
            q_close
        );
        let escaped_col = format!(
            "{}{}{}",
            q_open,
            col_clean.replace(q_close, &format!("{}{}", q_close, q_close)),
            q_close
        );

        // Handle rename if new_name is supplied
        if let Some(ref new_name) = req.new_name {
            let new_col_clean: String = new_name
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            if new_col_clean.is_empty() {
                return Err(EngineError::Schema("Invalid new column name".into()));
            }
            let escaped_new_col = format!(
                "{}{}{}",
                q_open,
                new_col_clean.replace(q_close, &format!("{}{}", q_close, q_close)),
                q_close
            );

            let sql = if self.dialect() == "mssql" {
                format!(
                    "EXEC sp_rename '{}.{}', '{}', 'COLUMN'",
                    table.replace('\'', "''"),
                    col_clean.replace('\'', "''"),
                    new_col_clean.replace('\'', "''")
                )
            } else {
                format!(
                    "ALTER TABLE {} RENAME COLUMN {} TO {}",
                    escaped_table, escaped_col, escaped_new_col
                )
            };
            self.execute(&sql, &[]).await?;
        }

        // Handle type modification if data_type is supplied
        if let Some(ref data_type) = req.data_type {
            let target_col = if let Some(ref new_name) = req.new_name {
                let n: String = new_name
                    .chars()
                    .filter(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                format!(
                    "{}{}{}",
                    q_open,
                    n.replace(q_close, &format!("{}{}", q_close, q_close)),
                    q_close
                )
            } else {
                escaped_col
            };

            let sql = match self.dialect() {
                "mysql" | "clickhouse" => {
                    format!(
                        "ALTER TABLE {} MODIFY COLUMN {} {}",
                        escaped_table, target_col, data_type
                    )
                }
                "postgres" => {
                    format!(
                        "ALTER TABLE {} ALTER COLUMN {} TYPE {}",
                        escaped_table, target_col, data_type
                    )
                }
                "mssql" => {
                    format!(
                        "ALTER TABLE {} ALTER COLUMN {} {}",
                        escaped_table, target_col, data_type
                    )
                }
                "oracle" => {
                    format!(
                        "ALTER TABLE {} MODIFY ({} {})",
                        escaped_table, target_col, data_type
                    )
                }
                "sqlite" => {
                    return Err(EngineError::Execution(
                        "SQLite does not support altering column types via ALTER TABLE".into(),
                    ))
                }
                _ => {
                    format!(
                        "ALTER TABLE {} ALTER COLUMN {} TYPE {}",
                        escaped_table, target_col, data_type
                    )
                }
            };
            self.execute(&sql, &[]).await?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_table_info_model() {
        let table = TableInfo {
            name: "users".to_string(),
            row_count_estimate: 42,
            columns: None,
            foreign_keys: None,
        };
        assert_eq!(table.name, "users");
        assert_eq!(table.row_count_estimate, 42);
        assert!(table.columns.is_none());
        assert!(table.foreign_keys.is_none());
    }

    #[test]
    fn test_foreign_key_info_model() {
        let fk = ForeignKeyInfo {
            column: "org_id".to_string(),
            referenced_table: "organizations".to_string(),
            referenced_column: "id".to_string(),
        };
        assert_eq!(fk.column, "org_id");
        assert_eq!(fk.referenced_table, "organizations");
        assert_eq!(fk.referenced_column, "id");
    }

    #[test]
    fn test_modify_and_drop_column_requests() {
        let req = ModifyColumnRequest {
            name: "email".to_string(),
            new_name: Some("user_email".to_string()),
            data_type: Some("VARCHAR(255)".to_string()),
        };
        assert_eq!(req.name, "email");
        assert_eq!(req.new_name.as_deref(), Some("user_email"));
        assert_eq!(req.data_type.as_deref(), Some("VARCHAR(255)"));

        let drop_req = DropColumnRequest {
            name: "legacy_field".to_string(),
        };
        assert_eq!(drop_req.name, "legacy_field");
    }
}
