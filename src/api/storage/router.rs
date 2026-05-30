use axum::{
    routing::{get, post},
    Router,
};

use crate::api::storage::handlers::{
    download_file, json_action, list_folder, list_storages, upload_file,
};

pub fn get_router() -> Router {
    Router::new()
        .route("/storages", get(list_storages))
        .route("/:alias/list", get(list_folder))
        .route("/:alias/upload", post(upload_file))
        .route("/:alias/action", post(json_action))
        .route("/:alias/download/*path", get(download_file))
}
