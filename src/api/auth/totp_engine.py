import io
import secrets
import uuid
from typing import Any, List

import pyotp
import qrcode
import qrcode.image.svg

from src.api.auth.user_store import hash_sha256, utc_now_iso


class TOTPEngine:
    """Manages Time-Based One-Time Passwords (TOTP) and backup codes."""

    @staticmethod
    def generate_secret() -> str:
        """Generates a random 160-bit base32 secret."""
        return pyotp.random_base32()

    @staticmethod
    def get_provisioning_uri(secret: str, email: str, issuer: str) -> str:
        """Gets the URI for authenticator apps."""
        return pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)

    @staticmethod
    def generate_qr_code_svg(uri: str) -> str:
        """Generates an SVG QR code from the provisioning URI."""
        factory = qrcode.image.svg.SvgImage
        img = qrcode.make(uri, image_factory=factory)
        stream = io.BytesIO()
        img.save(stream)
        return stream.getvalue().decode("utf-8")

    @staticmethod
    def verify_totp(secret: str, code: str) -> bool:
        """Verifies a TOTP code with a ±1 step tolerance (30 seconds before/after)."""
        totp = pyotp.TOTP(secret)
        return totp.verify(code, valid_window=1)

    @staticmethod
    async def generate_backup_codes(conn: Any, uid: str, count: int = 8) -> List[str]:
        """Generates, hashes, and stores backup codes, replacing any existing ones."""
        # Delete old backup codes for this user
        await conn.execute("DELETE FROM totp_backup_codes WHERE uid = ?", (uid,))

        codes = []
        now = utc_now_iso()
        for _ in range(count):
            # 8 character alphanumeric code
            code = secrets.token_hex(4).upper()
            codes.append(code)

            code_hash = hash_sha256(code)
            id_val = str(uuid.uuid4())
            await conn.execute(
                """
                INSERT INTO totp_backup_codes (id, uid, code_hash, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (id_val, uid, code_hash, now),
            )

        return codes

    @staticmethod
    async def verify_backup_code(conn: Any, uid: str, code: str) -> bool:
        """Verifies and consumes a backup code."""
        code_hash = hash_sha256(code)
        async with conn.execute(
            "SELECT id FROM totp_backup_codes WHERE uid = ? AND code_hash = ? AND used = 0",
            (uid, code_hash),
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                await conn.execute(
                    "UPDATE totp_backup_codes SET used = 1, used_at = ? WHERE id = ?",
                    (utc_now_iso(), row["id"]),
                )
                return True
            return False
