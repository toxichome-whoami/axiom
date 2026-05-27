use reqwest::{Client, Method, RequestBuilder};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AxiomAuthError {
    #[error("HTTP request failed: {0}")]
    RequestError(#[from] reqwest::Error),
    #[error("Missing access token for authenticated request")]
    MissingToken,
    #[error("API error [{status}]: {message}")]
    ApiError { status: u16, message: String },
}

#[derive(Clone)]
pub struct AxiomAuthClient {
    base_url: String,
    api_key: String,
    project_id: String,
    client: Client,
    access_token: Arc<Mutex<Option<String>>>,
    refresh_token: Arc<Mutex<Option<String>>>,
}

impl AxiomAuthClient {
    pub fn new(base_url: &str, api_key: &str, project_id: Option<&str>) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
            project_id: project_id.unwrap_or(api_key).to_string(),
            client: Client::new(),
            access_token: Arc::new(Mutex::new(None)),
            refresh_token: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_tokens(&self, access: Option<String>, refresh: Option<String>) {
        if let Some(a) = access {
            *self.access_token.lock().unwrap() = Some(a);
        }
        if let Some(r) = refresh {
            *self.refresh_token.lock().unwrap() = Some(r);
        }
    }

    fn build_request(
        &self,
        method: Method,
        path: &str,
        require_auth: bool,
    ) -> Result<RequestBuilder, AxiomAuthError> {
        let url = format!("{}/api/v1/auth/{}{}", self.base_url, self.project_id, path);
        let mut req = self
            .client
            .request(method, &url)
            .header("x-api-key", &self.api_key);

        if require_auth {
            let token_lock = self.access_token.lock().unwrap();
            if let Some(ref token) = *token_lock {
                req = req.header("Authorization", format!("Bearer {}", token));
            } else {
                return Err(AxiomAuthError::MissingToken);
            }
        }
        Ok(req)
    }

    async fn execute_request(
        &self,
        mut req_builder: RequestBuilder,
        method: Method,
        path: &str,
        require_auth: bool,
    ) -> Result<Value, AxiomAuthError> {
        let mut req = req_builder.try_clone().unwrap();
        let mut response = req.send().await?;

        if response.status() == 401 && require_auth {
            let r_token = { self.refresh_token.lock().unwrap().clone() };
            if r_token.is_some() {
                if let Ok(_) = self.refresh().await {
                    req_builder = self.build_request(method, path, require_auth)?;
                    req = req_builder.try_clone().unwrap();
                    response = req.send().await?;
                }
            }
        }

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            let parsed_error: Value = serde_json::from_str(&error_body).unwrap_or(Value::Null);
            let message = parsed_error
                .get("detail")
                .or(parsed_error.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or(&error_body)
                .to_string();

            return Err(AxiomAuthError::ApiError {
                status: status.as_u16(),
                message,
            });
        }

        let text = response.text().await?;
        if text.is_empty() {
            return Ok(Value::Object(Default::default()));
        }
        Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
        require_auth: bool,
    ) -> Result<Value, AxiomAuthError> {
        let mut req_builder = self.build_request(method.clone(), path, require_auth)?;
        if let Some(b) = body {
            req_builder = req_builder.json(b);
        }
        self.execute_request(req_builder, method, path, require_auth)
            .await
    }

    fn update_tokens_from_response(&self, res: &Value) {
        let access = res
            .get("access_token")
            .and_then(|v| v.as_str())
            .map(String::from);
        let refresh = res
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .map(String::from);
        self.set_tokens(access, refresh);
    }

    // --- PUBLIC ENDPOINTS ---

    pub async fn signup(
        &self,
        email: &str,
        password: &str,
        display_name: Option<&str>,
        avatar_url: Option<&str>,
        metadata: Option<Value>,
    ) -> Result<Value, AxiomAuthError> {
        let mut body = serde_json::json!({ "email": email, "password": password });
        if let Some(d) = display_name {
            body["display_name"] = d.into();
        }
        if let Some(a) = avatar_url {
            body["avatar_url"] = a.into();
        }
        if let Some(m) = metadata {
            body["metadata"] = m;
        }

        let res = self
            .request(Method::POST, "/signup", Some(&body), false)
            .await?;
        self.update_tokens_from_response(&res);
        Ok(res)
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "email": email, "password": password });
        let res = self
            .request(Method::POST, "/login", Some(&body), false)
            .await?;
        if !res
            .get("mfa_required")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            self.update_tokens_from_response(&res);
        }
        Ok(res)
    }

    pub async fn refresh(&self) -> Result<Value, AxiomAuthError> {
        let refresh_token = {
            let lock = self.refresh_token.lock().unwrap();
            lock.clone().ok_or(AxiomAuthError::MissingToken)?
        };

        let body = serde_json::json!({ "refresh_token": refresh_token });
        let req_builder = self
            .build_request(Method::POST, "/refresh", false)?
            .json(&body);
        let req = req_builder.try_clone().unwrap();
        let response = req.send().await?;

        let status = response.status();
        if !status.is_success() {
            return Err(AxiomAuthError::ApiError {
                status: status.as_u16(),
                message: "Refresh failed".to_string(),
            });
        }
        let text = response.text().await?;
        let res: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        self.update_tokens_from_response(&res);
        Ok(res)
    }

    pub async fn logout(&self) -> Result<(), AxiomAuthError> {
        let refresh_token = { self.refresh_token.lock().unwrap().clone() };
        if let Some(token) = refresh_token {
            let body = serde_json::json!({ "refresh_token": token });
            self.request(Method::POST, "/logout", Some(&body), true)
                .await?;
            self.set_tokens(None, None);
        }
        Ok(())
    }

    // --- PASSWORDLESS & OTP ---

    pub async fn send_magic_link(&self, email: &str) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "email": email });
        self.request(Method::POST, "/magic-link", Some(&body), false)
            .await
    }

    pub async fn verify_magic_link(&self, token: &str) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "token": token });
        let res = self
            .request(Method::POST, "/magic-link/verify", Some(&body), false)
            .await?;
        self.update_tokens_from_response(&res);
        Ok(res)
    }

    pub async fn send_otp(&self, email: &str) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "email": email });
        self.request(Method::POST, "/otp/send", Some(&body), false)
            .await
    }

    pub async fn verify_otp(&self, email: &str, code: &str) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "email": email, "code": code });
        let res = self
            .request(Method::POST, "/verify/otp", Some(&body), false)
            .await?;
        self.update_tokens_from_response(&res);
        Ok(res)
    }

    pub async fn resend(&self, email: &str, type_name: &str) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "email": email, "type": type_name });
        self.request(Method::POST, "/resend", Some(&body), false)
            .await
    }

    pub async fn verify_email(&self, token: &str) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "token": token });
        self.request(Method::POST, "/verify/email", Some(&body), false)
            .await
    }

    // --- PASSWORD ---

    pub async fn forgot_password(&self, email: &str) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "email": email });
        self.request(Method::POST, "/password/forgot", Some(&body), false)
            .await
    }

    pub async fn reset_password(
        &self,
        token: &str,
        new_password: &str,
    ) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "token": token, "new_password": new_password });
        self.request(Method::POST, "/password/reset", Some(&body), false)
            .await
    }

    // --- USER PROFILE ---

    pub async fn get_me(&self) -> Result<Value, AxiomAuthError> {
        self.request(Method::GET, "/user", None, true).await
    }

    pub async fn update_me(
        &self,
        display_name: Option<&str>,
        avatar_url: Option<&str>,
        metadata: Option<Value>,
    ) -> Result<Value, AxiomAuthError> {
        let mut body = serde_json::json!({});
        if let Some(d) = display_name {
            body["display_name"] = d.into();
        }
        if let Some(a) = avatar_url {
            body["avatar_url"] = a.into();
        }
        if let Some(m) = metadata {
            body["metadata"] = m;
        }
        self.request(Method::PATCH, "/user", Some(&body), true)
            .await
    }

    pub async fn delete_me(&self) -> Result<Value, AxiomAuthError> {
        self.request(Method::DELETE, "/user", None, true).await
    }

    pub async fn change_email(
        &self,
        new_email: &str,
        password: &str,
    ) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "new_email": new_email, "password": password });
        self.request(Method::POST, "/user/email", Some(&body), true)
            .await
    }

    pub async fn confirm_email_change(&self, token: &str) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "token": token });
        self.request(Method::POST, "/user/email/confirm", Some(&body), true)
            .await
    }

    pub async fn update_password(
        &self,
        current_password: &str,
        new_password: &str,
    ) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "current_password": current_password, "new_password": new_password });
        self.request(Method::POST, "/user/password", Some(&body), true)
            .await
    }

    // --- SESSIONS ---

    pub async fn get_sessions(&self) -> Result<Value, AxiomAuthError> {
        self.request(Method::GET, "/user/sessions", None, true)
            .await
    }

    pub async fn revoke_session(&self, session_id: &str) -> Result<Value, AxiomAuthError> {
        self.request(
            Method::DELETE,
            &format!("/user/sessions/{}", session_id),
            None,
            true,
        )
        .await
    }

    pub async fn revoke_all_sessions(&self) -> Result<Value, AxiomAuthError> {
        let res = self
            .request(Method::DELETE, "/user/sessions", None, true)
            .await?;
        self.set_tokens(None, None);
        Ok(res)
    }

    // --- TOTP / 2FA ---

    pub async fn totp_enroll(&self) -> Result<Value, AxiomAuthError> {
        self.request(Method::POST, "/totp/enroll", None, true).await
    }

    pub async fn totp_confirm(&self, code: &str) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "code": code });
        let res = self
            .request(Method::POST, "/totp/confirm", Some(&body), true)
            .await?;
        self.update_tokens_from_response(&res);
        Ok(res)
    }

    pub async fn totp_verify(&self, mfa_token: &str, code: &str) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "mfa_token": mfa_token, "code": code });
        let res = self
            .request(Method::POST, "/totp/verify", Some(&body), false)
            .await?;
        self.update_tokens_from_response(&res);
        Ok(res)
    }

    pub async fn totp_disable(&self, code: &str) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "code": code });
        self.request(Method::POST, "/totp/disable", Some(&body), true)
            .await
    }

    pub async fn totp_backup_verify(
        &self,
        mfa_token: &str,
        code: &str,
    ) -> Result<Value, AxiomAuthError> {
        let body = serde_json::json!({ "mfa_token": mfa_token, "code": code });
        let res = self
            .request(Method::POST, "/totp/backup/verify", Some(&body), false)
            .await?;
        self.update_tokens_from_response(&res);
        Ok(res)
    }

    pub async fn totp_backup_regenerate(&self) -> Result<Value, AxiomAuthError> {
        self.request(Method::GET, "/totp/backup/regenerate", None, true)
            .await
    }

    // --- ANONYMOUS AUTH ---

    pub async fn anonymous_login(&self) -> Result<Value, AxiomAuthError> {
        let res = self
            .request(Method::POST, "/anonymous", None, false)
            .await?;
        self.update_tokens_from_response(&res);
        Ok(res)
    }

    pub async fn upgrade_anonymous(
        &self,
        email: &str,
        password: &str,
        display_name: Option<&str>,
        avatar_url: Option<&str>,
    ) -> Result<Value, AxiomAuthError> {
        let mut body = serde_json::json!({ "email": email, "password": password });
        if let Some(d) = display_name {
            body["display_name"] = d.into();
        }
        if let Some(a) = avatar_url {
            body["avatar_url"] = a.into();
        }
        let res = self
            .request(Method::POST, "/anonymous/upgrade", Some(&body), true)
            .await?;
        self.update_tokens_from_response(&res);
        Ok(res)
    }
}
