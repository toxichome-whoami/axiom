use crate::api::mcp::tools::handle_tool_call;
use crate::utils::types::AuthContext;
use serde_json::{json, Value};

pub struct MCPServer;

impl MCPServer {
    pub async fn handle_rpc_message(msg: Value, auth: &AuthContext) -> Option<Value> {
        let method = msg.get("method").and_then(|v| v.as_str()).unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));
        let id = msg.get("id").cloned().unwrap_or_else(|| json!(null));

        let result = match method {
            "initialize" => Ok(json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": { "listChanged": false },
                    "resources": { "subscribe": false, "listChanged": false },
                },
                "serverInfo": {
                    "name": "axiom-mcp",
                    "version": "1.0.5"
                }
            })),
            "notifications/initialized" => {
                return None; // No response for notifications
            }
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({
                "tools": [
                    {
                        "name": "query_database",
                        "description": "Execute a SQL query against an Axiom managed database",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "db_name": { "type": "string" },
                                "sql": { "type": "string" },
                                "params": {
                                    "type": "array",
                                    "items": { "type": "string" }
                                }
                            },
                            "required": ["db_name", "sql"]
                        }
                    }
                ]
            })),
            "tools/call" => {
                let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));

                match handle_tool_call(name, args, auth).await {
                    Ok(res) => Ok(res),
                    Err(e) => Err(json!({ "code": -32603, "message": e })),
                }
            }
            "resources/list" => Ok(json!({
                "resources": []
            })),
            _ => Err(json!({ "code": -32601, "message": format!("Method not found: {}", method) })),
        };

        match result {
            Ok(res) => Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": res
            })),
            Err(err) => Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": err
            })),
        }
    }
}
