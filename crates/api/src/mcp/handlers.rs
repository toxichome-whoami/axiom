/*
 * Model Context Protocol (MCP) JSON-RPC 2.0 handler and tool execution pipeline.
 * Owned by: api/mcp
 * Key deps: axum, serde_json, crate::database::handlers, axiom_policy::PolicyEngine, axiom_db::pool
 * Invariants: Every tool call checks PolicyEngine RBAC; JSON-RPC errors follow the 2024-11-05 spec.
 * Last structural change: Phase 4 initial implementation of the 8-tool MCP engine.
 */

use axum::extract::Extension;
use axum::Json;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::database::filter_builder;
use crate::database::handlers::{get_db_config, QueryExecutionPipeline};
use axiom_core::AxiomError;
use crate::mcp::schema::{
    JsonRpcRequest, JsonRpcResponse, McpCapabilities, McpInitializeResult,
    McpResource, McpResourceContent, McpResourceReadResult, McpResourcesCapability, McpServerInfo,
    McpTool, McpToolCallResult, McpToolsCapability,
};
use axiom_core::ConfigManager;
use axiom_db::DatabasePoolManager;
use axiom_policy::PolicyEngine;
use axiom_core::AuthContext;

// ─── JSON-RPC Entrypoint Dispatcher ────────────────────────────────────────
// Parses inbound JSON-RPC 2.0 requests, dispatches methods, and formats envelopes.

