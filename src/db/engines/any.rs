use crate::config::schema::DatabaseDefConfig;
use crate::db::engines::base::{
    ColumnInfo, DatabaseEngine, ForeignKeyInfo, QueryResult, TableInfo,
};
use async_trait::async_trait;
use serde_json::Value;
use sqlx::{any::AnyPoolOptions, Any, Column, Pool, Row};

pub struct AnyDatabaseEngine {
    pool: Option<Pool<Any>>,
    config: DatabaseDefConfig,
}

impl AnyDatabaseEngine {
    pub fn new(config: DatabaseDefConfig) -> Self {
        sqlx::any::install_default_drivers();
        Self { pool: None, config }
    }
}

#[async_trait]
impl DatabaseEngine for AnyDatabaseEngine {
    async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
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
                .await?;
            self.pool = Some(pool);
        }
        Ok(())
    }

    async fn disconnect(&self) -> Result<(), Box<dyn std::error::Error>> {
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

    async fn list_tables(&self) -> Result<Vec<TableInfo>, Box<dyn std::error::Error>> {
        // Simplified generic implementation, usually requires dialect-specific introspection.
        // We'll return an empty list for this stub to satisfy the compiler while showing the structure.
        Ok(vec![])
    }

    async fn count_tables(&self) -> Result<i64, Box<dyn std::error::Error>> {
        Ok(0)
    }

    async fn describe_table(
        &self,
        _table: &str,
    ) -> Result<Vec<ColumnInfo>, Box<dyn std::error::Error>> {
        Ok(vec![])
    }

    async fn get_foreign_keys(
        &self,
        _table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, Box<dyn std::error::Error>> {
        Ok(vec![])
    }

    async fn execute(
        &self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<QueryResult, Box<dyn std::error::Error>> {
        let pool = self.pool.as_ref().ok_or("Not connected")?;

        let is_mutation = sql.trim().to_uppercase().starts_with("INSERT")
            || sql.trim().to_uppercase().starts_with("UPDATE")
            || sql.trim().to_uppercase().starts_with("DELETE");

        let mut query = sqlx::query(sql);

        for param in params {
            match param {
                serde_json::Value::String(s) => {
                    query = query.bind(s);
                }
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        query = query.bind(i);
                    } else if let Some(f) = n.as_f64() {
                        query = query.bind(f);
                    } else {
                        query = query.bind(n.to_string());
                    }
                }
                serde_json::Value::Bool(b) => {
                    query = query.bind(b);
                }
                serde_json::Value::Null => {
                    query = query.bind(Option::<String>::None);
                }
                _ => {
                    query = query.bind(param.to_string());
                }
            }
        }

        if is_mutation {
            let result = query.execute(pool).await?;
            return Ok(QueryResult {
                columns: None,
                rows: None,
                affected_rows: Some(result.rows_affected()),
            });
        }

        // Generic JSON mapping for read queries
        let rows = query.fetch_all(pool).await?;

        let mut result_rows = Vec::new();
        let mut column_names = Vec::new();

        if let Some(first_row) = rows.first() {
            for col in first_row.columns() {
                column_names.push(col.name().to_string());
            }
        }

        for row in rows {
            let mut json_obj = serde_json::Map::new();
            for col in row.columns() {
                // In AnyPool, value coercion to string is the safest generic fallback
                // A production system would match on the TypeInfo
                let raw_val: Result<String, _> = row.try_get(col.ordinal());
                if let Ok(val) = raw_val {
                    json_obj.insert(col.name().to_string(), Value::String(val));
                } else {
                    json_obj.insert(col.name().to_string(), Value::Null);
                }
            }
            result_rows.push(Value::Object(json_obj));
        }

        Ok(QueryResult {
            columns: Some(column_names),
            rows: Some(result_rows),
            affected_rows: None,
        })
    }

    fn dialect(&self) -> &str {
        "any"
    }
}
