use axum::{extract::Extension, routing::get, Json, Router};
use serde_json::{json, Value};

use crate::api::errors::AxiomError;
use crate::api::federation::state::FederationStateManager;
use crate::config::loader::ConfigManager;
use crate::utils::types::AuthContext;

pub fn get_router() -> Router {
    Router::new().route("/servers", get(list_servers))
}

async fn list_servers(Extension(auth): Extension<AuthContext>) -> Result<Json<Value>, AxiomError> {
    if !auth.full_admin {
        return Err(AxiomError::new(
            "AUTH_INSUFFICIENT",
            "Admin access required to view federation status",
            axum::http::StatusCode::FORBIDDEN,
        ));
    }

    let config = ConfigManager::get();

    if !config.features.federation {
        return Err(AxiomError::new(
            "FED_DISABLED",
            "Federation is disabled on this instance",
            axum::http::StatusCode::NOT_IMPLEMENTED,
        ));
    }

    let state_mgr = FederationStateManager::new();
    state_mgr.load().await;

    let fed = &config.federation;

    let mut outgoing = Vec::new();
    for (alias, srv_cfg) in &fed.server {
        let state = state_mgr.get_state(alias);
        outgoing.push(json!({
            "alias": alias,
            "url": srv_cfg.url,
            "node_id": srv_cfg.node_id,
            "status": state.as_ref().map(|s| s.status.as_str()).unwrap_or("unknown"),
            "latency_ms": state.as_ref().map(|s| s.latency_ms).unwrap_or(0.0),
            "databases": state.as_ref().map(|s| &s.databases).cloned().unwrap_or_default(),
            "storages": state.as_ref().map(|s| &s.storages).cloned().unwrap_or_default(),
        }));
    }

    let mut incoming = Vec::new();
    for (node_id, key_cfg) in &fed.incoming {
        incoming.push(json!({
            "node_id": node_id,
            "mode": key_cfg.mode,
            "db_scope": key_cfg.db_scope,
            "fs_scope": key_cfg.fs_scope,
            "description": key_cfg.description,
            // Secret is NEVER exposed
        }));
    }

    Ok(Json(json!({
        "outgoing": outgoing,
        "outgoing_count": outgoing.len(),
        "incoming": incoming,
        "incoming_count": incoming.len(),
    })))
}
