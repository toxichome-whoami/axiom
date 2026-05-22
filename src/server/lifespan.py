import asyncio
import os
from contextlib import asynccontextmanager
from typing import List

import structlog
from fastapi import FastAPI

from api.federation.sync import sync_federated_servers
from config.loader import ConfigManager
from config.provider import GlobalConfigProvider
from db.pool import DatabasePoolManager
from logger.rotator import log_rotator_worker

# Silently refresh module-level feature flags in db handlers on each config reload
try:
    import api.database.handlers as _db_handlers

    _db_handlers._refresh_feature_flags()
except Exception:
    pass

logger = structlog.get_logger()


_daemon_tasks: List[asyncio.Task] = []
_grpc_server = None


# ─────────────────────────────────────────────────────────────────────────────
# Lifecycle Helpers
# ─────────────────────────────────────────────────────────────────────────────


async def _init_storage_backends(config):
    """Initializes persistent databases required for startup caching."""
    # Conditionally boot SQLite cache backend if declared in config
    if config.rate_limit.backend == "sqlite" or config.cache.backend == "sqlite":
        from cache.sqlite_backend import SQLiteCache

        await SQLiteCache.init_db()

    if (
        config.features.webhook
        and config.webhooks.enabled
        and config.webhooks.persistence_enabled
    ):
        from webhook.persistence import init_persistence

        init_persistence(config.webhooks.persistence_path)


def _start_background_daemons(config) -> List[asyncio.Task]:
    """Launches non-blocking background workers based on active feature flags."""
    if _daemon_tasks:
        return _daemon_tasks

    tasks = []
    tasks.append(asyncio.create_task(ConfigManager.watch()))
    tasks.append(asyncio.create_task(log_rotator_worker()))

    # Conditional feature workers
    if config.features.webhook and config.webhooks.enabled:
        from webhook.dispatcher import ensure_workers, load_pending_webhooks

        load_pending_webhooks()
        ensure_workers()

    if config.features.federation and config.federation.enabled:
        try:
            import grpc
            from generated.axiom.v1 import federation_pb2_grpc
            from api.federation.grpc_server import FederationServicer
            
            global _grpc_server
            _grpc_server = grpc.aio.server()
            federation_pb2_grpc.add_FederationServiceServicer_to_server(
                FederationServicer(), _grpc_server
            )
            _grpc_server.add_insecure_port(f"[::]:{config.federation.grpc_port}")
            tasks.append(asyncio.create_task(_grpc_server.start()))
        except Exception as e:
            logger.warning("gRPC server failed to start", error=str(e))
            
        tasks.append(asyncio.create_task(sync_federated_servers()))

    _daemon_tasks.extend(tasks)
    return tasks


async def _stop_background_daemons():
    """Gracefully kills all active background coroutines."""
    for task in _daemon_tasks:
        task.cancel()
    _daemon_tasks.clear()

    global _grpc_server
    if _grpc_server is not None:
        await _grpc_server.stop(None)
        _grpc_server = None

    # Also shut down dynamic webhook tasks
    config = GlobalConfigProvider().get_config()
    if config.features.webhook and config.webhooks.enabled:
        from webhook.dispatcher import webhook_shutdown

        try:
            await webhook_shutdown()
        except Exception as e:
            logger.error("Failed to shutdown webhooks cleanly", error=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# Primary Context
# ─────────────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Controls application bootstrap and teardown sequences dynamically."""
    from logger.setup import setup_logging

    setup_logging()

    config = GlobalConfigProvider().get_config()
    pid = os.getpid()

    # 1. Boot Subsystems
    await _init_storage_backends(config)

    # 2. Launch Daemons
    logger.info("Starting Axiom", pid=pid)
    _start_background_daemons(config)

    # Yield control to the ASGI server
    yield

    # 3. Teardown Subsystems
    await _stop_background_daemons()

    if (
        config.features.webhook
        and config.webhooks.enabled
        and config.webhooks.persistence_enabled
    ):
        from webhook.persistence import close_persistence

        close_persistence()

    if hasattr(app.state, "mcp_initialized"):
        from api.mcp.server import MCPServerManager

        MCPServerManager.shutdown()

    await DatabasePoolManager.shutdown()

    # 4. Teardown HTTP Clients
    if hasattr(app.state, "http_clients"):
        logger.info("Closing internal HTTP connection pools")
        for client in app.state.http_clients.values():
            await client.aclose()
            
    try:
        from api.federation.grpc_client import shutdown_grpc_clients
        await shutdown_grpc_clients()
    except Exception:
        pass

    logger.info("Axiom stopped", pid=pid)
