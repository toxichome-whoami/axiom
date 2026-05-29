from starlette.types import ASGIApp, Message, Receive, Scope, Send

# ─────────────────────────────────────────────────────────────────────────────
# Pre-computed Header Sets (built once at import time — zero per-request cost)
# ─────────────────────────────────────────────────────────────────────────────

_BASE_HEADERS: list = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"x-xss-protection", b"0"),
    (b"strict-transport-security", b"max-age=63072000; includeSubDomains; preload"),
    (b"cache-control", b"no-store"),
    (b"referrer-policy", b"no-referrer"),
    (b"permissions-policy", b"interest-cohort=()"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
]

_API_HEADERS: list = _BASE_HEADERS + [
    (b"cache-control", b"no-store, no-cache, must-revalidate, max-age=0"),
    (b"pragma", b"no-cache"),
]

_DOCS_HEADERS: list = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"x-xss-protection", b"0"),
    (b"strict-transport-security", b"max-age=63072000; includeSubDomains; preload"),
    (b"referrer-policy", b"no-referrer"),
    (b"permissions-policy", b"interest-cohort=()"),
]

# Use tuple for startswith() — C-level multi-prefix check
_DOCS_PREFIXES = ("/api/docs", "/api/spec", "/docs", "/redoc")
_API_PREFIX = "/api/"
_HTTP = "http"
_HTTP_RESPONSE_START = "http.response.start"


class SecurityHeadersMiddleware:
    """ASGIMiddleware to add security headers to every response."""

    __slots__ = ("app",)

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != _HTTP:
            return await self.app(scope, receive, send)

        path = scope.get("path", "")

        # Direct prefix matching — no any() iteration
        if path.startswith(_DOCS_PREFIXES):
            headers_to_add = _DOCS_HEADERS
        elif path.startswith(_API_PREFIX):
            headers_to_add = _API_HEADERS
        else:
            headers_to_add = _BASE_HEADERS

        async def send_wrapper(message: Message) -> None:
            if message["type"] == _HTTP_RESPONSE_START:
                existing_headers = message.setdefault("headers", [])
                existing_headers.extend(headers_to_add)
            await send(message)

        await self.app(scope, receive, send_wrapper)
