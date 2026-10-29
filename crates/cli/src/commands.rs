/*
 * Command-line interface argument definitions and subcommand schema parsing.
 * Owned by: crates/cli
 * Key deps: clap
 * Invariants: Parsed arguments must provide sensible defaults for host, port, and output formatting.
 * Last structural change: Phase 3 initial implementation of CLI subcommand tree.
 */

use clap::builder::styling::{AnsiColor, Effects, Styles};
use clap::{Args, Parser, Subcommand};

pub mod version;

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
  server       Start the Axiom gateway daemon (alias: start, run)
  setup        First-time setup guidance and bootstrap instructions
  status       Check server health, cluster state, and active auth context (alias: health)

DATA & STORAGE:
  db           Upstream database connections and pool management
  blob         Native blob storage maintenance, scrubbing, and namespaces

SECURITY & ACCESS:
  user         Super Admin recovery & credentials (direct host metadata DB access)
  key          Machine API keys (rate limits, roles, secrets, tokens)
  role         RBAC roles and granular permission management

OPERATIONS & DIAGNOSTICS:
  doctor       Diagnose system environment, ports, and database reachability
  health       Check server health and status (alias: status)
  metrics      Dump Prometheus exposition metrics
  cache        Cache engine inspection and cache flush/purge (aliases: clear, purge)
  cluster      Cluster mesh topology, peer nodes, and latency ping
  reload       Force dynamic reload and synchronization of metadata snapshots
  config       Configuration initialization, conversion (.env), and inspection

INTEGRATIONS & UTILITIES:
  mcp          Model Context Protocol (MCP) tool execution, discovery, and stdio bridge
  version      Inspect or atomically update workspace SemVer across crates and docs
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

    /// First-time setup guidance and bootstrap instructions
    Setup,

    /// Super administrator account management and root recovery (direct metadata DB access)
    User {
        #[command(subcommand)]
        command: Option<UserCommands>,
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

    /// Cache engine inspection and management (via Admin API)
    Cache {
        #[command(subcommand)]
        command: CacheCommands,
    },

    /// Force dynamic reload and synchronization of metadata snapshots
    Reload,

    /// Check server health and status
    #[command(alias = "status")]
    Health,

    /// Dump Prometheus exposition metrics
    Metrics,

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

    /// Inspect or atomically update workspace SemVer across crates and docs
    Version(VersionArgs),

    /// Generate shell completion scripts (bash, zsh, fish, powershell, elvish)
    Completions {
        #[arg(value_enum, help = "Target shell")]
        shell: clap_complete::Shell,
    },
}

#[derive(Args, Debug, Clone)]
pub struct VersionArgs {
    #[command(subcommand)]
    pub action: Option<VersionSubcommand>,

    /// Direct target version or command (e.g. "0.1.13")
    #[arg(index = 1)]
    pub direct_target: Option<String>,

    /// Preview file changes and replacements without writing
    #[arg(long, global = true)]
    pub dry_run: bool,

    /// Skip running cargo check to synchronize Cargo.lock
    #[arg(long, global = true)]
    pub no_cargo: bool,
}

