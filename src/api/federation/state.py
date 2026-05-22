import asyncio
import orjson
import os
import time
from typing import Dict, List, Optional

import aiosqlite
import structlog
from pydantic import ValidationError

from config.schema import FederationNodeState

logger = structlog.get_logger()

# ─────────────────────────────────────────────────────────────────────────────
# Federation State Management
# ─────────────────────────────────────────────────────────────────────────────


class FederationStateManager:
    """Replaces FederationState singleton with persistent + cached state."""

    def __init__(self, db_path: str = "data/federation.db"):
        self._nodes: Dict[str, FederationNodeState] = {}
        self._lock = asyncio.Lock()
        self._db_path = db_path

        # Ensure directory exists
        os.makedirs(os.path.dirname(self._db_path), exist_ok=True)

    async def _init_db(self):
        """Creates the sqlite tables if they don't exist."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS federation_nodes (
                    node_id TEXT PRIMARY KEY,
                    state_json TEXT NOT NULL
                )
            """)
            await db.commit()

    async def load(self):
        """Restore from SQLite on startup."""
        await self._init_db()
        async with self._lock:
            self._nodes.clear()
            async with aiosqlite.connect(self._db_path) as db:
                async with db.execute(
                    "SELECT node_id, state_json FROM federation_nodes"
                ) as cursor:
                    async for row in cursor:
                        node_id, state_json = row
                        try:
                            state_dict = orjson.loads(state_json)
                            self._nodes[node_id] = FederationNodeState(**state_dict)
                        except (json.JSONDecodeError, ValidationError) as e:
                            logger.warning(
                                "Failed to load federation state",
                                node_id=node_id,
                                error=str(e),
                            )

    async def persist(self):
        """Save to SQLite."""
        await self._init_db()
        async with self._lock:
            async with aiosqlite.connect(self._db_path) as db:
                for node_id, state in self._nodes.items():
                    await db.execute(
                        "INSERT OR REPLACE INTO federation_nodes (node_id, state_json) VALUES (?, ?)",
                        (node_id, state.model_dump_json()),
                    )
                await db.commit()

    async def get_state(self, node_id: str) -> Optional[FederationNodeState]:
        async with self._lock:
            return self._nodes.get(node_id)

    async def set_state(self, node_id: str, state: FederationNodeState):
        async with self._lock:
            self._nodes[node_id] = state

    async def get_healthy_nodes(self) -> List[str]:
        """Returns nodes with status == 'up'."""
        async with self._lock:
            return [
                node_id
                for node_id, state in self._nodes.items()
                if state.status == "up"
            ]

    async def get_next_retry_nodes(self) -> List[str]:
        """Returns nodes that are due for a health check or past their backoff window."""
        now = time.time()
        async with self._lock:
            return [
                node_id
                for node_id, state in self._nodes.items()
                if state.status == "unknown" or state.next_retry_at <= now
            ]
