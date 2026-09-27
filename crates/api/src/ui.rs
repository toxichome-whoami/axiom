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
#[folder = "../../ui/dist/"]
struct Assets;

/// Content-Security-Policy header configured specifically for the embedded Web UI.
/// Relaxes default-src to 'self' and permits Google Fonts stylesheets/webfonts and inline scripts/styles
/// required for SPA hash routing and reactive DOM updates, while forbidding embedding (clickjacking defense).
pub const UI_CSP: &str = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none';";

/// Constructs the Web UI sub-router mounted under `/ui`.
/// CONTRACT:
///  - Returns Router serving embedded HTML/CSS/JS assets.
///  - Falls back to `index.html` on unmatched paths for client-side SPA routing.
pub fn get_router() -> Router {
    Router::new()
        .route("/", get(index_handler))
        .route("/*path", get(static_handler))
}

pub async fn index_handler() -> impl IntoResponse {
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
                .header(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(UI_CSP))
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
                .header(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(UI_CSP))
                .body(Body::from(content.data))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, HeaderValue::from_static("text/plain; charset=utf-8"))
            .header(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(UI_CSP))
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

    #[tokio::test]
    async fn test_ui_routes_serve_html() {
        use axum::http::Request;
        use tower::ServiceExt;
        let app = crate::server::app::create_app();

        let res = app.clone().oneshot(Request::get("/ui").body(axum::body::Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let res2 = app.clone().oneshot(Request::get("/ui/").body(axum::body::Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res2.status(), StatusCode::OK);

        let res3 = app.clone().oneshot(Request::get("/ui/databases").body(axum::body::Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res3.status(), StatusCode::OK);
        assert_eq!(
            res3.headers().get("content-security-policy").unwrap(),
            UI_CSP
        );

        // Find the embedded CSS asset dynamically so hash updates never break tests
        let css_file = Assets::iter()
            .find(|p| p.ends_with(".css"))
            .expect("Embedded bundle must include at least one compiled CSS stylesheet");
        let asset_url = format!("/ui/{}", css_file);

        let res_css = app.clone().oneshot(Request::get(&asset_url).body(axum::body::Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res_css.status(), StatusCode::OK);
        let content_type = res_css.headers().get("content-type").unwrap().to_str().unwrap();
        assert!(content_type.contains("text/css"));
        assert_eq!(
            res_css.headers().get("content-security-policy").unwrap(),
            UI_CSP
        );

        // Also verify that non-UI API endpoints retain the strict default-src 'none' CSP
        let res_api = app.clone().oneshot(Request::get("/api/v1/health").body(axum::body::Body::empty()).unwrap()).await.unwrap();
        assert_eq!(
            res_api.headers().get("content-security-policy").unwrap(),
            "default-src 'none'; frame-ancestors 'none';"
        );
    }
}
