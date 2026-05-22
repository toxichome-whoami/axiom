# Federation gRPC Industrial Acceleration Plan

## Current State: JSON-over-HTTP Federation

Axiom's federation runs entirely on JSON-over-HTTP:

```
Node A ── http://nodeB/health (JSON) ──► Node B     # Health polling (sync daemon)
Node A ── PROXY request (JSON passthrough) ──► Node B  # DB/FS query forwarding
```

### Current Architecture Summary

| Component | File | Format | Protocol |
|-----------|------|--------|----------|
| Health poll | `sync.py` | JSON via `httpx.get()` → `resp.json()` | HTTP/1.1 |
| Proxy forward | `proxy.py` | Raw bytes streamed verbatim | HTTP/1.1 |
| State persistence | `state.py` | `model_dump_json()` ↔ SQLite | Disk |
| Auth headers | Both | Base64-encoded secret in custom header | HTTP |
| Circuit breaker | `sync.py` | In-memory dict | N/A |

### Problems With JSON HTTP Federation

| Problem | Impact |
|---------|--------|
| **No binary framing** | Each message is a full JSON parse/serialize cycle on both sides |
| **HTTP/1.1 overhead** | Multiple round-trips, no multiplexing between requests |
| **No streaming** | Proxy streams bytes, but no structured streaming (streams of rows/files) |
| **No service contract** | No `.proto` IDL — manual URL construction, string matching |
| **No load balancing** | gRPC gives server-side and client-side LB for free |
| **No deadlines** | No per-request timeout propagation |
| **Health polling inefficient** | Polling `/health` every N seconds is wasteful vs gRPC streaming health |

---

## Target: gRPC Federation

Replace the JSON HTTP transport between federated nodes with gRPC while keeping the **same API surface** (same data models, same auth model).

```
Node A ── gRPC (HTTP/2, protobuf) ──► Node B
         HealthStream (server-side push)
         ExecuteQuery (unary)
         ListDirectory (unary with stream response for large dirs)
```

### What Already Exists (Reuse!)

| Asset | Location | How gRPC uses it |
|-------|----------|-----------------|
| Proto schemas | `proto/axiom/v1/*.proto` | Already have `QueryRequest`, `QueryResponse`, `ListDirectoryResponse`, `ResponseEnvelope` |
| `buf` config | `buf.work.yaml`, `proto/buf.yaml` | Already configured — just add `service` definitions |
| Proto codegen | `scripts/generate_proto.py` | Already generates Python stubs |
| Proto utils | `src/encoding/proto_utils.py` | `query_result_to_proto()`, `list_dir_to_proto()` already exist |
| Auth model | `FederationIncomingKeyConfig` | Secret per node — maps directly to gRPC interceptor |
| State management | `FederationStateManager` | SQLite state + health tracking — same model for gRPC endpoints |

---

## gRPC Service Definition (Add to Existing Protos)

### New: `proto/axiom/v1/federation.proto`

```protobuf
syntax = "proto3";
package axiom.v1;

import "axiom/v1/common.proto";
import "axiom/v1/db.proto";
import "axiom/v1/fs.proto";

service FederationService {
  // Database operations
  rpc ExecuteQuery(QueryRequest) returns (QueryResponse);
  rpc ListDatabases(ListDatabasesRequest) returns (ListDatabasesResponse);
  rpc ListTables(ListTablesRequest) returns (TablesListResponse);

  // Storage operations
  rpc ListDirectory(ListDirectoryRequest) returns (stream DirectoryEntry);
  rpc DownloadFile(DownloadFileRequest) returns (stream FileChunk);
  rpc UploadFile(stream UploadChunk) returns (FsWriteResult);

  // Health & discovery
  rpc HealthCheck(HealthCheckRequest) returns (stream HealthUpdate);
  rpc GetNodeInfo(NodeInfoRequest) returns (NodeInfoResponse);
}

message HealthCheckRequest {
  string node_id = 1;
}

message HealthUpdate {
  NodeStatus status = 1;
  float latency_ms = 2;
  map<string, string> databases = 3;
  map<string, string> storages = 4;
}

enum NodeStatus {
  UNKNOWN = 0;
  UP = 1;
  DEGRADED = 2;
  DOWN = 3;
}

message ListDatabasesRequest {}
message ListDatabasesResponse {
  repeated DatabaseInfo databases = 1;
}
message DatabaseInfo {
  string name = 1;
  string engine = 2;
  string mode = 3;
  int32 tables_count = 4;
}

message ListTablesRequest {
  string db_alias = 1;
  int32 limit = 2;
  int32 offset = 3;
}

message DownloadFileRequest {
  string storage_alias = 1;
  string path = 2;
}

message FileChunk {
  bytes data = 1;
}

message UploadChunk {
  string storage_alias = 1;
  string filename = 2;
  bytes data = 3;
  bool is_last = 4;
}

message HealthCheckRequest {
  string node_id = 1;
}

message NodeInfoRequest {}
message NodeInfoResponse {
  string node_id = 1;
  string version = 2;
  repeated string databases = 3;
  repeated string storages = 4;
}
```

