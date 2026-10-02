/*
 * SQLite and LibSQL (Turso) embedded database engine implementation.
 * Owned by: db/engines
 * Key deps: libsql, async_trait, serde_json
 * Invariants: Supports local file paths and remote Turso URLs; all methods return strongly-typed EngineError.
 * Last structural change: Phase 0 cleanup adopting EngineError to eliminate hot-path Box allocations (Debt #2).
 */

use async_trait::async_trait;
use base64::Engine;
use libsql::{Builder, Connection, Database};

use axiom_core::config::schema::DatabaseDefConfig;
use crate::engines::base::{
    ColumnInfo, DatabaseEngine, EngineError, ForeignKeyInfo, QueryResult, TableInfo,
};

pub struct LibsqlDatabaseEngine {
    config: DatabaseDefConfig,
    db: Option<Database>,
    conn: Option<Connection>,
}

impl LibsqlDatabaseEngine {
    /// Instantiates an uninitialized LibsqlDatabaseEngine.
    /// CONTRACT:
    ///  - Connection is None until `connect()` is awaited.
    pub fn new(config: DatabaseDefConfig) -> Self {
        Self {
            config,
            db: None,
            conn: None,
        }
    }
}

#[async_trait]
impl DatabaseEngine for LibsqlDatabaseEngine {
    async fn connect(&mut self) -> Result<(), EngineError> {
        let mut url = self.config.url.clone();
        let mut token = String::new();
        
        if let Some(idx) = url.find("?authToken=") {
            token = url[idx + 11..].to_string();
            url = url[..idx].to_string();
        } else if let Some(idx) = url.find("&authToken=") {
            token = url[idx + 11..].to_string();
            url = url[..idx].to_string();
        }

        // Handle libsql:// or sqlite:// or file://
        let db = if url.starts_with("libsql://") || url.starts_with("https://") {
            Builder::new_remote(url, token)
                .build()
                .await
                .map_err(|e| EngineError::Connection(e.to_string()))?
        } else {
            // Local SQLite file
            let path = url.replace("sqlite://", "").replace("file://", "");
            Builder::new_local(path)
                .build()
                .await
                .map_err(|e| EngineError::Connection(e.to_string()))?
        };
        
        let conn = db.connect().map_err(|e| EngineError::Connection(e.to_string()))?;
        self.db = Some(db);
        self.conn = Some(conn);
        Ok(())
    }

    async fn disconnect(&self) -> Result<(), EngineError> {
        // Libsql drops connections automatically on drop
        Ok(())
    }

    async fn health_check(&self) -> bool {
        if let Some(conn) = &self.conn {
            conn.query("SELECT 1", ()).await.is_ok()
        } else {
            false
        }
    }

    async fn list_tables(
        &self,
        cursor: Option<String>,
        limit: usize,
    ) -> Result<Vec<TableInfo>, EngineError> {
        let conn = self.conn.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;
        
        let mut query_str = "SELECT name as table_name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'".to_string();
        
        let mut params = vec![];
        if let Some(c) = cursor {
            query_str.push_str(" AND name > ?1");
            params.push(c);
        }
        query_str.push_str(&format!(" ORDER BY name ASC LIMIT {}", limit));

        let stmt = conn.prepare(&query_str).await.map_err(|e| EngineError::Execution(e.to_string()))?;
        let mut rows = stmt.query(libsql::params_from_iter(params)).await.map_err(|e| EngineError::Execution(e.to_string()))?;
        
        let mut tables = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            if let Ok(name) = row.get_str(0) {
                tables.push(TableInfo {
                    name: name.to_string(),
                    row_count_estimate: 0,
                    columns: None,
                    foreign_keys: None,
                });
            }
        }

