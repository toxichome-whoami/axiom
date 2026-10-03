/*
 * MySQL and MariaDB database engine implementation backed by SQLx connection pool.
 * Owned by: db/engines
 * Key deps: sqlx::any, async_trait, serde_json
 * Invariants: All error results return strongly-typed EngineError; parameter binding uses '?' positional placeholders.
 * Last structural change: Phase 0 cleanup adopting EngineError to eliminate hot-path Box allocations (Debt #2).
 */

use axiom_core::config::schema::DatabaseDefConfig;
use crate::engines::base::{
    ColumnInfo, DatabaseEngine, EngineError, ForeignKeyInfo, QueryResult, TableInfo,
};
use async_trait::async_trait;
use serde_json::Value;
use sqlx::{mysql::MySqlPoolOptions, Column, MySqlPool, Row, TypeInfo};

/// Precomputed column classification for fast zero-trial MySQL row decoding.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MySqlColKind {
    Bool,
    Int16,
    Int32,
    Int64,
    Float32,
    Float64,
    Numeric,
    Json,
    DateTime,
    Date,
    String,
    Fallback,
}

impl MySqlColKind {
    #[inline]
    fn from_type_name(name: &str) -> Self {
        match name.to_ascii_uppercase().as_str() {
            "BOOLEAN" | "BOOL" => MySqlColKind::Bool,
            "TINYINT" | "SMALLINT" | "YEAR" => MySqlColKind::Int16,
            "INT" | "INTEGER" | "MEDIUMINT" => MySqlColKind::Int32,
            "BIGINT" => MySqlColKind::Int64,
            "FLOAT" => MySqlColKind::Float32,
            "DOUBLE" => MySqlColKind::Float64,
            "DECIMAL" | "NUMERIC" => MySqlColKind::Numeric,
            "JSON" => MySqlColKind::Json,
            "TIMESTAMP" | "DATETIME" => MySqlColKind::DateTime,
            "DATE" => MySqlColKind::Date,
            "VARCHAR" | "CHAR" | "TEXT" | "TINYTEXT" | "MEDIUMTEXT" | "LONGTEXT" | "ENUM" | "SET" => MySqlColKind::String,
            _ => MySqlColKind::Fallback,
        }
    }
}

pub struct MysqlDatabaseEngine {
    pool: Option<MySqlPool>,
    config: DatabaseDefConfig,
}

impl MysqlDatabaseEngine {
    /// Instantiates an uninitialized MysqlDatabaseEngine.
    /// CONTRACT:
    ///  - Pool is None until `connect()` is awaited.
    pub fn new(config: DatabaseDefConfig) -> Self {
        Self { pool: None, config }
    }
}

