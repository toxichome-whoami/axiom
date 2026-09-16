use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub name: String,
    pub engine: String,
    pub mode: String,
    pub status: String,
    pub tables_count: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AxiomError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Pagination {
    pub limit: usize,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DatabasesResponse {
    pub success: bool,
    pub databases: Option<Vec<DatabaseInfo>>,
    pub error: Option<AxiomError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TablesData {
    pub tables: Option<Vec<TableInfo>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TablesResponse {
    pub success: bool,
    pub data: Option<TablesData>,
    pub error: Option<AxiomError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FetchData<T> {
    pub rows: Option<Vec<T>>,
    pub pagination: Option<Pagination>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FetchResponse<T> {
    pub success: bool,
    pub data: Option<FetchData<T>>,
    pub error: Option<AxiomError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResponse<T> {
    pub success: bool,
    pub rows: Option<Vec<T>>,
    pub affected_rows: Option<usize>,
    pub error: Option<AxiomError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MutationResponse {
    pub success: bool,
    pub affected_rows: Option<usize>,
    pub error: Option<AxiomError>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct FetchRowsParams {
    pub limit: Option<usize>,
    pub cursor: Option<String>,
    pub sort: Option<String>,
    pub order: Option<String>,
    pub filter: Option<HashMap<String, serde_json::Value>>,
    pub fields: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub r#type: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub column: String,
    pub referenced_table: String,
    pub referenced_column: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SchemaData {
    pub database: String,
    pub table: String,
    pub columns: Vec<ColumnInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SchemaResponse {
    pub success: bool,
    pub data: Option<SchemaData>,
    pub error: Option<AxiomError>,
}
