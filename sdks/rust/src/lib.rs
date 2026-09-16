pub mod models;

use base64::{engine::general_purpose, Engine as _};
use models::{DatabasesResponse, QueryResponse};
use reqwest::{Client, header};
use serde::de::DeserializeOwned;
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

    pub async fn query<T: DeserializeOwned>(
        &self,
        db: &str,
        sql: &str,
        params: Option<HashMap<String, serde_json::Value>>,
    ) -> Result<QueryResponse<T>, reqwest::Error> {
        let url = format!("{}/api/v1/db/{}/query", self.base_url, db);
        
        let mut payload = HashMap::new();
        payload.insert("sql".to_string(), serde_json::json!(sql));
        if let Some(p) = params {
            payload.insert("params".to_string(), serde_json::json!(p));
        }

        self.client.post(&url).json(&payload).send().await?.json().await
    }

    pub async fn list_tables(&self, db: &str) -> Result<models::TablesResponse, reqwest::Error> {
        let url = format!("{}/api/v1/db/{}/tables", self.base_url, db);
        self.client.get(&url).send().await?.json().await
    }

    pub async fn fetch_rows<T: DeserializeOwned>(
        &self,
        db: &str,
        table: &str,
        params: Option<HashMap<String, String>>,
    ) -> Result<models::FetchResponse<T>, reqwest::Error> {
        let mut url = format!("{}/api/v1/db/{}/{}/rows", self.base_url, db, table);
        
        if let Some(p) = params {
            let qs: Vec<String> = p.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
            if !qs.is_empty() {
                url.push('?');
                url.push_str(&qs.join("&"));
            }
        }

        self.client.get(&url).send().await?.json().await
    }

    pub async fn insert_rows<T: serde::Serialize>(
        &self,
        db: &str,
        table: &str,
        rows: &Vec<T>,
    ) -> Result<models::MutationResponse, reqwest::Error> {
        let url = format!("{}/api/v1/db/{}/{}/rows", self.base_url, db, table);
        self.client.post(&url).json(rows).send().await?.json().await
    }

    pub async fn update_rows(
        &self,
        db: &str,
        table: &str,
        filter: HashMap<String, serde_json::Value>,
        update: HashMap<String, serde_json::Value>,
    ) -> Result<models::MutationResponse, reqwest::Error> {
        let url = format!("{}/api/v1/db/{}/{}/rows", self.base_url, db, table);
        let mut payload = HashMap::new();
        payload.insert("filter", filter);
        payload.insert("update", update);
        
        self.client.patch(&url).json(&payload).send().await?.json().await
    }

    pub async fn delete_rows(
        &self,
        db: &str,
        table: &str,
        filter: HashMap<String, serde_json::Value>,
    ) -> Result<models::MutationResponse, reqwest::Error> {
        let url = format!("{}/api/v1/db/{}/{}/rows", self.base_url, db, table);
        self.client.delete(&url).json(&filter).send().await?.json().await
    }
}