---

## Implementation Plan

### Phase 1: gRPC Server (incoming connections)

**File:** `src/api/federation/grpc_server.py` (new)

```python
import grpc
from axiom.v1 import federation_pb2, federation_pb2_grpc

class FederationServicer(federation_pb2_grpc.FederationServiceServicer):
    """gRPC implementation wrapping existing handler logic."""
    
    async def ExecuteQuery(self, request: db_pb2.QueryRequest, context):
        # Authenticate via gRPC metadata
        node_id = dict(context.invocation_metadata()).get("x-federation-node")
        # ... validate against config.federation.incoming ...
        engine, db_cfg = await get_db_engine(request.db_alias, auth)
        result = await engine.execute(request.sql, ...)
        return query_result_to_proto(result)

    async def ListDirectory(self, request, context):
        # Stream directory entries (server streaming)
        entries = await scandir(request.path)
        for entry in entries:
            yield entry_to_proto(entry)

    async def HealthCheck(self, request, context):
        # Server-side streaming — push updates instead of polling
        while context.is_active():
            yield build_health_update()
            await asyncio.sleep(10)

    async def DownloadFile(self, request, context):
        # Chunked file streaming
        async with aiofiles.open(target_path, "rb") as f:
            while chunk := await f.read(65536):
                yield FileChunk(data=chunk)
```

Lifespan integration — add to `src/server/lifespan.py`:
```python
if config.features.federation and config.federation.enabled and config.federation.grpc_enabled:
    grpc_server = grpc.aio.server()
    federation_pb2_grpc.add_FederationServiceServicer_to_server(
        FederationServicer(), grpc_server
    )
    grpc_server.add_insecure_port(f"[::]:{config.federation.grpc_port}")
    _daemon_tasks.append(asyncio.create_task(grpc_server.start()))
```

### Phase 2: gRPC Client (outgoing connections)

**File:** `src/api/federation/grpc_client.py` (new)

```python
class FederationGRPCClient:
    """Managed gRPC channel per federated node with reconnection."""
    
    def __init__(self, srv_config: FedServerConfig):
        self.target = f"{srv_config.url}:{srv_config.grpc_port}"
        self.credentials = grpc.ssl_channel_credentials() if srv_config.trust_mode == "verify" else grpc.local_channel_credentials()
        self.channel = grpc.aio.secure_channel(self.target, self.credentials)
        self.stub = federation_pb2_grpc.FederationServiceStub(self.channel)
    
    async def execute_query(self, db_alias, sql, params):
        metadata = [("x-federation-node", self.node_id), ("x-federation-secret", self.secret_b64)]
        return await self.stub.ExecuteQuery(
            QueryRequest(db_alias=db_alias, sql=sql, params=params),
            metadata=metadata,
            timeout=30,
        )
    
    async def health_stream(self):
        """Replaces sync.py polling loop — subscribe to pushed updates."""
        async for update in self.stub.HealthCheck(...):
            yield update
    
    async def close(self):
        await self.channel.close()
```

### Phase 3: Convert the Proxy

**File:** `src/api/federation/proxy.py`

Current proxy does `httpx` passthrough. gRPC path replaces the `_stream_proxy_execution` for recognized operations:

```python
async def proxy_request(alias, path, request, is_database=True):
    # Try gRPC first
    if config.federation.grpc_enabled:
        client = get_grpc_client(srv_alias)
        if is_database:
            result = await client.execute_query(...)
            return Response(result.SerializeToString(), media_type="application/x-protobuf")
        # ... storage operations ...
    
    # Fallback to HTTP proxy for backward compat
    return await _stream_proxy_execution(...)
```

