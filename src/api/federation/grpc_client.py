import base64
from typing import AsyncIterable

import grpc
import structlog

from config.provider import GlobalConfigProvider
from config.schema import FedServerConfig
from generated.axiom.v1 import db_pb2, federation_pb2, federation_pb2_grpc

logger = structlog.get_logger()


class FederationGRPCClient:
    """Managed gRPC channel per federated node."""

    def __init__(self, srv_config: FedServerConfig):
        self.node_id = srv_config.node_id
        self.target = (
            f"{srv_config.url.split('://')[-1].split(':')[0]}:{srv_config.grpc_port}"
        )

        # In a real production setup, handle TLS certificates correctly.
        if srv_config.trust_mode == "verify":
            self.credentials = grpc.ssl_channel_credentials()
            self.channel = grpc.aio.secure_channel(self.target, self.credentials)
        else:
            self.channel = grpc.aio.insecure_channel(self.target)

        self.stub = federation_pb2_grpc.FederationServiceStub(self.channel)

        secret_bytes = srv_config.secret.encode("utf-8")
        self.secret_b64 = base64.b64encode(secret_bytes).decode("utf-8")

        self.metadata = (
            ("x-federation-node", self.node_id),
            ("x-federation-secret", self.secret_b64),
        )

    async def execute_query(self, db_alias: str, sql: str, params: dict):
        # Convert dictionary params back into simple positional parameters for now
        # Or ideally send them in the options map depending on architecture
        req_params = [str(v) for v in params.values()]

        request = db_pb2.ExecuteQueryRequest(db_alias=db_alias, sql=sql, params=req_params)

        try:
            return await self.stub.ExecuteQuery(
                request, metadata=self.metadata, timeout=30.0
            )
        except grpc.aio.AioRpcError as e:
            logger.error("gRPC ExecuteQuery failed", node=self.node_id, error=str(e))
            raise

    async def health_stream(self) -> AsyncIterable[federation_pb2.HealthCheckResponse]:
        """Subscribe to server-pushed health updates."""
        request = federation_pb2.HealthCheckRequest(node_id=self.node_id)

        try:
            async for update in self.stub.HealthCheck(request, metadata=self.metadata):
                yield update
        except grpc.aio.AioRpcError as e:
            logger.warning(
                "gRPC Health stream disconnected", node=self.node_id, error=str(e)
            )
            raise

    async def close(self):
        await self.channel.close()


_GRPC_CLIENTS: dict[str, FederationGRPCClient] = {}


def get_grpc_client(node_id: str) -> FederationGRPCClient | None:

    config = GlobalConfigProvider().get_config()

    if node_id not in config.federation.server:
        return None

    srv_config = config.federation.server[node_id]
    if not srv_config.grpc_enabled:
        return None

    if node_id not in _GRPC_CLIENTS:
        _GRPC_CLIENTS[node_id] = FederationGRPCClient(srv_config)

    return _GRPC_CLIENTS[node_id]


async def shutdown_grpc_clients():
    for node_id, client in list(_GRPC_CLIENTS.items()):
        await client.close()
    _GRPC_CLIENTS.clear()
