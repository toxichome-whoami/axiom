from typing import Any, Optional

from config.loader import ConfigManager

from .memory import MemoryCache
from .redis_backend import RedisCache

# ─────────────────────────────────────────────────────────────────────────────
# Resolve backend ONCE at module load — never per-request.
# Hot-reload will re-import via ConfigManager.watch if needed.
# ─────────────────────────────────────────────────────────────────────────────

_config = ConfigManager.get()
_CACHE_ENABLED: bool = bool(_config.cache.enabled)
_USE_REDIS: bool = _config.cache.backend == "redis"

# Direct function references — avoids attribute lookup + branch on every call
_get_fn = RedisCache.get if _USE_REDIS else MemoryCache.get
_set_fn = RedisCache.set if _USE_REDIS else MemoryCache.set
_delete_fn = RedisCache.delete if _USE_REDIS else MemoryCache.delete


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
