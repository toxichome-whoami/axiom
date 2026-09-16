pub mod models;

use base64::{engine::general_purpose, Engine as _};
use models::{DatabasesResponse, FetchRowsParams, FetchResponse, MutationResponse, QueryResponse, TablesResponse};
use reqwest::{Client, header};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::HashMap;

pub struct AxiomClient {
    client: Client,
    base_url: String,
}

impl AxiomClient {
    pub fn new(base_url: &str, key_name: &str, key_secret: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let auth_str = format!("{}:{}", key_name, key_secret);
        let token = general_purpose::STANDARD.encode(auth_str);

        let mut headers = header::HeaderMap::new();
        headers.insert("Content-Type", header::HeaderValue::from_static("application/json"));
        headers.insert("X-Axiom-Key", header::HeaderValue::from_str(&token)?);

        let client = Client::builder()
            .default_headers(headers)
            .build()?;

        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
        })
    }

    pub async fn list_databases(&self) -> Result<DatabasesResponse, reqwest::Error> {
        let url = format!("{}/api/v1/db/databases", self.base_url);
        self.client.get(&url).send().await?.json().await
    }

    pub async fn list_tables(&self, db: &str) -> Result<TablesResponse, reqwest::Error> {
        let url = format!("{}/api/v1/db/{}/tables", self.base_url, db);
        self.client.get(&url).send().await?.json().await
    }

    pub async fn fetch_rows<T: DeserializeOwned>(
        &self,
        db: &str,
        table: &str,
        params: Option<FetchRowsParams>,
    ) -> Result<FetchResponse<T>, reqwest::Error> {
        let mut url = format!("{}/api/v1/db/{}/{}/rows", self.base_url, db, table);

        if let Some(p) = params {
            let mut qs: Vec<String> = Vec::new();
            if let Some(limit) = p.limit {
                qs.push(format!("limit={}", limit));
            }
            if let Some(cursor) = &p.cursor {
                // percent-encode cursor value in case it contains special characters
                qs.push(format!("cursor={}", urlencoding::encode(cursor)));
            }
            if let Some(sort) = &p.sort {
                qs.push(format!("sort={}", urlencoding::encode(sort)));
            }
            if let Some(order) = &p.order {
                qs.push(format!("order={}", urlencoding::encode(order)));
            }
            if let Some(filter) = &p.filter {
                if let Ok(f) = serde_json::to_string(filter) {
                    // percent-encode the JSON string so {, }, :, " don't break the URL
                    qs.push(format!("filter={}", urlencoding::encode(&f)));
                }
            }
            if !qs.is_empty() {
                url.push('?');
                url.push_str(&qs.join("&"));
            }
        }

        self.client.get(&url).send().await?.json().await
    }

    pub async fn insert_rows<T: Serialize>(
        &self,
        db: &str,
        table: &str,
        rows: &[T],
    ) -> Result<MutationResponse, reqwest::Error> {
        let url = format!("{}/api/v1/db/{}/{}/rows", self.base_url, db, table);
        let payload = serde_json::json!({ "rows": rows });
        self.client.post(&url).json(&payload).send().await?.json().await
    }

    pub async fn update_rows(
        &self,
        db: &str,
        table: &str,
        filter: HashMap<String, serde_json::Value>,
        update: HashMap<String, serde_json::Value>,
    ) -> Result<MutationResponse, reqwest::Error> {
        let url = format!("{}/api/v1/db/{}/{}/rows", self.base_url, db, table);
        let payload = serde_json::json!({ "filter": filter, "update": update });
        self.client.patch(&url).json(&payload).send().await?.json().await
    }

    pub async fn delete_rows(
        &self,
        db: &str,
        table: &str,
        filter: HashMap<String, serde_json::Value>,
    ) -> Result<MutationResponse, reqwest::Error> {
        let url = format!("{}/api/v1/db/{}/{}/rows", self.base_url, db, table);
        let payload = serde_json::json!({ "filter": filter });
        self.client.delete(&url).json(&payload).send().await?.json().await
    }

    pub async fn query<T: DeserializeOwned>(
        &self,
        db: &str,
        sql: &str,
        params: Option<HashMap<String, serde_json::Value>>,
    ) -> Result<QueryResponse<T>, reqwest::Error> {
        let url = format!("{}/api/v1/db/{}/query", self.base_url, db);
        let mut payload = serde_json::json!({ "sql": sql });
        if let Some(p) = params {
            payload["params"] = serde_json::json!(p);
        }
        self.client.post(&url).json(&payload).send().await?.json().await
    }
}


