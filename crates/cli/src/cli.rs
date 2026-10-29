/*
 * Command-line interface dispatcher coordinating argument parsing, API client calls, and database tasks.
 * Owned by: crates/cli
 * Key deps: clap, rpassword, toml, crate::commands, crate::client, axiom_metadata::MetadataStore
 * Invariants: User management runs out-of-band directly against axiom.db; all other commands communicate via HTTP.
 * Last structural change: Updated CLI features (audit, reload, test-url, concurrent bench, doctor probes, jsonl).
 */

use clap::Parser;
use serde_json::{json, Value};
use std::io::IsTerminal;
use std::path::Path;

use crate::client::AdminClient;
use crate::commands::{
    BlobCommands, BlobNsCommands, CacheCommands, Cli, ClusterCommands, Commands, ConfigCommands,
    DbCommands, KeyCommands, RoleCommands, UserCommands,
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

/// Resets Windows console mode to standard interactive settings (line input + echo input + processed input)
/// to ensure any previous abnormal termination or raw terminal mode leaves console input working normally.
#[cfg(windows)]
pub fn reset_windows_console_mode() {
    unsafe {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetStdHandle(nStdHandle: u32) -> *mut std::ffi::c_void;
            fn GetConsoleMode(hConsoleHandle: *mut std::ffi::c_void, lpMode: *mut u32) -> i32;
            fn SetConsoleMode(hConsoleHandle: *mut std::ffi::c_void, dwMode: u32) -> i32;
        }
        const STD_INPUT_HANDLE: u32 = -10i32 as u32;
        const ENABLE_PROCESSED_INPUT: u32 = 0x0001;
        const ENABLE_LINE_INPUT: u32 = 0x0002;
        const ENABLE_ECHO_INPUT: u32 = 0x0004;
        const ENABLE_EXTENDED_FLAGS: u32 = 0x0080;
        const ENABLE_QUICK_EDIT_MODE: u32 = 0x0040;

        let handle = GetStdHandle(STD_INPUT_HANDLE);
        if !handle.is_null() && handle != (-1isize as *mut std::ffi::c_void) {
            let mut mode = 0u32;
            if GetConsoleMode(handle, &mut mode) != 0 {
                let new_mode = mode
                    | ENABLE_PROCESSED_INPUT
                    | ENABLE_LINE_INPUT
                    | ENABLE_ECHO_INPUT
                    | ENABLE_EXTENDED_FLAGS
                    | ENABLE_QUICK_EDIT_MODE;
                let _ = SetConsoleMode(handle, new_mode);
            }
        }
    }
}

#[cfg(not(windows))]
pub fn reset_windows_console_mode() {}

/// Reads a password or secret input securely, falling back to standard input
/// when running in non-interactive, piped, or pseudo-terminal environments where /dev/tty is absent.
pub fn read_secret_input() -> Result<String, Box<dyn std::error::Error>> {
    let res = match rpassword::read_password() {
        Ok(pass) => Ok(pass),
        Err(_) => {
            let mut line = String::new();
            std::io::stdin().read_line(&mut line)?;
            Ok(line.trim_end_matches(['\r', '\n']).to_string())
        }
    };
    reset_windows_console_mode();
    res
}

/// Prints the interactive quickstart banner and guided workflow overview for bare terminal execution.
pub fn print_quickstart_guide() {
    println!(
        "Axiom API Gateway & Data Access Platform (v{})",
        env!("CARGO_PKG_VERSION")
    );
    println!(
        "High-performance multi-dialect gateway, embedded metadata, and native blob storage.\n"
    );
    println!("QUICKSTART WORKFLOWS:");
    println!(
        "  1. Start Gateway:       axiom server          (Launch daemon on http://127.0.0.1:4500)"
    );
    println!(
        "  2. Web UI Setup:        http://127.0.0.1:4500/system  (First-run setup wizard & dashboard)"
    );
    println!(
        "  3. Super Admin CLI:     axiom user show       (Inspect root super admin or reset credentials)"
    );
    println!(
        "  4. Check Diagnostics:   axiom doctor          (Validate environment, ports & database connectivity)"
    );
    println!(
        "  5. Inspect State:       axiom status          (View live gateway health and cluster state)\n"
    );
    println!("PRIMARY COMMANDS:");
    println!(
        "  axiom db [ls|add|test|rm]     Upstream database connections, pooling & reachability"
    );
    println!(
        "  axiom blob [stats|scrub|ns]   Native blob storage, telemetry, scrubbing & namespaces"
    );
    println!(
        "  axiom user [show|update]      Super Admin recovery & credentials (direct host metadata DB)"
    );
    println!("  axiom key [ls|create|rotate]  Machine API keys, rate limits, and tokens");
    println!("  axiom role [ls|create|update] RBAC permissions and role assignments\n");
    println!("Run 'axiom --help' for the complete command reference, flags, and options.");
}

