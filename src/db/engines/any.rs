use crate::config::schema::DatabaseDefConfig;
use crate::db::engines::base::{
    ColumnInfo, DatabaseEngine, ForeignKeyInfo, QueryResult, TableInfo,
};
use async_trait::async_trait;
use serde_json::Value;
use sqlx::{mysql::MySqlPoolOptions, postgres::PgPoolOptions, sqlite::SqlitePoolOptions, Column, MySqlPool, PgPool, Row, SqlitePool, TypeInfo};

pub enum NativePool {
    Postgres(PgPool),
    MySql(MySqlPool),
    Sqlite(SqlitePool),
}

pub struct AnyDatabaseEngine {
    pool: Option<NativePool>,
    config: DatabaseDefConfig,
}

impl AnyDatabaseEngine {
    pub fn new(config: DatabaseDefConfig) -> Self {
        Self { pool: None, config }
    }
}

#[async_trait]
impl DatabaseEngine for AnyDatabaseEngine {
    async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if self.pool.is_none() {
            let dialect = self.config.url.split(':').next().unwrap_or("");
            if dialect == "postgres" {
                let pool = PgPoolOptions::new()
                    .max_connections(self.config.pool_max as u32)
                    .min_connections(self.config.pool_min as u32)
                    .connect(&self.config.url)
                    .await?;
                self.pool = Some(NativePool::Postgres(pool));
            } else if dialect == "mysql" {
                let pool = MySqlPoolOptions::new()
                    .max_connections(self.config.pool_max as u32)
                    .min_connections(self.config.pool_min as u32)
                    .connect(&self.config.url)
                    .await?;
                self.pool = Some(NativePool::MySql(pool));
            } else if dialect == "sqlite" {
                let pool = SqlitePoolOptions::new()
                    .max_connections(self.config.pool_max as u32)
                    .min_connections(self.config.pool_min as u32)
                    .connect(&self.config.url)
                    .await?;
                self.pool = Some(NativePool::Sqlite(pool));
            } else {
                return Err("Unsupported database dialect".into());
            }
        }
        Ok(())
    }

    async fn disconnect(&self) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(pool) = &self.pool {
            match pool {
                NativePool::Postgres(p) => p.close().await,
                NativePool::MySql(p) => p.close().await,
                NativePool::Sqlite(p) => p.close().await,
            }
        }
        Ok(())
    }

    async fn health_check(&self) -> bool {
        if let Some(pool) = &self.pool {
            match pool {
                NativePool::Postgres(p) => sqlx::query("SELECT 1").execute(p).await.is_ok(),
                NativePool::MySql(p) => sqlx::query("SELECT 1").execute(p).await.is_ok(),
                NativePool::Sqlite(p) => sqlx::query("SELECT 1").execute(p).await.is_ok(),
            }
        } else {
            false
        }
    }

    async fn list_tables(
        &self,
        cursor: Option<String>,
        limit: usize,
    ) -> Result<Vec<TableInfo>, Box<dyn std::error::Error>> {
        let pool = self.pool.as_ref().ok_or("Not connected")?;
        let dialect = self.dialect();

        let mut query_str = String::new();
        if dialect == "postgres" {
            query_str.push_str("SELECT table_name::text as table_name FROM information_schema.tables WHERE table_schema = 'public'");
            if cursor.is_some() {
                query_str.push_str(" AND table_name::text > $1");
            }
            query_str.push_str(&format!(" ORDER BY table_name ASC LIMIT {}", limit));
        } else if dialect == "sqlite" {
            query_str.push_str("SELECT name as table_name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
            if cursor.is_some() {
                query_str.push_str(" AND name > ?");
            }
            query_str.push_str(&format!(" ORDER BY name ASC LIMIT {}", limit));
        } else {
            return Ok(vec![]);
        }

        let mut tables = Vec::new();

        match pool {
            NativePool::Postgres(p) => {
                let mut query = sqlx::query(&query_str);
                if let Some(c) = cursor { query = query.bind(c); }
                let rows = query.fetch_all(p).await?;
                for row in rows {
                    if let Ok(name) = row.try_get::<String, _>("table_name") {
                        tables.push(TableInfo { name, row_count_estimate: 0, columns: None, foreign_keys: None });
                    }
                }
            }
            NativePool::MySql(p) => {
                let mut query = sqlx::query(&query_str);
                if let Some(c) = cursor { query = query.bind(c); }
                let rows = query.fetch_all(p).await?;
                for row in rows {
                    if let Ok(name) = row.try_get::<String, _>("table_name") {
                        tables.push(TableInfo { name, row_count_estimate: 0, columns: None, foreign_keys: None });
                    }
                }
            }
            NativePool::Sqlite(p) => {
                let mut query = sqlx::query(&query_str);
                if let Some(c) = cursor { query = query.bind(c); }
                let rows = query.fetch_all(p).await?;
                for row in rows {
                    if let Ok(name) = row.try_get::<String, _>("table_name") {
                        tables.push(TableInfo { name, row_count_estimate: 0, columns: None, foreign_keys: None });
                    }
                }
            }
        }

        Ok(tables)
    }

    async fn count_tables(&self) -> Result<i64, Box<dyn std::error::Error>> { Ok(0) }
    async fn describe_table(&self, _table: &str) -> Result<Vec<ColumnInfo>, Box<dyn std::error::Error>> { Ok(vec![]) }
    async fn get_foreign_keys(&self, _table: &str) -> Result<Vec<ForeignKeyInfo>, Box<dyn std::error::Error>> { Ok(vec![]) }

    async fn execute(
        &self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<QueryResult, Box<dyn std::error::Error>> {
        let pool = self.pool.as_ref().ok_or("Not connected")?;

        let is_mutation = sql.trim().to_uppercase().starts_with("INSERT")
            || sql.trim().to_uppercase().starts_with("UPDATE")
            || sql.trim().to_uppercase().starts_with("DELETE");

        let mut affected = None;
        let mut column_names = Vec::new();
        let mut result_rows = Vec::new();

        macro_rules! execute_for_pool {
            ($p:expr) => {{
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
                    let result = query.execute($p).await?;
                    affected = Some(result.rows_affected());
                } else {
                    let rows = query.fetch_all($p).await?;
                    if let Some(first) = rows.first() {
                        for col in first.columns() {
                            column_names.push(col.name().to_string());
                        }
                    }
                    for row in rows {
                        let mut json_obj = serde_json::Map::new();
                        for col in row.columns() {
                            // Convert type dynamically
                            let col_name = col.name().to_string();
                            let type_name = col.type_info().name().to_uppercase();

                            let mut mapped_val = Value::Null;

                            if type_name.contains("BOOL") {
                                if let Ok(b) = row.try_get::<bool, _>(col.ordinal()) {
                                    mapped_val = Value::Bool(b);
                                }
                            } else if type_name.contains("INT") || type_name.contains("SERIAL") {
                                if let Ok(i) = row.try_get::<i64, _>(col.ordinal()) {
                                    mapped_val = Value::Number(serde_json::Number::from(i));
                                }
                            } else if type_name.contains("FLOAT") || type_name.contains("DOUBLE") || type_name.contains("NUMERIC") {
                                if let Ok(f) = row.try_get::<f64, _>(col.ordinal()) {
                                    if let Some(num) = serde_json::Number::from_f64(f) {
                                        mapped_val = Value::Number(num);
                                    }
                                }
                            } else {
                                if let Ok(s) = row.try_get::<String, _>(col.ordinal()) {
                                    mapped_val = Value::String(s);
                                }
                            }

                            json_obj.insert(col_name, mapped_val);
                        }
                        result_rows.push(Value::Object(json_obj));
                    }
                }
            }};
        }

        match pool {
            NativePool::Postgres(p) => execute_for_pool!(p),
            NativePool::MySql(p) => execute_for_pool!(p),
            NativePool::Sqlite(p) => execute_for_pool!(p),
        }

        Ok(QueryResult {
            columns: if column_names.is_empty() { None } else { Some(column_names) },
            rows: if result_rows.is_empty() && is_mutation { None } else { Some(result_rows) },
            affected_rows: affected,
        })
    }

    fn dialect(&self) -> &str {
        self.config.url.split(':').next().unwrap_or("any")
    }
}
