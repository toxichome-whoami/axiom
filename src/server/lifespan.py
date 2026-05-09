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
from webhook.dispatcher import dispatcher_worker

# Silently refresh module-level feature flags in db handlers on each config reload
try:
    import api.database.handlers as _db_handlers

    _db_handlers._refresh_feature_flags()
except Exception:
    pass

logger = structlog.get_logger()


_daemon_tasks: List[asyncio.Task] = []


# ─────────────────────────────────────────────────────────────────────────────
# Lifecycle Helpers
# ─────────────────────────────────────────────────────────────────────────────


async def _init_storage_backends(config):
    """Initializes persistent databases required for startup caching."""
    # Conditionally boot SQLite cache backend if declared in config
    if config.rate_limit.backend == "sqlite" or config.cache.backend == "sqlite":
        from cache.sqlite_backend import SQLiteCache

        await SQLiteCache.init_db()


def _start_background_daemons(config) -> List[asyncio.Task]:
    """Launches non-blocking background workers based on active feature flags."""
    if _daemon_tasks:
        return _daemon_tasks

    tasks = []
    tasks.append(asyncio.create_task(ConfigManager.watch()))
    tasks.append(asyncio.create_task(log_rotator_worker()))

    # Conditional feature workers
    if config.features.webhook and config.webhooks.enabled:
        tasks.append(asyncio.create_task(dispatcher_worker()))

    if config.features.federation and config.federation.enabled:
        tasks.append(asyncio.create_task(sync_federated_servers()))

    _daemon_tasks.extend(tasks)
    return tasks


async def _stop_background_daemons():
    """Gracefully kills all active background coroutines."""
    for task in _daemon_tasks:
        task.cancel()
    _daemon_tasks.clear()


# ─────────────────────────────────────────────────────────────────────────────
# Primary Context
# ─────────────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Controls application bootstrap and teardown sequences dynamically."""
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

    if hasattr(app.state, "mcp_initialized"):
        from api.mcp.server import MCPServerManager

        MCPServerManager.shutdown()

    await DatabasePoolManager.shutdown()

    # 4. Teardown HTTP Clients
    if hasattr(app.state, "http_clients"):
        logger.info("Closing internal HTTP connection pools")
        for client in app.state.http_clients.values():
            await client.aclose()

    logger.info("Axiom stopped", pid=pid)
