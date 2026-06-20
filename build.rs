use std::env;
use std::fs;
use std::path::Path;

fn main() {
    // ── 0. Use vendored protoc ─────────────────────────────────────────────
    if let Ok(path) = protoc_bin_vendored::protoc_bin_path() {
        env::set_var("PROTOC", path);
    }

    // ── 1. Compile gRPC protobuf definitions ───────────────────────────────
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile(
            &[
                "proto/axiom/v1/common.proto",
                "proto/axiom/v1/db.proto",
                "proto/axiom/v1/fs.proto",
                "proto/axiom/v1/webhook.proto",
                "proto/axiom/v1/federation.proto",
            ],
            &["proto"],
        )
        .unwrap_or_else(|e| {
            println!(
                "cargo:warning=protobuf compilation failed (non-fatal): {}",
                e
            );
        });

    // ── 2. Write version for build.ps1 ─────────────────────────────────────
    if let Ok(manifest) = env::var("CARGO_MANIFEST_DIR") {
        let ver = env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.0.0".to_string());
        let _ = fs::write(Path::new(&manifest).join(".axiom_version"), &ver);
    }
}
