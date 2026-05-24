from typing import Any, Optional

from config.provider import GlobalConfigProvider

from .memory import MemoryCache
from .redis_backend import RedisCache
from .sqlite_backend import SQLiteCache

# ─────────────────────────────────────────────────────────────────────────────
# Resolve backend ONCE at module load — never per-request.
# Hot-reload will re-import via ConfigManager.watch if needed.
# ─────────────────────────────────────────────────────────────────────────────

_config = GlobalConfigProvider().get_config()
_CACHE_ENABLED: bool = bool(_config.cache.enabled)
_BACKEND: str = _config.cache.backend

# Direct function references — avoids attribute lookup + branch on every call
if _BACKEND == "redis":
    _get_fn = RedisCache.get
    _set_fn = RedisCache.set
    _delete_fn = RedisCache.delete
elif _BACKEND == "sqlite":
    _get_fn = SQLiteCache.get
    _set_fn = SQLiteCache.set
    _delete_fn = SQLiteCache.delete
else:
    _get_fn = MemoryCache.get
    _set_fn = MemoryCache.set
    _delete_fn = MemoryCache.delete


class CacheManager:
    @staticmethod
    async def get(key: str) -> Optional[Any]:
        if not _CACHE_ENABLED:
            return None
        return await _get_fn(key)

    @staticmethod
    async def set(key: str, value: Any, ttl: Optional[float] = None) -> None:
        if not _CACHE_ENABLED:
            return
        await _set_fn(key, value, ttl)

    @staticmethod
    async def delete(key: str) -> bool:
        if not _CACHE_ENABLED:
            return False
        return await _delete_fn(key)