/// Dispatches JSON-RPC 2.0 requests for the Model Context Protocol endpoint.
/// CONTRACT:
///  - Precondition: Caller authenticated via `auth_middleware` (AuthContext in extensions).
///  - Precondition: `payload` contains valid JSON matching `JsonRpcRequest`.
///  - Returns `Ok(Json<Value>)` containing standard JSON-RPC 2.0 response.
///  - Side effects: May execute database reads/writes depending on tool called.
///  - Idempotent: Depends on dispatched method (discovery is idempotent; mutation is not).
pub async fn handle_mcp(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, AxiomError> {
    let req: JsonRpcRequest = match serde_json::from_value(payload) {
        Ok(r) => r,
        Err(e) => {
            return Ok(Json(
                serde_json::to_value(JsonRpcResponse::error(
                    None,
                    -32600,
                    format!("Invalid Request: {}", e),
                    None,
                ))
                .unwrap_or_default(),
            ));
        }
    };

    let id = req.id.clone();

    let response = match req.method.as_str() {
        "initialize" => handle_initialize(id),
        "notifications/initialized" => JsonRpcResponse::success(id, json!({})),
        "ping" => JsonRpcResponse::success(id, json!({})),
        "tools/list" => handle_tools_list(id, &auth),
        "tools/call" => handle_tools_call(id, req.params, &auth).await,
        "resources/list" => handle_resources_list(id, &auth).await,
        "resources/read" => handle_resources_read(id, req.params, &auth).await,
        _ => JsonRpcResponse::error(
            id,
            -32601,
            format!("Method '{}' not found", req.method),
            None,
        ),
    };

    Ok(Json(serde_json::to_value(response).unwrap_or_default()))
}

// ─── Protocol Discovery Handlers ───────────────────────────────────────────

fn handle_initialize(id: Option<Value>) -> JsonRpcResponse {
    let result = McpInitializeResult {
        protocol_version: "2024-11-05".to_string(),
        capabilities: McpCapabilities {
            tools: McpToolsCapability { list_changed: false },
            resources: McpResourcesCapability {
                subscribe: false,
                list_changed: false,
            },
        },
        server_info: McpServerInfo {
            name: "axiom".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        },
    };
    JsonRpcResponse::success(id, serde_json::to_value(result).unwrap_or_default())
}

fn handle_tools_list(id: Option<Value>, _auth: &AuthContext) -> JsonRpcResponse {
    let tools = vec![
        McpTool {
            name: "axiom_list_services".to_string(),
            description: "Lists all configured database services that the caller is authorized to access.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        McpTool {
            name: "axiom_list_tables".to_string(),
            description: "Lists tables in the target database, with pagination support. Filtered by RBAC policies.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "database": { "type": "string", "description": "Database service alias" },
                    "cursor": { "type": "string", "description": "Optional pagination cursor" },
                    "limit": { "type": "integer", "description": "Max tables to return (default: 100)" }
                },
                "required": ["database"],
                "additionalProperties": false
            }),
        },
        McpTool {
            name: "axiom_describe_table".to_string(),
            description: "Returns schema metadata for a table including columns, types, nullability, primary keys, and foreign keys.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "database": { "type": "string", "description": "Database service alias" },
                    "table": { "type": "string", "description": "Table name to describe" }
                },
                "required": ["database", "table"],
                "additionalProperties": false
            }),
        },
        McpTool {
            name: "axiom_query".to_string(),
            description: "Executes a structured, dialect-agnostic SELECT query with JSON filters and sorting. Avoids SQL quoting quirks.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "database": { "type": "string", "description": "Database service alias" },
                    "table": { "type": "string", "description": "Table name to query" },
                    "filter": { "type": "object", "description": "JSON filter criteria (e.g. {\"status\": {\"$eq\": \"active\"}})" },
                    "sort": { "type": "string", "description": "Column name to sort by" },
                    "order": { "type": "string", "enum": ["asc", "desc", "ASC", "DESC"], "description": "Sort direction" },
                    "limit": { "type": "integer", "description": "Max rows to return (default: 50, max: 500)" },
                    "cursor": { "type": "string", "description": "Pagination cursor" }
                },
                "required": ["database", "table"],
                "additionalProperties": false
            }),
        },
        McpTool {
            name: "axiom_insert".to_string(),
            description: "Inserts one or more rows into a table using parameterized queries.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "database": { "type": "string", "description": "Database service alias" },
                    "table": { "type": "string", "description": "Table name to insert into" },
                    "rows": { "type": "array", "items": { "type": "object" }, "description": "Array of row objects to insert" },
                    "row": { "type": "object", "description": "Single row object to insert" }
                },
                "required": ["database", "table"],
                "additionalProperties": false
            }),
        },
        McpTool {
            name: "axiom_update".to_string(),
            description: "Updates rows matching a required filter criteria. Guardrail: rejects unconstrained full-table updates.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "database": { "type": "string", "description": "Database service alias" },
                    "table": { "type": "string", "description": "Table name to update" },
                    "filter": { "type": "object", "description": "Filter criteria matching target rows (MUST NOT BE EMPTY)" },
                    "data": { "type": "object", "description": "Column key-values to set" }
                },
                "required": ["database", "table", "filter", "data"],
                "additionalProperties": false
            }),
        },
        McpTool {
            name: "axiom_delete".to_string(),
            description: "Deletes rows matching a required filter criteria. Guardrail: rejects unconstrained full-table wipes.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "database": { "type": "string", "description": "Database service alias" },
                    "table": { "type": "string", "description": "Table name to delete from" },
                    "filter": { "type": "object", "description": "Filter criteria matching target rows (MUST NOT BE EMPTY)" }
                },
                "required": ["database", "table", "filter"],
                "additionalProperties": false
            }),
        },
        McpTool {
            name: "axiom_raw_sql".to_string(),
            description: "Executes raw SQL query against a database. Subject to AST firewall validation and role permission enforcement.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "database": { "type": "string", "description": "Database service alias" },
                    "sql": { "type": "string", "description": "Raw SQL query string" },
                    "params": { "type": "array", "description": "Optional positional parameters" }
                },
                "required": ["database", "sql"],
                "additionalProperties": false
            }),
        },
    ];

    JsonRpcResponse::success(id, json!({ "tools": tools }))
}

// ─── Tool Call Execution Dispatcher ────────────────────────────────────────

