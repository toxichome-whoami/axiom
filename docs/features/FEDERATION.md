<div align="center">
  <h1>Axiom Federation Guide</h1>
  <p><em>Link multiple Axiom instances together into a unified mesh of databases and storage</em></p>
</div>

<hr/>

## 1. Overview

In a federated setup, a **Connector Server** (Client) proxies requests to a **Receiver Server** (Host). The Connector can query databases and storage on the Receiver as if they were local resources.

### Key Features:
- **Unified API**: Access globally distributed data through a single URL.
- **Map-Reduce Data Mesh**: Query a comma-separated list of nodes (`alias_a,alias_b`) to concurrently fetch and join remote JSON data entirely in-memory using `asyncio.gather`.
- **Automatic Prefixing**: Remote resources are auto-prefixed with the node alias (e.g., `us_west_main_db`).
- **Isolated Auth**: Federation uses its own dedicated secrets — completely separate from API keys.
- **Per-Node Scoping**: Each incoming node has its own `mode`, `db_scope`, and `fs_scope`.
- **One-Way by Default**: Server A connecting to Server B does NOT give Server B access to Server A. For two-way access, both servers must configure each other.

---

## 2. Configuration

### On the Receiver Server (Server B)
*The server being connected TO.*

<details open>
<summary><b>View Receiver Configuration</b></summary>

```toml
[features]
federation = true

[federation]
enabled = true
sync_interval = 30            # Seconds between health heartbeats
per_node_timeout = 5.0        # Max seconds to wait per node health check
backoff_max = 300.0           # Max exponential backoff for failed nodes (5 min)
circuit_breaker_threshold = 3 # Consecutive failures before marking node "down"

# Each block = ONE remote node. Create more blocks for more servers.
[federation.incoming.us_east_node]
secret = "gK8xPmW2qR7nY4vB9cT1jL6hF3dA0sE"   # Min 32 chars, unique per node
mode = "readwrite"                              # readonly | readwrite
db_scope = ["*"]                                # ["*"] = all, or ["main_db"]
fs_scope = ["*"]                                # ["*"] = all, or ["uploads"]
description = "US East production node"

# Example: a second node with restricted access
[federation.incoming.eu_analytics]
secret = "Xw9Lp2Kd7Rm4Yn6Bv3Ct1Jh8Gf5As0Eq"
mode = "readonly"
db_scope = ["analytics"]
fs_scope = []
description = "EU analytics readonly mirror"
```
</details>

<br/>

### On the Connector Server (Server A)
*The server that initiates the connection.*

<details open>
<summary><b>View Connector Configuration</b></summary>

```toml
[features]
federation = true

[federation]
enabled = true
sync_interval = 30

[federation.server.node_b]
url = "https://server-b.example.com"
secret = "gK8xPmW2qR7nY4vB9cT1jL6hF3dA0sE"    # Must match Server B's incoming key
node_id = "us_east_node"                         # Your identity on Server B
trust_mode = "verify"                            # verify | trust (skip TLS check)
grpc_port = 50051                                # Remote gRPC port
grpc_enabled = true                              # Prefer gRPC with HTTP proxy fallback

# ─── Federation Alias Mapping ─────────────────────
# Expose a remote database as if it were local.
[database.node_b_main_db]
engine = "mysql"
url = "mysql://user:pass@localhost:3306/main_db"  # Local connection string (unused for federated)
mode = "readwrite"
federated_alias = "node_b_main_db"               # Routes all requests to Server B's "main_db"
```
</details>

> <span style="font-size: 1.2em;"></span> **Important:** The `secret` on Server A must be the **exact same string** as the `secret` on Server B's `[federation.incoming.us_east_node]` block. The `node_id` must match the incoming block name.

---

## 3. Authentication Flow

Federation secrets are **completely separate** from API keys. They use dedicated headers:

1. **Server A** sends a request with:
   - <kbd>X-Federation-Secret</kbd>: Base64-encoded federation secret
   - <kbd>X-Federation-Node</kbd>: The node identity (e.g., `us_east_node`)
