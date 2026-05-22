import asyncio
import base64
import mimetypes
import os
from datetime import datetime

import grpc
import structlog

from api.database.handlers import get_db_engine
from api.database.query_parser import validate_query
from api.storage.handlers import _get_storage_path
from config.provider import GlobalConfigProvider
from db.dialect.transpiler import transpile_sql
from generated.axiom.v1 import db_pb2, federation_pb2, federation_pb2_grpc, fs_pb2
from server.middleware.auth import AuthContext

logger = structlog.get_logger()


async def _authenticate(context: grpc.aio.ServicerContext) -> AuthContext:
    metadata_raw = context.invocation_metadata()
    metadata: dict[str, str] = dict(metadata_raw) if metadata_raw else {}  # type: ignore
    node_id = metadata.get("x-federation-node")
    secret_b64 = metadata.get("x-federation-secret")

    if not node_id or not secret_b64:
        await context.abort(  # type: ignore
            grpc.StatusCode.UNAUTHENTICATED, "Missing authentication metadata"
        )

    try:
        secret = base64.b64decode(secret_b64).decode("utf-8")
    except Exception:
        await context.abort(grpc.StatusCode.UNAUTHENTICATED, "Invalid secret encoding")  # type: ignore

    config = GlobalConfigProvider().get_config()
    incoming = config.federation.incoming.get(node_id)

    if not incoming or incoming.secret != secret:
        await context.abort(grpc.StatusCode.UNAUTHENTICATED, "Invalid credentials")  # type: ignore

    return AuthContext(
        api_key_name=f"federation:{node_id}",
        mode=incoming.mode,
        db_scope=incoming.db_scope,
        fs_scope=incoming.fs_scope,
        rate_limit_override=0,
        full_admin=False,
    )


class FederationServicer(federation_pb2_grpc.FederationServiceServicer):
    """gRPC implementation for handling federation requests."""

    async def ExecuteQuery(
        self, request: db_pb2.ExecuteQueryRequest, context: grpc.aio.ServicerContext
    ):
        auth = await _authenticate(context)
        try:
            engine, db_cfg = await get_db_engine(request.db_alias, auth)

            # Simple dict params mapping from protobuf
            params = (
                {str(i): v for i, v in enumerate(request.params)}
                if request.params
                else {}
            )

            safe_sql, operations, target_table = validate_query(
                request.sql, db_cfg, auth.mode.value
            )
            transpiled_sql = transpile_sql(safe_sql, to_dialect=engine.dialect)

            result = await engine.execute(
                transpiled_sql, params, return_format="protobuf"
            )
            return result.proto_msg
        except Exception as e:
            logger.error("gRPC ExecuteQuery error", error=str(e))
            await context.abort(grpc.StatusCode.INTERNAL, str(e))  # type: ignore

    async def ListDirectory(
        self, request: fs_pb2.ListDirectoryRequest, context: grpc.aio.ServicerContext
    ):
        auth = await _authenticate(context)
        try:
            # We must import from storage handler or re-implement

            target_path = _get_storage_path(request.storage_alias, request.path, auth)

            def _scan():
                try:
                    entries = list(os.scandir(target_path))
                    entries.sort(key=lambda e: e.name)

                    limit = request.limit if request.limit > 0 else 500
                    offset = request.offset if request.offset >= 0 else 0
                    page = entries[offset : offset + limit]

                    pb = fs_pb2.ListDirectoryResponse()
                    pb.total = len(entries)
                    for e in page:
                        pb_e = pb.entries.add()
                        pb_e.name = e.name
                        pb_e.is_dir = e.is_dir(follow_symlinks=False)
                        try:
                            stat = e.stat(follow_symlinks=False)
                            pb_e.size = stat.st_size if not pb_e.is_dir else 0
                            pb_e.modified = datetime.fromtimestamp(
                                stat.st_mtime
                            ).isoformat()
                            if not pb_e.is_dir:
                                mime, _ = mimetypes.guess_type(e.path)
                                pb_e.mime_type = mime or "application/octet-stream"
                        except OSError:
                            pass
                    return pb
                except Exception as ex:
                    raise Exception(f"Scan failed: {str(ex)}")

            pb_response = await asyncio.to_thread(_scan)
            # Since the protocol returns `stream DirectoryEntry`, we should yield entries.
            # But wait, looking at `ListDirectoryResponse` in `fs.proto`, we can just return it.
            # Oh, the proto says `returns (stream DirectoryEntry)`.
            # Actually, `ListDirectoryResponse` is what the REST handler returns.
            # In federation.proto, I mapped it to `returns (stream DirectoryEntry);`
            # Let's check `federation.proto` again. Yes, `rpc ListDirectory(ListDirectoryRequest) returns (stream DirectoryEntry);`

            for entry in pb_response.entries:
                yield entry

        except Exception as e:
            logger.error("gRPC ListDirectory error", error=str(e))
            await context.abort(grpc.StatusCode.INTERNAL, str(e))  # type: ignore

    async def HealthCheck(
        self,
        request: federation_pb2.HealthCheckRequest,
        context: grpc.aio.ServicerContext,
    ):
        # Authenticate first
        await _authenticate(context)

        while context.is_active():  # type: ignore
            # Build health update based on current node state
            config = GlobalConfigProvider().get_config()
            db_map = {db_name: "up" for db_name in config.database.keys()}
            fs_map = {fs_name: "up" for fs_name in config.storage.keys()}

            update = federation_pb2.HealthCheckResponse(
                status=federation_pb2.NodeStatus.NODE_STATUS_UP,
                latency_ms=0.0,
                databases=db_map,
                storages=fs_map,
            )
            yield update
            await asyncio.sleep(config.federation.sync_interval)