async fn handle_tools_call(
    id: Option<Value>,
    params: Option<Value>,
    auth: &AuthContext,
) -> JsonRpcResponse {
    let params_obj = match params.and_then(|p| p.as_object().cloned()) {
        Some(p) => p,
        None => {
            return JsonRpcResponse::error(
                id,
                -32602,
                "Invalid params: missing parameters object",
                None,
            );
        }
    };

    let tool_name = match params_obj.get("name").and_then(|n| n.as_str()) {
        Some(n) => n,
        None => {
            return JsonRpcResponse::error(
                id,
                -32602,
                "Invalid params: missing 'name' field",
                None,
            );
        }
    };

    let arguments = params_obj
        .get("arguments")
        .and_then(|a| a.as_object())
        .cloned()
        .unwrap_or_default();

    // Map both prefixed (axiom_*) and unprefixed tool calls seamlessly
    let result = match tool_name {
        "axiom_list_services" | "list_services" | "axiom_list_databases" | "list_databases" => {
            exec_list_services(auth).await
        }
        "axiom_list_tables" | "list_tables" => exec_list_tables(auth, &arguments).await,
        "axiom_describe_table" | "describe_table" => exec_describe_table(auth, &arguments).await,
        "axiom_query" | "query" => exec_query(auth, &arguments).await,
        "axiom_insert" | "insert" => exec_insert(auth, &arguments).await,
        "axiom_update" | "update" => exec_update(auth, &arguments).await,
        "axiom_delete" | "delete" => exec_delete(auth, &arguments).await,
        "axiom_raw_sql" | "raw_sql" => exec_raw_sql(auth, &arguments).await,
        _ => Err(format!("Unknown tool: '{}'", tool_name)),
    };

    match result {
        Ok(val) => {
            let text = if val.is_string() {
                val.as_str().unwrap().to_string()
            } else {
                serde_json::to_string_pretty(&val).unwrap_or_default()
            };
            JsonRpcResponse::success(id, serde_json::to_value(McpToolCallResult::success(text)).unwrap())
        }
        Err(err_msg) => {
            JsonRpcResponse::success(id, serde_json::to_value(McpToolCallResult::error(err_msg)).unwrap())
        }
    }
}

// ─── Concrete Tool Implementations ─────────────────────────────────────────

async fn exec_list_services(auth: &AuthContext) -> Result<Value, String> {
    let config = ConfigManager::get();
    let snapshot = axiom_metadata::snapshot::get_snapshot();

    let mut all_aliases = std::collections::HashSet::new();
    for name in config.database.keys() {
        all_aliases.insert(name.clone());
    }
    for name in snapshot.databases.keys() {
        all_aliases.insert(name.clone());
    }

    let mut sorted_aliases: Vec<String> = all_aliases.into_iter().collect();
    sorted_aliases.sort();

    let authorized_dbs = PolicyEngine::filter_databases(auth, &sorted_aliases);
    let mut services = Vec::new();

    for name in &authorized_dbs {
        let (engine_str, mode_str) = if let Some(db_cfg) = config.database.get(name) {
            (
                format!("{:?}", db_cfg.engine).to_lowercase(),
                format!("{:?}", db_cfg.mode).to_lowercase(),
            )
        } else if let Some(snap_db) = snapshot.databases.get(name) {
            (snap_db.engine.clone(), "readwrite".to_string())
        } else {
            continue;
        };

        let mut status = "down";
        let mut tables_count = 0;
        if let Some(engine) = DatabasePoolManager::get_engine(name).await {
            if engine.health_check().await {
                status = "connected";
                if let Ok(count) = engine.count_tables().await {
                    tables_count = count;
                }
            }
        }

        services.push(json!({
            "service": name,
            "engine": engine_str,
            "mode": mode_str,
            "status": status,
            "tables_count": tables_count,
        }));
    }

    Ok(json!({ "services": services }))
}

