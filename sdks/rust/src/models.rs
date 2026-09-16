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
pub struct AxiomError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DatabasesResponse {
    pub success: bool,
    pub databases: Option<Vec<DatabaseInfo>>,
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
pub struct TableInfo {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TablesResponse {
    pub success: bool,
    pub tables: Option<Vec<TableInfo>>,
    pub error: Option<AxiomError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FetchResponse<T> {
    pub success: bool,
    pub rows: Option<Vec<T>>,
    pub pagination: Option<HashMap<String, serde_json::Value>>,
    pub error: Option<AxiomError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MutationResponse {
    pub success: bool,
    pub affected_rows: Option<usize>,
    pub error: Option<AxiomError>,
}
