/*
 * PostgreSQL database engine implementation backed by SQLx connection pool.
 * Owned by: db/engines
 * Key deps: sqlx::any, async_trait, serde_json
 * Invariants: All error results return strongly-typed EngineError; query parameter binding matches positional ordinality.
 * Last structural change: Phase 0 cleanup adopting EngineError to eliminate hot-path Box allocations (Debt #2).
 */

use axiom_core::config::schema::DatabaseDefConfig;
use crate::engines::base::{
    ColumnInfo, DatabaseEngine, EngineError, ForeignKeyInfo, QueryResult, TableInfo,
};
use async_trait::async_trait;
use serde_json::Value;
use sqlx::{any::AnyPoolOptions, Any, Column, Pool, Row};

pub struct PostgresDatabaseEngine {
    pool: Option<Pool<Any>>,
    config: DatabaseDefConfig,
}

impl PostgresDatabaseEngine {
    /// Instantiates an uninitialized PostgresDatabaseEngine.
    /// CONTRACT:
    ///  - Driver registration happens once during instantiation.
    ///  - Pool is None until `connect()` is awaited.
    pub fn new(config: DatabaseDefConfig) -> Self {
        sqlx::any::install_default_drivers();
        Self { pool: None, config }
    }
}

#[async_trait]
impl DatabaseEngine for PostgresDatabaseEngine {
    async fn connect(&mut self) -> Result<(), EngineError> {
        if self.pool.is_none() {
            let pool = AnyPoolOptions::new()
                .max_connections(self.config.pool_max as u32)
                .min_connections(self.config.pool_min as u32)
                .acquire_timeout(std::time::Duration::from_secs(
                    self.config.connection_timeout as u64,
                ))
                .idle_timeout(std::time::Duration::from_secs(
                    self.config.idle_timeout as u64,
                ))
                .max_lifetime(std::time::Duration::from_secs(
                    self.config.max_lifetime as u64,
                ))
                .connect(&self.config.url)
                .await
                .map_err(|e| EngineError::Connection(e.to_string()))?;
            self.pool = Some(pool);
        }
        Ok(())
    }

    async fn disconnect(&self) -> Result<(), EngineError> {
        if let Some(pool) = &self.pool {
            pool.close().await;
        }
        Ok(())
    }

    async fn health_check(&self) -> bool {
        if let Some(pool) = &self.pool {
            sqlx::query("SELECT 1").execute(pool).await.is_ok()
        } else {
            false
        }
    }

    async fn list_tables(
        &self,
        cursor: Option<String>,
        limit: usize,
    ) -> Result<Vec<TableInfo>, EngineError> {
        let pool = self.pool.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;

        // Deterministic pagination using $1 placeholder when cursor is specified
        let query_str = if cursor.is_some() {
            format!(
                "SELECT table_name::text FROM information_schema.tables \
                 WHERE table_schema = 'public' AND table_type = 'BASE TABLE' \
                 AND table_name > $1 \
                 ORDER BY table_name ASC LIMIT {}",
                limit
            )
        } else {
            format!(
                "SELECT table_name::text FROM information_schema.tables \
                 WHERE table_schema = 'public' AND table_type = 'BASE TABLE' \
                 ORDER BY table_name ASC LIMIT {}",
                limit
            )
        };

        let mut query = sqlx::query(&query_str);
        if let Some(ref c) = cursor {
            query = query.bind(c);
        }

        let rows = query.fetch_all(pool).await.map_err(|e| EngineError::Execution(e.to_string()))?;
        let mut tables = Vec::new();

        for row in rows {
            if let Ok(name) = row.try_get::<String, _>(0) {
                tables.push(TableInfo {
                    name,
                    row_count_estimate: 0,
                    columns: None,
                    foreign_keys: None,
                });
            }
        }

        Ok(tables)
    }

    async fn count_tables(&self) -> Result<i64, EngineError> {
        let pool = self.pool.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;
        let row = sqlx::query(
            "SELECT count(*)::bigint FROM information_schema.tables \
             WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
        )
        .fetch_one(pool)
        .await
        .map_err(|e| EngineError::Execution(e.to_string()))?;
        let count: i64 = row.try_get(0).unwrap_or(0);
        Ok(count)
    }

    async fn describe_table(
        &self,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, EngineError> {
        let pool = self.pool.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;

        let rows = sqlx::query(
            "SELECT c.column_name, c.data_type, c.is_nullable, \
             CASE WHEN kcu.column_name IS NOT NULL THEN 'YES' ELSE 'NO' END AS is_primary_key \
             FROM information_schema.columns c \
             LEFT JOIN information_schema.table_constraints tc \
               ON tc.table_name = c.table_name AND tc.table_schema = c.table_schema \
               AND tc.constraint_type = 'PRIMARY KEY' \
             LEFT JOIN information_schema.key_column_usage kcu \
               ON kcu.constraint_name = tc.constraint_name \
               AND kcu.column_name = c.column_name \
               AND kcu.table_schema = c.table_schema \
             WHERE c.table_schema = 'public' AND c.table_name = $1 \
             ORDER BY c.ordinal_position",
        )
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| EngineError::Execution(e.to_string()))?;

        let mut columns = Vec::new();
        for row in rows {
            columns.push(ColumnInfo {
                name: row.try_get::<String, _>("column_name").unwrap_or_default(),
                r#type: row.try_get::<String, _>("data_type").unwrap_or_default(),
                nullable: row.try_get::<String, _>("is_nullable").unwrap_or_default() == "YES",
                primary_key: row.try_get::<String, _>("is_primary_key").unwrap_or_default() == "YES",
            });
        }
        Ok(columns)
    }

