from starlette.types import ASGIApp, Message, Receive, Scope, Send

from utils.uuid7 import uuid7

_HTTP = "http"
_HTTP_RESPONSE_START = "http.response.start"
_REQ_ID_HEADER = b"x-request-id"
_REQ_ID_PREFIX = "req_"


class RequestIDMiddleware:
    """Middleware to ensure every request has an X-Request-ID (UUID v7)."""

    __slots__ = ("app",)

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != _HTTP:
            return await self.app(scope, receive, send)

        # Scan headers directly — avoid dict() allocation over the full header list
        req_id = None
        for k, v in scope.get("headers", ()):
            if k == _REQ_ID_HEADER:
                req_id = v.decode("ascii")
                break

        if req_id is None:
            req_id = f"{_REQ_ID_PREFIX}{uuid7().hex}"

        scope.setdefault("state", {})["request_id"] = req_id

        # Encode once, reuse in closure
        req_id_bytes = req_id.encode("ascii")

        async def send_wrapper(message: Message) -> None:
            if message["type"] == _HTTP_RESPONSE_START:
                resp_headers = message.setdefault("headers", [])
                resp_headers.append((_REQ_ID_HEADER, req_id_bytes))
            await send(message)

        await self.app(scope, receive, send_wrapper)
