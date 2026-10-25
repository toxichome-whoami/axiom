/*
 * Command-line interface dispatcher coordinating argument parsing, API client calls, and database tasks.
 * Owned by: crates/cli
 * Key deps: clap, rpassword, toml, crate::commands, crate::client, axiom_metadata::MetadataStore
 * Invariants: User management runs out-of-band directly against axiom.db; all other commands communicate via HTTP.
 * Last structural change: Updated CLI features (audit, reload, test-url, concurrent bench, doctor probes, jsonl).
 */

use clap::Parser;
use serde_json::{json, Value};
use std::path::Path;

use crate::client::{clear_saved_session, save_session, AdminClient};
use crate::commands::{
    BlobCommands, BlobNsCommands, CacheCommands, Cli, ClusterCommands, Commands, ConfigCommands,
    DbCommands, KeyCommands, RoleCommands, SetupCommands, UserCommands,
};
use axiom_core::ConfigManager;
use axiom_metadata::MetadataStore;

/// Output representation mode requested by caller flags.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum OutputFormat {
    Table,
    Json,
    Jsonl,
}

/// Helper to format data according to requested output format.
/// Returns serialized String for Json/Jsonl or None if Table format is active.
pub fn format_output<T: serde::Serialize>(
    format: OutputFormat,
    data: &T,
) -> Result<Option<String>, serde_json::Error> {
    match format {
        OutputFormat::Json => Ok(Some(serde_json::to_string_pretty(data)?)),
        OutputFormat::Jsonl => Ok(Some(serde_json::to_string(data)?)),
        OutputFormat::Table => Ok(None),
    }
}

/// Helper to print output according to requested format.
/// For Json and Jsonl, prints the serialized payload.
/// For Table, executes the provided render closure.
pub fn render_output<T: serde::Serialize>(
    format: OutputFormat,
    data: &T,
    table_fn: impl FnOnce(&T),
) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(formatted) = format_output(format, data)? {
        println!("{}", formatted);
    } else {
        table_fn(data);
    }
    Ok(())
}

/// Dispatches CLI commands provided via command-line arguments.
/// CONTRACT:
///  - Returns `Ok(false)` if the server daemon should start.
///  - Returns `Ok(true)` if a CLI command was executed and the process should terminate.
///  - Returns `Err` on unrecoverable command or network failure.
///  - Side effects: Modifies console output; may modify metadata store or make HTTP requests.
pub async fn run() -> Result<bool, Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    // Fast-path: If no subcommands or flags were given, continue to launch server daemon
    if args.len() <= 1 {
        return Ok(false);
    }

    // Intercept version flag handled upstream
    if args.iter().any(|arg| arg == "--version" || arg == "-v") {
        return Ok(false);
    }

    let cli = Cli::parse();
    let format = if cli.jsonl {
        OutputFormat::Jsonl
    } else if cli.json {
        OutputFormat::Json
    } else {
        OutputFormat::Table
    };

    match cli.command {
        None | Some(Commands::Server(_)) => Ok(false),

        Some(Commands::User { command }) => {
            handle_user_command(command, format).await?;
            Ok(true)
        }

        Some(Commands::Key { command }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_key_command(client, command, format).await?;
            Ok(true)
        }

        Some(Commands::Role { command }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_role_command(client, command, format).await?;
            Ok(true)
        }

        Some(Commands::Db { command }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_db_command(client, command, format).await?;
            Ok(true)
        }

        Some(Commands::Blob { command }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_blob_command(client, command, format).await?;
            Ok(true)
        }

        Some(Commands::Login { username, password }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_login_command(client, username, password, format).await?;
            Ok(true)
        }

        Some(Commands::Logout) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_logout_command(client, format).await?;
            Ok(true)
        }

        Some(Commands::Setup { command }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_setup_command(client, command, format).await?;
            Ok(true)
        }

        Some(Commands::Cache { command }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_cache_command(client, command, format).await?;
            Ok(true)
        }

        Some(Commands::Audit { limit, offset }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_audit_command(client, limit, offset, format).await?;
            Ok(true)
        }

        Some(Commands::Reload) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_reload_command(client, format).await?;
            Ok(true)
        }

        Some(Commands::Health) => {
            let client = AdminClient::new(&cli.url, cli.key);
            let resp = if client.auth_key().is_some() {
                match client.get_admin_health().await {
                    Ok(admin_health) => admin_health,
                    Err(_) => client.get_health().await?,
                }
            } else {
                client.get_health().await?
            };

            render_output(format, &resp, |r| {
                let data = r.get("data");
                if let Some(d) = data {
                    let status = d.get("status").and_then(|s| s.as_str()).unwrap_or("ONLINE");
                    let uptime = d
                        .get("uptime_seconds")
                        .and_then(|u| u.as_i64())
                        .unwrap_or(0);
                    println!("Axiom Gateway Health: {}", status.to_uppercase());
                    println!("{:-<50}", "");
                    println!("Uptime:       {} seconds", uptime);
                    if let Some(sys) = d.get("system") {
                        let cpu = sys
                            .get("cpu_percent")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0);
                        let mem = sys
                            .get("memory_used_mb")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0);
                        println!("System:       CPU: {:.1}% | Memory: {} MB", cpu, mem);
                    }
                    if let Some(dbs) = d.get("databases").and_then(|v| v.as_object()) {
                        if !dbs.is_empty() {
                            println!("\nDatabases:");
                            for (alias, st) in dbs {
                                let st_str = st.as_str().unwrap_or("unknown");
                                println!("  - {:<18}: {}", alias, st_str.to_uppercase());
                            }
                        }
                    }
                } else {
                    println!("Axiom Gateway Health: ONLINE");
                    if let Some(status) = resp.get("status") {
                        println!("Status: {}", status);
                    }
                }
            })?;
            Ok(true)
        }

        Some(Commands::Metrics) => {
            let client = AdminClient::new(&cli.url, cli.key);
            let metrics = client.get_metrics().await?;
            let payload = json!({ "metrics": metrics });
            render_output(format, &payload, |_| {
                print!("{}", metrics);
            })?;
            Ok(true)
        }

        Some(Commands::Benchmark {
            requests,
            concurrency,
        }) => {
            run_benchmark(&cli.url, cli.key.as_deref(), requests, concurrency, format).await?;
            Ok(true)
        }

        Some(Commands::Doctor) => {
            run_doctor(&cli.url, format).await?;
            Ok(true)
        }

        Some(Commands::Cluster { command }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_cluster_command(client, command, format).await?;
            Ok(true)
        }

        Some(Commands::Config { command }) => {
            handle_config_command(command, format).await?;
            Ok(true)
        }
    }
}

// ─── Human User Command Handlers ───────────────────────────────────────────
// Direct manipulation of `axiom.db`. Does NOT require a running HTTP server,
// allowing operators to bootstrap human admins safely on headless environments.

async fn init_cli_metadata(config_path: Option<&str>) -> Result<(), String> {
    if let Some(path) = config_path {
        let _ = ConfigManager::load(path);
    } else {
        let _ = ConfigManager::load("config.toml");
    }
    let cfg = ConfigManager::get();
    MetadataStore::init(&cfg.metadata.url, &cfg.metadata.token).await
}

async fn handle_user_command(
    command: UserCommands,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    let cfg_path = match &command {
        UserCommands::Add { config, .. } => config.as_deref(),
        UserCommands::Update { config, .. } => config.as_deref(),
        UserCommands::List { config } => config.as_deref(),
        UserCommands::Remove { config, .. } => config.as_deref(),
    };
    init_cli_metadata(cfg_path)
        .await
        .map_err(|e| format!("Failed to connect to metadata store: {}", e))?;

    match command {
        UserCommands::Add {
            username,
            email,
            password,
            ..
        } => {
            let pass = match password {
                Some(p) if !p.is_empty() => p,
                _ => {
                    eprint!("Enter password for admin '{}': ", username);
                    rpassword::read_password()?
                }
            };

            if pass.trim().is_empty() {
                return Err("Password cannot be empty".into());
            }

            MetadataStore::create_user(&username, email.as_deref(), &pass)
                .await
                .map_err(|e| format!("User creation failed: {}", e))?;

            let res = json!({
                "success": true,
                "data": { "username": username, "message": "Admin user created successfully" }
            });

            render_output(format, &res, |_| {
                println!("Admin user '{}' created successfully.", username);
            })?;
        }

        UserCommands::Update {
            username,
            email,
            password,
            ..
        } => {
            let pass_input = match password {
                Some(p) if !p.trim().is_empty() => Some(p),
                _ if email.is_none() => {
                    eprint!("Enter new password for admin '{}': ", username);
                    let p = rpassword::read_password()?;
                    if p.trim().is_empty() {
                        None
                    } else {
                        Some(p)
                    }
                }
                _ => None,
            };

            let email_opt = email.as_deref().map(Some);
            let updated = MetadataStore::update_user(&username, email_opt, pass_input.as_deref())
                .await
                .map_err(|e| format!("User update failed: {}", e))?;

            if !updated {
                return Err(format!("User '{}' not found", username).into());
            }

            let res = json!({
                "success": true,
                "data": { "username": username, "message": "Admin user updated successfully" }
            });

            render_output(format, &res, |_| {
                println!("Admin user '{}' updated successfully.", username);
            })?;
        }

        UserCommands::List { .. } => {
            let users = MetadataStore::list_users()
                .await
                .map_err(|e| format!("Failed to list users: {}", e))?;

            let res = json!({
                "success": true,
                "data": { "users": users }
            });

            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&res)?);
            } else if format == OutputFormat::Jsonl {
                for u in &users {
                    println!("{}", serde_json::to_string(u)?);
                }
            } else {
                println!(
                    "{:<6} {:<20} {:<28} {:<20}",
                    "ID", "USERNAME", "EMAIL", "CREATED AT (UNIX)"
                );
                println!("{:-<78}", "");
                for u in users {
                    println!(
                        "{:<6} {:<20} {:<28} {:<20}",
                        u.id,
                        u.username,
                        u.email.as_deref().unwrap_or("-"),
                        u.created_at
                    );
                }
            }
        }

        UserCommands::Remove { username, .. } => {
            let deleted = MetadataStore::delete_user(&username)
                .await
                .map_err(|e| format!("Failed to delete user: {}", e))?;

            if !deleted {
                return Err(format!("User '{}' not found", username).into());
            }

            let res = json!({
                "success": true,
                "data": { "username": username, "message": "User deleted successfully" }
            });

            render_output(format, &res, |_| {
                println!("User '{}' deleted successfully.", username);
            })?;
        }
    }

    Ok(())
}

// ─── API Key Command Handlers ──────────────────────────────────────────────

