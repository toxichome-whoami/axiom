import asyncio
import os
from contextlib import asynccontextmanager
from typing import List

import grpc
import structlog
from fastapi import FastAPI

import api.database.handlers as _db_handlers
from api.federation.grpc_client import shutdown_grpc_clients
from api.federation.grpc_server import FederationServicer
from api.federation.sync import sync_federated_servers
from api.mcp.server import MCPServerManager
from cache.sqlite_backend import SQLiteCache
from config.loader import ConfigManager
from config.provider import GlobalConfigProvider
from db.pool import DatabasePoolManager
from generated.axiom.v1 import federation_pb2_grpc
from logger.rotator import log_rotator_worker
from logger.setup import setup_logging
from webhook.dispatcher import ensure_workers, load_pending_webhooks, webhook_shutdown
from webhook.persistence import close_persistence, init_persistence

# Silently refresh module-level feature flags in db handlers on each config reload
try:
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
        await SQLiteCache.init_db()

    if (
        config.features.webhook
        and config.webhooks.enabled
        and config.webhooks.persistence_enabled
    ):
        init_persistence(config.webhooks.persistence_path)

    if config.features.auth:
        from api.auth.token_engine import token_engine

        # Validate all auth project configs before accepting traffic
        _validate_auth_config(config)

        # Ensure Ed25519 keys are ready
        await asyncio.to_thread(token_engine.init_keys)


def _validate_auth_config(config) -> None:
    """Refuse to start if auth config is incomplete or inconsistent."""
    for key_name, key_cfg in config.api_key.items():
        if not hasattr(key_cfg, "feature_scope"):
            continue
        if "auth" not in (key_cfg.feature_scope or []):
            continue
        # Key has auth in feature_scope — must have a matching project block
        if key_name not in config.auth.project:
            raise RuntimeError(
                f"[auth] API key '{key_name}' has 'auth' in feature_scope "
                f"but no [auth.project.{key_name}] block is defined in config.toml. "
                f"Add the project block or remove 'auth' from feature_scope."
            )
        project = config.auth.project[key_name]
        # If email_verification is on, SMTP must be configured
        if project.email_verification:
            email_cfg = project.email
            if not email_cfg.smtp_host or email_cfg.smtp_host in ("", "127.0.0.1"):
                logger.warning(
                    "auth: email_verification=true but smtp_host is localhost — "
                    "emails will only work if a local SMTP server is running",
                    project=key_name,
                )
            if (
                not email_cfg.from_address
                or email_cfg.from_address == "noreply@axiom.local"
            ):
                logger.warning(
                    "auth: email_verification=true but from_address is still the default — "
                    "set [auth.project.*.email] from_address in config.toml",
                    project=key_name,
                )


def _start_background_daemons(config) -> List[asyncio.Task]:
    """Launches non-blocking background workers based on active feature flags."""
    if _daemon_tasks:
        return _daemon_tasks

    tasks = []
    tasks.append(asyncio.create_task(ConfigManager.watch()))
    tasks.append(asyncio.create_task(log_rotator_worker(config.logging)))

    # Conditional feature workers
    if config.features.webhook and config.webhooks.enabled:
        load_pending_webhooks()
        ensure_workers()

    if config.features.federation and config.federation.enabled:
        try:
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

    if config.features.sse:
        from api.sse.daemons import health_poller, metrics_pusher

        tasks.append(asyncio.create_task(health_poller()))
        tasks.append(asyncio.create_task(metrics_pusher()))

    if config.features.auth:
        from api.auth.anon_cleanup import cleanup_expired_anonymous_users

        tasks.append(asyncio.create_task(cleanup_expired_anonymous_users()))

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

    config = GlobalConfigProvider().get_config()
    setup_logging(config.logging)
    pid = os.getpid()

    # 1. Boot Subsystems
    await _init_storage_backends(config)

    # 2. Launch Daemons
    logger.info("Starting Axiom", pid=pid)

    if config.features.database:
        logger.debug("Database active", endpoint="/api/v1/db")
    if config.features.storage:
        logger.debug("Storage active", endpoint="/api/v1/fs")
    if config.features.webhook:
        logger.debug("Webhooks active", endpoint="/api/v1/webhooks")
    if config.features.metrics:
        logger.debug("Metrics active", endpoint="/metrics")
    if config.features.playground:
        logger.debug("Playground active", endpoint="/api/docs")
    if config.features.mcp:
        logger.debug("MCP Transport active", endpoint="/api/v1/mcp/messages")
    if config.features.graphql:
        logger.debug("GraphQL gateway active", endpoint="/api/v1/graphql")
    if config.features.websocket:
        logger.debug("WebSocket gateway active", endpoint="/api/v1/ws")
    if config.features.sse:
        logger.debug("SSE gateway active", endpoint="/api/v1/sse")
    if config.features.auth:
        logger.debug("Auth gateway active", endpoint="/api/v1/auth")
    if config.features.federation:
        logger.debug(
            "Federation node active",
            endpoint=f"/api/v1/fed (gRPC: {config.federation.grpc_port})",
        )

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
        close_persistence()

    if hasattr(app.state, "mcp_initialized"):
        MCPServerManager.shutdown()

    await DatabasePoolManager.shutdown()

    # 4. Teardown HTTP Clients
    if hasattr(app.state, "http_clients"):
        logger.info("Closing internal HTTP connection pools")
        for client in app.state.http_clients.values():
            await client.aclose()

    try:
        await shutdown_grpc_clients()
    except Exception:
        pass

    logger.info("Axiom stopped", pid=pid)
