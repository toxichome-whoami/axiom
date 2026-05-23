import asyncio
import hashlib
import os
from typing import Any, Dict, Optional

import aiofiles

from api.errors import AxiomException, ErrorCodes
from cache import CacheManager


class ChunkedUploadManager:
    """Manages multi-part chunked file uploads explicitly routing file operations."""

    @classmethod
    async def _compute_file_hash(cls, file_path: str) -> str:
        """Computes SHA256 checksum natively in a threadpool to prevent blocking the event loop."""

        def _hash():
            sha256_hash = hashlib.sha256()
            with open(file_path, "rb") as f:
                # Use an industrial-grade 4MB buffer for hashing
                while chunk := f.read(4194304):
                    sha256_hash.update(chunk)
            return sha256_hash.hexdigest()

        return await asyncio.to_thread(_hash)

    @classmethod
    def _verify_final_hash(
        cls, final_hash: str, session: dict, target_path: str
    ) -> None:
        """Rejects unverified payloads preventing corruption propagation."""
        if session.get("checksum_sha256") and final_hash != session["checksum_sha256"]:
            if os.path.exists(target_path):
                os.remove(target_path)
            raise AxiomException(
                ErrorCodes.FS_CHECKSUM_MISMATCH,
                "Final file checksum validation failed",
                400,
            )

    # ─────────────────────────────────────────────────────────────────────────────
    # Standard Interface API
    # ─────────────────────────────────────────────────────────────────────────────

    @classmethod
    async def initiate(cls, upload_id: str, data: Dict[str, Any], ttl: int = 3600):
        await CacheManager.set(f"upload:{upload_id}", data, ttl=ttl)
        tmp_dir = os.path.join("./storage", ".tmp")
        os.makedirs(tmp_dir, exist_ok=True)
        part_path = os.path.join(tmp_dir, f"{upload_id}.part")

        # Touch the file so it exists for 'r+b' offset seeking
        def _touch():
            open(part_path, "wb").close()

        await asyncio.to_thread(_touch)

    @classmethod
    async def get_session(cls, upload_id: str) -> Optional[Dict[str, Any]]:
        return await CacheManager.get(f"upload:{upload_id}")

    @classmethod
    async def write_chunk_stream(
        cls, upload_id: str, index: int, chunk_hash: str, file_stream
    ):
        session = await cls.get_session(upload_id)
        if not session:
            raise AxiomException(
                ErrorCodes.FS_UPLOAD_EXPIRED, "Upload session missing or expired", 404
            )

        part_path = os.path.join("./storage", ".tmp", f"{upload_id}.part")
        if not os.path.exists(part_path):
            raise AxiomException(
                ErrorCodes.FS_UPLOAD_INVALID, "Upload part file is missing", 400
            )

        sha256_hash = hashlib.sha256()
        bytes_written = 0
        offset = session["chunk_size"] * index

        async with aiofiles.open(part_path, "r+b") as f:
            await f.seek(offset)
            # Use 1MB buffer to reduce async I/O context switching overhead
            while chunk := await file_stream.read(1048576):
                await f.write(chunk)
                sha256_hash.update(chunk)
                bytes_written += len(chunk)

        if sha256_hash.hexdigest() != chunk_hash:
            raise AxiomException(
                ErrorCodes.FS_CHECKSUM_MISMATCH, "Chunk checksum block corrupted", 400
            )

        session["uploaded_chunks"].append(index)
        session["uploaded_bytes"] += bytes_written
        await CacheManager.set(f"upload:{upload_id}", session, ttl=3600)

    @classmethod
    async def finalize(cls, upload_id: str, target_path: str):
        session = await cls.get_session(upload_id)
        if not session:
            raise AxiomException(
                ErrorCodes.FS_UPLOAD_EXPIRED, "Upload session unavailable", 404
            )

        if len(session["uploaded_chunks"]) < session["total_chunks"]:
            raise AxiomException(
                ErrorCodes.FS_UPLOAD_INVALID, "Incomplete blob sequence detected", 400
            )

        part_path = os.path.join("./storage", ".tmp", f"{upload_id}.part")

        if not os.path.exists(part_path):
            raise AxiomException(
                ErrorCodes.FS_UPLOAD_INVALID, "Missing part file during finalize", 400
            )

        # Zero-copy finalize: Just rename the sparse .part file to its final destination
        os.makedirs(os.path.dirname(target_path), exist_ok=True)

        def _rename():
            if os.path.exists(target_path):
                os.remove(target_path)
            os.rename(part_path, target_path)

        await asyncio.to_thread(_rename)

        await CacheManager.delete(f"upload:{upload_id}")

        final_hash = await cls._compute_file_hash(target_path)
        cls._verify_final_hash(final_hash, session, target_path)

        return {"size": session["total_size"], "checksum_verified": True}

    @classmethod
    async def cancel(cls, upload_id: str):
        part_path = os.path.join("./storage", ".tmp", f"{upload_id}.part")
        if os.path.exists(part_path):
            try:
                os.remove(part_path)
            except OSError:
                pass
        await CacheManager.delete(f"upload:{upload_id}")
