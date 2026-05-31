use crate::api::database::handlers::{get_db_config, QueryExecutionPipeline};
use crate::utils::types::AuthContext;
use serde_json::{json, Value};

pub async fn handle_tool_call(
    name: &str,
    args: Value,
    auth: &AuthContext,
) -> Result<Value, String> {
    match name {
        "query_database" => {
            let db_name = args
                .get("db_name")
                .and_then(|v| v.as_str())
                .ok_or("Missing db_name")?;
            let sql = args
                .get("sql")
                .and_then(|v| v.as_str())
                .ok_or("Missing sql")?;

            let mut params_vec = Vec::new();
            if let Some(params_arr) = args.get("params").and_then(|v| v.as_array()) {
                params_vec = params_arr.clone();
            }

            let db_cfg = get_db_config(db_name, auth)
                .await
                .map_err(|e| e.message.clone())?;

            match QueryExecutionPipeline::run_query(db_name, sql, params_vec, auth, &db_cfg).await {
                Ok(res) => {
                    let text_out = serde_json::to_string_pretty(&res.rows.unwrap_or_default())
                        .unwrap_or_else(|_| "[]".to_string());
                    Ok(json!({
                        "content": [
                            {
                                "type": "text",
                                "text": text_out
                            }
                        ]
                    }))
                }
                Err(e) => Err(e.message),
            }
        }
        _ => Err(format!("Unknown tool: {}", name)),
    }
}