async fn handle_key_command(
    client: AdminClient,
    command: KeyCommands,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        KeyCommands::Create {
            name,
            role,
            secret,
            rate_limit,
            expires_at,
        } => {
            let resp = client
                .create_key(
                    &name,
                    role.as_deref(),
                    secret.as_deref(),
                    rate_limit,
                    expires_at,
                )
                .await?;

            render_output(format, &resp, |_| {
                println!("API Key '{}' created successfully!\n", name);
                if let Some(data) = resp.get("data") {
                    if let Some(token) = data.get("token").and_then(|t| t.as_str()) {
                        println!("TOKEN:  {}", token);
                    }
                    if let Some(sec) = data.get("secret").and_then(|s| s.as_str()) {
                        println!("SECRET: {}", sec);
                    }
                    println!("\nKeep this token secure; the secret is hashed with BLAKE3 and cannot be recovered.");
                }
            })?;
        }

        KeyCommands::List => {
            let resp = client.list_keys().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                if let Some(keys) = resp
                    .get("data")
                    .and_then(|d| d.get("keys"))
                    .and_then(|k| k.as_array())
                {
                    for k in keys {
                        println!("{}", serde_json::to_string(k)?);
                    }
                } else {
                    println!("{}", serde_json::to_string(&resp)?);
                }
            } else {
                println!(
                    "{:<24} {:<20} {:<12} {:<20}",
                    "KEY NAME", "ROLE", "RATE LIMIT", "CREATED AT"
                );
                println!("{:-<80}", "");
                if let Some(keys) = resp
                    .get("data")
                    .and_then(|d| d.get("keys"))
                    .and_then(|k| k.as_array())
                {
                    for k in keys {
                        let name = k.get("name").and_then(|n| n.as_str()).unwrap_or("-");
                        let role = k
                            .get("role_name")
                            .and_then(|r| r.as_str())
                            .unwrap_or("none");
                        let rl = k.get("rate_limit").and_then(|r| r.as_i64()).unwrap_or(0);
                        let created = k.get("created_at").and_then(|c| c.as_i64()).unwrap_or(0);
                        println!("{:<24} {:<20} {:<12} {:<20}", name, role, rl, created);
                    }
                }
            }
        }

        KeyCommands::Rotate { name } => {
            let resp = client.rotate_key(&name).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("API Key '{}' rotated successfully!\n", name);
                if let Some(data) = resp.get("data") {
                    if let Some(token) = data.get("token").and_then(|t| t.as_str()) {
                        println!("NEW TOKEN:  {}", token);
                    }
                    if let Some(sec) = data.get("secret").and_then(|s| s.as_str()) {
                        println!("NEW SECRET: {}", sec);
                    }
                    println!("\nUpdate your client applications immediately; the previous secret is revoked.");
                }
            }
        }

        KeyCommands::Update {
            name,
            role,
            rate_limit,
            expires_at,
        } => {
            let resp = client
                .update_key(&name, role.as_deref(), rate_limit, expires_at)
                .await?;
            render_output(format, &resp, |_| {
                println!("API Key '{}' updated successfully.", name);
            })?;
        }

        KeyCommands::Remove { name } => {
            let resp = client.delete_key(&name).await?;
            render_output(format, &resp, |_| {
                println!("API Key '{}' deleted successfully.", name);
            })?;
        }
    }
    Ok(())
}

// ─── Role Command Handlers ─────────────────────────────────────────────────

async fn handle_role_command(
    client: AdminClient,
    command: RoleCommands,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        RoleCommands::Create {
            name,
            description,
            permissions,
        } => {
            let perms_val: Value = match permissions {
                Some(p_str) => serde_json::from_str(&p_str)
                    .map_err(|e| format!("Invalid JSON permissions array: {}", e))?,
                None => json!([]),
            };

            let resp = client
                .create_role(&name, description.as_deref(), perms_val)
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("Role '{}' created successfully.", name);
            }
        }

        RoleCommands::List => {
            let resp = client.list_roles().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                if let Some(roles) = resp
                    .get("data")
                    .and_then(|d| d.get("roles"))
                    .and_then(|r| r.as_array())
                {
                    for r in roles {
                        println!("{}", serde_json::to_string(r)?);
                    }
                } else {
                    println!("{}", serde_json::to_string(&resp)?);
                }
            } else {
                println!(
                    "{:<20} {:<32} {:<12}",
                    "ROLE NAME", "DESCRIPTION", "PERMISSIONS"
                );
                println!("{:-<72}", "");
                if let Some(roles) = resp
                    .get("data")
                    .and_then(|d| d.get("roles"))
                    .and_then(|r| r.as_array())
                {
                    for r in roles {
                        let name = r.get("name").and_then(|n| n.as_str()).unwrap_or("-");
                        let desc = r.get("description").and_then(|d| d.as_str()).unwrap_or("");
                        let perm_count = r
                            .get("permissions")
                            .and_then(|p| p.as_array())
                            .map(|p| p.len())
                            .unwrap_or(0);
                        println!("{:<20} {:<32} {:<12}", name, desc, perm_count);
                    }
                }
            }
        }

        RoleCommands::Update {
            name,
            description,
            permissions,
        } => {
            let perms_val: Option<Value> = match permissions {
                Some(p_str) => Some(
                    serde_json::from_str(&p_str)
                        .map_err(|e| format!("Invalid JSON permissions array: {}", e))?,
                ),
                None => None,
            };

            let resp = client
                .update_role(&name, description.as_deref(), perms_val)
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("Role '{}' updated successfully.", name);
            }
        }

        RoleCommands::Remove { name } => {
            let resp = client.delete_role(&name).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("Role '{}' deleted successfully.", name);
            }
        }
    }
    Ok(())
}

// ─── Database Target Command Handlers ──────────────────────────────────────

