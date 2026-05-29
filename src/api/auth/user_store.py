import contextvars
import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from sqlalchemy import Column, ForeignKey, Integer, String, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import declarative_base

from src.api.errors import AxiomException, ErrorCodes
from src.config.provider import GlobalConfigProvider

auth_db_ctx: contextvars.ContextVar[list] = contextvars.ContextVar("auth_db_ctx")


ph = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
)

Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    uid = Column(String, primary_key=True)
    email = Column(String, unique=True)
    password_hash = Column(String)
    display_name = Column(String, default="")
    avatar_url = Column(String, default="")
    email_verified = Column(Integer, default=0)
    disabled = Column(Integer, default=0)
    is_anonymous = Column(Integer, default=0)
    anonymous_expires_at = Column(String)
    totp_secret = Column(String)
    totp_enabled = Column(Integer, default=0)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)
    last_sign_in = Column(String)
    sign_in_count = Column(Integer, default=0)
    metadata_ = Column("metadata", String, default="{}")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id = Column(String, primary_key=True)
    uid = Column(
        String, ForeignKey("users.uid", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash = Column(String, nullable=False, unique=True)
    family_id = Column(String, nullable=False, index=True)
    expires_at = Column(String, nullable=False, index=True)
    created_at = Column(String, nullable=False)
    revoked = Column(Integer, default=0)
    ip_address = Column(String)
    user_agent = Column(String)
    device_name = Column(String)


class AuthToken(Base):
    __tablename__ = "auth_tokens"
    id = Column(String, primary_key=True)
    uid = Column(String, ForeignKey("users.uid", ondelete="CASCADE"))
    email = Column(String, nullable=False, index=True)
    token_hash = Column(String, nullable=False, unique=True)
    token_type = Column(String, nullable=False, index=True)
    otp_code = Column(String)
    otp_attempts = Column(Integer, default=0)
    expires_at = Column(String, nullable=False)
    used = Column(Integer, default=0)
    resend_count = Column(Integer, default=0)
    last_resent_at = Column(String)
    created_at = Column(String, nullable=False)


class TotpBackupCode(Base):
    __tablename__ = "totp_backup_codes"
    id = Column(String, primary_key=True)
    uid = Column(
        String, ForeignKey("users.uid", ondelete="CASCADE"), nullable=False, index=True
    )
    code_hash = Column(String, nullable=False, unique=True)
    used = Column(Integer, default=0)
    used_at = Column(String)
    created_at = Column(String, nullable=False)


class WebauthnCredential(Base):
    __tablename__ = "webauthn_credentials"
    id = Column(String, primary_key=True)
    uid = Column(String, ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    public_key = Column(String, nullable=False)
    sign_count = Column(Integer, default=0)
    created_at = Column(String, nullable=False)
    last_used_at = Column(String)


class EmailTemplate(Base):
    __tablename__ = "email_templates"
    type = Column(String, primary_key=True)
    subject = Column(String, nullable=False)
    html = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)


class ImportJob(Base):
    __tablename__ = "import_jobs"
    id = Column(String, primary_key=True)
    status = Column(String, default="pending")
    total = Column(Integer, default=0)
    succeeded = Column(Integer, default=0)
    failed = Column(Integer, default=0)
    errors = Column(String, default="[]")
    created_at = Column(String, nullable=False)
    completed_at = Column(String)


class AuthAudit(Base):
    __tablename__ = "auth_audit"
    id = Column(Integer, primary_key=True, autoincrement=True)
    uid = Column(String, index=True)
    event = Column(String, nullable=False, index=True)
    ip_address = Column(String)
    user_agent = Column(String)
    metadata_ = Column("metadata", String, default="{}")
    created_at = Column(String, nullable=False, index=True)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_sha256(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()


class AxiomCursor:
    def __init__(self, result):
        self.result = result

    @property
    def rowcount(self) -> int:
        return self.result.rowcount

    async def fetchone(self) -> Optional[Dict[str, Any]]:
        row = self.result.fetchone()
        return dict(row._mapping) if row else None

    async def fetchall(self) -> List[Dict[str, Any]]:
        return [dict(row._mapping) for row in self.result.fetchall()]

    def __aiter__(self):
        return self

    async def __anext__(self):
        row = self.result.fetchone()
        if row:
            return dict(row._mapping)
        raise StopAsyncIteration


class AxiomCursorContextManager:
    def __init__(self, session: AsyncSession, sql: str, params: dict):
        self.session = session
        self.sql = sql
        self.params = params
        self.result = None

    def __await__(self):
        return self._execute().__await__()

    async def _execute(self):
        return await self.session.execute(text(self.sql), self.params)

    async def __aenter__(self) -> AxiomCursor:
        self.result = await self._execute()
        return AxiomCursor(self.result)

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass


class AxiomConnection:
    """Wrapper that mimics aiosqlite API but routes queries through SQLAlchemy AsyncSession."""

    def __init__(self, session: AsyncSession):
        self.session = session

    def __del__(self):
        try:
            self.session.sync_session.close()
        except Exception:
            pass

    def _convert_sql(self, sql: str, parameters: tuple) -> Tuple[str, Dict[str, Any]]:
        parts = sql.split("?")
        if len(parts) == 1:
            return sql, {}

        new_sql = ""
        params_dict = {}
        for i in range(len(parts) - 1):
            new_sql += parts[i] + f":p{i}"
            params_dict[f"p{i}"] = parameters[i]
        new_sql += parts[-1]

        return new_sql, params_dict

    def execute(self, sql: str, parameters: tuple = ()) -> AxiomCursorContextManager:
        new_sql, params_dict = self._convert_sql(sql, parameters)
        return AxiomCursorContextManager(self.session, new_sql, params_dict)

    async def commit(self):
        await self.session.commit()

    async def rollback(self):
        await self.session.rollback()

    async def close(self):
        await self.session.close()


class AuthDBManager:
    def __init__(self):
        self.engines = {}

    async def get_db(self, project_id: str) -> AxiomConnection:
        config = GlobalConfigProvider().get_config()
        if project_id not in config.auth.project:
            raise AxiomException(
                ErrorCodes.AUTH_PROJECT_NOT_CONFIGURED,
                f"Project {project_id} not configured",
                400,
            )

        proj_config = config.auth.project[project_id]

        # Determine URL (fallback to sqlite if not defined)
        db_url = getattr(proj_config, "db_url", None)
        if not db_url:
            db_url = f"sqlite+aiosqlite:///data/auth/{project_id}/auth.db"

        if project_id not in self.engines:
            if "sqlite" in db_url:
                db_path = db_url.replace("sqlite+aiosqlite:///", "")
                if "/" in db_path:
                    os.makedirs(os.path.dirname(db_path), exist_ok=True)

            if "sqlite" in db_url:
                from sqlalchemy.pool import NullPool

                engine = create_async_engine(db_url, echo=False, poolclass=NullPool)
            else:
                engine = create_async_engine(db_url, echo=False)

            # Setup pragmas for sqlite
            if "sqlite" in db_url:
                from sqlalchemy import event

                @event.listens_for(engine.sync_engine, "connect")
                def set_sqlite_pragma(dbapi_connection, connection_record):
                    cursor = dbapi_connection.cursor()
                    cursor.execute("PRAGMA journal_mode=WAL")
                    cursor.execute("PRAGMA synchronous=NORMAL")
                    cursor.execute("PRAGMA busy_timeout=5000")
                    cursor.execute("PRAGMA foreign_keys=ON")
                    cursor.close()

            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

            self.engines[project_id] = engine

        session = AsyncSession(self.engines[project_id])
        conn = AxiomConnection(session)

        try:
            ctx_conns = auth_db_ctx.get()
            ctx_conns.append(conn)
        except LookupError:
            pass

        return conn


auth_db_manager = AuthDBManager()


class UserStore:
    """Provides higher-level abstractions for auth user data using the new AxiomConnection layer."""

    @staticmethod
    def hash_password(password: str) -> str:
        return ph.hash(password)

    @staticmethod
    def verify_password(hashed: str, password: str) -> bool:
        try:
            ph.verify(hashed, password)
            return True
        except VerifyMismatchError:
            return False

    @staticmethod
    async def get_user_by_email(
        conn: AxiomConnection, email: str
    ) -> Optional[Dict[str, Any]]:
        async with conn.execute(
            "SELECT * FROM users WHERE email = ?", (email.lower(),)
        ) as cursor:
            return await cursor.fetchone()

    @staticmethod
    async def get_user_by_uid(
        conn: AxiomConnection, uid: str
    ) -> Optional[Dict[str, Any]]:
        async with conn.execute("SELECT * FROM users WHERE uid = ?", (uid,)) as cursor:
            return await cursor.fetchone()

    @staticmethod
    async def create_user(
        conn: AxiomConnection,
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
        except IntegrityError:
            raise AxiomException(
                code=ErrorCodes.AUTH_USER_EXISTS,
                message="User with this email already exists",
                status_code=409,
            )

    @staticmethod
    async def update_user(
        conn: AxiomConnection, uid: str, updates: Dict[str, Any]
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
        await conn.execute(query, tuple(values))

    @staticmethod
    async def log_audit(
        conn: AxiomConnection,
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
        conn: AxiomConnection,
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
    async def revoke_refresh_token(conn: AxiomConnection, token_hash: str) -> None:
        await conn.execute(
            "UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?", (token_hash,)
        )

    @staticmethod
    async def revoke_refresh_family(conn: AxiomConnection, family_id: str) -> None:
        await conn.execute(
            "UPDATE refresh_tokens SET revoked = 1 WHERE family_id = ?", (family_id,)
        )

    @staticmethod
    async def revoke_all_sessions(conn: AxiomConnection, uid: str) -> None:
        await conn.execute(
            "UPDATE refresh_tokens SET revoked = 1 WHERE uid = ?", (uid,)
        )

    @staticmethod
    async def get_refresh_token(
        conn: AxiomConnection, token_hash: str
    ) -> Optional[Dict[str, Any]]:
        async with conn.execute(
            "SELECT * FROM refresh_tokens WHERE token_hash = ?", (token_hash,)
        ) as cursor:
            return await cursor.fetchone()

    @staticmethod
    async def record_login(conn: AxiomConnection, uid: str) -> None:
        await conn.execute(
            """
            UPDATE users
            SET last_sign_in = ?, sign_in_count = sign_in_count + 1
            WHERE uid = ?
            """,
            (utc_now_iso(), uid),
        )
