use axum::{
    body::Body,
    http::{header, StatusCode},
    response::Response,
};
use std::path::Path;
use tokio::fs::File;
use tokio_util::io::ReaderStream;

pub async fn serve_file(path: &str) -> Result<Response, StatusCode> {
    let p = Path::new(path);

    if !p.exists() || !p.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }

    match File::open(p).await {
        Ok(file) => {
            let stream = ReaderStream::new(file);
            let body = Body::from_stream(stream);

            // SECURITY: Force download, never render in browser
            let filename = p.file_name().and_then(|n| n.to_str()).unwrap_or("download");

            let response = Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/octet-stream")
                .header(
                    header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"{}\"", filename),
                )
                .body(body)
                .unwrap();

            Ok(response)
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}
