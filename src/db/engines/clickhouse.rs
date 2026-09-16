use async_trait::async_trait;
use reqwest::{Client, header};
use serde_json::Value;
use url::Url;

use crate::config::schema::DatabaseDefConfig;
use crate::db::engines::base::{ColumnInfo, DatabaseEngine, ForeignKeyInfo, QueryResult, TableInfo};

pub struct ClickHouseDatabaseEngine {
    config: DatabaseDefConfig,
    client: Client,
    endpoint: String,
    database: String,
}

impl ClickHouseDatabaseEngine {
    pub fn new(config: DatabaseDefConfig) -> Self {
        Self {
            config,
            client: Client::new(),
            endpoint: String::new(),
            database: "default".to_string(),
        }
    }
}

#[async_trait]
impl DatabaseEngine for ClickHouseDatabaseEngine {
    async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let parsed_url = Url::parse(&self.config.url)?;
        
        let scheme = if parsed_url.scheme() == "clickhouse+https" || parsed_url.scheme() == "https" { "https" } else { "http" };
        let host = parsed_url.host_str().unwrap_or("localhost");
        let port = parsed_url.port().unwrap_or(8123);
        
        self.endpoint = format!("{}://{}:{}", scheme, host, port);
        
        let path = parsed_url.path().trim_start_matches('/');
        if !path.is_empty() {
            self.database = path.to_string();
        }

        let mut headers = header::HeaderMap::new();
        if !parsed_url.username().is_empty() {
            headers.insert("X-ClickHouse-User", header::HeaderValue::from_str(parsed_url.username())?);
        }
        if let Some(password) = parsed_url.password() {
            headers.insert("X-ClickHouse-Key", header::HeaderValue::from_str(password)?);
        }

        self.client = Client::builder()
            .default_headers(headers)
            .build()?;

        Ok(())
    }

    async fn disconnect(&self) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    async fn health_check(&self) -> bool {
        let url = format!("{}/ping", self.endpoint);
        if let Ok(res) = self.client.get(&url).send().await {
            res.status().is_success()
        } else {
            false
        }
    }

    async fn list_tables(
        &self,
        cursor: Option<String>,
        limit: usize,
    ) -> Result<Vec<TableInfo>, Box<dyn std::error::Error>> {
        let mut sql = format!("SELECT name as table_name FROM system.tables WHERE database = '{}'", self.database);
        if cursor.is_some() {
            sql.push_str(" AND name > {cursor:String}");
        }
        sql.push_str(&format!(" ORDER BY name ASC LIMIT {}", limit));

        let mut params = Vec::new();
        if let Some(c) = cursor {
            params.push(Value::String(c));
        }

        let result = self.execute(&sql, &params).await?;
        let mut tables = Vec::new();

        if let Some(rows) = result.rows {
            for row in rows {
                if let Some(Value::String(name)) = row.get("table_name") {
                    tables.push(TableInfo {
                        name: name.to_string(),
                        row_count_estimate: 0,
                        columns: None,
                        foreign_keys: None,
                    });
                }
            }
        }

        Ok(tables)
    }

    async fn count_tables(&self) -> Result<i64, Box<dyn std::error::Error>> {
        let sql = format!("SELECT count() as count FROM system.tables WHERE database = '{}'", self.database);
        let result = self.execute(&sql, &[]).await?;
        
        if let Some(rows) = result.rows {
            if let Some(row) = rows.first() {
                if let Some(count) = row.get("count") {
                    if let Some(c) = count.as_i64() {
                        return Ok(c);
                    } else if let Some(c_str) = count.as_str() {
                        return Ok(c_str.parse().unwrap_or(0));
                    }
                }
            }
        }
        Ok(0)
    }

    async fn describe_table(&self, table: &str) -> Result<Vec<ColumnInfo>, Box<dyn std::error::Error>> {
        let sql = format!("SELECT name as column: column_name, type as data_type FROM system.columns WHERE database = '{}' AND table = '{}'", self.database, table.replace("'", "''"));
        let result = self.execute(&sql, &[]).await?;
        
        let mut columns = Vec::new();
        if let Some(rows) = result.rows {
            for row in rows {
                let name = row.get("column_name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                let data_type = row.get("data_type").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                let is_nullable = data_type.starts_with("Nullable");
                columns.push(ColumnInfo {
                    name,
                    r#type: data_type,
                    primary_key: false,
                nullable: is_nullable,
                });
            }
        }
        Ok(columns)
    }

    async fn get_foreign_keys(&self, _table: &str) -> Result<Vec<ForeignKeyInfo>, Box<dyn std::error::Error>> {
        // ClickHouse does not enforce traditional foreign keys in the same way, return empty.
        Ok(vec![])
    }

    async fn execute(&self, sql: &str, params: &[serde_json::Value]) -> Result<QueryResult, Box<dyn std::error::Error>> {
        let is_mutation = sql.trim().to_uppercase().starts_with("INSERT")
            || sql.trim().to_uppercase().starts_with("ALTER")
            || sql.trim().to_uppercase().starts_with("DROP")
            || sql.trim().to_uppercase().starts_with("CREATE");

        let mut final_sql = sql.to_string();

        for param in params {
            let val_str = match param {
                Value::String(s) => format!("'{}'", s.replace("'", "''")),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => if *b { "1".to_string() } else { "0".to_string() },
                Value::Null => "NULL".to_string(),
                _ => format!("'{}'", param.to_string().replace("'", "''")),
            };
            final_sql = final_sql.replacen("?", &val_str, 1);
        }

        let url = format!("{}?database={}", self.endpoint, self.database);
        let mut req = self.client.post(&url);

        // If the query does not explicitly ask for a format, append FORMAT JSON
        if !is_mutation && !final_sql.to_uppercase().contains("FORMAT ") {
            final_sql.push_str(" FORMAT JSON");
        }

        req = req.body(final_sql);

        let res = req.send().await?;
        
        if !res.status().is_success() {
            let err = res.text().await?;
            return Err(format!("ClickHouse Error: {}", err).into());
        }

        if is_mutation {
            return Ok(QueryResult {
                columns: None,
                rows: None,
                affected_rows: Some(0), // ClickHouse doesn't return affected rows via standard HTTP easily
            });
        }

        let body: Value = res.json().await?;
        
        let mut column_names = Vec::new();
        if let Some(meta) = body.get("meta").and_then(|m| m.as_array()) {
            for col in meta {
                if let Some(name) = col.get("name").and_then(|n| n.as_str()) {
                    column_names.push(name.to_string());
                }
            }
        }

        let mut result_rows = Vec::new();
        if let Some(data) = body.get("data").and_then(|d| d.as_array()) {
            for row in data {
                result_rows.push(row.clone());
            }
        }

        Ok(QueryResult {
            columns: Some(column_names),
            rows: Some(result_rows),
            affected_rows: None,
        })
    }

    fn dialect(&self) -> &str {
        "clickhouse"
    }
}