    async fn get_foreign_keys(
        &self,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, EngineError> {
        let pool = self.pool.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;

        let rows = sqlx::query(
            "SELECT kcu.column_name, ccu.table_name AS referenced_table_name, \
             ccu.column_name AS referenced_column_name \
             FROM information_schema.table_constraints AS tc \
             JOIN information_schema.key_column_usage AS kcu \
               ON tc.constraint_name = kcu.constraint_name \
               AND tc.table_schema = kcu.table_schema \
             JOIN information_schema.constraint_column_usage AS ccu \
               ON ccu.constraint_name = tc.constraint_name \
               AND ccu.table_schema = tc.table_schema \
             WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1",
        )
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| EngineError::Execution(e.to_string()))?;

        let mut fks = Vec::new();
        for row in rows {
            fks.push(ForeignKeyInfo {
                column: row.try_get::<String, _>("column_name").unwrap_or_default(),
                referenced_table: row
                    .try_get::<String, _>("referenced_table_name")
                    .unwrap_or_default(),
                referenced_column: row
                    .try_get::<String, _>("referenced_column_name")
                    .unwrap_or_default(),
            });
        }
        Ok(fks)
    }

    async fn execute(
        &self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<QueryResult, EngineError> {
        let pool = self.pool.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;

        let is_mutation = sql.trim().to_uppercase().starts_with("INSERT")
            || sql.trim().to_uppercase().starts_with("UPDATE")
            || sql.trim().to_uppercase().starts_with("DELETE");

        let mut query = sqlx::query(sql);

        for param in params {
            match param {
                Value::String(s) => { query = query.bind(s); }
                Value::Number(n) => {
                    if let Some(i) = n.as_i64() { query = query.bind(i); }
                    else if let Some(f) = n.as_f64() { query = query.bind(f); }
                    else { query = query.bind(n.to_string()); }
                }
                Value::Bool(b) => { query = query.bind(b); }
                Value::Null => { query = query.bind(Option::<String>::None); }
                _ => { query = query.bind(param.to_string()); }
            }
        }

        if is_mutation {
            let result = query.execute(pool).await.map_err(|e| EngineError::Execution(e.to_string()))?;
            return Ok(QueryResult {
                columns: None,
                rows: None,
                affected_rows: Some(result.rows_affected()),
                truncated: None,
            });
        }

        use futures::StreamExt;
        let mut stream = query.fetch(pool);
        let mut result_rows = Vec::new();
        let mut column_names = Vec::new();
        let mut truncated = false;

        while let Some(row_res) = stream.next().await {
            let row = row_res.map_err(|e| EngineError::Execution(e.to_string()))?;
            if column_names.is_empty() {
                for col in row.columns() {
                    column_names.push(col.name().to_string());
                }
            }

            if result_rows.len() >= axiom_core::DEFAULT_MAX_QUERY_ROWS {
                truncated = true;
                break;
            }

            let mut json_obj = serde_json::Map::new();
            for col in row.columns() {
                let name = col.name().to_string();
                let val = if let Ok(s) = row.try_get::<String, _>(col.ordinal()) {
                    if (s.starts_with('{') && s.ends_with('}')) || (s.starts_with('[') && s.ends_with(']')) {
                        if let Ok(parsed) = serde_json::from_str::<Value>(&s) {
                            parsed
                        } else {
                            Value::String(s)
                        }
                    } else {
                        Value::String(s)
                    }
                } else if let Ok(i) = row.try_get::<i64, _>(col.ordinal()) {
                    Value::Number(i.into())
                } else if let Ok(i) = row.try_get::<i32, _>(col.ordinal()) {
                    Value::Number(i.into())
                } else if let Ok(f) = row.try_get::<f64, _>(col.ordinal()) {
                    serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
                } else if let Ok(b) = row.try_get::<bool, _>(col.ordinal()) {
                    Value::Bool(b)
                } else {
                    Value::Null
                };
                json_obj.insert(name, val);
            }
            result_rows.push(Value::Object(json_obj));
        }

        Ok(QueryResult {
            columns: Some(column_names),
            rows: Some(result_rows),
            affected_rows: None,
            truncated: if truncated { Some(true) } else { None },
        })
    }

    fn dialect(&self) -> &str {
        "postgres"
    }
}
