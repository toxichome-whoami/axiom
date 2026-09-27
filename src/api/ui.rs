/*
 * Web UI asset serving layer embedding the Vite+TS+Tailwind SPA bundle.
 * Owned by: api/ui
 * Key deps: axum, rust-embed
 * Invariants: Serves single-page application bundle with index.html fallback for client-side routing.
 * Last structural change: Phase 7 initial implementation of Web UI embedding.
 */

use axum::{
    body::Body,
    http::{header, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "ui/dist/"]
struct Assets;

/// Constructs the Web UI sub-router mounted under `/ui`.
/// CONTRACT:
///  - Returns Router serving embedded HTML/CSS/JS assets.
///  - Falls back to `index.html` on unmatched paths for client-side SPA routing.
pub fn get_router() -> Router {
    Router::new()
        .route("/", get(index_handler))
        .route("/*path", get(static_handler))
}

async fn index_handler() -> impl IntoResponse {
    serve_asset("index.html")
}

fn get_mime(path: &str) -> &'static str {
    if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".js") {
        "application/javascript; charset=utf-8"
    } else if path.ends_with(".json") {
        "application/json"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".ico") {
        "image/x-icon"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".woff2") {
        "font/woff2"
    } else {
        "application/octet-stream"
    }
}

async fn static_handler(uri: Uri) -> impl IntoResponse {
    let raw_path = uri.path();
    let path = raw_path
        .trim_start_matches("/ui")
        .trim_start_matches('/');

    if path.is_empty() {
        return serve_asset("index.html");
    }

    match Assets::get(path) {
        Some(content) => {
            let mime = get_mime(path);
            Response::builder()
                .header(header::CONTENT_TYPE, HeaderValue::from_static(mime))
                .body(Body::from(content.data))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        None => {
            // SPA client-side routing fallback: serve index.html
            serve_asset("index.html")
        }
    }
}

fn serve_asset(path: &str) -> Response {
    match Assets::get(path) {
        Some(content) => {
            let mime = get_mime(path);
            Response::builder()
                .header(header::CONTENT_TYPE, HeaderValue::from_static(mime))
                .body(Body::from(content.data))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Axiom Web UI asset not found."))
            .unwrap_or_else(|_| StatusCode::NOT_FOUND.into_response()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ui_mime_resolution() {
        assert_eq!(get_mime("index.html"), "text/html; charset=utf-8");
        assert_eq!(get_mime("assets/main.css"), "text/css; charset=utf-8");
        assert_eq!(get_mime("assets/main.js"), "application/javascript; charset=utf-8");
        assert_eq!(get_mime("favicon.ico"), "image/x-icon");
        assert_eq!(get_mime("logo.svg"), "image/svg+xml");
    }

    #[test]
    fn test_embedded_index_html_exists() {
        let asset = Assets::get("index.html");
        assert!(asset.is_some(), "Embedded ui/dist/index.html must be present in the binary");
    }
}
