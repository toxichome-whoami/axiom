"""
Idempotency Middleware: Caches responses by X-Idempotency-Key header.
Duplicate requests with the same key return the cached response without
re-executing the handler. Keys expire after a configurable TTL.
"""

from typing import Any

import orjson
import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from cache import CacheManager
from config.loader import ConfigManager

logger = structlog.get_logger()

IDEMPOTENCY_PREFIX = "idempotency:"

# Use a frozenset for O(1) method checking
_IDEMPOTENT_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_HTTP = "http"
_HTTP_RESPONSE_START = "http.response.start"
_HTTP_RESPONSE_BODY = "http.response.body"
_IDEM_HEADER = b"x-idempotency-key"


class IdempotencyMiddleware:
    """Safeguards mutation endpoints against duplicate retry requests."""

    __slots__ = ("app", "_idempotency_ttl")

    def __init__(self, app: ASGIApp):
        self.app = app
        self._idempotency_ttl = ConfigManager.get().cache.idempotency_ttl

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != _HTTP:
            return await self.app(scope, receive, send)

        # Fast-path: skip entirely for non-mutation methods (GET, HEAD, OPTIONS)
        method = scope.get("method", "")
        if method not in _IDEMPOTENT_METHODS:
            return await self.app(scope, receive, send)

        # Scan headers for idempotency key — avoid dict() allocation
        idem_key_str = None
        for k, v in scope.get("headers", ()):
            if k == _IDEM_HEADER:
                idem_key_str = v.decode("latin-1")
                break

        if idem_key_str is None:
            return await self.app(scope, receive, send)

        cache_key = f"{IDEMPOTENCY_PREFIX}{idem_key_str}"

        # 1. Check for Cached Hit
        cached = await CacheManager.get(cache_key)
        if cached is not None:
            served = await self._serve_cached_response(send, idem_key_str, cached)
            if served:
                return

        # 2. Intercept Response Live
        res_status = 200
        res_headers = []
        res_body = bytearray()

        async def send_wrapper(message: Message) -> None:
            nonlocal res_status, res_headers

            msg_type = message["type"]
            if msg_type == _HTTP_RESPONSE_START:
                res_status = message["status"]
                res_headers = message.get("headers", [])
            elif msg_type == _HTTP_RESPONSE_BODY:
                if res_status < 500:
                    body = message.get("body")
                    if body:
                        res_body.extend(body)

            await send(message)

        await self.app(scope, receive, send_wrapper)

        # 3. Cache Result
        if res_status < 500 and len(res_body) > 0:
            await self._cache_response(cache_key, res_status, res_headers, res_body)

    async def _serve_cached_response(
        self, send: Send, idem_key_str: str, cached: Any
    ) -> bool:
        """Parses and transmits a previously cached response."""
        try:
            if isinstance(cached, str):
                cached = orjson.loads(cached)

            status_code = cached[0]
            resp_headers = [
                (k.encode("latin-1"), v.encode("latin-1")) for k, v in cached[1]
            ]
            resp_headers.append((b"x-idempotency-replayed", b"true"))
            body_bytes = bytes.fromhex(cached[2])

            await send(
                {
                    "type": _HTTP_RESPONSE_START,
                    "status": status_code,
                    "headers": resp_headers,
                }
            )
            await send({"type": _HTTP_RESPONSE_BODY, "body": body_bytes})
            return True
        except Exception:
            return False

    async def _cache_response(
        self, cache_key: str, res_status: int, res_headers: list, res_body: bytearray
    ):
        """Constructs and pushes a compact layout to the cache backend."""
        try:
            serializable_headers = [
                [k.decode("latin-1"), v.decode("latin-1")]
                for k, v in res_headers
                if k != b"x-idempotency-replayed"
            ]
            payload = [res_status, serializable_headers, res_body.hex()]

            await CacheManager.set(
                cache_key,
                orjson.dumps(payload),
                ttl=self._idempotency_ttl,
            )
        except Exception:
            pass
