import asyncio
import hashlib
import mimetypes
import os
import time
from datetime import datetime
from typing import Optional

import aiofiles
import structlog
from fastapi import Depends, Path, Query, Request

from api.errors import AxiomException, ErrorCodes
from api.federation.proxy import _resolve_server, proxy_request
from api.federation.state import FederationStateManager
from api.responses import is_protobuf_requested, protobuf_or_json, success_response
from api.storage.chunked_upload import ChunkedUploadManager
from cache.memory import MemoryCache
from config.loader import HOT_RELOAD_CALLBACKS
from config.provider import GlobalConfigProvider, get_config_dependency
from config.schema import AxiomConfig
from generated.axiom.v1 import fs_pb2
from server.middleware.auth import get_auth_context
from utils.size_parser import format_size, normalize_size, parse_size
from utils.types import AuthContext, ServerMode
from utils.uuid7 import uuid7
from webhook.emitter import WebhookTrigger, emit_event

from .archive import stream_zip_folder
from .file_ops import (
    build_file_info_from_entry,
    bulk_delete_paths,
    bulk_move_paths,
    copy_path,
    delete_path,
    get_file_info,
    mkdir,
    rename_path,
)
from .image_processor import process_image_and_stream
from .router import router
from .schemas import ActionRequest
from .streaming import serve_file
from .upload_scanner import ScannerRejectError, UploadScanner

logger = structlog.get_logger()
UPLOAD_BUFFER_SIZE = 1048576

# ─────────────────────────────────────────────────────────────────────────────
# Module-level feature flags (cached for performance)
# ─────────────────────────────────────────────────────────────────────────────

_FEDERATION_ENABLED: bool = False
_FEDERATION_SERVERS: tuple = ()
_STORAGE_CONFIGS: dict = {}
_USAGE_CACHE_TTL: int = 30


def _refresh_feature_flags():
    global _FEDERATION_ENABLED, _FEDERATION_SERVERS, _STORAGE_CONFIGS, _USAGE_CACHE_TTL

    config = GlobalConfigProvider().get_config()
    _FEDERATION_ENABLED = bool(config.features.federation and config.federation.enabled)
    _FEDERATION_SERVERS = (
        tuple(config.federation.server.keys()) if _FEDERATION_ENABLED else ()
    )
    _STORAGE_CONFIGS = config.storage
    # Note: _USAGE_CACHE_TTL could be moved to config.performance if desired
    _USAGE_CACHE_TTL = 30


HOT_RELOAD_CALLBACKS.append(_refresh_feature_flags)
_refresh_feature_flags()

# ─────────────────────────────────────────────────────────────────────────────
# Core Utility Functions
# ─────────────────────────────────────────────────────────────────────────────


def _is_federated(alias: str) -> bool:
    if not _FEDERATION_ENABLED:
        return False

    return _resolve_server(alias) is not None


def _get_storage_path(alias: str, rel_path: Optional[str], auth: AuthContext) -> str:
    rel_path = rel_path or ""
    if "*" not in auth.fs_scope and alias not in auth.fs_scope:
        raise AxiomException(
            ErrorCodes.AUTH_SCOPE_DENIED,
            f"API key does not have access to storage '{alias}'",
            403,
        )

    storage_cfg = _STORAGE_CONFIGS.get(alias)
    if not storage_cfg:
        raise AxiomException(
            ErrorCodes.FS_NOT_FOUND, f"Storage '{alias}' not found", 404
        )

    base_path = os.path.realpath(storage_cfg.path)
    target_path = os.path.realpath(os.path.join(base_path, rel_path.lstrip("/")))

    if not target_path.startswith(base_path):
        raise AxiomException(
            ErrorCodes.INPUT_PATH_TRAVERSAL, "Path traversal attempt detected", 400
        )

    return target_path