### Phase 4: Convert the Sync Daemon

**File:** `src/api/federation/sync.py`

Replace the polling loop with gRPC health streaming:

```python
async def sync_federated_servers():
    # For each node, open a streaming HealthCheck subscription
    # Instead of polling in a loop, process pushed updates as they arrive
    for node_id in config.federation.server:
        asyncio.create_task(_subscribe_node_health(node_id))

async def _subscribe_node_health(node_id):
    client = get_grpc_client(node_id)
    async for update in client.stub.HealthCheck(...):
        state_mgr.set_state(node_id, FederationNodeState(
            status=update.status.name.lower(),
            latency_ms=update.latency_ms,
            databases=dict(update.databases),
            storages=dict(update.storages),
            last_check=time.time(),
        ))
```

### Phase 5: Config Schema

**File:** `src/config/schema.py`

```python
class FedServerConfig(BaseModel):
    url: str
    secret: str
    node_id: str
    trust_mode: Literal["verify", "trust"] = "verify"
    grpc_port: int = 50051
    grpc_enabled: bool = True

class FederationConfig(BaseModel):
    # ... existing fields ...
    grpc_port: int = 50051       # Port gRPC server listens on
    grpc_max_message_mb: int = 100  # Max gRPC message size
    grpc_keepalive_seconds: int = 30
```

---

## Performance Comparison

| Metric | HTTP/1.1 JSON (current) | gRPC (target) | Improvement |
|--------|------------------------|---------------|-------------|
| Wire size (1000 rows) | ~500 KB JSON | ~150 KB protobuf | **3.3× smaller** |
| Serialization CPU | `orjson.dumps()` | `SerializeToString()` | **2-5× faster** |
| Connection overhead | 1 TCP per request | 1 TCP multiplexed | **N× fewer connections** |
| Health sync | N HTTP GETs per interval | 1 persistent stream per node | **Server push** |
| File download | HTTP stream | gRPC stream (binary framed) | **~10% less overhead** |
| Load balancing | Manual DNS/round-robin | gRPC client-side LB | **Free** |
| Timeout propagation | Not supported | Context deadline per call | **Free** |
| Error handling | HTTP status codes | gRPC status codes (richer) | **Free** |
| Backward compat | - | Optional — falls back to HTTP | **Zero breaking** |

---

## Rollout Strategy

| Phase | Description | Risk |
|-------|-------------|------|
| 1 | Add gRPC server + client, gated by `grpc_enabled = true` | Low — runs alongside HTTP |
| 2 | Convert health sync to gRPC streaming | Low — faster, no polling |
| 3 | Convert proxy to gRPC for DB/FS operations | Medium — test with both on |
| 4 | Make gRPC default, HTTP as fallback | Low — reverse the feature flag |

---

## File Change Summary

| Action | File | Scope |
|--------|------|-------|
| **CREATE** | `proto/axiom/v1/federation.proto` | gRPC service + message definitions |
| **CREATE** | `src/api/federation/grpc_server.py` | gRPC server (FederationServicer) |
| **CREATE** | `src/api/federation/grpc_client.py` | gRPC client pool + stub manager |
| **MODIFY** | `proto/buf.yaml` | Add federation.proto to build |
| **MODIFY** | `scripts/generate_proto.py` | Add gRPC codegen step |
| **MODIFY** | `src/api/federation/proxy.py` | gRPC path with HTTP fallback |
| **MODIFY** | `src/api/federation/sync.py` | Streaming health replaces polling |
| **MODIFY** | `src/config/schema.py` | gRPC config fields |
| **MODIFY** | `src/server/lifespan.py` | Start/stop gRPC server |
| **MODIFY** | `requirements.txt` | `grpcio>=1.60`, `grpcio-tools` (already there) |

---

## Backward Compatibility

- gRPC is **opt-in per node** via `grpc_enabled = true` on `FedServerConfig`
- Nodes without gRPC continue using existing HTTP JSON proxy — zero changes needed
- Health sync falls back to HTTP polling for non-gRPC nodes
- Mixed federation: some nodes gRPC, some HTTP — both work simultaneously
