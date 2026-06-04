use axum::{
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Redirect},
};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;

use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;

use super::user_store::{get_pool, get_user_by_oauth, link_oauth_account, get_user_by_email, create_user};
use super::token_engine;

#[derive(Deserialize)]
pub struct OAuthLoginQuery {
    pub project_id: Option<String>,
}

pub async fn handler_oauth_login(
    Path(provider): Path<String>,
    Query(query): Query<OAuthLoginQuery>,
) -> Result<impl IntoResponse, AxiomError> {
    let config = ConfigManager::get();
    let project_id = query.project_id.unwrap_or_else(|| "default".to_string());
    let p_config = config
        .auth
        .project
        .get(&project_id)
        .ok_or_else(|| AxiomError::new("AUTH_CONFIG", "Project not found", StatusCode::NOT_FOUND))?;

    let (client_id, redirect_uri, auth_url, scopes) = match provider.as_str() {
        "google" => {
            if !p_config.oauth_google.enabled {
                return Err(AxiomError::new("OAUTH_DISABLED", "Google OAuth is disabled", StatusCode::BAD_REQUEST));
            }
            (
                &p_config.oauth_google.client_id,
                &p_config.oauth_google.redirect_uri,
                "https://accounts.google.com/o/oauth2/v2/auth",
                "email profile",
            )
        }
        "github" => {
            if !p_config.oauth_github.enabled {
                return Err(AxiomError::new("OAUTH_DISABLED", "GitHub OAuth is disabled", StatusCode::BAD_REQUEST));
            }
            (
                &p_config.oauth_github.client_id,
                &p_config.oauth_github.redirect_uri,
                "https://github.com/login/oauth/authorize",
                "user:email",
            )
        }
        _ => return Err(AxiomError::new("OAUTH_UNSUPPORTED", "Unsupported provider", StatusCode::BAD_REQUEST)),
    };

    let state = format!("{}:{}", project_id, uuid::Uuid::new_v4());

    let url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}",
        auth_url, client_id, redirect_uri, scopes, state
    );

    Ok(Redirect::temporary(&url))
}

#[derive(Deserialize)]
pub struct OAuthCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize, Debug)]
struct GoogleTokenResponse {
    access_token: String,
}

#[derive(Deserialize, Debug)]
struct GoogleUserResponse {
    id: String,
    email: String,
}

#[derive(Deserialize, Debug)]
struct GithubTokenResponse {
    access_token: String,
}

#[derive(Deserialize, Debug)]
struct GithubUserResponse {
    id: i64,
}

#[derive(Deserialize, Debug)]
struct GithubEmailResponse {
    email: String,
    primary: bool,
}

