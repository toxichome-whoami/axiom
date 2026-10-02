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

use crate::client::AdminClient;
use crate::commands::{
    CacheCommands, Cli, Commands, ConfigCommands, DbCommands, KeyCommands, RoleCommands, UserCommands,
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
            let resp = client.get_health().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("Axiom Gateway Health: ONLINE");
                if let Some(status) = resp.get("status") {
                    println!("Status: {}", status);
                }
            }
            Ok(true)
        }

        Some(Commands::Metrics) => {
            let client = AdminClient::new(&cli.url, cli.key);
            let metrics = client.get_metrics().await?;
            if format == OutputFormat::Json {
                println!("{}", json!({ "metrics": metrics }));
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&json!({ "metrics": metrics }))?);
            } else {
                print!("{}", metrics);
            }
            Ok(true)
        }

        Some(Commands::Benchmark { requests, concurrency }) => {
            run_benchmark(&cli.url, cli.key.as_deref(), requests, concurrency, format).await?;
            Ok(true)
        }

        Some(Commands::Doctor) => {
            run_doctor(&cli.url, format).await?;
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

async fn init_cli_metadata() -> Result<(), String> {
    let _ = ConfigManager::load("config.toml");
    let cfg = ConfigManager::get();
    MetadataStore::init(&cfg.metadata.url, &cfg.metadata.token).await
}

async fn handle_user_command(command: UserCommands, format: OutputFormat) -> Result<(), Box<dyn std::error::Error>> {
    init_cli_metadata().await.map_err(|e| format!("Failed to connect to metadata store: {}", e))?;

    match command {
        UserCommands::Add { username, password } => {
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

            MetadataStore::create_user(&username, &pass).await
                .map_err(|e| format!("User creation failed: {}", e))?;

            let res = json!({
                "success": true,
                "data": { "username": username, "message": "Admin user created successfully" }
            });

            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&res)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&res)?);
            } else {
                println!("Admin user '{}' created successfully.", username);
            }
        }

        UserCommands::List => {
            let users = MetadataStore::list_users().await
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
                println!("{:<6} {:<24} {:<20}", "ID", "USERNAME", "CREATED AT (UNIX)");
                println!("{:-<54}", "");
                for u in users {
                    println!("{:<6} {:<24} {:<20}", u.id, u.username, u.created_at);
                }
            }
        }

        UserCommands::Delete { username } => {
            let deleted = MetadataStore::delete_user(&username).await
                .map_err(|e| format!("Failed to delete user: {}", e))?;

            if !deleted {
                return Err(format!("User '{}' not found", username).into());
            }

            let res = json!({
                "success": true,
                "data": { "username": username, "message": "User deleted successfully" }
            });

            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&res)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&res)?);
            } else {
                println!("User '{}' deleted successfully.", username);
            }
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
                .create_key(&name, role.as_deref(), secret.as_deref(), rate_limit, expires_at)
                .await?;

            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
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
            }
        }

        KeyCommands::List => {
            let resp = client.list_keys().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                if let Some(keys) = resp.get("data").and_then(|d| d.get("keys")).and_then(|k| k.as_array()) {
                    for k in keys {
                        println!("{}", serde_json::to_string(k)?);
                    }
                } else {
                    println!("{}", serde_json::to_string(&resp)?);
                }
            } else {
                println!("{:<24} {:<20} {:<12} {:<20}", "KEY NAME", "ROLE", "RATE LIMIT", "CREATED AT");
                println!("{:-<80}", "");
                if let Some(keys) = resp.get("data").and_then(|d| d.get("keys")).and_then(|k| k.as_array()) {
                    for k in keys {
                        let name = k.get("name").and_then(|n| n.as_str()).unwrap_or("-");
                        let role = k.get("role_name").and_then(|r| r.as_str()).unwrap_or("none");
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

        KeyCommands::Delete { name } => {
            let resp = client.delete_key(&name).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("API Key '{}' deleted successfully.", name);
            }
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
                Some(p_str) => serde_json::from_str(&p_str).map_err(|e| format!("Invalid JSON permissions array: {}", e))?,
                None => json!([]),
            };

            let resp = client.create_role(&name, description.as_deref(), perms_val).await?;
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
                if let Some(roles) = resp.get("data").and_then(|d| d.get("roles")).and_then(|r| r.as_array()) {
                    for r in roles {
                        println!("{}", serde_json::to_string(r)?);
                    }
                } else {
                    println!("{}", serde_json::to_string(&resp)?);
                }
            } else {
                println!("{:<20} {:<32} {:<12}", "ROLE NAME", "DESCRIPTION", "PERMISSIONS");
                println!("{:-<72}", "");
                if let Some(roles) = resp.get("data").and_then(|d| d.get("roles")).and_then(|r| r.as_array()) {
                    for r in roles {
                        let name = r.get("name").and_then(|n| n.as_str()).unwrap_or("-");
                        let desc = r.get("description").and_then(|d| d.as_str()).unwrap_or("");
                        let perm_count = r.get("permissions").and_then(|p| p.as_array()).map(|p| p.len()).unwrap_or(0);
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
                Some(p_str) => Some(serde_json::from_str(&p_str).map_err(|e| format!("Invalid JSON permissions array: {}", e))?),
                None => None,
            };

            let resp = client.update_role(&name, description.as_deref(), perms_val).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("Role '{}' updated successfully.", name);
            }
        }

        RoleCommands::Delete { name } => {
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
            url,
            engine,
            pool_min,
            pool_max,
        } => {
            let resp = client
                .add_database(&alias, &url, engine.as_deref(), pool_min, pool_max)
                .await?;

            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else {
                println!("Database target '{}' configured successfully.", alias);
            }
        }

        DbCommands::List => {
            let resp = client.list_databases().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                if let Some(dbs) = resp.get("data").and_then(|d| d.get("databases")).and_then(|d| d.as_array()) {
                    for db in dbs {
                        println!("{}", serde_json::to_string(db)?);
                    }
                } else {
                    println!("{}", serde_json::to_string(&resp)?);
                }
            } else {
                println!("{:<20} {:<16} {:<10} {:<10}", "ALIAS", "ENGINE", "POOL MIN", "POOL MAX");
                println!("{:-<60}", "");
                if let Some(dbs) = resp.get("data").and_then(|d| d.get("databases")).and_then(|d| d.as_array()) {
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
                let dialect = data.get("dialect").and_then(|d| d.as_str()).unwrap_or("unknown");
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
                let dialect = data.get("dialect").and_then(|d| d.as_str()).unwrap_or("unknown");
                let status = data.get("status").and_then(|s| s.as_str()).unwrap_or("connected");
                let msg = data.get("message").and_then(|m| m.as_str()).unwrap_or("Connection test successful");
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
                println!("{:<26} {:<12}", "L1 Cache Hits (RAM)", data.get("hits_l1").and_then(|v| v.as_u64()).unwrap_or(0));
                println!("{:<26} {:<12}", "L2 Cache Hits (Disk)", data.get("hits_l2").and_then(|v| v.as_u64()).unwrap_or(0));
                println!("{:<26} {:<12}", "Cache Misses", data.get("misses").and_then(|v| v.as_u64()).unwrap_or(0));
                println!("{:<26} {:<12}", "Evictions (LRU)", data.get("evictions").and_then(|v| v.as_u64()).unwrap_or(0));
                println!("{:<26} {:<12}", "Active L1 Entries", data.get("entries_count").and_then(|v| v.as_u64()).unwrap_or(0));
                let hit_rate = data.get("hit_rate_pct").and_then(|v| v.as_f64()).unwrap_or(0.0);
                println!("{:<26} {:.2}%", "Hit Rate", hit_rate);
                let mem = data.get("memory_bytes_approx").and_then(|v| v.as_u64()).unwrap_or(0);
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
        if let Some(entries) = resp.get("data").and_then(|d| d.get("audit")).and_then(|a| a.as_array()) {
            for entry in entries {
                println!("{}", serde_json::to_string(entry)?);
            }
        } else {
            println!("{}", serde_json::to_string(&resp)?);
        }
    } else {
        println!("{:<6} {:<18} {:<16} {:<18} {:<20}", "ID", "TIMESTAMP", "ACTOR", "ACTION", "TARGET");
        println!("{:-<80}", "");
        if let Some(entries) = resp.get("data").and_then(|d| d.get("audit")).and_then(|a| a.as_array()) {
            if entries.is_empty() {
                println!("No audit records found.");
            } else {
                for e in entries {
                    let id = e.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                    let ts = e.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);
                    let actor = e.get("actor").and_then(|v| v.as_str()).unwrap_or("-");
                    let action = e.get("action").and_then(|v| v.as_str()).unwrap_or("-");
                    let target = e.get("target").and_then(|v| v.as_str()).unwrap_or("-");
                    println!("{:<6} {:<18} {:<16} {:<18} {:<20}", id, ts, actor, action, target);
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

// ─── Diagnostics and System Doctor ─────────────────────────────────────────

async fn run_doctor(base_url: &str, format: OutputFormat) -> Result<(), Box<dyn std::error::Error>> {
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

    // 4. Runtime environment
    checks.push(json!({
        "item": "Host environment",
        "status": "PASS",
        "detail": format!("OS: {}, Arch: {}", std::env::consts::OS, std::env::consts::ARCH)
    }));

    if format == OutputFormat::Json {
        println!("{}", serde_json::to_string_pretty(&json!({
            "success": true,
            "data": { "checks": checks }
        }))?);
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
        println!(" Target: {} | Requests: {} | Concurrency: {}", url, requests, concurrency);
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
        latencies_ms[(latencies_ms.len() as f64 * 0.95).min((latencies_ms.len() - 1) as f64) as usize]
    } else {
        0.0
    };
    let p99 = if !latencies_ms.is_empty() {
        latencies_ms[(latencies_ms.len() as f64 * 0.99).min((latencies_ms.len() - 1) as f64) as usize]
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
        ConfigCommands::Init { path, force, to_env } => {
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
                    return Err(format!("File '{}' already exists. Use --force to overwrite.", path).into());
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
                    println!("{}", json!({ "status": "success", "file": path, "action": "created" }));
                } else if format == OutputFormat::Jsonl {
                    println!("{}", serde_json::to_string(&json!({ "status": "success", "file": path, "action": "created" }))?);
                } else {
                    println!("Successfully initialized new configuration file at '{}'.", path);
                }
            }

            if do_convert || to_env {
                let env_path = ".env";
                let toml_content = std::fs::read_to_string(&path)?;
                let env_content = toml_to_env_string(&toml_content)?;
                std::fs::write(env_path, env_content)?;
                if format == OutputFormat::Json {
                    println!("{}", json!({ "status": "success", "file": env_path, "action": "converted" }));
                } else if format == OutputFormat::Jsonl {
                    println!("{}", serde_json::to_string(&json!({ "status": "success", "file": env_path, "action": "converted" }))?);
                } else {
                    println!("Successfully converted '{}' into '{}'.", path, env_path);
                }
            }

            Ok(())
        }

        ConfigCommands::ToEnv { input, output, force } => {
            let out_path = Path::new(&output);
            if out_path.exists() && !force {
                print!("Output file '{}' already exists. Overwrite? (y/N): ", output);
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
                    return Err(format!("File '{}' already exists. Use --force to overwrite.", output).into());
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
                println!("{}", json!({ "status": "success", "input": input, "output": output }));
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&json!({ "status": "success", "input": input, "output": output }))?);
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
    let mut lines = Vec::new();
    lines.push("# ─────────────────────────────────────────────────────────────────────────────".to_string());
    lines.push("# Axiom Environment Configuration (Generated from TOML)".to_string());
    lines.push("# ─────────────────────────────────────────────────────────────────────────────".to_string());
    lines.push("".to_string());

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
            let elements: Vec<String> = arr.iter().map(|item| match item {
                toml::Value::String(s) => format!("\"{}\"", s.replace('"', "\\\"")),
                other => other.to_string(),
            }).collect();
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
}