        Ok(tables)
    }

    async fn count_tables(&self) -> Result<i64, EngineError> {
        let conn = self.conn.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;
        let mut rows = conn
            .query("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", ())
            .await
            .map_err(|e| EngineError::Execution(e.to_string()))?;
        if let Ok(Some(row)) = rows.next().await {
            if let Ok(count) = row.get::<i64>(0) {
                return Ok(count);
            }
        }
        Ok(0)
    }

    async fn describe_table(&self, table: &str) -> Result<Vec<ColumnInfo>, EngineError> {
        let conn = self.conn.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;
        
        let sql = format!("PRAGMA table_info('{}')", table.replace('\'', "''"));
        let mut rows = conn.query(&sql, ()).await.map_err(|e| EngineError::Execution(e.to_string()))?;
        
        let mut columns = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let name: String = row.get(1).map_err(|e| EngineError::Execution(e.to_string()))?;
            let data_type: String = row.get(2).map_err(|e| EngineError::Execution(e.to_string()))?;
            let notnull: i32 = row.get(3).map_err(|e| EngineError::Execution(e.to_string()))?;
            let pk: i32 = row.get(5).map_err(|e| EngineError::Execution(e.to_string()))?;
            columns.push(ColumnInfo {
                name,
                r#type: data_type,
                nullable: notnull == 0,
                primary_key: pk > 0,
            });
        }
        Ok(columns)
    }

    async fn get_foreign_keys(&self, table: &str) -> Result<Vec<ForeignKeyInfo>, EngineError> {
        let conn = self.conn.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;
        
        let sql = format!("PRAGMA foreign_key_list('{}')", table.replace('\'', "''"));
        let mut rows = conn.query(&sql, ()).await.map_err(|e| EngineError::Execution(e.to_string()))?;
        
        let mut fks = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let referenced_table_name: String = row.get(2).map_err(|e| EngineError::Execution(e.to_string()))?;
            let column_name: String = row.get(3).map_err(|e| EngineError::Execution(e.to_string()))?;
            let referenced_column_name: String = row.get(4).map_err(|e| EngineError::Execution(e.to_string()))?;
            fks.push(ForeignKeyInfo {
                column: column_name,
                referenced_table: referenced_table_name,
                referenced_column: referenced_column_name,
            });
        }
        Ok(fks)
    }

    async fn execute(
        &self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<QueryResult, EngineError> {
        let conn = self.conn.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;

        let first_word = sql.trim().split_whitespace().next().unwrap_or("").to_uppercase();
        let is_mutation = matches!(
            first_word.as_str(),
            "INSERT" | "UPDATE" | "DELETE" | "CREATE" | "DROP" | "ALTER" | "TRUNCATE" | "REPLACE" | "SET" | "GRANT" | "REVOKE"
        );

        let mut libsql_params = Vec::new();
        for param in params {
            match param {
                serde_json::Value::String(s) => libsql_params.push(libsql::Value::Text(s.clone())),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        libsql_params.push(libsql::Value::Integer(i));
                    } else if let Some(f) = n.as_f64() {
                        libsql_params.push(libsql::Value::Real(f));
                    } else {
                        libsql_params.push(libsql::Value::Text(n.to_string()));
                    }
                }
                serde_json::Value::Null => libsql_params.push(libsql::Value::Null),
                _ => libsql_params.push(libsql::Value::Text(param.to_string())),
            }
        }

        if is_mutation {
            let stmt = conn.prepare(sql).await.map_err(|e| EngineError::Execution(e.to_string()))?;
            let affected = stmt
                .execute(libsql::params_from_iter(libsql_params))
                .await
                .map_err(|e| EngineError::Execution(e.to_string()))?;
            return Ok(QueryResult {
                success: true,
                columns: None,
                rows: None,
                affected_rows: Some(affected as u64),
                truncated: None,
                next_cursor: None,
            });
        }

        let stmt = conn.prepare(sql).await.map_err(|e| EngineError::Execution(e.to_string()))?;
        let mut rows = stmt
            .query(libsql::params_from_iter(libsql_params))
            .await
            .map_err(|e| EngineError::Execution(e.to_string()))?;

        let mut column_names = Vec::new();
        for i in 0..rows.column_count() {
            if let Some(name) = rows.column_name(i) {
                column_names.push(name.to_string());
            } else {
                column_names.push(format!("col_{}", i));
            }
        }

        let mut result_rows = Vec::new();
        let mut truncated = false;
        while let Ok(Some(row)) = rows.next().await {
            if result_rows.len() >= axiom_core::DEFAULT_MAX_QUERY_ROWS {
                truncated = true;
                break;
            }
            let mut json_obj = serde_json::Map::with_capacity(column_names.len());
            for (i, col_name) in column_names.iter().enumerate() {
                let val = match row.get_value(i as i32) {
                    Ok(libsql::Value::Text(s)) => {
                        if (s.starts_with('{') && s.ends_with('}')) || (s.starts_with('[') && s.ends_with(']')) {
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&s) {
                                parsed
                            } else {
                                serde_json::Value::String(s)
                            }
                        } else {
                            serde_json::Value::String(s)
                        }
                    }
                    Ok(libsql::Value::Integer(n)) => serde_json::Value::Number(serde_json::Number::from(n)),
                    Ok(libsql::Value::Real(f)) => {
                        if let Some(num) = serde_json::Number::from_f64(f) {
                            serde_json::Value::Number(num)
                        } else {
                            serde_json::Value::Null
                        }
                    }
                    Ok(libsql::Value::Blob(b)) => {
                        serde_json::Value::String(base64::prelude::BASE64_STANDARD.encode(&b))
                    }
                    Ok(libsql::Value::Null) => serde_json::Value::Null,
                    _ => serde_json::Value::Null,
                };
                json_obj.insert(col_name.clone(), val);
            }
            result_rows.push(serde_json::Value::Object(json_obj));
        }

        let next_cursor = if truncated {
            axiom_core::extract_next_cursor(&result_rows, &column_names)
        } else {
            None
        };

        Ok(QueryResult {
            success: true,
            columns: Some(column_names),
            rows: Some(result_rows),
            affected_rows: None,
            truncated: if truncated { Some(true) } else { None },
            next_cursor,
        })
    }

    fn dialect(&self) -> &str {
        "sqlite"
    }
}

