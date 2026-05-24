"""
Industrial-grade image processing with on-the-fly resize, crop, format conversion,
WebP/AVIF auto-negotiation, ETag deduplication, and streaming output.

Supported fit modes:
  - contain : Aspect-ratio-preserving thumbnail (default, no crop)
  - cover   : Crop to exact dimensions from center (crop to fill)
  - fill    : Stretch to exact dimensions (no crop, no letterbox)

Format auto-negotiation (via Accept header):
  - If client sends `Accept: image/avif,image/webp` and format not forced,
    server picks the best supported format automatically.
"""

import hashlib
import io
import os
from typing import Any, Optional

from starlette.responses import Response, StreamingResponse

from api.errors import AxiomException, ErrorCodes

STREAM_CHUNK = 65536  # 64 KB

# ─────────────────────────────────────────────────────────────────────────────
# Pillow Optional Import
# ─────────────────────────────────────────────────────────────────────────────

try:
    from PIL import Image, ImageOps

    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    Image: Any = None
    ImageOps: Any = None

# AVIF requires Pillow ≥ 9.2 compiled with libaom/libavc
_AVIF_SUPPORTED = False
if HAS_PIL:
    try:
        buf = io.BytesIO()
        Image.new("RGB", (1, 1)).save(buf, format="AVIF")
        _AVIF_SUPPORTED = True
    except Exception:
        _AVIF_SUPPORTED = False

# ─────────────────────────────────────────────────────────────────────────────
# MIME / Format Helpers
# ─────────────────────────────────────────────────────────────────────────────

_FORMAT_TO_MIME = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
    "AVIF": "image/avif",
    "GIF": "image/gif",
    "BMP": "image/bmp",
    "TIFF": "image/tiff",
}

_LOSSLESS_FORMATS = {"PNG", "GIF", "BMP", "TIFF"}


def _negotiate_format(accept_header: str, requested: Optional[str]) -> Optional[str]:
    """
    If the caller forced a format via ?format=, honour it.
    Otherwise, inspect the browser's Accept header and pick the best
    format the server can produce.
    Priority: AVIF > WebP > keep original.
    """
    if requested:
        fmt = requested.upper()
        return "JPEG" if fmt == "JPG" else fmt

    if not accept_header:
        return None  # let _resolve_image_format fall back to source format

    if _AVIF_SUPPORTED and "image/avif" in accept_header:
        return "AVIF"
    if "image/webp" in accept_header:
        return "WEBP"
    return None


def _resolve_image_format(img, negotiated: Optional[str]) -> str:
    """Falls back to the source image's own format, defaulting to JPEG."""
    if negotiated:
        return negotiated
    src = (img.format or "JPEG").upper()
    return "JPEG" if src == "JPG" else src


# ─────────────────────────────────────────────────────────────────────────────
# Fit Mode Resizers
# ─────────────────────────────────────────────────────────────────────────────


def _apply_contain(img, width: Optional[int], height: Optional[int]):
    """Aspect-ratio-preserving resize — no crop, may letterbox."""
    if width and height:
        img.thumbnail((width, height), Image.Resampling.LANCZOS)
    elif width:
        ratio = width / float(img.size[0])
        img = img.resize(
            (width, max(1, int(img.size[1] * ratio))), Image.Resampling.LANCZOS
        )
    elif height:
        ratio = height / float(img.size[1])
        img = img.resize(
            (max(1, int(img.size[0] * ratio)), height), Image.Resampling.LANCZOS
        )
    return img


def _apply_cover(img, width: Optional[int], height: Optional[int]):
    """Crop-to-fill: resize so the image covers the target box, then center-crop."""
    if not width and not height:
        return img
    target_w = width or img.size[0]
    target_h = height or img.size[1]
    img = ImageOps.fit(img, (target_w, target_h), Image.Resampling.LANCZOS)
    return img


def _apply_fill(img, width: Optional[int], height: Optional[int]):
    """Stretch to exact dimensions — no crop, no letterbox, aspect ratio ignored."""
    if not width and not height:
        return img
    target_w = width or img.size[0]
    target_h = height or img.size[1]
    img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
    return img