def _build_scanner(alias: str) -> UploadScanner:
    storage_cfg = _STORAGE_CONFIGS.get(alias)
    max_file_size = 0
    allowed_ext, blocked_ext = [], []

    if storage_cfg:
        try:
            max_file_size = parse_size(storage_cfg.max_file_size)
        except Exception:
            pass
        allowed_ext, blocked_ext = (
            storage_cfg.allowed_extensions or [],
            storage_cfg.blocked_extensions or [],
        )

    return UploadScanner(
        allowed_extensions=allowed_ext,
        blocked_extensions=blocked_ext,
        max_file_size=max_file_size,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Federation Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _append_remote_storages(
    alias: str, remote_payload: list, remote_storages_map: dict
) -> None:
    for fs in remote_payload:
        if fs.get("federated"):
            continue

        fs_name = fs.get("name")
        health_status = remote_storages_map.get(fs_name, {})
        remote_storages_map[fs_name] = {
            "status": health_status.get("status", "available")
            if isinstance(health_status, dict)
            else health_status,
            "mode": fs.get("mode", "proxy"),
            "limit": normalize_size(fs.get("limit", "10 GB")),
            "chunk_size": normalize_size(fs.get("chunk_size", "10 MB")),
            "max_file_size": normalize_size(fs.get("max_file_size", "100 MB")),
        }


# Removed _fetch_remote_storages since state is now local
async def _append_cached_remote_storages(
    alias: str, info_dict: dict, active_storages: list, auth: AuthContext
):
    for storage_name, info in info_dict.items():
        federated_name = f"{alias}_{storage_name}"
        if "*" not in auth.fs_scope and federated_name not in auth.fs_scope:
            continue

        is_dict = isinstance(info, dict)
        active_storages.append(
            {
                "name": federated_name,
                "mode": info.get("mode", "proxy") if is_dict else "proxy",
                "status": "available"
                if (info.get("status", "available") if is_dict else info) == "up"
                else (info.get("status") if is_dict else info),
                "limit": normalize_size(
                    info.get("limit", "10 GB") if is_dict else "10 GB"
                ),
                "chunk_size": normalize_size(
                    info.get("chunk_size", "10 MB") if is_dict else "10 MB"
                ),
                "max_file_size": normalize_size(
                    info.get("max_file_size", "100 MB") if is_dict else "100 MB"
                ),
                "federated": True,
                "remote_server": alias,
            }
        )


# ─────────────────────────────────────────────────────────────────────────────
# Upload Integrators
# ─────────────────────────────────────────────────────────────────────────────


async def _process_streamed_chunk(
    f,
    chunk: bytes,
    scanner: UploadScanner,
    scanned: bool,
    total_written: int,
    target_path: str,
    filename: str,
) -> bool:
    """Invokes magic bytes verification bounding max injection attempts seamlessly."""
    if not scanned:
        try:
            scanner.scan_magic_bytes(chunk[:1024], filename)
        except ScannerRejectError as e:
            await f.close()
            if os.path.exists(target_path):
                os.remove(target_path)
            raise AxiomException(e.code, e.message, 400)

    await f.write(chunk)

    if scanner.max_file_size > 0 and total_written > scanner.max_file_size:
        await f.close()
        if os.path.exists(target_path):
            os.remove(target_path)
        raise AxiomException(
            ErrorCodes.FS_FILE_TOO_LARGE,
            "Target block supersedes max memory layout.",
            413,
        )

    return True


async def _stream_direct_upload(
    file, target_path: str, scanner: UploadScanner, filename: str
) -> tuple[int, str]:
    """Generates standard SHA outputs isolating file pointers."""
    total_written, scanned, sha256 = 0, False, hashlib.sha256()

    async with aiofiles.open(target_path, "wb") as f:
        while chunk := await file.read(UPLOAD_BUFFER_SIZE):
            total_written += len(chunk)
            scanned = await _process_streamed_chunk(
                f, chunk, scanner, scanned, total_written, target_path, filename
            )
            sha256.update(chunk)

    return total_written, sha256.hexdigest()


async def _handle_direct_upload(
    request: Request, alias: str, form, scanner: UploadScanner, auth: AuthContext
):
    path, file = form.get("path"), form.get("file")
    filename = getattr(file, "filename", path)

    try:
        scanner.validate_filename(filename)
    except ScannerRejectError as e:
        raise AxiomException(e.code, e.message, 400)

    target_path = _get_storage_path(alias, path, auth)
    os.makedirs(os.path.dirname(target_path), exist_ok=True)

    total_written, root_hash = await _stream_direct_upload(
        file, target_path, scanner, filename
    )

    await emit_event(
        "fs",
        "write",
        alias,
        path,
        "UPLOAD_DIRECT",
        {"size": total_written, "sha256": root_hash},
        WebhookTrigger(
            api_key=auth.api_key_name,
            ip=request.client.host if request.client else "",
            request_id=getattr(request.state, "request_id", "-"),
            webhook_token=request.headers.get("X-Axiom-Webhook-Token"),
        ),
    )

    return success_response(
        request,
        {
            "action": "direct",
            "status": "success",
            "file": {"path": target_path, "size": total_written, "sha256": root_hash},
        },
    )


async def _handle_form_upload(
    request: Request, alias: str, scanner: UploadScanner, auth: AuthContext
):
    form = await request.form()

    if form.get("action") == "direct":
        return await _handle_direct_upload(request, alias, form, scanner, auth)

    if form.get("action") == "chunk":
        upload_id = form.get("upload_id")
        chunk_index_raw = form.get("chunk_index")
        chunk_hash = form.get("chunk_hash")

        if (
            not isinstance(upload_id, str)
            or not isinstance(chunk_index_raw, str)
            or not isinstance(chunk_hash, str)
        ):
            raise AxiomException(
                ErrorCodes.INPUT_SCHEMA_INVALID, "Invalid chunk upload parameters", 400
            )

        chunk_index = int(chunk_index_raw)
        await ChunkedUploadManager.write_chunk_stream(
            upload_id, chunk_index, chunk_hash, form.get("file")
        )

        session = await ChunkedUploadManager.get_session(upload_id)
        if not session:
            raise AxiomException(
                ErrorCodes.FS_UPLOAD_EXPIRED, "Upload session not found or expired", 410
            )

        total_size = session.get("total_size", 0)
        percent = (
            round(session["uploaded_bytes"] / total_size * 100, 2)
            if total_size > 0
            else 0
        )

        return success_response(
            request,
            {
                "upload_id": upload_id,
                "chunk_index": chunk_index,
                "status": "uploaded",
                "verified": True,
                "progress": {
                    "uploaded_chunks": len(session["uploaded_chunks"]),
                    "total_chunks": session["total_chunks"],
                    "uploaded_bytes": session["uploaded_bytes"],
                    "total_bytes": total_size,
                    "percent": percent,
                },
            },
        )

    raise AxiomException(
        ErrorCodes.INPUT_SCHEMA_INVALID, "Invalid form action binding", 400
    )


# ─────────────────────────────────────────────────────────────────────────────
# JSON Uploads
# ─────────────────────────────────────────────────────────────────────────────


async def _action_initiate(
    request: Request, body: dict, alias: str, scanner: UploadScanner
):
    """Parses multipart chunks assigning identifiers natively."""
    filename = body.get("filename", "")
    try:
        scanner.validate_filename(filename)
        scanner.validate_size(body.get("total_size", 0))
    except ScannerRejectError as e:
        raise AxiomException(
            e.code, e.message, 400 if e.code != ErrorCodes.FS_FILE_TOO_LARGE else 413
        )

    upload_id = f"upl_{uuid7().hex}"

    storage_cfg = _STORAGE_CONFIGS.get(alias)
    if not storage_cfg:
        raise AxiomException(
            ErrorCodes.FS_NOT_FOUND, f"Storage alias not found: {alias}", 404
        )

    try:
        chunk_size_bytes = parse_size(body.get("chunk_size", storage_cfg.chunk_size))
    except Exception:
        chunk_size_bytes = 10485760

    total_size = body.get("total_size", 0)
    total_chunks = (total_size + chunk_size_bytes - 1) // chunk_size_bytes

    await ChunkedUploadManager.initiate(
        upload_id,
        {
            "upload_id": upload_id,
            "filename": filename,
            "path": body.get("path"),
            "total_size": total_size,
            "chunk_size": chunk_size_bytes,
            "checksum_sha256": body.get("checksum_sha256"),
            "total_chunks": total_chunks,
            "uploaded_chunks": [],
            "uploaded_bytes": 0,
        },
    )

    chunks = [
        {
            "index": i,
            "offset": i * chunk_size_bytes,
            "size": min(chunk_size_bytes, total_size - i * chunk_size_bytes),
            "status": "pending",
        }
        for i in range(total_chunks)
    ]
    return success_response(
        request,
        {
            "upload_id": upload_id,
            "chunk_size": chunk_size_bytes,
            "total_chunks": total_chunks,
            "chunks": chunks,
        },
    )


async def _action_finalize(request: Request, body: dict, alias: str, auth: AuthContext):
    """Executes post-merge scripts invoking event hooks."""
    upload_id = body.get("upload_id")
    if not isinstance(upload_id, str):
        raise AxiomException(
            ErrorCodes.INPUT_SCHEMA_INVALID, "Missing or invalid upload_id", 400
        )

    session = await ChunkedUploadManager.get_session(upload_id)
    if not session:
        raise AxiomException(
            ErrorCodes.FS_UPLOAD_EXPIRED, "Upload session not found or expired", 410
        )

    target = _get_storage_path(alias, session["path"], auth)

    result = await ChunkedUploadManager.finalize(upload_id, target)
    await emit_event(
        "fs",
        "write",
        alias,
        session["path"],
        "UPLOAD_CHUNKED",
        result,
        WebhookTrigger(
            api_key=auth.api_key_name,
            ip=request.client.host if request.client else "",
            request_id=getattr(request.state, "request_id", "-"),
            webhook_token=request.headers.get("X-Axiom-Webhook-Token"),
        ),
    )
    return success_response(
        request, {"file": {"name": session["filename"], "path": target, **result}}
    )


async def _handle_json_upload(
    request: Request, alias: str, scanner: UploadScanner, auth: AuthContext
):
    body = await request.json()
    action = body.get("action")
    if action == "initiate":
        return await _action_initiate(request, body, alias, scanner)
    if action == "finalize":
        return await _action_finalize(request, body, alias, auth)
    if action == "status":
        upload_id = body.get("upload_id")
        if not isinstance(upload_id, str):
            raise AxiomException(
                ErrorCodes.INPUT_SCHEMA_INVALID, "Missing or invalid upload_id", 400
            )
        return success_response(
            request, await ChunkedUploadManager.get_session(upload_id)
        )

    if action == "cancel":
        upload_id = body.get("upload_id")
        if not isinstance(upload_id, str):
            raise AxiomException(
                ErrorCodes.INPUT_SCHEMA_INVALID, "Missing or invalid upload_id", 400
            )
        await ChunkedUploadManager.cancel(upload_id)
        return success_response(request, {"action": "cancel", "upload_id": upload_id})
    raise AxiomException(
        ErrorCodes.INPUT_SCHEMA_INVALID, "Invalid block definition", 400
    )


# ─────────────────────────────────────────────────────────────────────────────
# Storage Usage (threadpool + TTL cache)
# ─────────────────────────────────────────────────────────────────────────────

_usage_cache: dict = {}  # {path: (timestamp, result)}
_USAGE_CACHE_TTL = 30  # seconds — avoid rescanning disk on every request


def _scan_directory_sync(storage_path: str) -> tuple[int, int]:
    """Synchronous scandir walk — runs inside a threadpool, never blocks the event loop."""
    total_bytes = 0
    file_count = 0
    stack = [storage_path]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    try:
                        if entry.is_file(follow_symlinks=False):
                            total_bytes += entry.stat(follow_symlinks=False).st_size
                            file_count += 1
                        elif entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                    except (OSError, PermissionError):
                        continue
        except (OSError, PermissionError):
            continue
    return total_bytes, file_count


async def _calculate_storage_usage(storage_path: str, limit_str: str) -> dict:
    """Calculates real disk usage for a storage volume. Cached for 30s, scanned in a threadpool."""
    now = time.monotonic()
    cached = _usage_cache.get(storage_path)
    if cached and (now - cached[0]) < _USAGE_CACHE_TTL:
        return cached[1]

    if not os.path.exists(storage_path):
        result = {
            "used_bytes": [0, "0 B"],
            "available_bytes": [0, "0 B"],
            "file_count": 0,
        }
        _usage_cache[storage_path] = (now, result)
        return result

    # Offload blocking I/O to the default threadpool
    total_bytes, file_count = await asyncio.to_thread(
        _scan_directory_sync, storage_path
    )

    limit_bytes = parse_size(limit_str) if limit_str else 0
    available_bytes = max(0, limit_bytes - total_bytes) if limit_bytes > 0 else 0

    result = {
        "used_bytes": [total_bytes, format_size(total_bytes)],
        "available_bytes": [available_bytes, format_size(available_bytes)]
        if limit_bytes > 0
        else [0, "unlimited"],
        "file_count": file_count,
    }
    _usage_cache[storage_path] = (now, result)
    return result


@router.get("/storages")
async def list_storages(
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
    config: AxiomConfig = Depends(get_config_dependency),
):
    storages = []
    for name, storage_cfg in config.storage.items():
        if "*" in auth.fs_scope or name in auth.fs_scope:
            usage = await _calculate_storage_usage(storage_cfg.path, storage_cfg.limit)
            storages.append(
                {
                    "name": name,
                    "mode": storage_cfg.mode.value,
                    "status": "available"
                    if os.path.exists(storage_cfg.path)
                    else "unavailable",
                    "limit": normalize_size(storage_cfg.limit),
                    "chunk_size": normalize_size(storage_cfg.chunk_size),
                    "max_file_size": normalize_size(storage_cfg.max_file_size),
                    "federated": False,
                    "usage": usage,
                }
            )

    if _FEDERATION_ENABLED:
        try:
            state_mgr = FederationStateManager()
            await state_mgr.load()

            for alias in config.federation.server:
                node_state = await state_mgr.get_state(alias)
                if node_state and node_state.status == "up":
                    await _append_cached_remote_storages(
                        alias, node_state.storages, storages, auth
                    )
        except Exception as e:
            logger.error("Failed to append federated storages", error=str(e))

    return success_response(request, {"storages": storages})


@router.get("/{alias}/list")
async def list_folder(
    request: Request,
    alias: str = Path(...),
    path: str = Query("/"),
    recursive: bool = Query(False),
    limit: int = Query(100, ge=1, le=1000),
    continuation_token: Optional[str] = Query(None),
    auth: AuthContext = Depends(get_auth_context),
):
    if _is_federated(alias):
        return await proxy_request(alias, "list", request, False)

    target_path = _get_storage_path(alias, path, auth)
    req_fmt = "protobuf" if is_protobuf_requested(request) else "json"

    config_obj = GlobalConfigProvider().get_config()
    cache_key = (
        f"fs_list:{alias}:{path}:{recursive}:{limit}:{continuation_token}:{req_fmt}"
    )

    if config_obj.cache.enabled and config_obj.cache.fs_cache:
        cached = await MemoryCache.get(cache_key)
        if cached is not None:
            if req_fmt == "protobuf":
                return protobuf_or_json(request, cached, None)
            else:
                items, is_truncated, next_token = cached
                json_payload = {
                    "storage": alias,
                    "path": path,
                    "items": items,
                    "pagination": {
                        "limit": limit,
                        "is_truncated": is_truncated,
                        "next_continuation_token": next_token,
                    },
                }
                return protobuf_or_json(request, None, json_payload)

    def _recursive_scandir(p):
        try:
            with os.scandir(p) as it:
                for entry in it:
                    yield entry
                    if entry.is_dir(follow_symlinks=False):
                        yield from _recursive_scandir(entry.path)
        except (OSError, PermissionError):
            pass

    def _scan_directory(return_format: str):
        if not os.path.exists(target_path):
            raise AxiomException(ErrorCodes.FS_PATH_NOT_FOUND, "Missing Node", 404)
        if not os.path.isdir(target_path):
            raise AxiomException(
                ErrorCodes.FS_PATH_NOT_FOUND, "Path rejects dict schema.", 400
            )

        target_token = None
        if continuation_token:
            try:
                import base64

                target_token = base64.b64decode(continuation_token).decode("utf-8")
            except Exception:
                raise AxiomException(
                    ErrorCodes.INPUT_SCHEMA_INVALID, "Invalid continuation_token", 400
                )

        # Use recursive generator or standard scandir
        if recursive:
            entries_iter = _recursive_scandir(target_path)
        else:
            try:
                entries_iter = os.scandir(target_path)
            except PermissionError:
                raise AxiomException(
                    ErrorCodes.AUTH_SCOPE_DENIED, "Permission denied reading path.", 403
                )
            except Exception as e:
                raise AxiomException(
                    ErrorCodes.SERVER_INTERNAL,
                    f"Failed to list directory: {str(e)}",
                    500,
                )

        # Skip until we hit the continuation token
        if target_token:
            for entry in entries_iter:
                # Use relpath for recursive uniqueness, or just name for flat
                identifier = (
                    os.path.relpath(entry.path, target_path).replace("\\", "/")
                    if recursive
                    else entry.name
                )
                if identifier == target_token:
                    break

        page = []
        for entry in entries_iter:
            page.append(entry)
            if len(page) == limit:
                break

        is_truncated = False
        next_token = None

        # Peek next to see if truncated
        try:
            next(entries_iter)
            is_truncated = True
            if page:
                last_entry = page[-1]
                identifier = (
                    os.path.relpath(last_entry.path, target_path).replace("\\", "/")
                    if recursive
                    else last_entry.name
                )
                import base64

                next_token = base64.b64encode(identifier.encode("utf-8")).decode(
                    "utf-8"
                )
        except StopIteration:
            pass
        finally:
            if not recursive and hasattr(entries_iter, "close"):
                entries_iter.close()

        if return_format == "protobuf":
            pb = fs_pb2.ListDirectoryResponse()
            pb.is_truncated = is_truncated  # type: ignore
            if next_token:
                pb.next_continuation_token = next_token  # type: ignore
            for e in page:
                pb_e = pb.entries.add()
                pb_e.name = (
                    os.path.relpath(e.path, target_path).replace("\\", "/")
                    if recursive
                    else e.name
                )
                pb_e.is_dir = e.is_dir(follow_symlinks=False)
                try:
                    stat = e.stat(follow_symlinks=False)
                    pb_e.size = stat.st_size if not pb_e.is_dir else 0
                    pb_e.modified = datetime.fromtimestamp(stat.st_mtime).isoformat()
                    if not pb_e.is_dir:
                        mime, _ = mimetypes.guess_type(e.path)
                        pb_e.mime_type = mime or "application/octet-stream"
                except OSError:
                    pass
            return pb
        else:
            items = []
            for e in page:
                info = build_file_info_from_entry(e)
                if recursive:
                    info["name"] = os.path.relpath(e.path, target_path).replace(
                        "\\", "/"
                    )
                items.append(info)
            return items, is_truncated, next_token

    # Restore TTL caching with cursor-aware cache key
    if req_fmt == "protobuf":
        result_payload = await asyncio.to_thread(_scan_directory, req_fmt)
        if config_obj.cache.enabled and config_obj.cache.fs_cache:
            await MemoryCache.set(cache_key, result_payload, ttl=2)
        return protobuf_or_json(request, result_payload, None)
    else:
        items, is_truncated, next_token = await asyncio.to_thread(
            _scan_directory, req_fmt
        )  # type: ignore
        if config_obj.cache.enabled and config_obj.cache.fs_cache:
            await MemoryCache.set(cache_key, (items, is_truncated, next_token), ttl=2)

        json_payload = {
            "storage": alias,
            "path": path,
            "items": items,
            "pagination": {
                "limit": limit,
                "is_truncated": is_truncated,
                "next_continuation_token": next_token,
            },
        }
        return protobuf_or_json(request, None, json_payload)


@router.head("/{alias}/download")
async def head_file(
    request: Request,
    alias: str = Path(...),
    path: str = Query(...),
    auth: AuthContext = Depends(get_auth_context),
):
    """HEAD pre-flight for Safari/iOS — returns headers without body."""
    if _is_federated(alias):
        return await proxy_request(alias, "download", request, False)
    target_path = _get_storage_path(alias, path, auth)
    return serve_file(
        target_path,
        inline=True,
        request_headers={},
        head_only=True,
    )


@router.get("/{alias}/download")
async def download_file(
    request: Request,
    alias: str = Path(...),
    path: str = Query(...),
    inline: bool = Query(False),
    width: Optional[int] = Query(None),
    height: Optional[int] = Query(None),
    format: Optional[str] = Query(None),
    quality: int = Query(
        82, ge=1, le=100, description="JPEG/WebP/AVIF compression quality (1–100)"
    ),
    fit: str = Query("contain", description="Fit mode: contain | cover | fill"),
    auth: AuthContext = Depends(get_auth_context),
):
    """Download or stream a file. Supports image resize/convert and HTTP Range for video."""
    if _is_federated(alias):
        return await proxy_request(alias, "download", request, False)
    target_path = _get_storage_path(alias, path, auth)

    is_dir = await asyncio.to_thread(os.path.isdir, target_path)
    if is_dir:
        return stream_zip_folder(target_path, os.path.basename(target_path))

    if width or height or format:
        return await asyncio.to_thread(
            process_image_and_stream,
            target_path,
            width,
            height,
            quality=quality,
            format=format,
            fit=fit,
            accept_header=request.headers.get("accept", ""),
            if_none_match=request.headers.get("if-none-match", ""),
        )

    return serve_file(
        target_path,
        inline,
        request_headers={
            "if-none-match": request.headers.get("if-none-match", ""),
            "range": request.headers.get("range", ""),
        },
    )


@router.post("/{alias}/upload")
async def upload_file(
    request: Request,
    alias: str = Path(...),
    auth: AuthContext = Depends(get_auth_context),
):
    if _is_federated(alias):
        return await proxy_request(alias, "upload", request, False)
    if auth.mode == ServerMode.READONLY:
        raise AxiomException(
            ErrorCodes.AUTH_INSUFFICIENT_MODE, "Permissions block mutators.", 403
        )

    scanner = _build_scanner(alias)
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        return await _handle_form_upload(request, alias, scanner, auth)
    return await _handle_json_upload(request, alias, scanner, auth)


async def _execute_bulk_actions(
    request: Request, body: ActionRequest, alias: str, auth: AuthContext
) -> dict:
    if body.action == "bulk_delete":
        if not body.sources:
            raise AxiomException(
                ErrorCodes.INPUT_SCHEMA_INVALID, "Missing 'sources'", 400
            )
        results = await bulk_delete_paths(
            [_get_storage_path(alias, s, auth) for s in body.sources]
        )
        for i, res in enumerate(results):
            res["source"] = body.sources[i]
        return {"action": "bulk_delete", "results": results}

    if body.action == "bulk_move":
        if not body.operations:
            raise AxiomException(
                ErrorCodes.INPUT_SCHEMA_INVALID, "Missing 'operations'", 400
            )
        real_ops = [
            {
                "source": _get_storage_path(alias, o.get("source"), auth),
                "target": _get_storage_path(alias, o.get("target"), auth),
            }
            for o in body.operations
            if o.get("source") and o.get("target")
        ]
        results = await bulk_move_paths(real_ops)

        for i, res in enumerate(results):
            if i < len(body.operations):
                res["source"] = body.operations[i].get("source")
                if "target" in res:
                    res["target"] = body.operations[i].get("target")
        return {"action": "bulk_move", "results": results}

    raise AxiomException(
        ErrorCodes.INPUT_SCHEMA_INVALID, f"Invalid bulk action: {body.action}", 400
    )


@router.post("/{alias}/action")
async def execute_action(
    request: Request,
    body: ActionRequest,
    alias: str = Path(...),
    auth: AuthContext = Depends(get_auth_context),
):
    if _is_federated(alias):
        return await proxy_request(alias, "action", request, False)
    if auth.mode == ServerMode.READONLY and body.action not in ("info", "exists"):
        raise AxiomException(
            ErrorCodes.AUTH_INSUFFICIENT_MODE,
            "Mutation policies restricted globally.",
            403,
        )

    if body.action == "info":
        return success_response(
            request,
            {
                "action": "info",
                "source": body.source,
                "info": await get_file_info(
                    _get_storage_path(alias, body.source, auth)
                ),
            },
        )
    if body.action == "exists":
        return success_response(
            request,
            {
                "action": "exists",
                "source": body.source,
                "exists": os.path.exists(_get_storage_path(alias, body.source, auth)),
            },
        )
    if body.action in ("bulk_delete", "bulk_move"):
        return success_response(
            request, await _execute_bulk_actions(request, body, alias, auth)
        )

    if body.action == "delete":
        await delete_path(_get_storage_path(alias, body.source, auth))
        return success_response(
            request, {"action": "delete", "source": body.source, "status": "success"}
        )
    if body.action == "mkdir":
        await mkdir(_get_storage_path(alias, body.source, auth))
        return success_response(
            request, {"action": "mkdir", "source": body.source, "status": "success"}
        )
    if body.action in ("rename", "move", "copy"):
        source, target = (
            _get_storage_path(alias, body.source, auth),
            _get_storage_path(alias, body.target, auth),
        )
        await copy_path(source, target) if body.action == "copy" else await rename_path(
            source, target
        )
        return success_response(
            request,
            {
                "action": body.action,
                "source": body.source,
                "target": body.target,
                "status": "success",
            },
        )

    raise AxiomException(
        ErrorCodes.SERVER_INTERNAL, f"Action {body.action} not yet implemented.", 501
    )
