import asyncio
from typing import Any, Dict, Optional

import structlog
from axiom_core.webhook import WebhookQueueList, get_persistence  # type: ignore
from axiom_core.webhook import compile_rules as _rs_compile_rules  # type: ignore
from axiom_core.webhook import process_event as _rs_process_event  # type: ignore
from pydantic import BaseModel

from config.provider import GlobalConfigProvider

logger = structlog.get_logger()

# ─────────────────────────────────────────────────────────────────────────────
# Schema Definitions
# ─────────────────────────────────────────────────────────────────────────────


class WebhookTrigger(BaseModel):
    api_key: str
    ip: Optional[str] = None
    request_id: str
    webhook_token: Optional[str] = None


class WebhookEventDetails(BaseModel):
    module: str
    operation: str
    resource: str
    target: str
    action: str
    details: Dict[str, Any]


class WebhookPayload(BaseModel):
    event_id: str
    timestamp: str
    source: str
    event: WebhookEventDetails
    trigger: WebhookTrigger


# ─────────────────────────────────────────────────────────────────────────────
# Pre-Compiled Rule Cache
# ─────────────────────────────────────────────────────────────────────────────


def _compile_rules() -> None:
    """Delegates rule compilation to the native Rust engine."""
    try:
        _rs_compile_rules()
    except Exception as e:
        logger.error("Rust compiler failed to compile webhook rules", error=str(e))


# Compile on first import
_compile_rules()

# ─────────────────────────────────────────────────────────────────────────────
# Event Engine
# ─────────────────────────────────────────────────────────────────────────────


async def emit_event(
    module: str,
    operation: str,
    resource: str,
    target: str,
    action: str,
    details: Dict[str, Any],
    trigger: WebhookTrigger,
) -> None:
    """Async entry point for webhook emission. Bridges to native Rust engine for O(1) matching."""
    config = GlobalConfigProvider().get_config()

    # Bridge to WebSocket subscribers — fire-and-forget, zero latency impact
    if config.features.websocket:
        try:
            from api.ws.event_bus import event_bus as _ws_bus

            asyncio.create_task(
                _ws_bus.publish(
                    module=module,
                    resource=resource,
                    target=target,
                    action=action,
                    details=details,
                    request_id=trigger.request_id,
                )
            )
        except Exception:
            pass

    # Bridge to SSE subscribers
    if config.features.sse:
        try:
            from api.sse.connection_manager import sse_mgr

            asyncio.create_task(
                sse_mgr.publish_mutation(
                    module=module,
                    resource=resource,
                    target=target,
                    action=action,
                    details=details,
                )
            )
        except Exception as e:
            logger.error("SSE publish failed", error=str(e))

    # Pass the heavy lifting down into the Rust engine
    import json

    details_json = json.dumps(details)

    persistence = None
    if config.features.webhook and config.webhooks.persistence_enabled:
        persistence = get_persistence()

    queue = WebhookQueueList.get_queue()

    try:
        _rs_process_event(
            persistence,
            queue,
            module,
            operation,
            resource,
            target,
            action,
            details_json,
            trigger.api_key,
            trigger.ip,
            trigger.request_id,
            trigger.webhook_token,
        )
    except Exception as e:
        logger.error("Rust engine failed to process webhook event", error=str(e))