def _apply_fit(img, width, height, fit: str):
    """Dispatch to the correct fit mode handler."""
    fit = fit.lower()
    if fit == "cover":
        return _apply_cover(img, width, height)
    if fit == "fill":
        return _apply_fill(img, width, height)
    return _apply_contain(img, width, height)  # default: contain


# ─────────────────────────────────────────────────────────────────────────────
# ETag Generator
# ─────────────────────────────────────────────────────────────────────────────


def _compute_image_etag(
    file_path: str,
    width: Optional[int],
    height: Optional[int],
    quality: int,
    output_format: str,
    fit: str,
) -> str:
    stat = os.stat(file_path)
    key = f"{stat.st_ino}-{stat.st_mtime_ns}-{stat.st_size}-{width}-{height}-{quality}-{output_format}-{fit}"
    return f'W/"{hashlib.md5(key.encode(), usedforsecurity=False).hexdigest()}"'


# ─────────────────────────────────────────────────────────────────────────────
# Streaming Output
# ─────────────────────────────────────────────────────────────────────────────


def _stream_buf(buf: io.BytesIO):
    buf.seek(0)
    try:
        while chunk := buf.read(STREAM_CHUNK):
            yield chunk
    finally:
        buf.close()


# ─────────────────────────────────────────────────────────────────────────────
# Primary Routine
# ─────────────────────────────────────────────────────────────────────────────


def process_image_and_stream(
    file_path: str,
    width: Optional[int] = None,
    height: Optional[int] = None,
    quality: int = 82,
    format: Optional[str] = None,
    fit: str = "contain",
    accept_header: str = "",
    if_none_match: str = "",
) -> Response:
    """
    Resize, convert, and stream an image.

    Parameters
    ----------
    file_path    : Absolute path to the source image.
    width/height : Target dimensions (either, both, or neither).
    quality      : JPEG/WebP/AVIF compression quality (1–100).
    format       : Force output format (jpeg, webp, avif, png, …).
    fit          : 'contain' | 'cover' | 'fill'
    accept_header: Browser Accept header for automatic format negotiation.
    if_none_match: Client ETag for 304 conditional response.
    """
    if not HAS_PIL:
        raise AxiomException(
            ErrorCodes.SERVER_INTERNAL,
            "Image processing requires Pillow. Install with: pip install Pillow",
            501,
        )
    if not os.path.exists(file_path):
        raise AxiomException(
            ErrorCodes.FS_PATH_NOT_FOUND, f"File not found: {file_path}", 404
        )

    quality = max(1, min(100, quality))

    try:
        negotiated = _negotiate_format(accept_header, format)

        with Image.open(file_path) as img:
            # Preserve transparency for PNG/WEBP; convert to RGB for JPEG
            output_format = _resolve_image_format(img, negotiated)

            etag = _compute_image_etag(
                file_path, width, height, quality, output_format, fit
            )
            if if_none_match and if_none_match == etag:
                return Response(status_code=304, headers={"ETag": etag})

            if output_format == "JPEG" and img.mode in ("RGBA", "P", "LA"):
                img = img.convert("RGB")

            img = _apply_fit(img, width, height, fit)

            buf = io.BytesIO()
            save_kwargs: dict = {"format": output_format}
            if output_format not in _LOSSLESS_FORMATS:
                save_kwargs["quality"] = quality
            if output_format in ("JPEG", "PNG", "WEBP"):
                save_kwargs["optimize"] = True

            img.save(buf, **save_kwargs)

        content_length = buf.tell()
        mime = _FORMAT_TO_MIME.get(output_format, f"image/{output_format.lower()}")

        return StreamingResponse(
            _stream_buf(buf),
            status_code=200,
            media_type=mime,
            headers={
                "Content-Length": str(content_length),
                "Cache-Control": "public, max-age=31536000, immutable",
                "X-Content-Type-Options": "nosniff",
                "ETag": etag,
                "Vary": "Accept",
                "Accept-Ranges": "none",
            },
        )

    except AxiomException:
        raise
    except Exception as e:
        raise AxiomException(
            ErrorCodes.SERVER_INTERNAL, f"Image processing failed: {str(e)}", 500
        )