async fn exec_list_tables(
    auth: &AuthContext,
    args: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let db = args.get("database").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'database'".to_string())?;

    PolicyEngine::evaluate(auth, db, "*", "SELECT")
        .map_err(|e| e.to_string())?;

    let cursor = args.get("cursor").and_then(|v| v.as_str()).map(|s| s.to_string());
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(100).clamp(1, 500) as usize;

    let engine = DatabasePoolManager::get_engine(db).await
        .ok_or_else(|| format!("Database service '{}' not found or pool unavailable", db))?;

    let tables = engine.list_tables(cursor, limit).await
        .map_err(|e| format!("Failed to list tables: {}", e))?;

    // Filter tables through RBAC policy
    let filtered_tables: Vec<_> = tables
        .into_iter()
        .filter(|t| PolicyEngine::evaluate(auth, db, &t.name, "SELECT").is_ok())
        .collect();

    Ok(json!({ "database": db, "tables": filtered_tables }))
}

async fn exec_describe_table(
    auth: &AuthContext,
    args: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let db = args.get("database").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'database'".to_string())?;
    let table = args.get("table").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'table'".to_string())?;

    PolicyEngine::evaluate(auth, db, table, "SELECT")
        .map_err(|e| e.to_string())?;

    let engine = DatabasePoolManager::get_engine(db).await
        .ok_or_else(|| format!("Database service '{}' not found", db))?;

    let columns = engine.describe_table(table).await
        .map_err(|e| format!("Failed to describe table: {}", e))?;
    let foreign_keys = engine.get_foreign_keys(table).await.unwrap_or_default();

    Ok(json!({
        "database": db,
        "table": table,
        "columns": columns,
        "foreign_keys": foreign_keys
    }))
}

async fn exec_query(
    auth: &AuthContext,
    args: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let db = args.get("database").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'database'".to_string())?;
    let table = args.get("table").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'table'".to_string())?;

    PolicyEngine::evaluate(auth, db, table, "SELECT")
        .map_err(|e| e.to_string())?;

    let db_cfg = get_db_config(db, auth).await
        .map_err(|e| e.to_string())?;

    let mut values = Vec::new();
    let mut where_clauses = Vec::new();

    if let Some(filter_val) = args.get("filter").and_then(|f| f.as_object()) {
        let filter_map: HashMap<String, Value> = filter_val.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        let (clause, mut vals) = filter_builder::build_where_clause(&filter_map);
        if !clause.is_empty() {
            where_clauses.push(clause);
            values.append(&mut vals);
        }
    }

    let where_sql = if where_clauses.is_empty() {
        "".to_string()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let sort_col = args.get("sort").and_then(|v| v.as_str()).unwrap_or("id");
    let order_dir = match args.get("order").and_then(|v| v.as_str()).map(|s| s.to_ascii_uppercase()).as_deref() {
        Some("DESC") => "DESC",
        _ => "ASC",
    };
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(50).clamp(1, 500);

    let mut final_where = where_sql;
    if let Some(cursor) = args.get("cursor").and_then(|v| v.as_str()) {
        let cursor_op = if order_dir == "DESC" { "<" } else { ">" };
        let cursor_cond = format!("{} {} ?", filter_builder::sanitize_ident(sort_col), cursor_op);
        values.push(Value::String(cursor.to_string()));
        if final_where.trim().is_empty() {
            final_where = format!("WHERE {}", cursor_cond);
        } else {
            final_where = format!("{} AND {}", final_where, cursor_cond);
        }
    }

    let sql = format!(
        "SELECT * FROM {} {} ORDER BY {} {} LIMIT {}",
        filter_builder::sanitize_ident(table),
        final_where,
        filter_builder::sanitize_ident(sort_col),
        order_dir,
        limit
    );

    let (result, _) = QueryExecutionPipeline::run_query(db, &sql, values, auth, &db_cfg)
        .await
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "database": db,
        "table": table,
        "columns": result.columns.clone(),
        "rows": result.rows.clone().unwrap_or_default(),
    }))
}

