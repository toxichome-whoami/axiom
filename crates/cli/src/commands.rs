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

    /// Upstream database connection management and data operations (via Admin and Data API)
    Db {
        #[command(subcommand)]
        command: DbCommands,
    },

    /// Native blob storage management and object transfers (via Admin and Data API)
    Blob {
        #[command(subcommand)]
        command: BlobCommands,
    },

    /// Authenticate administrative credentials and issue a session token
    Login {
        #[arg(help = "Admin username")]
        username: String,
        #[arg(
            short,
            long,
            help = "Admin password (if omitted, interactive prompt is used)"
        )]
        password: Option<String>,
    },

    /// Invalidate administrative session
    Logout,

    /// First-time setup wizard operations
    Setup {
        #[command(subcommand)]
        command: Option<SetupCommands>,
    },

    /// Cache engine inspection and management (via Admin API)
    Cache {
        #[command(subcommand)]
        command: CacheCommands,
    },

    /// Query administrative audit logs (via Admin API)
    Audit {
        #[arg(
            short,
            long,
            help = "Number of audit entries to retrieve",
            default_value = "50"
        )]
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
        #[arg(
            short,
            long,
            default_value = "200",
            help = "Total number of benchmark requests"
        )]
        requests: usize,
        #[arg(short, long, default_value = "10", help = "Concurrent worker tasks")]
        concurrency: usize,
    },

    /// Diagnose system environment and database reachability
    Doctor,

    /// Cluster mesh and node federation management (via Admin API)
    Cluster {
        #[command(subcommand)]
        command: ClusterCommands,
    },

    /// Configuration initialization, conversion, and inspection
    Config {
        #[command(subcommand)]
        command: ConfigCommands,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum ConfigCommands {
    /// Initialize a new default config.toml file
    Init {
        #[arg(
            short,
            long,
            help = "Output path for the config file",
            default_value = "config.toml"
        )]
        path: String,

        #[arg(short, long, help = "Force overwrite if file already exists")]
        force: bool,

        #[arg(long, help = "Also generate a matching .env file")]
        to_env: bool,
    },

    /// Convert a config.toml file into an environment variable .env file
    ToEnv {
        #[arg(
            short,
            long,
            help = "Path to input TOML file",
            default_value = "config.toml"
        )]
        input: String,

        #[arg(short, long, help = "Path to output .env file", default_value = ".env")]
        output: String,

        #[arg(short, long, help = "Force overwrite if output file already exists")]
        force: bool,
    },

    /// Validate and display active configuration values
    Show {
        #[arg(
            short,
            long,
            help = "Path to config file",
            default_value = "config.toml"
        )]
        config: String,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum CacheCommands {
    /// Display cache hit/miss statistics and memory usage
    Stats,
    /// Flush all cache entries from L1 RAM and L2 persistent storage
    Flush,
}

#[derive(Subcommand, Debug, Clone)]
pub enum ClusterCommands {
    /// Display local node identity, cluster secret, and peer connectivity status
    Status,

    /// List all registered peer nodes in the cluster mesh
    #[command(alias = "list")]
    Peers,

    /// Connect and pair with a remote cluster peer node
    Connect {
        #[arg(help = "Remote peer URL (e.g. http://10.0.0.2:4500)")]
        target_url: String,

        #[arg(short, long, help = "Shared cluster secret for mutual authentication")]
        secret: String,
    },

    /// Disconnect and unregister a peer node from the cluster mesh
    #[command(alias = "disconnect")]
    Remove {
        #[arg(help = "Node ID of the peer to remove")]
        node_id: String,
    },

    /// Update configuration for an existing registered peer node
    Update {
        #[arg(help = "Node ID of the peer to update")]
        node_id: String,

        #[arg(short, long, help = "Updated peer display moniker")]
        moniker: Option<String>,

        #[arg(short, long, help = "Updated peer URL endpoint")]
        url: Option<String>,

        #[arg(short, long, help = "Updated shared secret")]
        secret: Option<String>,
    },

    /// Send a live ping probe to verify connectivity and measure latency to a peer node
    Ping {
        #[arg(help = "Node ID of the peer to ping")]
        node_id: String,
    },

