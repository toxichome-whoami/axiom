import asyncio
import os
import time

import orjson
import psutil

from api.core.health import (
    _evaluate_cache_health,
    _evaluate_database_health,
    _evaluate_storage_health,
)
from api.core.metrics import _metrics, _start_time
from config.provider import GlobalConfigProvider

from .connection_manager import sse_mgr


async def health_poller() -> None:
    """
    Background daemon: Evaluates system health periodically and pushes to SSE.
    Reuses existing health check logic safely.
    """
    config = GlobalConfigProvider().get_config()
    interval = config.sse.health_interval

    while True:
        try:
            db_status, db_up = await _evaluate_database_health(config)
            cache_status = await _evaluate_cache_health(config)
            storage_status = _evaluate_storage_health(config)
            proc = psutil.Process(os.getpid())

            all_up = db_up and (cache_status.get("status") == "up")

            payload = orjson.dumps(
                {
                    "status": "healthy" if all_up else "degraded",
                    "checks": {
                        "databases": db_status,
                        "cache": cache_status,
                        "storages": storage_status,
                    },
                    "system": {
                        "memory_mb": round(proc.memory_info().rss / 1048576, 2),
                        "cpu_pct": proc.cpu_percent(interval=None),
                    },
                }
            ).decode()

            await sse_mgr.publish("system:health", "health", payload)
        except Exception:
            pass  # Best effort, never crash the daemon

        await asyncio.sleep(interval)


async def metrics_pusher() -> None:
    """
    Background daemon: Periodically pushes live metrics snapshot.
    """
    config = GlobalConfigProvider().get_config()
    interval = config.sse.metrics_interval

    while True:
        try:
            proc = psutil.Process(os.getpid())
            payload = orjson.dumps(
                {
                    "uptime_seconds": round(time.time() - _start_time, 2),
                    "memory_mb": round(proc.memory_info().rss / 1048576, 2),
                    "cpu_percent": proc.cpu_percent(interval=None),
                    "db_queries_total": _metrics.get("db_queries_total", 0),
                    "sse_connections": sse_mgr.active_count,
                    "sse_topics": sse_mgr.topic_count,
                }
            ).decode()

            await sse_mgr.publish("metrics", "metrics", payload)
        except Exception:
            pass

        await asyncio.sleep(interval)