async fn exec_insert(
    auth: &AuthContext,
    args: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let db = args.get("database").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'database'".to_string())?;
    let table = args.get("table").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'table'".to_string())?;

    PolicyEngine::evaluate(auth, db, table, "INSERT")
        .map_err(|e| e.to_string())?;

    let db_cfg = get_db_config(db, auth).await
        .map_err(|e| e.to_string())?;

    let rows_to_insert: Vec<HashMap<String, Value>> = if let Some(arr) = args.get("rows").and_then(|v| v.as_array()) {
        arr.iter().filter_map(|r| serde_json::from_value(r.clone()).ok()).collect()
    } else if let Some(single) = args.get("row").and_then(|v| v.as_object()) {
        vec![single.iter().map(|(k, v)| (k.clone(), v.clone())).collect()]
    } else {
        return Err("Missing 'rows' array or 'row' object to insert".to_string());
    };

    if rows_to_insert.is_empty() {
        return Err("Rows list to insert cannot be empty".to_string());
    }

    let first_row = &rows_to_insert[0];
    let columns: Vec<String> = first_row.keys().map(|k| filter_builder::sanitize_ident(k)).collect();
    let cols_str = columns.join(", ");

    let mut all_params = Vec::new();
    let mut values_strings = Vec::new();

    for row in &rows_to_insert {
        let mut row_placeholders = Vec::new();
        for col in &columns {
            let val = row.get(col).unwrap_or(&Value::Null);
            all_params.push(val.clone());
            row_placeholders.push("?");
        }
        values_strings.push(format!("({})", row_placeholders.join(", ")));
    }

    let sql = format!(
        "INSERT INTO {} ({}) VALUES {}",
        filter_builder::sanitize_ident(table),
        cols_str,
        values_strings.join(", ")
    );

    let (result, _) = QueryExecutionPipeline::run_query(db, &sql, all_params, auth, &db_cfg)
        .await
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "success": true,
        "affected_rows": result.affected_rows.unwrap_or(0),
    }))
}

async fn exec_update(
    auth: &AuthContext,
    args: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let db = args.get("database").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'database'".to_string())?;
    let table = args.get("table").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'table'".to_string())?;

    let filter: HashMap<String, Value> = args.get("filter")
        .and_then(|f| serde_json::from_value(f.clone()).ok())
        .ok_or_else(|| "Missing required 'filter' object".to_string())?;

    if filter.is_empty() {
        return Err("Safety guardrail: 'filter' object must not be empty".to_string());
    }

    let data: HashMap<String, Value> = args.get("data")
        .and_then(|d| serde_json::from_value(d.clone()).ok())
        .ok_or_else(|| "Missing required 'data' object".to_string())?;

    if data.is_empty() {
        return Err("'data' object must not be empty".to_string());
    }

    PolicyEngine::evaluate(auth, db, table, "UPDATE")
        .map_err(|e| e.to_string())?;

    let db_cfg = get_db_config(db, auth).await
        .map_err(|e| e.to_string())?;

    let (sql, values) = filter_builder::construct_update(table, &data, &filter);
    let (result, _) = QueryExecutionPipeline::run_query(db, &sql, values, auth, &db_cfg)
        .await
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "success": true,
        "affected_rows": result.affected_rows.unwrap_or(0),
    }))
}

async fn exec_delete(
    auth: &AuthContext,
    args: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let db = args.get("database").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'database'".to_string())?;
    let table = args.get("table").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'table'".to_string())?;

    let filter: HashMap<String, Value> = args.get("filter")
        .and_then(|f| serde_json::from_value(f.clone()).ok())
        .ok_or_else(|| "Missing required 'filter' object".to_string())?;

    if filter.is_empty() {
        return Err("Safety guardrail: 'filter' object must not be empty".to_string());
    }

    PolicyEngine::evaluate(auth, db, table, "DELETE")
        .map_err(|e| e.to_string())?;

    let db_cfg = get_db_config(db, auth).await
        .map_err(|e| e.to_string())?;

    let (sql, values) = filter_builder::construct_delete(table, &filter);
    let (result, _) = QueryExecutionPipeline::run_query(db, &sql, values, auth, &db_cfg)
        .await
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "success": true,
        "affected_rows": result.affected_rows.unwrap_or(0),
    }))
}

