from typing import Any, Optional

import structlog

from config.provider import GlobalConfigProvider

try:
    import redis.asyncio as redis_module

    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False
    redis_module = None  # type: ignore

logger = structlog.get_logger()


class RedisDLQManager:
    """Manages Dead-Letter Queues (DLQ) for failed webhook events using Redis XPENDING and XCLAIM."""

    def __init__(self):
        self._client: Optional[Any] = None
        self.stream = "axiom_events"
        self.group = "axiom_workers"
        self.dlq_stream = "axiom_events_dlq"
        self.consumer_name = "dlq_reaper"

    async def initialize(self):
        config = GlobalConfigProvider().get_config()
        if not config.eda.enabled or config.eda.backend != "redis" or not HAS_REDIS:
            return
        self._client = redis_module.from_url(  # type: ignore
            config.eda.redis_url, decode_responses=True
        )
        self.group = config.eda.consumer_group

        # Ensure group exists
        try:
            await self._client.xgroup_create(self.stream, self.group, mkstream=True)
        except Exception:
            pass  # Group already exists

    async def reap_dead_letters(self, min_idle_time_ms: int = 3600000):
        """Scans for messages pending longer than the idle time and moves them to DLQ."""
        if not self._client:
            return

        try:
            # Check pending messages
            pending = await self._client.xpending_range(
                self.stream, self.group, "-", "+", 100
            )

            for msg in pending:
                msg_id = msg["message_id"]
                idle_time = msg["time_since_delivered"]
                deliveries = msg["deliveries"]

                if idle_time >= min_idle_time_ms or deliveries >= 5:
                    logger.warning("Event moved to DLQ", event_id=msg_id)

                    # Claim it
                    claimed = await self._client.xclaim(
                        self.stream,
                        self.group,
                        self.consumer_name,
                        min_idle_time_ms,
                        [msg_id],
                    )

                    if claimed:
                        # Copy to DLQ stream
                        payload = claimed[0][1]
                        await self._client.xadd(self.dlq_stream, payload)
                        # Acknowledge from original stream
                        await self._client.xack(self.stream, self.group, msg_id)
        except Exception as e:
            logger.error("DLQ Reaper failed", error=str(e))
