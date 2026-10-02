/*
 * Command-line interface argument definitions and subcommand schema parsing.
 * Owned by: crates/cli
 * Key deps: clap
 * Invariants: Parsed arguments must provide sensible defaults for host, port, and output formatting.
 * Last structural change: Phase 3 initial implementation of CLI subcommand tree.
 */

use clap::{Args, Parser, Subcommand};

#[derive(Parser, Debug, Clone)]
#[command(
    name = "axiom",
    author = "Toxichome",
    version = env!("CARGO_PKG_VERSION"),
    about = "Axiom API Gateway & Data Access Platform"
)]
pub struct Cli {
    #[arg(
        short,
        long,
        global = true,
        default_value = "http://127.0.0.1:4500",
        help = "Axiom server base URL"
    )]
    pub url: String,

    #[arg(
        short,
        long,
        global = true,
        help = "Admin API key or token for authenticated operations"
    )]
    pub key: Option<String>,

    #[arg(long, global = true, help = "Format output as JSON")]
    pub json: bool,

    #[arg(long, global = true, help = "Format output as JSON Lines (JSONL)")]
    pub jsonl: bool,

    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand, Debug, Clone)]
pub enum Commands {
    /// Start the Axiom gateway daemon
    Server(ServerArgs),

    /// Administrative user management (direct metadata DB access)
    User {
        #[command(subcommand)]
        command: UserCommands,
    },

    /// API machine key management (via Admin API)
    Key {
        #[command(subcommand)]
        command: KeyCommands,
    },

    /// RBAC role and permission management (via Admin API)
    Role {
        #[command(subcommand)]
        command: RoleCommands,
    },

    /// Upstream database connection management (via Admin API)
    Db {
        #[command(subcommand)]
        command: DbCommands,
    },

    /// Cache engine inspection and management (via Admin API)
    Cache {
        #[command(subcommand)]
        command: CacheCommands,
    },

    /// Query administrative audit logs (via Admin API)
    Audit {
        #[arg(short, long, help = "Number of audit entries to retrieve", default_value = "50")]
        limit: usize,
        #[arg(short, long, help = "Offset for pagination", default_value = "0")]
        offset: usize,
    },

    /// Force dynamic reload and synchronization of metadata snapshots
    Reload,

    /// Check server health and status
    Health,

    /// Dump Prometheus exposition metrics
    Metrics,

    /// Run built-in HTTP pipeline latency and throughput benchmark
    Benchmark {
        #[arg(short, long, default_value = "200", help = "Total number of benchmark requests")]
        requests: usize,
        #[arg(short, long, default_value = "10", help = "Concurrent worker tasks")]
        concurrency: usize,
    },

    /// Diagnose system environment and database reachability
    Doctor,
}

#[derive(Subcommand, Debug, Clone)]
pub enum CacheCommands {
    /// Display cache hit/miss statistics and memory usage
    Stats,
    /// Flush all cache entries from L1 RAM and L2 persistent storage
    Flush,
}

#[derive(Args, Debug, Default, Clone)]
pub struct ServerArgs {
    #[arg(value_name = "ACTION", help = "Optional server action (e.g. 'run')")]
    pub action: Option<String>,

    #[arg(short, long, help = "Path to config file", default_value = "config.toml")]
    pub config: String,
}