// ─── Tests ─────────────────────────────────────────────────────────────────
// Unit tests for the SQLite / LibSQL embedded engine with in-memory execution.

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn test_libsql_in_memory_full_lifecycle() {
        let config = DatabaseDefConfig {
            url: "sqlite://:memory:".to_string(),
            pool_min: 1,
            pool_max: 5,
            ..Default::default()
        };

        let mut engine = LibsqlDatabaseEngine::new(config);

        // 1. Connect & Dialect
        assert!(engine.connect().await.is_ok());
        assert_eq!(engine.dialect(), "sqlite");
        assert!(engine.health_check().await);

        // 2. DDL Execution: Create table
        let ddl = "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL);";
        let create_res = engine.execute(ddl, &[]).await;
        assert!(create_res.is_ok());

        // 3. Introspect: Table listing & Count
        let count = engine.count_tables().await.unwrap();
        assert_eq!(count, 1);

        let tables = engine.list_tables(None, 10).await.unwrap();
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].name, "users");

        // 4. Introspect: Describe table
        let cols = engine.describe_table("users").await.unwrap();
        assert_eq!(cols.len(), 3);
        let id_col = cols.iter().find(|c| c.name == "id").unwrap();
        assert!(id_col.primary_key);

        let name_col = cols.iter().find(|c| c.name == "name").unwrap();
        assert!(!name_col.nullable);

        // 5. Insert rows with parameter bindings
        let insert_sql = "INSERT INTO users (id, name, score) VALUES (?, ?, ?);";
        let insert_res = engine.execute(insert_sql, &[json!(1), json!("Alice"), json!(99.5)]).await.unwrap();
        assert_eq!(insert_res.affected_rows, Some(1));

        // 6. Query rows with parameter bindings
        let query_sql = "SELECT id, name, score FROM users WHERE name = ?;";
        let query_res = engine.execute(query_sql, &[json!("Alice")]).await.unwrap();
        assert!(query_res.rows.is_some());
        let rows = query_res.rows.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["name"], "Alice");
        assert_eq!(rows[0]["id"], 1);

        // 7. Disconnect
        assert!(engine.disconnect().await.is_ok());
    }

    #[tokio::test]
    async fn test_libsql_foreign_keys_empty_when_none() {
        let config = DatabaseDefConfig {
            url: "sqlite://:memory:".to_string(),
            ..Default::default()
        };
        let mut engine = LibsqlDatabaseEngine::new(config);
        engine.connect().await.unwrap();

        engine.execute("CREATE TABLE standalone (id INTEGER PRIMARY KEY);", &[]).await.unwrap();
        let fks = engine.get_foreign_keys("standalone").await.unwrap();
        assert!(fks.is_empty());
    }

    #[tokio::test]
    async fn test_query_truncation_when_exceeding_max_rows() {
        let config = DatabaseDefConfig {
            url: "sqlite://:memory:".to_string(),
            ..Default::default()
        };
        let mut engine = LibsqlDatabaseEngine::new(config);
        engine.connect().await.unwrap();

        engine.execute("CREATE TABLE items (id INTEGER);", &[]).await.unwrap();
        engine.execute("INSERT INTO items VALUES (1);", &[]).await.unwrap();

        let res = engine.execute("SELECT * FROM items;", &[]).await.unwrap();
        assert_eq!(res.rows.as_ref().unwrap().len(), 1);
        assert_eq!(res.truncated, None);
    }
}