/// Dispatches CLI commands provided via command-line arguments.
/// CONTRACT:
///  - Returns `Ok(false)` if the server daemon should start.
///  - Returns `Ok(true)` if a CLI command was executed and the process should terminate.
///  - Returns `Err` on unrecoverable command or network failure.
///  - Side effects: Modifies console output; may modify metadata store or make HTTP requests.
pub async fn run() -> Result<bool, Box<dyn std::error::Error>> {
    reset_windows_console_mode();
    let args: Vec<String> = std::env::args().collect();
    // Fast-path: In interactive terminals, bare invocation displays the quickstart guide.
    // In headless/piped environments (e.g. Docker container entrypoints), launch the server daemon.
    if args.len() <= 1 {
        if std::io::stdout().is_terminal() {
            print_quickstart_guide();
            return Ok(true);
        } else {
            return Ok(false);
        }
    }

    // Intercept version flag handled upstream
    if args.iter().any(|arg| arg == "--version" || arg == "-v") {
        return Ok(false);
    }

    // Intelligent argument normalization:
    // If user ran `axiom -h <subcommand>` or `axiom --help <subcommand>`,
    // re-order so clap prints help for that specific subcommand instead of root help.
    let mut normalized_args = Vec::new();
    let mut pending_help = false;
    for (i, arg) in args.iter().enumerate() {
        if i == 0 {
            normalized_args.push(arg.clone());
            continue;
        }
        if (arg == "-h" || arg == "--help") && i == 1 && args.len() > 2 && !args[2].starts_with('-')
        {
            pending_help = true;
            continue;
        }
        normalized_args.push(arg.clone());
    }
    if pending_help {
        normalized_args.push("--help".to_string());
    }

    let cli = Cli::parse_from(&normalized_args);
    let format = if cli.jsonl {
        OutputFormat::Jsonl
    } else if cli.json {
        OutputFormat::Json
    } else {
        OutputFormat::Table
    };

    if cli.brief {
        let brief_data = json!({
            "name": "axiom",
            "version": env!("CARGO_PKG_VERSION"),
            "description": "Axiom API Gateway & Data Access Platform CLI",
            "capabilities": [
                "server",
                "setup",
                "user",
                "key",
                "role",
                "db",
                "blob",
                "cluster",
                "mcp",
                "cache",
                "audit",
                "health",
                "metrics",
                "benchmark",
                "doctor",
                "config",
                "completions"
            ],
            "docs": "https://github.com/Toxichome/axiom"
        });
        if format == OutputFormat::Json {
            println!("{}", serde_json::to_string_pretty(&brief_data)?);
        } else if format == OutputFormat::Jsonl {
            println!("{}", serde_json::to_string(&brief_data)?);
        } else {
            println!(
                "Axiom CLI v{} — High-Performance API Gateway & Data Platform",
                env!("CARGO_PKG_VERSION")
            );
            println!("Unified data federation, distributed blob storage, cluster mesh, and Model Context Protocol (MCP) server.");
            println!("Run 'axiom --help' for full subcommand documentation or 'axiom completions <shell>' for autocompletion.");
        }
        return Ok(true);
    }

    let dispatch_result: Result<bool, Box<dyn std::error::Error>> = match cli.command {
        None | Some(Commands::Server(_)) => Ok(false),

        Some(Commands::Setup) => {
            if format == OutputFormat::Json || format == OutputFormat::Jsonl {
                println!(
                    "{}",
                    serde_json::json!({
                        "status": "ok",
                        "setup_mode": "web_ui",
                        "url": format!("{}/system", cli.url),
                        "server_command": "axiom server",
                        "superadmin_command": "axiom user show",
                        "message": "Start gateway with 'axiom server' and complete initial setup at /system"
                    })
                );
            } else {
                println!("Axiom Gateway Setup & Initialization:");
                println!("  1. Start Gateway:       axiom server        (Launch daemon on http://127.0.0.1:4500)");
                println!(
                    "  2. Web Setup Wizard:    {}/system  (Connect databases & setup master admin)",
                    cli.url
                );
                println!("  3. Super Admin CLI:     axiom user show     (Inspect or update root credentials directly offline)");
            }
            Ok(true)
        }

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

        Some(Commands::Cache { command }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_cache_command(client, command, format).await?;
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
                    println!("Gateway Target:  {}", cli.url);
                    println!("Axiom Status:    {}", status.to_uppercase());
                    println!("{:-<50}", "");
                    println!("Uptime:          {} seconds", uptime);
                    if client.auth_key().is_some() {
                        println!("Auth Context:    Active (API key or session token provided)");
                    } else {
                        println!(
                            "Auth Context:    Unauthenticated (provide '--api-key <KEY>' or set AXIOM_KEY)"
                        );
                    }
                    if let Some(sys) = d.get("system") {
                        let cpu = sys
                            .get("cpu_percent")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0);
                        let mem = sys
                            .get("memory_used_mb")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0);
                        println!("System:          CPU: {:.1}% | Memory: {} MB", cpu, mem);
                    }
                    if let Some(dbs) = d.get("databases").and_then(|v| v.as_object()) {
                        if !dbs.is_empty() {
                            println!("\nDatabases ({} registered):", dbs.len());
                            for (alias, st) in dbs {
                                let st_str = st.as_str().unwrap_or("unknown");
                                println!("  - {:<18}: {}", alias, st_str.to_uppercase());
                            }
                        }
                    }
                } else {
                    println!("Gateway Target:  {}", cli.url);
                    println!("Axiom Status:    ONLINE");
                    if let Some(status) = resp.get("status") {
                        println!("Details:         {}", status);
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

        Some(Commands::Mcp { command }) => {
            let client = AdminClient::new(&cli.url, cli.key);
            handle_mcp_command(client, command, format).await?;
            Ok(true)
        }

        Some(Commands::Version(args)) => {
            let root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
            let (action, target_value) = match args.action {
                Some(crate::commands::VersionSubcommand::Get) => (Some("get"), None),
                Some(crate::commands::VersionSubcommand::Bump { target }) => (Some("bump"), Some(target)),
                Some(crate::commands::VersionSubcommand::Set { version }) => (Some("set"), Some(version)),
                None => {
                    if let Some(target) = args.direct_target {
                        if target == "get" {
                            (Some("get"), None)
                        } else if target == "bump" {
                            (Some("bump"), Some("patch".to_string()))
                        } else {
                            (Some("set"), Some(target))
                        }
                    } else {
                        (Some("get"), None)
                    }
                }
            };

            let output = crate::commands::version::execute_version_operation(
                &root,
                action,
                target_value.as_deref(),
                args.dry_run,
                args.no_cargo,
            ).map_err(|e| Box::<dyn std::error::Error>::from(e))?;

            println!("{}", output);
            Ok(true)
        }

        Some(Commands::Completions { shell }) => {
            let mut cmd = <Cli as clap::CommandFactory>::command();
            clap_complete::generate(shell, &mut cmd, "axiom", &mut std::io::stdout());
            Ok(true)
        }
    };

    match dispatch_result {
        Ok(should_run) => Ok(should_run),
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
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
    command: Option<UserCommands>,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    let cfg_path = match &command {
        Some(UserCommands::Show { config }) => config.as_deref(),
        Some(UserCommands::Update { config, .. }) => config.as_deref(),
        None => None,
    };
    init_cli_metadata(cfg_path)
        .await
        .map_err(|e| format!("Failed to connect to metadata store: {}", e))?;

    let cmd = command.unwrap_or(UserCommands::Show { config: None });

    match cmd {
        UserCommands::Show { .. } => {
            let admin_opt = MetadataStore::get_super_admin()
                .await
                .map_err(|e| format!("Failed to retrieve Super Administrator: {}", e))?;

            match admin_opt {
                None => {
                    let res = json!({
                        "success": false,
                        "error": "No Super Administrator account found. Initialize Axiom via the web UI setup wizard."
                    });
                    if format == OutputFormat::Json {
                        println!("{}", serde_json::to_string_pretty(&res)?);
                    } else if format == OutputFormat::Jsonl {
                        println!("{}", serde_json::to_string(&res)?);
                    } else {
                        eprintln!("No Super Administrator account found in metadata store.");
                        eprintln!("Please initialize Axiom via the web UI setup wizard or start the server.");
                    }
                }
                Some(admin) => {
                    let created_formatted = chrono::DateTime::from_timestamp(admin.created_at, 0)
                        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S UTC").to_string())
                        .unwrap_or_else(|| admin.created_at.to_string());
                    let updated_formatted = chrono::DateTime::from_timestamp(admin.updated_at, 0)
                        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S UTC").to_string())
                        .unwrap_or_else(|| admin.updated_at.to_string());

                    let res = json!({
                        "success": true,
                        "data": {
                            "id": admin.id,
                            "username": admin.username,
                            "email": admin.email,
                            "is_super_admin": true,
                            "access_level": "Root Super Administrator",
                            "created_at": admin.created_at,
                            "created_at_formatted": created_formatted,
                            "updated_at": admin.updated_at,
                            "updated_at_formatted": updated_formatted,
                        }
                    });

                    if format == OutputFormat::Json {
                        println!("{}", serde_json::to_string_pretty(&res)?);
                    } else if format == OutputFormat::Jsonl {
                        println!("{}", serde_json::to_string(&res)?);
                    } else {
                        println!("{:-<72}", "");
                        println!(
                            "            AXIOM ROOT SUPER ADMINISTRATOR (HOST RECOVERY)       "
                        );
                        println!("{:-<72}", "");
                        println!("{:<16} : {}", "ID", admin.id);
                        println!("{:<16} : {}", "Username", admin.username);
                        println!(
                            "{:<16} : {}",
                            "Email",
                            admin.email.as_deref().unwrap_or("-")
                        );
                        println!(
                            "{:<16} : Root Super Admin (Full Host & PBAC Authority)",
                            "Access Level"
                        );
                        println!(
                            "{:<16} : {} (unix: {})",
                            "Created At", created_formatted, admin.created_at
                        );
                        println!(
                            "{:<16} : {} (unix: {})",
                            "Updated At", updated_formatted, admin.updated_at
                        );
                        println!("{:-<72}", "");
                        println!("Note: Secondary user accounts and PBAC roles are managed via the Web UI.");
                        println!("Use 'axiom user update' to reset root credentials from this host machine.");
                    }
                }
            }
        }

        UserCommands::Update {
            new_username,
            username,
            email,
            password,
            ..
        } => {
            let admin = MetadataStore::get_super_admin()
                .await
                .map_err(|e| format!("Failed to retrieve Super Administrator: {}", e))?
                .ok_or_else(|| "No Super Administrator found in metadata store. Run setup wizard to create the initial admin.".to_string())?;

            let mut final_username: Option<String> =
                username.or(new_username).filter(|u| !u.trim().is_empty());
            let mut final_email: Option<String> = email.filter(|e| !e.trim().is_empty());
            let mut final_password: Option<String> = password.filter(|p| !p.trim().is_empty());

            // If no flags were provided at all, prompt interactively for recovery on the host terminal
            if final_username.is_none() && final_email.is_none() && final_password.is_none() {
                use std::io::Write;
                reset_windows_console_mode();
                eprintln!("{:-<72}", "");
                eprintln!("       SUPER ADMINISTRATOR INTERACTIVE CREDENTIAL RECOVERY      ");
                eprintln!("{:-<72}", "");
                eprintln!("Current Username : {}", admin.username);
                eprintln!(
                    "Current Email    : {}",
                    admin.email.as_deref().unwrap_or("-")
                );
                eprintln!("(Press Enter without typing to keep an existing value unchanged)\n");

                eprint!("Enter new username [{}]: ", admin.username);
                let _ = std::io::stderr().flush();
                let mut u_buf = String::new();
                std::io::stdin().read_line(&mut u_buf)?;
                let u_trimmed = u_buf.trim();
                if !u_trimmed.is_empty() {
                    final_username = Some(u_trimmed.to_string());
                }

                eprint!(
                    "Enter new email [{}]: ",
                    admin.email.as_deref().unwrap_or("-")
                );
                let _ = std::io::stderr().flush();
                let mut e_buf = String::new();
                std::io::stdin().read_line(&mut e_buf)?;
                let e_trimmed = e_buf.trim();
                if !e_trimmed.is_empty() {
                    final_email = Some(e_trimmed.to_string());
                }

                eprint!("Enter new password (leave blank to keep unchanged): ");
                let _ = std::io::stderr().flush();
                let p_input = read_secret_input()?;
                let p_trimmed = p_input.trim();
                if !p_trimmed.is_empty() {
                    final_password = Some(p_trimmed.to_string());
                }
                eprintln!();
            }

            if final_username.is_none() && final_email.is_none() && final_password.is_none() {
                if format == OutputFormat::Json || format == OutputFormat::Jsonl {
                    let res = json!({
                        "success": true,
                        "data": {
                            "message": "No changes specified. Super Administrator account unchanged.",
                            "username": admin.username,
                            "email": admin.email,
                            "password_updated": false
                        }
                    });
                    render_output(format, &res, |_| {})?;
                } else {
                    println!("No changes specified. Super Administrator account unchanged.");
                }
                return Ok(());
            }

            let email_opt = final_email.as_deref().map(Some);
            let updated = MetadataStore::update_user_by_id(
                admin.id,
                final_username.as_deref(),
                email_opt,
                final_password.as_deref(),
                None,
                None,
            )
            .await
            .map_err(|e| format!("Failed to update Super Administrator: {}", e))?;

            if !updated {
                return Err("Failed to update Super Administrator: account not found".into());
            }

            let updated_admin = MetadataStore::get_super_admin()
                .await
                .map_err(|e| format!("Failed to retrieve updated Super Administrator: {}", e))?
                .unwrap_or(admin);

            let res = json!({
                "success": true,
                "data": {
                    "message": "Super Administrator updated successfully",
                    "id": updated_admin.id,
                    "username": updated_admin.username,
                    "email": updated_admin.email,
                    "password_updated": final_password.is_some()
                }
            });

            render_output(format, &res, |_| {
                println!("{:-<72}", "");
                println!("    SUPER ADMINISTRATOR CREDENTIALS UPDATED SUCCESSFULLY        ");
                println!("{:-<72}", "");
                println!("{:<16} : {}", "ID", updated_admin.id);
                println!("{:<16} : {}", "Username", updated_admin.username);
                println!(
                    "{:<16} : {}",
                    "Email",
                    updated_admin.email.as_deref().unwrap_or("-")
                );
                println!(
                    "{:<16} : {}",
                    "Password",
                    if final_password.is_some() {
                        "[UPDATED]"
                    } else {
                        "[UNCHANGED]"
                    }
                );
                println!("{:-<72}", "");
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
            name_flag,
            role,
            secret,
            rate_limit,
            expires_at,
        } => {
            let name = name
                .or(name_flag)
                .ok_or("API key name is required (positional or via -n/--name)")?;
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

        KeyCommands::Rotate { name, name_flag } => {
            let name = name
                .or(name_flag)
                .ok_or("API key name is required (positional or via -n/--name)")?;
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
            name_flag,
            role,
            rate_limit,
            expires_at,
        } => {
            let name = name
                .or(name_flag)
                .ok_or("API key name is required (positional or via -n/--name)")?;
            let resp = client
                .update_key(&name, role.as_deref(), rate_limit, expires_at)
                .await?;
            render_output(format, &resp, |_| {
                println!("API Key '{}' updated successfully.", name);
            })?;
        }

        KeyCommands::Remove { name, name_flag } => {
            let name = name
                .or(name_flag)
                .ok_or("API key name is required (positional or via -n/--name)")?;
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
            name_flag,
            description,
            permissions,
        } => {
            let name = name
                .or(name_flag)
                .ok_or("Role name is required (positional or via -n/--name)")?;
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
            name_flag,
            description,
            permissions,
        } => {
            let name = name
                .or(name_flag)
                .ok_or("Role name is required (positional or via -n/--name)")?;
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

        RoleCommands::Remove { name, name_flag } => {
            let name = name
                .or(name_flag)
                .ok_or("Role name is required (positional or via -n/--name)")?;
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
            alias_flag,
            connection_url,
            engine,
            pool_min,
            pool_max,
        } => {
            let alias = alias
                .or(alias_flag)
                .ok_or("Database alias is required (positional or via -a/--alias)")?;
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
            alias_flag,
            new_alias,
            connection_url,
            engine,
            pool_min,
            pool_max,
        } => {
            let alias = alias
                .or(alias_flag)
                .ok_or("Database alias is required (positional or via -a/--alias)")?;
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
                    println!("{:-<60}", "");
                    println!("Total: {} database(s)", dbs.len());
                }
            }
        }

        DbCommands::Test { alias, alias_flag } => {
            let alias = alias
                .or(alias_flag)
                .ok_or("Database alias is required (positional or via -a/--alias)")?;
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

        DbCommands::TestUrl {
            url,
            url_flag,
            alias,
        } => {
            let url = url
                .or(url_flag)
                .ok_or("Database URL is required (positional or via -c/--conn/--url)")?;
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

        DbCommands::Remove { alias, alias_flag } => {
            let alias = alias
                .or(alias_flag)
                .ok_or("Database alias is required (positional or via -a/--alias)")?;
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

// ─── Reload Command Handlers ────────────────────────────────────────────────

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

        ClusterCommands::Connect {
            target_url,
            url_flag,
            secret,
        } => {
            let target_url = target_url
                .or(url_flag)
                .ok_or("Remote peer URL is required (--url, -t, or positional)")?;
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

        ClusterCommands::Remove { node_id, id_flag } => {
            let node_id = node_id
                .or(id_flag)
                .ok_or("Peer node ID is required (--id, -i, or positional)")?;
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
            id_flag,
            moniker,
            url,
            secret,
        } => {
            let node_id = node_id
                .or(id_flag)
                .ok_or("Peer node ID is required (--id, -i, or positional)")?;
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

        ClusterCommands::Ping { node_id, id_flag } => {
            let node_id = node_id
                .or(id_flag)
                .ok_or("Peer node ID is required (--id, -i, or positional)")?;
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

        ClusterCommands::Moniker {
            moniker,
            moniker_flag,
        } => {
            let moniker = moniker
                .or(moniker_flag)
                .ok_or("Cluster moniker is required (--moniker, -m, or positional)")?;
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
                        "{:<22} {:<12} {:<10} {:<18} {:<16}",
                        "NAMESPACE", "VISIBILITY", "OBJECTS", "TOTAL SIZE", "QUOTA"
                    );
                    println!("{:-<80}", "");
                    if let Some(list) = resp.get("data").and_then(|d| d.as_array()) {
                        for ns in list {
                            let name = ns.get("name").and_then(|n| n.as_str()).unwrap_or("-");
                            let is_pub = ns
                                .get("is_public")
                                .and_then(|p| p.as_bool())
                                .unwrap_or(false);
                            let vis = if is_pub { "public" } else { "private" };
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
                                "{:<22} {:<12} {:<10} {:<18} {:<16}",
                                name,
                                vis,
                                objects,
                                format_bytes(bytes),
                                quota_str
                            );
                        }
                    }
                }
            }
            BlobNsCommands::Get { name, name_flag } => {
                let name = name
                    .or(name_flag)
                    .ok_or("Namespace name is required (--name, -n, or positional)")?;
                let resp = client.get_blob_namespace(&name).await?;
                if format == OutputFormat::Json {
                    println!("{}", serde_json::to_string_pretty(&resp)?);
                } else if format == OutputFormat::Jsonl {
                    println!("{}", serde_json::to_string(&resp)?);
                } else {
                    let data = resp.get("data").cloned().unwrap_or(resp);
                    let ns_name = data.get("name").and_then(|n| n.as_str()).unwrap_or(&name);
                    let is_pub = data
                        .get("is_public")
                        .and_then(|p| p.as_bool())
                        .unwrap_or(false);
                    let vis = if is_pub { "public" } else { "private" };
                    let objects = data
                        .get("object_count")
                        .and_then(|c| c.as_u64())
                        .unwrap_or(0);
                    let bytes = data
                        .get("total_bytes")
                        .and_then(|b| b.as_u64())
                        .unwrap_or(0);
                    let quota_str = if let Some(q) = data.get("max_bytes").and_then(|m| m.as_u64())
                    {
                        format_bytes(q)
                    } else {
                        "unlimited".to_string()
                    };
                    let created = data.get("created_at").and_then(|c| c.as_i64()).unwrap_or(0);

                    println!("Storage Namespace: {}", ns_name);
                    println!("{:-<45}", "");
                    println!("{:<20} {}", "Visibility:", vis);
                    println!("{:<20} {}", "Object Count:", objects);
                    println!(
                        "{:<20} {} ({} bytes)",
                        "Total Size:",
                        format_bytes(bytes),
                        bytes
                    );
                    println!("{:<20} {}", "Storage Quota:", quota_str);
                    println!("{:<20} {}", "Created At (UNIX):", created);
                }
            }
            BlobNsCommands::Usage { name, name_flag } => {
                let name = name
                    .or(name_flag)
                    .ok_or("Namespace name is required (--name, -n, or positional)")?;
                let resp = client.get_blob_namespace_usage(&name).await?;
                if format == OutputFormat::Json {
                    println!("{}", serde_json::to_string_pretty(&resp)?);
                } else if format == OutputFormat::Jsonl {
                    println!("{}", serde_json::to_string(&resp)?);
                } else {
                    let data = resp.get("data").cloned().unwrap_or(resp);
                    let ns_name = data
                        .get("namespace")
                        .and_then(|n| n.as_str())
                        .unwrap_or(&name);
                    let is_pub = data
                        .get("is_public")
                        .and_then(|p| p.as_bool())
                        .unwrap_or(false);
                    let vis = if is_pub { "public" } else { "private" };
                    let objects = data
                        .get("object_count")
                        .and_then(|c| c.as_u64())
                        .unwrap_or(0);
                    let used_bytes = data.get("used_bytes").and_then(|b| b.as_u64()).unwrap_or(0);
                    let max_str = if let Some(m) = data.get("max_bytes").and_then(|q| q.as_u64()) {
                        format_bytes(m)
                    } else {
                        "unlimited".to_string()
                    };
                    let rem_str =
                        if let Some(r) = data.get("remaining_bytes").and_then(|q| q.as_u64()) {
                            format_bytes(r)
                        } else {
                            "unlimited".to_string()
                        };
                    let pct_str =
                        if let Some(p) = data.get("percent_used").and_then(|pct| pct.as_f64()) {
                            format!("{:.2}%", p)
                        } else {
                            "N/A".to_string()
                        };
                    let exceeded = data
                        .get("is_quota_exceeded")
                        .and_then(|e| e.as_bool())
                        .unwrap_or(false);

                    println!("Namespace Storage Usage & Quota Headroom: {}", ns_name);
                    println!("{:-<50}", "");
                    println!("{:<22} {}", "Visibility:", vis);
                    println!("{:<22} {}", "Stored Objects:", objects);
                    println!(
                        "{:<22} {} ({} bytes)",
                        "Used Storage:",
                        format_bytes(used_bytes),
                        used_bytes
                    );
                    println!("{:<22} {}", "Quota Limit:", max_str);
                    println!("{:<22} {}", "Remaining Headroom:", rem_str);
                    println!("{:<22} {}", "Quota Utilization:", pct_str);
                    println!(
                        "{:<22} {}",
                        "Quota Status:",
                        if exceeded { "EXCEEDED" } else { "HEALTHY" }
                    );
                }
            }
            BlobNsCommands::Create {
                name,
                name_flag,
                max_bytes,
                public,
            } => {
                let name = name
                    .or(name_flag)
                    .ok_or("Namespace name is required (--name, -n, or positional)")?;
                let resp = client
                    .create_blob_namespace(&name, max_bytes, Some(public))
                    .await?;
                if format == OutputFormat::Json {
                    println!("{}", serde_json::to_string_pretty(&resp)?);
                } else if format == OutputFormat::Jsonl {
                    println!("{}", serde_json::to_string(&resp)?);
                } else {
                    let vis_desc = if public { "public" } else { "private" };
                    println!(
                        "Namespace '{}' created successfully (visibility: {}).",
                        name, vis_desc
                    );
                }
            }
            BlobNsCommands::Update {
                name,
                name_flag,
                new_name,
                max_bytes,
                public,
            } => {
                let name = name
                    .or(name_flag)
                    .ok_or("Namespace name is required (--name, -n, or positional)")?;
                let resp = client
                    .update_blob_namespace(&name, new_name.as_deref(), max_bytes, public)
                    .await?;
                if format == OutputFormat::Json {
                    println!("{}", serde_json::to_string_pretty(&resp)?);
                } else if format == OutputFormat::Jsonl {
                    println!("{}", serde_json::to_string(&resp)?);
                } else {
                    println!("Namespace '{}' updated successfully.", name);
                }
            }
            BlobNsCommands::Delete { name, name_flag } => {
                let name = name
                    .or(name_flag)
                    .ok_or("Namespace name is required (--name, -n, or positional)")?;
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

        BlobCommands::Verify {
            namespace,
            namespace_flag,
            object_key,
            key_flag,
        } => {
            let namespace = namespace
                .or(namespace_flag)
                .ok_or("Storage namespace is required (--ns, -n, or positional)")?;
            let object_key = object_key
                .or(key_flag)
                .ok_or("Object key is required (--key, -k, or positional)")?;
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
    }
    Ok(())
}

// ─── Model Context Protocol (MCP) Command Handlers ─────────────────────────

async fn handle_mcp_command(
    client: AdminClient,
    command: crate::commands::McpCommands,
    format: OutputFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    use crate::commands::McpCommands;
    match command {
        McpCommands::Tools => {
            let resp = client.mcp_list_tools().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                if let Some(tools) = resp
                    .get("result")
                    .and_then(|r| r.get("tools"))
                    .and_then(|t| t.as_array())
                {
                    for tool in tools {
                        println!("{}", serde_json::to_string(tool)?);
                    }
                } else {
                    println!("{}", serde_json::to_string(&resp)?);
                }
            } else {
                println!("{:<24} {:<56}", "TOOL", "DESCRIPTION");
                println!("{:-<80}", "");
                if let Some(tools) = resp
                    .get("result")
                    .and_then(|r| r.get("tools"))
                    .and_then(|t| t.as_array())
                {
                    for tool in tools {
                        let name = tool.get("name").and_then(|n| n.as_str()).unwrap_or("-");
                        let desc = tool
                            .get("description")
                            .and_then(|d| d.as_str())
                            .unwrap_or("-");
                        println!("{:<24} {:<56}", name, desc);
                    }
                } else {
                    println!("No MCP tools discovered or unexpected response format.");
                }
            }
        }

        McpCommands::Call {
            tool,
            tool_flag,
            args,
        } => {
            let tool = tool
                .or(tool_flag)
                .ok_or("Tool name is required (--tool, -t, or positional)")?;
            let args_val = if let Some(a) = args {
                serde_json::from_str::<Value>(&a)
                    .map_err(|e| format!("Invalid JSON arguments for tool '{}': {}", tool, e))?
            } else {
                json!({})
            };
            let resp = client.mcp_call_tool(&tool, Some(args_val)).await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                println!("{}", serde_json::to_string(&resp)?);
            } else if let Some(content) = resp
                .get("result")
                .and_then(|r| r.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        println!("{}", text);
                    } else {
                        println!("{}", serde_json::to_string_pretty(item)?);
                    }
                }
            } else if let Some(err) = resp.get("error") {
                eprintln!("MCP Error: {}", serde_json::to_string_pretty(err)?);
            } else {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            }
        }

        McpCommands::Resources => {
            let resp = client.mcp_list_resources().await?;
            if format == OutputFormat::Json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else if format == OutputFormat::Jsonl {
                if let Some(resources) = resp
                    .get("result")
                    .and_then(|r| r.get("resources"))
                    .and_then(|res| res.as_array())
                {
                    for item in resources {
                        println!("{}", serde_json::to_string(item)?);
                    }
                } else {
                    println!("{}", serde_json::to_string(&resp)?);
                }
            } else {
                println!("{:<32} {:<24} {:<24}", "URI", "NAME", "MIME TYPE");
                println!("{:-<80}", "");
                if let Some(resources) = resp
                    .get("result")
                    .and_then(|r| r.get("resources"))
                    .and_then(|res| res.as_array())
                {
                    for item in resources {
                        let uri = item.get("uri").and_then(|u| u.as_str()).unwrap_or("-");
                        let name = item.get("name").and_then(|n| n.as_str()).unwrap_or("-");
                        let mime = item.get("mimeType").and_then(|m| m.as_str()).unwrap_or("-");
                        println!("{:<32} {:<24} {:<24}", uri, name, mime);
                    }
                } else {
                    println!("No MCP resources found.");
                }
            }
        }

        McpCommands::Serve { .. } => {
            use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
            let stdin = tokio::io::stdin();
            let mut reader = BufReader::new(stdin).lines();
            let mut stdout = tokio::io::stdout();

            while let Some(line) = reader.next_line().await? {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let parsed: Value = match serde_json::from_str(trimmed) {
                    Ok(v) => v,
                    Err(e) => {
                        let err_resp = json!({
                            "jsonrpc": "2.0",
                            "id": null,
                            "error": {
                                "code": -32700,
                                "message": format!("Parse error: {}", e)
                            }
                        });
                        let mut out = serde_json::to_vec(&err_resp)?;
                        out.push(b'\n');
                        stdout.write_all(&out).await?;
                        stdout.flush().await?;
                        continue;
                    }
                };

                let resp = match client.mcp_dispatch(parsed.clone()).await {
                    Ok(val) => val,
                    Err(err_msg) => {
                        let id = parsed.get("id").cloned().unwrap_or(Value::Null);
                        json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": -32603,
                                "message": format!("Axiom MCP gateway error: {}", err_msg)
                            }
                        })
                    }
                };

                let mut out = serde_json::to_vec(&resp)?;
                out.push(b'\n');
                stdout.write_all(&out).await?;
                stdout.flush().await?;
            }
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