async fn handle_db_command(
    client: AdminClient,
    command: DbCommands,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        DbCommands::Add {
            alias,
            connection_url,
            engine,
            pool_min,
            pool_max,
        } => {
            let resp = client
                .add_database(
                    &alias,
                    &connection_url,
                    engine.as_deref(),
                    pool_min,
                    pool_max,
                )
                .await?;

            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("Database target '{}' configured successfully.", alias);
            }
        }

        DbCommands::Update {
            alias,
            new_alias,
            connection_url,
            engine,
            pool_min,
            pool_max,
        } => {
            let resp = client
                .update_database(
                    &alias,
                    new_alias.as_deref(),
                    connection_url.as_deref(),
                    engine.as_deref(),
                    pool_min,
                    pool_max,
                )
                .await?;

            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let effective_alias = new_alias.unwrap_or(alias);
                println!(
                    "Database target '{}' updated successfully.",
                    effective_alias
                );
            }
        }

        DbCommands::List => {
            let resp = client.list_databases().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                if let Some(dbs) = resp
                    .get("data")
                    .and_then(|d| d.get("databases"))
                    .and_then(|d| d.as_array())
                {
                    for db in dbs {
                        println!("{}", serde_json::to_string(db)?);
                    }
                } else {
                    println!("{}", serde_json::to_string(&resp)?);
                }
            } else {
                println!(
                    "{:<20} {:<16} {:<10} {:<10}",
                    "ALIAS", "ENGINE", "POOL MIN", "POOL MAX"
                );
                println!("{:-<60}", "");
                if let Some(dbs) = resp
                    .get("data")
                    .and_then(|d| d.get("databases"))
                    .and_then(|d| d.as_array())
                {
                    for db in dbs {
                        let alias = db.get("alias").and_then(|a| a.as_str()).unwrap_or("-");
                        let engine = db.get("engine").and_then(|e| e.as_str()).unwrap_or("-");
                        let p_min = db.get("pool_min").and_then(|p| p.as_i64()).unwrap_or(1);
                        let p_max = db.get("pool_max").and_then(|p| p.as_i64()).unwrap_or(10);
                        println!("{:<20} {:<16} {:<10} {:<10}", alias, engine, p_min, p_max);
                    }
                }
            }
        }

        DbCommands::Test { alias } => {
            let resp = client.test_database(&alias).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let data = resp.get("data").cloned().unwrap_or(resp);
                let dialect = data
                    .get("dialect")
                    .and_then(|d| d.as_str())
                    .unwrap_or("unknown");
                let status = data.get("status").and_then(|s| s.as_str()).unwrap_or("ok");
                let msg = data.get("message").and_then(|m| m.as_str()).unwrap_or("");
                println!("Database Connection Probe for '{}'", alias);
                println!("{:-<45}", "");
                println!("Status:   {}", status);
                println!("Dialect:  {}", dialect);
                println!("Message:  {}", msg);
            }
        }

        DbCommands::TestUrl { url, alias } => {
            let resp = client.test_database_url(&url, alias.as_deref()).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let data = resp.get("data").cloned().unwrap_or(resp);
                let dialect = data
                    .get("dialect")
                    .and_then(|d| d.as_str())
                    .unwrap_or("unknown");
                let status = data
                    .get("status")
                    .and_then(|s| s.as_str())
                    .unwrap_or("connected");
                let msg = data
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Connection test successful");
                println!("Raw Database URL Connectivity Probe");
                println!("{:-<45}", "");
                println!("Status:   {}", status);
                println!("Dialect:  {}", dialect);
                println!("Message:  {}", msg);
            }
        }

        DbCommands::Remove { alias } => {
            let resp = client.delete_database(&alias).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("Database target '{}' removed successfully.", alias);
            }
        }

        DbCommands::Query {
            alias,
            sql,
            params,
            timeout,
        } => {
            let params_val: Option<Value> = match params {
                Some(p_str) => Some(
                    serde_json::from_str(&p_str)
                        .map_err(|e| format!("Invalid JSON parameters: {}", e))?,
                ),
                None => None,
            };

            let resp = client
                .query_database(&alias, &sql, params_val, timeout)
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                if let Some(rows) = resp.get("rows").and_then(|r| r.as_array()) {
                    for row in rows {
                        println!("{}", serde_json::to_string(row)?);
                    }
                } else if let Some(rows) = resp
                    .get("data")
                    .and_then(|d| d.get("rows"))
                    .and_then(|r| r.as_array())
                {
                    for row in rows {
                        println!("{}", serde_json::to_string(row)?);
                    }
                } else {
                    println!("{}", serde_json::to_string(&resp)?);
                }
            } else {
                render_query_results_table(&resp);
            }
        }

        DbCommands::Tables {
            alias,
            cursor,
            limit,
        } => {
            let resp = client.list_database_tables(&alias, cursor, limit).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                if let Some(tables) = resp
                    .get("data")
                    .and_then(|d| d.get("tables"))
                    .and_then(|t| t.as_array())
                {
                    for table in tables {
                        println!("{}", serde_json::to_string(table)?);
                    }
                } else {
                    println!("{}", serde_json::to_string(&resp)?);
                }
            } else {
                println!("{:<28} {:<16} {:<12}", "TABLE NAME", "SCHEMA", "EST. ROWS");
                println!("{:-<60}", "");
                if let Some(tables) = resp
                    .get("data")
                    .and_then(|d| d.get("tables"))
                    .and_then(|t| t.as_array())
                {
                    for table in tables {
                        let name = table.get("name").and_then(|n| n.as_str()).unwrap_or("-");
                        let schema = table
                            .get("schema")
                            .and_then(|s| s.as_str())
                            .unwrap_or("public");
                        let row_count = table
                            .get("row_count")
                            .and_then(|r| r.as_i64())
                            .map(|r| r.to_string())
                            .unwrap_or_else(|| "-".to_string());
                        println!("{:<28} {:<16} {:<12}", name, schema, row_count);
                    }
                }
                if let Some(next) = resp
                    .get("pagination")
                    .and_then(|p| p.get("next_cursor"))
                    .and_then(|c| c.as_str())
                {
                    println!("\nNext cursor: {}", next);
                }
            }
        }

        DbCommands::Schema { alias, table } => {
            let resp = client.get_table_schema(&alias, &table).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("Schema definition for '{}.{}'", alias, table);
                println!("{:-<84}", "");
                println!(
                    "{:<24} {:<20} {:<10} {:<18} {:<10}",
                    "COLUMN", "DATA TYPE", "NULLABLE", "DEFAULT", "PRIMARY KEY"
                );
                println!("{:-<84}", "");
                if let Some(columns) = resp
                    .get("data")
                    .and_then(|d| d.get("columns"))
                    .and_then(|c| c.as_array())
                {
                    for col in columns {
                        let col_name = col.get("name").and_then(|n| n.as_str()).unwrap_or("-");
                        let col_type = col.get("type").and_then(|t| t.as_str()).unwrap_or("-");
                        let nullable = if col
                            .get("nullable")
                            .and_then(|n| n.as_bool())
                            .unwrap_or(true)
                        {
                            "YES"
                        } else {
                            "NO"
                        };
                        let default_val = col
                            .get("default_value")
                            .and_then(|d| d.as_str())
                            .unwrap_or("NULL");
                        let pk = if col
                            .get("primary_key")
                            .and_then(|p| p.as_bool())
                            .unwrap_or(false)
                        {
                            "YES"
                        } else {
                            "NO"
                        };
                        println!(
                            "{:<24} {:<20} {:<10} {:<18} {:<10}",
                            col_name, col_type, nullable, default_val, pk
                        );
                    }
                }

                if let Some(fks) = resp
                    .get("data")
                    .and_then(|d| d.get("foreign_keys"))
                    .and_then(|f| f.as_array())
                {
                    if !fks.is_empty() {
                        println!("\nForeign Key Constraints:");
                        println!(
                            "{:<24} {:<20} {:<20} {:<20}",
                            "FK NAME", "COLUMN", "REFERENCED TABLE", "REFERENCED COLUMN"
                        );
                        println!("{:-<84}", "");
                        for fk in fks {
                            let fk_name = fk.get("name").and_then(|n| n.as_str()).unwrap_or("-");
                            let fk_col = fk.get("column").and_then(|c| c.as_str()).unwrap_or("-");
                            let ref_table = fk
                                .get("referenced_table")
                                .and_then(|r| r.as_str())
                                .unwrap_or("-");
                            let ref_col = fk
                                .get("referenced_column")
                                .and_then(|r| r.as_str())
                                .unwrap_or("-");
                            println!(
                                "{:<24} {:<20} {:<20} {:<20}",
                                fk_name, fk_col, ref_table, ref_col
                            );
                        }
                    }
                }
            }
        }

        DbCommands::Rows {
            alias,
            table,
            cursor,
            limit,
            sort,
            order,
            filter,
        } => {
            let resp = client
                .fetch_table_rows(
                    &alias,
                    &table,
                    cursor.as_deref(),
                    limit,
                    sort.as_deref(),
                    order.as_deref(),
                    filter.as_deref(),
                )
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                if let Some(rows) = resp
                    .get("data")
                    .and_then(|d| d.get("rows"))
                    .and_then(|r| r.as_array())
                {
                    for row in rows {
                        println!("{}", serde_json::to_string(row)?);
                    }
                } else {
                    println!("{}", serde_json::to_string(&resp)?);
                }
            } else {
                render_rows_table(&resp);
            }
        }

        DbCommands::Insert {
            alias,
            table,
            data,
            row,
            rows,
        } => {
            let (row_val, rows_val) = if let Some(d_str) = data {
                let parsed: Value = serde_json::from_str(&d_str)
                    .map_err(|e| format!("Invalid JSON data: {}", e))?;
                if parsed.is_array() {
                    (None, Some(parsed))
                } else {
                    (Some(parsed), None)
                }
            } else {
                let r: Option<Value> = match row {
                    Some(r_str) => Some(
                        serde_json::from_str(&r_str)
                            .map_err(|e| format!("Invalid JSON row object: {}", e))?,
                    ),
                    None => None,
                };
                let rs: Option<Value> = match rows {
                    Some(rs_str) => Some(
                        serde_json::from_str(&rs_str)
                            .map_err(|e| format!("Invalid JSON rows array: {}", e))?,
                    ),
                    None => None,
                };
                (r, rs)
            };

            let resp = client
                .insert_table_row(&alias, &table, row_val, rows_val)
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let affected = resp
                    .get("affected_rows")
                    .or_else(|| resp.get("data").and_then(|d| d.get("affected_rows")))
                    .and_then(|a| a.as_i64())
                    .unwrap_or(1);
                println!(
                    "Inserted row(s) successfully into '{}.{}' ({} row(s) affected).",
                    alias, table, affected
                );
            }
        }

        DbCommands::UpdateRows {
            alias,
            table,
            filter,
            update,
        } => {
            let filter_val: Value =
                serde_json::from_str(&filter).map_err(|e| format!("Invalid JSON filter: {}", e))?;
            let update_val: Value =
                serde_json::from_str(&update).map_err(|e| format!("Invalid JSON update: {}", e))?;

            let resp = client
                .update_table_row(&alias, &table, filter_val, update_val)
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let affected = resp
                    .get("affected_rows")
                    .or_else(|| resp.get("data").and_then(|d| d.get("affected_rows")))
                    .and_then(|a| a.as_i64())
                    .unwrap_or(0);
                println!(
                    "Updated row(s) in '{}.{}' ({} row(s) affected).",
                    alias, table, affected
                );
            }
        }

        DbCommands::DeleteRows {
            alias,
            table,
            filter,
        } => {
            let filter_val: Value =
                serde_json::from_str(&filter).map_err(|e| format!("Invalid JSON filter: {}", e))?;

            let resp = client.delete_table_row(&alias, &table, filter_val).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let affected = resp
                    .get("affected_rows")
                    .or_else(|| resp.get("data").and_then(|d| d.get("affected_rows")))
                    .and_then(|a| a.as_i64())
                    .unwrap_or(0);
                println!(
                    "Deleted row(s) from '{}.{}' ({} row(s) affected).",
                    alias, table, affected
                );
            }
        }

        DbCommands::AddColumn {
            alias,
            table,
            column,
            data_type,
            nullable,
            default_val,
        } => {
            let resp = client
                .add_table_column(
                    &alias,
                    &table,
                    &column,
                    &data_type,
                    nullable,
                    default_val.as_deref(),
                )
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!(
                    "Added column '{}' ({}) to '{}.{}' successfully.",
                    column, data_type, alias, table
                );
            }
        }
    }
    Ok(())
}

// ─── Cache Command Handlers ────────────────────────────────────────────────

async fn handle_cache_command(
    client: AdminClient,
    command: CacheCommands,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        CacheCommands::Stats => {
            let resp = client.get_cache_stats().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let data = resp.get("data").cloned().unwrap_or(resp);
                println!("Axiom Unified Cache Statistics");
                println!("{:-<42}", "");
                println!("{:<26} {:<12}", "METRIC", "VALUE");
                println!("{:-<42}", "");
                println!(
                    "{:<26} {:<12}",
                    "L1 Cache Hits (RAM)",
                    data.get("hits_l1").and_then(|v| v.as_u64()).unwrap_or(0)
                );
                println!(
                    "{:<26} {:<12}",
                    "L2 Cache Hits (Disk)",
                    data.get("hits_l2").and_then(|v| v.as_u64()).unwrap_or(0)
                );
                println!(
                    "{:<26} {:<12}",
                    "Cache Misses",
                    data.get("misses").and_then(|v| v.as_u64()).unwrap_or(0)
                );
                println!(
                    "{:<26} {:<12}",
                    "Evictions (LRU)",
                    data.get("evictions").and_then(|v| v.as_u64()).unwrap_or(0)
                );
                println!(
                    "{:<26} {:<12}",
                    "Active L1 Entries",
                    data.get("entries_count")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0)
                );
                let hit_rate = data
                    .get("hit_rate_pct")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                println!("{:<26} {:.2}%", "Hit Rate", hit_rate);
                let mem = data
                    .get("memory_bytes_approx")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                println!("{:<26} {} bytes", "Approx Memory", mem);
            }
        }
        CacheCommands::Flush => {
            let resp = client.flush_cache().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("All cache entries flushed successfully.");
            }
        }
    }
    Ok(())
}

// ─── Audit & Reload Command Handlers ───────────────────────────────────────

async fn handle_audit_command(
    client: AdminClient,
    limit: usize,
    offset: usize,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    let resp = client.get_audit_log(Some(limit), Some(offset)).await?;

    if format == OutputFormat::Json {
        println!("{}", serde_json::to_string_pretty(&resp)?);
    } else if format == OutputFormat::Jsonl {
        if let Some(entries) = resp
            .get("data")
            .and_then(|d| d.get("audit"))
            .and_then(|a| a.as_array())
        {
            for entry in entries {
                println!("{}", serde_json::to_string(entry)?);
            }
        } else {
            println!("{}", serde_json::to_string(&resp)?);
        }
    } else {
        println!(
            "{:<6} {:<18} {:<16} {:<18} {:<20}",
            "ID", "TIMESTAMP", "ACTOR", "ACTION", "TARGET"
        );
        println!("{:-<80}", "");
        if let Some(entries) = resp
            .get("data")
            .and_then(|d| d.get("audit"))
            .and_then(|a| a.as_array())
        {
            if entries.is_empty() {
                println!("No audit records found.");
            } else {
                for e in entries {
                    let id = e.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                    let ts = e.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);
                    let actor = e.get("actor").and_then(|v| v.as_str()).unwrap_or("-");
                    let action = e.get("action").and_then(|v| v.as_str()).unwrap_or("-");
                    let target = e.get("target").and_then(|v| v.as_str()).unwrap_or("-");
                    println!(
                        "{:<6} {:<18} {:<16} {:<18} {:<20}",
                        id, ts, actor, action, target
                    );
                }
            }
        }
    }

    Ok(())
}

async fn handle_reload_command(
    client: AdminClient,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    let resp = client.reload_metadata().await?;
    if format == OutputFormat::Json {
        println!("{}", serde_json::to_string_pretty(&resp)?);
    } else if format == OutputFormat::Jsonl {
        println!("{}", serde_json::to_string(&resp)?);
    } else {
        println!("Metadata snapshots and ArcSwap cache reloaded successfully.");
    }
    Ok(())
}

// ─── Cluster Mesh Command Handlers ──────────────────────────────────────────

