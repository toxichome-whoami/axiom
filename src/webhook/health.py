import sqlite3
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config.provider import GlobalConfigProvider
from server.middleware.auth import AuthContext, RequireFeature
from webhook.circuit_breaker import get_circuit_breaker
from webhook.persistence import get_persistence

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

# Require 'webhooks' feature scope or full_admin for all observability routes
require_webhook_admin = RequireFeature("webhooks")


@router.get("/status")
async def get_webhook_status(auth: AuthContext = Depends(require_webhook_admin)):
    """Returns current queue depth, active workers, and circuit breaker states."""
    config = GlobalConfigProvider().get_config()
    breaker = get_circuit_breaker()

    status = {
        "config": {
            "max_concurrent_deliveries": config.webhooks.max_concurrent_deliveries,
            "persistence_enabled": config.webhooks.persistence_enabled,
            "circuit_breaker_enabled": config.webhooks.circuit_breaker_enabled,
        },
        "circuits": {url: breaker.get_state(url) for url in breaker.all_urls()},
    }

    if config.webhooks.persistence_enabled:
        persistence = get_persistence()
        if persistence:
            status["queue"] = persistence.stats()

    return status


@router.post("/circuit/{hook_name}/reset")
async def reset_circuit_breaker(
    hook_name: str, auth: AuthContext = Depends(require_webhook_admin)
):
    """Manually force a circuit breaker from OPEN to HALF_OPEN to allow immediate retry."""
    config = GlobalConfigProvider().get_config()
    hook_def = config.webhook.get(hook_name)
    if not hook_def:
        raise HTTPException(status_code=404, detail="Webhook not found")

    breaker = get_circuit_breaker()
    breaker.reset(hook_def.url)
    return {"status": "ok", "message": f"Circuit breaker for {hook_name} reset"}


@router.get("/dead-letter")
async def list_dead_letter(
    limit: int = 100, auth: AuthContext = Depends(require_webhook_admin)
):
    config = GlobalConfigProvider().get_config()
    if not config.webhooks.persistence_enabled:
        return {"error": "Persistence disabled"}

    persistence = get_persistence()
    if not persistence:
        return {"error": "Persistence not initialized"}

    conn = sqlite3.connect(persistence.db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute(
        "SELECT * FROM webhook_dead_letter ORDER BY died_at DESC LIMIT ?", (limit,)
    )
    rows = c.fetchall()
    conn.close()

    return {"dead_letters": [dict(row) for row in rows]}


class ReplayRequest(BaseModel):
    event_ids: List[str]


@router.post("/dead-letter/replay")
async def replay_dead_letter(
    req: ReplayRequest, auth: AuthContext = Depends(require_webhook_admin)
):
    config = GlobalConfigProvider().get_config()
    if not config.webhooks.persistence_enabled:
        return {"error": "Persistence disabled"}

    persistence = get_persistence()
    if not persistence:
        return {"error": "Persistence not initialized"}

    conn = sqlite3.connect(persistence.db_path)
    c = conn.cursor()

    replayed = 0
    for event_id in req.event_ids:
        c.execute("SELECT * FROM webhook_dead_letter WHERE event_id = ?", (event_id,))
        row = c.fetchone()
        if row:
            hook_def = config.webhook.get(row[3])  # hook_name
            if hook_def:
                persistence.enqueue(
                    event_id=row[2],  # event_id
                    hook_name=row[3],
                    url=row[4],
                    secret=hook_def.secret,
                    headers=hook_def.headers,
                    payload=row[5],
                )
                c.execute(
                    "DELETE FROM webhook_dead_letter WHERE event_id = ?", (event_id,)
                )
                replayed += 1

    conn.commit()
    conn.close()

    return {"success": True, "replayed": replayed}
