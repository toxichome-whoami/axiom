import asyncio
import time
from typing import AsyncGenerator

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.security import APIKeyQuery

from config.provider import GlobalConfigProvider
from server.middleware.auth import _get_static_key_context, _parse_bearer_token

from .connection_manager import sse_mgr

logger = structlog.get_logger("sse.router")
router = APIRouter()

# SSE uses query params for auth since EventSource cannot set custom headers
token_query = APIKeyQuery(name="token", auto_error=False)


def authenticate_sse(token: str = Depends(token_query)) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="Missing ?token= query parameter")

    config = GlobalConfigProvider().get_config()

    # Reuse standard auth logic but feed it a mock Bearer structure
    from fastapi.security import HTTPAuthorizationCredentials

    try:
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        key_name, secret = _parse_bearer_token(creds)
        auth_ctx = _get_static_key_context(key_name, secret, config)
    except Exception as exc:
        raise HTTPException(status_code=403, detail=str(exc))

    return {
        "api_key_name": auth_ctx.api_key_name,
        "db_scope": auth_ctx.db_scope,
        "fs_scope": auth_ctx.fs_scope,
        "full_admin": auth_ctx.full_admin,
    }


async def sse_stream(
    request: Request, queue: asyncio.Queue, client_id: str
) -> AsyncGenerator[str, None]:
    """
    Core SSE generator yielding from the client's queue.
    Automatically sends heartbeats to keep the TCP connection alive.
    """
    config = GlobalConfigProvider().get_config()
    heartbeat = config.sse.heartbeat_interval

    yield "retry: 5000\n\n"

    try:
        while True:
            if await request.is_disconnected():
                break

            try:
                # Wait for next event, timeout triggers heartbeat
                message = await asyncio.wait_for(queue.get(), timeout=heartbeat)
                yield message
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
    finally:
        sse_mgr.disconnect(client_id)


def _topic_in_scope(resource: str, scope: list[str]) -> bool:
    return "*" in scope or resource in scope


# ─── Endpoints ──────────────────────────────────────────────


@router.get("/health")
async def sse_health(request: Request):
    """Public stream for system health updates (no auth required)."""
    client_id = f"health_{id(request)}_{time.monotonic()}"
    q = await sse_mgr.connect(client_id)
    sse_mgr.subscribe(client_id, "system:health")

    return StreamingResponse(
        sse_stream(request, q, client_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.get("/metrics")
async def sse_metrics(request: Request, auth: dict = Depends(authenticate_sse)):
    """Admin-only stream for live server metrics."""
    if not auth["full_admin"]:
        raise HTTPException(status_code=403, detail="Metrics require full admin scope")

    client_id = f"metrics_{id(request)}_{time.monotonic()}"
    q = await sse_mgr.connect(client_id)
    sse_mgr.subscribe(client_id, "metrics")

    return StreamingResponse(
        sse_stream(request, q, client_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.get("/db/{alias}")
@router.get("/db/{alias}/{table}")
async def sse_db(
    request: Request,
    alias: str,
    table: str = "*",
    auth: dict = Depends(authenticate_sse),
):
    """Subscribe to database mutations (inserts, updates, deletes)."""
    if not _topic_in_scope(alias, auth["db_scope"]):
        raise HTTPException(status_code=403, detail=f"Database '{alias}' not in scope")

    client_id = f"db_{alias}_{id(request)}_{time.monotonic()}"
    q = await sse_mgr.connect(client_id)
    topic = f"db:{alias}:{table}"
    sse_mgr.subscribe(client_id, topic)

    return StreamingResponse(
        sse_stream(request, q, client_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.get("/fs/{alias}")
@router.get("/fs/{alias}/{path:path}")
async def sse_fs(
    request: Request,
    alias: str,
    path: str = "*",
    auth: dict = Depends(authenticate_sse),
):
    """Subscribe to filesystem changes (uploads, deletes)."""
    if not _topic_in_scope(alias, auth["fs_scope"]):
        raise HTTPException(status_code=403, detail=f"Storage '{alias}' not in scope")

    client_id = f"fs_{alias}_{id(request)}_{time.monotonic()}"
    q = await sse_mgr.connect(client_id)
    topic = f"fs:{alias}:{path}"
    sse_mgr.subscribe(client_id, topic)

    return StreamingResponse(
        sse_stream(request, q, client_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