2. **Server B** receives the request:
   - Looks up the node in `federation.incoming`
   - Base64-decodes the secret
   - Compares using `hmac.compare_digest()` (constant-time, timing-attack safe)
   - If valid, creates a scoped `AuthContext` with the incoming key's permissions
   - Federation keys can **never** have `full_admin` access
3. **Config stores plain text**, transport uses Base64 — handled automatically.

---

## 4. Resource Mapping

Once synced, remote resources appear with a prefix:

- A database `main_db` on Server B becomes <kbd>node_b_main_db</kbd> on Server A.
- A storage volume `uploads` on Server B becomes <kbd>node_b_uploads</kbd> on Server A.

Requests to prefixed names are automatically proxied to the remote server transparently.

---

## 5. Transport Layers: gRPC & Proxy Fallback

Axiom uses **dual-layer transport negotiation** to maximize performance while ensuring strict compatibility:

<details open>
<summary><b>1. gRPC Protocol (Default for Federation)</b></summary>
<br/>

- All federated queries, storage listings, and health streams occur over gRPC if `grpc_enabled = true`.
- Streaming endpoints utilize long-lived bidirectional channels for minimal latency.
- Protobuf schema structures strictly type SQL query parameters and file system payloads.
</details>

<details open>
<summary><b>2. HTTP Proxy Streaming (Fallback)</b></summary>
<br/>

- If gRPC fails, the connection is refused, or `grpc_enabled = false`, Axiom automatically falls back to raw HTTP streaming proxies.
- Client applications can request raw Protobuf bytes over the HTTP proxy by sending an `Accept: application/x-protobuf` header; otherwise, JSON is returned.
- Proxy streams are perfectly transparent, meaning SSE streams and chunked file downloads pass through unmodified.
</details>

---

## 6. Monitoring

Call `GET /api/v1/fed/servers` (requires `full_admin` API key) to see the state of the mesh:

<details>
<summary><b>View Monitoring Response</b></summary>

```json
{
  "outgoing": [
    { "alias": "node_b", "url": "...", "node_id": "us_east_node", "status": "up", "latency_ms": 45 }
  ],
  "outgoing_count": 1,
  "incoming": [
    { "node_id": "us_east_node", "mode": "readwrite", "db_scope": ["*"], "description": "US East" }
  ],
  "incoming_count": 1
}
```
</details>

- **outgoing**: Servers this node connects TO (with live health status)
- **incoming**: Servers allowed to connect TO this node (with their permissions)
- *Secrets are **never** exposed in responses.*

---

## 7. Resilience

<table style="width: 100%; border-collapse: collapse;">
  <tr style="background-color: #2d2d2d; color: white;">
    <th style="padding: 10px;">Feature</th>
    <th style="padding: 10px;">Mechanism</th>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>Parallel Polling</b></td>
    <td style="padding: 10px;">All remote nodes are health-checked concurrently via <code>asyncio.gather</code> — one slow node never blocks the others.</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>Exponential Backoff</b></td>
    <td style="padding: 10px;">Failed nodes are retried with <code>2^failures</code> seconds delay (capped at 5 min). Healthy nodes are polled at <code>sync_interval</code>.</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>Circuit Breaker</b></td>
    <td style="padding: 10px;">Each federation link is independently tracked. After <code>threshold</code> failures, the node is marked "down" to prevent wasted resources.</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>State Persistence</b></td>
    <td style="padding: 10px;">Node health state is persisted to <code>federation.db</code> (SQLite) to survive server restarts.</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>Shared Channels</b></td>
    <td style="padding: 10px;">All traffic uses persistent HTTP connection pools and shared gRPC stubs.</td>
  </tr>
</table>

---

## 8. Security

- **Isolated Secrets**: Federation secrets cannot be used as API keys, and vice versa.
- **Per-Node Scoping**: Each node has independent `mode`, `db_scope`, and `fs_scope`.
- **Key Compromise**: If one node is compromised, delete its `[federation.incoming.*]` block and restart. Only that node loses access.
- **No Admin Access**: Federation keys always have `full_admin=false` — they cannot access `/api/admin/*` or `/api/federation/servers`.
- **Encryption**: Always use `https` for federation URLs in production, and ensure gRPC is protected behind mutual TLS or secure channels.