pub async fn handler_oauth_callback(
    Path(provider): Path<String>,
    Query(query): Query<OAuthCallbackQuery>,
) -> Result<impl IntoResponse, AxiomError> {
    let config = ConfigManager::get();
    if let Some(err) = query.error {
        return Err(AxiomError::new("OAUTH_ERROR", &err, StatusCode::BAD_REQUEST));
    }

    let code = query.code.ok_or_else(|| AxiomError::new("OAUTH_ERROR", "Missing code", StatusCode::BAD_REQUEST))?;
    let state = query.state.unwrap_or_else(|| "default:".to_string());

    let parts: Vec<&str> = state.split(':').collect();
    let project_id = parts.first().unwrap_or(&"default").to_string();

    let p_config = config
        .auth
        .project
        .get(&project_id)
        .ok_or_else(|| AxiomError::new("AUTH_CONFIG", "Project not found", StatusCode::NOT_FOUND))?;

    let client = reqwest::Client::new();
    let (oauth_user_id, oauth_email) = match provider.as_str() {
        "google" => {
            let body = format!(
                "client_id={}&client_secret={}&code={}&grant_type=authorization_code&redirect_uri={}",
                p_config.oauth_google.client_id,
                p_config.oauth_google.client_secret,
                code,
                p_config.oauth_google.redirect_uri
            );

            let token_res = client.post("https://oauth2.googleapis.com/token")
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(body)
                .send()
                .await
                .map_err(|e: reqwest::Error| AxiomError::new("OAUTH_ERROR", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))?;

            if !token_res.status().is_success() {
                return Err(AxiomError::new("OAUTH_ERROR", "Failed to exchange token", StatusCode::BAD_REQUEST));
            }

            let token_data: GoogleTokenResponse = token_res.json::<GoogleTokenResponse>().await.map_err(|_| AxiomError::new("OAUTH_ERROR", "Invalid token response", StatusCode::INTERNAL_SERVER_ERROR))?;

            let user_res = client.get("https://www.googleapis.com/oauth2/v2/userinfo")
                .bearer_auth(token_data.access_token)
                .send()
                .await
                .map_err(|e| AxiomError::new("OAUTH_ERROR", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))?;

            let user_data: GoogleUserResponse = user_res.json().await.map_err(|_| AxiomError::new("OAUTH_ERROR", "Invalid user response", StatusCode::INTERNAL_SERVER_ERROR))?;

            (user_data.id, user_data.email)
        }
        "github" => {
            let token_res = client.post("https://github.com/login/oauth/access_token")
                .header("Accept", "application/json")
                .json(&json!({
                    "client_id": p_config.oauth_github.client_id,
                    "client_secret": p_config.oauth_github.client_secret,
                    "code": code,
                    "redirect_uri": p_config.oauth_github.redirect_uri,
                }))
                .send()
                .await
                .map_err(|e: reqwest::Error| AxiomError::new("OAUTH_ERROR", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))?;

            if !token_res.status().is_success() {
                return Err(AxiomError::new("OAUTH_ERROR", "Failed to exchange token", StatusCode::BAD_REQUEST));
            }

            let token_data: GithubTokenResponse = token_res.json::<GithubTokenResponse>().await.map_err(|_| AxiomError::new("OAUTH_ERROR", "Invalid token response", StatusCode::INTERNAL_SERVER_ERROR))?;

            let user_res = client.get("https://api.github.com/user")
                .header("User-Agent", "Axiom-Auth")
                .bearer_auth(&token_data.access_token)
                .send()
                .await
                .map_err(|e| AxiomError::new("OAUTH_ERROR", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))?;

            let user_data: GithubUserResponse = user_res.json().await.map_err(|_| AxiomError::new("OAUTH_ERROR", "Invalid user response", StatusCode::INTERNAL_SERVER_ERROR))?;

            let emails_res = client.get("https://api.github.com/user/emails")
                .header("User-Agent", "Axiom-Auth")
                .bearer_auth(&token_data.access_token)
                .send()
                .await
                .map_err(|e| AxiomError::new("OAUTH_ERROR", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))?;

            let emails: Vec<GithubEmailResponse> = emails_res.json().await.map_err(|_| AxiomError::new("OAUTH_ERROR", "Invalid email response", StatusCode::INTERNAL_SERVER_ERROR))?;
            let primary_email = emails.into_iter().find(|e| e.primary).ok_or_else(|| AxiomError::new("OAUTH_ERROR", "No primary email found", StatusCode::BAD_REQUEST))?;

            (user_data.id.to_string(), primary_email.email)
        }
        _ => return Err(AxiomError::new("OAUTH_UNSUPPORTED", "Unsupported provider", StatusCode::BAD_REQUEST)),
    };

    let pool = get_pool(&project_id).await?;

    // Check if oauth account is already linked
    let uid = if let Some(user) = get_user_by_oauth(&pool, &provider, &oauth_user_id).await {
        user["uid"].as_str().unwrap_or_default().to_string()
    } else {
        // Not linked, check if email exists
        if let Some(user) = get_user_by_email(&pool, &oauth_email).await {
            let existing_uid = user["uid"].as_str().unwrap_or_default().to_string();
            link_oauth_account(&pool, &existing_uid, &provider, &oauth_user_id).await?;
            existing_uid
        } else {
            // Create entirely new user
            let new_uid = create_user(&pool, Some(&oauth_email), None, true, false).await?;
            link_oauth_account(&pool, &new_uid, &provider, &oauth_user_id).await?;
            new_uid
        }
    };

    // Generate Axiom Tokens
    let access_ttl = p_config.access_token_ttl as i64;
    let access_token = token_engine::create_access_token(
        &project_id,
        &uid,
        &oauth_email,
        true, // email_verified
        false, // is_anonymous
        false, // mfa
        access_ttl,
        HashMap::new()
    ).await.map_err(|e| AxiomError::new("AUTH_TOKEN_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    let refresh_token = token_engine::generate_refresh_token();

    let family_id = uuid::Uuid::new_v4().to_string();
    let hashed_refresh = super::user_store::hash_sha256(&refresh_token);

    let expires = super::user_store::utc_now_iso(); // In reality, we'd add the TTL

    super::user_store::issue_refresh_token(
        &pool,
        &uid,
        &hashed_refresh,
        &family_id,
        &expires,
        None,
        None,
    ).await?;

    super::user_store::record_login(&pool, &uid).await?;

    // Redirect back to frontend success URL (with tokens in hash fragment)
    let callback_redirect = if p_config.callback_url.is_empty() {
        format!("/#access_token={}&refresh_token={}", access_token, refresh_token)
    } else {
        format!("{}#access_token={}&refresh_token={}", p_config.callback_url, access_token, refresh_token)
    };

    Ok(Redirect::temporary(&callback_redirect))
}