async fn handle_cluster_command(
    client: AdminClient,
    command: ClusterCommands,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        ClusterCommands::Status => {
            let resp = client.get_cluster_status().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("Axiom Cluster Mesh Status");
                println!("{:-<60}", "");
                if let Some(data) = resp.get("data") {
                    let node_id = data.get("node_id").and_then(|v| v.as_str()).unwrap_or("-");
                    let moniker = data.get("moniker").and_then(|v| v.as_str()).unwrap_or("-");
                    let secret = data
                        .get("cluster_secret")
                        .and_then(|v| v.as_str())
                        .unwrap_or("-");
                    let connected = data
                        .get("connected_peers")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    let total = data
                        .get("total_peers")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);

                    println!("{:<18}: {}", "Node ID", node_id);
                    println!("{:<18}: {}", "Node Moniker", moniker);
                    println!("{:<18}: {}", "Cluster Secret", secret);
                    println!(
                        "{:<18}: {} connected / {} total",
                        "Peer Mesh", connected, total
                    );
                } else {
                    println!("{}", serde_json::to_string_pretty(&resp)?);
                }
            }
        }

        ClusterCommands::Peers => {
            let resp = client.list_cluster_peers().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                if let Some(peers) = resp
                    .get("data")
                    .and_then(|d| d.get("peers"))
                    .and_then(|p| p.as_array())
                {
                    for peer in peers {
                        println!("{}", serde_json::to_string(peer)?);
                    }
                } else {
                    println!("{}", serde_json::to_string(&resp)?);
                }
            } else {
                let peers = resp
                    .get("data")
                    .and_then(|d| d.get("peers"))
                    .and_then(|p| p.as_array());

                match peers {
                    Some(list) if !list.is_empty() => {
                        println!(
                            "{:<38} {:<18} {:<28} {:<12} {:<10} {:<16}",
                            "NODE ID", "MONIKER", "URL", "STATUS", "LATENCY", "LAST SEEN"
                        );
                        println!("{:-<126}", "");
                        for p in list {
                            let node_id = p.get("node_id").and_then(|v| v.as_str()).unwrap_or("-");
                            let moniker = p.get("moniker").and_then(|v| v.as_str()).unwrap_or("-");
                            let url = p.get("url").and_then(|v| v.as_str()).unwrap_or("-");
                            let status = p
                                .get("status")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown");
                            let latency = p
                                .get("latency_ms")
                                .and_then(|v| v.as_i64())
                                .map(|l| format!("{}ms", l))
                                .unwrap_or_else(|| "-".to_string());
                            let last_seen = p
                                .get("last_seen")
                                .and_then(|v| v.as_i64())
                                .map(|ts| {
                                    let now = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_secs()
                                        as i64;
                                    let diff = (now - ts).max(0);
                                    if diff < 60 {
                                        format!("{}s ago", diff)
                                    } else if diff < 3600 {
                                        format!("{}m ago", diff / 60)
                                    } else {
                                        format!("{}h ago", diff / 3600)
                                    }
                                })
                                .unwrap_or_else(|| "-".to_string());

                            println!(
                                "{:<38} {:<18} {:<28} {:<12} {:<10} {:<16}",
                                node_id, moniker, url, status, latency, last_seen
                            );
                        }
                    }
                    _ => {
                        println!("No cluster peers paired yet. Use 'axiom cluster connect <url> --secret <secret>' to join a node.");
                    }
                }
            }
        }

        ClusterCommands::Connect { target_url, secret } => {
            let resp = client.connect_cluster_peer(&target_url, &secret).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!(
                    "Successfully paired and connected with cluster peer at '{}'.",
                    target_url
                );
                if let Some(peer) = resp.get("data") {
                    if let Some(moniker) = peer.get("moniker").and_then(|v| v.as_str()) {
                        println!("  Moniker: {}", moniker);
                    }
                    if let Some(node_id) = peer.get("node_id").and_then(|v| v.as_str()) {
                        println!("  Node ID: {}", node_id);
                    }
                }
            }
        }

        ClusterCommands::Remove { node_id } => {
            let resp = client.remove_cluster_peer(&node_id).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!(
                    "Peer node '{}' successfully removed from cluster mesh.",
                    node_id
                );
            }
        }

        ClusterCommands::Update {
            node_id,
            moniker,
            url,
            secret,
        } => {
            let resp = client
                .update_cluster_peer(
                    &node_id,
                    moniker.as_deref(),
                    url.as_deref(),
                    secret.as_deref(),
                )
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!(
                    "Configuration for peer node '{}' successfully updated.",
                    node_id
                );
            }
        }

        ClusterCommands::Ping { node_id } => {
            let resp = client.ping_cluster_peer(&node_id).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let data = resp.get("data");
                let latency = data
                    .and_then(|d| d.get("latency_ms"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let moniker = data
                    .and_then(|d| d.get("moniker"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&node_id);
                let status = data
                    .and_then(|d| d.get("status"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("connected");

                println!(
                    "Peer '{}' ({}) responded in {}ms - Status: {}",
                    moniker, node_id, latency, status
                );
            }
        }

        ClusterCommands::Moniker { moniker } => {
            let resp = client.update_cluster_moniker(&moniker).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!(
                    "Local cluster node moniker successfully updated to '{}'.",
                    moniker
                );
            }
        }
    }

    Ok(())
}

// ─── Diagnostics and System Doctor ─────────────────────────────────────────

async fn run_doctor(
    base_url: &str,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut checks = Vec::new();

    // 1. Config file check & syntax parsing
    let config_path = Path::new("config.toml");
    if config_path.exists() {
        match std::fs::read_to_string(config_path) {
            Ok(content) => match toml::from_str::<toml::Value>(&content) {
                Ok(_) => {
                    checks.push(json!({
                        "item": "Configuration file (config.toml)",
                        "status": "PASS",
                        "detail": "Found config.toml with valid TOML syntax"
                    }));
                }
                Err(e) => {
                    checks.push(json!({
                        "item": "Configuration file (config.toml)",
                        "status": "FAIL",
                        "detail": format!("config.toml has invalid TOML: {}", e)
                    }));
                }
            },
            Err(e) => {
                checks.push(json!({
                    "item": "Configuration file (config.toml)",
                    "status": "WARN",
                    "detail": format!("Cannot read config.toml: {}", e)
                }));
            }
        }
    } else {
        checks.push(json!({
            "item": "Configuration file (config.toml)",
            "status": "WARN",
            "detail": "config.toml not found, using internal defaults"
        }));
    }

    // 2. Metadata SQLite store check
    let axiom_db_path = Path::new("data/axiom.db");
    if axiom_db_path.exists() {
        match std::fs::metadata(axiom_db_path) {
            Ok(meta) => {
                checks.push(json!({
                    "item": "Metadata store (data/axiom.db)",
                    "status": "PASS",
                    "detail": format!("Found data/axiom.db ({} bytes)", meta.len())
                }));
            }
            Err(e) => {
                checks.push(json!({
                    "item": "Metadata store (data/axiom.db)",
                    "status": "WARN",
                    "detail": format!("data/axiom.db exists but inaccessible: {}", e)
                }));
            }
        }
    } else {
        checks.push(json!({
            "item": "Metadata store (data/axiom.db)",
            "status": "INFO",
            "detail": "data/axiom.db not yet created (will initialize on first boot)"
        }));
    }

    // 3. Gateway server reachability probe
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(1500))
        .build()?;
    let health_url = format!("{}/health", base_url.trim_end_matches('/'));
    let probe_start = std::time::Instant::now();
    match client.get(&health_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            let latency_ms = probe_start.elapsed().as_secs_f64() * 1000.0;
            checks.push(json!({
                "item": "Gateway HTTP probe",
                "status": "PASS",
                "detail": format!("Gateway reachable at {} ({:.2}ms)", health_url, latency_ms)
            }));
        }
        Ok(resp) => {
            checks.push(json!({
                "item": "Gateway HTTP probe",
                "status": "WARN",
                "detail": format!("Gateway responded with HTTP {} at {}", resp.status(), health_url)
            }));
        }
        Err(e) => {
            checks.push(json!({
                "item": "Gateway HTTP probe",
                "status": "WARN",
                "detail": format!("Gateway unreachable at {}: {}", health_url, e)
            }));
        }
    }

    // 4. Cluster mesh status check
    let cluster_url = format!("{}/admin/v1/cluster/status", base_url.trim_end_matches('/'));
    match client.get(&cluster_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                let moniker = body
                    .get("data")
                    .and_then(|d| d.get("moniker"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("node");
                let connected = body
                    .get("data")
                    .and_then(|d| d.get("connected_peers"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let total = body
                    .get("data")
                    .and_then(|d| d.get("total_peers"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                checks.push(json!({
                    "item": "Cluster mesh status",
                    "status": "PASS",
                    "detail": format!("Node '{}' active with {} connected / {} total peers", moniker, connected, total)
                }));
            }
        }
        _ => {
            checks.push(json!({
                "item": "Cluster mesh status",
                "status": "INFO",
                "detail": "Cluster status requires running gateway and admin credentials"
            }));
        }
    }

    // 5. Runtime environment
    checks.push(json!({
        "item": "Host environment",
        "status": "PASS",
        "detail": format!("OS: {}, Arch: {}", std::env::consts::OS, std::env::consts::ARCH)
    }));

    if format == OutputFormat::Json {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({
                "success": true,
                "data": { "checks": checks }
            }))?
        );
    } else if format == OutputFormat::Jsonl {
        for c in &checks {
            println!("{}", serde_json::to_string(c)?);
        }
    } else {
        println!("Axiom Doctor Diagnostic Report");
        println!("{:-<70}", "");
        for c in &checks {
            let item = c["item"].as_str().unwrap_or("");
            let status = c["status"].as_str().unwrap_or("");
            let detail = c["detail"].as_str().unwrap_or("");
            let badge = match status {
                "PASS" => "PASS",
                "FAIL" => "FAIL",
                "WARN" => "WARN",
                _ => "INFO",
            };
            println!("[{:<4}] {:<34} - {}", badge, item, detail);
        }
    }

    Ok(())
}

// ─── Built-in Pipeline Benchmark ───────────────────────────────────────────

async fn run_benchmark(
    base_url: &str,
    auth_key: Option<&str>,
    requests: usize,
    concurrency: usize,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let url = format!("{}/health", base_url.trim_end_matches('/'));

    if format == OutputFormat::Table {
        println!("════════════════════════════════════════════════════════════════");
        println!(" AXIOM CLI HTTP PIPELINE BENCHMARK");
        println!(
            " Target: {} | Requests: {} | Concurrency: {}",
            url, requests, concurrency
        );
        println!("════════════════════════════════════════════════════════════════\n");
    }

    let concurrency = concurrency.max(1);
    let requests = requests.max(1);
    let reqs_per_worker = requests / concurrency;
    let remainder = requests % concurrency;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let total_start = std::time::Instant::now();

    let mut handles = Vec::with_capacity(concurrency);
    for w in 0..concurrency {
        let count = reqs_per_worker + if w < remainder { 1 } else { 0 };
        let c = client.clone();
        let u = url.clone();
        let k = auth_key.map(|s| s.to_string());
        let tx_clone = tx.clone();

        handles.push(tokio::spawn(async move {
            for _ in 0..count {
                let mut req = c.get(&u);
                if let Some(ref key) = k {
                    req = req.header("X-Axiom-Key", key);
                }
                let start = std::time::Instant::now();
                let ok = match req.send().await {
                    Ok(res) => res.status().is_success(),
                    Err(_) => false,
                };
                let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
                let _ = tx_clone.send((ok, elapsed_ms));
            }
        }));
    }
    drop(tx);

    let mut latencies_ms = Vec::with_capacity(requests);
    let mut successful = 0;
    let mut failed = 0;

    while let Some((ok, elapsed)) = rx.recv().await {
        if ok {
            successful += 1;
            latencies_ms.push(elapsed);
        } else {
            failed += 1;
        }
    }

    for h in handles {
        let _ = h.await;
    }

    let total_duration = total_start.elapsed().as_secs_f64();
    latencies_ms.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let p50 = if !latencies_ms.is_empty() {
        latencies_ms[(latencies_ms.len() as f64 * 0.50) as usize]
    } else {
        0.0
    };
    let p95 = if !latencies_ms.is_empty() {
        latencies_ms
            [(latencies_ms.len() as f64 * 0.95).min((latencies_ms.len() - 1) as f64) as usize]
    } else {
        0.0
    };
    let p99 = if !latencies_ms.is_empty() {
        latencies_ms
            [(latencies_ms.len() as f64 * 0.99).min((latencies_ms.len() - 1) as f64) as usize]
    } else {
        0.0
    };

    let rps = if total_duration > 0.0 {
        successful as f64 / total_duration
    } else {
        0.0
    };

    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let result = json!({
        "suite": "http_pipeline",
        "timestamp_unix": now_unix,
        "concurrency": concurrency,
        "total_requests": requests,
        "successful": successful,
        "failed": failed,
        "duration_seconds": (total_duration * 1000.0).round() / 1000.0,
        "requests_per_second": (rps * 100.0).round() / 100.0,
        "latency_p50_ms": (p50 * 1000.0).round() / 1000.0,
        "latency_p95_ms": (p95 * 1000.0).round() / 1000.0,
        "latency_p99_ms": (p99 * 1000.0).round() / 1000.0,
    });

    if format == OutputFormat::Json {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else if format == OutputFormat::Jsonl {
        println!("{}", serde_json::to_string(&result)?);
    } else {
        println!("{:<24} {:<16}", "METRIC", "VALUE");
        println!("{:-<42}", "");
        println!("{:<24} {}", "Total Requests", requests);
        println!("{:<24} {}", "Concurrency", concurrency);
        println!("{:<24} {}", "Successful", successful);
        println!("{:<24} {}", "Failed", failed);
        println!("{:<24} {:.3}s", "Total Duration", total_duration);
        println!("{:<24} {:.1} req/s", "Throughput", rps);
        println!("{:<24} {:.3} ms", "Latency p50", p50);
        println!("{:<24} {:.3} ms", "Latency p95", p95);
        println!("{:<24} {:.3} ms", "Latency p99", p99);
    }

    Ok(())
}

// ─── Configuration Management Command Handlers ──────────────────────────────
// Handles config initialization, toml-to-env conversion, and validation.

/// Dispatches configuration subcommands (`init`, `to-env`, `show`).
/// CONTRACT:
///  - Precondition: `command` is a valid `ConfigCommands` variant.
///  - Returns `Ok(())` on successful operation.
///  - Side effects: May write or overwrite files on disk; may output to stdout.
pub async fn handle_config_command(
    command: ConfigCommands,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        ConfigCommands::Init {
            path,
            force,
            to_env,
        } => {
            let target_path = Path::new(&path);
            let mut do_write = true;
            let mut do_convert = false;

            if target_path.exists() && !force {
                println!("Configuration file '{}' already exists.", path);
                print!("Choose action: [o]verwrite, [c]onvert to .env, or [a]bort (default): ");
                use std::io::Write;
                let _ = std::io::stdout().flush();

                let mut input = String::new();
                if std::io::stdin().read_line(&mut input).is_ok() {
                    let choice = input.trim().to_lowercase();
                    if choice == "o" || choice == "overwrite" {
                        do_write = true;
                    } else if choice == "c" || choice == "convert" {
                        do_write = false;
                        do_convert = true;
                    } else {
                        println!("Aborted. Existing configuration file was left untouched.");
                        return Ok(());
                    }
                } else {
                    return Err(format!(
                        "File '{}' already exists. Use --force to overwrite.",
                        path
                    )
                    .into());
                }
            }

            if do_write {
                let template = get_default_config_template();
                if let Some(parent) = target_path.parent() {
                    if !parent.as_os_str().is_empty() {
                        std::fs::create_dir_all(parent)?;
                    }
                }
                std::fs::write(&path, template)?;
                if format == OutputFormat::Json {
                    println!(
                        "{}",
                        json!({ "status": "success", "file": path, "action": "created" })
                    );
                } else if format == OutputFormat::Jsonl {
                    println!(
                        "{}",
                        serde_json::to_string(
                            &json!({ "status": "success", "file": path, "action": "created" })
                        )?
                    );
                } else {
                    println!(
                        "Successfully initialized new configuration file at '{}'.",
                        path
                    );
                }
            }

            if do_convert || to_env {
                let env_path = ".env";
                let toml_content = std::fs::read_to_string(&path)?;
                let env_content = toml_to_env_string(&toml_content)?;
                std::fs::write(env_path, env_content)?;
                if format == OutputFormat::Json {
                    println!(
                        "{}",
                        json!({ "status": "success", "file": env_path, "action": "converted" })
                    );
                } else if format == OutputFormat::Jsonl {
                    println!(
                        "{}",
                        serde_json::to_string(
                            &json!({ "status": "success", "file": env_path, "action": "converted" })
                        )?
                    );
                } else {
                    println!("Successfully converted '{}' into '{}'.", path, env_path);
                }
            }

            Ok(())
        }

        ConfigCommands::ToEnv {
            input,
            output,
            force,
        } => {
            let out_path = Path::new(&output);
            if out_path.exists() && !force {
                print!(
                    "Output file '{}' already exists. Overwrite? (y/N): ",
                    output
                );
                use std::io::Write;
                let _ = std::io::stdout().flush();
                let mut resp = String::new();
                if std::io::stdin().read_line(&mut resp).is_ok() {
                    let resp = resp.trim().to_lowercase();
                    if resp != "y" && resp != "yes" {
                        println!("Aborted.");
                        return Ok(());
                    }
                } else {
                    return Err(format!(
                        "File '{}' already exists. Use --force to overwrite.",
                        output
                    )
                    .into());
                }
            }

            let toml_content = std::fs::read_to_string(&input)
                .map_err(|e| format!("Failed to read input TOML file '{}': {}", input, e))?;
            let env_content = toml_to_env_string(&toml_content)?;
            if let Some(parent) = out_path.parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(parent)?;
                }
            }
            std::fs::write(&output, env_content)?;

            if format == OutputFormat::Json {
                println!(
                    "{}",
                    json!({ "status": "success", "input": input, "output": output })
                );
            } else if format == OutputFormat::Jsonl {
                println!(
                    "{}",
                    serde_json::to_string(
                        &json!({ "status": "success", "input": input, "output": output })
                    )?
                );
            } else {
                println!("Successfully converted '{}' to '{}'.", input, output);
            }
            Ok(())
        }

        ConfigCommands::Show { config } => {
            let content = std::fs::read_to_string(&config)
                .map_err(|e| format!("Failed to read config file '{}': {}", config, e))?;
            let val: toml::Value = toml::from_str(&content)
                .map_err(|e| format!("Invalid TOML in '{}': {}", config, e))?;

            if format == OutputFormat::Json || format == OutputFormat::Jsonl {
                let json_val = serde_json::to_value(&val)?;
                if format == OutputFormat::Json {
                    println!("{}", serde_json::to_string_pretty(&json_val)?);
                } else {
                    println!("{}", serde_json::to_string(&json_val)?);
                }
            } else {
                println!("{:<28} {:<32}", "SECTION/KEY", "VALUE");
                println!("{:-<60}", "");
                if let toml::Value::Table(tbl) = val {
                    for (k, v) in tbl {
                        match v {
                            toml::Value::Table(sub) => {
                                println!("[{}]", k);
                                for (sub_k, sub_v) in sub {
                                    println!("  {:<26} {}", sub_k, sub_v);
                                }
                            }
                            other => {
                                println!("{:<28} {}", k, other);
                            }
                        }
                    }
                }
            }
            Ok(())
        }
    }
}

