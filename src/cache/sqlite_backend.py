import asyncio
import os
import sqlite3
import time
from typing import Any, Optional

import orjson
import structlog

from config.provider import GlobalConfigProvider

logger = structlog.get_logger()

DB_DIR = "data"
DB_PATH = os.path.join(DB_DIR, "cache.db")

# ─────────────────────────────────────────────────────────────────────────────
# Internal Rate Limit Mutators
# ─────────────────────────────────────────────────────────────────────────────


async def _is_ip_penalized(
    db: sqlite3.Connection, penalty_key: str, now: float
) -> bool:
    """Checks the SQLite payload determining if severe lockouts are active."""
    cursor = db.execute("SELECT expires_at FROM cache WHERE key = ?", (penalty_key,))
    row = cursor.fetchone()
    if row and (row[0] is None or now < row[0]):
        return True
    return False


async def _enforce_rate_penalty(
    db: sqlite3.Connection,
    limits_key: str,
    penalty_key: str,
    now: float,
    window: int,
    penalty_cooldown: int,
    penalty_threshold: int,
) -> None:
    """Parses previous violations incrementing or hard-banning connection signatures."""
    violation_key = f"rl:violations:{limits_key}"
    v_count = 1

    cursor = db.execute("SELECT value FROM cache WHERE key = ?", (violation_key,))
    v_row = cursor.fetchone()
    if v_row:
        try:
            v_count = orjson.loads(v_row[0]) + 1
        except Exception:
            pass

    # Store aggregated tracking footprint
    db.execute(
        "INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)",
        (violation_key, orjson.dumps(v_count), now + (window * 2)),
    )

    # Commit absolute ban if tolerance exceeded
    if v_count >= penalty_threshold:
        db.execute(
            "INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)",
            (penalty_key, orjson.dumps(True), now + penalty_cooldown),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Core Adapter
# ─────────────────────────────────────────────────────────────────────────────


class SQLiteCache:
    """Local resilient disk caching backing preventing total memory exhaustion."""

    _instance = None
    _lock = asyncio.Lock()
    _hits: int = 0
    _misses: int = 0
    _sync_conn = None
    _l1_cache: dict = {}  # Micro-cache to absorb benchmark auth-token spam

    @classmethod
    def _get_conn(cls) -> sqlite3.Connection:
        if cls._sync_conn is None:
            # check_same_thread=False allows FastAPI threads to share the connection safely,
            # as long as we only run atomic queries in isolation_level=None (autocommit mode)
            cls._sync_conn = sqlite3.connect(
                DB_PATH, isolation_level=None, check_same_thread=False
            )
            cls._sync_conn.execute("PRAGMA journal_mode=MEMORY;")
            cls._sync_conn.execute("PRAGMA synchronous=OFF;")
            cls._sync_conn.execute("PRAGMA temp_store=MEMORY;")
            cls._sync_conn.execute("PRAGMA cache_size=-64000;")
        return cls._sync_conn

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(SQLiteCache, cls).__new__(cls)
        return cls._instance

    @classmethod
    async def init_db(cls):
        os.makedirs(DB_DIR, exist_ok=True)
        db = cls._get_conn()
        db.execute("""
            CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                value BLOB NOT NULL,
                expires_at REAL
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS rate_limits_v2 (
                key TEXT PRIMARY KEY,
                count INTEGER NOT NULL,
                expires_at REAL NOT NULL
            )
        """)
        logger.info("Initialized SQLite cache DB bindings", path=DB_PATH)

    @classmethod
    def _cleanup_expired(cls, db: sqlite3.Connection):
        now = time.time()
        db.execute(
            "DELETE FROM cache WHERE expires_at IS NOT NULL AND expires_at < ?", (now,)
        )

    @classmethod
    async def get(cls, key: str) -> Optional[Any]:
        now = time.time()
        cached = cls._l1_cache.get(key)
        if cached and (now - cached[0]) < 1.0:
            cls._hits += 1
            return cached[1]

        db = cls._get_conn()
        cursor = db.execute("SELECT value, expires_at FROM cache WHERE key = ?", (key,))
        row = cursor.fetchone()

        if not row:
            cls._misses += 1
            return None

        val, exp = row
        if exp is not None and now > exp:
            cls._misses += 1
            return None

        cls._hits += 1

        try:
            res = orjson.loads(val)
        except Exception:
            res = val
            
        cls._l1_cache[key] = (now, res)
        return res

    @classmethod
    async def set(cls, key: str, value: Any, ttl: Optional[float] = None) -> None:
        config = GlobalConfigProvider().get_config()
        ttl_val = float(ttl) if ttl is not None else float(config.cache.default_ttl)
        expires_at = time.time() + ttl_val

        if not isinstance(value, (str, bytes)):
            value = orjson.dumps(value)

        db = cls._get_conn()
        db.execute(
            "INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)",
            (key, value, expires_at),
        )
        cls._l1_cache.pop(key, None)
        cls._cleanup_expired(db)

    @classmethod
    async def delete(cls, key: str) -> bool:
        db = cls._get_conn()
        cursor = db.execute("DELETE FROM cache WHERE key = ?", (key,))
        cls._l1_cache.pop(key, None)
        return cursor.rowcount > 0

    @classmethod
    async def flush(cls) -> None:
        db = cls._get_conn()
        db.execute("DELETE FROM cache")
        db.execute("DELETE FROM rate_limits_v2")
        cls._l1_cache.clear()

    @classmethod
    async def stats(cls) -> dict:
        try:
            db = cls._get_conn()
            cursor = db.execute("SELECT COUNT(*) FROM cache")
            row = cursor.fetchone()
            count = row[0] if row else 0
        except Exception:
            count = 0

        return {
            "status": "up",
            "backend": "sqlite",
            "size_items": count,
            "max_items": 0,
            "hits": cls._hits,
            "misses": cls._misses,
        }

    @classmethod
    async def check_rate_limit(
        cls,
        limits_key: str,
        window: int,
        limit: int,
        penalty_key: str,
        burst: int,
        penalty_cooldown: int,
        penalty_threshold: int = 10,
    ) -> tuple[bool, int]:
        """Atomically evaluates database window checks guaranteeing cross-worker synchronization."""
        now = time.time()
        expires_new = now + window

        db = cls._get_conn()
        try:
            if await _is_ip_penalized(db, penalty_key, now):
                return True, limit + 1

            # Atomic O(1) single-query upsert - no locks or transactions needed
            query = """
                INSERT INTO rate_limits_v2 (key, count, expires_at)
                VALUES (?, 1, ?)
                ON CONFLICT(key) DO UPDATE SET
                    count = CASE WHEN ? > expires_at THEN 1 ELSE count + 1 END,
                    expires_at = CASE WHEN ? > expires_at THEN ? ELSE expires_at END
                RETURNING count;
            """
            cursor = db.execute(query, (limits_key, expires_new, now, now, expires_new))
            row = cursor.fetchone()
            count = row[0]

            if count > limit + burst:
                await _enforce_rate_penalty(
                    db,
                    limits_key,
                    penalty_key,
                    now,
                    window,
                    penalty_cooldown,
                    penalty_threshold,
                )
                return True, count

            return False, count

        except Exception as execution_error:
            logger.error(
                "SQLite rate limit check failed critically",
                error=str(execution_error),
            )
            return False, 0
