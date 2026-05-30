fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_dir = "proto/axiom/v1";
    let proto_files = &[
        format!("{}/common.proto", proto_dir),
        format!("{}/db.proto", proto_dir),
        format!("{}/federation.proto", proto_dir),
        format!("{}/fs.proto", proto_dir),
        format!("{}/webhook.proto", proto_dir),
    ];

    // Tell cargo to recompile if any proto file changes
    println!("cargo:rerun-if-changed={}", proto_dir);

    // Point prost-build to the vendored protoc so no system install is needed
    let protoc_path = protoc_bin_vendored::protoc_bin_path().unwrap();
    std::env::set_var("PROTOC", protoc_path);

    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile(proto_files, &["proto"])?;

    Ok(())
}