/// Converts a TOML configuration string into formatted KEY=VALUE environment variable lines.
/// CONTRACT:
///  - Precondition: `toml_str` must be valid TOML syntax.
///  - Returns formatted string suitable for `.env` files.
///  - Sections are mapped to double-underscore uppercase prefixes (e.g. `[server]` -> `SERVER__`).
///  - Arrays are formatted as single-line JSON/brackets (e.g. `["127.0.0.1"]`).
///  - Strings containing spaces or symbols are safely quoted.
pub fn toml_to_env_string(toml_str: &str) -> Result<String, Box<dyn std::error::Error>> {
    let table: toml::Table = toml::from_str(toml_str)?;
    let mut lines = vec![
        "# ─────────────────────────────────────────────────────────────────────────────"
            .to_string(),
        "# Axiom Environment Configuration (Generated from TOML)".to_string(),
        "# ─────────────────────────────────────────────────────────────────────────────"
            .to_string(),
        "".to_string(),
    ];

    for (section_or_key, val) in table {
        match val {
            toml::Value::Table(sub_table) => {
                let section_prefix = section_or_key.to_uppercase().replace('.', "__");
                lines.push(format!("# ─── [{}] ───", section_or_key));
                for (k, v) in sub_table {
                    let env_key = format!("{}__{}", section_prefix, k.to_uppercase());
                    lines.push(format_env_line(&env_key, &v));
                }
                lines.push("".to_string());
            }
            _ => {
                let env_key = section_or_key.to_uppercase();
                lines.push(format_env_line(&env_key, &val));
            }
        }
    }

    Ok(lines.join("\n"))
}

fn format_env_line(key: &str, val: &toml::Value) -> String {
    let formatted_val = match val {
        toml::Value::String(s) => {
            if s.contains(' ') || s.contains('#') || s.contains('=') || s.contains('"') {
                format!("\"{}\"", s.replace('"', "\\\""))
            } else {
                s.clone()
            }
        }
        toml::Value::Integer(i) => i.to_string(),
        toml::Value::Float(f) => f.to_string(),
        toml::Value::Boolean(b) => b.to_string(),
        toml::Value::Array(arr) => {
            let elements: Vec<String> = arr
                .iter()
                .map(|item| match item {
                    toml::Value::String(s) => format!("\"{}\"", s.replace('"', "\\\"")),
                    other => other.to_string(),
                })
                .collect();
            format!("[{}]", elements.join(","))
        }
        toml::Value::Datetime(dt) => dt.to_string(),
        toml::Value::Table(_) => "{}".to_string(),
    };
    format!("{}={}", key, formatted_val)
}