async fn exec_raw_sql(
    auth: &AuthContext,
    args: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let db = args.get("database").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'database'".to_string())?;
    let sql = args.get("sql").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'sql'".to_string())?;

    let db_cfg = get_db_config(db, auth).await
        .map_err(|e| e.to_string())?;

    let params: Vec<Value> = args.get("params")
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default();

    let (result, _) = QueryExecutionPipeline::run_query(db, sql, params, auth, &db_cfg)
        .await
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "columns": result.columns.clone(),
        "rows": result.rows.clone().unwrap_or_default(),
        "affected_rows": result.affected_rows,
    }))
}

// ─── Resource Handlers ─────────────────────────────────────────────────────

async fn handle_resources_list(id: Option<Value>, auth: &AuthContext) -> JsonRpcResponse {
    let config = ConfigManager::get();
    let snapshot = axiom_metadata::snapshot::get_snapshot();

    let mut all_aliases = std::collections::HashSet::new();
    for name in config.database.keys() {
        all_aliases.insert(name.clone());
    }
    for name in snapshot.databases.keys() {
        all_aliases.insert(name.clone());
    }

    let mut sorted_aliases: Vec<String> = all_aliases.into_iter().collect();
    sorted_aliases.sort();

    let authorized_dbs = PolicyEngine::filter_databases(auth, &sorted_aliases);
    let mut resources = vec![
        McpResource {
            uri: "axiom://services".to_string(),
            name: "Active Database Services".to_string(),
            description: "Catalog of active database connections and operational health".to_string(),
            mime_type: "application/json".to_string(),
        },
    ];

    for name in authorized_dbs {
        resources.push(McpResource {
            uri: format!("axiom://schema/{}", name),
            name: format!("Schema for {}", name),
            description: format!("Table definitions and schema metadata for database '{}'", name),
            mime_type: "application/json".to_string(),
        });
    }

    JsonRpcResponse::success(id, json!({ "resources": resources }))
}

