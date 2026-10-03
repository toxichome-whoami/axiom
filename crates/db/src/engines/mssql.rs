/*
 * Microsoft SQL Server database engine implementation backed by Tiberius driver.
 * Owned by: db/engines
 * Key deps: tiberius, tokio::net::TcpStream, tokio_util::compat, async_trait
 * Invariants: All error results return strongly-typed EngineError; parameter binding uses '@P1, @P2' ordinal tags.
 * Last structural change: Phase 0 cleanup adopting EngineError to eliminate hot-path Box allocations (Debt #2).
 */

use async_trait::async_trait;
use std::sync::Arc;
use tiberius::{Client, Config, Query};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};
use tokio::sync::Mutex;
use serde_json::Value;

use axiom_core::config::schema::DatabaseDefConfig;
use crate::engines::base::{
    ColumnInfo, DatabaseEngine, EngineError, ForeignKeyInfo, QueryResult, TableInfo,
};

/// Precomputed column classification for fast zero-trial MSSQL row decoding.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MsSqlColKind {
    Bool,
    Int16,
    Int32,
    Int64,
    Float32,
    Float64,
    String,
    Fallback,
}

impl MsSqlColKind {
    #[inline]
    fn from_column_type(ct: tiberius::ColumnType) -> Self {
        use tiberius::ColumnType;
        match ct {
            ColumnType::Bit => MsSqlColKind::Bool,
            ColumnType::Int1 | ColumnType::Int2 => MsSqlColKind::Int16,
            ColumnType::Int4 => MsSqlColKind::Int32,
            ColumnType::Int8 => MsSqlColKind::Int64,
            ColumnType::Float4 => MsSqlColKind::Float32,
            ColumnType::Float8 => MsSqlColKind::Float64,
            ColumnType::NVarchar
            | ColumnType::BigVarChar
            | ColumnType::NChar
            | ColumnType::BigChar
            | ColumnType::Text
            | ColumnType::NText
            | ColumnType::Guid
            // Date/time types: tiberius surfaces these as formatted strings (&str) via try_get.
            // Storing as String preserves ISO 8601 representation in JSON output.
            | ColumnType::Datetimen
            | ColumnType::Datetime4
            | ColumnType::Datetime
            | ColumnType::Datetime2
            | ColumnType::DatetimeOffsetn
            | ColumnType::Daten
            | ColumnType::Timen => MsSqlColKind::String,
            _ => MsSqlColKind::Fallback,
        }
    }
}

pub struct MssqlDatabaseEngine {
    config: DatabaseDefConfig,
    client: Option<Arc<Mutex<Client<Compat<TcpStream>>>>>,
}

impl MssqlDatabaseEngine {
    /// Instantiates an uninitialized MssqlDatabaseEngine.
    /// CONTRACT:
    ///  - Connection is None until `connect()` is awaited.
    pub fn new(config: DatabaseDefConfig) -> Self {
        Self {
            config,
            client: None,
        }
    }
}

#[async_trait]
impl DatabaseEngine for MssqlDatabaseEngine {
    async fn connect(&mut self) -> Result<(), EngineError> {
        // WHY: pool routing accepts mssql:// and sqlserver://, but tiberius's JDBC parser
        // rejects anything not starting with the literal "jdbc:" sub-protocol.
        let url = &self.config.url;
        let jdbc_url = if let Some(rest) = url.strip_prefix("mssql://").or_else(|| url.strip_prefix("sqlserver://")) {
            format!("jdbc:sqlserver://{}", rest)
        } else {
            url.clone()
        };
        let config = Config::from_jdbc_string(&jdbc_url)
            .map_err(|e| EngineError::Connection(e.to_string()))?;
        let tcp = TcpStream::connect(config.get_addr())
            .await
            .map_err(|e| EngineError::Connection(e.to_string()))?;
        tcp.set_nodelay(true)
            .map_err(|e| EngineError::Connection(e.to_string()))?;
        
        let client = Client::connect(config, tcp.compat_write())
            .await
            .map_err(|e| EngineError::Connection(e.to_string()))?;
        self.client = Some(Arc::new(Mutex::new(client)));
        
        Ok(())
    }

    async fn disconnect(&self) -> Result<(), EngineError> {
        Ok(())
    }

    async fn health_check(&self) -> bool {
        if let Some(client) = &self.client {
            let mut guard = client.lock().await;
            let ok = guard.query("SELECT 1", &[]).await.is_ok();
            ok
        } else {
            false
        }
    }

