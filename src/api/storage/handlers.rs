use axum::{
    extract::{Extension, Multipart, Path, Query},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path as StdPath;
use tokio::fs;

use crate::api::errors::AxiomError;
use crate::api::storage::chunked_upload::ChunkedUploadManager;
use crate::api::storage::streaming::serve_file;
use crate::config::loader::ConfigManager;
use crate::utils::types::AuthContext;

fn get_storage_path(alias: &str, rel_path: &str, auth: &AuthContext) -> Result<String, AxiomError> {
    if !auth.fs_scope.iter().any(|s| s == "*" || s == alias) {
        return Err(AxiomError::new(
            "AUTH_SCOPE_DENIED",
            "API key does not have access to storage",
            StatusCode::FORBIDDEN,
        ));
    }

    let config = ConfigManager::get();
    let storage_cfg = config.storage.get(alias).ok_or_else(|| {
        AxiomError::new(
            "FS_NOT_FOUND",
            "Storage alias not found",
            StatusCode::NOT_FOUND,
        )
    })?;

    let base_path = StdPath::new(&storage_cfg.path);
    if !base_path.exists() {
        let _ = std::fs::create_dir_all(base_path);
    }
    if rel_path.contains("..") {
        return Err(AxiomError::new(
            "INPUT_PATH_TRAVERSAL",
            "Path traversal attempt detected",
            StatusCode::BAD_REQUEST,
        ));
    }

    // Force strict relative paths
    let req_path = StdPath::new(rel_path);
    if req_path.is_absolute() || req_path.has_root() {
        return Err(AxiomError::new(
            "INPUT_PATH_TRAVERSAL",
            "Absolute paths are forbidden",
            StatusCode::BAD_REQUEST,
        ));
    }

    // Clean leading slashes and windows drive prefixes
    let clean_rel_path = rel_path.trim_start_matches('/').trim_start_matches('\\');

    let target_path = base_path.join(clean_rel_path);

    // Additional safeguard
    if !target_path.starts_with(base_path) {
        return Err(AxiomError::new(
            "INPUT_PATH_TRAVERSAL",
            "Path traversal attempt detected",
            StatusCode::BAD_REQUEST,
        ));
    }

    Ok(target_path.to_string_lossy().to_string())
}

pub async fn list_storages(
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<Value>, AxiomError> {
    let config = ConfigManager::get();
    let mut storages = Vec::new();

    for (name, storage_cfg) in &config.storage {
        if auth.fs_scope.iter().any(|s| s == "*" || s == name) {
            let exists = StdPath::new(&storage_cfg.path).exists();
            storages.push(json!({
                "name": name,
                "mode": storage_cfg.mode,
                "status": if exists { "available" } else { "unavailable" },
                "limit": storage_cfg.limit,
                "chunk_size": storage_cfg.chunk_size,
                "max_file_size": storage_cfg.max_file_size,
                "federated": false,
                "usage": {
                    "used_bytes": [0, "0 B"], // Stubbed
                    "available_bytes": [0, "0 B"], // Stubbed
                    "file_count": 0
                }
            }));
        }
    }

    Ok(Json(json!({ "storages": storages })))
}

pub async fn list_folder(
    Path(alias): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<Value>, AxiomError> {
    let rel_path = params.get("path").map(|s| s.as_str()).unwrap_or("/");

    // 1. Fast path memory-only checks
    if !auth.fs_scope.iter().any(|s| s == "*" || s == &alias) {
        return Err(AxiomError::new(
            "AUTH_SCOPE_DENIED",
            "API key does not have access to storage",
            StatusCode::FORBIDDEN,
        ));
    }

    let config = ConfigManager::get();
    if !config.storage.contains_key(&alias) {
        return Err(AxiomError::new(
            "FS_NOT_FOUND",
            "Storage alias not found",
            StatusCode::NOT_FOUND,
        ));
    }

    // 2. Cache Lookup
    let cache_enabled = config.cache.enabled && config.cache.fs_cache;
    let cache_ttl = config.cache.query_results_ttl as u64;

    let cache_key = format!("{}:{}", alias, rel_path);
    static FS_CACHE: once_cell::sync::Lazy<
        dashmap::DashMap<String, (std::time::Instant, Vec<Value>)>,
    > = once_cell::sync::Lazy::new(|| dashmap::DashMap::new());

    if cache_enabled {
        if let Some(entry) = FS_CACHE.get(&cache_key) {
            if entry.0.elapsed().as_secs() < cache_ttl {
                let items = entry.1.clone();
                return Ok(Json(json!({
                    "storage": alias,
                    "path": rel_path,
                    "items": items,
                    "pagination": {
                        "limit": 100,
                        "is_truncated": false,
                        "next_continuation_token": null
                    }
                })));
            }
        }
    }

    // 3. Cache Miss: Perform Disk IO
    let target_path = get_storage_path(&alias, rel_path, &auth)?;

    if !StdPath::new(&target_path).exists() {
        return Err(AxiomError::new(
            "FS_PATH_NOT_FOUND",
            "Directory not found",
            StatusCode::NOT_FOUND,
        ));
    }

    // Optimize directory listing by doing it in a single blocking task rather than tokio::fs
    // which spawns a blocking task for every single entry and metadata fetch.
    let target_path_clone = target_path.clone();
    let items_res = tokio::task::spawn_blocking(move || {
        let mut local_items = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&target_path_clone) {
            for entry_res in entries {
                if let Ok(entry) = entry_res {
                    if let Ok(m) = entry.metadata() {
                        local_items.push(json!({
                            "name": entry.file_name().to_string_lossy(),
                            "is_dir": m.is_dir(),
                            "size": m.len()
                        }));
                    }
                }
            }
        }
        local_items
    })
    .await;

    let items = items_res.unwrap_or_default();

    if cache_enabled {
        FS_CACHE.insert(cache_key, (std::time::Instant::now(), items.clone()));
    }

    Ok(Json(json!({
        "storage": alias,
        "path": rel_path,
        "items": items,
        "pagination": {
            "limit": 100,
            "is_truncated": false,
            "next_continuation_token": null
        }
    })))
}

pub async fn upload_file(
    Path(alias): Path<String>,
    Extension(auth): Extension<AuthContext>,
    mut multipart: Multipart,
) -> Result<Json<Value>, AxiomError> {
    // Basic direct upload stub taking multipart/form-data
    let mut total_written = 0;
    let mut file_path = String::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        let field_name = field.name().unwrap_or("").to_string();

        if field_name == "file" {
            let filename = field.file_name().unwrap_or("upload.bin").to_string();
            let target_path = get_storage_path(&alias, &filename, &auth)?;

            let data = field.bytes().await.map_err(|_| {
                AxiomError::new(
                    "FS_ERROR",
                    "Failed to read upload",
                    StatusCode::INTERNAL_SERVER_ERROR,
                )
            })?;
            total_written = data.len();
            file_path = target_path.clone();

            fs::write(&target_path, data).await.map_err(|_| {
                AxiomError::new(
                    "FS_ERROR",
                    "Failed to write file",
                    StatusCode::INTERNAL_SERVER_ERROR,
                )
            })?;
        }
    }

    Ok(Json(json!({
        "action": "direct",
        "status": "success",
        "file": {
            "path": file_path,
            "size": total_written
        }
    })))
}

pub async fn json_action(
    Path(alias): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, AxiomError> {
    let action = payload.get("action").and_then(|v| v.as_str()).unwrap_or("");

    if action == "initiate" {
        let upload_id = format!("upl_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));
        let session = payload.clone();
        ChunkedUploadManager::initiate(&upload_id, session);

        return Ok(Json(json!({
            "upload_id": upload_id,
            "chunk_size": 10485760,
            "total_chunks": 1,
            "chunks": []
        })));
    } else if action == "finalize" {
        let upload_id = payload
            .get("upload_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let path = payload.get("path").and_then(|v| v.as_str()).unwrap_or("");

        let target = get_storage_path(&alias, path, &auth)?;

        let result = ChunkedUploadManager::finalize(upload_id, &target)
            .await
            .map_err(|e| AxiomError::new("FS_ERROR", &e, StatusCode::BAD_REQUEST))?;

        return Ok(Json(result));
    }

    Err(AxiomError::new(
        "INPUT_SCHEMA_INVALID",
        "Invalid block definition",
        StatusCode::BAD_REQUEST,
    ))
}

pub async fn download_file(
    Path((alias, path)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl axum::response::IntoResponse, AxiomError> {
    let target_path = get_storage_path(&alias, &path, &auth)?;

    serve_file(&target_path).await.map_err(|_| {
        AxiomError::new(
            "FS_ERROR",
            "Failed to serve file",
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })
}
