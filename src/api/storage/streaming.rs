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

            let mime_type = mime_guess::from_path(p).first_or_octet_stream();

            let response = Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime_type.as_ref())
                .body(body)
                .unwrap();

            Ok(response)
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}