fn get_default_config_template() -> &'static str {
    r#"# ─────────────────────────────────────────────────────────────────────────────
# Axiom API Gateway - Production-Ready Industrial Configuration
# ─────────────────────────────────────────────────────────────────────────────

# ─── Server Infrastructure ───────────────────────────────────────────────────
[server]
host = "0.0.0.0"                 # Listen on all network interfaces (container/reverse-proxy ready)
port = 4500                      # Primary HTTP REST and Admin API port
workers = 0                      # Tokio runtime threads (0 = auto-saturate all physical/vCPU cores)
max_connections = 25000          # High-concurrency TCP limit for bursty microservice traffic
request_timeout = 30             # Hard cap on slow/hanging client queries in seconds
body_limit = "10mb"              # Enforced payload ceiling blocking payload-exhaustion attacks
allowed_ips = ["127.0.0.1"]      # Internal health probes exempt from rate limiting
trusted_proxies = ["127.0.0.1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]  # Trusted reverse proxies for X-Forwarded-For
cors_origins = ["*"]             # Allowed CORS origins
shutdown_timeout = 30            # Maximum drain window for in-flight requests during SIGTERM

# ─── High-Throughput Structured Logging ──────────────────────────────────────
[logging]
enabled = true
level = "WARN"                   # Production recommendation: INFO or WARN to eliminate disk I/O bottlenecks
format = "json"                  # Structured JSON format ready for Datadog, CloudWatch, Loki, ELK
directory = "./logs"
file_prefix = "axiom"
max_file_size = "100mb"          # Auto-rotation threshold
max_files = 10                   # Number of rotated logs retained before automatic purging
stdout = true                    # Mirror logs to stdout for Docker/Kubernetes container collectors

# ─── Control Plane & Metadata Store ──────────────────────────────────────────
[metadata]
url = "file:data/axiom.db"       # Embedded high-concurrency SQLite (or remote Turso libsql:// endpoint)
token = ""                       # Turso authentication token (leave blank for local embedded SQLite)
reload_interval = 30             # Periodic background snapshot synchronization interval in seconds

# ─── Edge Security & Rate Limiting ───────────────────────────────────────────
[rate_limit]
enabled = true
backend = "memory"               # Fast L1 in-memory DashMap (zero allocations on hot path)
turso_url = "file:data/cache.db"
turso_token = ""
window = 60                      # Sliding rate window in seconds
max_requests = 1000              # Baseline throughput ceiling (1,000 requests / minute)
burst = 200                      # Absorbs transient high-concurrency traffic bursts
penalty_threshold = 10           # Limit violations before IP ban
penalty_cooldown = 300           # Quarantine ban duration in seconds (5 minutes)

# ─── Two-Tier Hybrid Cache Engine (L1 RAM + L2 Persistent Storage) ───────────
[cache]
enabled = true
backend = "hybrid"               # "hybrid" = Sub-microsecond L1 DashMap RAM + L2 Persistent SQLite WAL storage
turso_url = "file:data/cache.db" # Persistent disk storage location
turso_token = ""
max_memory = "512mb"             # Dedicated RAM budget for hot query results
default_ttl = 60                 # General-purpose cache time-to-live in seconds
query_cache = true               # Cache read query results automatically
query_results_ttl = 30           # Hot query result retention in seconds
response_cache_ttl = 30          # HTTP response cache retention in seconds
idempotency_ttl = 86400          # 24-hour retention for Idempotency-Key retry requests

# ─── Upstream Fault Tolerance (Circuit Breaker) ──────────────────────────────
[circuit_breaker]
enabled = true
failure_threshold = 5            # Consecutive database dropouts before tripping breaker open
recovery_time = 15               # Cool-down period before attempting a probe request (seconds)
half_open_max_requests = 5       # Number of trial probes allowed in half-open state before closing
timeout = 30                     # Timeout for upstream queries before marking a connection failure
"#
}

// ─── Table Formatting Helpers ──────────────────────────────────────────────

fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

