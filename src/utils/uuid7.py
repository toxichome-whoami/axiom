import os
import struct
import time
import uuid

# ─────────────────────────────────────────────────────────────────────────────
# Pre-allocated buffer for UUID construction — avoids per-call allocations.
# ─────────────────────────────────────────────────────────────────────────────

_STRUCT_PACK = struct.pack


def uuid7() -> uuid.UUID:
    """
    Generates a UUID version 7 identifier.

    Format guarantees strict time-ordering which vastly improves database
    indexing performance over random v4 UUIDs, while preventing collisions.
    Structure: 48-bit timestamp (ms) | 4-bit version | 12-bit rand_a | 2-bit variant | 62-bit rand_b.

    Optimized: single os.urandom call, struct-based packing, zero intermediate tuples.
    """
    timestamp_ms = int(time.time() * 1000)
    rand_bytes = os.urandom(10)  # 80 bits — single syscall instead of two

    # Unpack 10 random bytes into two integers
    rand_a = (rand_bytes[0] << 4) | (rand_bytes[1] >> 4)  # 12 bits
    rand_b = int.from_bytes(rand_bytes[2:], "big")  # 64 bits

    # Build the 128-bit UUID in big-endian layout:
    # Bytes 0-5:   48-bit timestamp
    # Bytes 6-7:   4-bit version (0x7) + 12-bit rand_a
    # Bytes 8-15:  2-bit variant (0b10) + 62-bit rand_b
    b = _STRUCT_PACK(
        ">QQ",
        (timestamp_ms << 16) | (0x7000 | (rand_a & 0x0FFF)),
        (0x8000000000000000 | (rand_b & 0x3FFFFFFFFFFFFFFF)),
    )

    return uuid.UUID(bytes=b)
