import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import aiosqlite
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from src.api.errors import AxiomException, ErrorCodes

ph = PasswordHasher(
    time_cost=3,  # Tuned for ~50ms
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
)

AUTH_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    uid              TEXT PRIMARY KEY,
    email            TEXT UNIQUE,
    password_hash    TEXT,
    display_name     TEXT DEFAULT '',
    avatar_url       TEXT DEFAULT '',
    email_verified   INTEGER DEFAULT 0,
    disabled         INTEGER DEFAULT 0,
    is_anonymous     INTEGER DEFAULT 0,
    anonymous_expires_at TEXT,
    totp_secret      TEXT,
    totp_enabled     INTEGER DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    last_sign_in     TEXT,
    sign_in_count    INTEGER DEFAULT 0,
    metadata         TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id           TEXT PRIMARY KEY,
    uid          TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    family_id    TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    revoked      INTEGER DEFAULT 0,
    ip_address   TEXT,
    user_agent   TEXT,
    device_name  TEXT
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    id           TEXT PRIMARY KEY,
    uid          TEXT REFERENCES users(uid) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    token_type   TEXT NOT NULL,
    otp_code     TEXT,
    otp_attempts INTEGER DEFAULT 0,
    expires_at   TEXT NOT NULL,
    used         INTEGER DEFAULT 0,
    resend_count INTEGER DEFAULT 0,
    last_resent_at TEXT,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS totp_backup_codes (
    id           TEXT PRIMARY KEY,
    uid          TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    code_hash    TEXT NOT NULL UNIQUE,
    used         INTEGER DEFAULT 0,
    used_at      TEXT,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_templates (
    type         TEXT PRIMARY KEY,
    subject      TEXT NOT NULL,
    html         TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_jobs (
    id           TEXT PRIMARY KEY,
    status       TEXT DEFAULT 'pending',
    total        INTEGER DEFAULT 0,
    succeeded    INTEGER DEFAULT 0,
    failed       INTEGER DEFAULT 0,
    errors       TEXT DEFAULT '[]',
    created_at   TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_audit (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    uid          TEXT,
    event        TEXT NOT NULL,
    ip_address   TEXT,
    user_agent   TEXT,
    metadata     TEXT DEFAULT '{}',
    created_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email        ON users(email);
CREATE INDEX IF NOT EXISTS        idx_refresh_uid        ON refresh_tokens(uid);
CREATE INDEX IF NOT EXISTS        idx_refresh_family     ON refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS        idx_refresh_expires    ON refresh_tokens(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tokens_hash   ON auth_tokens(token_hash);
CREATE INDEX IF NOT EXISTS        idx_auth_tokens_email  ON auth_tokens(email);
CREATE INDEX IF NOT EXISTS        idx_auth_tokens_type   ON auth_tokens(token_type);
CREATE INDEX IF NOT EXISTS        idx_totp_uid           ON totp_backup_codes(uid);
CREATE INDEX IF NOT EXISTS        idx_audit_uid          ON auth_audit(uid);
CREATE INDEX IF NOT EXISTS        idx_audit_event        ON auth_audit(event);
CREATE INDEX IF NOT EXISTS        idx_audit_created      ON auth_audit(created_at);
"""


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_sha256(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()


class AuthDBManager:
    """Manages SQLite connections per project for auth."""

    def __init__(self, data_dir: str = "./data/auth"):
        self.data_dir = data_dir
        self.conns: Dict[str, aiosqlite.Connection] = {}

    async def get_db(self, project_id: str) -> aiosqlite.Connection:
        if project_id not in self.conns:
            project_dir = os.path.join(self.data_dir, project_id)
            os.makedirs(project_dir, exist_ok=True)
            db_path = os.path.join(project_dir, "auth.db")

            conn = await aiosqlite.connect(db_path)
            conn.row_factory = aiosqlite.Row
            await conn.execute("PRAGMA journal_mode=WAL;")
            await conn.execute("PRAGMA synchronous=NORMAL;")
            await conn.execute("PRAGMA busy_timeout=5000;")

            # Init schema if not exists
            await conn.executescript(AUTH_SCHEMA)
            await conn.commit()

            self.conns[project_id] = conn

        return self.conns[project_id]


auth_db_manager = AuthDBManager()


class UserStore:
    """Provides higher-level abstractions for auth user data."""

    @staticmethod
    def hash_password(password: str) -> str:
        return ph.hash(password)

    @staticmethod
    def verify_password(hashed: str, password: str) -> bool:
        try:
            ph.verify(hashed, password)
            if ph.check_needs_rehash(hashed):
                pass  # Ideally rehash and update DB, but verification succeeded
            return True
        except VerifyMismatchError:
            return False

    @staticmethod
    async def get_user_by_email(
        conn: aiosqlite.Connection, email: str
    ) -> Optional[aiosqlite.Row]:
        async with conn.execute(
            "SELECT * FROM users WHERE email = ?", (email.lower(),)
        ) as cursor:
            return await cursor.fetchone()

    @staticmethod
    async def get_user_by_uid(
        conn: aiosqlite.Connection, uid: str
    ) -> Optional[aiosqlite.Row]:
        async with conn.execute("SELECT * FROM users WHERE uid = ?", (uid,)) as cursor:
            return await cursor.fetchone()

    @staticmethod
    async def create_user(
        conn: aiosqlite.Connection,
        email: str,
        password_hash: Optional[str] = None,
        email_verified: int = 0,
        is_anonymous: int = 0,
    ) -> str:
        uid = str(uuid.uuid7() if hasattr(uuid, "uuid7") else uuid.uuid4())
        now = utc_now_iso()
        try:
            await conn.execute(
                """
                INSERT INTO users (uid, email, password_hash, email_verified, is_anonymous, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    uid,
                    email.lower() if email else None,
                    password_hash,
                    email_verified,
                    is_anonymous,
                    now,
                    now,
                ),
            )
            return uid
        except aiosqlite.IntegrityError:
            raise AxiomException(
                code=ErrorCodes.AUTH_USER_EXISTS,
                message="User with this email already exists",
                status_code=409,
            )

    @staticmethod
    async def update_user(
        conn: aiosqlite.Connection, uid: str, updates: Dict[str, Any]
    ) -> None:
        if not updates:
            return
        updates["updated_at"] = utc_now_iso()
        fields = []
        values = []
        for k, v in updates.items():
            if k == "email" and v:
                v = v.lower()
            fields.append(f"{k} = ?")
            values.append(v)
        values.append(uid)

        query = f"UPDATE users SET {', '.join(fields)} WHERE uid = ?"
        await conn.execute(query, values)

    @staticmethod
    async def log_audit(
        conn: aiosqlite.Connection,
        event: str,
        uid: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        await conn.execute(
            """
            INSERT INTO auth_audit (uid, event, ip_address, user_agent, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                uid,
                event,
                ip_address,
                user_agent,
                json.dumps(metadata or {}),
                utc_now_iso(),
            ),
        )

    @staticmethod
    async def issue_refresh_token(
        conn: aiosqlite.Connection,
        uid: str,
        token_hash: str,
        family_id: str,
        expires_at: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        device_name: Optional[str] = None,
    ) -> None:
        id_val = str(uuid.uuid4())
        await conn.execute(
            """
            INSERT INTO refresh_tokens (id, uid, token_hash, family_id, expires_at, created_at, ip_address, user_agent, device_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                id_val,
                uid,
                token_hash,
                family_id,
                expires_at,
                utc_now_iso(),
                ip_address,
                user_agent,
                device_name,
            ),
        )

    @staticmethod
    async def revoke_refresh_token(conn: aiosqlite.Connection, token_hash: str) -> None:
        await conn.execute(
            "UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?", (token_hash,)
        )

    @staticmethod
    async def revoke_refresh_family(conn: aiosqlite.Connection, family_id: str) -> None:
        await conn.execute(
            "UPDATE refresh_tokens SET revoked = 1 WHERE family_id = ?", (family_id,)
        )

    @staticmethod
    async def revoke_all_sessions(conn: aiosqlite.Connection, uid: str) -> None:
        await conn.execute(
            "UPDATE refresh_tokens SET revoked = 1 WHERE uid = ?", (uid,)
        )

    @staticmethod
    async def get_refresh_token(
        conn: aiosqlite.Connection, token_hash: str
    ) -> Optional[aiosqlite.Row]:
        async with conn.execute(
            "SELECT * FROM refresh_tokens WHERE token_hash = ?", (token_hash,)
        ) as cursor:
            return await cursor.fetchone()

    @staticmethod
    async def record_login(conn: aiosqlite.Connection, uid: str) -> None:
        await conn.execute(
            """
            UPDATE users
            SET last_sign_in = ?, sign_in_count = sign_in_count + 1
            WHERE uid = ?
            """,
            (utc_now_iso(), uid),
        )
