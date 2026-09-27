/*
 * Command-line interface argument definitions and subcommand schema parsing.
 * Owned by: cli
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

    /// Check server health and status
    Health,

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
}

