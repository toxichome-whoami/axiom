import base64
import ipaddress
import urllib.parse

import httpx
from fastapi import Request
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

from api.errors import ErrorCodes, NexusGateException
from config.provider import GlobalConfigProvider


def get_proxy_client(request: Request, verify_ssl: bool = True) -> httpx.AsyncClient:
    """Manages globally persistent proxy connections mapping trust states attached to the ASGI app."""
    if not hasattr(request.app.state, "http_clients"):
        request.app.state.http_clients = {}

    clients = request.app.state.http_clients
    if verify_ssl not in clients:
        limits = httpx.Limits(max_connections=50, max_keepalive_connections=10)
        clients[verify_ssl] = httpx.AsyncClient(
            limits=limits, timeout=httpx.Timeout(30.0, connect=5.0), verify=verify_ssl
        )
    return clients[verify_ssl]


# ─────────────────────────────────────────────────────────────────────────────
# Alias Resolution
# ─────────────────────────────────────────────────────────────────────────────

_ALIAS_TO_SERVER: dict = {}


def _build_alias_map():
    """Builds O(1) alias to server routing table based on configured federation alias mappings."""
    global _ALIAS_TO_SERVER
    _ALIAS_TO_SERVER.clear()

    config = GlobalConfigProvider().get_config()

    # Pre-populate explicitly mapped federated aliases from database configs
    for db_alias, db_config in config.database.items():
        fed_alias = getattr(db_config, "federated_alias", None)
        if isinstance(fed_alias, str):
            for srv_alias in config.federation.server:
                if fed_alias.startswith(f"{srv_alias}_"):
                    _ALIAS_TO_SERVER[fed_alias] = srv_alias
                    break

    # Pre-populate implicit ones that might be accessed directly without a local db config
    # In a full overhaul, this would sync with federation state
    config.federation.alias_map = _ALIAS_TO_SERVER


def _resolve_server(alias: str) -> str | None:
    """O(1) resolution from full alias to target server ID."""
    if not _ALIAS_TO_SERVER:
        _build_alias_map()

    server_id = _ALIAS_TO_SERVER.get(alias)
    if server_id:
        return server_id

    # Fallback for dynamic aliases not pre-mapped
    config = GlobalConfigProvider().get_config()
    for srv_alias in config.federation.server:
        if alias.startswith(f"{srv_alias}_"):
            _ALIAS_TO_SERVER[alias] = srv_alias
            return srv_alias

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Proxy Request Builders
# ─────────────────────────────────────────────────────────────────────────────


def _build_remote_url(
    srv_config, target_alias: str, path: str, query: str, is_database: bool
) -> str:
    """Generates the absolute upstream endpoint bypassing string concats."""
    base_url = srv_config.url.rstrip("/")
    subpath = path.lstrip("/")

    remote_url = (
        f"{base_url}/api/db/{target_alias}/{subpath}"
        if is_database
        else f"{base_url}/api/fs/{target_alias}/{subpath}"
    )
    return f"{remote_url}?{query}" if query else remote_url


def _build_proxy_headers(request: Request, srv_config) -> dict:
    """Constructs transmission limits erasing native Host overlays."""
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("content-length", None)

    encoded_secret = base64.b64encode(srv_config.secret.encode("utf-8")).decode("utf-8")
    headers["X-Federation-Secret"] = encoded_secret
    headers["X-Federation-Node"] = srv_config.node_id
    headers["X-Request-ID"] = getattr(request.state, "request_id", "-")

    return headers


async def _stream_proxy_execution(
    client: httpx.AsyncClient, request: Request, remote_url: str, headers: dict
) -> StreamingResponse:
    """Dispatches background streaming sockets returning bound payloads."""
    req = client.build_request(
        request.method,
        remote_url,
        headers=headers,
        content=request.stream()
        if request.method in ("POST", "PUT", "PATCH")
        else None,
    )

    try:
        resp = await client.send(req, stream=True)
        pass_headers = {
            k.lower(): v
            for k, v in resp.headers.items()
            if k.lower()
            not in (
                "transfer-encoding",
                "content-encoding",
                "connection",
                "content-length",
            )
        }

        return StreamingResponse(
            resp.aiter_bytes(),
            status_code=resp.status_code,
            headers=pass_headers,
            background=BackgroundTask(resp.aclose),
        )
    except httpx.RequestError as req_error:
        raise NexusGateException(
            ErrorCodes.FED_SERVER_DOWN, f"Federated server error: {str(req_error)}", 502
        )


# ─────────────────────────────────────────────────────────────────────────────
# Primary Dispatcher
# ─────────────────────────────────────────────────────────────────────────────


def _is_safe_url(url: str) -> bool:
    """Blocks SSRF loops and strictly protects internal bogon subnet spaces."""
    try:
        parsed = urllib.parse.urlparse(url)
        hostname = parsed.hostname
        if not hostname:
            return False

        if hostname.lower() in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
            return False

        try:
            ip = ipaddress.ip_address(hostname)
            if ip.is_private or ip.is_loopback or ip.is_link_local:
                return False
        except ValueError:
            pass  # Domain name, DNS resolution handles standard external routing

        return True
    except Exception:
        return False


async def proxy_request(
    alias: str, path: str, request: Request, is_database: bool = True
) -> StreamingResponse:
    """Entrypoint binding exact aliases targeting mapped proxies natively."""
    config = GlobalConfigProvider().get_config()

    srv_alias = _resolve_server(alias)

    if srv_alias and srv_alias in config.federation.server:
        srv_config = config.federation.server[srv_alias]
        target_alias = alias[len(srv_alias) + 1 :]
        remote_url = _build_remote_url(
            srv_config, target_alias, path, request.url.query, is_database
        )

        if not _is_safe_url(remote_url):
            raise NexusGateException(
                ErrorCodes.FED_SERVER_DOWN,
                "SSRF Blocked: Federation target resolves to an internal or restricted network.",
                403,
            )

        headers = _build_proxy_headers(request, srv_config)

        client = get_proxy_client(request, srv_config.trust_mode == "verify")
        return await _stream_proxy_execution(client, request, remote_url, headers)

    resource_type = "Database" if is_database else "Storage"
    raise NexusGateException(
        ErrorCodes.FED_SERVER_DOWN,
        f"Federated {resource_type} alias '{alias}' not found or unreachable",
        404,
    )