#[async_trait]
impl DatabaseEngine for MysqlDatabaseEngine {
    async fn connect(&mut self) -> Result<(), EngineError> {
        if self.pool.is_none() {
            let connect_options = self.config.url.parse::<sqlx::mysql::MySqlConnectOptions>()
                .map_err(|e| EngineError::Connection(e.to_string()))?
                .statement_cache_capacity(1024);

            let pool = MySqlPoolOptions::new()
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
                .connect_with(connect_options)
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

        // MySQL parameter binding uses '?' placeholder
        let query_str = if cursor.is_some() {
            format!(
                "SELECT TABLE_NAME as table_name FROM information_schema.tables \
                 WHERE table_schema = DATABASE() AND TABLE_NAME > ? \
                 ORDER BY TABLE_NAME ASC LIMIT {}",
                limit
            )
        } else {
            format!(
                "SELECT TABLE_NAME as table_name FROM information_schema.tables \
                 WHERE table_schema = DATABASE() \
                 ORDER BY TABLE_NAME ASC LIMIT {}",
                limit
            )
        };

        let mut query = sqlx::query(&query_str);
        if let Some(c) = cursor {
            query = query.bind(c);
        }

        let rows = query.fetch_all(pool).await.map_err(|e| EngineError::Execution(e.to_string()))?;
        let mut tables = Vec::new();

        for row in rows {
            if let Ok(name) = row.try_get::<String, _>("table_name") {
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
            "SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = DATABASE()",
        )
        .fetch_one(pool)
        .await
        .map_err(|e| EngineError::Execution(e.to_string()))?;
        let count: i64 = row.try_get("cnt").unwrap_or(0);
        Ok(count)
    }

    async fn describe_table(
        &self,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, EngineError> {
        let pool = self.pool.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;

        let rows = sqlx::query(
            "SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type, \
             IS_NULLABLE as is_nullable, COLUMN_KEY as column_key \
             FROM information_schema.COLUMNS \
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? \
             ORDER BY ORDINAL_POSITION",
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
                primary_key: row.try_get::<String, _>("column_key").unwrap_or_default() == "PRI",
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
            "SELECT COLUMN_NAME as column_name, \
             REFERENCED_TABLE_NAME as referenced_table_name, \
             REFERENCED_COLUMN_NAME as referenced_column_name \
             FROM information_schema.KEY_COLUMN_USAGE \
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? \
             AND REFERENCED_TABLE_NAME IS NOT NULL",
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

        let first_word = sql.split_whitespace().next().unwrap_or("").to_uppercase();
        let is_mutation = matches!(
            first_word.as_str(),
            "INSERT" | "UPDATE" | "DELETE" | "CREATE" | "DROP" | "ALTER" | "TRUNCATE" | "REPLACE" | "SET" | "GRANT" | "REVOKE"
        );

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
                success: true,
                columns: None,
                rows: None,
                affected_rows: Some(result.rows_affected()),
                truncated: None,
                next_cursor: None,
            });
        }

        use futures::StreamExt;
        let mut stream = query.fetch(pool);
        let mut result_rows = Vec::new();
        let mut column_names = Vec::new();
        let mut column_kinds = Vec::new();
        let mut truncated = false;

        while let Some(row_res) = stream.next().await {
            let row = row_res.map_err(|e| EngineError::Execution(e.to_string()))?;
            if column_names.is_empty() {
                for col in row.columns() {
                    column_names.push(col.name().to_string());
                    column_kinds.push(MySqlColKind::from_type_name(col.type_info().name()));
                }
            }

            if result_rows.len() >= axiom_core::DEFAULT_MAX_QUERY_ROWS {
                truncated = true;
                break;
            }

            let mut json_obj = serde_json::Map::with_capacity(column_names.len());
            for (idx, name) in column_names.iter().enumerate() {
                let val = match column_kinds[idx] {
                    MySqlColKind::String => {
                        if let Ok(Some(s)) = row.try_get::<Option<String>, _>(idx) {
                            if (s.starts_with('{') && s.ends_with('}')) || (s.starts_with('[') && s.ends_with(']')) {
                                serde_json::from_str::<Value>(&s).unwrap_or(Value::String(s))
                            } else {
                                Value::String(s)
                            }
                        } else {
                            Value::Null
                        }
                    }
                    MySqlColKind::Json => {
                        if let Ok(Some(v)) = row.try_get::<Option<Value>, _>(idx) {
                            v
                        } else if let Ok(Some(s)) = row.try_get::<Option<String>, _>(idx) {
                            serde_json::from_str::<Value>(&s).unwrap_or(Value::String(s))
                        } else {
                            Value::Null
                        }
                    }
                    MySqlColKind::Int64 => {
                        if let Ok(Some(i)) = row.try_get::<Option<i64>, _>(idx) {
                            Value::Number(i.into())
                        } else {
                            Value::Null
                        }
                    }
                    MySqlColKind::Int32 => {
                        if let Ok(Some(i)) = row.try_get::<Option<i32>, _>(idx) {
                            Value::Number(i.into())
                        } else {
                            Value::Null
                        }
                    }
                    MySqlColKind::Int16 => {
                        if let Ok(Some(i)) = row.try_get::<Option<i16>, _>(idx) {
                            Value::Number(i.into())
                        } else {
                            Value::Null
                        }
                    }
                    MySqlColKind::Float64 => {
                        if let Ok(Some(f)) = row.try_get::<Option<f64>, _>(idx) {
                            serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
                        } else {
                            Value::Null
                        }
                    }
                    MySqlColKind::Float32 => {
                        if let Ok(Some(f)) = row.try_get::<Option<f32>, _>(idx) {
                            serde_json::Number::from_f64(f as f64).map(Value::Number).unwrap_or(Value::Null)
                        } else {
                            Value::Null
                        }
                    }
                    MySqlColKind::Numeric => {
                        if let Ok(Some(s)) = row.try_get::<Option<String>, _>(idx) {
                            if let Ok(num) = s.parse::<serde_json::Number>() {
                                Value::Number(num)
                            } else {
                                Value::String(s)
                            }
                        } else if let Ok(Some(f)) = row.try_get::<Option<f64>, _>(idx) {
                            serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
                        } else {
                            Value::Null
                        }
                    }
                    MySqlColKind::Bool => {
                        if let Ok(Some(b)) = row.try_get::<Option<bool>, _>(idx) {
                            Value::Bool(b)
                        } else {
                            Value::Null
                        }
                    }
                    MySqlColKind::DateTime => {
                        if let Ok(Some(dt)) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(idx) {
                            Value::String(dt.to_rfc3339())
                        } else if let Ok(Some(dt)) = row.try_get::<Option<chrono::NaiveDateTime>, _>(idx) {
                            Value::String(dt.to_string())
                        } else {
                            Value::Null
                        }
                    }
                    MySqlColKind::Date => {
                        if let Ok(Some(d)) = row.try_get::<Option<chrono::NaiveDate>, _>(idx) {
                            Value::String(d.to_string())
                        } else {
                            Value::Null
                        }
                    }
                    MySqlColKind::Fallback => {
                        if let Ok(Some(s)) = row.try_get::<Option<String>, _>(idx) {
                            if (s.starts_with('{') && s.ends_with('}')) || (s.starts_with('[') && s.ends_with(']')) {
                                serde_json::from_str::<Value>(&s).unwrap_or(Value::String(s))
                            } else {
                                Value::String(s)
                            }
                        } else if let Ok(Some(i)) = row.try_get::<Option<i64>, _>(idx) {
                            Value::Number(i.into())
                        } else if let Ok(Some(i)) = row.try_get::<Option<i32>, _>(idx) {
                            Value::Number(i.into())
                        } else if let Ok(Some(f)) = row.try_get::<Option<f64>, _>(idx) {
                            serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
                        } else if let Ok(Some(b)) = row.try_get::<Option<bool>, _>(idx) {
                            Value::Bool(b)
                        } else {
                            Value::Null
                        }
                    }
                };
                json_obj.insert(name.clone(), val);
            }
            result_rows.push(Value::Object(json_obj));
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
        "mysql"
    }
}
