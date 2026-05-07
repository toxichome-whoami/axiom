import time

import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = structlog.get_logger()

# ─────────────────────────────────────────────────────────────────────────────
# Pre-computed constants
# ─────────────────────────────────────────────────────────────────────────────

_HTTP = "http"
_HTTP_RESPONSE_START = "http.response.start"
_STATUS_KEY = "status"
_TYPE_KEY = "type"


class LoggingMiddleware:
    """Logs lifecycle and latency execution details for all requests."""

    __slots__ = ("app",)

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope[_TYPE_KEY] != _HTTP:
            return await self.app(scope, receive, send)

        start_time = time.perf_counter()
        status_code = 500  # Default in case of crash before response.start

        async def send_wrapper(message: Message):
            nonlocal status_code
            if message[_TYPE_KEY] == _HTTP_RESPONSE_START:
                status_code = message[_STATUS_KEY]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as e:
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.error(
                "Request failed",
                request_id=scope.get("state", {}).get("request_id", "-"),
                method=scope.get("method"),
                path=scope.get("path"),
                duration_ms=round(duration_ms, 2),
                error=str(e),
            )
            raise

        # Only log warnings/errors — skip info-level logging for 2xx/3xx to
        # eliminate the single largest per-request I/O bottleneck.
        if status_code >= 400:
            duration_ms = (time.perf_counter() - start_time) * 1000
            req_id = scope.get("state", {}).get("request_id", "-")
            method = scope.get("method")
            path = scope.get("path")

            if status_code >= 500:
                logger.error(
                    "Request completed",
                    request_id=req_id,
                    method=method,
                    path=path,
                    status=status_code,
                    duration_ms=round(duration_ms, 2),
                )
            else:
                logger.warning(
                    "Request completed",
                    request_id=req_id,
                    method=method,
                    path=path,
                    status=status_code,
                    duration_ms=round(duration_ms, 2),
                )
