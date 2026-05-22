import asyncio
import time
from typing import Any, Dict

import orjson

from .connection_manager import conn_mgr


class EventBus:
    """
    Bridges internal emit_event() calls to WebSocket subscribers.
    Called as fire-and-forget from webhook/emitter.py — adds zero latency
    to the primary REST request path.
    """

    async def publish(
        self,
        module: str,
        resource: str,
        target: str,
        action: str,
        details: Dict[str, Any],
        request_id: str = "",
    ) -> None:
        """Publishes a mutation event to all subscribed WebSocket clients."""
        # Build matching topics from most-specific to wildcard
        specific_topic = f"{module}:{resource}:{target}"
        wildcard_topic = f"{module}:{resource}:*"

        payload = orjson.dumps(
            {
                "type": "event",
                "topic": specific_topic,
                "data": {
                    "action": action,
                    "module": module,
                    "resource": resource,
                    "target": target,
                    "details": details,
                },
            }
        )

        # Broadcast to both specific and wildcard topic subscribers
        await asyncio.gather(
            conn_mgr.broadcast(specific_topic, payload),
            conn_mgr.broadcast(wildcard_topic, payload),
            return_exceptions=True,
        )

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
