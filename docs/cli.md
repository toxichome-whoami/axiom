# Axiom CLI Reference Manual

Axiom includes a full-featured, zero-dependency Command Line Interface (CLI) built directly into the single binary. The CLI provides complete administration for users, upstream databases, object storage, API keys, RBAC roles, cluster meshes, configuration, and diagnostics.

Every command supports **dual-mode ergonomics**: you can supply arguments either positionally for rapid manual execution or through intuitive single-letter short flags (`-u`, `-e`, `-p`, `-a`, `-c`, `-k`, `-f`, etc.) for robust, readable shell scripting and CI/CD pipelines.

---

## Global Options

Global options apply to all subcommands and can be placed before or after the subcommand.

| Option | Flag | Description | Default |
| :--- | :--- | :--- | :--- |
| `--url` | `-U` | Base URL of the Axiom server instance | `http://127.0.0.1:4500` |
| `--api-key` | *(none, alias: `--token`)* | Admin API key or machine token for authenticated operations | None |
| `--json` | *(none)* | Format output as indented JSON | `false` |
| `--jsonl` | *(none)* | Format output as single-line JSON Lines (streaming / log ingestion) | `false` |
| `--brief` | *(none)* | Print concise summary output and exit | `false` |
| `--help` | `-h` | Display help and usage information for command or subcommand | |
| `--version` | `-V` | Display Axiom version | |

---

## Command Matrix Summary

