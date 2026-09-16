use async_trait::async_trait;
use libsql::{Builder, Connection, Database};


use crate::config::schema::DatabaseDefConfig;
use crate::db::engines::base::{ColumnInfo, DatabaseEngine, ForeignKeyInfo, QueryResult, TableInfo};

pub struct LibsqlDatabaseEngine {
    config: DatabaseDefConfig,
    db: Option<Database>,
    conn: Option<Connection>,
}

impl LibsqlDatabaseEngine {
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
    async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
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
            Builder::new_remote(url, token).build().await?
        } else {
            // Local SQLite
            let path = url.replace("sqlite://", "").replace("file://", "");
            Builder::new_local(path).build().await?
        };
        
        let conn = db.connect()?;
        self.db = Some(db);
        self.conn = Some(conn);
        Ok(())
    }

    async fn disconnect(&self) -> Result<(), Box<dyn std::error::Error>> {
        // Libsql drops connections automatically
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
    ) -> Result<Vec<TableInfo>, Box<dyn std::error::Error>> {
        let conn = self.conn.as_ref().ok_or("Not connected")?;
        
        let mut query_str = "SELECT name as table_name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'".to_string();
        
        let mut params = vec![];
        if let Some(c) = cursor {
            query_str.push_str(" AND name > ?1");
            params.push(c);
        }
        query_str.push_str(&format!(" ORDER BY name ASC LIMIT {}", limit));

        let stmt = conn.prepare(&query_str).await?;
        let mut rows = stmt.query(libsql::params_from_iter(params)).await?;
        
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

    async fn count_tables(&self) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self.conn.as_ref().ok_or("Not connected")?;
        let mut rows = conn.query("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", ()).await?;
        if let Ok(Some(row)) = rows.next().await {
            if let Ok(count) = row.get::<i64>(0) {
                return Ok(count);
            }
        }
        Ok(0)
    }

    async fn describe_table(&self, table: &str) -> Result<Vec<ColumnInfo>, Box<dyn std::error::Error>> {
        let conn = self.conn.as_ref().ok_or("Not connected")?;
        
        let sql = format!("PRAGMA table_info('{}')", table.replace("'", "''"));
        let mut rows = conn.query(&sql, ()).await?;
        
        let mut columns = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let name: String = row.get(1)?;
            let data_type: String = row.get(2)?;
            let notnull: i32 = row.get(3)?;
            let pk: i32 = row.get(5)?;
            columns.push(ColumnInfo {
                name,
                r#type: data_type,
                nullable: notnull == 0,
                primary_key: pk > 0,
            });
        }
        Ok(columns)
    }

    async fn get_foreign_keys(&self, table: &str) -> Result<Vec<ForeignKeyInfo>, Box<dyn std::error::Error>> {
        let conn = self.conn.as_ref().ok_or("Not connected")?;
        
        let sql = format!("PRAGMA foreign_key_list('{}')", table.replace("'", "''"));
        let mut rows = conn.query(&sql, ()).await?;
        
        let mut fks = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let referenced_table_name: String = row.get(2)?;
            let column_name: String = row.get(3)?;
            let referenced_column_name: String = row.get(4)?;
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
    ) -> Result<QueryResult, Box<dyn std::error::Error>> {
        let conn = self.conn.as_ref().ok_or("Not connected")?;

        let is_mutation = sql.trim().to_uppercase().starts_with("INSERT")
            || sql.trim().to_uppercase().starts_with("UPDATE")
            || sql.trim().to_uppercase().starts_with("DELETE");

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
            let stmt = conn.prepare(sql).await?;
            let affected = stmt.execute(libsql::params_from_iter(libsql_params)).await?;
            return Ok(QueryResult {
                columns: None,
                rows: None,
                affected_rows: Some(affected as u64),
            });
        }

        let stmt = conn.prepare(sql).await?;
        let mut rows = stmt.query(libsql::params_from_iter(libsql_params)).await?;

        let mut column_names = Vec::new();
        for i in 0..rows.column_count() {
            if let Some(name) = rows.column_name(i) {
                column_names.push(name.to_string());
            } else {
                column_names.push(format!("col_{}", i));
            }
        }

        let mut result_rows = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let mut json_obj = serde_json::Map::new();
            for (i, col_name) in column_names.iter().enumerate() {
                let val = match row.get_value(i as i32) {
                    Ok(libsql::Value::Text(s)) => serde_json::Value::String(s),
                    Ok(libsql::Value::Integer(n)) => serde_json::Value::Number(serde_json::Number::from(n)),
                    Ok(libsql::Value::Real(f)) => {
                        if let Some(num) = serde_json::Number::from_f64(f) {
                            serde_json::Value::Number(num)
                        } else {
                            serde_json::Value::Null
                        }
                    }
                    Ok(libsql::Value::Null) => serde_json::Value::Null,
                    _ => serde_json::Value::Null, // Blobs, etc. fallback to null for JSON API
                };
                json_obj.insert(col_name.clone(), val);
            }
            result_rows.push(serde_json::Value::Object(json_obj));
        }

        Ok(QueryResult {
            columns: Some(column_names),
            rows: Some(result_rows),
            affected_rows: None,
        })
    }

    fn dialect(&self) -> &str {
        "sqlite"
    }
}

