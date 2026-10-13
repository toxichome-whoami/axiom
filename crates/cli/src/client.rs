/*
 * Admin API HTTP client for CLI subcommands.
 * Owned by: crates/cli
 * Key deps: reqwest, serde_json
 * Invariants: Injects X-Axiom-Key or Authorization header when provided; parses standard response envelope.
 * Last structural change: Phase 3 initial implementation of CLI HTTP client.
 */

use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;

pub fn session_file_path() -> std::path::PathBuf {
    if let Ok(profile) = std::env::var("USERPROFILE") {
        std::path::PathBuf::from(profile).join(".axiom_session")
    } else if let Ok(home) = std::env::var("HOME") {
        std::path::PathBuf::from(home).join(".axiom_session")
    } else {
        std::path::PathBuf::from(".axiom_session")
    }
}

pub fn get_saved_session() -> Option<String> {
    let path = session_file_path();
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn save_session(token: &str) -> Result<(), String> {
    let path = session_file_path();
    std::fs::write(&path, token.trim())
        .map_err(|e| format!("Failed to save session token to '{:?}': {}", path, e))
}

pub fn clear_saved_session() {
    let path = session_file_path();
    let _ = std::fs::remove_file(path);
}

fn urlencode(s: &str) -> String {
    let mut encoded = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(b as char);
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", b));
            }
        }
    }
    encoded
}

pub struct AdminClient {
    base_url: String,
    auth_key: Option<String>,
    client: Client,
}

