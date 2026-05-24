import asyncio
import time
from typing import Any, Dict, Optional

import orjson

from config.provider import GlobalConfigProvider

from .connection_manager import conn_mgr

try:
    import redis.asyncio as redis_module

    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False
    redis_module = None  # type: ignore


class EventBus:
    """
    Bridges internal emit_event() calls to WebSocket subscribers and Redis Streams (EDA).
    Called as fire-and-forget from webhook/emitter.py — adds zero latency
    to the primary REST request path.
    """

    def __init__(self):
        self._redis_client: Optional[Any] = None
        self._config_loaded = False
        self._eda_enabled = False
        self._eda_backend = "memory"
        self._eda_max_len = 100000

    async def _ensure_redis(self):
        if not self._config_loaded:
            config = GlobalConfigProvider().get_config()
            self._eda_enabled = config.eda.enabled
            self._eda_backend = config.eda.backend
            self._eda_max_len = config.eda.max_stream_length

            if self._eda_enabled and self._eda_backend == "redis" and HAS_REDIS:
                if not config.eda.redis_url:
                    raise ValueError("Redis URL not configured for EDA")
                self._redis_client = redis_module.from_url(  # type: ignore
                    config.eda.redis_url, decode_responses=True
                )
            self._config_loaded = True

    async def publish(
        self,
        module: str,
        resource: str,
        target: str,
        action: str,
        details: Dict[str, Any],
        request_id: str = "",
    ) -> None:
        """Publishes a mutation event to Redis Streams (if enabled) and local WebSockets."""
        from api.events.schemas import EventPayload

        event = EventPayload(
            action=action,
            module=module,
            resource=resource,
            target=target,
            details=details,
            request_id=request_id,
        )

        await self._ensure_redis()

        # Publish to Redis Streams if EDA is backed by Redis
        if self._eda_enabled and self._eda_backend == "redis" and self._redis_client:
            try:
                await self._redis_client.xadd(
                    "axiom_events",
                    {"payload": event.model_dump_json()},
                    maxlen=self._eda_max_len,
                )
            except Exception as e:
                import structlog

                structlog.get_logger().error("Redis XADD failed", error=str(e))

        # Build matching topics from most-specific to wildcard for WebSockets
        specific_topic = f"{module}:{resource}:{target}"
        wildcard_topic = f"{module}:{resource}:*"

        payload = orjson.dumps(
            {
                "type": "event",
                "topic": specific_topic,
                "data": event.model_dump(),
            }
        )

        # Broadcast to both specific and wildcard topic subscribers without duplicating
        subscribers = set(conn_mgr.get_subscribers(specific_topic))
        subscribers.update(conn_mgr.get_subscribers(wildcard_topic))

        tasks = [conn_mgr.send(cid, payload) for cid in subscribers]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def publish_metrics(self) -> None:
        """Push live server metrics to all `metrics` topic subscribers."""
        try:
            import os

            import psutil

            from api.core.metrics import _metrics as m
            from api.core.metrics import _start_time

            proc = psutil.Process(os.getpid())
            payload = orjson.dumps(
                {
                    "type": "event",
                    "topic": "metrics",
                    "data": {
                        "uptime_seconds": round(time.time() - _start_time, 2),
                        "memory_mb": round(proc.memory_info().rss / 1024 / 1024, 2),
                        "cpu_percent": proc.cpu_percent(interval=None),
                        "db_queries_total": m.get("db_queries_total", 0),
                        "ws_connections": conn_mgr.active_count,
                        "ws_topics": conn_mgr.topic_count,
                    },
                }
            )
            await conn_mgr.broadcast("metrics", payload)
        except Exception:
            pass  # Metrics push is best-effort; never block or raise


# Module-level singleton
event_bus = EventBus()
