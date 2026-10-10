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
use sqlx::{postgres::PgPoolOptions, Column, PgPool, Row, TypeInfo};

/// Precomputed column classification for fast zero-trial PostgreSQL row decoding.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PgColKind {
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

impl PgColKind {
    #[inline]
    fn from_type_name(name: &str) -> Self {
        match name.to_ascii_uppercase().as_str() {
            "BOOL" | "BOOLEAN" => PgColKind::Bool,
            "INT2" | "SMALLINT" | "SMALLSERIAL" => PgColKind::Int16,
            "INT4" | "INT" | "INTEGER" | "SERIAL" => PgColKind::Int32,
            "INT8" | "BIGINT" | "BIGSERIAL" => PgColKind::Int64,
            "FLOAT4" | "REAL" => PgColKind::Float32,
            "FLOAT8" | "DOUBLE PRECISION" => PgColKind::Float64,
            "NUMERIC" | "DECIMAL" => PgColKind::Numeric,
            "JSON" | "JSONB" => PgColKind::Json,
            "TIMESTAMP" | "TIMESTAMPTZ" => PgColKind::DateTime,
            "DATE" => PgColKind::Date,
            "TEXT" | "VARCHAR" | "CHAR" | "BPCHAR" | "NAME" | "CITEXT" | "UUID" => PgColKind::String,
            _ => PgColKind::Fallback,
        }
    }
}

pub struct PostgresDatabaseEngine {
    pool: Option<PgPool>,
    config: DatabaseDefConfig,
}

impl PostgresDatabaseEngine {
    /// Instantiates an uninitialized PostgresDatabaseEngine.
    /// CONTRACT:
    ///  - Pool is None until `connect()` is awaited.
    pub fn new(config: DatabaseDefConfig) -> Self {
        Self { pool: None, config }
    }
}

#[async_trait]
impl DatabaseEngine for PostgresDatabaseEngine {
    async fn connect(&mut self) -> Result<(), EngineError> {
        if self.pool.is_none() {
            let connect_options = self.config.url.parse::<sqlx::postgres::PgConnectOptions>()
                .map_err(|e| EngineError::Connection(e.to_string()))?
                .statement_cache_capacity(1024);

            let pool = PgPoolOptions::new()
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
                    column_kinds.push(PgColKind::from_type_name(col.type_info().name()));
                }
            }

            if result_rows.len() >= axiom_core::DEFAULT_MAX_QUERY_ROWS {
                truncated = true;
                break;
            }

            let mut json_obj = serde_json::Map::with_capacity(column_names.len());
            for (idx, name) in column_names.iter().enumerate() {
                let val = match column_kinds[idx] {
                    PgColKind::String => {
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
                    PgColKind::Json => {
                        if let Ok(Some(v)) = row.try_get::<Option<Value>, _>(idx) {
                            v
                        } else if let Ok(Some(s)) = row.try_get::<Option<String>, _>(idx) {
                            serde_json::from_str::<Value>(&s).unwrap_or(Value::String(s))
                        } else {
                            Value::Null
                        }
                    }
                    PgColKind::Int64 => {
                        if let Ok(Some(i)) = row.try_get::<Option<i64>, _>(idx) {
                            Value::Number(i.into())
                        } else {
                            Value::Null
                        }
                    }
                    PgColKind::Int32 => {
                        if let Ok(Some(i)) = row.try_get::<Option<i32>, _>(idx) {
                            Value::Number(i.into())
                        } else {
                            Value::Null
                        }
                    }
                    PgColKind::Int16 => {
                        if let Ok(Some(i)) = row.try_get::<Option<i16>, _>(idx) {
                            Value::Number(i.into())
                        } else {
                            Value::Null
                        }
                    }
                    PgColKind::Float64 => {
                        if let Ok(Some(f)) = row.try_get::<Option<f64>, _>(idx) {
                            serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
                        } else {
                            Value::Null
                        }
                    }
                    PgColKind::Float32 => {
                        if let Ok(Some(f)) = row.try_get::<Option<f32>, _>(idx) {
                            serde_json::Number::from_f64(f as f64).map(Value::Number).unwrap_or(Value::Null)
                        } else {
                            Value::Null
                        }
                    }
                    PgColKind::Numeric => {
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
                    PgColKind::Bool => {
                        if let Ok(Some(b)) = row.try_get::<Option<bool>, _>(idx) {
                            Value::Bool(b)
                        } else {
                            Value::Null
                        }
                    }
                    PgColKind::DateTime => {
                        if let Ok(Some(dt)) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(idx) {
                            Value::String(dt.to_rfc3339())
                        } else if let Ok(Some(dt)) = row.try_get::<Option<chrono::NaiveDateTime>, _>(idx) {
                            Value::String(dt.to_string())
                        } else {
                            Value::Null
                        }
                    }
                    PgColKind::Date => {
                        if let Ok(Some(d)) = row.try_get::<Option<chrono::NaiveDate>, _>(idx) {
                            Value::String(d.to_string())
                        } else {
                            Value::Null
                        }
                    }
                    PgColKind::Fallback => {
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
        "postgres"
    }
}
