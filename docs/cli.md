<div align="center">

# Axiom CLI Reference

### Command-Line Administration, Data Operations, and Tool Automation

[![Version](https://img.shields.io/badge/version-0.1.19%2B-111827.svg?style=flat-square)](https://github.com/toxichome-whoami/axiom/releases)
[![Rust](https://img.shields.io/badge/rust-1.88%2B-b7410e.svg?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-111827.svg?style=flat-square)](../LICENSE)

</div>

## Contents

1. [Quick Start](#1-quick-start)
2. [Global Options](#2-global-options)
3. [Command Index](#3-command-index)
4. [User Management (`axiom user`)](#4-user-management-axiom-user)
5. [Authentication (`axiom login`, `axiom logout`)](#5-authentication-axiom-login-axiom-logout)
6. [Databases (`axiom db`)](#6-databases-axiom-db)
7. [Blob Storage (`axiom blob`)](#7-blob-storage-axiom-blob)
8. [Access Control (`axiom key`, `axiom role`)](#8-access-control-axiom-key-axiom-role)
9. [Cluster Mesh (`axiom cluster`)](#9-cluster-mesh-axiom-cluster)
10. [AI & MCP (`axiom mcp`)](#10-ai--mcp-axiom-mcp)
11. [Diagnostics & Ops](#11-diagnostics--ops)
12. [Configuration & Shell](#12-configuration--shell)

---

## 1. Quick Start

All commands support **dual syntax**: positional arguments for fast typing, or short flags (`-u`, `-e`, `-p`, `-a`, `-c`, `-k`, `-f`) for non-interactive scripting.

```bash
# 1. Start gateway
axiom server run

# 2. Add admin user (interactive prompt or flags)
axiom user add admin -p "s3cur3_pass!" -e admin@example.com

# 3. Connect database
axiom db add main_db -c "postgres://postgres:postgres@localhost:5432/app_db"

# 4. Create role and issue scoped API key
axiom role create app_role -p '[{"database":"main_db","table_name":"*","operations":["SELECT"]}]'
axiom key create web_app -r app_role

# 5. Create blob storage namespace
axiom blob ns create -n assets
```

---

## 2. Global Options

Apply to all subcommands. Can be placed before or after the command.

| Flag | Long | Default | Description |
| :--- | :--- | :--- | :--- |
| `-U` | `--url` | `http://127.0.0.1:4500` | Gateway base URL |
| | `--api-key` | *(none)* | Machine API key or token (alias: `--token`) |
| | `--json` | `false` | Output as formatted JSON |
| | `--jsonl` | `false` | Output as single-line JSON Lines |
| | `--brief` | `false` | Output concise single-line summary |
| `-h` | `--help` | | Print command help |
| `-V` | `--version` | | Print version |

---

## 3. Command Index

| Category | Command | Aliases | Purpose |
| :--- | :--- | :--- | :--- |
| **Daemon** | `axiom server` | `start`, `run` | Run the HTTP gateway and storage daemon |
| **Security** | `axiom user` | | Admin human user accounts (direct SQLite access) |
| | `axiom login` | | Authenticate against gateway and get bearer session |
| | `axiom logout` | | Invalidate active administrative session |
| | `axiom key` | | Scoped machine API keys and tokens |
| | `axiom role` | | RBAC permission policies |
| **Data** | `axiom db` | | Upstream SQL database connection pools and validation |
| | `axiom blob` | | Storage namespaces, bitrot scrubbing, and verification |
| | `axiom blob ns` | | Storage namespace quotas and lifecycle |
| **Operations** | `axiom cluster` | | Distributed node mesh and latency pings |
| | `axiom doctor` | | Host environment and upstream connectivity checks |
| | `axiom health` | `status` | Query live server health endpoint |
| | `axiom metrics` | | Prometheus exposition metrics |
| | `axiom cache` | | Hit/miss telemetry and cache purge |
| | `axiom reload` | | Force sync of metadata snapshots |
| | `axiom config` | | Generate, inspect, or export `config.toml` |
| **Integration**| `axiom mcp` | | Model Context Protocol tool execution & stdio bridge |
| | `axiom completions` | | Shell autocompletion scripts |

---

## 4. User Management (`axiom user`)

Operates directly against the local metadata store. Works even when the server daemon is stopped.

```bash
# Add admin user
axiom user add admin -p "secret123!" -e admin@example.com
axiom user add -u bob -p "secret123!"

# Update user
axiom user update admin -p "newsecret!"
axiom user update -u admin -e new@example.com

# List users
axiom user list
axiom user ls --json

# Delete user
axiom user remove bob
axiom user rm -u bob
```

### Flags (`user add`, `user update`)

| Flag | Long | Positional | Description |
| :--- | :--- | :--- | :--- |
| `-u` | `--user`, `--username` | Yes (1st) | Admin username |
| `-e` | `--email` | | Admin email address |
| `-p` | `--password`, `--pass` | | Password (prompts securely if omitted) |
| `-c` | `--config` | | Custom config path |

---

## 5. Authentication (`axiom login`, `axiom logout`)

Authenticate administrative sessions against the gateway daemon.

### Gateway Login (`axiom login`)

```bash
# Interactive password prompt
axiom login -u admin

# Direct password flag
axiom login -u admin -p "Secret123!" -U http://127.0.0.1:4500
```

### Gateway Logout (`axiom logout`)

```bash
# Invalidate administrative session and clear cached credentials
axiom logout
```

---

## 6. Databases (`axiom db`)

Register and configure upstream SQL engines, test connection health, and manage connection pools.
*(Note: Ad-hoc query execution and schema browsing are available directly via the Web UI console and REST API).*

### Connections

```bash
# Register database (positional alias or flags)
axiom db add main_db -c "postgres://postgres:pass@localhost:5432/app"
axiom db add -a analytics -c "clickhouse://default:@localhost:9000/db" -e clickhouse -m 2 -M 20

# Test connection
axiom db test main_db
axiom db test-url -c "postgres://postgres:pass@localhost:5432/test"

# List connections
axiom db list

# Update or rename
axiom db update main_db -c "postgres://newuser:pass@localhost:5432/app" -M 40
axiom db update -a old_db -n new_db

# Remove connection
axiom db remove old_db
```

#### Flags (`db add`, `db update`)

| Flag | Long | Positional | Description |
| :--- | :--- | :--- | :--- |
| `-a` | `--alias` | Yes (1st) | Database identifier |
| `-c` | `--conn`, `--connection-url` | | Connection string URI |
| `-e` | `--engine`, `--dialect` | | Dialect: `postgres`, `mysql`, `sqlite`, `mssql`, `clickhouse`, `snowflake`, `oracle` |
| `-m` | `--min`, `--pool-min` | | Min pool size |
| `-M` | `--max`, `--pool-max` | | Max pool size |
| `-n` | `--new-alias`, `--rename` | | Rename alias (`update` only) |

---

## 7. Blob Storage (`axiom blob`)

Storage namespace configuration, chunk integrity verification, and bitrot scrubbing.
*(Note: Object uploads/downloads and pre-signed capability tickets are handled via the Web UI and REST/MCP APIs).*

### Maintenance & Integrity

```bash
axiom blob stats   # Telemetry and byte usage
axiom blob verify docs report.pdf # Cryptographic BLAKE3 verification
axiom blob scrub   # Full cluster bitrot audit
axiom blob sweep   # Manually trigger expired TTL purge
```

### Namespaces (`axiom blob ns`)

```bash
axiom blob ns list                                           # List namespaces
axiom blob ns create -n assets --max-bytes 50gb --max-objects 50000 # Create namespace
axiom blob ns get assets                                     # View configuration
axiom blob ns usage assets                                   # Live quota headroom
axiom blob ns update assets --max-bytes 100gb                # Adjust quotas
axiom blob ns delete assets                                  # Remove namespace
```

---

## 8. Access Control (`axiom key`, `axiom role`)

### API Keys (`axiom key`)

Machine tokens for HTTP REST and MCP clients. Header: `X-Axiom-Key`.

```bash
# Create key
axiom key create web_client -r read_only
axiom key create -n worker -r ingest_role -l 5000 -e 1767225600

# List, rotate, update, remove
axiom key list
axiom key rotate web_client
axiom key update web_client -r read_write -l 10000
axiom key remove web_client
```

#### Flags (`key create`, `key update`)

| Flag | Long | Positional | Description |
| :--- | :--- | :--- | :--- |
| `-n` | `--name` | Yes (1st) | Key name |
| `-r` | `--role` | | Attached RBAC role |
| `-s` | `--secret` | | Custom secret string (auto-generated if omitted) |
| `-l` | `--limit`, `--rate-limit` | | Requests per minute (0 = unconstrained) |
| `-e` | `--expires`, `--expires-at` | | Expiration UNIX timestamp |

### RBAC Roles (`axiom role`)

Fine-grained database and table permission policies.

```bash
# Create role with wildcard permission
axiom role create read_only \
  -p '[{"database":"*","table_name":"*","operations":["SELECT"]}]' \
  -d "Read-only access"

# Scoped table permissions
axiom role create app_role \
  -p '[{"database":"app","table_name":"users","operations":["SELECT","INSERT","UPDATE"]}]'

# List, update, remove
axiom role list
axiom role update read_only -d "Updated description"
axiom role remove app_role
```

---

## 9. Cluster Mesh (`axiom cluster`)

Multi-node peer-to-peer discovery and synchronized metadata state.

```bash
axiom cluster status                                          # Node identity & health
axiom cluster peers                                           # List registered peers
axiom cluster connect -t http://10.0.0.2:4500 --secret "tok"  # Join remote peer
axiom cluster ping node-1234                                  # Round-trip latency
axiom cluster remove -i node-1234                             # Disconnect peer
```

---

## 10. AI & MCP (`axiom mcp`)

Native [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server exposing governed SQL and blob operations to AI agents.

```bash
# List exposed tools
axiom mcp tools

# Direct tool execution
axiom mcp call -t db_query -a '{"database":"main_db","query":"SELECT 1"}'

# Stdio bridge for Claude Desktop / Cursor
axiom --api-key "YOUR_KEY" mcp serve --stdio
```

### Assistant Config (`claude_desktop_config.json` / `mcp.json`)

```json
{
  "mcpServers": {
    "axiom": {
      "command": "axiom",
      "args": ["--api-key", "YOUR_KEY", "mcp", "serve"]
    }
  }
}
```

---

## 11. Diagnostics & Ops

```bash
# Environment & upstream health check
axiom doctor
axiom doctor -c /etc/axiom/config.toml

# Gateway status ping
axiom health
axiom health -U http://192.168.1.100:4500

# Prometheus metrics
axiom metrics

# Cache telemetry & purge
axiom cache stats
axiom cache flush

# Force metadata snapshot reload
axiom reload
```

---

## 12. Configuration & Shell

### Config Commands (`axiom config`)

```bash
axiom config init            # Write config.toml with defaults
axiom config init -p ./c.toml -f # Custom path, overwrite
axiom config show -c ./c.toml    # Validate and inspect values
axiom config to-env -i ./c.toml  # Export TOML to .env format
```

### Shell Completions (`axiom completions`)

```bash
axiom completions bash > /etc/bash_completion.d/axiom
axiom completions zsh > "${fpath[1]}/_axiom"
axiom completions fish > ~/.config/fish/completions/axiom.fish
axiom completions powershell | Out-String | Invoke-Expression
```