impl AdminClient {
    /// Constructs a new AdminClient instance.
    /// CONTRACT:
    ///  - Precondition: `base_url` is a valid HTTP/HTTPS URL string.
    ///  - Resolves auth token from argument, AXIOM_KEY/AXIOM_TOKEN env, or saved session.
    ///  - Returns initialized `AdminClient`.
    ///  - Idempotent: Yes.
    pub fn new(base_url: &str, auth_key: Option<String>) -> Self {
        let resolved_key = auth_key
            .or_else(|| std::env::var("AXIOM_KEY").ok())
            .or_else(|| std::env::var("AXIOM_TOKEN").ok())
            .or_else(get_saved_session);

        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();

        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            auth_key: resolved_key,
            client,
        }
    }

    /// Accessor for resolved authentication key or session token.
    pub fn auth_key(&self) -> Option<&str> {
        self.auth_key.as_deref()
    }

    /// Sends an HTTP request and parses the JSON response envelope.
    async fn request(&self, method: reqwest::Method, endpoint: &str, body: Option<Value>) -> Result<Value, String> {
        let url = format!("{}{}", self.base_url, endpoint);
        let mut req = self.client.request(method, &url);

        if let Some(ref key) = self.auth_key {
            req = req.header("X-Axiom-Key", key);
            req = req.header("Authorization", format!("Bearer {}", key));
        }

        if let Some(b) = body {
            req = req.json(&b);
        }

        let res = req
            .send()
            .await
            .map_err(|e| format!("Network request to '{}' failed: {}", url, e))?;

        let status = res.status();
        let json_resp: Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse response from '{}': {}", url, e))?;

        if !status.is_success() {
            let error_msg = json_resp
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown server error");
            return Err(format!("Server returned HTTP {} ({}): {}", status.as_u16(), status.canonical_reason().unwrap_or(""), error_msg));
        }

        Ok(json_resp)
    }

    /// Fetches server status and metadata telemetry.
    pub async fn get_status(&self) -> Result<Value, String> {
        self.request(reqwest::Method::GET, "/admin/v1/status", None).await
    }

    /// Checks basic server health endpoint.
    pub async fn get_health(&self) -> Result<Value, String> {
        self.request(reqwest::Method::GET, "/health", None).await
    }

    /// Lists registered API keys.
    pub async fn list_keys(&self) -> Result<Value, String> {
        self.request(reqwest::Method::GET, "/admin/v1/keys", None).await
    }

    /// Creates a new API key.
    pub async fn create_key(
        &self,
        name: &str,
        role: Option<&str>,
        secret: Option<&str>,
        rate_limit: Option<i64>,
        expires_at: Option<i64>,
    ) -> Result<Value, String> {
        let body = json!({
            "name": name,
            "role": role,
            "secret": secret,
            "rate_limit": rate_limit,
            "expires_at": expires_at,
        });
        self.request(reqwest::Method::POST, "/admin/v1/keys", Some(body)).await
    }

    /// Rotates the secret for an existing API key.
    pub async fn rotate_key(&self, name: &str) -> Result<Value, String> {
        let endpoint = format!("/admin/v1/keys/{}/rotate", name);
        self.request(reqwest::Method::POST, &endpoint, None).await
    }

    /// Deletes an API key identity.
    pub async fn delete_key(&self, name: &str) -> Result<Value, String> {
        let endpoint = format!("/admin/v1/keys/{}", name);
        self.request(reqwest::Method::DELETE, &endpoint, None).await
    }

    /// Lists configured RBAC roles.
    pub async fn list_roles(&self) -> Result<Value, String> {
        self.request(reqwest::Method::GET, "/admin/v1/roles", None).await
    }

    /// Creates an RBAC role with permission grants.
    pub async fn create_role(
        &self,
        name: &str,
        description: Option<&str>,
        permissions: Value,
    ) -> Result<Value, String> {
        let body = json!({
            "name": name,
            "description": description,
            "permissions": permissions,
        });
        self.request(reqwest::Method::POST, "/admin/v1/roles", Some(body)).await
    }

    /// Updates an existing RBAC role description or permissions.
    pub async fn update_role(
        &self,
        name: &str,
        description: Option<&str>,
        permissions: Option<Value>,
    ) -> Result<Value, String> {
        let endpoint = format!("/admin/v1/roles/{}", name);
        let mut body = serde_json::Map::new();
        if let Some(desc) = description {
            body.insert("description".to_string(), json!(desc));
        }
        if let Some(perms) = permissions {
            body.insert("permissions".to_string(), perms);
        }
        self.request(reqwest::Method::PATCH, &endpoint, Some(Value::Object(body))).await
    }

    /// Deletes an RBAC role.
    pub async fn delete_role(&self, name: &str) -> Result<Value, String> {
        let endpoint = format!("/admin/v1/roles/{}", name);
        self.request(reqwest::Method::DELETE, &endpoint, None).await
    }

    /// Lists registered database connections.
    pub async fn list_databases(&self) -> Result<Value, String> {
        self.request(reqwest::Method::GET, "/admin/v1/databases", None).await
    }

    /// Registers a new upstream database connection.
    pub async fn add_database(
        &self,
        alias: &str,
        url: &str,
        engine: Option<&str>,
        pool_min: Option<i64>,
        pool_max: Option<i64>,
    ) -> Result<Value, String> {
        let body = json!({
            "alias": alias,
            "url": url,
            "engine": engine,
            "pool_min": pool_min,
            "pool_max": pool_max,
        });
        self.request(reqwest::Method::POST, "/admin/v1/databases", Some(body)).await
    }

    /// Tests connectivity and health for an upstream database connection.
    pub async fn test_database(&self, alias: &str) -> Result<Value, String> {
        let endpoint = format!("/admin/v1/databases/{}/test", alias);
        self.request(reqwest::Method::GET, &endpoint, None).await
    }

    /// Removes an upstream database connection.
    pub async fn delete_database(&self, alias: &str) -> Result<Value, String> {
        let endpoint = format!("/admin/v1/databases/{}", alias);
        self.request(reqwest::Method::DELETE, &endpoint, None).await
    }

    /// Fetches cache performance metrics and memory usage.
    pub async fn get_cache_stats(&self) -> Result<Value, String> {
        self.request(reqwest::Method::GET, "/admin/v1/cache/stats", None).await
    }

    /// Flushes all entries from L1 RAM and L2 persistent cache.
    pub async fn flush_cache(&self) -> Result<Value, String> {
        self.request(reqwest::Method::POST, "/admin/v1/cache/flush", None).await
    }

    /// Fetches Prometheus exposition format metrics text.
    pub async fn get_metrics(&self) -> Result<String, String> {
        let url = format!("{}/metrics", self.base_url);
        let mut req = self.client.get(&url);
        if let Some(ref key) = self.auth_key {
            req = req.header("X-Axiom-Key", key);
        }
        let res = req
            .send()
            .await
            .map_err(|e| format!("Network request to '{}' failed: {}", url, e))?;

        if !res.status().is_success() {
            return Err(format!("Server returned HTTP {}", res.status().as_u16()));
        }

        res.text()
            .await
            .map_err(|e| format!("Failed to read metrics response from '{}': {}", url, e))
    }

    /// Triggers an immediate reload of the dynamic metadata store and ArcSwap snapshot.
    pub async fn reload_metadata(&self) -> Result<Value, String> {
        self.request(reqwest::Method::POST, "/admin/v1/reload", None).await
    }

    /// Fetches audit log records with optional pagination.
    pub async fn get_audit_log(&self, limit: Option<usize>, offset: Option<usize>) -> Result<Value, String> {
        let mut endpoint = "/admin/v1/audit".to_string();
        let mut params = Vec::new();
        if let Some(l) = limit {
            params.push(format!("limit={}", l));
        }
        if let Some(o) = offset {
            params.push(format!("offset={}", o));
        }
        if !params.is_empty() {
            endpoint = format!("{}?{}", endpoint, params.join("&"));
        }
        self.request(reqwest::Method::GET, &endpoint, None).await
    }

    /// Tests connectivity against a raw database URL without registering it.
    pub async fn test_database_url(&self, url: &str, alias: Option<&str>) -> Result<Value, String> {
        let body = json!({
            "url": url,
            "alias": alias,
        });
        self.request(reqwest::Method::POST, "/admin/v1/databases/test-url", Some(body)).await
    }

    // ─── Database Data & Table API ─────────────────────────────────────────

    /// Executes a SQL query against an upstream database alias.
    pub async fn query_database(
        &self,
        alias: &str,
        sql: &str,
        params: Option<Value>,
        timeout: Option<u64>,
    ) -> Result<Value, String> {
        let endpoint = format!("/api/v1/db/{}/query", alias);
        let body = json!({
            "sql": sql,
            "params": params,
            "timeout": timeout.unwrap_or(30),
        });
        self.request(reqwest::Method::POST, &endpoint, Some(body)).await
    }

    /// Lists tables in an upstream database alias.
    pub async fn list_database_tables(
        &self,
        alias: &str,
        cursor: Option<i64>,
        limit: Option<usize>,
    ) -> Result<Value, String> {
        let mut endpoint = format!("/api/v1/db/{}/tables", alias);
        let mut params = Vec::new();
        if let Some(c) = cursor {
            params.push(format!("cursor={}", c));
        }
        if let Some(l) = limit {
            params.push(format!("limit={}", l));
        }
        if !params.is_empty() {
            endpoint = format!("{}?{}", endpoint, params.join("&"));
        }
        self.request(reqwest::Method::GET, &endpoint, None).await
    }

    /// Fetches schema and foreign key definitions for a table.
    pub async fn get_table_schema(&self, alias: &str, table: &str) -> Result<Value, String> {
        let endpoint = format!("/api/v1/db/{}/{}/schema", alias, table);
        self.request(reqwest::Method::GET, &endpoint, None).await
    }

    /// Fetches paginated and filtered rows from a database table.
    pub async fn fetch_table_rows(
        &self,
        alias: &str,
        table: &str,
        cursor: Option<&str>,
        limit: Option<usize>,
        sort: Option<&str>,
        order: Option<&str>,
        filter: Option<&str>,
    ) -> Result<Value, String> {
        let mut endpoint = format!("/api/v1/db/{}/{}/rows", alias, table);
        let mut params = Vec::new();
        if let Some(c) = cursor {
            params.push(format!("cursor={}", urlencode(c)));
        }
        if let Some(l) = limit {
            params.push(format!("limit={}", l));
        }
        if let Some(s) = sort {
            params.push(format!("sort={}", urlencode(s)));
        }
        if let Some(o) = order {
            params.push(format!("order={}", urlencode(o)));
        }
        if let Some(f) = filter {
            params.push(format!("filter={}", urlencode(f)));
        }
        if !params.is_empty() {
            endpoint = format!("{}?{}", endpoint, params.join("&"));
        }
        self.request(reqwest::Method::GET, &endpoint, None).await
    }

    /// Inserts row(s) into a database table.
    pub async fn insert_table_row(
        &self,
        alias: &str,
        table: &str,
        row: Option<Value>,
        rows: Option<Value>,
    ) -> Result<Value, String> {
        let endpoint = format!("/api/v1/db/{}/{}/rows", alias, table);
        let mut body_map = serde_json::Map::new();
        if let Some(r) = row {
            body_map.insert("row".to_string(), r);
        }
        if let Some(rs) = rows {
            body_map.insert("rows".to_string(), rs);
        }
        self.request(reqwest::Method::POST, &endpoint, Some(Value::Object(body_map))).await
    }

    /// Updates rows matching filter condition in a database table.
    pub async fn update_table_row(
        &self,
        alias: &str,
        table: &str,
        filter: Value,
        update: Value,
    ) -> Result<Value, String> {
        let endpoint = format!("/api/v1/db/{}/{}/rows", alias, table);
        let body = json!({
            "filter": filter,
            "update": update,
        });
        self.request(reqwest::Method::PATCH, &endpoint, Some(body)).await
    }

    /// Deletes rows matching filter condition in a database table.
    pub async fn delete_table_row(
        &self,
        alias: &str,
        table: &str,
        filter: Value,
    ) -> Result<Value, String> {
        let endpoint = format!("/api/v1/db/{}/{}/rows", alias, table);
        let body = json!({
            "filter": filter,
        });
        self.request(reqwest::Method::DELETE, &endpoint, Some(body)).await
    }

    /// Adds a new column to a database table.
    pub async fn add_table_column(
        &self,
        alias: &str,
        table: &str,
        name: &str,
        data_type: &str,
        nullable: bool,
        default_val: Option<&str>,
    ) -> Result<Value, String> {
        let endpoint = format!("/api/v1/db/{}/{}/columns", alias, table);
        let body = json!({
            "name": name,
            "type": data_type,
            "nullable": nullable,
            "default_value": default_val,
        });
        self.request(reqwest::Method::POST, &endpoint, Some(body)).await
    }

    // ─── Native Blob Storage API ───────────────────────────────────────────

    /// Retrieves cluster-wide blob storage telemetry and statistics.
    pub async fn get_blob_stats(&self) -> Result<Value, String> {
        self.request(reqwest::Method::GET, "/admin/v1/blobs/stats", None).await
    }

    /// Triggers an immediate storage-wide cryptographic scrub audit.
    pub async fn scrub_blobs(&self) -> Result<Value, String> {
        self.request(reqwest::Method::POST, "/admin/v1/blobs/scrub", None).await
    }

    /// Triggers a cleanup sweep of expired TTL blobs.
    pub async fn sweep_blobs(&self) -> Result<Value, String> {
        self.request(reqwest::Method::POST, "/admin/v1/blobs/sweep", None).await
    }

    /// Lists all storage namespaces and quotas.
    pub async fn list_blob_namespaces(&self) -> Result<Value, String> {
        self.request(reqwest::Method::GET, "/admin/v1/blobs/namespaces", None).await
    }

    /// Creates a new storage namespace with an optional quota.
    pub async fn create_blob_namespace(&self, name: &str, max_bytes: Option<u64>) -> Result<Value, String> {
        let body = json!({
            "name": name,
            "max_bytes": max_bytes,
        });
        self.request(reqwest::Method::POST, "/admin/v1/blobs/namespaces", Some(body)).await
    }

    /// Updates an existing storage namespace name or quota.
    pub async fn update_blob_namespace(
        &self,
        name: &str,
        new_name: Option<&str>,
        max_bytes: Option<u64>,
    ) -> Result<Value, String> {
        let body = json!({
            "new_name": new_name,
            "max_bytes": max_bytes,
        });
        let endpoint = format!("/admin/v1/blobs/namespaces/{}", name);
        self.request(reqwest::Method::PATCH, &endpoint, Some(body)).await
    }

    /// Deletes a storage namespace and all contained objects.
    pub async fn delete_blob_namespace(&self, name: &str) -> Result<Value, String> {
        let endpoint = format!("/admin/v1/blobs/namespaces/{}", name);
        self.request(reqwest::Method::DELETE, &endpoint, None).await
    }

    /// Lists objects within a storage namespace.
    pub async fn list_blobs(
        &self,
        namespace: &str,
        prefix: Option<&str>,
        cursor: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Value, String> {
        let mut endpoint = format!("/api/v1/blobs/{}", namespace);
        let mut params = Vec::new();
        if let Some(p) = prefix {
            params.push(format!("prefix={}", urlencode(p)));
        }
        if let Some(c) = cursor {
            params.push(format!("cursor={}", urlencode(c)));
        }
        if let Some(l) = limit {
            params.push(format!("limit={}", l));
        }
        if !params.is_empty() {
            endpoint = format!("{}?{}", endpoint, params.join("&"));
        }
        self.request(reqwest::Method::GET, &endpoint, None).await
    }

    /// Uploads an object payload to a storage namespace.
    pub async fn put_blob(
        &self,
        namespace: &str,
        key: &str,
        data: Vec<u8>,
        content_type: Option<&str>,
        ttl: Option<u64>,
    ) -> Result<Value, String> {
        let sanitized_key = key.trim_start_matches('/');
        let url = format!("{}/api/v1/blobs/{}/{}", self.base_url, namespace, sanitized_key);
        let mut req = self.client.put(&url).body(data);

        if let Some(ref auth) = self.auth_key {
            req = req.header("X-Axiom-Key", auth);
            req = req.header("Authorization", format!("Bearer {}", auth));
        }

        if let Some(ct) = content_type {
            req = req.header("Content-Type", ct);
        } else {
            req = req.header("Content-Type", "application/octet-stream");
        }

        if let Some(t) = ttl {
            req = req.header("X-Axiom-TTL", t.to_string());
        }

        let res = req
            .send()
            .await
            .map_err(|e| format!("Upload request to '{}' failed: {}", url, e))?;

        let status = res.status();
        let json_resp: Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse response from '{}': {}", url, e))?;

        if !status.is_success() {
            let error_msg = json_resp
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Upload failed");
            return Err(format!("Server returned HTTP {}: {}", status.as_u16(), error_msg));
        }

        Ok(json_resp)
    }

    /// Downloads an object payload from a storage namespace.
    pub async fn get_blob(
        &self,
        namespace: &str,
        key: &str,
        ticket: Option<&str>,
    ) -> Result<(Vec<u8>, Option<String>), String> {
        let sanitized_key = key.trim_start_matches('/');
        let mut url = format!("{}/api/v1/blobs/{}/{}", self.base_url, namespace, sanitized_key);
        if let Some(t) = ticket {
            if t.contains("ticket_sig=") {
                url = format!("{}?{}", url, t);
            } else {
                url = format!("{}?ticket_sig={}", url, t);
            }
        }

        let mut req = self.client.get(&url);
        if let Some(ref auth) = self.auth_key {
            req = req.header("X-Axiom-Key", auth);
            req = req.header("Authorization", format!("Bearer {}", auth));
        }

        let res = req
            .send()
            .await
            .map_err(|e| format!("Download request to '{}' failed: {}", url, e))?;

        let status = res.status();
        if !status.is_success() {
            let err_body = res.text().await.unwrap_or_default();
            return Err(format!("Download failed with HTTP {}: {}", status.as_u16(), err_body));
        }

        let content_type = res
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .map(|s| s.to_string());

        let bytes = res
            .bytes()
            .await
            .map_err(|e| format!("Failed to read response bytes: {}", e))?
            .to_vec();

        Ok((bytes, content_type))
    }

    /// Queries headers and metadata for a storage object.
    pub async fn head_blob(&self, namespace: &str, key: &str) -> Result<Value, String> {
        let sanitized_key = key.trim_start_matches('/');
        let url = format!("{}/api/v1/blobs/{}/{}", self.base_url, namespace, sanitized_key);
        let mut req = self.client.head(&url);
        if let Some(ref auth) = self.auth_key {
            req = req.header("X-Axiom-Key", auth);
            req = req.header("Authorization", format!("Bearer {}", auth));
        }

        let res = req
            .send()
            .await
            .map_err(|e| format!("Head request to '{}' failed: {}", url, e))?;

        let status = res.status();
        if !status.is_success() {
            return Err(format!("Head request returned HTTP {}", status.as_u16()));
        }

        let mut headers_obj = serde_json::Map::new();
        for (k, v) in res.headers() {
            if let Ok(val) = v.to_str() {
                headers_obj.insert(k.as_str().to_string(), json!(val));
            }
        }

        Ok(json!({
            "status": status.as_u16(),
            "headers": headers_obj
        }))
    }

    /// Deletes an object from a storage namespace.
    pub async fn delete_blob(&self, namespace: &str, key: &str) -> Result<Value, String> {
        let sanitized_key = key.trim_start_matches('/');
        let endpoint = format!("/api/v1/blobs/{}/{}", namespace, sanitized_key);
        self.request(reqwest::Method::DELETE, &endpoint, None).await
    }

    /// Copies an object or directory prefix to a destination.
    pub async fn copy_blob(
        &self,
        src_ns: &str,
        src_key: &str,
        dest_key: &str,
        dest_ns: Option<&str>,
        is_prefix: bool,
    ) -> Result<Value, String> {
        let body = json!({
            "src_namespace": src_ns,
            "src_key": src_key,
            "dest_namespace": dest_ns.unwrap_or(src_ns),
            "dest_key": dest_key,
            "is_prefix": is_prefix,
        });
        self.request(reqwest::Method::POST, "/admin/v1/blobs/copy", Some(body)).await
    }

    /// Moves or renames an object or directory prefix.
    pub async fn move_blob(
        &self,
        src_ns: &str,
        src_key: &str,
        dest_key: &str,
        dest_ns: Option<&str>,
        is_prefix: bool,
    ) -> Result<Value, String> {
        let body = json!({
            "src_namespace": src_ns,
            "src_key": src_key,
            "dest_namespace": dest_ns.unwrap_or(src_ns),
            "dest_key": dest_key,
            "is_prefix": is_prefix,
        });
        self.request(reqwest::Method::POST, "/admin/v1/blobs/move", Some(body)).await
    }

    /// Deletes all objects matching a prefix within a namespace.
    pub async fn delete_blob_prefix(&self, namespace: &str, prefix: &str) -> Result<Value, String> {
        let body = json!({
            "namespace": namespace,
            "prefix": prefix,
        });
        self.request(reqwest::Method::POST, "/admin/v1/blobs/delete-prefix", Some(body)).await
    }

    /// Verifies cryptographic BLAKE3 integrity of an object on disk.
    pub async fn verify_blob(&self, namespace: &str, key: &str) -> Result<Value, String> {
        let sanitized_key = key.trim_start_matches('/');
        let endpoint = format!("/admin/v1/blobs/verify/{}/{}", namespace, sanitized_key);
        self.request(reqwest::Method::POST, &endpoint, None).await
    }

    /// Generates a cryptographic capability download ticket.
    pub async fn create_blob_ticket(
        &self,
        namespace: &str,
        key: &str,
        operation: Option<&str>,
        ttl: Option<u64>,
    ) -> Result<Value, String> {
        let endpoint = format!("/api/v1/blobs/{}/ticket", namespace);
        let body = json!({
            "key": key,
            "operation": operation,
            "ttl_seconds": ttl,
        });
        self.request(reqwest::Method::POST, &endpoint, Some(body)).await
    }

    // ─── Authentication & Setup Wizard API ─────────────────────────────────

    /// Authenticates administrative credentials and issues a session token.
    pub async fn login(&self, username: &str, password: &str) -> Result<Value, String> {
        let body = json!({
            "username": username,
            "password": password,
        });
        self.request(reqwest::Method::POST, "/admin/v1/auth/login", Some(body)).await
    }

    /// Revokes the active administrative session.
    pub async fn logout(&self) -> Result<Value, String> {
        self.request(reqwest::Method::POST, "/admin/v1/auth/logout", None).await
    }

    /// Checks if initial setup is required.
    pub async fn setup_begin(&self) -> Result<Value, String> {
        self.request(reqwest::Method::POST, "/admin/v1/setup/begin", None).await
    }

    /// Creates the initial administrative account during setup.
    pub async fn setup_account(&self, username: &str, password: &str) -> Result<Value, String> {
        let body = json!({
            "username": username,
            "password": password,
        });
        self.request(reqwest::Method::POST, "/admin/v1/setup/account", Some(body)).await
    }

    /// Connects and registers the first database during setup.
    pub async fn setup_database(&self, alias: &str, url: &str, engine: Option<&str>) -> Result<Value, String> {
        let body = json!({
            "alias": alias,
            "url": url,
            "engine": engine,
        });
        self.request(reqwest::Method::POST, "/admin/v1/setup/database", Some(body)).await
    }

    /// Finalizes and locks the setup wizard permanently.
    pub async fn setup_complete(&self) -> Result<Value, String> {
        self.request(reqwest::Method::POST, "/admin/v1/setup/complete", None).await
    }

    /// Lists administrative users via the Admin API.
    pub async fn list_users(&self) -> Result<Value, String> {
        self.request(reqwest::Method::GET, "/admin/v1/users", None).await
    }
}
