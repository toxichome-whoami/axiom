/*
 * End-to-end simulation test suite for the Axiom API gateway and CLI management utility.
 * Owned by: tests
 * Key deps: reqwest, tokio, tempfile, serde_json, base64, blake3
 * Invariants:
 *  - 100% native Rust implementation replacing legacy tools/zig/simulate_e2e.zig.
 *  - Ephemeral sandbox directories: all state is fully isolated per test run and auto-purged on drop.
 *  - Dynamic port binding: eliminates port 4598 collisions during concurrent test execution.
 *  - RAII server process guard: guarantees child daemon termination even upon assertion failure or panic.
 */

use base64::prelude::*;
use serde_json::{json, Value};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// RAII wrapper to ensure child server processes are killed and reaped upon drop.
struct ServerGuard {
    child: Child,
}

impl Drop for ServerGuard {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Locates the built `axiom` or `axiom.exe` binary in the target directory.
fn locate_axiom_binary() -> PathBuf {
    if let Ok(path) = std::env::var("CARGO_BIN_EXE_axiom") {
        let p = PathBuf::from(path);
        if p.exists() {
            return p;
        }
    }

    if let Ok(mut exe) = std::env::current_exe() {
        exe.pop();
        if exe.file_name().map(|n| n == "deps").unwrap_or(false) {
            exe.pop();
        }
        let binary_name = if cfg!(windows) { "axiom.exe" } else { "axiom" };
        let candidate = exe.join(binary_name);
        if candidate.exists() {
            return candidate;
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest_dir.parent().unwrap_or(&manifest_dir);
    let binary_name = if cfg!(windows) { "axiom.exe" } else { "axiom" };
    let debug_bin = root.join("target").join("debug").join(binary_name);
    if debug_bin.exists() {
        return debug_bin;
    }

    let status = Command::new("cargo")
        .args(["build", "-p", "axiom"])
        .current_dir(root)
        .status()
        .expect("Failed to build axiom binary for E2E testing");
    assert!(status.success(), "cargo build -p axiom failed");
    assert!(
        debug_bin.exists(),
        "axiom binary not found after cargo build at {}",
        debug_bin.display()
    );
    debug_bin
}

/// Allocates an ephemeral available TCP port on localhost.
fn allocate_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind ephemeral TCP port");
    let port = listener
        .local_addr()
        .expect("Failed to retrieve port")
        .port();
    drop(listener);
    port
}

/// Polls server readiness endpoint until it is accepting connections.
async fn wait_for_server_ready(client: &reqwest::Client, base_url: &str) {
    let start = Instant::now();
    let timeout = Duration::from_secs(10);
    while start.elapsed() < timeout {
        if let Ok(res) = client.get(format!("{}/ready", base_url)).send().await {
            if res.status().is_success() {
                return;
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("Axiom server daemon failed to become ready within 10 seconds");
}

/// Extracts session token from either standard API response envelopes.
fn extract_token(val: &Value) -> String {
    val.pointer("/data/token")
        .or_else(|| val.pointer("/data/session_token"))
        .or_else(|| val.get("token"))
        .or_else(|| val.get("session_token"))
        .and_then(|v| v.as_str())
        .expect("Failed to locate session token in JSON response")
        .to_string()
}

#[tokio::test]
async fn test_full_native_e2e_simulation() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let axiom_bin = locate_axiom_binary();
    let sandbox = tempfile::tempdir().expect("Failed to allocate sandbox tempdir");
    let sandbox_path = sandbox.path();

    let data_dir = sandbox_path.join("data");
    let blobs_dir = data_dir.join("blobs");
    let logs_dir = sandbox_path.join("logs");
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::create_dir_all(&blobs_dir).unwrap();
    std::fs::create_dir_all(&logs_dir).unwrap();

    let port = allocate_free_port();
    let host = "127.0.0.1";
    let base_url = format!("http://{}:{}", host, port);

    let db_path = data_dir.join("axiom.db");
    let db_url = format!("file:{}", db_path.display()).replace('\\', "/");
    let blobs_path_str = blobs_dir.display().to_string().replace('\\', "/");
    let logs_dir_str = logs_dir.display().to_string().replace('\\', "/");

    let config_path = sandbox_path.join("axiom.toml");
    let config_content = format!(
        r#"[server]
host = "{host}"
port = {port}
max_connections = 1000
request_timeout = 15
body_limit = "10mb"
allowed_ips = ["127.0.0.1"]
trusted_proxies = ["127.0.0.1"]
cors_origins = ["*"]
shutdown_timeout = 5

[logging]
enabled = true
level = "INFO"
format = "pretty"
directory = "{logs_dir_str}"
file_prefix = "axiom_sim"
max_file_size = "10mb"
max_files = 2
stdout = false

[rate_limit]
enabled = true
backend = "memory"
window = 60
max_requests = 1000
burst = 100
penalty_threshold = 20
penalty_cooldown = 60

[cache]
enabled = true
backend = "memory"
query_cache = false
query_results_ttl = 0
schema_ttl = 60

[metadata]
url = "{db_url}"
token = ""
reload_interval = 5

[blob]
path = "{blobs_path_str}"
inline_max = "64kb"
max_object = "5gb"
verify_reads = false
"#
    );
    std::fs::write(&config_path, config_content).expect("Failed to write test config");

    // Spawn Axiom server daemon
    let child = Command::new(&axiom_bin)
        .arg("server")
        .arg("-c")
        .arg(&config_path)
        .current_dir(sandbox_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("Failed to spawn axiom server daemon");
    let _guard = ServerGuard { child };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();

    wait_for_server_ready(&client, &base_url).await;

    // ─────────────────────────────────────────────────────────────────────────────
    // Phase 1: Setup Wizard Lifecycle
    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Initial check: setup_required must be true
    let res = client
        .post(format!("{}/admin/v1/setup/begin", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let begin_json: Value = res.json().await.unwrap();
    assert_eq!(begin_json["data"]["setup_required"], true);

    // 2. Register initial admin account
    let res = client
        .post(format!("{}/admin/v1/setup/account", base_url))
        .json(&json!({
            "username": "MasterOperator",
            "email": "operator@axiom.cloud",
            "password": "SuperSecureAdminPassword123!"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let account_json: Value = res.json().await.unwrap();
    let setup_token = extract_token(&account_json);

    // 3. Register initial LibSQL data engine
    let res = client
        .post(format!("{}/admin/v1/setup/database", base_url))
        .bearer_auth(&setup_token)
        .json(&json!({
            "alias": "testdb",
            "engine": "LibSQL",
            "url": "sqlite://data/test_app_e2e.db"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 4. Finalize and lock setup wizard
    let res = client
        .post(format!("{}/admin/v1/setup/complete", base_url))
        .bearer_auth(&setup_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 5. Subsequent /begin must report setup_required: false
    let res = client
        .post(format!("{}/admin/v1/setup/begin", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let begin_after: Value = res.json().await.unwrap();
    assert_eq!(begin_after["data"]["setup_required"], false);

    // ─────────────────────────────────────────────────────────────────────────────
    // Phase 2: Dual Login & Logout Lifecycle
    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Login with username
    let res = client
        .post(format!("{}/admin/v1/auth/login", base_url))
        .json(&json!({
            "username": "MasterOperator",
            "password": "SuperSecureAdminPassword123!"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let temp_token = extract_token(&res.json().await.unwrap());

    // 2. Revoke session via logout
    let res = client
        .post(format!("{}/admin/v1/auth/logout", base_url))
        .bearer_auth(&temp_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 3. Verify revoked session returns 401 Unauthorized
    let res = client
        .get(format!("{}/admin/v1/status", base_url))
        .bearer_auth(&temp_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 401);

    // 4. Login with email
    let res = client
        .post(format!("{}/admin/v1/auth/login", base_url))
        .json(&json!({
            "username": "operator@axiom.cloud",
            "password": "SuperSecureAdminPassword123!"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let admin_token = extract_token(&res.json().await.unwrap());

    // 5. Reject invalid credentials
    let res = client
        .post(format!("{}/admin/v1/auth/login", base_url))
        .json(&json!({
            "username": "MasterOperator",
            "password": "WrongPassword999!"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 401);

    // ─────────────────────────────────────────────────────────────────────────────
    // Phase 3: Axiom CLI Command Suite
    // ─────────────────────────────────────────────────────────────────────────────
    let run_cli = |args: &[&str]| -> std::process::Output {
        Command::new(&axiom_bin)
            .args(args)
            .current_dir(sandbox_path)
            .output()
            .unwrap_or_else(|e| panic!("Failed to run axiom CLI command {:?}: {}", args, e))
    };

    assert!(run_cli(&["doctor"]).status.success());

    let cfg_str = config_path.to_str().unwrap();
    let out = run_cli(&["user", "show", "--json", "-c", cfg_str]);
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("MasterOperator"));

    let out = run_cli(&["--url", &base_url, "--api-key", &admin_token, "db", "list", "--json"]);
    assert!(out.status.success(), "db list failed: {}", String::from_utf8_lossy(&out.stderr));

    let out = run_cli(&["--url", &base_url, "--api-key", &admin_token, "role", "list", "--json"]);
    assert!(out.status.success(), "role list failed: {}", String::from_utf8_lossy(&out.stderr));

    assert!(run_cli(&["--url", &base_url, "--api-key", &admin_token, "key", "list", "--json"]).status.success());
    assert!(run_cli(&["--url", &base_url, "--api-key", &admin_token, "cache", "stats", "--json"]).status.success());
    assert!(run_cli(&["--url", &base_url, "--api-key", &admin_token, "cache", "flush"]).status.success());
    assert!(run_cli(&["--url", &base_url, "--api-key", &admin_token, "cluster", "status", "--json"]).status.success());
    assert!(run_cli(&["--url", &base_url, "--api-key", &admin_token, "cluster", "peers", "--json"]).status.success());
    assert!(run_cli(&["--url", &base_url, "--api-key", &admin_token, "blob", "ns", "list"]).status.success());
    assert!(run_cli(&["completions", "bash"]).status.success());

    // ─────────────────────────────────────────────────────────────────────────────
    // Phase 4: Data API & CRUD Operations on LibSQL
    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Create products table
    let res = client
        .post(format!("{}/api/v1/db/testdb/query", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({
            "query": "CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL, active INTEGER DEFAULT 1);"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 2. Confirm products table in listing
    let res = client
        .get(format!("{}/api/v1/db/testdb/tables", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let tables_body = res.text().await.unwrap();
    assert!(tables_body.contains("products"));

    // 3. Introspect columns via REST endpoint
    let res = client
        .get(format!("{}/api/v1/db/testdb/products/columns", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 3b. Verify deprecated /schema returns 404
    let res = client
        .get(format!("{}/api/v1/db/testdb/products/schema", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 404);

    // 4. Batch insert rows
    let res = client
        .post(format!("{}/api/v1/db/testdb/products/rows", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({
            "rows": [
                { "name": "Mechanical Keyboard", "price": 129.50, "active": 1 },
                { "name": "Ergonomic Mouse", "price": 69.99, "active": 1 },
                { "name": "Cable Organizer", "price": 9.99, "active": 0 }
            ]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 4b. Create empty table and verify default value row insertion
    let res = client
        .post(format!("{}/api/v1/db/testdb/query", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({
            "query": "CREATE TABLE empty_test (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT DEFAULT 'auto_created');"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    let res = client
        .post(format!("{}/api/v1/db/testdb/empty_test/rows", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({ "row": {} }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 5. Fetch rows
    let res = client
        .get(format!("{}/api/v1/db/testdb/products/rows?limit=10", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 6. Update row
    let res = client
        .patch(format!("{}/api/v1/db/testdb/products/rows", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({
            "filter": { "name": { "eq": "Ergonomic Mouse" } },
            "update": { "price": 59.99 }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 7. Delete filtered row
    let res = client
        .delete(format!("{}/api/v1/db/testdb/products/rows", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({
            "filter": { "name": { "eq": "Cable Organizer" } }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 8. List databases
    let res = client
        .get(format!("{}/api/v1/db/databases", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // ─────────────────────────────────────────────────────────────────────────────
    // Phase 5: RBAC Roles & API Key Granular Permissions
    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Create catalog_reader role with SELECT on products
    let res = client
        .post(format!("{}/admin/v1/roles", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({
            "name": "catalog_reader",
            "description": "Read-only access to products",
            "permissions": [
                {
                    "database": "testdb",
                    "table_name": "products",
                    "operations": ["SELECT"]
                }
            ]
        }))
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success());

    // 2. Create API key linked to catalog_reader role
    let res = client
        .post(format!("{}/admin/v1/keys", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({
            "name": "catalog_reader_key",
            "role": "catalog_reader"
        }))
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success());
    let key_json: Value = res.json().await.unwrap();
    let initial_secret = key_json["data"]["secret"]
        .as_str()
        .or_else(|| key_json["secret"].as_str())
        .expect("Missing secret in key creation response");

    // 3. Compute Base64 X-Axiom-Key header
    let raw_auth = format!("catalog_reader_key:{}", initial_secret);
    let key_header_val = BASE64_STANDARD.encode(raw_auth);

    // 4. Allowed SELECT on products -> 200 OK
    let res = client
        .post(format!("{}/api/v1/db/testdb/query", base_url))
        .header("X-Axiom-Key", &key_header_val)
        .json(&json!({ "query": "SELECT id, name, price FROM products;" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 5. Allowed Table Listing for table-scoped role -> 200 OK
    let res = client
        .get(format!("{}/api/v1/db/testdb/tables", base_url))
        .header("X-Axiom-Key", &key_header_val)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 6. Allowed Scalar Query -> 200 OK
    let res = client
        .post(format!("{}/api/v1/db/testdb/query", base_url))
        .header("X-Axiom-Key", &key_header_val)
        .json(&json!({ "query": "SELECT 1;" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 7. Disallowed Mutation INSERT -> 403 Forbidden
    let res = client
        .post(format!("{}/api/v1/db/testdb/products/rows", base_url))
        .header("X-Axiom-Key", &key_header_val)
        .json(&json!({ "rows": [{ "name": "Hacked Mouse", "price": 0.0, "active": 1 }] }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 403);

    // 8. Disallowed Mutation DELETE -> 403 Forbidden
    let res = client
        .post(format!("{}/api/v1/db/testdb/query", base_url))
        .header("X-Axiom-Key", &key_header_val)
        .json(&json!({ "query": "DELETE FROM products;" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 403);

    // 9. Disallowed Table Access -> 403 Forbidden
    let res = client
        .post(format!("{}/api/v1/db/testdb/query", base_url))
        .header("X-Axiom-Key", &key_header_val)
        .json(&json!({ "query": "SELECT * FROM secret_financial_records;" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 403);

    // 10. Rotate API key
    let res = client
        .post(format!("{}/admin/v1/keys/catalog_reader_key/rotate", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 11. Delete API key
    let res = client
        .delete(format!("{}/admin/v1/keys/catalog_reader_key", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 12. Delete role
    let res = client
        .delete(format!("{}/admin/v1/roles/catalog_reader", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // ─────────────────────────────────────────────────────────────────────────────
    // Phase 6: Cluster Mesh Simulation
    // ─────────────────────────────────────────────────────────────────────────────
    let res = client
        .get(format!("{}/admin/v1/cluster/status", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    let res = client
        .get(format!("{}/admin/v1/cluster/peers", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    let res = client
        .patch(format!("{}/admin/v1/cluster/moniker", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({ "moniker": "simulated-mesh-node-1" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // ─────────────────────────────────────────────────────────────────────────────
    // Phase 7: Native Blob Storage & Capability Ticket Lifecycle
    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Data-plane route guard: ensure mutation methods return 405 Method Not Allowed
    let res = client
        .post(format!("{}/api/v1/blobs/namespaces", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({ "name": "guard_ns" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 405);

    let res = client
        .patch(format!("{}/api/v1/blobs/namespaces/guard_ns", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({ "name": "guard_ns" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 405);

    let res = client
        .delete(format!("{}/api/v1/blobs/namespaces/guard_ns", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 405);

    // 2. Control plane: Create namespaces via Admin API
    let res = client
        .post(format!("{}/admin/v1/blobs/namespaces", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({
            "name": "sim_ns",
            "max_bytes": 10485760,
            "is_public": false
        }))
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success());

    let res = client
        .post(format!("{}/admin/v1/blobs/namespaces", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({
            "name": "sim_priv",
            "max_bytes": 5242880,
            "is_public": false
        }))
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success());

    // 3. Control plane: Inspect namespace & usage headroom
    let res = client
        .get(format!("{}/admin/v1/blobs/namespaces/sim_ns", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    let res = client
        .get(format!("{}/api/v1/blobs/namespaces/sim_ns/usage", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 4. Control plane: Update namespace quota & visibility
    let res = client
        .patch(format!("{}/admin/v1/blobs/namespaces/sim_ns", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({
            "max_bytes": 20971520,
            "is_public": true
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 5. Data plane: PUT blob objects
    let res = client
        .put(format!("{}/api/v1/blobs/sim_ns/report.txt", base_url))
        .bearer_auth(&admin_token)
        .header("Content-Type", "text/plain")
        .body("Axiom Mission Critical Telemetry Data")
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success());

    let res = client
        .put(format!("{}/api/v1/blobs/sim_ns/data/metrics.bin", base_url))
        .bearer_auth(&admin_token)
        .header("Content-Type", "application/octet-stream")
        .body("metrics-binary-payload-12345")
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success());

    let res = client
        .put(format!("{}/api/v1/blobs/sim_priv/vault_secret.txt", base_url))
        .bearer_auth(&admin_token)
        .header("Content-Type", "text/plain")
        .body("TopSecretEnterpriseEncryptionKey")
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success());

    // 6. Data plane: GET blob objects and verify payload integrity
    let res = client
        .get(format!("{}/api/v1/blobs/sim_ns/report.txt", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let body = res.text().await.unwrap();
    assert!(body.contains("Axiom Mission Critical Telemetry Data"));

    // 7. Object Copy & Move
    let res = client
        .post(format!("{}/api/v1/blobs/objects/copy", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({
            "src_namespace": "sim_ns",
            "src_key": "report.txt",
            "dest_namespace": "sim_ns",
            "dest_key": "report_copy.txt"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    let res = client
        .post(format!("{}/api/v1/blobs/objects/move", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({
            "src_namespace": "sim_ns",
            "src_key": "report_copy.txt",
            "dest_namespace": "sim_ns",
            "dest_key": "report_archived.txt"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 8. Object BLAKE3 Checksum Verification
    let res = client
        .post(format!("{}/api/v1/blobs/objects/sim_ns/verify/report.txt", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 9. List Objects
    let res = client
        .get(format!("{}/api/v1/blobs/objects/sim_ns", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 10. Capability Ticket Lifecycle
    let res = client
        .post(format!("{}/admin/v1/blobs/namespaces/sim_priv/tickets", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({
            "key": "vault_secret.txt",
            "operation": "READ",
            "ttl_seconds": 3600
        }))
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success());
    let tkt_json: Value = res.json().await.unwrap();
    let tkt_url = tkt_json.pointer("/data/url")
        .or_else(|| tkt_json.get("url"))
        .and_then(|v| v.as_str())
        .expect("Missing ticket url");
    let tkt_sig = tkt_json.pointer("/data/signature")
        .or_else(|| tkt_json.get("signature"))
        .and_then(|v| v.as_str())
        .expect("Missing ticket signature");

    // 10a. Download without credentials via signed ticket URL
    let dl_full_url = format!("{}{}", base_url, tkt_url);
    let res = client.get(&dl_full_url).send().await.unwrap();
    assert_eq!(res.status(), 200);
    assert!(res.text().await.unwrap().contains("TopSecretEnterpriseEncryptionKey"));

    // 10b. Revoke ticket
    let res = client
        .post(format!("{}/admin/v1/blobs/tickets/{}/revoke", base_url, tkt_sig))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 10c. Revoked ticket blocked with 403 Forbidden
    let res = client.get(&dl_full_url).send().await.unwrap();
    assert_eq!(res.status(), 403);

    // 10d. Re-enable ticket
    let res = client
        .post(format!("{}/admin/v1/blobs/tickets/{}/enable", base_url, tkt_sig))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 10e. Re-enabled ticket succeeds
    let res = client.get(&dl_full_url).send().await.unwrap();
    assert_eq!(res.status(), 200);

    // 10f. Delete ticket
    let res = client
        .delete(format!("{}/admin/v1/blobs/tickets/{}", base_url, tkt_sig))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 10g. Deleted ticket permanently blocked with 403 Forbidden
    let res = client.get(&dl_full_url).send().await.unwrap();
    assert_eq!(res.status(), 403);

    // 11. Batch Delete Objects
    let res = client
        .post(format!("{}/api/v1/blobs/objects/sim_ns/batch-delete", base_url))
        .bearer_auth(&admin_token)
        .json(&json!({
            "keys": ["report_archived.txt", "data/metrics.bin"]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // 12. Cascading Delete of Namespaces via Admin API
    let res = client
        .delete(format!("{}/admin/v1/blobs/namespaces/sim_priv", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    let res = client
        .get(format!("{}/admin/v1/blobs/namespaces/sim_priv", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 404);

    let res = client
        .delete(format!("{}/admin/v1/blobs/namespaces/sim_ns", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    let res = client
        .get(format!("{}/admin/v1/blobs/namespaces/sim_ns", base_url))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 404);

    // ─────────────────────────────────────────────────────────────────────────────
    // Phase 8: Admin & Monitoring Endpoints Simulation
    // ─────────────────────────────────────────────────────────────────────────────
    let admin_endpoints = [
        "/admin/v1/status",
        "/admin/v1/keys",
        "/admin/v1/roles",
        "/admin/v1/databases",
        "/admin/v1/users",
        "/admin/v1/cache/stats",
        "/admin/v1/audit",
        "/admin/v1/health",
        "/admin/v1/metrics",
    ];

    for ep in admin_endpoints {
        let res = client
            .get(format!("{}{}", base_url, ep))
            .bearer_auth(&admin_token)
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 200, "Failed for admin endpoint {}", ep);
    }

    // Web UI route
    let res = client.get(format!("{}/system", base_url)).send().await.unwrap();
    assert_eq!(res.status(), 200);
    let html = res.text().await.unwrap();
    assert!(
        html.contains("<!DOCTYPE html>") || html.contains("<html"),
        "GET /system did not return expected HTML document"
    );
}
