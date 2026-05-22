import json
import os
import sqlite3
import time
from typing import Any, Dict, List, Optional

import structlog

logger = structlog.get_logger()


class WebhookPersistence:
    """SQLite-backed durable queue for webhook events."""

    def __init__(self, db_path: str):
        self.db_path = db_path

    def init_db(self):
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

    def enqueue(
        self,
        event_id: str,
        hook_name: str,
        url: str,
        secret: str,
        headers: dict,
        payload: str,
    ) -> Optional[int]:
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
                    json.dumps(headers),
                    payload,
                    time.time(),
                ),
            )
            last_id = c.lastrowid
            conn.commit()
            conn.close()
            return last_id
        except sqlite3.IntegrityError:
            # Deduplication via UNIQUE event_id
            return None
        except Exception as e:
            logger.error("Failed to enqueue webhook", error=str(e))
            return None

    def fetch_next(self, limit: int = 1) -> List[Dict[str, Any]]:
        now = time.time()
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute(
            """
            SELECT * FROM webhook_queue
            WHERE status = 'pending' AND next_retry_at <= ?
            ORDER BY created_at ASC
            LIMIT ?
        """,
            (now, limit),
        )
        rows = c.fetchall()
        tasks = [dict(row) for row in rows]
        if tasks:
            ids = [t["id"] for t in tasks]
            placeholders = ",".join("?" * len(ids))
            c.execute(
                f"UPDATE webhook_queue SET status='processing', updated_at=datetime('now') WHERE id IN ({placeholders})",
                ids,
            )
            conn.commit()
        conn.close()
        for t in tasks:
            t["headers"] = json.loads(t["headers"]) if t["headers"] else {}
        return tasks

    def mark_delivered(self, event_id: str):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("DELETE FROM webhook_queue WHERE event_id = ?", (event_id,))
        conn.commit()
        conn.close()

    def mark_failed(
        self, event_id: str, attempt: int, error: str, next_retry_at: float
    ):
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
        queue_id: int,
        event_id: str,
        hook_name: str,
        url: str,
        payload: str,
        attempts: int,
        last_error: str,
    ):
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
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute(
            "DELETE FROM webhook_dead_letter WHERE died_at < datetime('now', ?)",
            (f"-{retention_hours} hours",),
        )
        conn.commit()
        conn.close()

    def stats(self) -> dict:
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

    def close(self):
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