#[derive(Subcommand, Debug, Clone)]
pub enum UserCommands {
    /// Create a new administrative human user
    Add {
        #[arg(help = "Admin username")]
        username: String,
        #[arg(short, long, help = "Password (if omitted, interactive prompt is used)")]
        password: Option<String>,
    },
    /// List all administrative users
    List,
    /// Delete an administrative user
    Delete {
        #[arg(help = "Admin username to delete")]
        username: String,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum KeyCommands {
    /// Create a new API key
    Create {
        #[arg(short, long, help = "Key name")]
        name: String,
        #[arg(short, long, help = "Attached role name")]
        role: Option<String>,
        #[arg(short, long, help = "Custom secret (if omitted, high-entropy secret is generated)")]
        secret: Option<String>,
        #[arg(long, help = "Rate limit per minute (0 = default)")]
        rate_limit: Option<i64>,
        #[arg(long, help = "Expiration Unix timestamp")]
        expires_at: Option<i64>,
    },
    /// Rotate the secret for an existing API key
    Rotate {
        #[arg(help = "Key name")]
        name: String,
    },
    /// List all API keys
    List,
    /// Delete an API key
    Delete {
        #[arg(help = "Key name")]
        name: String,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum RoleCommands {
    /// Create a new RBAC role with permissions JSON
    Create {
        #[arg(short, long, help = "Role name")]
        name: String,
        #[arg(short, long, help = "Role description")]
        description: Option<String>,
        #[arg(
            short,
            long,
            help = r#"Permissions JSON array, e.g. '[{"database":"*","table_name":"*","operations":["SELECT"]}]'"#
        )]
        permissions: Option<String>,
    },
    /// Update an existing RBAC role description or permissions
    Update {
        #[arg(help = "Role name")]
        name: String,
        #[arg(short, long, help = "Role description")]
        description: Option<String>,
        #[arg(
            short,
            long,
            help = r#"Permissions JSON array, e.g. '[{"database":"*","table_name":"*","operations":["SELECT"]}]'"#
        )]
        permissions: Option<String>,
    },
    /// List all RBAC roles and their permissions
    List,
    /// Delete an RBAC role
    Delete {
        #[arg(help = "Role name")]
        name: String,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum DbCommands {
    /// Register a new upstream database connection
    Add {
        #[arg(short, long, help = "Database alias")]
        alias: String,
        #[arg(short, long, help = "Database connection URL")]
        url: String,
        #[arg(
            short,
            long,
            help = "Dialect/engine (e.g. postgres, mysql, sqlite, mssql, clickhouse)"
        )]
        engine: Option<String>,
        #[arg(long, help = "Minimum connection pool size")]
        pool_min: Option<i64>,
        #[arg(long, help = "Maximum connection pool size")]
        pool_max: Option<i64>,
    },
    /// Test connection to an upstream database
    Test {
        #[arg(help = "Database alias")]
        alias: String,
    },
    /// Test connection to a raw database URL before registering
    TestUrl {
        #[arg(help = "Database connection URL to probe")]
        url: String,
        #[arg(short, long, help = "Optional existing alias to exclude from duplicate checks")]
        alias: Option<String>,
    },
    /// List all registered database connections
    List,
    /// Remove an upstream database connection
    Remove {
        #[arg(help = "Database alias")]
        alias: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cli_parse_key_create() {
        let args = ["axiom", "key", "create", "-n", "app_key", "-r", "readonly"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse key create");
        match cli.command {
            Some(Commands::Key { command: KeyCommands::Create { name, role, .. } }) => {
                assert_eq!(name, "app_key");
                assert_eq!(role, Some("readonly".to_string()));
            }
            _ => panic!("Expected Key Create command"),
        }
    }

    #[test]
    fn test_cli_parse_db_add() {
        let args = ["axiom", "db", "add", "-a", "analytics", "-u", "postgres://localhost:5432/db", "--pool-max", "20"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse db add");
        match cli.command {
            Some(Commands::Db { command: DbCommands::Add { alias, url, pool_max, .. } }) => {
                assert_eq!(alias, "analytics");
                assert_eq!(url, "postgres://localhost:5432/db");
                assert_eq!(pool_max, Some(20));
            }
            _ => panic!("Expected Db Add command"),
        }
    }

    #[test]
    fn test_cli_parse_global_flags() {
        let args = ["axiom", "--url", "http://gateway.internal:4500", "--json", "doctor"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse doctor");
        assert_eq!(cli.url, "http://gateway.internal:4500");
        assert!(cli.json);
        assert!(matches!(cli.command, Some(Commands::Doctor)));
    }

    #[test]
    fn test_cli_parse_user_add() {
        let args = ["axiom", "user", "add", "ops_admin", "-p", "secret123"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse user add");
        match cli.command {
            Some(Commands::User { command: UserCommands::Add { username, password } }) => {
                assert_eq!(username, "ops_admin");
                assert_eq!(password, Some("secret123".to_string()));
            }
            _ => panic!("Expected User Add command"),
        }
    }

    #[test]
    fn test_cli_parse_key_rotate() {
        let args = ["axiom", "key", "rotate", "app_service_key"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse key rotate");
        match cli.command {
            Some(Commands::Key { command: KeyCommands::Rotate { name } }) => {
                assert_eq!(name, "app_service_key");
            }
            _ => panic!("Expected Key Rotate command"),
        }
    }

    #[test]
    fn test_cli_parse_role_update() {
        let args = ["axiom", "role", "update", "analyst", "-d", "Updated role description"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse role update");
        match cli.command {
            Some(Commands::Role { command: RoleCommands::Update { name, description, permissions } }) => {
                assert_eq!(name, "analyst");
                assert_eq!(description, Some("Updated role description".to_string()));
                assert!(permissions.is_none());
            }
            _ => panic!("Expected Role Update command"),
        }
    }

    #[test]
    fn test_cli_parse_db_test() {
        let args = ["axiom", "db", "test", "production_pg"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse db test");
        match cli.command {
            Some(Commands::Db { command: DbCommands::Test { alias } }) => {
                assert_eq!(alias, "production_pg");
            }
            _ => panic!("Expected Db Test command"),
        }
    }

    #[test]
    fn test_cli_parse_metrics() {
        let args = ["axiom", "metrics"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse metrics");
        assert!(matches!(cli.command, Some(Commands::Metrics)));
    }

    #[test]
    fn test_cli_parse_benchmark() {
        let args = ["axiom", "benchmark", "-r", "500", "-c", "25"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse benchmark");
        match cli.command {
            Some(Commands::Benchmark { requests, concurrency }) => {
                assert_eq!(requests, 500);
                assert_eq!(concurrency, 25);
            }
            _ => panic!("Expected Benchmark command"),
        }
    }

    #[test]
    fn test_cli_parse_audit() {
        let args = ["axiom", "audit", "-l", "25", "-o", "5"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse audit");
        match cli.command {
            Some(Commands::Audit { limit, offset }) => {
                assert_eq!(limit, 25);
                assert_eq!(offset, 5);
            }
            _ => panic!("Expected Audit command"),
        }
    }

    #[test]
    fn test_cli_parse_reload() {
        let args = ["axiom", "reload"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse reload");
        assert!(matches!(cli.command, Some(Commands::Reload)));
    }

    #[test]
    fn test_cli_parse_db_test_url() {
        let args = ["axiom", "db", "test-url", "sqlite://data/custom.db"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse db test-url");
        match cli.command {
            Some(Commands::Db { command: DbCommands::TestUrl { url, alias } }) => {
                assert_eq!(url, "sqlite://data/custom.db");
                assert!(alias.is_none());
            }
            _ => panic!("Expected Db TestUrl command"),
        }
    }

    #[test]
    fn test_cli_parse_server_run() {
        let args = ["axiom", "server", "run", "--config", "axiom.toml"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse server run");
        match cli.command {
            Some(Commands::Server(ServerArgs { action, config })) => {
                assert_eq!(action, Some("run".to_string()));
                assert_eq!(config, "axiom.toml");
            }
            _ => panic!("Expected Server command"),
        }
    }

    #[test]
    fn test_cli_parse_jsonl_flag() {
        let args = ["axiom", "--jsonl", "doctor"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse jsonl doctor");
        assert!(cli.jsonl);
        assert!(!cli.json);
        assert!(matches!(cli.command, Some(Commands::Doctor)));
    }
}

