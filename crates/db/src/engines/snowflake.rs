/*
 * Snowflake Cloud Data Warehouse database engine implementation over SQL REST API v2.
 * Owned by: db/engines
 * Key deps: reqwest, url, serde_json, async_trait, base64
 * Invariants: Translates queries and parameter bindings into Snowflake SQL API v2 payload;
 *             returns strongly-typed EngineError without native ODBC or C dependencies.
 */

use async_trait::async_trait;
use base64::Engine;
use reqwest::{header, Client};
use serde_json::{json, Value};
use url::Url;

use crate::engines::base::{
    ColumnInfo, CreateColumnRequest, DatabaseEngine, EngineError, ForeignKeyInfo, QueryResult,
    TableInfo,
};
use axiom_core::config::schema::DatabaseDefConfig;

pub struct SnowflakeDatabaseEngine {
    config: DatabaseDefConfig,
    client: Client,
    endpoint: String,
    account: String,
    database: String,
    schema: String,
    warehouse: String,
    role: String,
}

impl SnowflakeDatabaseEngine {
    /// Instantiates an uninitialized SnowflakeDatabaseEngine.
    pub fn new(config: DatabaseDefConfig) -> Self {
        Self {
            config,
            client: Client::new(),
            endpoint: String::new(),
            account: String::new(),
            database: "PUBLIC".to_string(),
            schema: "PUBLIC".to_string(),
            warehouse: String::new(),
            role: String::new(),
        }
    }

    /// Internal helper to execute a SQL statement via Snowflake SQL REST API v2.
    async fn execute_statement(
        &self,
        sql: &str,
        params: &[Value],
    ) -> Result<QueryResult, EngineError> {
        let url = format!("{}/api/v2/statements", self.endpoint);

        // Convert parameters to Snowflake bindings object
        let mut bindings_map = serde_json::Map::new();
        for (idx, param) in params.iter().enumerate() {
            let key = (idx + 1).to_string();
            let (bind_type, bind_val) = match param {
                Value::Null => ("TEXT", Value::Null),
                Value::Bool(b) => ("BOOLEAN", Value::String(b.to_string())),
                Value::Number(n) => ("FIXED", Value::String(n.to_string())),
                Value::String(s) => ("TEXT", Value::String(s.clone())),
                other => ("TEXT", Value::String(other.to_string())),
            };
            bindings_map.insert(
                key,
                json!({
                    "type": bind_type,
                    "value": bind_val
                }),
            );
        }

        let mut body = json!({
            "statement": sql,
            "timeout": self.config.connection_timeout.clamp(1, 120),
            "resultSetMetaData": { "format": "jsonv2" }
        });

        if let Some(obj) = body.as_object_mut() {
            if !self.database.is_empty() {
                obj.insert("database".to_string(), json!(self.database));
            }
            if !self.schema.is_empty() {
                obj.insert("schema".to_string(), json!(self.schema));
            }
            if !self.warehouse.is_empty() {
                obj.insert("warehouse".to_string(), json!(self.warehouse));
            }
            if !self.role.is_empty() {
                obj.insert("role".to_string(), json!(self.role));
            }
            if !bindings_map.is_empty() {
                obj.insert("bindings".to_string(), Value::Object(bindings_map));
            }
        }

        let resp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| EngineError::Execution(format!("Snowflake request failed: {}", e)))?;

        let status = resp.status();
        let resp_json: Value = resp
            .json()
            .await
            .map_err(|e| EngineError::Execution(format!("Invalid Snowflake response JSON: {}", e)))?;

        if !status.is_success() {
            let message = resp_json
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown Snowflake API error");
            return Err(EngineError::Execution(format!(
                "Snowflake error (HTTP {}): {}",
                status.as_u16(),
                message
            )));
        }

        // Unpack result set
        let columns: Vec<String> = resp_json
            .pointer("/resultSetMetaData/rowType")
            .and_then(|rt| rt.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|col| col.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let raw_rows = resp_json
            .get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();

        let mut rows = Vec::with_capacity(raw_rows.len());
        for raw_row in raw_rows {
            if let Some(cells) = raw_row.as_array() {
                let mut row_map = serde_json::Map::new();
                for (col_idx, cell) in cells.iter().enumerate() {
                    let col_name = columns
                        .get(col_idx)
                        .cloned()
                        .unwrap_or_else(|| format!("col_{}", col_idx));
                    row_map.insert(col_name, cell.clone());
                }
                rows.push(Value::Object(row_map));
            }
        }

        let rows_affected = resp_json
            .pointer("/resultSetMetaData/numRows")
            .and_then(|n| n.as_u64())
            .unwrap_or(rows.len() as u64);

        Ok(QueryResult {
            success: true,
            columns: Some(columns),
            rows: Some(rows),
            affected_rows: Some(rows_affected),
            truncated: Some(false),
            next_cursor: None,
        })
    }
}