    async fn list_tables(
        &self,
        cursor: Option<String>,
        limit: usize,
    ) -> Result<Vec<TableInfo>, EngineError> {
        let client_arc = self.client.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;
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
        
        let stream = query.query(&mut *client).await.map_err(|e| EngineError::Execution(e.to_string()))?;
        let rows = stream.into_first_result().await.map_err(|e| EngineError::Execution(e.to_string()))?;
        
        let mut tables = Vec::new();
        for row in rows {
            if let Some(name) = row.try_get::<&str, _>("table_name").map_err(|e| EngineError::Execution(e.to_string()))? {
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
        let client_arc = self.client.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;
        let mut client = client_arc.lock().await;
        let stream = client
            .query("SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'", &[])
            .await
            .map_err(|e| EngineError::Execution(e.to_string()))?;
        let rows = stream.into_first_result().await.map_err(|e| EngineError::Execution(e.to_string()))?;
        
        if let Some(row) = rows.first() {
            if let Some(count) = row.try_get::<i32, _>("count").map_err(|e| EngineError::Execution(e.to_string()))? {
                return Ok(count as i64);
            }
        }
        Ok(0)
    }

    async fn describe_table(&self, table: &str) -> Result<Vec<ColumnInfo>, EngineError> {
        let client_arc = self.client.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;
        let mut client = client_arc.lock().await;
        
        let mut query = tiberius::Query::new("
            SELECT 
                c.COLUMN_NAME as column_name, 
                c.DATA_TYPE as data_type, 
                c.IS_NULLABLE as is_nullable,
                CASE WHEN tc.CONSTRAINT_TYPE = 'PRIMARY KEY' THEN 'YES' ELSE 'NO' END as is_primary_key
            FROM INFORMATION_SCHEMA.COLUMNS c
            LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
                ON c.TABLE_NAME = kcu.TABLE_NAME AND c.COLUMN_NAME = kcu.COLUMN_NAME
            LEFT JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc 
                ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
            WHERE c.TABLE_NAME = @P1 
            ORDER BY c.ORDINAL_POSITION
        ");
        query.bind(table);
        
        let stream = query.query(&mut *client).await.map_err(|e| EngineError::Execution(e.to_string()))?;
        let rows = stream.into_first_result().await.map_err(|e| EngineError::Execution(e.to_string()))?;
        
        let mut columns = Vec::new();
        for row in rows {
            columns.push(ColumnInfo {
                name: row.try_get::<&str, _>("column_name").map_err(|e| EngineError::Execution(e.to_string()))?.unwrap_or_default().to_string(),
                r#type: row.try_get::<&str, _>("data_type").map_err(|e| EngineError::Execution(e.to_string()))?.unwrap_or_default().to_string(),
                primary_key: row.try_get::<&str, _>("is_primary_key").map_err(|e| EngineError::Execution(e.to_string()))?.unwrap_or("NO") == "YES",
                nullable: row.try_get::<&str, _>("is_nullable").map_err(|e| EngineError::Execution(e.to_string()))?.unwrap_or("YES") == "YES",
            });
        }
        Ok(columns)
    }

    async fn get_foreign_keys(&self, table: &str) -> Result<Vec<ForeignKeyInfo>, EngineError> {
        let client_arc = self.client.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;
        let mut client = client_arc.lock().await;
        
        let mut query = tiberius::Query::new("
            SELECT col1.name as column_name, tab2.name as referenced_table_name, col2.name as referenced_column_name
            FROM sys.foreign_key_columns fkc
            INNER JOIN sys.objects obj ON obj.object_id = fkc.constraint_object_id
            INNER JOIN sys.tables tab1 ON tab1.object_id = fkc.parent_object_id
            INNER JOIN sys.columns col1 ON col1.column_id = parent_column_id AND col1.object_id = tab1.object_id
            INNER JOIN sys.tables tab2 ON tab2.object_id = fkc.referenced_object_id
            INNER JOIN sys.columns col2 ON col2.column_id = referenced_column_id AND col2.object_id = tab2.object_id
            WHERE tab1.name = @P1
        ");
        query.bind(table);
        
        let stream = query.query(&mut *client).await.map_err(|e| EngineError::Execution(e.to_string()))?;
        let rows = stream.into_first_result().await.map_err(|e| EngineError::Execution(e.to_string()))?;
        
        let mut fks = Vec::new();
        for row in rows {
            fks.push(ForeignKeyInfo {
                column: row.try_get::<&str, _>("column_name").map_err(|e| EngineError::Execution(e.to_string()))?.unwrap_or_default().to_string(),
                referenced_table: row.try_get::<&str, _>("referenced_table_name").map_err(|e| EngineError::Execution(e.to_string()))?.unwrap_or_default().to_string(),
                referenced_column: row.try_get::<&str, _>("referenced_column_name").map_err(|e| EngineError::Execution(e.to_string()))?.unwrap_or_default().to_string(),
            });
        }
        Ok(fks)
    }

    async fn execute(&self, sql: &str, params: &[serde_json::Value]) -> Result<QueryResult, EngineError> {
        let client_arc = self.client.as_ref().ok_or_else(|| EngineError::Connection("Not connected".into()))?;
        let mut client = client_arc.lock().await;
        
        let first_word = sql.split_whitespace().next().unwrap_or("").to_uppercase();
        let is_mutation = matches!(
            first_word.as_str(),
            "INSERT" | "UPDATE" | "DELETE" | "CREATE" | "DROP" | "ALTER" | "TRUNCATE" | "REPLACE" | "SET" | "GRANT" | "REVOKE"
        );

        // Keep allocations alive during query lifetime
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
            let result = query.execute(&mut *client).await.map_err(|e| EngineError::Execution(e.to_string()))?;
            return Ok(QueryResult {
                success: true,
                columns: None,
                rows: None,
                affected_rows: Some(result.total() as u64),
                truncated: None,
                next_cursor: None,
            });
        }

        let stream = query.query(&mut *client).await.map_err(|e| EngineError::Execution(e.to_string()))?;
        let rows = stream.into_first_result().await.map_err(|e| EngineError::Execution(e.to_string()))?;

        let mut column_names = Vec::new();
        let mut column_kinds = Vec::new();
        let mut result_rows = Vec::new();

        if let Some(first) = rows.first() {
            for col in first.columns() {
                column_names.push(col.name().to_string());
                column_kinds.push(MsSqlColKind::from_column_type(col.column_type()));
            }
        }

        let mut truncated = false;
        for row in rows {
            if result_rows.len() >= axiom_core::DEFAULT_MAX_QUERY_ROWS {
                truncated = true;
                break;
            }
            let mut json_obj = serde_json::Map::with_capacity(column_names.len());
            for (idx, name) in column_names.iter().enumerate() {
                let val = match column_kinds.get(idx).copied().unwrap_or(MsSqlColKind::Fallback) {
                    MsSqlColKind::String => {
                        if let Ok(Some(s)) = row.try_get::<&str, _>(idx) {
                            if (s.starts_with('{') && s.ends_with('}')) || (s.starts_with('[') && s.ends_with(']')) {
                                serde_json::from_str::<Value>(s).unwrap_or_else(|_| Value::String(s.to_string()))
                            } else {
                                Value::String(s.to_string())
                            }
                        } else {
                            Value::Null
                        }
                    }
                    MsSqlColKind::Int64 => {
                        if let Ok(Some(i)) = row.try_get::<i64, _>(idx) {
                            Value::Number(i.into())
                        } else {
                            Value::Null
                        }
                    }
                    MsSqlColKind::Int32 => {
                        if let Ok(Some(i)) = row.try_get::<i32, _>(idx) {
                            Value::Number(i.into())
                        } else {
                            Value::Null
                        }
                    }
                    MsSqlColKind::Int16 => {
                        if let Ok(Some(i)) = row.try_get::<i16, _>(idx) {
                            Value::Number(i.into())
                        } else {
                            Value::Null
                        }
                    }
                    MsSqlColKind::Float64 => {
                        if let Ok(Some(f)) = row.try_get::<f64, _>(idx) {
                            serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
                        } else {
                            Value::Null
                        }
                    }
                    MsSqlColKind::Float32 => {
                        if let Ok(Some(f)) = row.try_get::<f32, _>(idx) {
                            serde_json::Number::from_f64(f as f64).map(Value::Number).unwrap_or(Value::Null)
                        } else {
                            Value::Null
                        }
                    }
                    MsSqlColKind::Bool => {
                        if let Ok(Some(b)) = row.try_get::<bool, _>(idx) {
                            Value::Bool(b)
                        } else {
                            Value::Null
                        }
                    }
                    MsSqlColKind::Fallback => {
                        if let Ok(Some(s)) = row.try_get::<&str, _>(idx) {
                            Value::String(s.to_string())
                        } else if let Ok(Some(i)) = row.try_get::<i64, _>(idx) {
                            Value::Number(i.into())
                        } else if let Ok(Some(i)) = row.try_get::<i32, _>(idx) {
                            Value::Number(i.into())
                        } else if let Ok(Some(f)) = row.try_get::<f64, _>(idx) {
                            serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
                        } else if let Ok(Some(b)) = row.try_get::<bool, _>(idx) {
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
        "mssql"
    }
}
