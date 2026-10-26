/*
 * Command-line interface argument definitions and subcommand schema parsing.
 * Owned by: crates/cli
 * Key deps: clap
 * Invariants: Parsed arguments must provide sensible defaults for host, port, and output formatting.
 * Last structural change: Phase 3 initial implementation of CLI subcommand tree.
 */

use clap::builder::styling::{AnsiColor, Effects, Styles};
use clap::{Args, Parser, Subcommand};

/// Provides ANSI terminal styles for help menus, headers, and parameter descriptions.
pub fn cli_styles() -> Styles {
    Styles::styled()
        .header(AnsiColor::Green.on_default().effects(Effects::BOLD))
        .usage(AnsiColor::Green.on_default().effects(Effects::BOLD))
        .literal(AnsiColor::Cyan.on_default().effects(Effects::BOLD))
        .placeholder(AnsiColor::Yellow.on_default())
}

/// Clean, categorized workflow help template grouping subcommands into 5 distinct operational domains.
pub const ROOT_HELP_TEMPLATE: &str = "\
Axiom API Gateway & Data Access Platform (v{version})

Usage:
  axiom [OPTIONS] [COMMAND]

CORE WORKFLOWS:
  setup        First-time setup wizard operations
  server       Start the Axiom gateway daemon (alias: start)
  login        Authenticate administrative credentials and issue a session token
  logout       Invalidate administrative session
  status       Check server health, cluster state, and active auth context (alias: health)

DATA & STORAGE:
  db           Upstream database connections, migrations, and direct query execution
  blob         Native blob storage management, object transfers, and namespaces

SECURITY & ACCESS:
  user         Administrative user management (direct host metadata DB access)
  key          Machine API keys (rate limits, roles, secrets, tokens)
  role         RBAC roles and granular permission management
  audit        Query administrative audit logs

OPERATIONS & DIAGNOSTICS:
  doctor       Diagnose system environment, ports, and database reachability
  health       Check server health and status (alias: status)
  metrics      Dump Prometheus exposition metrics
  benchmark    Run built-in HTTP pipeline latency and throughput benchmark (alias: bench)
  cache        Cache engine inspection and cache flush/purge (aliases: clear, purge)
  cluster      Cluster mesh topology, peer nodes, and latency ping
  reload       Force dynamic reload and synchronization of metadata snapshots
  config       Configuration initialization, conversion (.env), and inspection

INTEGRATIONS & UTILITIES:
  mcp          Model Context Protocol (MCP) tool execution, discovery, and stdio bridge
  completions  Generate shell completion scripts (bash, zsh, fish, powershell, elvish)
  help         Print this message or the help of the given subcommand(s)

Options:
{options}
";

#[derive(Parser, Debug, Clone)]
#[command(
    name = "axiom",
    author = "Toxichome",
    version = env!("CARGO_PKG_VERSION"),
    about = "Axiom API Gateway & Data Access Platform",
    styles = cli_styles(),
    help_template = ROOT_HELP_TEMPLATE
)]
pub struct Cli {
    #[arg(
        short = 'U',
        long,
        global = true,
        default_value = "http://127.0.0.1:4500",
        help = "Axiom server base URL"
    )]
    pub url: String,

    #[arg(
        long = "api-key",
        alias = "token",
        global = true,
        help = "Admin API key or token for authenticated operations"
    )]
    pub key: Option<String>,

    #[arg(long, global = true, help = "Format output as JSON")]
    pub json: bool,

    #[arg(long, global = true, help = "Format output as JSON Lines (JSONL)")]
    pub jsonl: bool,

    #[arg(
        long,
        global = true,
        help = "Print brief summary of Axiom CLI capabilities and exit"
    )]
    pub brief: bool,

    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand, Debug, Clone)]
pub enum Commands {
    /// Start the Axiom gateway daemon
    #[command(alias = "start", alias = "run")]
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
        #[arg(
            value_name = "USERNAME",
            help = "Admin username (positional or via -u/--user)"
        )]
        username: Option<String>,
        #[arg(
            short = 'u',
            long = "user",
            alias = "username",
            help = "Admin username"
        )]
        user: Option<String>,
        #[arg(
            short = 'p',
            long = "password",
            alias = "pass",
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
    #[command(alias = "status")]
    Health,

    /// Dump Prometheus exposition metrics
    Metrics,

    /// Run built-in HTTP pipeline latency and throughput benchmark
    #[command(alias = "bench")]
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

    /// Model Context Protocol (MCP) tool execution, discovery, and stdio bridge
    Mcp {
        #[command(subcommand)]
        command: McpCommands,
    },

    /// Generate shell completion scripts (bash, zsh, fish, powershell, elvish)
    Completions {
        #[arg(value_enum, help = "Target shell")]
        shell: clap_complete::Shell,
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
    #[command(alias = "clear", alias = "purge")]
    Flush,
}

#[derive(Subcommand, Debug, Clone)]
pub enum ClusterCommands {
    /// Display local node identity, cluster secret, and peer connectivity status
    Status,

    /// List all registered peer nodes in the cluster mesh
    #[command(alias = "list", alias = "ls")]
    Peers,

    /// Connect/add a remote cluster peer node
    #[command(alias = "add")]
    Connect {
        #[arg(value_name = "TARGET_URL", help = "Remote peer URL (positional or via -t/--target/--peer-url)")]
        target_url: Option<String>,

        #[arg(short = 't', long = "target", alias = "peer-url", help = "Remote peer URL (e.g. http://10.0.0.2:4500)")]
        url_flag: Option<String>,

        #[arg(short, long, help = "Shared cluster secret for mutual authentication")]
        secret: String,
    },

    /// Disconnect and unregister a peer node from the cluster mesh
    #[command(alias = "disconnect", alias = "delete", alias = "rm")]
    Remove {
        #[arg(value_name = "NODE_ID", help = "Node ID of the peer to remove (positional or via -i/--id)")]
        node_id: Option<String>,

        #[arg(short = 'i', long = "id", alias = "node-id", help = "Node ID of the peer to remove")]
        id_flag: Option<String>,
    },

    /// Update configuration for an existing registered peer node
    Update {
        #[arg(value_name = "NODE_ID", help = "Node ID of the peer to update (positional or via -i/--id)")]
        node_id: Option<String>,

        #[arg(short = 'i', long = "id", alias = "node-id", help = "Node ID of the peer to update")]
        id_flag: Option<String>,

        #[arg(short, long, help = "Updated peer display moniker")]
        moniker: Option<String>,

        #[arg(short = 't', long = "target", alias = "peer-url", help = "Updated peer URL endpoint")]
        url: Option<String>,

        #[arg(short, long, help = "Updated shared secret")]
        secret: Option<String>,
    },

    /// Send a live ping probe to verify connectivity and measure latency to a peer node
    Ping {
        #[arg(value_name = "NODE_ID", help = "Node ID of the peer to ping (positional or via -i/--id)")]
        node_id: Option<String>,

        #[arg(short = 'i', long = "id", alias = "node-id", help = "Node ID of the peer to ping")]
        id_flag: Option<String>,
    },

