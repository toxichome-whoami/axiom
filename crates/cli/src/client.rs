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

pub struct AdminClient {
    base_url: String,
    auth_key: Option<String>,
    client: Client,
}

impl AdminClient {
    /// Constructs a new AdminClient instance.
    /// CONTRACT:
    ///  - Precondition: `base_url` is a valid HTTP/HTTPS URL string.
    ///  - Returns initialized `AdminClient`.
    ///  - Idempotent: Yes.
    pub fn new(base_url: &str, auth_key: Option<String>) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            auth_key,
            client,
        }
    }

    /// Sends an HTTP request and parses the JSON response envelope.
    async fn request(&self, method: reqwest::Method, endpoint: &str, body: Option<Value>) -> Result<Value, String> {
        let url = format!("{}{}", self.base_url, endpoint);
        let mut req = self.client.request(method, &url);

        if let Some(ref key) = self.auth_key {
            req = req.header("X-Axiom-Key", key);
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
}