fn render_query_results_table(resp: &Value) {
    let empty_vec = Vec::new();
    let rows_opt = resp.get("rows").and_then(|r| r.as_array()).or_else(|| {
        resp.get("data")
            .and_then(|d| d.get("rows"))
            .and_then(|r| r.as_array())
    });
    let cols_opt = resp.get("columns").and_then(|c| c.as_array()).or_else(|| {
        resp.get("data")
            .and_then(|d| d.get("columns"))
            .and_then(|c| c.as_array())
    });

    let col_names: Vec<String> = if let Some(cols) = cols_opt {
        cols.iter()
            .filter_map(|c| c.as_str().map(|s| s.to_string()))
            .collect()
    } else if let Some(rows) = rows_opt {
        if let Some(first) = rows.first().and_then(|r| r.as_object()) {
            first.keys().cloned().collect()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    let rows = rows_opt.unwrap_or(&empty_vec);

    if col_names.is_empty() || rows.is_empty() {
        let affected = resp
            .get("affected_rows")
            .or_else(|| resp.get("data").and_then(|d| d.get("affected_rows")))
            .and_then(|a| a.as_i64())
            .unwrap_or(0);
        let exec_time = resp
            .get("execution_time_ms")
            .or_else(|| resp.get("meta").and_then(|m| m.get("duration_ms")))
            .and_then(|t| t.as_f64());

        if affected > 0 {
            println!("Query OK, {} row(s) affected.", affected);
        } else {
            println!("Query OK, 0 rows returned.");
        }
        if let Some(ms) = exec_time {
            println!("Execution time: {:.2} ms", ms);
        }
        return;
    }

    let mut widths: Vec<usize> = col_names.iter().map(|c| c.len().max(8)).collect();
    for row in rows {
        for (i, col_name) in col_names.iter().enumerate() {
            let val_str = match row.get(col_name) {
                Some(Value::Null) => "NULL".to_string(),
                Some(Value::String(s)) => s.clone(),
                Some(v) => v.to_string(),
                None => "".to_string(),
            };
            if val_str.len() > widths[i] {
                widths[i] = val_str.len().min(40);
            }
        }
    }

    let header_line: Vec<String> = col_names
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{:<width$}", c, width = widths[i]))
        .collect();
    println!("{}", header_line.join(" | "));

    let total_width: usize = widths.iter().sum::<usize>() + (widths.len().saturating_sub(1)) * 3;
    println!("{:-<width$}", "", width = total_width.max(10));

    for row in rows {
        let row_line: Vec<String> = col_names
            .iter()
            .enumerate()
            .map(|(i, col_name)| {
                let mut val_str = match row.get(col_name) {
                    Some(Value::Null) => "NULL".to_string(),
                    Some(Value::String(s)) => s.clone(),
                    Some(v) => v.to_string(),
                    None => "".to_string(),
                };
                if val_str.len() > widths[i] {
                    val_str.truncate(widths[i].saturating_sub(3));
                    val_str.push_str("...");
                }
                format!("{:<width$}", val_str, width = widths[i])
            })
            .collect();
        println!("{}", row_line.join(" | "));
    }

    println!("\n({} row(s) returned)", rows.len());
}

fn render_rows_table(resp: &Value) {
    let empty_vec = Vec::new();
    let rows_opt = resp
        .get("data")
        .and_then(|d| d.get("rows"))
        .and_then(|r| r.as_array())
        .or_else(|| resp.get("rows").and_then(|r| r.as_array()));

    let rows = rows_opt.unwrap_or(&empty_vec);
    if rows.is_empty() {
        println!("No rows found in table.");
        return;
    }

    let first = rows[0].as_object();
    let col_names: Vec<String> = first
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    if col_names.is_empty() {
        println!("No columns found in row data.");
        return;
    }

    let mut widths: Vec<usize> = col_names.iter().map(|c| c.len().max(6)).collect();
    for row in rows {
        for (i, col_name) in col_names.iter().enumerate() {
            let val_str = match row.get(col_name) {
                Some(Value::Null) => "NULL".to_string(),
                Some(Value::String(s)) => s.clone(),
                Some(v) => v.to_string(),
                None => "".to_string(),
            };
            if val_str.len() > widths[i] {
                widths[i] = val_str.len().min(35);
            }
        }
    }

    let header_line: Vec<String> = col_names
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{:<width$}", c, width = widths[i]))
        .collect();
    println!("{}", header_line.join(" | "));

    let total_width: usize = widths.iter().sum::<usize>() + (widths.len().saturating_sub(1)) * 3;
    println!("{:-<width$}", "", width = total_width.max(10));

    for row in rows {
        let row_line: Vec<String> = col_names
            .iter()
            .enumerate()
            .map(|(i, col_name)| {
                let mut val_str = match row.get(col_name) {
                    Some(Value::Null) => "NULL".to_string(),
                    Some(Value::String(s)) => s.clone(),
                    Some(v) => v.to_string(),
                    None => "".to_string(),
                };
                if val_str.len() > widths[i] {
                    val_str.truncate(widths[i].saturating_sub(3));
                    val_str.push_str("...");
                }
                format!("{:<width$}", val_str, width = widths[i])
            })
            .collect();
        println!("{}", row_line.join(" | "));
    }

    if let Some(cursor) = resp
        .get("pagination")
        .and_then(|p| p.get("next_cursor"))
        .and_then(|c| c.as_str())
    {
        println!("\nNext cursor for pagination: {}", cursor);
    }
}

// ─── Blob Command Handlers ─────────────────────────────────────────────────

async fn handle_blob_command(
    client: AdminClient,
    command: BlobCommands,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        BlobCommands::Stats => {
            let resp = client.get_blob_stats().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let data = resp.get("data").cloned().unwrap_or(resp);
                println!("Axiom Native Blob Storage Telemetry");
                println!("{:-<45}", "");
                println!("{:<28} {:<15}", "METRIC", "VALUE");
                println!("{:-<45}", "");
                let total_blobs = data
                    .get("total_blobs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let namespaces_count = data
                    .get("namespaces_count")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let total_bytes = data
                    .get("total_bytes")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let inline_blobs = data
                    .get("inline_blobs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let external_blobs = data
                    .get("external_blobs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                println!("{:<28} {:<15}", "Total Stored Blobs", total_blobs);
                println!("{:<28} {:<15}", "Active Namespaces", namespaces_count);
                println!(
                    "{:<28} {} ({} B)",
                    "Total Storage Size",
                    format_bytes(total_bytes),
                    total_bytes
                );
                println!("{:<28} {:<15}", "Inline Blobs (<64KB)", inline_blobs);
                println!("{:<28} {:<15}", "External Chunk Blobs", external_blobs);
            }
        }

        BlobCommands::Scrub => {
            let resp = client.scrub_blobs().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let data = resp.get("data").cloned().unwrap_or(resp);
                let verified = data
                    .get("verified_blobs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let corrupted = data
                    .get("corrupted_blobs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                println!("Axiom Storage Integrity Scrub Audit");
                println!("{:-<40}", "");
                println!("Verified Blobs (BLAKE3 OK): {}", verified);
                println!("Corrupted Blobs Detected:   {}", corrupted);
                if corrupted == 0 {
                    println!("\nAll stored objects passed cryptographic integrity verification.");
                } else {
                    println!("\nWARNING: {} corrupted object(s) detected!", corrupted);
                }
            }
        }

        BlobCommands::Sweep => {
            let resp = client.sweep_blobs().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let data = resp.get("data").cloned().unwrap_or(resp);
                let swept = data
                    .get("swept_objects")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                println!("TTL Expiration Sweep Complete.");
                println!("Purged expired objects: {}", swept);
            }
        }

        BlobCommands::Ns { command } => match command {
            BlobNsCommands::List => {
                let resp = client.list_blob_namespaces().await?;
                if format == OutputFormat::Json {
                    println!("{}", serde_json::to_string_pretty(&resp)?);
                } else if format == OutputFormat::Jsonl {
                    if let Some(list) = resp.get("data").and_then(|d| d.as_array()) {
                        for item in list {
                            println!("{}", serde_json::to_string(item)?);
                        }
                    } else {
                        println!("{}", serde_json::to_string(&resp)?);
                    }
                } else {
                    println!(
                        "{:<20} {:<12} {:<18} {:<16}",
                        "NAMESPACE", "OBJECTS", "TOTAL SIZE", "QUOTA"
                    );
                    println!("{:-<70}", "");
                    if let Some(list) = resp.get("data").and_then(|d| d.as_array()) {
                        for ns in list {
                            let name = ns.get("name").and_then(|n| n.as_str()).unwrap_or("-");
                            let objects =
                                ns.get("object_count").and_then(|c| c.as_u64()).unwrap_or(0);
                            let bytes = ns.get("total_bytes").and_then(|b| b.as_u64()).unwrap_or(0);
                            let quota_str =
                                if let Some(q) = ns.get("max_bytes").and_then(|m| m.as_u64()) {
                                    format_bytes(q)
                                } else {
                                    "unlimited".to_string()
                                };
                            println!(
                                "{:<20} {:<12} {:<18} {:<16}",
                                name,
                                objects,
                                format_bytes(bytes),
                                quota_str
                            );
                        }
                    }
                }
            }
            BlobNsCommands::Create { name, max_bytes } => {
                let resp = client.create_blob_namespace(&name, max_bytes).await?;
                if format == OutputFormat::Json {
                    println!("{}", serde_json::to_string_pretty(&resp)?);
                } else if format == OutputFormat::Jsonl {
                    println!("{}", serde_json::to_string(&resp)?);
                } else {
                    println!("Namespace '{}' created successfully.", name);
                }
            }
            BlobNsCommands::Update {
                name,
                new_name,
                max_bytes,
            } => {
                let resp = client
                    .update_blob_namespace(&name, new_name.as_deref(), max_bytes)
                    .await?;
                if format == OutputFormat::Json {
                    println!("{}", serde_json::to_string_pretty(&resp)?);
                } else if format == OutputFormat::Jsonl {
                    println!("{}", serde_json::to_string(&resp)?);
                } else {
                    println!("Namespace '{}' updated successfully.", name);
                }
            }
            BlobNsCommands::Delete { name } => {
                let resp = client.delete_blob_namespace(&name).await?;
                if format == OutputFormat::Json {
                    println!("{}", serde_json::to_string_pretty(&resp)?);
                } else if format == OutputFormat::Jsonl {
                    println!("{}", serde_json::to_string(&resp)?);
                } else {
                    let count = resp
                        .get("data")
                        .and_then(|d| d.get("deleted_objects"))
                        .and_then(|c| c.as_u64())
                        .unwrap_or(0);
                    println!(
                        "Namespace '{}' deleted successfully ({} objects removed).",
                        name, count
                    );
                }
            }
        },

        BlobCommands::List {
            namespace,
            prefix,
            cursor,
            limit,
        } => {
            let resp = client
                .list_blobs(&namespace, prefix.as_deref(), cursor.as_deref(), limit)
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                if let Some(items) = resp
                    .get("data")
                    .and_then(|d| d.get("objects"))
                    .and_then(|o| o.as_array())
                {
                    for item in items {
                        println!("{}", serde_json::to_string(item)?);
                    }
                } else {
                    println!("{}", serde_json::to_string(&resp)?);
                }
            } else {
                println!(
                    "{:<32} {:<14} {:<24} {:<20}",
                    "KEY", "SIZE", "CONTENT TYPE", "CREATED AT"
                );
                println!("{:-<92}", "");
                if let Some(items) = resp
                    .get("data")
                    .and_then(|d| d.get("objects"))
                    .and_then(|o| o.as_array())
                {
                    for obj in items {
                        let key = obj.get("key").and_then(|k| k.as_str()).unwrap_or("-");
                        let size = obj.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
                        let ct = obj
                            .get("content_type")
                            .and_then(|c| c.as_str())
                            .unwrap_or("application/octet-stream");
                        let created = obj
                            .get("created_at_unix")
                            .and_then(|t| t.as_i64())
                            .unwrap_or(0);
                        println!(
                            "{:<32} {:<14} {:<24} {:<20}",
                            key,
                            format_bytes(size),
                            ct,
                            created
                        );
                    }
                }
                if let Some(next) = resp
                    .get("data")
                    .and_then(|d| d.get("next_cursor"))
                    .and_then(|c| c.as_str())
                {
                    println!("\nNext cursor: {}", next);
                }
            }
        }

        BlobCommands::Put {
            namespace,
            object_key,
            file,
            content_type,
            ttl,
        } => {
            let data = if file == "-" {
                use std::io::Read;
                let mut buf = Vec::new();
                std::io::stdin().read_to_end(&mut buf)?;
                buf
            } else {
                tokio::fs::read(&file)
                    .await
                    .map_err(|e| format!("Failed to read file '{}': {}", file, e))?
            };

            let resp = client
                .put_blob(&namespace, &object_key, data, content_type.as_deref(), ttl)
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let hash = resp
                    .get("data")
                    .and_then(|d| d.get("hash"))
                    .and_then(|h| h.as_str())
                    .unwrap_or("-");
                let size = resp
                    .get("data")
                    .and_then(|d| d.get("size"))
                    .and_then(|s| s.as_u64())
                    .unwrap_or(0);
                println!("Blob '{}/{}' uploaded successfully!", namespace, object_key);
                println!("Size:     {}", format_bytes(size));
                println!("BLAKE3:   {}", hash);
            }
        }

        BlobCommands::Get {
            namespace,
            object_key,
            output,
            ticket,
        } => {
            let (bytes, content_type) = client
                .get_blob(&namespace, &object_key, ticket.as_deref())
                .await?;
            if output.as_deref() == Some("-") {
                use std::io::Write;
                std::io::stdout().write_all(&bytes)?;
            } else {
                let dest = match output {
                    Some(out) => out,
                    None => {
                        let default_name =
                            object_key.rsplit(['/', '\\']).next().unwrap_or("blob.bin");
                        default_name.to_string()
                    }
                };
                tokio::fs::write(&dest, &bytes)
                    .await
                    .map_err(|e| format!("Failed to write to destination '{}': {}", dest, e))?;
                if format == OutputFormat::Json || format == OutputFormat::Jsonl {
                    let out = json!({ "success": true, "namespace": namespace, "key": object_key, "destination": dest, "bytes": bytes.len(), "content_type": content_type });
                    if format == OutputFormat::Json {
                        println!("{}", serde_json::to_string_pretty(&out)?);
                    } else {
                        println!("{}", out);
                    }
                } else {
                    println!(
                        "Blob '{}/{}' downloaded successfully.",
                        namespace, object_key
                    );
                    println!("Saved to:     {}", dest);
                    println!("Size:         {}", format_bytes(bytes.len() as u64));
                    if let Some(ct) = content_type {
                        println!("Content-Type: {}", ct);
                    }
                }
            }
        }

        BlobCommands::Head {
            namespace,
            object_key,
        } => {
            let resp = client.head_blob(&namespace, &object_key).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("Object Metadata: '{}/{}'", namespace, object_key);
                println!("{:-<45}", "");
                if let Some(headers) = resp.get("headers").and_then(|h| h.as_object()) {
                    for (k, v) in headers {
                        let v_str = v.as_str().unwrap_or("");
                        println!("{:<24} {}", k, v_str);
                    }
                }
            }
        }

        BlobCommands::Delete {
            namespace,
            object_key,
        } => {
            let resp = client.delete_blob(&namespace, &object_key).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("Blob '{}/{}' deleted successfully.", namespace, object_key);
            }
        }

        BlobCommands::Copy {
            src_namespace,
            src_key,
            dest_key,
            dest_namespace,
            prefix,
        } => {
            let resp = client
                .copy_blob(
                    &src_namespace,
                    &src_key,
                    &dest_key,
                    dest_namespace.as_deref(),
                    prefix,
                )
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let target_ns = dest_namespace.as_deref().unwrap_or(&src_namespace);
                println!(
                    "Copied '{}/{}' -> '{}/{}'.",
                    src_namespace, src_key, target_ns, dest_key
                );
            }
        }

        BlobCommands::Move {
            src_namespace,
            src_key,
            dest_key,
            dest_namespace,
            prefix,
        } => {
            let resp = client
                .move_blob(
                    &src_namespace,
                    &src_key,
                    &dest_key,
                    dest_namespace.as_deref(),
                    prefix,
                )
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let target_ns = dest_namespace.as_deref().unwrap_or(&src_namespace);
                println!(
                    "Moved '{}/{}' -> '{}/{}'.",
                    src_namespace, src_key, target_ns, dest_key
                );
            }
        }

        BlobCommands::DeletePrefix { namespace, prefix } => {
            let resp = client.delete_blob_prefix(&namespace, &prefix).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let deleted = resp
                    .get("data")
                    .and_then(|d| d.get("deleted_objects"))
                    .and_then(|c| c.as_u64())
                    .unwrap_or(0);
                println!(
                    "Deleted {} object(s) with prefix '{}/{}'.",
                    deleted, namespace, prefix
                );
            }
        }

        BlobCommands::Verify {
            namespace,
            object_key,
        } => {
            let resp = client.verify_blob(&namespace, &object_key).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let valid = resp
                    .get("data")
                    .and_then(|d| d.get("valid"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if valid {
                    println!("Cryptographic Integrity: VALID (BLAKE3 hash matches disk chunks)");
                } else {
                    println!("Cryptographic Integrity: CORRUPTED (BLAKE3 hash mismatch)");
                }
            }
        }

        BlobCommands::Ticket {
            namespace,
            object_key,
            operation,
            ttl,
        } => {
            let resp = client
                .create_blob_ticket(&namespace, &object_key, operation.as_deref(), ttl)
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let data = resp.get("data").cloned().unwrap_or(resp);
                let url = data.get("url").and_then(|u| u.as_str()).unwrap_or("-");
                let sig = data
                    .get("ticket")
                    .and_then(|t| t.get("signature"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("-");
                let exp = data
                    .get("ticket")
                    .and_then(|t| t.get("expires_at"))
                    .and_then(|e| e.as_i64())
                    .unwrap_or(0);
                println!("Pre-signed Capability Ticket Issued!");
                println!("{:-<45}", "");
                println!("Signature:  {}", sig);
                println!("Expires At: {} (UNIX)", exp);
                println!("Ticket URL: {}", url);
            }
        }

        BlobCommands::Tickets {
            namespace,
            key,
            all,
            cursor,
            limit,
        } => {
            let resp = client
                .list_blob_tickets(
                    namespace.as_deref(),
                    key.as_deref(),
                    all,
                    cursor.as_deref(),
                    limit,
                )
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                let tickets = resp.get("data").and_then(|d| {
                    d.get("items")
                        .and_then(|i| i.as_array())
                        .or_else(|| d.as_array())
                });
                if let Some(tickets) = tickets {
                    for t in tickets {
                        println!("{}", serde_json::to_string(t)?);
                    }
                } else {
                    println!("{}", serde_json::to_string(&resp)?);
                }
            } else {
                let tickets = resp.get("data").and_then(|d| {
                    d.get("items")
                        .and_then(|i| i.as_array())
                        .or_else(|| d.as_array())
                });
                match tickets {
                    Some(list) if !list.is_empty() => {
                        println!(
                            "{:<6} {:<16} {:<24} {:<6} {:<10} {:<12}",
                            "ID", "NAMESPACE", "KEY", "OP", "STATUS", "EXPIRES"
                        );
                        println!("{:-<78}", "");
                        for t in list {
                            let id = t.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                            let ns = t.get("namespace").and_then(|v| v.as_str()).unwrap_or("-");
                            let k = t.get("key").and_then(|v| v.as_str()).unwrap_or("-");
                            let op = t.get("operation").and_then(|v| v.as_str()).unwrap_or("-");
                            let revoked =
                                t.get("revoked").and_then(|v| v.as_bool()).unwrap_or(false);
                            let exp = t.get("expires_at").and_then(|v| v.as_i64()).unwrap_or(0);
                            let now = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs() as i64;
                            let status = if revoked {
                                "REVOKED"
                            } else if exp < now {
                                "EXPIRED"
                            } else {
                                "ACTIVE"
                            };
                            let exp_str = if exp > now {
                                format!("in {}s", exp - now)
                            } else {
                                format!("{}s ago", now - exp)
                            };
                            println!(
                                "{:<6} {:<16} {:<24} {:<6} {:<10} {:<12}",
                                id, ns, k, op, status, exp_str
                            );
                        }
                        if let Some(next_cur) = resp
                            .get("data")
                            .and_then(|d| d.get("next_cursor"))
                            .and_then(|c| c.as_str())
                        {
                            println!("\nNext cursor: {}", next_cur);
                        }
                    }
                    _ => {
                        println!("No capability tickets found.");
                    }
                }
            }
        }

        BlobCommands::RevokeTicket { signature } => {
            let resp = client.revoke_blob_ticket(&signature).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("Capability ticket '{}' successfully revoked.", signature);
            }
        }
    }
    Ok(())
}

