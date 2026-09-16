use async_trait::async_trait;
use std::sync::Arc;
use tiberius::{Client, Config, Query};
use tokio::net::TcpStream;
use tokio_util::compat::{TokioAsyncWriteCompatExt, Compat};
use tokio::sync::Mutex;
use serde_json::Value;

use crate::config::schema::DatabaseDefConfig;
use crate::db::engines::base::{ColumnInfo, DatabaseEngine, ForeignKeyInfo, QueryResult, TableInfo};

pub struct MssqlDatabaseEngine {
    config: DatabaseDefConfig,
    client: Option<Arc<Mutex<Client<Compat<TcpStream>>>>>,
}

impl MssqlDatabaseEngine {
    pub fn new(config: DatabaseDefConfig) -> Self {
        Self {
            config,
            client: None,
        }
    }
}

#[async_trait]
impl DatabaseEngine for MssqlDatabaseEngine {
    async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let config = Config::from_jdbc_string(&self.config.url)?;
        let tcp = TcpStream::connect(config.get_addr()).await?;
        tcp.set_nodelay(true)?;
        
        let client = Client::connect(config, tcp.compat_write()).await?;
        self.client = Some(Arc::new(Mutex::new(client)));
        
        Ok(())
    }

    async fn disconnect(&self) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    async fn health_check(&self) -> bool {
        if let Some(client) = &self.client {
            let mut guard = client.lock().await;
            let ok = guard.query("SELECT 1", &[]).await.is_ok(); ok
        } else {
            false
        }
    }

    async fn list_tables(
        &self,
        cursor: Option<String>,
        limit: usize,
    ) -> Result<Vec<TableInfo>, Box<dyn std::error::Error>> {
        let client_arc = self.client.as_ref().ok_or("Not connected")?;
        let mut client = client_arc.lock().await;
        
        let mut query_str = "SELECT TABLE_NAME as table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'".to_string();
        
        if cursor.is_some() {
            query_str.push_str(" AND TABLE_NAME > @P1");
        }
        query_str.push_str(" ORDER BY TABLE_NAME ASC");
        query_str.push_str(&format!(" OFFSET 0 ROWS FETCH NEXT {} ROWS ONLY", limit));
        
        let mut query = Query::new(&query_str);
        if let Some(c) = &cursor {
            query.bind(c.clone());
        }
        
        let stream = query.query(&mut *client).await?;
        let rows = stream.into_first_result().await?;
        
        let mut tables = Vec::new();
        for row in rows {
            if let Some(name) = row.try_get::<&str, _>("table_name")? {
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

    async fn count_tables(&self) -> Result<i64, Box<dyn std::error::Error>> {
        let client_arc = self.client.as_ref().ok_or("Not connected")?;
        let mut client = client_arc.lock().await;
        let stream = client.query("SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'", &[]).await?;
        let rows = stream.into_first_result().await?;
        
        if let Some(row) = rows.first() {
            if let Some(count) = row.try_get::<i32, _>("count")? {
                return Ok(count as i64);
            }
        }
        Ok(0)
    }

    async fn describe_table(&self, _table: &str) -> Result<Vec<ColumnInfo>, Box<dyn std::error::Error>> {
        Ok(vec![])
    }

    async fn get_foreign_keys(&self, _table: &str) -> Result<Vec<ForeignKeyInfo>, Box<dyn std::error::Error>> {
        Ok(vec![])
    }

    async fn execute(&self, sql: &str, params: &[serde_json::Value]) -> Result<QueryResult, Box<dyn std::error::Error>> {
        let client_arc = self.client.as_ref().ok_or("Not connected")?;
        let mut client = client_arc.lock().await;
        
        let is_mutation = sql.trim().to_uppercase().starts_with("INSERT")
            || sql.trim().to_uppercase().starts_with("UPDATE")
            || sql.trim().to_uppercase().starts_with("DELETE");

        // Keep allocations alive during query
        let mut string_params = Vec::new();
        let mut int_params = Vec::new();
        let mut float_params = Vec::new();
        let mut bool_params = Vec::new();
        
        for param in params {
            match param {
                Value::String(s) => string_params.push(s.clone()),
                Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        int_params.push(i);
                    } else if let Some(f) = n.as_f64() {
                        float_params.push(f);
                    } else {
                        string_params.push(n.to_string());
                    }
                }
                Value::Bool(b) => bool_params.push(*b),
                _ => string_params.push(param.to_string()),
            }
        }

        let mut query = Query::new(sql);
        
        let mut str_idx = 0;
        let mut int_idx = 0;
        let mut float_idx = 0;
        let mut bool_idx = 0;
        
        for param in params {
            match param {
                Value::String(_) => {
                    query.bind(&string_params[str_idx]);
                    str_idx += 1;
                }
                Value::Number(n) => {
                    if n.is_i64() {
                        query.bind(int_params[int_idx]);
                        int_idx += 1;
                    } else if n.is_f64() {
                        query.bind(float_params[float_idx]);
                        float_idx += 1;
                    } else {
                        query.bind(&string_params[str_idx]);
                        str_idx += 1;
                    }
                }
                Value::Bool(_) => {
                    query.bind(bool_params[bool_idx]);
                    bool_idx += 1;
                }
                Value::Null => {
                    query.bind(None::<&str>);
                }
                _ => {
                    query.bind(&string_params[str_idx]);
                    str_idx += 1;
                }
            }
        }

        if is_mutation {
            let result = query.execute(&mut *client).await?;
            return Ok(QueryResult {
                columns: None,
                rows: None,
                // tiberius execute result gives total rows affected
                affected_rows: Some(result.total() as u64),
            });
        }

        let stream = query.query(&mut *client).await?;
        let rows = stream.into_first_result().await?;

        let mut column_names = Vec::new();
        let mut result_rows = Vec::new();

        if let Some(first) = rows.first() {
            for col in first.columns() {
                column_names.push(col.name().to_string());
            }
        }

        for row in rows {
            let mut json_obj = serde_json::Map::new();
            for col in row.columns() {
                // Simplified stringification for JSON dump, fallback to generic formatting
                let name = col.name();
                if let Ok(Some(s)) = row.try_get::<&str, _>(name) {
                    json_obj.insert(name.to_string(), Value::String(s.to_string()));
                } else if let Ok(Some(i)) = row.try_get::<i32, _>(name) {
                    json_obj.insert(name.to_string(), Value::Number(i.into()));
                } else if let Ok(Some(b)) = row.try_get::<bool, _>(name) {
                    json_obj.insert(name.to_string(), Value::Bool(b));
                } else {
                    // Very generic fallback
                    json_obj.insert(name.to_string(), Value::Null);
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
        "mssql"
    }
}

