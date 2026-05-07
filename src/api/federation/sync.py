import asyncio
import base64
import time

import httpx
import structlog

from api.federation.state import FederationStateManager
from config.provider import GlobalConfigProvider
from config.schema import FederationNodeState

logger = structlog.get_logger()

# ─────────────────────────────────────────────────────────────────────────────
# Circuit Breaker & Shared Client
# ─────────────────────────────────────────────────────────────────────────────

_FED_CLIENTS: dict = {}
_CIRCUIT_STATE: dict = {}
_FED_SECRET_CACHE: dict = {}


async def shutdown_fed_clients():
    for key, client in list(_FED_CLIENTS.items()):
        await client.aclose()
    _FED_CLIENTS.clear()
    _CIRCUIT_STATE.clear()


def _get_fed_client(trust_mode: str) -> httpx.AsyncClient:
    if trust_mode not in _FED_CLIENTS:
        limits = httpx.Limits(max_connections=10, max_keepalive_connections=5)
        _FED_CLIENTS[trust_mode] = httpx.AsyncClient(
            limits=limits,
            timeout=httpx.Timeout(5.0, connect=3.0),
            verify=(trust_mode == "verify"),
        )
    return _FED_CLIENTS[trust_mode]


def _build_fed_headers(srv_config) -> dict:
    node_id = srv_config.node_id
    if node_id not in _FED_SECRET_CACHE:
        _FED_SECRET_CACHE[node_id] = base64.b64encode(
            srv_config.secret.encode("utf-8")
        ).decode("utf-8")
    return {
        "X-Federation-Secret": _FED_SECRET_CACHE[node_id],
        "X-Federation-Node": node_id,
    }


def _circuit_is_open(node_id: str, threshold: int) -> bool:
    if node_id not in _CIRCUIT_STATE:
        return False
    return _CIRCUIT_STATE[node_id] >= threshold


def _circuit_record_failure(node_id: str) -> int:
    _CIRCUIT_STATE[node_id] = _CIRCUIT_STATE.get(node_id, 0) + 1
    return _CIRCUIT_STATE[node_id]


def _circuit_record_success(node_id: str):
    _CIRCUIT_STATE[node_id] = 0


# ─────────────────────────────────────────────────────────────────────────────
# Network Execution Modules
# ─────────────────────────────────────────────────────────────────────────────


async def _poll_node_with_circuit_breaker(
    node_id: str, state_mgr: FederationStateManager
):
    """Individual node poll with circuit breaker + retry + backoff."""
    config = GlobalConfigProvider().get_config()

    if node_id not in config.federation.server:
        return

    srv_config = config.federation.server[node_id]
    fed_config = config.federation

    # Check circuit breaker state
    if _circuit_is_open(node_id, fed_config.circuit_breaker_threshold):
        return  # Skip; will retry after backoff expires

    url = srv_config.url.rstrip("/")
    try:
        client = _get_fed_client(srv_config.trust_mode)

        # Parallel polling with per-node timeout
        resp = await client.get(
            f"{url}/health",
            headers=_build_fed_headers(srv_config),
            timeout=fed_config.per_node_timeout,
        )
        resp.raise_for_status()
        data = resp.json()

        await state_mgr.set_state(
            node_id,
            FederationNodeState(
                status="up",
                latency_ms=data.get("meta", {}).get("duration_ms", 0),
                last_check=time.time(),
                consecutive_failures=0,
                next_retry_at=0,
                databases=data.get("data", {}).get("checks", {}).get("databases", {}),
                storages=data.get("data", {}).get("checks", {}).get("storages", {}),
            ),
        )
        _circuit_record_success(node_id)

    except (httpx.TimeoutException, httpx.HTTPError) as e:
        failures = _circuit_record_failure(node_id)
        backoff = min(2**failures, fed_config.backoff_max)  # EXPONENTIAL BACKOFF

        logger.warning(
            "Failed to sync federated node",
            node_id=node_id,
            error=str(e),
            failures=failures,
            backoff=backoff,
        )

        await state_mgr.set_state(
            node_id,
            FederationNodeState(
                status="down"
                if failures >= fed_config.circuit_breaker_threshold
                else "degraded",
                latency_ms=0,
                last_check=time.time(),
                consecutive_failures=failures,
                next_retry_at=time.time() + backoff,
            ),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Primary Daemon Task
# ─────────────────────────────────────────────────────────────────────────────


async def sync_federated_servers():
    """Background task polling federated servers securely ensuring network synchronization."""
    logger.info("Federation sync started")
    config = GlobalConfigProvider().get_config()

    if not config.features.federation or not config.federation.enabled:
        logger.info("Federation is disabled, shutting down sync task")
        return

    state_mgr = FederationStateManager()
    await state_mgr.load()

    # Seed new nodes
    for node_id in config.federation.server:
        if await state_mgr.get_state(node_id) is None:
            await state_mgr.set_state(node_id, FederationNodeState(status="unknown"))

    while True:
        try:
            config = GlobalConfigProvider().get_config()

            # Get nodes that need checking (healthy interval vs backoff)
            nodes_to_poll = await state_mgr.get_next_retry_nodes()

            # Add nodes that haven't been polled in a while based on sync interval
            now = time.time()
            for node_id in config.federation.server:
                state = await state_mgr.get_state(node_id)
                if (
                    state
                    and state.status == "up"
                    and (now - state.last_check) >= config.federation.sync_interval
                ):
                    if node_id not in nodes_to_poll:
                        nodes_to_poll.append(node_id)

            if nodes_to_poll:
                # PARALLEL polling with per-node timeout
                await asyncio.gather(
                    *[
                        _poll_node_with_circuit_breaker(node_id, state_mgr)
                        for node_id in nodes_to_poll
                    ],
                    return_exceptions=True,
                )

                # Persist state after each batch
                await state_mgr.persist()

            # Adaptive sleep: shorter if degraded nodes exist
            degraded = False
            for node_id in nodes_to_poll:
                st = await state_mgr.get_state(node_id)
                if st and st.status == "degraded":
                    degraded = True
                    break

            sleep_time = min(config.federation.sync_interval, 5 if degraded else 30)
            await asyncio.sleep(sleep_time)

        except asyncio.CancelledError:
            logger.info("Federation sync shutting down")
            break
        except Exception as sync_exception:
            logger.error("Federation sync error", error=str(sync_exception))
            await asyncio.sleep(config.federation.sync_interval)
