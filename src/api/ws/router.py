import asyncio
import time

import orjson
import structlog
from fastapi import APIRouter
from starlette.websockets import WebSocket, WebSocketDisconnect

from config.provider import GlobalConfigProvider
from server.middleware.auth import _get_static_key_context, _parse_bearer_token

from .connection_manager import conn_mgr

logger = structlog.get_logger("ws.router")
router = APIRouter(tags=["WebSocket"])

_HEARTBEAT_INTERVAL = 30  # seconds between server pings
_AUTH_TIMEOUT = 5.0  # seconds to send auth message after connecting


async def _authenticate(websocket: WebSocket) -> dict | None:
    """
    Authenticates the WebSocket connection via the first JSON message.
    Expected: { "type": "auth", "token": "<base64(key_name:secret)>" }
    Closes with code 4001/4003 on failure.
    """
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=_AUTH_TIMEOUT)
        msg = orjson.loads(raw)
    except asyncio.TimeoutError:
        await websocket.close(code=4001, reason="Auth timeout")
        return None
    except Exception:
        await websocket.close(code=4001, reason="Invalid JSON in auth message")
        return None

    if msg.get("type") != "auth" or not msg.get("token"):
        await websocket.close(code=4001, reason="First message must be auth")
        return None

    config = GlobalConfigProvider().get_config()

    # Reuse the existing bearer token parser — identical to REST auth
    from fastapi.security import HTTPAuthorizationCredentials

    try:
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=msg["token"])
        key_name, secret = _parse_bearer_token(creds)
        auth_ctx = _get_static_key_context(key_name, secret, config)
    except Exception as exc:
        await websocket.close(code=4003, reason=str(exc))
        return None

    from server.middleware.auth import feature_in_scope

    if not feature_in_scope("ws", auth_ctx):
        await websocket.close(
            code=4003,
            reason="API key does not have permission to use the WebSocket subsystem.",
        )
        return None

    return {
        "client_id": f"{auth_ctx.api_key_name}_{id(websocket)}",
        "api_key_name": auth_ctx.api_key_name,
        "db_scope": auth_ctx.db_scope,
        "fs_scope": auth_ctx.fs_scope,
    }


@router.websocket("")
async def ws_endpoint(websocket: WebSocket) -> None:
    """
    Primary WebSocket endpoint. Lifecycle:
      1. Accept raw socket upgrade.
      2. Wait for auth message (5s timeout).
      3. Register in ConnectionManager with API key scopes.
      4. Dispatch heartbeat task + message loop concurrently.
      5. Disconnect and clean up on close or error.
    """
    config = GlobalConfigProvider().get_config()
    if conn_mgr.active_count >= config.websocket.max_connections:
        await websocket.accept()
        await websocket.close(code=1013, reason="Server at maximum capacity")
        return

    await websocket.accept()

    auth = await _authenticate(websocket)
    if not auth:
        return

    client_id = auth["client_id"]
    scopes = {"db_scope": auth["db_scope"], "fs_scope": auth["fs_scope"]}

    # Register connection (do NOT accept again — already accepted above)
    conn_mgr._connections[client_id] = websocket
    conn_mgr._subscriptions[client_id] = set()
    conn_mgr._client_scopes[client_id] = scopes
    logger.info("WebSocket authenticated", client_id=client_id)

    # Send confirmation
    await websocket.send_text(
        orjson.dumps(
            {
                "type": "connected",
                "client_id": client_id,
            }
        ).decode("utf-8")
    )

    async def _heartbeat() -> None:
        while True:
            await asyncio.sleep(_HEARTBEAT_INTERVAL)
            try:
                await websocket.send_text(
                    orjson.dumps(
                        {
                            "type": "heartbeat",
                            "server_time": time.strftime(
                                "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
                            ),
                        }
                    ).decode("utf-8")
                )
            except Exception:
                break

    heartbeat_task = asyncio.create_task(_heartbeat())

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = orjson.loads(raw)
            except Exception:
                continue

            msg_type = msg.get("type")

            if msg_type == "subscribe":
                topic = msg.get("topic", "")
                ok = conn_mgr.subscribe(client_id, topic)
                await websocket.send_text(
                    orjson.dumps(
                        {
                            "type": "ack",
                            "request_id": msg.get("request_id", ""),
                            "status": "ok" if ok else "denied",
                            "topic": topic,
                        }
                    ).decode("utf-8")
                )

            elif msg_type == "unsubscribe":
                topic = msg.get("topic", "")
                conn_mgr.unsubscribe(client_id, topic)

            elif msg_type == "pong":
                pass  # Client acknowledging our heartbeat

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected", client_id=client_id)
    except Exception as exc:
        logger.warning("WebSocket error", client_id=client_id, error=str(exc))
    finally:
        heartbeat_task.cancel()
        conn_mgr.disconnect(client_id)