#[async_trait]
impl DatabaseEngine for SnowflakeDatabaseEngine {
    async fn connect(&mut self) -> Result<(), EngineError> {
        let raw_url = self.config.url.trim();

        // Support snowflake:// and standard https://
        let normalized_url = if let Some(stripped) = raw_url.strip_prefix("snowflake://") {
            format!("https://{}", stripped)
        } else if let Some(stripped) = raw_url.strip_prefix("snowflake+https://") {
            format!("https://{}", stripped)
        } else {
            raw_url.to_string()
        };

        let parsed = Url::parse(&normalized_url)
            .map_err(|e| EngineError::Connection(format!("Invalid Snowflake URL: {}", e)))?;

        let host = parsed.host_str().unwrap_or("").trim();
        if host.is_empty() {
            return Err(EngineError::Connection(
                "Snowflake URL must specify an account host".to_string(),
            ));
        }

        // Account is typically the first domain segment or the full host
        self.account = host
            .split('.')
            .next()
            .unwrap_or(host)
            .to_string();

        self.endpoint = format!("https://{}", host);

        // Path can be /<database>/<schema>
        let path_segments: Vec<&str> = parsed
            .path_segments()
            .map(|s| s.filter(|seg| !seg.is_empty()).collect())
            .unwrap_or_default();

        if let Some(db) = path_segments.first() {
            self.database = db.to_uppercase();
        }
        if let Some(sch) = path_segments.get(1) {
            self.schema = sch.to_uppercase();
        }

        // Parse query parameters (warehouse, role, etc.)
        for (k, v) in parsed.query_pairs() {
            match k.to_lowercase().as_str() {
                "warehouse" => self.warehouse = v.to_uppercase(),
                "role" => self.role = v.to_uppercase(),
                "database" | "db" => self.database = v.to_uppercase(),
                "schema" => self.schema = v.to_uppercase(),
                _ => {}
            }
        }

        let mut headers = header::HeaderMap::new();
        headers.insert(
            header::ACCEPT,
            header::HeaderValue::from_static("application/json"),
        );
        headers.insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );

        // Basic authentication (username & password) or Bearer Token
        let username = parsed.username();
        let password = parsed.password().unwrap_or("");

        if !username.is_empty() {
            let auth_str = format!("{}:{}", username, password);
            let encoded = base64::engine::general_purpose::STANDARD.encode(auth_str.as_bytes());
            let auth_header = format!("Basic {}", encoded);
            headers.insert(
                header::AUTHORIZATION,
                header::HeaderValue::from_str(&auth_header)
                    .map_err(|e| EngineError::Connection(e.to_string()))?,
            );
        } else if !password.is_empty() {
            // Token-only authentication
            let auth_header = format!("Bearer {}", password);
            headers.insert(
                header::AUTHORIZATION,
                header::HeaderValue::from_str(&auth_header)
                    .map_err(|e| EngineError::Connection(e.to_string()))?,
            );
        }

        self.client = Client::builder()
            .default_headers(headers)
            .tcp_nodelay(true)
            .pool_max_idle_per_host(self.config.pool_max as usize)
            .pool_idle_timeout(std::time::Duration::from_secs(
                self.config.idle_timeout.clamp(5, 300) as u64,
            ))
            .timeout(std::time::Duration::from_secs(
                self.config.connection_timeout.clamp(1, 120) as u64,
            ))
            .build()
            .map_err(|e| EngineError::Connection(e.to_string()))?;