// ─── Authentication & Setup Command Handlers ───────────────────────────────

async fn handle_login_command(
    client: AdminClient,
    username: String,
    password: Option<String>,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    let pass = match password {
        Some(p) if !p.is_empty() => p,
        _ => {
            eprint!("Enter password for admin '{}': ", username);
            rpassword::read_password()?
        }
    };

    let resp = client.login(&username, &pass).await?;
    let token = resp
        .get("data")
        .and_then(|d| d.get("token").or_else(|| d.get("session_token")))
        .and_then(|t| t.as_str())
        .ok_or_else(|| "Server response did not contain session token".to_string())?;

    save_session(token)?;

    if format == OutputFormat::Json {
        println!("{}", serde_json::to_string_pretty(&resp)?);
    } else if format == OutputFormat::Jsonl {
        println!("{}", serde_json::to_string(&resp)?);
    } else {
        println!("Successfully authenticated as '{}'!", username);
        println!("Session Token: {}", token);
        println!("Saved session to disk. Authenticated CLI commands can now run without --key.");
    }
    Ok(())
}

async fn handle_logout_command(
    client: AdminClient,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    let _ = client.logout().await;
    clear_saved_session();

    let res = json!({ "success": true, "message": "Logged out successfully" });
    if format == OutputFormat::Json {
        println!("{}", serde_json::to_string_pretty(&res)?);
    } else if format == OutputFormat::Jsonl {
        println!("{}", serde_json::to_string(&res)?);
    } else {
        println!("Logged out successfully. Removed saved session token.");
    }
    Ok(())
}

async fn handle_setup_command(
    client: AdminClient,
    command: Option<SetupCommands>,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        Some(SetupCommands::Begin) => {
            let resp = client.setup_begin().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                let required = resp
                    .get("data")
                    .and_then(|d| d.get("setup_required"))
                    .and_then(|s| s.as_bool())
                    .unwrap_or(false);
                if required {
                    println!("Initial setup is REQUIRED. Run 'axiom setup' to initialize your admin account.");
                } else {
                    println!("Initial setup is already COMPLETED. The setup wizard is locked.");
                }
            }
        }

        Some(SetupCommands::Account { username, password }) => {
            let pass = match password {
                Some(p) if !p.is_empty() => p,
                _ => {
                    eprint!("Enter password for new admin '{}': ", username);
                    rpassword::read_password()?
                }
            };
            let resp = client.setup_account(&username, &pass).await?;
            if let Some(token) = resp
                .get("data")
                .and_then(|d| d.get("token"))
                .and_then(|t| t.as_str())
            {
                let _ = save_session(token);
            }
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!(
                    "Admin account '{}' created successfully during setup!",
                    username
                );
                if let Some(token) = resp
                    .get("data")
                    .and_then(|d| d.get("token"))
                    .and_then(|t| t.as_str())
                {
                    println!("Session Token: {}", token);
                }
            }
        }

        Some(SetupCommands::Database { alias, url, engine }) => {
            let resp = client
                .setup_database(&alias, &url, engine.as_deref())
                .await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!(
                    "Initial database target '{}' registered and verified successfully.",
                    alias
                );
            }
        }

        Some(SetupCommands::Complete) => {
            let resp = client.setup_complete().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("Axiom setup finalized! Setup wizard is now permanently locked.");
            }
        }

        None => {
            // Interactive setup wizard
            println!("===============================================");
            println!("       Welcome to Axiom Gateway Setup          ");
            println!("===============================================\n");

            let check = client.setup_begin().await?;
            let required = check
                .get("data")
                .and_then(|d| d.get("setup_required"))
                .and_then(|s| s.as_bool())
                .unwrap_or(false);
            if !required {
                println!("Setup wizard has already been completed on this server.");
                return Ok(());
            }

            use std::io::{stdin, stdout, Write};
            print!("1. Choose admin username [admin]: ");
            stdout().flush()?;
            let mut username_buf = String::new();
            stdin().read_line(&mut username_buf)?;
            let username = username_buf.trim();
            let username = if username.is_empty() {
                "admin"
            } else {
                username
            };

            eprint!("2. Enter password (min 8 chars): ");
            let pass = rpassword::read_password()?;
            if pass.len() < 8 {
                return Err("Password must be at least 8 characters".into());
            }

            println!("\nCreating initial admin account...");
            let acc_resp = client.setup_account(username, &pass).await?;
            if let Some(token) = acc_resp
                .get("data")
                .and_then(|d| d.get("token"))
                .and_then(|t| t.as_str())
            {
                let _ = save_session(token);
            }
            println!("Admin account '{}' created and authenticated!\n", username);

            print!("3. Would you like to connect a database now? [Y/n]: ");
            stdout().flush()?;
            let mut db_choice = String::new();
            stdin().read_line(&mut db_choice)?;
            let should_connect_db = !db_choice.trim().eq_ignore_ascii_case("n");

            if should_connect_db {
                print!("   Database alias [main_db]: ");
                stdout().flush()?;
                let mut alias_buf = String::new();
                stdin().read_line(&mut alias_buf)?;
                let alias = alias_buf.trim();
                let alias = if alias.is_empty() { "main_db" } else { alias };

                print!(
                    "   Database connection URL (e.g. postgres://user:pass@localhost:5432/db): "
                );
                stdout().flush()?;
                let mut url_buf = String::new();
                stdin().read_line(&mut url_buf)?;
                let url = url_buf.trim();

                if !url.is_empty() {
                    println!("   Testing and registering connection...");
                    match client.setup_database(alias, url, None).await {
                        Ok(_) => println!(
                            "   Database '{}' connected and verified successfully!",
                            alias
                        ),
                        Err(e) => println!(
                            "   Warning: Failed to connect database ({}). You can add it later.",
                            e
                        ),
                    }
                }
            }

            println!("\nFinalizing setup...");
            let _ = client.setup_complete().await;
            println!("\n===============================================");
            println!("   Axiom Gateway setup completed successfully! ");
            println!("===============================================");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_toml_to_env_string_basic() {
        let toml_sample = r#"
[server]
host = "0.0.0.0"
port = 4500
allowed_ips = ["127.0.0.1", "10.0.0.1"]

[rate_limit]
enabled = true
window = 60
"#;
        let env_str = toml_to_env_string(toml_sample).expect("Should convert to env string");
        assert!(env_str.contains("SERVER__HOST=0.0.0.0"));
        assert!(env_str.contains("SERVER__PORT=4500"));
        assert!(env_str.contains("SERVER__ALLOWED_IPS=[\"127.0.0.1\",\"10.0.0.1\"]"));
        assert!(env_str.contains("RATE_LIMIT__ENABLED=true"));
        assert!(env_str.contains("RATE_LIMIT__WINDOW=60"));
    }

    #[test]
    fn test_toml_to_env_string_quoted_strings() {
        let toml_sample = r#"
[server]
description = "Axiom Gateway = Prod #1"
"#;
        let env_str = toml_to_env_string(toml_sample).expect("Should convert to env string");
        assert!(env_str.contains("SERVER__DESCRIPTION=\"Axiom Gateway = Prod #1\""));
    }

    #[test]
    fn test_format_output_json_jsonl_table() {
        let payload = serde_json::json!({
            "status": "ok",
            "count": 42
        });

        // Test Json formatting
        let json_out = format_output(OutputFormat::Json, &payload)
            .expect("should format json")
            .expect("should be Some");
        assert!(json_out.contains("\"status\": \"ok\""));
        assert!(json_out.contains('\n'));

        // Test Jsonl formatting
        let jsonl_out = format_output(OutputFormat::Jsonl, &payload)
            .expect("should format jsonl")
            .expect("should be Some");
        assert!(jsonl_out.contains("\"status\":\"ok\""));
        assert!(!jsonl_out.contains('\n'));

        // Test Table formatting
        let table_out =
            format_output(OutputFormat::Table, &payload).expect("should handle table format");
        assert!(table_out.is_none());

        // Test render_output with closure execution
        let mut executed = false;
        render_output(OutputFormat::Table, &payload, |_| {
            executed = true;
        })
        .expect("render_output table should succeed");
        assert!(executed);
    }
}
