import asyncio
from typing import Dict, Set

import orjson
import structlog

logger = structlog.get_logger("sse.connection_manager")


class SSEConnectionManager:
    """
    O(1) routing engine for Server-Sent Events.
    Maintains memory-bounded queues for clients to prevent OOM on slow consumers.
    """

    __slots__ = (
        "_queues",
        "_topic_subscribers",
        "_client_topics",
        "_queue_size",
    )

    def __init__(self, queue_size: int = 100):
        self._queue_size = queue_size
        self._queues: Dict[str, asyncio.Queue] = {}  # client_id → Queue
        self._topic_subscribers: Dict[str, Set[str]] = {}  # topic → {client_id}
        self._client_topics: Dict[str, Set[str]] = {}  # client_id → {topic}

    async def connect(self, client_id: str) -> asyncio.Queue:
        """Allocate a new strict-bounded queue for the client."""
        from fastapi import HTTPException

        from config.provider import GlobalConfigProvider

        config = GlobalConfigProvider().get_config()
        if self.active_count >= config.sse.max_connections:
            logger.warning("SSE connection rejected", reason="max_connections reached")
            raise HTTPException(status_code=503, detail="Server at maximum capacity")

        q = asyncio.Queue(maxsize=self._queue_size)
        self._queues[client_id] = q
        self._client_topics[client_id] = set()
        logger.debug("SSE client connected", client_id=client_id)
        return q

    def disconnect(self, client_id: str) -> None:
        """Clean up all mappings for the client."""
        self._queues.pop(client_id, None)
        topics = self._client_topics.pop(client_id, set())
        for topic in topics:
            if topic in self._topic_subscribers:
                self._topic_subscribers[topic].discard(client_id)
                if not self._topic_subscribers[topic]:
                    del self._topic_subscribers[topic]
        logger.debug("SSE client disconnected", client_id=client_id)

    def subscribe(self, client_id: str, topic: str) -> None:
        """O(1) mapping of topic to client queue."""
        if client_id not in self._queues:
            return

        self._client_topics[client_id].add(topic)
        if topic not in self._topic_subscribers:
            self._topic_subscribers[topic] = set()
        self._topic_subscribers[topic].add(client_id)

    async def publish(self, topic: str, event_type: str, data: str) -> None:
        """
        Push pre-serialized event to all subscribed client queues.
        If a client is too slow, drops their oldest message.
        Non-blocking, O(1) loop.
        """
        subscribers = self._topic_subscribers.get(topic)
        if not subscribers:
            return

        message = f"event: {event_type}\ndata: {data}\n\n"

        for client_id in subscribers:
            q = self._queues.get(client_id)
            if not q:
                continue

            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                # Client is downloading slower than events are arriving.
                # Drop their oldest event to make room and protect server memory.
                try:
                    q.get_nowait()
                    q.put_nowait(message)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass

    async def publish_mutation(
        self,
        module: str,
        resource: str,
        target: str,
        action: str,
        details: dict,
    ) -> None:
        """Helper to serialize a DB/FS mutation once and push to specific + wildcard topics."""
        # 1. Pre-serialize once (Zero-copy payload design)
        payload = orjson.dumps(
            {
                "action": action,
                "module": module,
                "resource": resource,
                "target": target,
                "details": details,
            }
        ).decode()

        # 2. Push to both exact match and wildcard
        specific_topic = f"{module}:{resource}:{target}"
        wildcard_topic = f"{module}:{resource}:*"

        # publish handles the internal loop instantly
        await self.publish(specific_topic, "mutation", payload)
        await self.publish(wildcard_topic, "mutation", payload)

    @property
    def active_count(self) -> int:
        return len(self._queues)

    @property
    def topic_count(self) -> int:
        return len(self._topic_subscribers)


# Singleton
sse_mgr = SSEConnectionManager()
