use std::env;

fn main() {
    // Use vendored protoc if available
    if let Ok(path) = protoc_bin_vendored::protoc_bin_path() {
        env::set_var("PROTOC", path);
    }

    // Compile gRPC protobuf definitions
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
}