    /// Update the local node's cluster moniker
    Moniker {
        #[arg(value_name = "MONIKER", help = "New moniker for this local cluster node (positional or via -m/--moniker)")]
        moniker: Option<String>,

        #[arg(short = 'm', long = "moniker", help = "New moniker for this local cluster node")]
        moniker_flag: Option<String>,
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
    #[command(alias = "create")]
    Add {
        #[arg(
            value_name = "USERNAME",
            help = "Admin username (positional or via -u/--user)"
        )]
        username: Option<String>,
        #[arg(
            short = 'u',
            long = "user",
            alias = "username",
            help = "Admin username"
        )]
        user: Option<String>,
        #[arg(short = 'e', long = "email", help = "Admin email address")]
        email: Option<String>,
        #[arg(
            short = 'p',
            long = "password",
            alias = "pass",
            help = "Password (if omitted, interactive prompt is used)"
        )]
        password: Option<String>,
        #[arg(short = 'c', long = "config", help = "Path to config file")]
        config: Option<String>,
    },
    /// Update an administrative user's email or password
    Update {
        #[arg(
            value_name = "USERNAME",
            help = "Admin username to update (positional or via -u/--user)"
        )]
        username: Option<String>,
        #[arg(
            short = 'u',
            long = "user",
            alias = "username",
            help = "Admin username to update"
        )]
        user: Option<String>,
        #[arg(short = 'e', long = "email", help = "Updated admin email address")]
        email: Option<String>,
        #[arg(
            short = 'p',
            long = "password",
            alias = "pass",
            help = "Updated password (if omitted and --email is omitted, prompt is shown)"
        )]
        password: Option<String>,
        #[arg(short = 'c', long = "config", help = "Path to config file")]
        config: Option<String>,
    },
    /// List all administrative users
    #[command(alias = "ls")]
    List {
        #[arg(short = 'c', long = "config", help = "Path to config file")]
        config: Option<String>,
    },
    /// Delete/remove an administrative user
    #[command(alias = "delete", alias = "rm")]
    Remove {
        #[arg(
            value_name = "USERNAME",
            help = "Admin username to delete (positional or via -u/--user)"
        )]
        username: Option<String>,
        #[arg(
            short = 'u',
            long = "user",
            alias = "username",
            help = "Admin username to delete"
        )]
        user: Option<String>,
        #[arg(short = 'c', long = "config", help = "Path to config file")]
        config: Option<String>,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum KeyCommands {
    /// Create a new API key
    #[command(alias = "add")]
    Create {
        #[arg(value_name = "NAME", help = "Key name (positional or via -n/--name)")]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Key name")]
        name_flag: Option<String>,
        #[arg(short = 'r', long = "role", help = "Attached role name")]
        role: Option<String>,
        #[arg(
            short = 's',
            long = "secret",
            help = "Custom secret (if omitted, high-entropy secret is generated)"
        )]
        secret: Option<String>,
        #[arg(short = 'l', long = "limit", alias = "rate-limit", help = "Rate limit per minute (0 = default)")]
        rate_limit: Option<i64>,
        #[arg(short = 'e', long = "expires", alias = "expires-at", help = "Expiration Unix timestamp")]
        expires_at: Option<i64>,
    },
    /// Update an existing API key's role, rate limit, or expiration
    Update {
        #[arg(value_name = "NAME", help = "Key name (positional or via -n/--name)")]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Key name")]
        name_flag: Option<String>,
        #[arg(short = 'r', long = "role", help = "Updated role name")]
        role: Option<String>,
        #[arg(short = 'l', long = "limit", alias = "rate-limit", help = "Updated rate limit per minute (0 = unconstrained)")]
        rate_limit: Option<i64>,
        #[arg(short = 'e', long = "expires", alias = "expires-at", help = "Updated expiration Unix timestamp")]
        expires_at: Option<i64>,
    },
    /// Rotate the secret for an existing API key
    Rotate {
        #[arg(value_name = "NAME", help = "Key name (positional or via -n/--name)")]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Key name")]
        name_flag: Option<String>,
    },
    /// List all API keys
    #[command(alias = "ls")]
    List,
    /// Delete/remove an API key
    #[command(alias = "delete", alias = "rm", alias = "revoke")]
    Remove {
        #[arg(value_name = "NAME", help = "Key name (positional or via -n/--name)")]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Key name")]
        name_flag: Option<String>,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum RoleCommands {
    /// Create a new RBAC role with permissions JSON
    #[command(alias = "add")]
    Create {
        #[arg(value_name = "NAME", help = "Role name (positional or via -n/--name)")]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Role name")]
        name_flag: Option<String>,
        #[arg(short = 'd', long = "description", alias = "desc", help = "Role description")]
        description: Option<String>,
        #[arg(
            short = 'p',
            long = "permissions",
            alias = "perms",
            help = r#"Permissions JSON array, e.g. '[{"database":"*","table_name":"*","operations":["SELECT"]}]'"#
        )]
        permissions: Option<String>,
    },
    /// Update an existing RBAC role description or permissions
    Update {
        #[arg(value_name = "NAME", help = "Role name (positional or via -n/--name)")]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Role name")]
        name_flag: Option<String>,
        #[arg(short = 'd', long = "description", alias = "desc", help = "Role description")]
        description: Option<String>,
        #[arg(
            short = 'p',
            long = "permissions",
            alias = "perms",
            help = r#"Permissions JSON array, e.g. '[{"database":"*","table_name":"*","operations":["SELECT"]}]'"#
        )]
        permissions: Option<String>,
    },
    /// List all RBAC roles and their permissions
    #[command(alias = "ls")]
    List,
    /// Delete/remove an RBAC role
    #[command(alias = "delete", alias = "rm")]
    Remove {
        #[arg(value_name = "NAME", help = "Role name (positional or via -n/--name)")]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Role name")]
        name_flag: Option<String>,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum DbCommands {
    /// Register a new upstream database connection
    #[command(alias = "create")]
    Add {
        #[arg(value_name = "ALIAS", help = "Database alias (positional or via -a/--alias)")]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias")]
        alias_flag: Option<String>,
        #[arg(
            short = 'c',
            long = "conn",
            alias = "connection-url",
            help = "Database connection URL (e.g. postgres://..., sqlite://...)"
        )]
        connection_url: String,
        #[arg(
            short = 'e',
            long = "engine",
            alias = "dialect",
            help = "Dialect/engine (e.g. postgres, mysql, sqlite, mssql, clickhouse, snowflake, oracle)"
        )]
        engine: Option<String>,
        #[arg(short = 'm', long = "min", alias = "pool-min", help = "Minimum connection pool size")]
        pool_min: Option<i64>,
        #[arg(short = 'M', long = "max", alias = "pool-max", help = "Maximum connection pool size")]
        pool_max: Option<i64>,
    },
    /// Update an existing upstream database connection configuration
    Update {
        #[arg(value_name = "ALIAS", help = "Database alias to update (positional or via -a/--alias)")]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias to update")]
        alias_flag: Option<String>,
        #[arg(short = 'n', long = "new-alias", alias = "rename", help = "Rename database alias")]
        new_alias: Option<String>,
        #[arg(
            short = 'c',
            long = "conn",
            alias = "connection-url",
            help = "Updated database connection URL"
        )]
        connection_url: Option<String>,
        #[arg(short = 'e', long = "engine", alias = "dialect", help = "Updated dialect/engine")]
        engine: Option<String>,
        #[arg(short = 'm', long = "min", alias = "pool-min", help = "Updated minimum connection pool size")]
        pool_min: Option<i64>,
        #[arg(short = 'M', long = "max", alias = "pool-max", help = "Updated maximum connection pool size")]
        pool_max: Option<i64>,
    },
    /// Test connection to an upstream database
    Test {
        #[arg(value_name = "ALIAS", help = "Database alias (positional or via -a/--alias)")]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias")]
        alias_flag: Option<String>,
    },
    /// Test connection to a raw database URL before registering
    TestUrl {
        #[arg(value_name = "URL", help = "Database connection URL to probe (positional or via -c/--conn)")]
        url: Option<String>,
        #[arg(short = 'c', long = "conn", alias = "connection-url", help = "Database connection URL to probe")]
        url_flag: Option<String>,
        #[arg(
            short = 'a',
            long = "alias",
            help = "Optional existing alias to exclude from duplicate checks"
        )]
        alias: Option<String>,
    },
    /// List all registered database connections
    #[command(alias = "ls")]
    List,
    /// Remove an upstream database connection
    #[command(alias = "delete", alias = "rm")]
    Remove {
        #[arg(value_name = "ALIAS", help = "Database alias (positional or via -a/--alias)")]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias")]
        alias_flag: Option<String>,
    },
    /// Execute a SQL query against an upstream database
    Query {
        #[arg(value_name = "ALIAS", help = "Database alias (positional or via -a/--alias)")]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias")]
        alias_flag: Option<String>,
        #[arg(value_name = "SQL", help = "SQL query string (positional or via -q/--query)")]
        sql: Option<String>,
        #[arg(short = 'q', long = "query", alias = "sql", help = "SQL query string")]
        query_flag: Option<String>,
        #[arg(
            short = 'p',
            long = "params",
            help = r#"JSON parameters array or object, e.g. '[1, "active"]'"#
        )]
        params: Option<String>,
        #[arg(short = 't', long = "timeout", help = "Query timeout in seconds", default_value = "30")]
        timeout: Option<u64>,
    },
    /// List tables in an upstream database
    Tables {
        #[arg(value_name = "ALIAS", help = "Database alias (positional or via -a/--alias)")]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias")]
        alias_flag: Option<String>,
        #[arg(
            short = 'c',
            long = "cursor",
            help = "Offset cursor for pagination",
            default_value = "0"
        )]
        cursor: Option<i64>,
        #[arg(short = 'l', long = "limit", help = "Maximum tables to return", default_value = "100")]
        limit: Option<usize>,
    },
    /// Describe schema and foreign keys for a database table
    Schema {
        #[arg(value_name = "ALIAS", help = "Database alias (positional or via -a/--alias)")]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias")]
        alias_flag: Option<String>,
        #[arg(value_name = "TABLE", help = "Table name (positional or via -t/--table)")]
        table: Option<String>,
        #[arg(short = 't', long = "table", help = "Table name")]
        table_flag: Option<String>,
    },
    /// Fetch and filter rows from a database table
    Rows {
        #[arg(value_name = "ALIAS", help = "Database alias (positional or via -a/--alias)")]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias")]
        alias_flag: Option<String>,
        #[arg(value_name = "TABLE", help = "Table name (positional or via -t/--table)")]
        table: Option<String>,
        #[arg(short = 't', long = "table", help = "Table name")]
        table_flag: Option<String>,
        #[arg(short = 'c', long = "cursor", help = "Pagination cursor (primary key value)")]
        cursor: Option<String>,
        #[arg(short = 'l', long = "limit", help = "Maximum rows to return", default_value = "100")]
        limit: Option<usize>,
        #[arg(short = 's', long = "sort", help = "Sort column")]
        sort: Option<String>,
        #[arg(short = 'o', long = "order", help = "Sort order (asc or desc)", default_value = "asc")]
        order: Option<String>,
        #[arg(
            short = 'f',
            long = "filter",
            help = r#"JSON filter condition, e.g. '{"status":{"eq":"active"}}'"#
        )]
        filter: Option<String>,
    },
    /// Insert row(s) into a database table
    Insert {
        #[arg(value_name = "ALIAS", help = "Database alias (positional or via -a/--alias)")]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias")]
        alias_flag: Option<String>,
        #[arg(value_name = "TABLE", help = "Table name (positional or via -t/--table)")]
        table: Option<String>,
        #[arg(short = 't', long = "table", help = "Table name")]
        table_flag: Option<String>,
        #[arg(help = r#"JSON object or array to insert, e.g. '{"name":"Alice"}'"#)]
        data: Option<String>,
        #[arg(short = 'r', long = "row", help = r#"JSON object for row to insert"#)]
        row: Option<String>,
        #[arg(short = 'R', long = "rows", help = r#"JSON array of rows to insert"#)]
        rows: Option<String>,
    },
    /// Update row(s) matching filter in a database table
    #[command(name = "update-rows", alias = "update_rows")]
    UpdateRows {
        #[arg(value_name = "ALIAS", help = "Database alias (positional or via -a/--alias)")]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias")]
        alias_flag: Option<String>,
        #[arg(value_name = "TABLE", help = "Table name (positional or via -t/--table)")]
        table: Option<String>,
        #[arg(short = 't', long = "table", help = "Table name")]
        table_flag: Option<String>,
        #[arg(value_name = "FILTER", help = r#"JSON filter condition, e.g. '{"id":{"eq":1}}' (positional or via -f/--filter)"#)]
        filter: Option<String>,
        #[arg(short = 'f', long = "filter", help = "JSON filter condition")]
        filter_flag: Option<String>,
        #[arg(value_name = "UPDATE", help = r#"JSON update values, e.g. '{"status":"inactive"}' (positional or via -u/--update/--data)"#)]
        update: Option<String>,
        #[arg(short = 'u', long = "update", alias = "data", help = "JSON update values")]
        update_flag: Option<String>,
    },
    /// Delete row(s) matching filter in a database table
    DeleteRows {
        #[arg(value_name = "ALIAS", help = "Database alias (positional or via -a/--alias)")]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias")]
        alias_flag: Option<String>,
        #[arg(value_name = "TABLE", help = "Table name (positional or via -t/--table)")]
        table: Option<String>,
        #[arg(short = 't', long = "table", help = "Table name")]
        table_flag: Option<String>,
        #[arg(value_name = "FILTER", help = r#"JSON filter condition, e.g. '{"id":{"eq":1}}' (positional or via -f/--filter)"#)]
        filter: Option<String>,
        #[arg(short = 'f', long = "filter", help = "JSON filter condition")]
        filter_flag: Option<String>,
    },
    /// Add a new column to a database table
    AddColumn {
        #[arg(value_name = "ALIAS", help = "Database alias (positional or via -a/--alias)")]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias")]
        alias_flag: Option<String>,
        #[arg(value_name = "TABLE", help = "Table name (positional or via -t/--table)")]
        table: Option<String>,
        #[arg(short = 't', long = "table", help = "Table name")]
        table_flag: Option<String>,
        #[arg(value_name = "COLUMN", help = "Column name (positional or via -c/--column)")]
        column: Option<String>,
        #[arg(short = 'c', long = "column", help = "Column name")]
        column_flag: Option<String>,
        #[arg(value_name = "DATA_TYPE", help = "Column data type (positional or via -d/--type)")]
        data_type: Option<String>,
        #[arg(short = 'd', long = "type", alias = "data-type", help = "Column data type (e.g. TEXT, INTEGER, VARCHAR(255))")]
        data_type_flag: Option<String>,
        #[arg(short = 'N', long = "null", alias = "nullable", help = "Allow null values")]
        nullable: bool,
        #[arg(short = 'D', long = "default", alias = "default-val", help = "Default value expression")]
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
    #[command(alias = "ls")]
    List {
        #[arg(value_name = "NAMESPACE", help = "Storage namespace (positional or via -n/--ns)")]
        namespace: Option<String>,
        #[arg(short = 'n', long = "ns", alias = "namespace", help = "Storage namespace")]
        namespace_flag: Option<String>,
        #[arg(short, long, help = "Filter by key prefix")]
        prefix: Option<String>,
        #[arg(short, long, help = "Pagination cursor")]
        cursor: Option<String>,
        #[arg(short, long, help = "Maximum items to return", default_value = "100")]
        limit: Option<usize>,
    },
    /// Upload a file or binary payload to a namespace
    #[command(alias = "upload")]
    Put {
        #[arg(value_name = "NAMESPACE", help = "Storage namespace (positional or via -n/--ns)")]
        namespace: Option<String>,
        #[arg(short = 'n', long = "ns", alias = "namespace", help = "Storage namespace")]
        namespace_flag: Option<String>,
        #[arg(value_name = "KEY", help = "Object key/path (positional or via -k/--key)")]
        object_key: Option<String>,
        #[arg(short = 'k', long = "key", help = "Object key (path)")]
        key_flag: Option<String>,
        #[arg(value_name = "FILE", help = "Path to local file to upload, or '-' for stdin (positional or via -f/--file)")]
        file: Option<String>,
        #[arg(short = 'f', long = "file", alias = "input", help = "Path to local file to upload (or '-' for stdin)")]
        file_flag: Option<String>,
        #[arg(
            short = 't',
            long = "type",
            alias = "content-type",
            help = "MIME Content-Type (e.g. application/json, image/png)"
        )]
        content_type: Option<String>,
        #[arg(short = 'T', long = "ttl", help = "Time-to-live expiration in seconds")]
        ttl: Option<u64>,
    },
    /// Download an object from a namespace
    #[command(alias = "download")]
    Get {
        #[arg(value_name = "NAMESPACE", help = "Storage namespace (positional or via -n/--ns)")]
        namespace: Option<String>,
        #[arg(short = 'n', long = "ns", alias = "namespace", help = "Storage namespace")]
        namespace_flag: Option<String>,
        #[arg(value_name = "KEY", help = "Object key/path (positional or via -k/--key)")]
        object_key: Option<String>,
        #[arg(short = 'k', long = "key", help = "Object key (path)")]
        key_flag: Option<String>,
        #[arg(
            short,
            long,
            help = "Output file path (or '-' for stdout). Defaults to key filename"
        )]
        output: Option<String>,
        #[arg(short = 't', long = "ticket", help = "Capability ticket signature for pre-signed download")]
        ticket: Option<String>,
    },
    /// Inspect object metadata (headers, size, BLAKE3 hash, TTL)
    Head {
        #[arg(value_name = "NAMESPACE", help = "Storage namespace (positional or via -n/--ns)")]
        namespace: Option<String>,
        #[arg(short = 'n', long = "ns", alias = "namespace", help = "Storage namespace")]
        namespace_flag: Option<String>,
        #[arg(value_name = "KEY", help = "Object key/path (positional or via -k/--key)")]
        object_key: Option<String>,
        #[arg(short = 'k', long = "key", help = "Object key (path)")]
        key_flag: Option<String>,
    },
    /// Delete an object from a namespace
    #[command(alias = "remove", alias = "rm")]
    Delete {
        #[arg(value_name = "NAMESPACE", help = "Storage namespace (positional or via -n/--ns)")]
        namespace: Option<String>,
        #[arg(short = 'n', long = "ns", alias = "namespace", help = "Storage namespace")]
        namespace_flag: Option<String>,
        #[arg(value_name = "KEY", help = "Object key/path (positional or via -k/--key)")]
        object_key: Option<String>,
        #[arg(short = 'k', long = "key", help = "Object key (path)")]
        key_flag: Option<String>,
    },
    /// Copy an object or directory prefix
    Copy {
        #[arg(value_name = "SRC_NAMESPACE", help = "Source namespace (positional or via -s/--src-ns)")]
        src_namespace: Option<String>,
        #[arg(short = 's', long = "src-ns", alias = "from-ns", help = "Source namespace")]
        src_ns_flag: Option<String>,
        #[arg(value_name = "SRC_KEY", help = "Source key or prefix (positional or via -k/--src-key)")]
        src_key: Option<String>,
        #[arg(short = 'k', long = "src-key", alias = "from-key", help = "Source key (or prefix)")]
        src_key_flag: Option<String>,
        #[arg(value_name = "DEST_KEY", help = "Destination key or prefix (positional or via -K/--dest-key)")]
        dest_key: Option<String>,
        #[arg(short = 'K', long = "dest-key", alias = "to-key", help = "Destination key (or prefix)")]
        dest_key_flag: Option<String>,
        #[arg(short = 'd', long = "dest-ns", alias = "to-ns", alias = "dest-namespace", help = "Destination namespace (defaults to source namespace)")]
        dest_namespace: Option<String>,
        #[arg(short = 'p', long = "prefix", help = "Copy all objects with matching prefix")]
        prefix: bool,
    },
    /// Move or rename an object or directory prefix
    Move {
        #[arg(value_name = "SRC_NAMESPACE", help = "Source namespace (positional or via -s/--src-ns)")]
        src_namespace: Option<String>,
        #[arg(short = 's', long = "src-ns", alias = "from-ns", help = "Source namespace")]
        src_ns_flag: Option<String>,
        #[arg(value_name = "SRC_KEY", help = "Source key or prefix (positional or via -k/--src-key)")]
        src_key: Option<String>,
        #[arg(short = 'k', long = "src-key", alias = "from-key", help = "Source key (or prefix)")]
        src_key_flag: Option<String>,
        #[arg(value_name = "DEST_KEY", help = "Destination key or prefix (positional or via -K/--dest-key)")]
        dest_key: Option<String>,
        #[arg(short = 'K', long = "dest-key", alias = "to-key", help = "Destination key (or prefix)")]
        dest_key_flag: Option<String>,
        #[arg(short = 'd', long = "dest-ns", alias = "to-ns", alias = "dest-namespace", help = "Destination namespace (defaults to source namespace)")]
        dest_namespace: Option<String>,
        #[arg(short = 'p', long = "prefix", help = "Move all objects with matching prefix")]
        prefix: bool,
    },
    /// Delete all objects matching a prefix
    DeletePrefix {
        #[arg(value_name = "NAMESPACE", help = "Storage namespace (positional or via -n/--ns)")]
        namespace: Option<String>,
        #[arg(short = 'n', long = "ns", alias = "namespace", help = "Storage namespace")]
        namespace_flag: Option<String>,
        #[arg(value_name = "PREFIX", help = "Key prefix to delete (positional or via -p/--prefix)")]
        prefix: Option<String>,
        #[arg(short = 'p', long = "prefix", help = "Key prefix to delete")]
        prefix_flag: Option<String>,
    },
    /// Cryptographically verify blob integrity on disk
    Verify {
        #[arg(value_name = "NAMESPACE", help = "Storage namespace (positional or via -n/--ns)")]
        namespace: Option<String>,
        #[arg(short = 'n', long = "ns", alias = "namespace", help = "Storage namespace")]
        namespace_flag: Option<String>,
        #[arg(value_name = "KEY", help = "Object key/path (positional or via -k/--key)")]
        object_key: Option<String>,
        #[arg(short = 'k', long = "key", help = "Object key (path)")]
        key_flag: Option<String>,
    },
    /// Generate a pre-signed capability download ticket URL
    Ticket {
        #[arg(value_name = "NAMESPACE", help = "Storage namespace (positional or via -n/--ns)")]
        namespace: Option<String>,
        #[arg(short = 'n', long = "ns", alias = "namespace", help = "Storage namespace")]
        namespace_flag: Option<String>,
        #[arg(value_name = "KEY", help = "Object key/path (positional or via -k/--key)")]
        object_key: Option<String>,
        #[arg(short = 'k', long = "key", help = "Object key (path)")]
        key_flag: Option<String>,
        #[arg(
            short = 'o',
            long = "operation",
            alias = "op",
            help = "Permitted operation (READ, WRITE)",
            default_value = "READ"
        )]
        operation: Option<String>,
        #[arg(short = 't', long = "ttl", help = "Ticket time-to-live in seconds", default_value = "3600")]
        ttl: Option<u64>,
    },
    /// List capability download/upload tickets (via Admin API)
    Tickets {
        #[arg(short = 'n', long = "ns", alias = "namespace", help = "Filter by namespace (defaults to all '*')")]
        namespace: Option<String>,
        #[arg(short = 'k', long = "key", help = "Filter by object key")]
        key: Option<String>,
        #[arg(
            short = 'a',
            long = "all",
            help = "Include expired and revoked tickets",
            default_value = "true"
        )]
        all: bool,
        #[arg(
            short,
            long,
            help = "Pagination cursor (opaque string from previous page)"
        )]
        cursor: Option<String>,
        #[arg(short, long, help = "Maximum items to return (1-500, default: 100)")]
        limit: Option<usize>,
    },
    /// Revoke a capability ticket by signature or ID
    RevokeTicket {
        #[arg(value_name = "SIGNATURE", help = "Capability ticket signature or ID to revoke (positional or via -s/--sig)")]
        signature: Option<String>,
        #[arg(short = 's', long = "sig", alias = "ticket", help = "Capability ticket signature or ID")]
        signature_flag: Option<String>,
    },
    /// Batch delete multiple objects by key within a namespace
    #[command(name = "batch-delete", alias = "batch_delete")]
    BatchDelete {
        #[arg(short = 'n', long = "ns", alias = "namespace", help = "Storage namespace (via -n/--ns or first positional argument)")]
        namespace: Option<String>,
        #[arg(help = "Namespace followed by object keys, or keys when using -n/--ns")]
        keys: Vec<String>,
    },
    /// Re-enable a revoked capability ticket
    #[command(name = "enable-ticket", alias = "enable_ticket")]
    EnableTicket {
        #[arg(value_name = "SIGNATURE", help = "Capability ticket signature to re-enable (positional or via -s/--sig)")]
        signature: Option<String>,
        #[arg(short = 's', long = "sig", alias = "ticket", help = "Capability ticket signature")]
        signature_flag: Option<String>,
    },
    /// Permanently delete a capability ticket
    #[command(name = "delete-ticket", alias = "delete_ticket")]
    DeleteTicket {
        #[arg(value_name = "SIGNATURE", help = "Capability ticket signature or ID to permanently delete (positional or via -s/--sig)")]
        signature: Option<String>,
        #[arg(short = 's', long = "sig", alias = "ticket", help = "Capability ticket signature or ID")]
        signature_flag: Option<String>,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum BlobNsCommands {
    /// List all storage namespaces and quotas
    #[command(alias = "ls")]
    List,
    /// Inspect metadata and settings for a specific namespace
    Get {
        #[arg(value_name = "NAME", help = "Namespace name (positional or via -n/--name)")]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Namespace name")]
        name_flag: Option<String>,
    },
    /// Query live storage quota headroom and consumption statistics
    Usage {
        #[arg(value_name = "NAME", help = "Namespace name (positional or via -n/--name)")]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Namespace name")]
        name_flag: Option<String>,
    },
    /// Create a new storage namespace
    #[command(alias = "add")]
    Create {
        #[arg(value_name = "NAME", help = "Namespace name (positional or via -n/--name)")]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Namespace name")]
        name_flag: Option<String>,
        #[arg(
            short = 'b',
            long = "bytes",
            alias = "max-bytes",
            alias = "size",
            help = "Maximum storage quota in bytes (e.g. 1073741824 for 1GB)"
        )]
        max_bytes: Option<u64>,
        #[arg(short = 'p', long = "public", help = "Expose namespace publicly without authentication")]
        public: bool,
    },
    /// Update an existing namespace quota, visibility, or rename it
    Update {
        #[arg(value_name = "NAME", help = "Current namespace name (positional or via -n/--name)")]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Current namespace name")]
        name_flag: Option<String>,
        #[arg(short = 'N', long = "new-name", alias = "rename", help = "New namespace name")]
        new_name: Option<String>,
        #[arg(short = 'b', long = "bytes", alias = "max-bytes", help = "New maximum storage quota in bytes (0 = unlimited)")]
        max_bytes: Option<u64>,
        #[arg(short = 'p', long = "public", help = "Update public visibility (true or false)")]
        public: Option<bool>,
    },
    /// Delete a namespace and all contained objects
    #[command(alias = "remove", alias = "rm")]
    Delete {
        #[arg(value_name = "NAME", help = "Namespace name (positional or via -n/--name)")]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Namespace name")]
        name_flag: Option<String>,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum McpCommands {
    /// List all tools exposed by the Axiom MCP server
    Tools,
    /// Call an Axiom MCP tool with JSON arguments
    Call {
        #[arg(value_name = "TOOL", help = "Tool name (positional or via -t/--tool)")]
        tool: Option<String>,
        #[arg(short = 't', long = "tool", help = "Tool name (e.g. db_query, blob_list, db_schema)")]
        tool_flag: Option<String>,
        #[arg(
            short = 'a',
            long = "args",
            help = r#"Arguments JSON object string, e.g. '{"database":"main","query":"SELECT 1"}'"#
        )]
        args: Option<String>,
    },
    /// List all resources exposed by the Axiom MCP server
    Resources,
    /// Run the stdio MCP bridge server for Claude Desktop, Cursor, or agent runtimes
    Serve {
        #[arg(short = 's', long = "stdio", help = "Run in stdio mode (default)", default_value = "true")]
        stdio: bool,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum SetupCommands {
    /// Check whether initial setup is required
    Begin,
    /// Create the primary admin account
    Account {
        #[arg(
            value_name = "USERNAME",
            help = "Admin username (positional or via -u/--user)"
        )]
        username: Option<String>,
        #[arg(
            short = 'u',
            long = "user",
            alias = "username",
            help = "Admin username"
        )]
        user: Option<String>,
        #[arg(short = 'e', long = "email", help = "Admin email address")]
        email: Option<String>,
        #[arg(
            short = 'p',
            long = "password",
            alias = "pass",
            help = "Admin password (if omitted, interactive prompt is used)"
        )]
        password: Option<String>,
    },
    /// Register the first upstream database during setup
    Database {
        #[arg(value_name = "ALIAS", help = "Database alias (positional or via -a/--alias)")]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias")]
        alias_flag: Option<String>,
        #[arg(value_name = "URL", help = "Database connection URL (positional or via -c/--conn)")]
        url: Option<String>,
        #[arg(short = 'c', long = "conn", alias = "connection-url", help = "Database connection URL")]
        url_flag: Option<String>,
        #[arg(short = 'e', long = "engine", alias = "dialect", help = "Engine dialect")]
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
                command: KeyCommands::Create { name, name_flag, role, .. },
            }) => {
                assert_eq!(name.or(name_flag).as_deref(), Some("app_key"));
                assert_eq!(role.as_deref(), Some("readonly"));
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
                        alias_flag,
                        connection_url,
                        pool_max,
                        ..
                    },
            }) => {
                assert_eq!(alias.or(alias_flag).as_deref(), Some("analytics"));
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
        let args = [
            "axiom",
            "user",
            "add",
            "ops_admin",
            "-e",
            "ops@axiom.local",
            "-p",
            "secret123",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse user add");
        match cli.command {
            Some(Commands::User {
                command:
                    UserCommands::Add {
                        username,
                        user,
                        email,
                        password,
                        ..
                    },
            }) => {
                assert_eq!(username.or(user), Some("ops_admin".to_string()));
                assert_eq!(email, Some("ops@axiom.local".to_string()));
                assert_eq!(password, Some("secret123".to_string()));
            }
            _ => panic!("Expected User Add command"),
        }

        // Test with short flags -u -e -p
        let args_flags = [
            "axiom",
            "user",
            "add",
            "-u",
            "flag_user",
            "-e",
            "flag@axiom.local",
            "-p",
            "pass456",
        ];
        let cli_flags = Cli::try_parse_from(args_flags).expect("Failed to parse user add with flags");
        match cli_flags.command {
            Some(Commands::User {
                command:
                    UserCommands::Add {
                        username,
                        user,
                        email,
                        password,
                        ..
                    },
            }) => {
                assert_eq!(username.or(user), Some("flag_user".to_string()));
                assert_eq!(email, Some("flag@axiom.local".to_string()));
                assert_eq!(password, Some("pass456".to_string()));
            }
            _ => panic!("Expected User Add command with flags"),
        }
    }

    #[test]
    fn test_cli_parse_key_rotate() {
        let args = ["axiom", "key", "rotate", "app_service_key"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse key rotate");
        match cli.command {
            Some(Commands::Key {
                command: KeyCommands::Rotate { name, name_flag },
            }) => {
                assert_eq!(name.or(name_flag).as_deref(), Some("app_service_key"));
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
                        name_flag,
                        description,
                        permissions,
                    },
            }) => {
                assert_eq!(name.or(name_flag).as_deref(), Some("analyst"));
                assert_eq!(description.as_deref(), Some("Updated role description"));
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
                command: DbCommands::Test { alias, alias_flag },
            }) => {
                assert_eq!(alias.or(alias_flag).as_deref(), Some("production_pg"));
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
                command: DbCommands::TestUrl { url, url_flag, alias },
            }) => {
                assert_eq!(url.or(url_flag).as_deref(), Some("sqlite://data/custom.db"));
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
                        alias_flag,
                        sql,
                        query_flag,
                        params,
                        timeout,
                    },
            }) => {
                assert_eq!(alias.or(alias_flag).as_deref(), Some("main_db"));
                assert_eq!(sql.or(query_flag).as_deref(), Some("SELECT * FROM users"));
                assert_eq!(params.as_deref(), Some(r#"["active"]"#));
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
                command: DbCommands::Tables { alias, alias_flag, limit, .. },
            }) => {
                assert_eq!(alias.or(alias_flag).as_deref(), Some("analytics_db"));
                assert_eq!(limit, Some(50));
            }
            _ => panic!("Expected Db Tables command"),
        }

        let schema_args = ["axiom", "db", "schema", "analytics_db", "events"];
        let schema_cli = Cli::try_parse_from(schema_args).expect("Failed to parse db schema");
        match schema_cli.command {
            Some(Commands::Db {
                command: DbCommands::Schema { alias, alias_flag, table, table_flag },
            }) => {
                assert_eq!(alias.or(alias_flag).as_deref(), Some("analytics_db"));
                assert_eq!(table.or(table_flag).as_deref(), Some("events"));
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
                        alias_flag,
                        table,
                        table_flag,
                        sort,
                        order,
                        filter,
                        ..
                    },
            }) => {
                assert_eq!(alias.or(alias_flag).as_deref(), Some("main_db"));
                assert_eq!(table.or(table_flag).as_deref(), Some("users"));
                assert_eq!(sort.as_deref(), Some("id"));
                assert_eq!(order.as_deref(), Some("desc"));
                assert_eq!(filter.as_deref(), Some(r#"{"status":{"eq":"active"}}"#));
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
                        namespace_flag,
                        object_key,
                        key_flag,
                        file,
                        file_flag,
                        content_type,
                        ttl,
                    },
            }) => {
                assert_eq!(namespace.or(namespace_flag).as_deref(), Some("avatars"));
                assert_eq!(object_key.or(key_flag).as_deref(), Some("user1.png"));
                assert_eq!(file.or(file_flag).as_deref(), Some("./me.png"));
                assert_eq!(content_type.as_deref(), Some("image/png"));
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
                        namespace_flag,
                        object_key,
                        key_flag,
                        output,
                        ticket,
                    },
            }) => {
                assert_eq!(namespace.or(namespace_flag).as_deref(), Some("avatars"));
                assert_eq!(object_key.or(key_flag).as_deref(), Some("user1.png"));
                assert_eq!(output.as_deref(), Some("./download.png"));
                assert_eq!(ticket.as_deref(), Some("sig123"));
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
                        src_ns_flag,
                        src_key,
                        src_key_flag,
                        dest_key,
                        dest_key_flag,
                        dest_namespace,
                        prefix,
                    },
            }) => {
                assert_eq!(src_namespace.or(src_ns_flag).as_deref(), Some("raw"));
                assert_eq!(src_key.or(src_key_flag).as_deref(), Some("data/"));
                assert_eq!(dest_key.or(dest_key_flag).as_deref(), Some("backup/"));
                assert_eq!(dest_namespace.as_deref(), Some("archive"));
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
            "--cursor",
            "cur_123",
            "--limit",
            "50",
        ];
        let tickets_cli = Cli::try_parse_from(tickets_args).expect("Failed to parse blob tickets");
        match tickets_cli.command {
            Some(Commands::Blob {
                command:
                    BlobCommands::Tickets {
                        namespace,
                        key,
                        all,
                        cursor,
                        limit,
                    },
            }) => {
                assert_eq!(namespace, Some("assets".to_string()));
                assert_eq!(key, Some("report.pdf".to_string()));
                assert_eq!(cursor, Some("cur_123".to_string()));
                assert_eq!(limit, Some(50));
                assert!(all);
            }
            _ => panic!("Expected Blob Tickets command"),
        }

        let revoke_args = ["axiom", "blob", "revoke-ticket", "sig_xyz_123"];
        let revoke_cli =
            Cli::try_parse_from(revoke_args).expect("Failed to parse blob revoke-ticket");
        match revoke_cli.command {
            Some(Commands::Blob {
                command: BlobCommands::RevokeTicket { signature, signature_flag },
            }) => {
                assert_eq!(signature.or(signature_flag).as_deref(), Some("sig_xyz_123"));
            }
            _ => panic!("Expected Blob RevokeTicket command"),
        }

        // Batch delete and ticket enable/delete
        let batch_del_args = [
            "axiom",
            "blob",
            "batch-delete",
            "assets",
            "file1.png",
            "file2.png",
        ];
        let batch_del_cli =
            Cli::try_parse_from(batch_del_args).expect("Failed to parse blob batch-delete");
        match batch_del_cli.command {
            Some(Commands::Blob {
                command: BlobCommands::BatchDelete { namespace, keys },
            }) => {
                assert!(namespace.is_none());
                assert_eq!(keys, vec!["assets".to_string(), "file1.png".to_string(), "file2.png".to_string()]);
            }
            _ => panic!("Expected Blob BatchDelete command"),
        }

        let batch_del_flag_args = [
            "axiom",
            "blob",
            "batch-delete",
            "-n",
            "assets",
            "file1.png",
            "file2.png",
        ];
        let batch_del_flag_cli =
            Cli::try_parse_from(batch_del_flag_args).expect("Failed to parse blob batch-delete with -n");
        match batch_del_flag_cli.command {
            Some(Commands::Blob {
                command: BlobCommands::BatchDelete { namespace, keys },
            }) => {
                assert_eq!(namespace.as_deref(), Some("assets"));
                assert_eq!(keys, vec!["file1.png".to_string(), "file2.png".to_string()]);
            }
            _ => panic!("Expected Blob BatchDelete command with -n"),
        }

        let enable_ticket_args = ["axiom", "blob", "enable-ticket", "sig_xyz_123"];
        let enable_cli =
            Cli::try_parse_from(enable_ticket_args).expect("Failed to parse enable-ticket");
        match enable_cli.command {
            Some(Commands::Blob {
                command: BlobCommands::EnableTicket { signature, signature_flag },
            }) => {
                assert_eq!(signature.or(signature_flag).as_deref(), Some("sig_xyz_123"));
            }
            _ => panic!("Expected Blob EnableTicket command"),
        }

        let delete_ticket_args = ["axiom", "blob", "delete-ticket", "sig_xyz_123"];
        let del_cli =
            Cli::try_parse_from(delete_ticket_args).expect("Failed to parse delete-ticket");
        match del_cli.command {
            Some(Commands::Blob {
                command: BlobCommands::DeleteTicket { signature, signature_flag },
            }) => {
                assert_eq!(signature.or(signature_flag).as_deref(), Some("sig_xyz_123"));
            }
            _ => panic!("Expected Blob DeleteTicket command"),
        }

        // Namespace commands: Create (with --public), Update, Get, Usage
        let ns_create_args = [
            "axiom",
            "blob",
            "ns",
            "create",
            "public-media",
            "--max-bytes",
            "10485760",
            "--public",
        ];
        let ns_create_cli =
            Cli::try_parse_from(ns_create_args).expect("Failed to parse blob ns create");
        match ns_create_cli.command {
            Some(Commands::Blob {
                command:
                    BlobCommands::Ns {
                        command:
                            BlobNsCommands::Create {
                                name,
                                name_flag,
                                max_bytes,
                                public,
                            },
                    },
            }) => {
                assert_eq!(name.or(name_flag).as_deref(), Some("public-media"));
                assert_eq!(max_bytes, Some(10485760));
                assert!(public);
            }
            _ => panic!("Expected Blob Ns Create command"),
        }

        let ns_usage_args = ["axiom", "blob", "ns", "usage", "public-media"];
        let ns_usage_cli =
            Cli::try_parse_from(ns_usage_args).expect("Failed to parse blob ns usage");
        match ns_usage_cli.command {
            Some(Commands::Blob {
                command:
                    BlobCommands::Ns {
                        command: BlobNsCommands::Usage { name, name_flag },
                    },
            }) => {
                assert_eq!(name.or(name_flag).as_deref(), Some("public-media"));
            }
            _ => panic!("Expected Blob Ns Usage command"),
        }
    }

    #[test]
    fn test_cli_parse_mcp_commands() {
        let tools_args = ["axiom", "mcp", "tools"];
        let tools_cli = Cli::try_parse_from(tools_args).expect("Failed to parse mcp tools");
        assert!(matches!(
            tools_cli.command,
            Some(Commands::Mcp {
                command: McpCommands::Tools
            })
        ));

        let call_args = [
            "axiom",
            "mcp",
            "call",
            "db_query",
            "-a",
            "{\"database\":\"main\",\"query\":\"SELECT 1\"}",
        ];
        let call_cli = Cli::try_parse_from(call_args).expect("Failed to parse mcp call");
        match call_cli.command {
            Some(Commands::Mcp {
                command: McpCommands::Call { tool, tool_flag, args },
            }) => {
                assert_eq!(tool.or(tool_flag).as_deref(), Some("db_query"));
                assert_eq!(
                    args,
                    Some("{\"database\":\"main\",\"query\":\"SELECT 1\"}".to_string())
                );
            }
            _ => panic!("Expected Mcp Call command"),
        }

        let serve_args = ["axiom", "mcp", "serve"];
        let serve_cli = Cli::try_parse_from(serve_args).expect("Failed to parse mcp serve");
        assert!(matches!(
            serve_cli.command,
            Some(Commands::Mcp {
                command: McpCommands::Serve { stdio: true }
            })
        ));
    }

    #[test]
    fn test_cli_parse_completions_and_brief() {
        let comp_args = ["axiom", "completions", "bash"];
        let comp_cli = Cli::try_parse_from(comp_args).expect("Failed to parse completions");
        assert!(matches!(
            comp_cli.command,
            Some(Commands::Completions {
                shell: clap_complete::Shell::Bash
            })
        ));

        let brief_args = ["axiom", "--brief"];
        let brief_cli = Cli::try_parse_from(brief_args).expect("Failed to parse --brief");
        assert!(brief_cli.brief);
    }

    #[test]
    fn test_cli_parse_login_and_setup() {
        let login_args = ["axiom", "login", "admin", "-p", "mypassword123"];
        let login_cli = Cli::try_parse_from(login_args).expect("Failed to parse login");
        match login_cli.command {
            Some(Commands::Login { username, user, password }) => {
                assert_eq!(username.or(user), Some("admin".to_string()));
                assert_eq!(password, Some("mypassword123".to_string()));
            }
            _ => panic!("Expected Login command"),
        }

        // Test login with -u flag
        let login_flag_args = ["axiom", "login", "-u", "admin_flag", "-p", "pass123"];
        let login_flag_cli = Cli::try_parse_from(login_flag_args).expect("Failed to parse login with -u");
        match login_flag_cli.command {
            Some(Commands::Login { username, user, password }) => {
                assert_eq!(username.or(user), Some("admin_flag".to_string()));
                assert_eq!(password, Some("pass123".to_string()));
            }
            _ => panic!("Expected Login command with -u"),
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
                command: Some(SetupCommands::Account { username, user, email: _, password }),
            }) => {
                assert_eq!(username.or(user), Some("superadmin".to_string()));
                assert_eq!(password, Some("longsecretpass".to_string()));
            }
            _ => panic!("Expected Setup Account command"),
        }

        // Test setup account with -u and -e and -p
        let setup_flag_args = [
            "axiom",
            "setup",
            "account",
            "-u",
            "superadmin_flag",
            "-e",
            "super@axiom.local",
            "-p",
            "flagpass789",
        ];
        let setup_flag_cli = Cli::try_parse_from(setup_flag_args).expect("Failed to parse setup account with flags");
        match setup_flag_cli.command {
            Some(Commands::Setup {
                command: Some(SetupCommands::Account { username, user, email, password }),
            }) => {
                assert_eq!(username.or(user), Some("superadmin_flag".to_string()));
                assert_eq!(email, Some("super@axiom.local".to_string()));
                assert_eq!(password, Some("flagpass789".to_string()));
            }
            _ => panic!("Expected Setup Account command with flags"),
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
                command: ClusterCommands::Connect { target_url, url_flag, secret },
            }) => {
                assert_eq!(target_url.or(url_flag).as_deref(), Some("http://10.0.0.2:4500"));
                assert_eq!(secret, "shared_secret_123");
            }
            _ => panic!("Expected Cluster Connect command"),
        }

        // Remove / disconnect
        let args = ["axiom", "cluster", "remove", "node_999"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse cluster remove");
        match cli.command {
            Some(Commands::Cluster {
                command: ClusterCommands::Remove { node_id, id_flag },
            }) => {
                assert_eq!(node_id.or(id_flag).as_deref(), Some("node_999"));
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
            "--peer-url",
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
                        id_flag,
                        moniker,
                        url,
                        secret,
                    },
            }) => {
                assert_eq!(node_id.or(id_flag).as_deref(), Some("node_999"));
                assert_eq!(moniker.as_deref(), Some("node-east"));
                assert_eq!(url.as_deref(), Some("http://10.0.0.3:4500"));
                assert_eq!(secret.as_deref(), Some("new_secret"));
            }
            _ => panic!("Expected Cluster Update command"),
        }

        // Ping
        let args = ["axiom", "cluster", "ping", "node_999"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse cluster ping");
        match cli.command {
            Some(Commands::Cluster {
                command: ClusterCommands::Ping { node_id, id_flag },
            }) => {
                assert_eq!(node_id.or(id_flag).as_deref(), Some("node_999"));
            }
            _ => panic!("Expected Cluster Ping command"),
        }

        // Moniker
        let args = ["axiom", "cluster", "moniker", "local-gateway-primary"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse cluster moniker");
        match cli.command {
            Some(Commands::Cluster {
                command: ClusterCommands::Moniker { moniker, moniker_flag },
            }) => {
                assert_eq!(moniker.or(moniker_flag).as_deref(), Some("local-gateway-primary"));
            }
            _ => panic!("Expected Cluster Moniker command"),
        }

        // Add alias for connect
        let args = [
            "axiom",
            "cluster",
            "add",
            "http://10.0.0.4:4500",
            "-s",
            "sec123",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse cluster add alias");
        assert!(matches!(
            cli.command,
            Some(Commands::Cluster {
                command: ClusterCommands::Connect { .. }
            })
        ));
    }

    #[test]
    fn test_cli_parse_user_crud_and_aliases() {
        let args = [
            "axiom",
            "user",
            "create",
            "alice",
            "--email",
            "alice@example.com",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse user create alias");
        assert!(matches!(
            cli.command,
            Some(Commands::User {
                command: UserCommands::Add { .. }
            })
        ));

        let args = [
            "axiom",
            "user",
            "update",
            "alice",
            "--email",
            "new_alice@example.com",
            "-p",
            "newpass123",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse user update");
        match cli.command {
            Some(Commands::User {
                command:
                    UserCommands::Update {
                        username,
                        user,
                        email,
                        password,
                        ..
                    },
            }) => {
                assert_eq!(username.or(user), Some("alice".to_string()));
                assert_eq!(email, Some("new_alice@example.com".to_string()));
                assert_eq!(password, Some("newpass123".to_string()));
            }
            _ => panic!("Expected User Update command"),
        }

        let args = ["axiom", "user", "remove", "alice"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse user remove");
        assert!(matches!(
            cli.command,
            Some(Commands::User {
                command: UserCommands::Remove { .. }
            })
        ));

        let args = ["axiom", "user", "delete", "alice"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse user delete alias");
        assert!(matches!(
            cli.command,
            Some(Commands::User {
                command: UserCommands::Remove { .. }
            })
        ));
    }

    #[test]
    fn test_cli_parse_key_update_and_aliases() {
        let args = ["axiom", "key", "add", "-n", "agent_key", "-r", "viewer"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse key add alias");
        assert!(matches!(
            cli.command,
            Some(Commands::Key {
                command: KeyCommands::Create { .. }
            })
        ));

        let args = [
            "axiom",
            "key",
            "update",
            "agent_key",
            "-r",
            "editor",
            "--rate-limit",
            "500",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse key update");
        match cli.command {
            Some(Commands::Key {
                command:
                    KeyCommands::Update {
                        name,
                        name_flag,
                        role,
                        rate_limit,
                        ..
                    },
            }) => {
                assert_eq!(name.or(name_flag).as_deref(), Some("agent_key"));
                assert_eq!(role.as_deref(), Some("editor"));
                assert_eq!(rate_limit, Some(500));
            }
            _ => panic!("Expected Key Update command"),
        }

        let args = ["axiom", "key", "remove", "agent_key"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse key remove");
        assert!(matches!(
            cli.command,
            Some(Commands::Key {
                command: KeyCommands::Remove { .. }
            })
        ));
    }

    #[test]
    fn test_cli_parse_db_update_and_aliases() {
        let args = [
            "axiom",
            "db",
            "create",
            "-a",
            "analytics",
            "--conn",
            "sqlite://data/analytics.db",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse db create alias");
        assert!(matches!(
            cli.command,
            Some(Commands::Db {
                command: DbCommands::Add { .. }
            })
        ));

        let args = [
            "axiom",
            "db",
            "update",
            "analytics",
            "-n",
            "warehouse",
            "--pool-max",
            "25",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse db update");
        match cli.command {
            Some(Commands::Db {
                command:
                    DbCommands::Update {
                        alias,
                        alias_flag,
                        new_alias,
                        pool_max,
                        ..
                    },
            }) => {
                assert_eq!(alias.or(alias_flag).as_deref(), Some("analytics"));
                assert_eq!(new_alias.as_deref(), Some("warehouse"));
                assert_eq!(pool_max, Some(25));
            }
            _ => panic!("Expected Db Update command"),
        }

        let args = ["axiom", "db", "delete", "warehouse"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse db delete alias");
        assert!(matches!(
            cli.command,
            Some(Commands::Db {
                command: DbCommands::Remove { .. }
            })
        ));

        let args = [
            "axiom",
            "db",
            "update-rows",
            "main",
            "users",
            "{\"id\":1}",
            "{\"active\":false}",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse db update-rows");
        assert!(matches!(
            cli.command,
            Some(Commands::Db {
                command: DbCommands::UpdateRows { .. }
            })
        ));
    }

    #[test]
    fn test_cli_parse_role_aliases() {
        let args = [
            "axiom",
            "role",
            "add",
            "-n",
            "data_scientist",
            "-d",
            "Read only data",
        ];
        let cli = Cli::try_parse_from(args).expect("Failed to parse role add alias");
        assert!(matches!(
            cli.command,
            Some(Commands::Role {
                command: RoleCommands::Create { .. }
            })
        ));

        let args = ["axiom", "role", "remove", "data_scientist"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse role remove");
        assert!(matches!(
            cli.command,
            Some(Commands::Role {
                command: RoleCommands::Remove { .. }
            })
        ));
    }

    #[test]
    fn test_cli_modern_aliases_and_ergonomics() {
        // Root aliases
        let cli = Cli::try_parse_from(["axiom", "start"]).expect("parse start");
        assert!(matches!(cli.command, Some(Commands::Server(_))));

        let cli = Cli::try_parse_from(["axiom", "status"]).expect("parse status");
        assert!(matches!(cli.command, Some(Commands::Health)));

        let cli = Cli::try_parse_from(["axiom", "bench"]).expect("parse bench");
        assert!(matches!(cli.command, Some(Commands::Benchmark { .. })));

        // User ls and rm
        let cli = Cli::try_parse_from(["axiom", "user", "ls"]).expect("parse user ls");
        assert!(matches!(
            cli.command,
            Some(Commands::User {
                command: UserCommands::List { .. }
            })
        ));

        let cli = Cli::try_parse_from(["axiom", "user", "rm", "admin"]).expect("parse user rm");
        assert!(matches!(
            cli.command,
            Some(Commands::User {
                command: UserCommands::Remove { .. }
            })
        ));

        // Db ls and rm
        let cli = Cli::try_parse_from(["axiom", "db", "ls"]).expect("parse db ls");
        assert!(matches!(
            cli.command,
            Some(Commands::Db {
                command: DbCommands::List
            })
        ));

        let cli = Cli::try_parse_from(["axiom", "db", "rm", "staging"]).expect("parse db rm");
        assert!(matches!(
            cli.command,
            Some(Commands::Db {
                command: DbCommands::Remove { .. }
            })
        ));

        // Blob upload, download, ls, rm
        let cli = Cli::try_parse_from(["axiom", "blob", "ls", "media"]).expect("parse blob ls");
        assert!(matches!(
            cli.command,
            Some(Commands::Blob {
                command: BlobCommands::List { .. }
            })
        ));

        let cli = Cli::try_parse_from(["axiom", "blob", "upload", "media", "doc.pdf", "local.pdf"])
            .expect("parse blob upload");
        assert!(matches!(
            cli.command,
            Some(Commands::Blob {
                command: BlobCommands::Put { .. }
            })
        ));

        let cli = Cli::try_parse_from(["axiom", "blob", "download", "media", "doc.pdf"])
            .expect("parse blob download");
        assert!(matches!(
            cli.command,
            Some(Commands::Blob {
                command: BlobCommands::Get { .. }
            })
        ));

        let cli = Cli::try_parse_from(["axiom", "blob", "rm", "media", "doc.pdf"])
            .expect("parse blob rm");
        assert!(matches!(
            cli.command,
            Some(Commands::Blob {
                command: BlobCommands::Delete { .. }
            })
        ));

        // Blob Ns ls and rm
        let cli = Cli::try_parse_from(["axiom", "blob", "ns", "ls"]).expect("parse blob ns ls");
        assert!(matches!(
            cli.command,
            Some(Commands::Blob {
                command: BlobCommands::Ns {
                    command: BlobNsCommands::List
                }
            })
        ));

        let cli = Cli::try_parse_from(["axiom", "blob", "ns", "rm", "old_ns"])
            .expect("parse blob ns rm");
        assert!(matches!(
            cli.command,
            Some(Commands::Blob {
                command: BlobCommands::Ns {
                    command: BlobNsCommands::Delete { .. }
                }
            })
        ));

        // Cache clear / purge
        let cli = Cli::try_parse_from(["axiom", "cache", "clear"]).expect("parse cache clear");
        assert!(matches!(
            cli.command,
            Some(Commands::Cache {
                command: CacheCommands::Flush
            })
        ));

        let cli = Cli::try_parse_from(["axiom", "cache", "purge"]).expect("parse cache purge");
        assert!(matches!(
            cli.command,
            Some(Commands::Cache {
                command: CacheCommands::Flush
            })
        ));

        // Cluster peers ls and rm
        let cli = Cli::try_parse_from(["axiom", "cluster", "peers"]).expect("parse cluster peers");
        assert!(matches!(
            cli.command,
            Some(Commands::Cluster {
                command: ClusterCommands::Peers
            })
        ));

        let cli = Cli::try_parse_from(["axiom", "cluster", "rm", "node_99"])
            .expect("parse cluster rm");
        assert!(matches!(
            cli.command,
            Some(Commands::Cluster {
                command: ClusterCommands::Remove { .. }
            })
        ));
    }
}
