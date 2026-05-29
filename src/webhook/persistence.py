import os
import sqlite3
import time
from typing import Any, Dict, List, Optional

import orjson
import structlog

from config.provider import GlobalConfigProvider

logger = structlog.get_logger()

try:
    import redis.asyncio as redis_module

    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False
    redis_module = None  # type: ignore

try:
    import nats  # type: ignore

    HAS_NATS = True
except ImportError:
    HAS_NATS = False
    nats = None  # type: ignore


class WebhookPersistence:
    """Dual-backend persistent queue (SQLite or Redis Streams) for webhook events."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._redis_client = None
        self._backend = "sqlite"

    def init_db(self):
        config = GlobalConfigProvider().get_config()
        if config.eda.enabled and config.eda.backend == "redis" and HAS_REDIS:
            self._backend = "redis"
            # Redis connection is async, we initialize it when needed or assume it's up
            logger.info("Webhook persistence using Redis Streams EDA")
            return

        if config.eda.enabled and config.eda.backend == "nats" and HAS_NATS:
            self._backend = "nats"
            logger.info("Webhook persistence using NATS JetStream EDA")
            return

        # Fallback to SQLite
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA journal_mode=WAL")
        c = conn.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS webhook_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT UNIQUE NOT NULL,
                hook_name TEXT NOT NULL,
                url TEXT NOT NULL,
                secret TEXT NOT NULL,
                headers TEXT,
                payload TEXT NOT NULL,
                attempt INTEGER DEFAULT 1,
                next_retry_at REAL DEFAULT 0,
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS webhook_dead_letter (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                queue_id INTEGER,
                event_id TEXT NOT NULL,
                hook_name TEXT NOT NULL,
                url TEXT NOT NULL,
                payload TEXT NOT NULL,
                attempts INTEGER,
                last_error TEXT,
                died_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()
        conn.close()
        logger.info("Webhook persistence DB initialized", path=self.db_path)

    async def _get_redis(self):
        if not self._redis_client:
            config = GlobalConfigProvider().get_config()
            self._redis_client = redis_module.from_url(  # type: ignore
                config.eda.redis_url, decode_responses=True
            )
            try:
                await self._redis_client.xgroup_create(
                    "axiom_webhooks", "axiom_workers", mkstream=True
                )
            except Exception:
                pass
        return self._redis_client

    async def _get_nats(self):
        if not hasattr(self, "_nats_client"):
            config = GlobalConfigProvider().get_config()
            self._nats_client = await nats.connect(config.eda.nats_url)  # type: ignore
            self._js = self._nats_client.jetstream()
            try:
                await self._js.add_stream(
                    name="axiom_webhooks", subjects=["webhooks.*"]
                )
            except Exception:
                pass
        return self._js

    def enqueue(
        self,
        event_id: str,
        hook_name: str,
        url: str,
        secret: str,
        headers: dict,
        payload: str,
    ) -> Optional[Any]:
        if self._backend == "redis":
            # For Redis, we should technically be async, but enqueue is called synchronously by emitter right now.
            # Emitter is async though! We'll just launch a fire-and-forget task.
            import asyncio
            import threading

            async def _xadd():
                client = await self._get_redis()
                await client.xadd(
                    "axiom_webhooks",
                    {
                        "event_id": event_id,
                        "hook_name": hook_name,
                        "url": url,
                        "secret": secret,
                        "headers": orjson.dumps(headers).decode("utf-8"),
                        "payload": payload,
                        "attempt": "1",
                    },
                )

            threading.Thread(target=lambda: asyncio.run(_xadd()), daemon=True).start()
            return event_id

        if self._backend == "nats":
            import asyncio
            import threading

            async def _js_publish():
                js = await self._get_nats()
                await js.publish(
                    "webhooks.enqueue",
                    orjson.dumps(
                        {
                            "event_id": event_id,
                            "hook_name": hook_name,
                            "url": url,
                            "secret": secret,
                            "headers": headers,
                            "payload": payload,
                            "attempt": 1,
                        }
                    ),
                )

            threading.Thread(
                target=lambda: asyncio.run(_js_publish()), daemon=True
            ).start()
            return event_id

        try:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()
            c.execute(
                """
                INSERT INTO webhook_queue (event_id, hook_name, url, secret, headers, payload, next_retry_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    event_id,
                    hook_name,
                    url,
                    secret,
                    orjson.dumps(headers).decode("utf-8"),
                    payload,
                    time.time(),
                ),
            )
            last_id = c.lastrowid
            conn.commit()
            conn.close()
            return last_id
        except sqlite3.IntegrityError:
            return None
        except Exception as e:
            logger.error("Failed to enqueue webhook", error=str(e))
            return None

    def mark_delivered(self, event_id: str):
        if self._backend == "redis":
            import asyncio
            import threading

            async def _xack():
                client = await self._get_redis()
                # In a full Redis Stream setup, event_id here is the Redis message ID
                try:
                    await client.xack("axiom_webhooks", "axiom_workers", event_id)
                except Exception:
                    pass

            threading.Thread(target=lambda: asyncio.run(_xack()), daemon=True).start()
            return

        if self._backend == "nats":
            # NATS uses msg.ack() directly on the consumer side.
            return

        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("DELETE FROM webhook_queue WHERE event_id = ?", (event_id,))
        conn.commit()
        conn.close()

    def mark_failed(
        self, event_id: str, attempt: int, error: str, next_retry_at: float
    ):
        if self._backend == "redis":
            # Redis doesn't naturally update retry times in streams.
            # We rely on XPENDING and DLQ for retries in the Redis architecture.
            return

        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute(
            """
            UPDATE webhook_queue
            SET status='pending', attempt=?, next_retry_at=?, updated_at=datetime('now')
            WHERE event_id = ?
        """,
            (attempt, next_retry_at, event_id),
        )
        conn.commit()
        conn.close()

    def move_to_dead_letter(
        self,
        queue_id: Any,
        event_id: str,
        hook_name: str,
        url: str,
        payload: str,
        attempts: int,
        last_error: str,
    ):
        if self._backend == "redis":
            # Redis DLQ is handled natively by dlq.py Reaper using XCLAIM.
            return

        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO webhook_dead_letter (queue_id, event_id, hook_name, url, payload, attempts, last_error)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
            (queue_id, event_id, hook_name, url, payload, attempts, last_error),
        )
        c.execute("DELETE FROM webhook_queue WHERE id = ?", (queue_id,))
        conn.commit()
        conn.close()

    def purge_expired_dlq(self, retention_hours: int):
        if self._backend == "redis":
            # Redis MAXLEN on DLQ stream handles this natively.
            return

        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute(
            "DELETE FROM webhook_dead_letter WHERE died_at < datetime('now', ?)",
            (f"-{retention_hours} hours",),
        )
        conn.commit()
        conn.close()

    def stats(self) -> dict:
        if self._backend == "redis":
            return {
                "pending": 0,
                "processing": 0,
                "dead_letter_count": 0,
                "oldest_pending_age": 0,
            }

        try:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()
            c.execute("SELECT status, COUNT(*) FROM webhook_queue GROUP BY status")
            queue_stats = dict(c.fetchall())
            c.execute("SELECT COUNT(*) FROM webhook_dead_letter")
            dlq_count = c.fetchone()[0]
            c.execute(
                "SELECT MIN(created_at) FROM webhook_queue WHERE status = 'pending'"
            )
            oldest = c.fetchone()[0]
            conn.close()
            return {
                "pending": queue_stats.get("pending", 0),
                "processing": queue_stats.get("processing", 0),
                "dead_letter_count": dlq_count,
                "oldest_pending_age": oldest,
            }
        except Exception:
            return {}

    def recover_processing_tasks(self):
        if self._backend == "redis":
            return

        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("UPDATE webhook_queue SET status='pending' WHERE status='processing'")
        conn.commit()
        conn.close()

    def fetch_all_pending(self) -> List[Dict[str, Any]]:
        if self._backend == "redis":
            return []

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute(
            "SELECT * FROM webhook_queue WHERE status = 'pending' ORDER BY created_at ASC"
        )
        rows = c.fetchall()
        tasks = [dict(row) for row in rows]
        conn.close()
        for t in tasks:
            t["headers"] = orjson.loads(t["headers"]) if t["headers"] else {}
        return tasks

    def close(self):
        if self._backend == "redis" and self._redis_client:
            import asyncio
            import threading

            client = self._redis_client
            threading.Thread(
                target=lambda: asyncio.run(client.close()),
                daemon=True,  # type: ignore
            ).start()
        pass


_persistence: Optional[WebhookPersistence] = None


def get_persistence() -> Optional[WebhookPersistence]:
    return _persistence


def init_persistence(db_path: str):
    global _persistence
    _persistence = WebhookPersistence(db_path)
    _persistence.init_db()


def close_persistence():
    global _persistence
    if _persistence:
        _persistence.close()
        _persistence = None
