/*
 * Command-line interface dispatcher coordinating argument parsing, API client calls, and database tasks.
 * Owned by: cli
 * Key deps: clap, rpassword, crate::cli::commands, crate::cli::client, crate::metadata::store
 * Invariants: User management runs out-of-band directly against axiom.db; all other commands communicate via HTTP.
 * Last structural change: Phase 3 initial implementation of CLI entrypoint.
 */

use clap::Parser;
use serde_json::{json, Value};
use std::path::Path;

use crate::client::AdminClient;
use crate::commands::{
    CacheCommands, Cli, Commands, DbCommands, KeyCommands, RoleCommands, UserCommands,
};
use axiom_core::ConfigManager;
use axiom_metadata::MetadataStore;

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

    match cli.command {
        None | Some(Commands::Server(_)) => Ok(false),

        Some(Commands::User { command }) => {
            handle_user_command(command, cli.json).await?;
            Ok(true)
        }

        Some(Commands::Key { command }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_key_command(client, command, cli.json).await?;
            Ok(true)
        }

        Some(Commands::Role { command }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_role_command(client, command, cli.json).await?;
            Ok(true)
        }

        Some(Commands::Db { command }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_db_command(client, command, cli.json).await?;
            Ok(true)
        }

        Some(Commands::Cache { command }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_cache_command(client, command, cli.json).await?;
            Ok(true)
        }

        Some(Commands::Health) => {
            let client = AdminClient::new(&cli.url, cli.key);
            let resp = client.get_health().await?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
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
            if cli.json {
                println!("{}", json!({ "metrics": metrics }));
            } else {
                print!("{}", metrics);
            }
            Ok(true)
        }

        Some(Commands::Benchmark) => {
            run_benchmark(&cli.url, cli.key.as_deref(), cli.json).await?;
            Ok(true)
        }

        Some(Commands::Doctor) => {
            run_doctor(cli.json).await?;
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

async fn handle_user_command(command: UserCommands, json_output: bool) -> Result<(), Box<dyn std::error::Error>> {
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

            if json_output {
                println!("{}", json!({
                    "success": true,
                    "data": { "username": username, "message": "Admin user created successfully" }
                }));
            } else {
                println!("Admin user '{}' created successfully.", username);
            }
        }

        UserCommands::List => {
            let users = MetadataStore::list_users().await
                .map_err(|e| format!("Failed to list users: {}", e))?;

            if json_output {
                println!("{}", serde_json::to_string_pretty(&json!({
                    "success": true,
                    "data": { "users": users }
                }))?);
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

            if json_output {
                println!("{}", json!({
                    "success": true,
                    "data": { "username": username, "message": "User deleted successfully" }
                }));
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
    json_output: bool,
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

            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp)?);
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
            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp)?);
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
            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp)?);
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
            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp)?);
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
    json_output: bool,
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
            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else {
                println!("Role '{}' created successfully.", name);
            }
        }

        RoleCommands::List => {
            let resp = client.list_roles().await?;
            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp)?);
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
            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else {
                println!("Role '{}' updated successfully.", name);
            }
        }

        RoleCommands::Delete { name } => {
            let resp = client.delete_role(&name).await?;
            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp)?);
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
    json_output: bool,
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

            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else {
                println!("Database target '{}' configured successfully.", alias);
            }
        }

        DbCommands::List => {
            let resp = client.list_databases().await?;
            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp)?);
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
            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp)?);
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

        DbCommands::Remove { alias } => {
            let resp = client.delete_database(&alias).await?;
            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else {
                println!("Database target '{}' removed successfully.", alias);
            }
        }
    }
    Ok(())
}

// ─── Diagnostics and System Doctor ─────────────────────────────────────────

async fn run_doctor(json_output: bool) -> Result<(), Box<dyn std::error::Error>> {
    let config_exists = Path::new("config.toml").exists();
    let axiom_db_exists = Path::new("data/axiom.db").exists();

    let mut checks = Vec::new();

    checks.push(json!({
        "item": "Configuration file (config.toml)",
        "status": if config_exists { "PASS" } else { "WARN" },
        "detail": if config_exists { "Found config.toml" } else { "config.toml not found, using internal defaults" }
    }));

    checks.push(json!({
        "item": "Local metadata database (data/axiom.db)",
        "status": if axiom_db_exists { "PASS" } else { "INFO" },
        "detail": if axiom_db_exists { "axiom.db exists" } else { "axiom.db not yet initialized (will create on first boot)" }
    }));

    if json_output {
        println!("{}", serde_json::to_string_pretty(&json!({
            "success": true,
            "data": { "checks": checks }
        }))?);
    } else {
        println!("Axiom Doctor Diagnostic Report");
        println!("{:-<60}", "");
        for c in checks {
            let item = c["item"].as_str().unwrap_or("");
            let status = c["status"].as_str().unwrap_or("");
            let detail = c["detail"].as_str().unwrap_or("");
            println!("[{:<4}] {:<36} - {}", status, item, detail);
        }
    }

    Ok(())
}

// ─── Cache Command Handlers ────────────────────────────────────────────────

async fn handle_cache_command(
    client: AdminClient,
    command: CacheCommands,
    json_output: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        CacheCommands::Stats => {
            let resp = client.get_cache_stats().await?;
            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp)?);
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
            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else {
                println!("All cache entries flushed successfully.");
            }
        }
    }
    Ok(())
}

// ─── Built-in Pipeline Benchmark ───────────────────────────────────────────

async fn run_benchmark(
    base_url: &str,
    auth_key: Option<&str>,
    json_output: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;

    let url = format!("{}/health", base_url.trim_end_matches('/'));

    if !json_output {
        println!("Starting Axiom HTTP Pipeline Benchmark...");
        println!("Target: {}", url);
        println!("Executing 200 sequential probes to measure round-trip pipeline latency...\n");
    }

    let iterations = 200;
    let mut latencies_ms = Vec::with_capacity(iterations);
    let mut successful = 0;
    let mut failed = 0;

    let total_start = std::time::Instant::now();

    for _ in 0..iterations {
        let mut req = client.get(&url);
        if let Some(key) = auth_key {
            req = req.header("X-Axiom-Key", key);
        }

        let req_start = std::time::Instant::now();
        match req.send().await {
            Ok(res) if res.status().is_success() => {
                let elapsed = req_start.elapsed().as_secs_f64() * 1000.0;
                latencies_ms.push(elapsed);
                successful += 1;
            }
            _ => {
                failed += 1;
            }
        }
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

    if json_output {
        let result = json!({
            "suite": "http_pipeline",
            "timestamp_unix": now_unix,
            "total_requests": iterations,
            "successful": successful,
            "failed": failed,
            "duration_seconds": (total_duration * 1000.0).round() / 1000.0,
            "requests_per_second": (rps * 100.0).round() / 100.0,
            "latency_p50_ms": (p50 * 1000.0).round() / 1000.0,
            "latency_p95_ms": (p95 * 1000.0).round() / 1000.0,
            "latency_p99_ms": (p99 * 1000.0).round() / 1000.0,
        });
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        println!("{:<24} {:<16}", "METRIC", "VALUE");
        println!("{:-<40}", "");
        println!("{:<24} {}", "Total Requests", iterations);
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

