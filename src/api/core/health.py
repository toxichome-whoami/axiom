import os
import time

import psutil
from fastapi import APIRouter, Depends, Request

from api.responses import _SERVER_VERSION as __version__
from api.responses import success_response
from cache.memory import MemoryCache
from cache.redis_backend import RedisCache
from cache.sqlite_backend import SQLiteCache
from config.provider import GlobalConfigProvider
from db.pool import DatabasePoolManager
from server.middleware.auth import AuthContext, get_auth_context
from utils.size_parser import parse_size

router = APIRouter(tags=["Core System"])
uptime_start = time.time()

# Prime the process handle once at import time so the first cpu_percent()
# call has a baseline interval and never returns a spurious 0.0.
_proc = psutil.Process(os.getpid())
_proc.cpu_percent()  # Discard — establishes the t0 measurement point

# ─────────────────────────────────────────────────────────────────────────────
# System Subroutines
# ─────────────────────────────────────────────────────────────────────────────


async def _evaluate_database_health(config) -> tuple[dict, bool]:
    """Generates execution masks validating absolute pool availability maps."""
    db_status = {}
    all_dbs_up = True

    for alias in config.database:
        engine = await DatabasePoolManager.get_engine(alias)
        is_up = await engine.health_check() if engine else False
        db_status[alias] = "up" if is_up else "down"
        if not is_up:
            all_dbs_up = False

    return db_status, all_dbs_up


async def _evaluate_cache_health(config) -> dict:
    """Verifies Redis TCP pings explicitly avoiding network suspension errors."""
    cache_status = {"enabled": config.cache.enabled}
    if not config.cache.enabled:
        return cache_status

    cache_status["backend"] = config.cache.backend
    if config.cache.backend == "redis":
        try:
            client = await RedisCache.get_client()
            await client.ping()
            cache_status["status"] = "up"
        except Exception:
            cache_status["status"] = "down"
    elif config.cache.backend == "sqlite":
        cache_status.update(await SQLiteCache.stats())
    else:
        cache_status.update(MemoryCache.stats())

    return cache_status


def _scan_used_bytes(path: str) -> int:
    """Fast recursive directory size scan."""
    total = 0
    stack = [path]
    while stack:
        try:
            with os.scandir(stack.pop()) as it:
                for entry in it:
                    try:
                        if entry.is_file(follow_symlinks=False):
                            total += entry.stat(follow_symlinks=False).st_size
                        elif entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                    except OSError:
                        pass
        except OSError:
            pass
    return total


def _evaluate_storage_health(config) -> dict:
    """Validates storage volumes against configured limits — not raw disk space."""
    storage_status = {}
    for alias, storage_cfg in config.storage.items():
        if os.path.exists(storage_cfg.path):
            try:
                limit_bytes = parse_size(storage_cfg.limit) if storage_cfg.limit else 0
                used_bytes = _scan_used_bytes(storage_cfg.path)
                free_bytes = max(0, limit_bytes - used_bytes) if limit_bytes > 0 else 0
            except OSError:
                free_bytes = 0
            storage_status[alias] = {"status": "up", "free_space_bytes": free_bytes}
        else:
            storage_status[alias] = {"status": "down"}

    return storage_status


async def _evaluate_federation_health(config) -> dict:
    """Extracts node statuses from the persistent federation state manager."""
    if not config.features.federation:
        return {}

    try:
        from api.federation.state import FederationStateManager

        state_mgr = FederationStateManager()
        await state_mgr.load()

        fed_status = {}
        for alias in config.federation.server:
            state = await state_mgr.get_state(alias)
            if state:
                fed_status[alias] = {
                    "status": state.status,
                    "latency_ms": state.latency_ms,
                    "last_seen": state.last_check,
                }
            else:
                fed_status[alias] = {"status": "unknown"}
        return fed_status
    except Exception:
        return {}


# ─────────────────────────────────────────────────────────────────────────────
# Exposed Routes
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/")
async def root(request: Request):
    """Base application heartbeat."""
    config = GlobalConfigProvider().get_config()
    return success_response(
        request,
        {
            "status": "online",
            "name": "Axiom",
            "version": __version__,
            "uptime_seconds": int(time.time() - uptime_start),
            "features": config.features.model_dump(),
        },
    )


@router.get("/ready")
async def ready(request: Request):
    """External container load balancer latch testing probe."""
    return {"ready": True}


@router.get("/health")
async def health(
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
):
    """Detailed synchronous orchestration of all underlying infrastructure states."""
    config = GlobalConfigProvider().get_config()

    db_status, all_dbs_up = await _evaluate_database_health(config)
    cache_status = await _evaluate_cache_health(config)
    storage_status = _evaluate_storage_health(config)
    federation_status = await _evaluate_federation_health(config)

    system_stats = {
        "memory_used_mb": int(_proc.memory_info().rss / 1024 / 1024),
        "cpu_percent": _proc.cpu_percent(),
        "uptime_seconds": int(time.time() - uptime_start),
    }

    return success_response(
        request,
        {
            "status": "healthy" if all_dbs_up else "degraded",
            "checks": {
                "server": {"status": "up"},
                "databases": db_status,
                "storages": storage_status,
                "cache": cache_status,
                "federation": federation_status,
            },
            "system": system_stats,
        },
    )