#[derive(Subcommand, Debug, Clone)]
pub enum VersionSubcommand {
    /// Display current workspace version from Cargo.toml
    Get,
    /// Increment version (patch, minor, or major)
    Bump {
        /// Target component to increment: patch, minor, or major
        #[arg(default_value = "patch")]
        target: String,
    },
    /// Set explicit version across all target files (e.g. 0.1.13)
    Set {
        /// The new version string (e.g. 0.1.13)
        version: String,
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
        #[arg(
            value_name = "TARGET_URL",
            help = "Remote peer URL (positional or via -t/--target/--peer-url)"
        )]
        target_url: Option<String>,

        #[arg(
            short = 't',
            long = "target",
            alias = "peer-url",
            help = "Remote peer URL (e.g. http://10.0.0.2:4500)"
        )]
        url_flag: Option<String>,

        #[arg(short, long, help = "Shared cluster secret for mutual authentication")]
        secret: String,
    },

    /// Disconnect and unregister a peer node from the cluster mesh
    #[command(alias = "disconnect", alias = "delete", alias = "rm")]
    Remove {
        #[arg(
            value_name = "NODE_ID",
            help = "Node ID of the peer to remove (positional or via -i/--id)"
        )]
        node_id: Option<String>,

        #[arg(
            short = 'i',
            long = "id",
            alias = "node-id",
            help = "Node ID of the peer to remove"
        )]
        id_flag: Option<String>,
    },

    /// Update configuration for an existing registered peer node
    Update {
        #[arg(
            value_name = "NODE_ID",
            help = "Node ID of the peer to update (positional or via -i/--id)"
        )]
        node_id: Option<String>,

        #[arg(
            short = 'i',
            long = "id",
            alias = "node-id",
            help = "Node ID of the peer to update"
        )]
        id_flag: Option<String>,

        #[arg(short, long, help = "Updated peer display moniker")]
        moniker: Option<String>,

        #[arg(
            short = 't',
            long = "target",
            alias = "peer-url",
            help = "Updated peer URL endpoint"
        )]
        url: Option<String>,

        #[arg(short, long, help = "Updated shared secret")]
        secret: Option<String>,
    },

    /// Send a live ping probe to verify connectivity and measure latency to a peer node
    Ping {
        #[arg(
            value_name = "NODE_ID",
            help = "Node ID of the peer to ping (positional or via -i/--id)"
        )]
        node_id: Option<String>,

        #[arg(
            short = 'i',
            long = "id",
            alias = "node-id",
            help = "Node ID of the peer to ping"
        )]
        id_flag: Option<String>,
    },

    /// Update the local node's cluster moniker
    Moniker {
        #[arg(
            value_name = "MONIKER",
            help = "New moniker for this local cluster node (positional or via -m/--moniker)"
        )]
        moniker: Option<String>,

        #[arg(
            short = 'm',
            long = "moniker",
            help = "New moniker for this local cluster node"
        )]
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
    /// Show super administrator account details (username, email, creation time)
    #[command(
        alias = "info",
        alias = "get",
        alias = "status",
        alias = "details",
        alias = "ls",
        alias = "list"
    )]
    Show {
        #[arg(short = 'c', long = "config", help = "Path to config file")]
        config: Option<String>,
    },
    /// Update super administrator account credentials (username, email, or password)
    Update {
        #[arg(
            value_name = "NEW_USERNAME",
            help = "New super administrator username (positional or via -u/--username)"
        )]
        new_username: Option<String>,
        #[arg(
            short = 'u',
            long = "username",
            alias = "user",
            help = "New super administrator username"
        )]
        username: Option<String>,
        #[arg(
            short = 'e',
            long = "email",
            help = "New super administrator email address"
        )]
        email: Option<String>,
        #[arg(
            short = 'p',
            long = "password",
            alias = "pass",
            help = "New super administrator password (interactive prompt if omitted)"
        )]
        password: Option<String>,
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
        #[arg(
            short = 'l',
            long = "limit",
            alias = "rate-limit",
            help = "Rate limit per minute (0 = default)"
        )]
        rate_limit: Option<i64>,
        #[arg(
            short = 'e',
            long = "expires",
            alias = "expires-at",
            help = "Expiration Unix timestamp"
        )]
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
        #[arg(
            short = 'l',
            long = "limit",
            alias = "rate-limit",
            help = "Updated rate limit per minute (0 = unconstrained)"
        )]
        rate_limit: Option<i64>,
        #[arg(
            short = 'e',
            long = "expires",
            alias = "expires-at",
            help = "Updated expiration Unix timestamp"
        )]
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
        #[arg(
            short = 'd',
            long = "description",
            alias = "desc",
            help = "Role description"
        )]
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
        #[arg(
            short = 'd',
            long = "description",
            alias = "desc",
            help = "Role description"
        )]
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
        #[arg(
            value_name = "ALIAS",
            help = "Database alias (positional or via -a/--alias)"
        )]
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
        #[arg(
            short = 'm',
            long = "min",
            alias = "pool-min",
            help = "Minimum connection pool size"
        )]
        pool_min: Option<i64>,
        #[arg(
            short = 'M',
            long = "max",
            alias = "pool-max",
            help = "Maximum connection pool size"
        )]
        pool_max: Option<i64>,
    },
    /// Update an existing upstream database connection configuration
    Update {
        #[arg(
            value_name = "ALIAS",
            help = "Database alias to update (positional or via -a/--alias)"
        )]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias to update")]
        alias_flag: Option<String>,
        #[arg(
            short = 'n',
            long = "new-alias",
            alias = "rename",
            help = "Rename database alias"
        )]
        new_alias: Option<String>,
        #[arg(
            short = 'c',
            long = "conn",
            alias = "connection-url",
            help = "Updated database connection URL"
        )]
        connection_url: Option<String>,
        #[arg(
            short = 'e',
            long = "engine",
            alias = "dialect",
            help = "Updated dialect/engine"
        )]
        engine: Option<String>,
        #[arg(
            short = 'm',
            long = "min",
            alias = "pool-min",
            help = "Updated minimum connection pool size"
        )]
        pool_min: Option<i64>,
        #[arg(
            short = 'M',
            long = "max",
            alias = "pool-max",
            help = "Updated maximum connection pool size"
        )]
        pool_max: Option<i64>,
    },
    /// Test connection to an upstream database
    Test {
        #[arg(
            value_name = "ALIAS",
            help = "Database alias (positional or via -a/--alias)"
        )]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias")]
        alias_flag: Option<String>,
    },
    /// Test connection to a raw database URL before registering
    TestUrl {
        #[arg(
            value_name = "URL",
            help = "Database connection URL to probe (positional or via -c/--conn)"
        )]
        url: Option<String>,
        #[arg(
            short = 'c',
            long = "conn",
            alias = "connection-url",
            help = "Database connection URL to probe"
        )]
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
        #[arg(
            value_name = "ALIAS",
            help = "Database alias (positional or via -a/--alias)"
        )]
        alias: Option<String>,
        #[arg(short = 'a', long = "alias", help = "Database alias")]
        alias_flag: Option<String>,
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
    /// Cryptographically verify blob integrity on disk
    Verify {
        #[arg(
            value_name = "NAMESPACE",
            help = "Storage namespace (positional or via -n/--ns)"
        )]
        namespace: Option<String>,
        #[arg(
            short = 'n',
            long = "ns",
            alias = "namespace",
            help = "Storage namespace"
        )]
        namespace_flag: Option<String>,
        #[arg(
            value_name = "KEY",
            help = "Object key/path (positional or via -k/--key)"
        )]
        object_key: Option<String>,
        #[arg(short = 'k', long = "key", help = "Object key (path)")]
        key_flag: Option<String>,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum BlobNsCommands {
    /// List all storage namespaces and quotas
    #[command(alias = "ls")]
    List,
    /// Inspect metadata and settings for a specific namespace
    Get {
        #[arg(
            value_name = "NAME",
            help = "Namespace name (positional or via -n/--name)"
        )]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Namespace name")]
        name_flag: Option<String>,
    },
    /// Query live storage quota headroom and consumption statistics
    Usage {
        #[arg(
            value_name = "NAME",
            help = "Namespace name (positional or via -n/--name)"
        )]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Namespace name")]
        name_flag: Option<String>,
    },
    /// Create a new storage namespace
    #[command(alias = "add")]
    Create {
        #[arg(
            value_name = "NAME",
            help = "Namespace name (positional or via -n/--name)"
        )]
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
        #[arg(
            short = 'p',
            long = "public",
            help = "Expose namespace publicly without authentication"
        )]
        public: bool,
    },
    /// Update an existing namespace quota, visibility, or rename it
    Update {
        #[arg(
            value_name = "NAME",
            help = "Current namespace name (positional or via -n/--name)"
        )]
        name: Option<String>,
        #[arg(short = 'n', long = "name", help = "Current namespace name")]
        name_flag: Option<String>,
        #[arg(
            short = 'N',
            long = "new-name",
            alias = "rename",
            help = "New namespace name"
        )]
        new_name: Option<String>,
        #[arg(
            short = 'b',
            long = "bytes",
            alias = "max-bytes",
            help = "New maximum storage quota in bytes (0 = unlimited)"
        )]
        max_bytes: Option<u64>,
        #[arg(
            short = 'p',
            long = "public",
            help = "Update public visibility (true or false)"
        )]
        public: Option<bool>,
    },
    /// Delete a namespace and all contained objects
    #[command(alias = "remove", alias = "rm")]
    Delete {
        #[arg(
            value_name = "NAME",
            help = "Namespace name (positional or via -n/--name)"
        )]
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
        #[arg(
            short = 't',
            long = "tool",
            help = "Tool name (e.g. db_query, blob_list, db_schema)"
        )]
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
        #[arg(
            short = 's',
            long = "stdio",
            help = "Run in stdio mode (default)",
            default_value = "true"
        )]
        stdio: bool,
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
            Some(Commands::Key {
                command:
                    KeyCommands::Create {
                        name,
                        name_flag,
                        role,
                        ..
                    },
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
    fn test_cli_parse_superadmin_user_commands() {
        // Test axiom user show
        let args = ["axiom", "user", "show"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse user show");
        assert!(matches!(
            cli.command,
            Some(Commands::User {
                command: Some(UserCommands::Show { .. }),
            })
        ));

        // Test bare axiom user defaults to None subcommand (which displays super admin)
        let args_bare = ["axiom", "user"];
        let cli_bare = Cli::try_parse_from(args_bare).expect("Failed to parse bare user");
        assert!(matches!(
            cli_bare.command,
            Some(Commands::User { command: None })
        ));

        // Test axiom user update with flags
        let args_update = [
            "axiom",
            "user",
            "update",
            "-u",
            "root_super",
            "-e",
            "root@axiom.local",
            "-p",
            "secret123",
        ];
        let cli_update =
            Cli::try_parse_from(args_update).expect("Failed to parse user update with flags");
        match cli_update.command {
            Some(Commands::User {
                command:
                    Some(UserCommands::Update {
                        new_username,
                        username,
                        email,
                        password,
                        ..
                    }),
            }) => {
                assert_eq!(username.or(new_username), Some("root_super".to_string()));
                assert_eq!(email, Some("root@axiom.local".to_string()));
                assert_eq!(password, Some("secret123".to_string()));
            }
            _ => panic!("Expected User Update command"),
        }

        // Test that user delete and add are forbidden (only super admin maintenance in CLI)
        assert!(Cli::try_parse_from(["axiom", "user", "delete", "admin"]).is_err());
        assert!(Cli::try_parse_from(["axiom", "user", "remove", "admin"]).is_err());
        assert!(Cli::try_parse_from(["axiom", "user", "add", "admin"]).is_err());
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
                command:
                    DbCommands::TestUrl {
                        url,
                        url_flag,
                        alias,
                    },
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
    fn test_cli_parse_blob_commands() {
        let stats_args = ["axiom", "blob", "stats"];
        let stats_cli = Cli::try_parse_from(stats_args).expect("Failed to parse blob stats");
        assert!(matches!(
            stats_cli.command,
            Some(Commands::Blob {
                command: BlobCommands::Stats
            })
        ));

        let scrub_args = ["axiom", "blob", "scrub"];
        let scrub_cli = Cli::try_parse_from(scrub_args).expect("Failed to parse blob scrub");
        assert!(matches!(
            scrub_cli.command,
            Some(Commands::Blob {
                command: BlobCommands::Scrub
            })
        ));

        let sweep_args = ["axiom", "blob", "sweep"];
        let sweep_cli = Cli::try_parse_from(sweep_args).expect("Failed to parse blob sweep");
        assert!(matches!(
            sweep_cli.command,
            Some(Commands::Blob {
                command: BlobCommands::Sweep
            })
        ));

        let verify_args = ["axiom", "blob", "verify", "assets", "report.pdf"];
        let verify_cli = Cli::try_parse_from(verify_args).expect("Failed to parse blob verify");
        match verify_cli.command {
            Some(Commands::Blob {
                command:
                    BlobCommands::Verify {
                        namespace,
                        namespace_flag,
                        object_key,
                        key_flag,
                    },
            }) => {
                assert_eq!(namespace.or(namespace_flag).as_deref(), Some("assets"));
                assert_eq!(object_key.or(key_flag).as_deref(), Some("report.pdf"));
            }
            _ => panic!("Expected Blob Verify command"),
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
                command:
                    McpCommands::Call {
                        tool,
                        tool_flag,
                        args,
                    },
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
    fn test_cli_parse_login_and_logout_removed() {
        // Login and logout commands have been de-bloated from CLI
        assert!(Cli::try_parse_from(["axiom", "login", "admin", "-p", "mypassword123"]).is_err());
        assert!(Cli::try_parse_from(["axiom", "logout"]).is_err());
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
                command:
                    ClusterCommands::Connect {
                        target_url,
                        url_flag,
                        secret,
                    },
            }) => {
                assert_eq!(
                    target_url.or(url_flag).as_deref(),
                    Some("http://10.0.0.2:4500")
                );
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
                command:
                    ClusterCommands::Moniker {
                        moniker,
                        moniker_flag,
                    },
            }) => {
                assert_eq!(
                    moniker.or(moniker_flag).as_deref(),
                    Some("local-gateway-primary")
                );
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
    fn test_cli_parse_user_show_and_aliases() {
        let args = ["axiom", "user", "info"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse user info alias");
        assert!(matches!(
            cli.command,
            Some(Commands::User {
                command: Some(UserCommands::Show { .. })
            })
        ));

        let args = ["axiom", "user", "status"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse user status alias");
        assert!(matches!(
            cli.command,
            Some(Commands::User {
                command: Some(UserCommands::Show { .. })
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
                    Some(UserCommands::Update {
                        new_username,
                        username,
                        email,
                        password,
                        ..
                    }),
            }) => {
                assert_eq!(username.or(new_username), Some("alice".to_string()));
                assert_eq!(email, Some("new_alice@example.com".to_string()));
                assert_eq!(password, Some("newpass123".to_string()));
            }
            _ => panic!("Expected User Update command"),
        }

        // Removal/deletion is eliminated from CLI
        assert!(Cli::try_parse_from(["axiom", "user", "remove", "alice"]).is_err());
        assert!(Cli::try_parse_from(["axiom", "user", "delete", "alice"]).is_err());
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

        let cli = Cli::try_parse_from(["axiom", "setup"]).expect("parse setup");
        assert!(matches!(cli.command, Some(Commands::Setup)));

        // User ls (alias for show) and rm forbidden
        let cli = Cli::try_parse_from(["axiom", "user", "ls"]).expect("parse user ls");
        assert!(matches!(
            cli.command,
            Some(Commands::User {
                command: Some(UserCommands::Show { .. })
            })
        ));

        assert!(Cli::try_parse_from(["axiom", "user", "rm", "admin"]).is_err());

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

        let cli =
            Cli::try_parse_from(["axiom", "blob", "ns", "rm", "old_ns"]).expect("parse blob ns rm");
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

        let cli =
            Cli::try_parse_from(["axiom", "cluster", "rm", "node_99"]).expect("parse cluster rm");
        assert!(matches!(
            cli.command,
            Some(Commands::Cluster {
                command: ClusterCommands::Remove { .. }
            })
        ));
    }
}