async fn handle_resources_read(
    id: Option<Value>,
    params: Option<Value>,
    auth: &AuthContext,
) -> JsonRpcResponse {
    let uri = match params.and_then(|p| p.get("uri").and_then(|u| u.as_str()).map(|s| s.to_string())) {
        Some(u) => u,
        None => {
            return JsonRpcResponse::error(id, -32602, "Missing 'uri' parameter", None);
        }
    };

    if uri == "axiom://services" {
        match exec_list_services(auth).await {
            Ok(val) => {
                let content = McpResourceContent {
                    uri,
                    mime_type: "application/json".to_string(),
                    text: serde_json::to_string_pretty(&val).unwrap_or_default(),
                };
                JsonRpcResponse::success(id, serde_json::to_value(McpResourceReadResult { contents: vec![content] }).unwrap())
            }
            Err(e) => JsonRpcResponse::error(id, -32603, format!("Failed to read services: {}", e), None),
        }
    } else if let Some(service) = uri.strip_prefix("axiom://schema/") {
        let mut map = serde_json::Map::new();
        map.insert("database".to_string(), Value::String(service.to_string()));
        match exec_list_tables(auth, &map).await {
            Ok(tables_val) => {
                let content = McpResourceContent {
                    uri,
                    mime_type: "application/json".to_string(),
                    text: serde_json::to_string_pretty(&tables_val).unwrap_or_default(),
                };
                JsonRpcResponse::success(id, serde_json::to_value(McpResourceReadResult { contents: vec![content] }).unwrap())
            }
            Err(e) => JsonRpcResponse::error(id, -32603, format!("Failed to read schema: {}", e), None),
        }
    } else {
        JsonRpcResponse::error(id, -32602, format!("Resource URI '{}' not found", uri), None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_initialize_response_format() {
        let resp = handle_initialize(Some(json!(1)));
        assert_eq!(resp.jsonrpc, "2.0");
        assert_eq!(resp.id, Some(json!(1)));
        assert!(resp.result.is_some());
        assert!(resp.error.is_none());

        let res = resp.result.unwrap();
        assert_eq!(res["protocolVersion"], "2024-11-05");
        assert_eq!(res["serverInfo"]["name"], "axiom");
    }

    #[test]
    fn test_mcp_tools_list_contains_all_8_tools() {
        let ctx = AuthContext {
            api_key_name: "test_key".to_string(),
            full_admin: true,
            ..Default::default()
        };
        let resp = handle_tools_list(Some(json!(2)), &ctx);
        let res = resp.result.unwrap();
        let tools = res["tools"].as_array().unwrap();

        assert_eq!(tools.len(), 8);
        let tool_names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(tool_names.contains(&"axiom_list_services"));
        assert!(tool_names.contains(&"axiom_list_tables"));
        assert!(tool_names.contains(&"axiom_describe_table"));
        assert!(tool_names.contains(&"axiom_query"));
        assert!(tool_names.contains(&"axiom_insert"));
        assert!(tool_names.contains(&"axiom_update"));
        assert!(tool_names.contains(&"axiom_delete"));
        assert!(tool_names.contains(&"axiom_raw_sql"));
    }

    #[tokio::test]
    async fn test_mcp_unknown_tool_returns_is_error() {
        let ctx = AuthContext {
            api_key_name: "test_key".to_string(),
            full_admin: true,
            ..Default::default()
        };
        let params = json!({
            "name": "non_existent_tool",
            "arguments": {}
        });
        let resp = handle_tools_call(Some(json!(3)), Some(params), &ctx).await;
        assert_eq!(resp.jsonrpc, "2.0");
        let res = resp.result.unwrap();
        assert_eq!(res["isError"], true);
        assert!(res["content"][0]["text"].as_str().unwrap().contains("Unknown tool"));
    }

    #[tokio::test]
    async fn test_mcp_update_empty_filter_guardrail_rejected() {
        let ctx = AuthContext {
            api_key_name: "test_key".to_string(),
            full_admin: true,
            ..Default::default()
        };
        let mut args = serde_json::Map::new();
        args.insert("database".to_string(), json!("main_db"));
        args.insert("table".to_string(), json!("users"));
        args.insert("filter".to_string(), json!({}));
        args.insert("data".to_string(), json!({"name": "Bob"}));

        let err = exec_update(&ctx, &args).await.unwrap_err();
        assert!(err.contains("Safety guardrail"));
    }

    #[tokio::test]
    async fn test_mcp_delete_empty_filter_guardrail_rejected() {
        let ctx = AuthContext {
            api_key_name: "test_key".to_string(),
            full_admin: true,
            ..Default::default()
        };
        let mut args = serde_json::Map::new();
        args.insert("database".to_string(), json!("main_db"));
        args.insert("table".to_string(), json!("users"));
        args.insert("filter".to_string(), json!({}));

        let err = exec_delete(&ctx, &args).await.unwrap_err();
        assert!(err.contains("Safety guardrail"));
    }

    #[tokio::test]
    async fn test_mcp_resources_list_contains_services_catalog() {
        let ctx = AuthContext {
            api_key_name: "test_key".to_string(),
            full_admin: true,
            ..Default::default()
        };
        let resp = handle_resources_list(Some(json!(4)), &ctx).await;
        let res = resp.result.unwrap();
        let resources = res["resources"].as_array().unwrap();
        assert!(resources.iter().any(|r| r["uri"] == "axiom://services"));
    }
}