        Ok(())
    }

    async fn disconnect(&self) -> Result<(), EngineError> {
        Ok(())
    }

    async fn health_check(&self) -> bool {
        self.execute_statement("SELECT 1", &[]).await.is_ok()
    }

    async fn list_tables(
        &self,
        cursor: Option<String>,
        limit: usize,
    ) -> Result<Vec<TableInfo>, EngineError> {
        let offset = cursor.and_then(|c| c.parse::<usize>().ok()).unwrap_or(0);
        let safe_limit = limit.clamp(1, 500);

        let sql = format!(
            "SELECT table_name, table_type FROM information_schema.tables \
             WHERE table_schema = current_schema() \
             ORDER BY table_name \
             LIMIT {} OFFSET {}",
            safe_limit, offset
        );

        let res = self.execute_statement(&sql, &[]).await?;
        let mut tables = Vec::new();

        if let Some(rows) = res.rows {
            for row in rows {
                if let Some(obj) = row.as_object() {
                    let name = obj
                        .get("TABLE_NAME")
                        .or_else(|| obj.get("table_name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    if !name.is_empty() {
                        tables.push(TableInfo {
                            name,
                            row_count_estimate: 0,
                            columns: None,
                            foreign_keys: None,
                        });
                    }
                }
            }
        }

        Ok(tables)
    }

    async fn count_tables(&self) -> Result<i64, EngineError> {
        let sql = "SELECT count(*) AS cnt FROM information_schema.tables WHERE table_schema = current_schema()";
        let res = self.execute_statement(sql, &[]).await?;
        let count = res
            .rows
            .as_ref()
            .and_then(|r| r.first())
            .and_then(|r| r.get("CNT").or_else(|| r.get("cnt")))
            .and_then(|v| {
                if let Some(n) = v.as_i64() {
                    Some(n)
                } else if let Some(s) = v.as_str() {
                    s.parse::<i64>().ok()
                } else {
                    None
                }
            })
            .unwrap_or(0);

        Ok(count)
    }

    async fn describe_table(&self, table: &str) -> Result<Vec<ColumnInfo>, EngineError> {
        let clean_table = table.replace('\'', "''");
        let sql = format!(
            "SELECT column_name, data_type, is_nullable, column_default \
             FROM information_schema.columns \
             WHERE table_name = '{}' AND table_schema = current_schema() \
             ORDER BY ordinal_position",
            clean_table
        );

        let res = self.execute_statement(&sql, &[]).await?;
        let mut columns = Vec::new();

        if let Some(rows) = res.rows {
            for row in rows {
                if let Some(obj) = row.as_object() {
                    let name = obj
                        .get("COLUMN_NAME")
                        .or_else(|| obj.get("column_name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let data_type = obj
                        .get("DATA_TYPE")
                        .or_else(|| obj.get("data_type"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("TEXT")
                        .to_string();

                    let is_nullable_str = obj
                        .get("IS_NULLABLE")
                        .or_else(|| obj.get("is_nullable"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("YES");
                    let is_nullable = is_nullable_str.eq_ignore_ascii_case("YES");

                    if !name.is_empty() {
                        columns.push(ColumnInfo {
                            name,
                            r#type: data_type,
                            nullable: is_nullable,
                            primary_key: false,
                        });
                    }
                }
            }
        }

        Ok(columns)
    }

    async fn get_foreign_keys(&self, _table: &str) -> Result<Vec<ForeignKeyInfo>, EngineError> {
        // Analytical warehouse - foreign key constraints are informational
        Ok(Vec::new())
    }

    async fn execute(&self, sql: &str, params: &[Value]) -> Result<QueryResult, EngineError> {
        self.execute_statement(sql, params).await
    }

    fn dialect(&self) -> &str {
        "snowflake"
    }

    async fn add_column(&self, table: &str, req: &CreateColumnRequest) -> Result<(), EngineError> {
        let col_name_clean: String = req
            .name
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if col_name_clean.is_empty() {
            return Err(EngineError::Schema("Invalid column name".into()));
        }

        let escaped_table = format!("\"{}\"", table.replace('"', "\"\""));
        let escaped_col = format!("\"{}\"", col_name_clean.replace('"', "\"\""));
        let type_def = &req.data_type;

        let mut sql = format!("ALTER TABLE {} ADD COLUMN {} {}", escaped_table, escaped_col, type_def);
        if !req.nullable {
            sql.push_str(" NOT NULL");
        }
        if let Some(default_val) = &req.default_value {
            if !default_val.trim().is_empty() {
                sql.push_str(&format!(" DEFAULT {}", default_val));
            }
        }

        self.execute_statement(&sql, &[]).await?;
        Ok(())
    }
}
