"""
High-performance file streaming with:
  - HTTP Range Request (206 Partial Content) for video scrubbing
  - HEAD pre-flight support for Safari/iOS video players
  - ETag-based conditional 304 responses
  - Hardened MIME type resolution (fixes Windows mimetypes gaps for video)
  - CDN-grade Cache-Control headers
"""

import hashlib
import mimetypes
import os
from typing import Optional, Tuple

import aiofiles
from starlette.responses import Response, StreamingResponse

from api.errors import AxiomException, ErrorCodes
from security.circuit_breaker import CircuitBreaker

CHUNK_SIZE = 65536  # 64 KB

# ─────────────────────────────────────────────────────────────────────────────
# MIME Type Registry
# Windows mimetypes module is unreliable — these overrides are authoritative.
# ─────────────────────────────────────────────────────────────────────────────

_MIME_OVERRIDES = {
    # Video
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".ogv": "video/ogg",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".ts": "video/mp2t",
    ".m3u8": "application/vnd.apple.mpegurl",
    # Audio
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/opus",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    # Image
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    # Fonts
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
}

_MEDIA_PREFIXES = ("image/", "video/", "audio/", "font/")


def get_mime_type(file_path: str) -> str:
    """Returns a hardened MIME type, falling back to the OS mimetypes module."""
    ext = os.path.splitext(file_path)[1].lower()
    if ext in _MIME_OVERRIDES:
        return _MIME_OVERRIDES[ext]
    mime_type, _ = mimetypes.guess_type(file_path)
    return mime_type or "application/octet-stream"


def _is_media(mime: str) -> bool:
    return any(mime.startswith(p) for p in _MEDIA_PREFIXES)


# ─────────────────────────────────────────────────────────────────────────────
# ETag / Caching
# ─────────────────────────────────────────────────────────────────────────────


def _compute_etag(file_stat: os.stat_result) -> str:
    raw = f"{file_stat.st_ino}-{file_stat.st_mtime_ns}-{file_stat.st_size}"
    return f'W/"{hashlib.md5(raw.encode(), usedforsecurity=False).hexdigest()}"'


def _build_base_headers(
    inline: bool, mime_type: str, filename: str, etag: str, file_size: int
) -> dict:
    """Compiles common cache and content-disposition headers."""
    disposition = "inline" if inline or _is_media(mime_type) else "attachment"
    return {
        "Content-Disposition": f'{disposition}; filename="{filename}"',
        "Accept-Ranges": "bytes",
        "ETag": etag,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": (
            "public, max-age=31536000, immutable"
            if _is_media(mime_type)
            else "public, max-age=3600"
        ),
        "Content-Length": str(file_size),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Range Header Parser
# ─────────────────────────────────────────────────────────────────────────────


def _evaluate_range_bounds(parts: list, file_size: int) -> Optional[Tuple[int, int]]:
    """Maps byte-range syntax into explicit start/end offsets."""
    if parts[0] == "":
        suffix_len = int(parts[1])
        return (
            (file_size - suffix_len, file_size - 1)
            if 0 < suffix_len <= file_size
            else None
        )
    start = int(parts[0])
    end = int(parts[1]) if parts[1] else file_size - 1
    return (start, end) if 0 <= start < file_size and start <= end < file_size else None


def _parse_range_header(range_header: str, file_size: int) -> Optional[Tuple[int, int]]:
    """Parses `Range: bytes=start-end` into a (start, end) tuple."""
    if not range_header or not range_header.startswith("bytes=") or "," in range_header:
        return None
    try:
        return _evaluate_range_bounds(range_header[6:].strip().split("-", 1), file_size)
    except (ValueError, IndexError):
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Async Byte Stream Generators
# ─────────────────────────────────────────────────────────────────────────────


async def _file_range_streamer(file_path: str, start: int, end: int):
    """Streams a byte-range slice of a file for HTTP 206 responses."""
    remaining = end - start + 1
    try:
        async with aiofiles.open(file_path, mode="rb") as f:
            await f.seek(start)
            while remaining > 0 and (chunk := await f.read(min(CHUNK_SIZE, remaining))):
                remaining -= len(chunk)
                yield chunk
        CircuitBreaker.record_success("storage_streaming")
    except Exception as e:
        CircuitBreaker.record_failure("storage_streaming")
        raise e


async def _file_streamer(file_path: str):
    """Streams the entire file continuously in 64 KB chunks."""
    try:
        async with aiofiles.open(file_path, mode="rb") as f:
            while chunk := await f.read(CHUNK_SIZE):
                yield chunk
        CircuitBreaker.record_success("storage_streaming")
    except Exception as e:
        CircuitBreaker.record_failure("storage_streaming")
        raise e


# ─────────────────────────────────────────────────────────────────────────────
# Public Interface
# ─────────────────────────────────────────────────────────────────────────────


def serve_file(
    path: str,
    inline: bool = False,
    request_headers: Optional[dict] = None,
    head_only: bool = False,
) -> Response:
    """
    Serve a static file with full HTTP/1.1 range support.

    Parameters
    ----------
    path            : Absolute filesystem path to the file.
    inline          : If True, set Content-Disposition to inline.
                      Media files (video/audio/image) are always inline.
    request_headers : Dict with 'if-none-match' and 'range' values.
    head_only       : If True, return headers only (no body) — for HEAD requests.
    """
    if CircuitBreaker.is_open("storage_streaming"):
        raise AxiomException(
            ErrorCodes.SERVER_UNAVAILABLE,
            "Storage streaming circuit is currently OPEN to protect bandwidth.",
            503,
        )

    if not os.path.exists(path) or not os.path.isfile(path):
        raise AxiomException(ErrorCodes.FS_PATH_NOT_FOUND, "File not found.", 404)

    file_stat = os.stat(path)
    req_headers = request_headers or {}
    mime = get_mime_type(path)
    etag = _compute_etag(file_stat)

    # ── 304 Not Modified ──────────────────────────────────────────────────────
    if req_headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})

    base_headers = _build_base_headers(
        inline, mime, os.path.basename(path), etag, file_stat.st_size
    )

    # ── HEAD: return headers only (used by Safari/iOS before Range streaming) ─
    if head_only:
        return Response(status_code=200, headers=base_headers, media_type=mime)

    # ── Range Request (206 Partial Content) ───────────────────────────────────
    byte_range = _parse_range_header(req_headers.get("range", ""), file_stat.st_size)

    if req_headers.get("range", "") and byte_range is None:
        return Response(
            status_code=416,
            headers={
                "Content-Range": f"bytes */{file_stat.st_size}",
                **base_headers,
            },
        )

    if byte_range:
        range_length = byte_range[1] - byte_range[0] + 1
        range_headers = {
            **base_headers,
            "Content-Range": f"bytes {byte_range[0]}-{byte_range[1]}/{file_stat.st_size}",
            "Content-Length": str(range_length),
        }
        return StreamingResponse(
            _file_range_streamer(path, byte_range[0], byte_range[1]),
            status_code=206,
            media_type=mime,
            headers=range_headers,
        )

    # ── Full File (200) ───────────────────────────────────────────────────────
    return StreamingResponse(
        _file_streamer(path),
        status_code=200,
        media_type=mime,
        headers=base_headers,
    )