    /// Update the local node's cluster moniker
    Moniker {
        #[arg(help = "New moniker for this local cluster node")]
        moniker: String,
    },
}

#[derive(Args, Debug, Default, Clone)]
pub struct ServerArgs {
    #[arg(value_name = "ACTION", help = "Optional server action (e.g. 'run')")]
    pub action: Option<String>,

    #[arg(
        short,
        long,
        help = "Path to config file",
        default_value = "config.toml"
    )]
    pub config: String,
}

#[derive(Subcommand, Debug, Clone)]
pub enum UserCommands {
    /// Create a new administrative human user
    Add {
        #[arg(help = "Admin username")]
        username: String,
        #[arg(
            short,
            long,
            help = "Password (if omitted, interactive prompt is used)"
        )]
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
        #[arg(
            short,
            long,
            help = "Custom secret (if omitted, high-entropy secret is generated)"
        )]
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
        #[arg(
            long = "conn",
            alias = "connection-url",
            help = "Database connection URL (e.g. postgres://..., sqlite://...)"
        )]
        connection_url: String,
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
        #[arg(
            short,
            long,
            help = "Optional existing alias to exclude from duplicate checks"
        )]
        alias: Option<String>,
    },
    /// List all registered database connections
    List,
    /// Remove an upstream database connection
    Remove {
        #[arg(help = "Database alias")]
        alias: String,
    },
    /// Execute a SQL query against an upstream database
    Query {
        #[arg(help = "Database alias")]
        alias: String,
        #[arg(help = "SQL query string")]
        sql: String,
        #[arg(
            short,
            long,
            help = r#"JSON parameters array or object, e.g. '[1, "active"]'"#
        )]
        params: Option<String>,
        #[arg(short, long, help = "Query timeout in seconds", default_value = "30")]
        timeout: Option<u64>,
    },
    /// List tables in an upstream database
    Tables {
        #[arg(help = "Database alias")]
        alias: String,
        #[arg(
            short,
            long,
            help = "Offset cursor for pagination",
            default_value = "0"
        )]
        cursor: Option<i64>,
        #[arg(short, long, help = "Maximum tables to return", default_value = "100")]
        limit: Option<usize>,
    },
    /// Describe schema and foreign keys for a database table
    Schema {
        #[arg(help = "Database alias")]
        alias: String,
        #[arg(help = "Table name")]
        table: String,
    },
    /// Fetch and filter rows from a database table
    Rows {
        #[arg(help = "Database alias")]
        alias: String,
        #[arg(help = "Table name")]
        table: String,
        #[arg(short, long, help = "Pagination cursor (primary key value)")]
        cursor: Option<String>,
        #[arg(short, long, help = "Maximum rows to return", default_value = "100")]
        limit: Option<usize>,
        #[arg(short, long, help = "Sort column")]
        sort: Option<String>,
        #[arg(short, long, help = "Sort order (asc or desc)", default_value = "asc")]
        order: Option<String>,
        #[arg(
            short,
            long,
            help = r#"JSON filter condition, e.g. '{"status":{"eq":"active"}}'"#
        )]
        filter: Option<String>,
    },
    /// Insert row(s) into a database table
    Insert {
        #[arg(help = "Database alias")]
        alias: String,
        #[arg(help = "Table name")]
        table: String,
        #[arg(help = r#"JSON object or array to insert, e.g. '{"name":"Alice"}'"#)]
        data: Option<String>,
        #[arg(short, long, help = r#"JSON object for row to insert"#)]
        row: Option<String>,
        #[arg(long, help = r#"JSON array of rows to insert"#)]
        rows: Option<String>,
    },
    /// Update row(s) matching filter in a database table
    Update {
        #[arg(help = "Database alias")]
        alias: String,
        #[arg(help = "Table name")]
        table: String,
        #[arg(help = r#"JSON filter condition, e.g. '{"id":{"eq":1}}'"#)]
        filter: String,
        #[arg(help = r#"JSON update values, e.g. '{"status":"inactive"}'"#)]
        update: String,
    },
    /// Delete row(s) matching filter in a database table
    DeleteRows {
        #[arg(help = "Database alias")]
        alias: String,
        #[arg(help = "Table name")]
        table: String,
        #[arg(help = r#"JSON filter condition, e.g. '{"id":{"eq":1}}'"#)]
        filter: String,
    },
    /// Add a new column to a database table
    AddColumn {
        #[arg(help = "Database alias")]
        alias: String,
        #[arg(help = "Table name")]
        table: String,
        #[arg(help = "Column name")]
        column: String,
        #[arg(help = "Column data type (e.g. TEXT, INTEGER, VARCHAR(255))")]
        data_type: String,
        #[arg(long, help = "Allow null values")]
        nullable: bool,
        #[arg(long, help = "Default value expression")]
        default_val: Option<String>,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum BlobCommands {
    /// Storage cluster telemetry and usage statistics
    Stats,
    /// Storage-wide cryptographic integrity audit (verifies BLAKE3 hashes)
    Scrub,
    /// Manually trigger expired object cleanup (TTL sweep)
    Sweep,
    /// Manage blob storage namespaces and quotas
    Ns {
        #[command(subcommand)]
        command: BlobNsCommands,
    },
    /// List objects in a namespace
    List {
        #[arg(help = "Storage namespace")]
        namespace: String,
        #[arg(short, long, help = "Filter by key prefix")]
        prefix: Option<String>,
        #[arg(short, long, help = "Pagination cursor")]
        cursor: Option<String>,
        #[arg(short, long, help = "Maximum items to return", default_value = "100")]
        limit: Option<usize>,
    },
    /// Upload a file or binary payload to a namespace
    Put {
        #[arg(help = "Storage namespace")]
        namespace: String,
        #[arg(value_name = "KEY", help = "Object key (path)")]
        object_key: String,
        #[arg(help = "Path to local file to upload (or '-' for stdin)")]
        file: String,
        #[arg(
            short = 't',
            long,
            help = "MIME Content-Type (e.g. application/json, image/png)"
        )]
        content_type: Option<String>,
        #[arg(long, help = "Time-to-live expiration in seconds")]
        ttl: Option<u64>,
    },
    /// Download an object from a namespace
    Get {
        #[arg(help = "Storage namespace")]
        namespace: String,
        #[arg(value_name = "KEY", help = "Object key (path)")]
        object_key: String,
        #[arg(
            short,
            long,
            help = "Output file path (or '-' for stdout). Defaults to key filename"
        )]
        output: Option<String>,
        #[arg(long, help = "Capability ticket signature for pre-signed download")]
        ticket: Option<String>,
    },
    /// Inspect object metadata (headers, size, BLAKE3 hash, TTL)
    Head {
        #[arg(help = "Storage namespace")]
        namespace: String,
        #[arg(value_name = "KEY", help = "Object key (path)")]
        object_key: String,
    },
    /// Delete an object from a namespace
    Delete {
        #[arg(help = "Storage namespace")]
        namespace: String,
        #[arg(value_name = "KEY", help = "Object key (path)")]
        object_key: String,
    },
    /// Copy an object or directory prefix
    Copy {
        #[arg(help = "Source namespace")]
        src_namespace: String,
        #[arg(help = "Source key (or prefix)")]
        src_key: String,
        #[arg(help = "Destination key (or prefix)")]
        dest_key: String,
        #[arg(long, help = "Destination namespace (defaults to source namespace)")]
        dest_namespace: Option<String>,
        #[arg(long, help = "Copy all objects with matching prefix")]
        prefix: bool,
    },
    /// Move or rename an object or directory prefix
    Move {
        #[arg(help = "Source namespace")]
        src_namespace: String,
        #[arg(help = "Source key (or prefix)")]
        src_key: String,
        #[arg(help = "Destination key (or prefix)")]
        dest_key: String,
        #[arg(long, help = "Destination namespace (defaults to source namespace)")]
        dest_namespace: Option<String>,
        #[arg(long, help = "Move all objects with matching prefix")]
        prefix: bool,
    },
    /// Delete all objects matching a prefix
    DeletePrefix {
        #[arg(help = "Storage namespace")]
        namespace: String,
        #[arg(help = "Key prefix to delete")]
        prefix: String,
    },
    /// Cryptographically verify blob integrity on disk
    Verify {
        #[arg(help = "Storage namespace")]
        namespace: String,
        #[arg(value_name = "KEY", help = "Object key (path)")]
        object_key: String,
    },
    /// Generate a pre-signed capability download ticket URL
    Ticket {
        #[arg(help = "Storage namespace")]
        namespace: String,
        #[arg(value_name = "KEY", help = "Object key (path)")]
        object_key: String,
        #[arg(
            short,
            long,
            help = "Permitted operation (READ, WRITE)",
            default_value = "READ"
        )]
        operation: Option<String>,
        #[arg(long, help = "Ticket time-to-live in seconds", default_value = "3600")]
        ttl: Option<u64>,
    },
    /// List capability download/upload tickets (via Admin API)
    Tickets {
        #[arg(short, long, help = "Filter by namespace (defaults to all '*')")]
        namespace: Option<String>,
        #[arg(short, long, help = "Filter by object key")]
        key: Option<String>,
        #[arg(
            long,
            help = "Include expired and revoked tickets",
            default_value = "true"
        )]
        all: bool,
    },
    /// Revoke a capability ticket by signature or ID
    RevokeTicket {
        #[arg(help = "Capability ticket signature or ID to revoke")]
        signature: String,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum BlobNsCommands {
    /// List all storage namespaces and quotas
    List,
    /// Create a new storage namespace
    Create {
        #[arg(help = "Namespace name")]
        name: String,
        #[arg(
            long,
            help = "Maximum storage quota in bytes (e.g. 1073741824 for 1GB)"
        )]
        max_bytes: Option<u64>,
    },
    /// Update an existing namespace quota or rename it
    Update {
        #[arg(help = "Current namespace name")]
        name: String,
        #[arg(long, help = "New namespace name")]
        new_name: Option<String>,
        #[arg(long, help = "New maximum storage quota in bytes (0 = unlimited)")]
        max_bytes: Option<u64>,
    },
    /// Delete a namespace and all contained objects
    Delete {
        #[arg(help = "Namespace name")]
        name: String,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum SetupCommands {
    /// Check whether initial setup is required
    Begin,
    /// Create the primary admin account
    Account {
        #[arg(help = "Admin username")]
        username: String,
        #[arg(
            short,
            long,
            help = "Admin password (if omitted, interactive prompt is used)"
        )]
        password: Option<String>,
    },
    /// Register the first upstream database during setup
    Database {
        #[arg(short, long, help = "Database alias")]
        alias: String,
        #[arg(short, long, help = "Database connection URL")]
        url: String,
        #[arg(short, long, help = "Engine dialect")]
        engine: Option<String>,
    },
    /// Finalize and permanently seal the setup wizard
    Complete,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cli_parse_key_create() {
        let args = ["axiom", "key", "create", "-n", "app_key", "-r", "readonly"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse key create");
        match cli.command {
            Some(Commands::Key {
                command: KeyCommands::Create { name, role, .. },
            }) => {
                assert_eq!(name, "app_key");
                assert_eq!(role, Some("readonly".to_string()));
            }
            _ => panic!("Expected Key Create command"),
        }
    }

    #[test]
    fn test_cli_parse_db_add() {
        let args = [
            "axiom",
            "db",
            "add",
            "-a",
            "analytics",
            "--conn",
            "postgres://localhost:5432/db",
            "--pool-max",
            "20",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse db add");
        match cli.command {
            Some(Commands::Db {
                command:
                    DbCommands::Add {
                        alias,
                        connection_url,
                        pool_max,
                        ..
                    },
            }) => {
                assert_eq!(alias, "analytics");
                assert_eq!(connection_url, "postgres://localhost:5432/db");
                assert_eq!(pool_max, Some(20));
            }
            _ => panic!("Expected Db Add command"),
        }
    }

    #[test]
    fn test_cli_parse_global_flags() {
        let args = [
            "axiom",
            "--url",
            "http://gateway.internal:4500",
            "--json",
            "doctor",
        ];
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
            Some(Commands::User {
                command: UserCommands::Add { username, password },
            }) => {
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
            Some(Commands::Key {
                command: KeyCommands::Rotate { name },
            }) => {
                assert_eq!(name, "app_service_key");
            }
            _ => panic!("Expected Key Rotate command"),
        }
    }

    #[test]
    fn test_cli_parse_role_update() {
        let args = [
            "axiom",
            "role",
            "update",
            "analyst",
            "-d",
            "Updated role description",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse role update");
        match cli.command {
            Some(Commands::Role {
                command:
                    RoleCommands::Update {
                        name,
                        description,
                        permissions,
                    },
            }) => {
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
            Some(Commands::Db {
                command: DbCommands::Test { alias },
            }) => {
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
            Some(Commands::Benchmark {
                requests,
                concurrency,
            }) => {
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
            Some(Commands::Db {
                command: DbCommands::TestUrl { url, alias },
            }) => {
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

    #[test]
    fn test_cli_parse_config_init() {
        let args = [
            "axiom",
            "config",
            "init",
            "--path",
            "custom.toml",
            "--force",
            "--to-env",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse config init");
        match cli.command {
            Some(Commands::Config {
                command:
                    ConfigCommands::Init {
                        path,
                        force,
                        to_env,
                    },
            }) => {
                assert_eq!(path, "custom.toml");
                assert!(force);
                assert!(to_env);
            }
            _ => panic!("Expected Config Init command"),
        }
    }

    #[test]
    fn test_cli_parse_config_to_env() {
        let args = [
            "axiom", "config", "to-env", "-i", "in.toml", "-o", "out.env", "-f",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse config to-env");
        match cli.command {
            Some(Commands::Config {
                command:
                    ConfigCommands::ToEnv {
                        input,
                        output,
                        force,
                    },
            }) => {
                assert_eq!(input, "in.toml");
                assert_eq!(output, "out.env");
                assert!(force);
            }
            _ => panic!("Expected Config ToEnv command"),
        }
    }

    #[test]
    fn test_cli_parse_db_query() {
        let args = [
            "axiom",
            "db",
            "query",
            "main_db",
            "SELECT * FROM users",
            "-p",
            r#"["active"]"#,
            "--timeout",
            "45",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse db query");
        match cli.command {
            Some(Commands::Db {
                command:
                    DbCommands::Query {
                        alias,
                        sql,
                        params,
                        timeout,
                    },
            }) => {
                assert_eq!(alias, "main_db");
                assert_eq!(sql, "SELECT * FROM users");
                assert_eq!(params, Some(r#"["active"]"#.to_string()));
                assert_eq!(timeout, Some(45));
            }
            _ => panic!("Expected Db Query command"),
        }
    }

    #[test]
    fn test_cli_parse_db_tables_and_schema() {
        let args = ["axiom", "db", "tables", "analytics_db", "--limit", "50"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse db tables");
        match cli.command {
            Some(Commands::Db {
                command: DbCommands::Tables { alias, limit, .. },
            }) => {
                assert_eq!(alias, "analytics_db");
                assert_eq!(limit, Some(50));
            }
            _ => panic!("Expected Db Tables command"),
        }

        let schema_args = ["axiom", "db", "schema", "analytics_db", "events"];
        let schema_cli = Cli::try_parse_from(schema_args).expect("Failed to parse db schema");
        match schema_cli.command {
            Some(Commands::Db {
                command: DbCommands::Schema { alias, table },
            }) => {
                assert_eq!(alias, "analytics_db");
                assert_eq!(table, "events");
            }
            _ => panic!("Expected Db Schema command"),
        }
    }

    #[test]
    fn test_cli_parse_db_rows() {
        let args = [
            "axiom",
            "db",
            "rows",
            "main_db",
            "users",
            "--sort",
            "id",
            "--order",
            "desc",
            "--filter",
            r#"{"status":{"eq":"active"}}"#,
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse db rows");
        match cli.command {
            Some(Commands::Db {
                command:
                    DbCommands::Rows {
                        alias,
                        table,
                        sort,
                        order,
                        filter,
                        ..
                    },
            }) => {
                assert_eq!(alias, "main_db");
                assert_eq!(table, "users");
                assert_eq!(sort, Some("id".to_string()));
                assert_eq!(order, Some("desc".to_string()));
                assert_eq!(filter, Some(r#"{"status":{"eq":"active"}}"#.to_string()));
            }
            _ => panic!("Expected Db Rows command"),
        }
    }

    #[test]
    fn test_cli_parse_blob_commands() {
        let args = [
            "axiom",
            "blob",
            "put",
            "avatars",
            "user1.png",
            "./me.png",
            "-t",
            "image/png",
            "--ttl",
            "86400",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse blob put");
        match cli.command {
            Some(Commands::Blob {
                command:
                    BlobCommands::Put {
                        namespace,
                        object_key,
                        file,
                        content_type,
                        ttl,
                    },
            }) => {
                assert_eq!(namespace, "avatars");
                assert_eq!(object_key, "user1.png");
                assert_eq!(file, "./me.png");
                assert_eq!(content_type, Some("image/png".to_string()));
                assert_eq!(ttl, Some(86400));
            }
            _ => panic!("Expected Blob Put command"),
        }

        let get_args = [
            "axiom",
            "blob",
            "get",
            "avatars",
            "user1.png",
            "-o",
            "./download.png",
            "--ticket",
            "sig123",
        ];
        let get_cli = Cli::try_parse_from(get_args).expect("Failed to parse blob get");
        match get_cli.command {
            Some(Commands::Blob {
                command:
                    BlobCommands::Get {
                        namespace,
                        object_key,
                        output,
                        ticket,
                    },
            }) => {
                assert_eq!(namespace, "avatars");
                assert_eq!(object_key, "user1.png");
                assert_eq!(output, Some("./download.png".to_string()));
                assert_eq!(ticket, Some("sig123".to_string()));
            }
            _ => panic!("Expected Blob Get command"),
        }

        let copy_args = [
            "axiom",
            "blob",
            "copy",
            "raw",
            "data/",
            "backup/",
            "--dest-namespace",
            "archive",
            "--prefix",
        ];
        let copy_cli = Cli::try_parse_from(copy_args).expect("Failed to parse blob copy");
        match copy_cli.command {
            Some(Commands::Blob {
                command:
                    BlobCommands::Copy {
                        src_namespace,
                        src_key,
                        dest_key,
                        dest_namespace,
                        prefix,
                    },
            }) => {
                assert_eq!(src_namespace, "raw");
                assert_eq!(src_key, "data/");
                assert_eq!(dest_key, "backup/");
                assert_eq!(dest_namespace, Some("archive".to_string()));
                assert!(prefix);
            }
            _ => panic!("Expected Blob Copy command"),
        }

        // Tickets & RevokeTicket
        let tickets_args = [
            "axiom",
            "blob",
            "tickets",
            "-n",
            "assets",
            "-k",
            "report.pdf",
        ];
        let tickets_cli = Cli::try_parse_from(tickets_args).expect("Failed to parse blob tickets");
        match tickets_cli.command {
            Some(Commands::Blob {
                command:
                    BlobCommands::Tickets {
                        namespace,
                        key,
                        all,
                    },
            }) => {
                assert_eq!(namespace, Some("assets".to_string()));
                assert_eq!(key, Some("report.pdf".to_string()));
                assert!(all);
            }
            _ => panic!("Expected Blob Tickets command"),
        }

        let revoke_args = ["axiom", "blob", "revoke-ticket", "sig_xyz_123"];
        let revoke_cli =
            Cli::try_parse_from(revoke_args).expect("Failed to parse blob revoke-ticket");
        match revoke_cli.command {
            Some(Commands::Blob {
                command: BlobCommands::RevokeTicket { signature },
            }) => {
                assert_eq!(signature, "sig_xyz_123");
            }
            _ => panic!("Expected Blob RevokeTicket command"),
        }
    }

    #[test]
    fn test_cli_parse_login_and_setup() {
        let login_args = ["axiom", "login", "admin", "-p", "mypassword123"];
        let login_cli = Cli::try_parse_from(login_args).expect("Failed to parse login");
        match login_cli.command {
            Some(Commands::Login { username, password }) => {
                assert_eq!(username, "admin");
                assert_eq!(password, Some("mypassword123".to_string()));
            }
            _ => panic!("Expected Login command"),
        }

        let setup_args = [
            "axiom",
            "setup",
            "account",
            "superadmin",
            "-p",
            "longsecretpass",
        ];
        let setup_cli = Cli::try_parse_from(setup_args).expect("Failed to parse setup account");
        match setup_cli.command {
            Some(Commands::Setup {
                command: Some(SetupCommands::Account { username, password }),
            }) => {
                assert_eq!(username, "superadmin");
                assert_eq!(password, Some("longsecretpass".to_string()));
            }
            _ => panic!("Expected Setup Account command"),
        }
    }

    #[test]
    fn test_cli_parse_cluster_commands() {
        // Status
        let args = ["axiom", "cluster", "status"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse cluster status");
        assert!(matches!(
            cli.command,
            Some(Commands::Cluster {
                command: ClusterCommands::Status
            })
        ));

        // Peers / list
        let args = ["axiom", "cluster", "peers"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse cluster peers");
        assert!(matches!(
            cli.command,
            Some(Commands::Cluster {
                command: ClusterCommands::Peers
            })
        ));

        let args = ["axiom", "cluster", "list"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse cluster list");
        assert!(matches!(
            cli.command,
            Some(Commands::Cluster {
                command: ClusterCommands::Peers
            })
        ));

        // Connect
        let args = [
            "axiom",
            "cluster",
            "connect",
            "http://10.0.0.2:4500",
            "-s",
            "shared_secret_123",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse cluster connect");
        match cli.command {
            Some(Commands::Cluster {
                command: ClusterCommands::Connect { target_url, secret },
            }) => {
                assert_eq!(target_url, "http://10.0.0.2:4500");
                assert_eq!(secret, "shared_secret_123");
            }
            _ => panic!("Expected Cluster Connect command"),
        }

        // Remove / disconnect
        let args = ["axiom", "cluster", "remove", "node_999"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse cluster remove");
        match cli.command {
            Some(Commands::Cluster {
                command: ClusterCommands::Remove { node_id },
            }) => {
                assert_eq!(node_id, "node_999");
            }
            _ => panic!("Expected Cluster Remove command"),
        }

        let args = ["axiom", "cluster", "disconnect", "node_999"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse cluster disconnect");
        assert!(matches!(
            cli.command,
            Some(Commands::Cluster {
                command: ClusterCommands::Remove { .. }
            })
        ));

        // Update
        let args = [
            "axiom",
            "cluster",
            "update",
            "node_999",
            "-m",
            "node-east",
            "--url",
            "http://10.0.0.3:4500",
            "-s",
            "new_secret",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse cluster update");
        match cli.command {
            Some(Commands::Cluster {
                command:
                    ClusterCommands::Update {
                        node_id,
                        moniker,
                        url,
                        secret,
                    },
            }) => {
                assert_eq!(node_id, "node_999");
                assert_eq!(moniker, Some("node-east".to_string()));
                assert_eq!(url, Some("http://10.0.0.3:4500".to_string()));
                assert_eq!(secret, Some("new_secret".to_string()));
            }
            _ => panic!("Expected Cluster Update command"),
        }

        // Ping
        let args = ["axiom", "cluster", "ping", "node_999"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse cluster ping");
        match cli.command {
            Some(Commands::Cluster {
                command: ClusterCommands::Ping { node_id },
            }) => {
                assert_eq!(node_id, "node_999");
            }
            _ => panic!("Expected Cluster Ping command"),
        }

        // Moniker
        let args = ["axiom", "cluster", "moniker", "local-gateway-primary"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse cluster moniker");
        match cli.command {
            Some(Commands::Cluster {
                command: ClusterCommands::Moniker { moniker },
            }) => {
                assert_eq!(moniker, "local-gateway-primary");
            }
            _ => panic!("Expected Cluster Moniker command"),
        }
    }
}
