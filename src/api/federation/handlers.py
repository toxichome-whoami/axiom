from fastapi import Depends, Request

from api.errors import ErrorCodes, AxiomException
from api.federation.state import FederationStateManager
from api.responses import success_response
from config.provider import get_config_dependency
from config.schema import AxiomConfig
from server.middleware.auth import require_admin
from utils.types import AuthContext

from .router import router


async def _build_outgoing_federation(config, state_mgr: FederationStateManager) -> list:
    """Builds the list of outgoing remote connections the current node maintains."""
    outgoing = []
    for alias, srv_config in config.federation.server.items():
        node_state = await state_mgr.get_state(alias)

        if node_state:
            status = node_state.status
            latency_ms = node_state.latency_ms
            databases = node_state.databases
            storages = node_state.storages
        else:
            status = "unknown"
            latency_ms = 0.0
            databases = {}
            storages = {}

        outgoing.append(
            {
                "alias": alias,
                "url": srv_config.url,
                "node_id": srv_config.node_id,
                "status": status,
                "latency_ms": latency_ms,
                "databases": databases,
                "storages": storages,
            }
        )
    return outgoing


def _build_incoming_federation(config) -> list:
    """Builds the list of remote servers allowed to connect to this node."""
    incoming = []
    for node_id, key_config in config.federation.incoming.items():
        incoming.append(
            {
                "node_id": node_id,
                "mode": key_config.mode.value,
                "db_scope": key_config.db_scope,
                "fs_scope": key_config.fs_scope,
                "description": key_config.description,
                # Explicitly NEVER expose the secret
            }
        )
    return incoming


@router.get("/servers")
async def list_servers(
    request: Request,
    auth: AuthContext = Depends(require_admin),
    config: AxiomConfig = Depends(get_config_dependency),
):
    """Show full federation status: outgoing connections + incoming keys."""

    if not config.features.federation:
        raise AxiomException(
            ErrorCodes.SERVER_INTERNAL, "Federation is disabled on this instance.", 501
        )

    state_mgr = FederationStateManager()
    await state_mgr.load()

    outgoing_list = await _build_outgoing_federation(config, state_mgr)
    incoming_list = _build_incoming_federation(config)

    return success_response(
        request,
        {
            "outgoing": outgoing_list,
            "outgoing_count": len(outgoing_list),
            "incoming": incoming_list,
            "incoming_count": len(incoming_list),
        },
    )
