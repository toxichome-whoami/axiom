import time
from typing import Any, Dict, Optional

import orjson
from fastapi import Request, Response

from __init__ import __version__
from config.loader import ConfigManager

# ─────────────────────────────────────────────────────────────────────────────
# Helpers (resolved once, cached for the lifetime of the process)
# ─────────────────────────────────────────────────────────────────────────────

_SERVER_VERSION: str = __version__
_SERVER_HOST_CACHE: Optional[str] = None
_RESPONSE_CACHE_TTL: Optional[int] = None
_TIMESTAMP_CACHE: str = ""
_TIMESTAMP_CACHE_LAST: float = 0


def _get_server_name() -> str:
    """Cached server name to avoid ConfigManager.get() on every response."""
    global _SERVER_HOST_CACHE
    if _SERVER_HOST_CACHE is None:
        _SERVER_HOST_CACHE = ConfigManager.get().server.host
    return _SERVER_HOST_CACHE


def _get_response_cache_ttl() -> int:
    """Cached response cache TTL from config."""
    global _RESPONSE_CACHE_TTL
    if _RESPONSE_CACHE_TTL is None:
        _RESPONSE_CACHE_TTL = ConfigManager.get().cache.response_cache_ttl
    return _RESPONSE_CACHE_TTL


def _get_timestamp() -> str:
    """Cached ISO timestamp, refreshed once per second."""
    global _TIMESTAMP_CACHE, _TIMESTAMP_CACHE_LAST
    now = time.time()
    if now - _TIMESTAMP_CACHE_LAST >= 1.0:
        _TIMESTAMP_CACHE = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(now))
        _TIMESTAMP_CACHE_LAST = now
    return _TIMESTAMP_CACHE


def _build_meta(request: Request, start_time: Optional[float] = None) -> Dict[str, Any]:
    """Build response metadata as a plain dict — no Pydantic overhead."""
    st = (
        start_time
        if start_time is not None
        else getattr(request.state, "start_time", time.perf_counter())
    )
    if st is None:
        st = time.perf_counter()

    duration_ms = (time.perf_counter() - st) * 1000

    return {
        "request_id": getattr(request.state, "request_id", "-"),
        "timestamp": _get_timestamp(),
        "duration_ms": round(duration_ms, 2),
        "server": _get_server_name(),
        "version": _SERVER_VERSION,
    }


def success_response(
    request: Request,
    data: Any,
    links: Optional[Dict[str, str]] = None,
    start_time: Optional[float] = None,
) -> Response:
    """Fast response builder — plain dict, zero Pydantic allocation."""
    resp = {
        "success": True,
        "data": data,
        "meta": _build_meta(request, start_time),
    }
    if links:
        resp["links"] = links
    return Response(content=orjson.dumps(resp), media_type="application/json")


def error_response(
    request: Request,
    error_code: str,
    message: str,
    details: Optional[Any] = None,
    start_time: Optional[float] = None,
) -> Response:
    """Fast error response builder — plain dict, zero Pydantic allocation."""
    error = {"code": error_code, "message": message}
    if details is not None:
        error["details"] = details

    return Response(
        content=orjson.dumps(
            {
                "success": False,
                "error": error,
                "meta": _build_meta(request, start_time),
            }
        ),
        media_type="application/json",
    )


def cacheable_response(
    request: Request,
    data: Any,
    max_age: Optional[int] = None,
    links: Optional[Dict[str, str]] = None,
    start_time: Optional[float] = None,
) -> Response:
    """Returns a JSON response with Cache-Control headers for GET endpoints.
    max_age defaults to config.cache.response_cache_ttl if not specified."""
    if max_age is None:
        max_age = _get_response_cache_ttl()
    resp = success_response(request, data, links, start_time)
    resp.headers["Cache-Control"] = f"public, max-age={max_age}"
    return resp
