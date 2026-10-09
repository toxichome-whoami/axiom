/*
 * Model Context Protocol (MCP) JSON-RPC 2.0 handler and tool execution pipeline.
 * Owned by: api/mcp
 * Key deps: axum, serde_json, base64, crate::database::handlers, crate::blobs, axiom_policy::PolicyEngine, axiom_db::pool, axiom_blob
 * Invariants: Every tool call checks PolicyEngine RBAC; JSON-RPC errors follow the 2024-11-05 spec; blob read guardrails prevent context buffer exhaustion.
 * Last structural change: Integrated Native Blob Storage tools and context resources into the MCP engine.
 */

use axum::extract::Extension;
use axum::Json;
use base64::prelude::*;
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
        McpTool {
            name: "axiom_list_blob_namespaces".to_string(),
            description: "Lists all blob storage namespaces that the caller is authorized to access under RBAC.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        McpTool {
            name: "axiom_list_blobs".to_string(),
            description: "Lists objects in a blob storage namespace with optional prefix filtering and pagination. Subject to RBAC READ policy.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "namespace": { "type": "string", "description": "Target blob namespace" },
                    "prefix": { "type": "string", "description": "Optional key prefix to filter items (e.g. 'docs/' or 'media/2026/')" },
                    "cursor": { "type": "string", "description": "Optional pagination cursor returned from a prior listing" },
                    "limit": { "type": "integer", "description": "Max items to return (default: 50, max: 500)" }
                },
                "required": ["namespace"],
                "additionalProperties": false
            }),
        },
        McpTool {
            name: "axiom_get_blob_metadata".to_string(),
            description: "Retrieves metadata (size, MIME type, BLAKE3 hash, storage tier, creation timestamp) for a stored blob without downloading the body payload.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "namespace": { "type": "string", "description": "Target blob namespace" },
                    "key": { "type": "string", "description": "Exact object key to inspect" }
                },
                "required": ["namespace", "key"],
                "additionalProperties": false
            }),
        },
        McpTool {
            name: "axiom_read_blob".to_string(),
            description: "Reads the content of a stored blob into the agent context. Guardrail: rejects files exceeding max_bytes (default 5MB) to protect LLM context windows.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "namespace": { "type": "string", "description": "Target blob namespace" },
                    "key": { "type": "string", "description": "Object key to read" },
                    "encoding": { "type": "string", "enum": ["utf8", "base64"], "description": "Payload encoding (default: 'utf8'). Binary files should use 'base64'." },
                    "max_bytes": { "type": "integer", "description": "Safety size limit in bytes (default: 5242880 = 5MB, max: 20971520 = 20MB)" }
                },
                "required": ["namespace", "key"],
                "additionalProperties": false
            }),
        },
        McpTool {
            name: "axiom_write_blob".to_string(),
            description: "Stores or overwrites a blob object under the specified namespace and key using UTF-8 text or Base64 binary payload. Subject to RBAC WRITE policy.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "namespace": { "type": "string", "description": "Target blob namespace" },
                    "key": { "type": "string", "description": "Object key/path (e.g. 'reports/summary.md')" },
                    "content": { "type": "string", "description": "File payload as UTF-8 string or Base64 string depending on encoding" },
                    "encoding": { "type": "string", "enum": ["utf8", "base64"], "description": "Content encoding (default: 'utf8')" },
                    "content_type": { "type": "string", "description": "MIME type (default: 'application/octet-stream' or 'text/plain; charset=utf-8')" },
                    "ttl_seconds": { "type": "integer", "description": "Optional time-to-live in seconds for automatic expiration" }
                },
                "required": ["namespace", "key", "content"],
                "additionalProperties": false
            }),
        },
        McpTool {
            name: "axiom_delete_blob".to_string(),
            description: "Deletes an object key from the specified namespace. Subject to RBAC DELETE policy.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "namespace": { "type": "string", "description": "Target blob namespace" },
                    "key": { "type": "string", "description": "Object key to delete" }
                },
                "required": ["namespace", "key"],
                "additionalProperties": false
            }),
        },
        McpTool {
            name: "axiom_create_download_ticket".to_string(),
            description: "Generates a time-bounded cryptographic pre-signed capability download ticket URL for human users or external clients to download large objects directly.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "namespace": { "type": "string", "description": "Target blob namespace" },
                    "key": { "type": "string", "description": "Object key to generate ticket for" },
                    "operation": { "type": "string", "enum": ["READ", "WRITE"], "description": "Authorized ticket operation (default: 'READ')" },
                    "ttl_seconds": { "type": "integer", "description": "Ticket validity duration in seconds (default: 3600, max: 86400)" }
                },
                "required": ["namespace", "key"],
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
        "axiom_list_blob_namespaces" | "list_blob_namespaces" | "axiom_list_namespaces" | "list_namespaces" => {
            exec_list_blob_namespaces(auth).await
        }
        "axiom_list_blobs" | "list_blobs" => exec_list_blobs(auth, &arguments).await,
        "axiom_get_blob_metadata" | "get_blob_metadata" | "head_blob" | "axiom_head_blob" => {
            exec_get_blob_metadata(auth, &arguments).await
        }
        "axiom_read_blob" | "read_blob" => exec_read_blob(auth, &arguments).await,
        "axiom_write_blob" | "write_blob" | "put_blob" | "axiom_put_blob" => {
            exec_write_blob(auth, &arguments).await
        }
        "axiom_delete_blob" | "delete_blob" => exec_delete_blob(auth, &arguments).await,
        "axiom_create_download_ticket" | "create_download_ticket" | "generate_download_ticket" | "axiom_generate_blob_ticket" => {
            exec_create_download_ticket(auth, &arguments).await
        }
        _ => Err(format!("Unknown tool: '{}'", tool_name)),
    };

    match result {
        Ok(val) => {
            let text = if val.is_string() {
                val.as_str().unwrap().to_string()
            } else {
                serde_json::to_string(&val).unwrap_or_default()
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
    let columns: Vec<std::borrow::Cow<'_, str>> = first_row.keys().map(|k| filter_builder::sanitize_ident(k)).collect();
    let cols_str = columns.join(", ");

    let mut all_params = Vec::new();
    let mut values_strings = Vec::new();

    for row in &rows_to_insert {
        let mut row_placeholders = Vec::new();
        for col in &columns {
            let val = row.get(col.as_ref()).unwrap_or(&Value::Null);
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

// ─── Native Blob Storage MCP Tool Implementations ─────────────────────────

/// Discovers all blob storage namespaces authorized for the caller under active RBAC.
/// CONTRACT:
///  - Precondition: Caller authenticated with valid `AuthContext`.
///  - Postcondition: Returns JSON array of authorized namespace names.
///  - Invariants: Namespaces filtered by `PolicyEngine::filter_blob_namespaces`.
///  - Idempotent: Yes.
async fn exec_list_blob_namespaces(auth: &AuthContext) -> Result<Value, String> {
    let engine = crate::blobs::get_blob_engine().map_err(|e| e.to_string())?;
    let all_namespaces = engine.list_namespaces().map_err(|e| e.to_string())?;
    let authorized = PolicyEngine::filter_blob_namespaces(auth, &all_namespaces);

    Ok(json!({
        "namespaces": authorized
    }))
}

/// Lists objects and folders in a blob namespace matching an optional prefix and cursor.
/// CONTRACT:
///  - Precondition: `namespace` must be provided and caller must hold `READ` permissions.
///  - Postcondition: Returns paginated `ListResult` containing metadata items and next cursor.
///  - Invariants: Validates `PolicyEngine::evaluate_blob` for namespace and prefix pattern.
///  - Idempotent: Yes.
async fn exec_list_blobs(
    auth: &AuthContext,
    args: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let ns = args.get("namespace").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'namespace'".to_string())?;
    let prefix = args.get("prefix").and_then(|v| v.as_str());
    let cursor = args.get("cursor").and_then(|v| v.as_str());
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50).min(500) as usize;

    // Check READ permissions on the namespace / prefix pattern
    let check_key = prefix.unwrap_or("*");
    PolicyEngine::evaluate_blob(auth, ns, check_key, "READ")
        .map_err(|e| e.to_string())?;

    let engine = crate::blobs::get_blob_engine().map_err(|e| e.to_string())?;
    let list_res = engine.list(ns, prefix, cursor, limit).map_err(|e| e.to_string())?;

    Ok(json!({
        "namespace": ns,
        "items": list_res.items,
        "next_cursor": list_res.next_cursor
    }))
}

/// Retrieves metadata and storage tier details for an object key without downloading payload.
/// CONTRACT:
///  - Precondition: `namespace` and `key` required; caller authorized for `READ`.
///  - Postcondition: Returns `BlobMetadata` JSON including size, hash, and tier.
///  - Invariants: Zero disk/LSM body I/O; reads index metadata only.
///  - Idempotent: Yes.
async fn exec_get_blob_metadata(
    auth: &AuthContext,
    args: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let ns = args.get("namespace").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'namespace'".to_string())?;
    let key = args.get("key").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'key'".to_string())?;

    PolicyEngine::evaluate_blob(auth, ns, key, "READ")
        .map_err(|e| e.to_string())?;

    let engine = crate::blobs::get_blob_engine().map_err(|e| e.to_string())?;
    let meta = engine.head(ns, key).map_err(|e| e.to_string())?;

    Ok(json!({
        "namespace": ns,
        "key": key,
        "size": meta.size,
        "content_type": meta.content_type,
        "hash": meta.hash,
        "created_at": meta.created_at,
        "inline": meta.inline,
        "expires_at": meta.expires_at,
        "storage_tier": if meta.inline { "LSM Inline" } else { "Disk Shard" }
    }))
}

/// Reads object payload into the agent context with safety size capping and encoding fallback.
/// CONTRACT:
///  - Precondition: `namespace` and `key` required; caller authorized for `READ`.
///  - Postcondition: Returns content encoded as UTF-8 string or Base64 string.
///  - Invariants: Rejects files > `max_bytes` (default 5MB, cap 20MB) to protect LLM context windows.
///  - Idempotent: Yes.
async fn exec_read_blob(
    auth: &AuthContext,
    args: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let ns = args.get("namespace").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'namespace'".to_string())?;
    let key = args.get("key").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'key'".to_string())?;
    let encoding = args.get("encoding").and_then(|v| v.as_str()).unwrap_or("utf8").to_lowercase();
    let max_bytes = match args.get("max_bytes").and_then(|v| v.as_u64()) {
        Some(mb) if mb > 20 * 1024 * 1024 => {
            return Err("Safety guardrail: requested max_bytes exceeds 20MB limit. Use 'axiom_create_download_ticket' for larger objects.".to_string());
        }
        Some(mb) => mb,
        None => 5 * 1024 * 1024,
    };

    PolicyEngine::evaluate_blob(auth, ns, key, "READ")
        .map_err(|e| e.to_string())?;

    let engine = crate::blobs::get_blob_engine().map_err(|e| e.to_string())?;
    let meta = engine.head(ns, key).map_err(|e| e.to_string())?;

    // Safety guardrail: prevent multi-GB disk files from exhausting LLM context buffers or agent RAM
    if meta.size > max_bytes {
        return Err(format!(
            "Safety guardrail: Object size ({} bytes) exceeds max_bytes limit ({} bytes). Use 'axiom_create_download_ticket' to generate a download URL instead.",
            meta.size, max_bytes
        ));
    }

    let (_, bytes) = engine.get_bytes(ns, key).await.map_err(|e| e.to_string())?;

    let (data_str, actual_encoding) = if encoding == "base64" {
        (BASE64_STANDARD.encode(&bytes), "base64")
    } else {
        match String::from_utf8(bytes.clone()) {
            Ok(s) => (s, "utf8"),
            Err(_) => {
                // WHY: When binary data (images, PDFs) is requested with utf8, fallback to base64
                // rather than corrupting byte sequences or erroring out.
                (BASE64_STANDARD.encode(&bytes), "base64")
            }
        }
    };

    Ok(json!({
        "namespace": ns,
        "key": key,
        "size": meta.size,
        "content_type": meta.content_type,
        "encoding": actual_encoding,
        "data": data_str
    }))
}

/// Stores or overwrites a blob object using UTF-8 text or Base64 payload.
/// CONTRACT:
///  - Precondition: `namespace`, `key`, and `content` required; caller authorized for `WRITE`.
///  - Postcondition: Writes payload to storage and commits BLAKE3 content-addressed metadata.
///  - Invariants: Small files (<=64KB) inlined into LSM; larger files written to chunked shards.
///  - Idempotent: Yes on identical content.
async fn exec_write_blob(
    auth: &AuthContext,
    args: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let ns = args.get("namespace").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'namespace'".to_string())?;
    let key = args.get("key").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'key'".to_string())?;
    let content = args.get("content").or_else(|| args.get("data")).and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'content'".to_string())?;
    let encoding = args.get("encoding").and_then(|v| v.as_str()).unwrap_or("utf8").to_lowercase();
    let content_type = args.get("content_type").and_then(|v| v.as_str());
    let ttl_seconds = args.get("ttl_seconds").and_then(|v| v.as_u64());

    PolicyEngine::evaluate_blob(auth, ns, key, "WRITE")
        .map_err(|e| e.to_string())?;

    let raw_bytes = if encoding == "base64" {
        BASE64_STANDARD.decode(content.trim())
            .map_err(|e| format!("Invalid base64 payload: {}", e))?
    } else {
        content.as_bytes().to_vec()
    };

    let engine = crate::blobs::get_blob_engine().map_err(|e| e.to_string())?;
    let meta = engine.put_with_options(ns, key, content_type, &raw_bytes, ttl_seconds)
        .await
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "success": true,
        "namespace": ns,
        "key": key,
        "size": meta.size,
        "hash": meta.hash,
        "inline": meta.inline
    }))
}

/// Deletes an object key from the specified namespace.
/// CONTRACT:
///  - Precondition: `namespace` and `key` required; caller authorized for `DELETE`.
///  - Postcondition: Decrements content refcount and removes key from namespace index.
///  - Invariants: Physical disk shard unlinked if refcount hits zero.
///  - Idempotent: Yes (returns deleted=false if key was not present).
async fn exec_delete_blob(
    auth: &AuthContext,
    args: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let ns = args.get("namespace").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'namespace'".to_string())?;
    let key = args.get("key").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'key'".to_string())?;

    PolicyEngine::evaluate_blob(auth, ns, key, "DELETE")
        .map_err(|e| e.to_string())?;

    let engine = crate::blobs::get_blob_engine().map_err(|e| e.to_string())?;
    let deleted = engine.delete(ns, key).await.map_err(|e| e.to_string())?;

    Ok(json!({
        "success": true,
        "deleted": deleted
    }))
}

/// Generates a time-bounded cryptographic pre-signed capability download ticket URL.
/// CONTRACT:
///  - Precondition: `namespace` and `key` required; caller authorized for specified operation.
///  - Postcondition: Returns signed ticket parameters and relative gateway download URL.
///  - Invariants: Zero server-side session state; verified via BLAKE3-keyed MAC on redemption.
///  - Idempotent: Yes.
async fn exec_create_download_ticket(
    auth: &AuthContext,
    args: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let ns = args.get("namespace").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'namespace'".to_string())?;
    let key = args.get("key").and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'key'".to_string())?;
    let operation = args.get("operation").and_then(|v| v.as_str()).unwrap_or("READ").to_uppercase();
    let ttl_seconds = args.get("ttl_seconds").and_then(|v| v.as_u64()).unwrap_or(3600).min(86400);

    PolicyEngine::evaluate_blob(auth, ns, key, &operation)
        .map_err(|e| e.to_string())?;

    let config = ConfigManager::get();
    let secret = if !config.blob.ticket_secret.is_empty() {
        &config.blob.ticket_secret
    } else {
        "axiom_default_ticket_secret_change_in_production"
    };

    let ticket = axiom_blob::generate_ticket(secret, ns, key, &operation, ttl_seconds);
    let url = format!(
        "/api/v1/blobs/{}/{}?ticket_sig={}&ticket_exp={}",
        ns, key, ticket.signature, ticket.expires_at
    );

    Ok(json!({
        "success": true,
        "namespace": ns,
        "key": key,
        "operation": operation,
        "expires_at": ticket.expires_at,
        "signature": ticket.signature,
        "download_url": url
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

    // Include Native Blob Storage resources if blob subsystem is online
    if let Ok(engine) = crate::blobs::get_blob_engine() {
        if let Ok(all_ns) = engine.list_namespaces() {
            let authorized_ns = PolicyEngine::filter_blob_namespaces(auth, &all_ns);
            resources.push(McpResource {
                uri: "axiom://blobs".to_string(),
                name: "Active Blob Storage Namespaces".to_string(),
                description: "Catalog of active object namespaces and storage telemetry".to_string(),
                mime_type: "application/json".to_string(),
            });

            for ns in authorized_ns {
                resources.push(McpResource {
                    uri: format!("axiom://blobs/{}", ns),
                    name: format!("Blob Namespace '{}'", ns),
                    description: format!("Listing of stored objects and virtual directories in namespace '{}'", ns),
                    mime_type: "application/json".to_string(),
                });
            }
        }
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
    } else if uri == "axiom://blobs" {
        match exec_list_blob_namespaces(auth).await {
            Ok(val) => {
                let content = McpResourceContent {
                    uri,
                    mime_type: "application/json".to_string(),
                    text: serde_json::to_string_pretty(&val).unwrap_or_default(),
                };
                JsonRpcResponse::success(id, serde_json::to_value(McpResourceReadResult { contents: vec![content] }).unwrap())
            }
            Err(e) => JsonRpcResponse::error(id, -32603, format!("Failed to read blob namespaces: {}", e), None),
        }
    } else if let Some(ns) = uri.strip_prefix("axiom://blobs/") {
        let mut map = serde_json::Map::new();
        map.insert("namespace".to_string(), Value::String(ns.to_string()));
        match exec_list_blobs(auth, &map).await {
            Ok(val) => {
                let content = McpResourceContent {
                    uri,
                    mime_type: "application/json".to_string(),
                    text: serde_json::to_string_pretty(&val).unwrap_or_default(),
                };
                JsonRpcResponse::success(id, serde_json::to_value(McpResourceReadResult { contents: vec![content] }).unwrap())
            }
            Err(e) => JsonRpcResponse::error(id, -32603, format!("Failed to read blob namespace '{}': {}", ns, e), None),
        }
    } else if let Some(path) = uri.strip_prefix("axiom://blob/") {
        if let Some((ns, key)) = path.split_once('/') {
            let mut map = serde_json::Map::new();
            map.insert("namespace".to_string(), Value::String(ns.to_string()));
            map.insert("key".to_string(), Value::String(key.to_string()));
            match exec_read_blob(auth, &map).await {
                Ok(val) => {
                    let content_type = val.get("content_type").and_then(|ct| ct.as_str()).unwrap_or("text/plain").to_string();
                    let text = val.get("data").and_then(|d| d.as_str()).unwrap_or_default().to_string();
                    let content = McpResourceContent {
                        uri,
                        mime_type: content_type,
                        text,
                    };
                    JsonRpcResponse::success(id, serde_json::to_value(McpResourceReadResult { contents: vec![content] }).unwrap())
                }
                Err(e) => JsonRpcResponse::error(id, -32603, format!("Failed to read blob '{}': {}", path, e), None),
            }
        } else {
            JsonRpcResponse::error(id, -32602, format!("Malformed blob URI: '{}'. Expected 'axiom://blob/{{namespace}}/{{key}}'", uri), None)
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
    fn test_mcp_tools_list_contains_all_15_tools() {
        let ctx = AuthContext {
            api_key_name: "test_key".to_string(),
            is_session: true,
            ..Default::default()
        };
        let resp = handle_tools_list(Some(json!(2)), &ctx);
        let res = resp.result.unwrap();
        let tools = res["tools"].as_array().unwrap();

        // 8 relational DB tools + 7 native blob storage tools = 15 tools total
        assert_eq!(tools.len(), 15);
        let tool_names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(tool_names.contains(&"axiom_list_services"));
        assert!(tool_names.contains(&"axiom_list_tables"));
        assert!(tool_names.contains(&"axiom_describe_table"));
        assert!(tool_names.contains(&"axiom_query"));
        assert!(tool_names.contains(&"axiom_insert"));
        assert!(tool_names.contains(&"axiom_update"));
        assert!(tool_names.contains(&"axiom_delete"));
        assert!(tool_names.contains(&"axiom_raw_sql"));

        // Verify all 7 Native Blob Storage tools are registered in catalog
        assert!(tool_names.contains(&"axiom_list_blob_namespaces"));
        assert!(tool_names.contains(&"axiom_list_blobs"));
        assert!(tool_names.contains(&"axiom_get_blob_metadata"));
        assert!(tool_names.contains(&"axiom_read_blob"));
        assert!(tool_names.contains(&"axiom_write_blob"));
        assert!(tool_names.contains(&"axiom_delete_blob"));
        assert!(tool_names.contains(&"axiom_create_download_ticket"));
    }

    #[tokio::test]
    async fn test_mcp_unknown_tool_returns_is_error() {
        let ctx = AuthContext {
            api_key_name: "test_key".to_string(),
            is_session: true,
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
            is_session: true,
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
            is_session: true,
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
            is_session: true,
            ..Default::default()
        };
        let resp = handle_resources_list(Some(json!(4)), &ctx).await;
        let res = resp.result.unwrap();
        let resources = res["resources"].as_array().unwrap();
        assert!(resources.iter().any(|r| r["uri"] == "axiom://services"));
    }

    #[tokio::test]
    async fn test_mcp_blob_tools_require_parameters() {
        let ctx = AuthContext {
            api_key_name: "test_key".to_string(),
            is_session: true,
            ..Default::default()
        };
        let empty_args = serde_json::Map::new();

        // exec_list_blobs requires 'namespace'
        let err = exec_list_blobs(&ctx, &empty_args).await.unwrap_err();
        assert!(err.contains("Missing required parameter 'namespace'"));

        // exec_get_blob_metadata requires 'namespace' and 'key'
        let err = exec_get_blob_metadata(&ctx, &empty_args).await.unwrap_err();
        assert!(err.contains("Missing required parameter 'namespace'"));

        // exec_read_blob requires 'namespace' and 'key'
        let err = exec_read_blob(&ctx, &empty_args).await.unwrap_err();
        assert!(err.contains("Missing required parameter 'namespace'"));

        // exec_write_blob requires 'namespace', 'key', and data
        let err = exec_write_blob(&ctx, &empty_args).await.unwrap_err();
        assert!(err.contains("Missing required parameter 'namespace'"));

        // exec_delete_blob requires 'namespace' and 'key'
        let err = exec_delete_blob(&ctx, &empty_args).await.unwrap_err();
        assert!(err.contains("Missing required parameter 'namespace'"));

        // exec_create_download_ticket requires 'namespace' and 'key'
        let err = exec_create_download_ticket(&ctx, &empty_args).await.unwrap_err();
        assert!(err.contains("Missing required parameter 'namespace'"));
    }

    #[tokio::test]
    async fn test_mcp_blob_read_max_bytes_guardrail() {
        let ctx = AuthContext {
            api_key_name: "test_key".to_string(),
            is_session: true,
            ..Default::default()
        };
        let mut args = serde_json::Map::new();
        args.insert("namespace".to_string(), json!("media"));
        args.insert("key".to_string(), json!("photo.png"));
        // Exceeding the 20MB limit
        args.insert("max_bytes".to_string(), json!(25 * 1024 * 1024));

        let err = exec_read_blob(&ctx, &args).await.unwrap_err();
        assert!(err.contains("Safety guardrail: requested max_bytes exceeds 20MB limit"));
    }
}


