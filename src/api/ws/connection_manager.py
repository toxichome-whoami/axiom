import asyncio
from typing import Dict, List, Set

import structlog
from starlette.websockets import WebSocket

logger = structlog.get_logger("ws.connection_manager")


class ConnectionManager:
    """
    Tracks all active WebSocket connections and their topic subscriptions.
    All lookups are O(1) dict operations. Memory per connection: ~4 KB.
    """

    __slots__ = (
        "_connections",
        "_subscriptions",
        "_topic_subscribers",
        "_client_scopes",
    )

    def __init__(self) -> None:
        self._connections: Dict[str, WebSocket] = {}  # client_id → WebSocket
        self._subscriptions: Dict[str, Set[str]] = {}  # client_id → {topic}
        self._topic_subscribers: Dict[str, Set[str]] = {}  # topic → {client_id}
        self._client_scopes: Dict[str, dict] = {}  # client_id → {db_scope, fs_scope}

    async def connect(self, websocket, client_id: str, scopes: dict) -> None:
        await websocket.accept()
        self._connections[client_id] = websocket
        self._subscriptions[client_id] = set()
        self._client_scopes[client_id] = scopes
        logger.info("WebSocket connected", client_id=client_id)

    def disconnect(self, client_id: str) -> None:
        for topic in self._subscriptions.pop(client_id, set()):
            self._topic_subscribers.get(topic, set()).discard(client_id)
        self._connections.pop(client_id, None)
        self._client_scopes.pop(client_id, None)
        logger.info("WebSocket disconnected", client_id=client_id)

    def subscribe(self, client_id: str, topic: str) -> bool:
        """Returns True if subscribed, False if topic is outside the key's scope."""
        if not self._topic_in_scope(topic, self._client_scopes.get(client_id, {})):
            return False
        self._subscriptions.setdefault(client_id, set()).add(topic)
        self._topic_subscribers.setdefault(topic, set()).add(client_id)
        return True

    def unsubscribe(self, client_id: str, topic: str) -> None:
        self._subscriptions.get(client_id, set()).discard(topic)
        self._topic_subscribers.get(topic, set()).discard(client_id)

    def get_subscribers(self, topic: str) -> List[str]:
        return list(self._topic_subscribers.get(topic, set()))

    async def send(self, client_id: str, payload: bytes) -> None:
        ws = self._connections.get(client_id)
        if ws is None:
            return
        try:
            await ws.send_bytes(payload)
        except Exception:
            self.disconnect(client_id)

    async def broadcast(self, topic: str, payload: bytes) -> None:
        """Broadcast a pre-serialized orjson payload to all topic subscribers."""
        tasks = [self.send(cid, payload) for cid in self.get_subscribers(topic)]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def _topic_in_scope(self, topic: str, scopes: dict) -> bool:
        parts = topic.split(":", 2)
        if not parts:
            return False
        module = parts[0]
        if module == "db":
            alias = parts[1] if len(parts) > 1 else ""
            db_scope = scopes.get("db_scope", [])
            return "*" in db_scope or alias in db_scope
        if module == "fs":
            alias = parts[1] if len(parts) > 1 else ""
            fs_scope = scopes.get("fs_scope", [])
            return "*" in fs_scope or alias in fs_scope
        # metrics / system topics are open to all authenticated clients
        return True

    @property
    def active_count(self) -> int:
        return len(self._connections)

    @property
    def topic_count(self) -> int:
        return len(self._topic_subscribers)


# Module-level singleton — shared across all requests in the same process
conn_mgr = ConnectionManager()