| Command | Aliases | Description |
| :--- | :--- | :--- |
| [`axiom server`](#server) | `start`, `run` | Start the Axiom gateway daemon and API server |
| [`axiom user`](#user) | | Direct administrative user management (offline SQLite metadata DB) |
| [`axiom login`](#login) | | Authenticate as admin user against running gateway and receive session token |
| [`axiom setup`](#setup) | | Command-line first-run onboarding wizard |
| [`axiom db`](#db) | | Upstream database connections, schema reflection, and SQL execution |
| [`axiom blob`](#blob) | | Native blob storage operations, transfers, hashes, and capability tickets |
| [`axiom blob ns`](#blob-namespaces) | | Storage namespace quotas and lifecycle management |
| [`axiom key`](#key) | | Machine API key lifecycle, scoping, rate limits, and rotation |
| [`axiom role`](#role) | | RBAC roles and granular JSON permissions |
| [`axiom cluster`](#cluster) | | Multi-node cluster mesh topology, peer registration, and health |
| [`axiom mcp`](#mcp) | | Model Context Protocol tool execution, discovery, and stdio bridge |
| [`axiom doctor`](#doctor) | | Diagnose host environment, ports, and database reachability |
| [`axiom health`](#health) | `status` | Query running server health status |
| [`axiom metrics`](#metrics) | | Export Prometheus metrics |
| [`axiom benchmark`](#benchmark) | `bench` | Run built-in HTTP pipeline latency and throughput test |
| [`axiom cache`](#cache) | | Inspect cache hit rates and flush L1/L2 caches |
| [`axiom reload`](#reload) | | Force hot-reload and synchronization of metadata snapshots |
| [`axiom config`](#config) | | Initialize, inspect, or export configuration to `.env` |
| [`axiom completions`](#completions) | | Generate shell completion scripts (bash, zsh, fish, powershell, elvish) |

---

## Server

Starts the HTTP/REST API gateway, embedded blob engine, and MCP server.

```bash
# Start with default settings (reads ./config.toml if present)
axiom server run

# Start with a specific configuration file
axiom server run -c /etc/axiom/production.toml

# Start and override host or port
axiom server run --host 0.0.0.0 --port 8080
```

### Options

| Flag | Long | Description |
| :--- | :--- | :--- |
| `-c` | `--config` | Path to custom `config.toml` |
| | `--host` | Host address to bind (`0.0.0.0` or `127.0.0.1`) |
| | `--port` | Port to listen on (default: `4500`) |

---

## User

Administrative human accounts have access to the Admin Web UI (`/system`) and REST endpoints. Unlike API keys, `axiom user` operates directly against the local metadata SQLite database, making it functional even when the server daemon is stopped.

### `axiom user add`
Create a new admin user.

```bash
# Interactive password prompt (secure, terminal-safe with automatic echo restoration)
axiom user add alice -e alice@example.com

# Non-interactive / scripted (using flags)
axiom user add -u bob -e bob@example.com -p "P@ssw0rd123!"

# Dual positional syntax with short password flag
axiom user add charlie -p "SecurePass987!"
```

| Flag | Long | Positional | Description |
| :--- | :--- | :--- | :--- |
| `-u` | `--user`, `--username` | Yes (1st) | Admin username |
| `-e` | `--email` | | Admin email address (optional) |
| `-p` | `--password`, `--pass` | | Plaintext password (prompts securely if omitted) |
| `-c` | `--config` | | Custom config path to locate metadata database |

### `axiom user update`
Update password or email of an existing admin user.

```bash
axiom user update alice -p "NewPassword456!"
axiom user update -u alice -e newalice@example.com
```

### `axiom user list` (alias: `ls`)
List all registered admin users.

```bash
axiom user list
axiom user ls --json
```

### `axiom user remove` (aliases: `delete`, `rm`)
Delete an administrative user.

```bash
axiom user remove alice
axiom user rm -u bob
```

---

## Login

Authenticate administrative credentials against a running Axiom gateway to retrieve a scoped bearer session token.

```bash
# Interactive password prompt
axiom login -u admin

# Direct password flag
axiom login -u admin -p "P@ssw0rd123!" -U http://127.0.0.1:4500
```

---

## Setup

Axiom includes a CLI setup sequence for headless first-run bootstrapping without a browser.

```bash
# 1. Check if setup is needed
axiom setup begin

# 2. Create primary admin
axiom setup account -u admin -e admin@example.com -p "AdminPass123!"

# 3. Connect initial database
axiom setup database -a primary -c "postgres://postgres:postgres@localhost:5432/app"

# 4. Create base role
axiom setup role -n full_access -p '[{"database":"*","table_name":"*","operations":["*"]}]'

# 5. Issue initial root API key
axiom setup key -n primary_key -r full_access

# 6. Finalize setup
axiom setup finish
```

---

## DB

Manage upstream SQL database connections, run queries, introspect schema, and paginate table rows.

### `axiom db add` (alias: `create`)
Register a new upstream database connection pool.

```bash
# Positional syntax
axiom db add main_db -c "postgres://postgres:secret@localhost:5432/production"

# Flag syntax
axiom db add -a analytics -c "clickhouse://default:@localhost:9000/default" -e clickhouse -m 2 -M 20
```

| Flag | Long | Positional | Description |
| :--- | :--- | :--- | :--- |
| `-a` | `--alias` | Yes (1st) | Unique identifier for this database connection |
| `-c` | `--conn`, `--connection-url` | | Database connection string URI |
| `-e` | `--engine`, `--dialect` | | Dialect: `postgres`, `mysql`, `sqlite`, `mssql`, `clickhouse`, `snowflake`, `oracle` |
| `-m` | `--min`, `--pool-min` | | Minimum connection pool size |
| `-M` | `--max`, `--pool-max` | | Maximum connection pool size |

### `axiom db test`
Verify network reachability and authentication for a registered database alias.

```bash
axiom db test main_db
axiom db test -a analytics
```

### `axiom db test-url`
Validate a raw database connection string without saving it.

```bash
axiom db test-url -c "postgres://postgres:secret@localhost:5432/test"
```

### `axiom db list` (alias: `ls`)
List all registered upstream database connections.

```bash
axiom db list
```

### `axiom db query`
Run a read query through the Axiom gateway dialect abstraction layer.

```bash
# Positional syntax
axiom db query main_db "SELECT id, email, created_at FROM users WHERE status = $1" -p '["active"]'

# Flag syntax
axiom db query -a main_db -q "SELECT count(*) FROM orders" -t 15
```

| Flag | Long | Positional | Description |
| :--- | :--- | :--- | :--- |
| `-a` | `--alias` | Yes (1st) | Target database alias |
| `-q` | `--query`, `--sql` | Yes (2nd) | SQL query string |
| `-p` | `--params` | | JSON parameters array, e.g. `[1, "text"]` |
| `-t` | `--timeout` | | Query execution timeout in seconds (default: 30) |

### `axiom db exec`
Execute an insert, update, or DDL command and return affected row counts.

```bash
axiom db exec main_db "UPDATE users SET status = $1 WHERE last_login < $2" -p '["inactive", "2025-01-01"]'
```

### `axiom db rows`
Fetch paginated rows from a table with automated filtering and sorting.

```bash
# Fetch first 20 rows
axiom db rows main_db users --limit 20

# Filter, sort, and paginate
axiom db rows main_db users -l 50 -o 100 -s created_at -d desc -w '{"status":"active"}'
```

| Flag | Long | Positional | Description |
| :--- | :--- | :--- | :--- |
| `-a` | `--alias` | Yes (1st) | Target database alias |
| `-t` | `--table` | Yes (2nd) | Table name |
| `-l` | `--limit` | | Max rows to return (default: 50) |
| `-o` | `--offset` | | Row offset for pagination |
| `-s` | `--sort` | | Column name to sort by |
| `-d` | `--order` | | Sort direction: `asc` or `desc` |
| `-w` | `--where` | | JSON filter conditions, e.g. `'{"status":"active"}'` |
| | `--fields` | | Comma-separated list of columns to select |

### `axiom db schema` & Introspection
Introspect upstream schema objects:

```bash
# List all tables in a database
axiom db tables main_db

# Describe column types and nullability for a table
axiom db schema main_db users

# Inspect table indexes
axiom db indexes main_db users

# Inspect foreign keys
axiom db foreign-keys main_db orders

# Inspect primary key definition
axiom db primary-key main_db users
```

### `axiom db update`
Update connection parameters or rename a database alias.

```bash
axiom db update main_db -c "postgres://newuser:newpass@localhost:5432/production" -M 50
axiom db update -a old_alias -n new_alias
```

### `axiom db remove` (aliases: `delete`, `rm`)
Deregister an upstream database connection.

```bash
axiom db remove old_db
axiom db rm -a old_db
```

---

## Blob

Axiom includes native, high-performance object storage with BLAKE3 content-addressable deduplication, LSM metadata indexing, streaming transfers, and capability tickets.

### `axiom blob put` (alias: `upload`)
Upload a file or stream standard input to a storage namespace.

```bash
# Positional syntax
axiom blob put documents reports/q1.pdf ./q1.pdf

# Flag syntax
axiom blob put -n documents -k reports/q1.pdf -f ./q1.pdf -t "application/pdf"

# Upload from standard input (stdin)
cat log.txt | axiom blob put -n logs -k today.log -f -
```

| Flag | Long | Positional | Description |
| :--- | :--- | :--- | :--- |
| `-n` | `--ns`, `--namespace` | Yes (1st) | Target storage namespace |
| `-k` | `--key` | Yes (2nd) | Object key (storage path) |
| `-f` | `--file`, `--input` | Yes (3rd) | Local file path to read (or `-` for stdin) |
| `-t` | `--type`, `--content-type` | | Explicit MIME content type |
| | `--ttl` | | Object time-to-live in seconds (expires automatically) |

### `axiom blob get` (alias: `download`)
Download an object from a namespace.

```bash
# Download to local file
axiom blob get documents reports/q1.pdf -o ./downloaded_q1.pdf

# Stream to stdout
axiom blob get -n documents -k reports/q1.pdf -o -
```

| Flag | Long | Positional | Description |
| :--- | :--- | :--- | :--- |
| `-n` | `--ns`, `--namespace` | Yes (1st) | Target storage namespace |
| `-k` | `--key` | Yes (2nd) | Object key |
| `-o` | `--out`, `--output` | | Destination file path (or `-` for stdout) |

### `axiom blob head`
Inspect object metadata including size, BLAKE3 hash, MIME type, and expiration without downloading the content payload.

```bash
axiom blob head documents reports/q1.pdf
```

### `axiom blob list` (alias: `ls`)
List objects in a namespace with optional prefix filtering.

```bash
axiom blob list documents
axiom blob list -n documents -p "reports/" -l 50
```

### `axiom blob delete` (aliases: `remove`, `rm`)
Delete an individual object.

```bash
axiom blob delete documents reports/old_report.pdf
```

### `axiom blob batch-delete`
Delete multiple objects atomically.

```bash
axiom blob batch-delete -n documents key1.txt key2.txt key3.txt
```

### `axiom blob copy` & `move`
Copy or rename objects across keys or namespaces without re-uploading bytes over the wire.

```bash
# Copy within namespace
axiom blob copy -n docs -k source.txt -K backup.txt

# Move across namespaces
axiom blob move -n staging -k image.png -N production -K image.png
```

### `axiom blob ticket`
Generate a cryptographically pre-signed capability download ticket.

```bash
# Generate pre-signed download ticket valid for 3600 seconds (1 hour)
axiom blob ticket documents reports/q1.pdf --ttl 3600
```

### `axiom blob verify` & `scrub`
Verify disk integrity:

```bash
# Verify a single object against stored BLAKE3 hash
axiom blob verify documents reports/q1.pdf

# Scrub entire storage cluster for bitrot or silent disk corruption
axiom blob scrub
```

---

## Blob Namespaces

Manage storage partitions and byte/object quotas.

```bash
# List all namespaces
axiom blob ns list

# Create a new namespace with 50 GB storage limit
axiom blob ns create -n media --max-bytes 53687091200 --max-objects 100000

# Inspect namespace configuration and live quota usage
axiom blob ns get media
axiom blob ns usage media

# Update quota
axiom blob ns update media --max-bytes 107374182400

# Delete an empty namespace
axiom blob ns delete media
```

---

## Key

Machine API keys authenticate HTTP REST requests and MCP sessions using the `X-Axiom-Key` header.

### `axiom key create` (alias: `add`)
Issue a new scoped API key.

```bash
# Positional syntax
axiom key create frontend_app -r read_only

# Flag syntax with rate limiting and expiration timestamp
axiom key create -n payment_worker -r backend_service -l 1000 -e 1767225600
```

| Flag | Long | Positional | Description |
| :--- | :--- | :--- | :--- |
| `-n` | `--name` | Yes (1st) | Unique key identifier |
| `-r` | `--role` | | Attached RBAC role name |
| `-s` | `--secret` | | Custom secret string (if omitted, high-entropy secret is generated) |
| `-l` | `--limit`, `--rate-limit` | | Requests allowed per minute (0 = unlimited) |
| `-e` | `--expires`, `--expires-at` | | Expiration timestamp in seconds since UNIX epoch |

### `axiom key list` (alias: `ls`)
List active API keys and their assigned roles.

```bash
axiom key list
```

### `axiom key rotate`
Rotate the secret for an existing key without changing its ID or permissions.

```bash
axiom key rotate frontend_app
```

### `axiom key update`
Change role attachment or adjust rate limits.

```bash
axiom key update frontend_app -r read_write -l 5000
```

### `axiom key remove` (aliases: `delete`, `rm`, `revoke`)
Revoke an API key immediately.

```bash
axiom key remove frontend_app
```

---

## Role

Role-Based Access Control (RBAC) grants fine-grained permissions across databases, tables, and operations.

### `axiom role create` (alias: `add`)
Create a new role with a JSON permission ruleset.

```bash
# Positional name with permission flag
axiom role create read_only \
  -p '[{"database":"*","table_name":"*","operations":["SELECT"]}]' \
  -d "Read-only access across all databases"

# Scoped table permissions
axiom role create app_role \
  -p '[{"database":"main_db","table_name":"users","operations":["SELECT","INSERT","UPDATE"]}]'
```

### `axiom role list` (alias: `ls`)
List all registered roles and their permission matrices.

```bash
axiom role list
```

### `axiom role update`
Update role description or permission definitions.

```bash
axiom role update read_only -d "Updated description" -p '[...]'
```

### `axiom role remove` (aliases: `delete`, `rm`)
Delete an RBAC role.

```bash
axiom role remove app_role
```

---

## Cluster

Axiom nodes form a peer-to-peer (P2P) mesh network for distributed health telemetry and synchronized metadata replication.

### `axiom cluster status`
Show local node identity, cluster secret hash, and peer health.

```bash
axiom cluster status
```

### `axiom cluster peers` (alias: `list`, `ls`)
List all connected peer nodes in the cluster.

```bash
axiom cluster peers
```

### `axiom cluster connect` (alias: `add`)
Join a remote peer node into the local mesh.

```bash
axiom cluster connect -t http://10.0.0.2:4500 --secret "cluster_shared_secret"
```

### `axiom cluster ping`
Probe network round-trip latency to a cluster peer node.

```bash
axiom cluster ping node-1234abcd
```

### `axiom cluster remove` (aliases: `disconnect`, `delete`, `rm`)
Deregister a peer node from the cluster mesh.

```bash
axiom cluster remove -i node-1234abcd
```

---

## MCP

Axiom implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) specification, allowing AI agents like Claude Code, Cursor, Windsurf, and Claude Desktop to interact with your databases and blob storage securely.

### `axiom mcp tools`
List all tools exposed by the Axiom MCP server.

```bash
axiom mcp tools
```

### `axiom mcp call`
Execute an MCP tool directly from the terminal with JSON arguments.

```bash
axiom mcp call -t db_query -a '{"database":"main_db","query":"SELECT 1"}'
```

### `axiom mcp serve`
Start the MCP stdio bridge for local AI assistant integration.

```bash
# Stdio mode for Claude Desktop / Cursor
axiom --api-key "YOUR_AXIOM_KEY" mcp serve --stdio
```

Configuration example for `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "axiom": {
      "command": "axiom",
      "args": ["--api-key", "YOUR_AXIOM_KEY", "mcp", "serve"]
    }
  }
}
```

---

## Doctor

Runs comprehensive health, environment, network socket, and upstream database diagnostic checks.

```bash
# Check standard environment
axiom doctor

# Check custom config
axiom doctor -c /etc/axiom/config.toml
```

Checks performed:
- Metadata SQLite database accessibility and write permissions
- Port 4500 binding availability
- Storage directory accessibility and disk space
- Upstream database reachability for all registered connections
- OpenSSL / crypto provider readiness

---

## Health

Queries the live health status of a running Axiom server daemon over HTTP.

```bash
axiom health
axiom health -U http://192.168.1.100:4500
```

---

## Metrics

Exports live metrics in Prometheus exposition format.

```bash
axiom metrics
```

---

## Benchmark

Runs a high-performance HTTP pipeline stress test against the running Axiom gateway.

```bash
# Run benchmark with 50 concurrent connections for 10 seconds
axiom benchmark -c 50 -d 10

# Benchmark specific path with custom API key
axiom benchmark -c 100 -d 30 --path "/api/v1/db/main_db/users/rows" --api-key "YOUR_KEY"
```

---

## Cache

Inspect or flush the multi-tiered caching engine (L1 In-Memory LRU + L2 Persistent Cache).

```bash
# Inspect hit rates, miss counts, and memory footprint
axiom cache stats

# Invalidate and flush all cache entries
axiom cache flush
```

---

## Reload

Forces immediate synchronization and dynamic reload of cached metadata, user roles, API keys, and connection pools across worker threads.

```bash
axiom reload
```

---

## Config

Utilities for creating and validating Axiom `config.toml` files and generating environment variable templates.

```bash
# Generate a standard config.toml with defaults
axiom config init

# Generate config at custom path, overwriting if exists
axiom config init -p ./my-config.toml -f

# Inspect and validate configuration values
axiom config show -c ./config.toml

# Convert config.toml to .env format for container deployments
axiom config to-env -i ./config.toml -o ./.env
```

---

## Completions

Generates shell completion scripts for auto-completing commands, subcommands, and flags.

```bash
# Bash (Linux)
axiom completions bash > /etc/bash_completion.d/axiom

# Zsh (macOS / Linux)
axiom completions zsh > "${fpath[1]}/_axiom"

# Fish
axiom completions fish > ~/.config/fish/completions/axiom.fish

# PowerShell (Windows)
axiom completions powershell | Out-String | Invoke-Expression
```

---

## Scripting & Automation Patterns

### Bash CI/CD Pipeline Deployment

```bash
#!/usr/bin/env bash
set -euo pipefail

AXIOM_URL="http://127.0.0.1:4500"
CONFIG="/etc/axiom/config.toml"

# 1. Create root admin if not already present
axiom user add -u ci_admin -e ci@example.com -p "${ADMIN_PASSWORD}" -c "${CONFIG}" || true

# 2. Add application database
axiom db add -a app_db -c "${DATABASE_URL}" -e postgres -m 5 -M 25

# 3. Create read-write application role
axiom role create app_rw \
  -p '[{"database":"app_db","table_name":"*","operations":["SELECT","INSERT","UPDATE","DELETE"]}]' \
  -d "Automated application role"

# 4. Generate key and extract secret via JSON output
API_KEY=$(axiom key create app_service -r app_rw --json | jq -r '.key')
echo "Exported API Key: ${API_KEY}"
```

### PowerShell Deployment

```powershell
# 1. Add database connection
axiom db add app_db -c "$env:DATABASE_URL" -e postgres

# 2. Upload deployment asset to blob storage
axiom blob put -n releases -k "v1.2.0/app.zip" -f "./dist/app.zip"

# 3. Generate pre-signed capability download ticket
$ticket = axiom blob ticket releases "v1.2.0/app.zip" --ttl 7200 --json | ConvertFrom-Json
Write-Host "Download URL: $($ticket.ticket_url)"
```
