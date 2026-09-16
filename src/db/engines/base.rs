use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub r#type: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub column: String,
    pub referenced_table: String,
    pub referenced_column: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub row_count_estimate: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<ColumnInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreign_keys: Option<Vec<ForeignKeyInfo>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_rows: Option<u64>,
}

#[async_trait]
pub trait DatabaseEngine: Send + Sync {
    async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>>;
    async fn disconnect(&self) -> Result<(), Box<dyn std::error::Error>>;
    async fn health_check(&self) -> bool;

    async fn list_tables(&self, cursor: Option<String>, limit: usize) -> Result<Vec<TableInfo>, Box<dyn std::error::Error>>;
    async fn count_tables(&self) -> Result<i64, Box<dyn std::error::Error>>;
    
    async fn describe_table(&self, table: &str) -> Result<Vec<ColumnInfo>, Box<dyn std::error::Error>>;
    async fn get_foreign_keys(&self, table: &str) -> Result<Vec<ForeignKeyInfo>, Box<dyn std::error::Error>>;

    async fn execute(&self, sql: &str, params: &[Value]) -> Result<QueryResult, Box<dyn std::error::Error>>;

    fn dialect(&self) -> &str;
}
