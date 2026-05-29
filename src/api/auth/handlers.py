import base64
import ipaddress
import json
import secrets
import time
import uuid
from typing import Any, Dict, List, Tuple

import aiosqlite
from fastapi import Request

from src.api.auth.brute_force import BruteForceProtector
from src.api.auth.email_transport import EmailTransport
from src.api.auth.import_export import AuthImportExport
from src.api.auth.rate_limiter import auth_rate_limiter
from src.api.auth.schemas import (
    AdminUpdateUserRequest,
    ChangeEmailRequest,
    ConfirmEmailChangeRequest,
    ForgotPasswordRequest,
    ImportUsersRequest,
    LoginRequest,
    LogoutRequest,
    MagicLinkRequest,
    OtpSendRequest,
    RefreshRequest,
    ResendRequest,
    ResetPasswordRequest,
    SignupRequest,
    TemplateRequest,
    TotpBackupVerifyRequest,
    TotpConfirmRequest,
    TotpDisableRequest,
    TotpVerifyRequest,
    UpdatePasswordRequest,
    UpdateUserRequest,
    VerifyEmailRequest,
    VerifyOtpRequest,
)
from src.api.auth.template_store import TemplateStore
from src.api.auth.token_engine import token_engine
from src.api.auth.totp_engine import TOTPEngine
from src.api.auth.user_store import UserStore, auth_db_manager, hash_sha256, utc_now_iso
from src.api.auth.webhook_emitter import AuthWebhookEmitter
from src.api.errors import AxiomException, ErrorCodes
from src.config.provider import GlobalConfigProvider


def _get_project(request: Request) -> Tuple[str, Any]:
    api_key_b64 = (
        request.headers.get("X-Api-Key")
        or request.headers.get("X-Axiom-Key")
        or request.query_params.get("key")
    )
    if not api_key_b64:
        raise AxiomException(ErrorCodes.AUTH_MISSING_HEADER, "Missing API Key", 401)

    try:
        decoded = base64.b64decode(api_key_b64).decode("utf-8")
        if ":" not in decoded:
            raise ValueError("Invalid format")
        key_name, key_secret = decoded.split(":", 1)
    except Exception:
        raise AxiomException(
            ErrorCodes.AUTH_INVALID_FORMAT, "Invalid API Key format", 401
        )

    config = GlobalConfigProvider().get_config()
    if not config.features.auth:
        raise AxiomException(
            ErrorCodes.AUTH_INSUFFICIENT_MODE, "Auth module is disabled", 403
        )

    # Verify the secret
    key_config = config.api_key.get(key_name)
    if not key_config or key_config.secret != key_secret:
        raise AxiomException(
            ErrorCodes.AUTH_INVALID_SECRET, "Invalid API Key secret", 401
        )

    project_config = config.auth.project.get(key_name)
    if not project_config:
        raise AxiomException(
            ErrorCodes.AUTH_PROJECT_NOT_CONFIGURED,
            f"Auth not configured for key {key_name}",
            403,
        )

    return key_name, project_config


def _validate_password(password: str, config: Any) -> None:
    """Enforce the project's password policy."""
    if len(password) < config.min_password_length:
        raise AxiomException(
            ErrorCodes.AUTH_WEAK_PASSWORD,
            f"Password must be at least {config.min_password_length} characters",
            400,
        )
    if config.require_uppercase and not any(c.isupper() for c in password):
        raise AxiomException(
            ErrorCodes.AUTH_WEAK_PASSWORD,
            "Password must contain at least one uppercase letter",
            400,
        )
    if config.require_number and not any(c.isdigit() for c in password):
        raise AxiomException(
            ErrorCodes.AUTH_WEAK_PASSWORD,
            "Password must contain at least one number",
            400,
        )
    if config.require_symbol and not any(
        c in "!@#$%^&*()_+-=[]{}|;':,.<>?/`~" for c in password
    ):
        raise AxiomException(
            ErrorCodes.AUTH_WEAK_PASSWORD,
            "Password must contain at least one special character",
            400,
        )


def _check_ip_allowlist(ip: str, config: Any) -> None:
    """Block logins from IPs not in the allowlist (when allowlist is non-empty)."""
    if not config.ip_allowlist:
        return
    try:
        client_addr = ipaddress.ip_address(ip)
        for entry in config.ip_allowlist:
            network = ipaddress.ip_network(entry, strict=False)
            if client_addr in network:
                return
    except ValueError:
        pass
    raise AxiomException(
        ErrorCodes.AUTH_RATE_LIMITED,
        "Login not permitted from this IP address",
        403,
    )


def _get_ip(request: Request) -> str:
    return request.client.host if request.client else "127.0.0.1"


def _get_user_agent(request: Request) -> str:
    return request.headers.get("User-Agent", "Unknown")


def _get_bearer_token(request: Request) -> str:
    auth = request.headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        raise AxiomException(
            ErrorCodes.AUTH_MISSING_HEADER, "Missing Bearer token", 401
        )
    return auth[7:]


async def _get_current_user(request: Request) -> Tuple[str, Any, Dict[str, Any]]:
    project_id, config = _get_project(request)
    token = _get_bearer_token(request)
    payload = token_engine.verify_access_token(token, project_id)
    return project_id, config, payload


async def _create_auth_response(
    conn: aiosqlite.Connection,
    config: Any,
    project_id: str,
    row: Any,
    ip: str,
    user_agent: str,
) -> Dict[str, Any]:
    uid = row["uid"]
    email = row["email"]

    custom_claims = {}
    if config.jwt_custom_claims and row["metadata"]:
        meta = json.loads(row["metadata"])
        for claim in config.jwt_custom_claims:
            if claim in meta:
                custom_claims[claim] = meta[claim]

    access_token = token_engine.create_access_token(
        project_id=project_id,
        uid=uid,
        email=email or "",
        email_verified=bool(row["email_verified"]),
        is_anonymous=bool(row["is_anonymous"]),
        totp_verified=False,
        ttl=config.access_token_ttl,
        custom_claims=custom_claims,
    )

    refresh_token = token_engine.generate_refresh_token()
    token_hash = hash_sha256(refresh_token)
    family_id = str(uuid.uuid4())

    if (
        getattr(config, "new_device_alerts", False)
        and not bool(row["is_anonymous"])
        and email
    ):
        async with conn.execute(
            "SELECT COUNT(*) FROM refresh_tokens WHERE uid = ? AND ip_address = ?",
            (uid, ip),
        ) as cursor:
            count_row = await cursor.fetchone()
            count = count_row[0] if count_row else 0
            if count == 0:
                await EmailTransport.send_email(
                    conn,
                    config.email,
                    "new_device_login",
                    email,
                    {
                        "{{.AppName}}": "Axiom",
                        "{{.UserEmail}}": email,
                        "{{.IpAddress}}": ip,
                        "{{.UserAgent}}": user_agent,
                        "{{.Time}}": utc_now_iso(),
                    },
                )

    expires_at = datetime_to_iso(time.time() + config.refresh_token_ttl)
    await UserStore.issue_refresh_token(
        conn, uid, token_hash, family_id, expires_at, ip, user_agent
    )

    await UserStore.record_login(conn, uid)
    await conn.commit()

    user_dict: Dict[str, Any] = dict(row)  # type: ignore
    if "password_hash" in user_dict:
        del user_dict["password_hash"]
    if "totp_secret" in user_dict:
        del user_dict["totp_secret"]
    if user_dict.get("metadata"):
        user_dict["metadata"] = json.loads(user_dict["metadata"])

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": config.access_token_ttl,
        "user": user_dict,
    }


def datetime_to_iso(ts: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


async def signup(request: Request, body: SignupRequest) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    ip = _get_ip(request)

    auth_rate_limiter.check_ip_signup(ip, config)
    _validate_password(body.password, config)

    conn = await auth_db_manager.get_db(project_id)

    try:
        uid = await UserStore.create_user(
            conn, email=body.email, password_hash=UserStore.hash_password(body.password)
        )
        await UserStore.update_user(
            conn,
            uid,
            {
                "display_name": body.display_name or "",
                "avatar_url": body.avatar_url or "",
            },
        )

        auth_rate_limiter.record_ip_signup(ip)
        await UserStore.log_audit(conn, "signup", uid, ip, _get_user_agent(request))
        await conn.commit()

        await AuthWebhookEmitter.emit(
            config, project_id, "signup", uid, body.email, ip, _get_user_agent(request)
        )

        # Send verification email if required
        if config.email_verification:
            await _send_verification(conn, config, body.email, uid)

        row = await UserStore.get_user_by_uid(conn, uid)
        return await _create_auth_response(
            conn, config, project_id, row, ip, _get_user_agent(request)
        )

    except Exception as e:
        await conn.rollback()
        raise e


async def _send_verification(
    conn: aiosqlite.Connection, config: Any, email: str, uid: str
) -> None:
    token = secrets.token_urlsafe(32)
    token_hash = hash_sha256(token)
    otp = None

    if config.verification_method == "otp":
        otp = secrets.token_hex(3).upper()  # 6 chars
        # Avoid collisions on UNIQUE token_hash for OTP
        token_hash = hash_sha256(secrets.token_urlsafe(32))

    expires_at = datetime_to_iso(time.time() + config.verification_ttl)

    id_val = str(uuid.uuid4())
    await conn.execute(
        """
        INSERT INTO auth_tokens (id, uid, email, token_hash, token_type, otp_code, expires_at, created_at)
        VALUES (?, ?, ?, ?, 'email_verify', ?, ?, ?)
        """,
        (id_val, uid, email, token_hash, otp, expires_at, utc_now_iso()),
    )
    await conn.commit()

    # Fire email
    placeholders = {}
    tmpl_type = "email_verify"
    if otp:
        placeholders["{{.Code}}"] = otp
        tmpl_type = "email_verify_otp"
    else:
        placeholders["{{.Link}}"] = f"{config.callback_url}?token={token}&type=verify"

    await EmailTransport.send_email(conn, config.email, tmpl_type, email, placeholders)


async def login(request: Request, body: LoginRequest) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    ip = _get_ip(request)
    ua = _get_user_agent(request)

    BruteForceProtector.check_and_record(
        action="login",
        project_id=project_id,
        ip_address=ip,
        max_attempts=getattr(config, "max_login_attempts", 5),
        window_seconds=300,
        lockout_duration=getattr(config, "lockout_duration", 300),
    )

    _check_ip_allowlist(ip, config)
    auth_rate_limiter.check_login_lockout(body.email, config)

    conn = await auth_db_manager.get_db(project_id)
    row = await UserStore.get_user_by_email(conn, body.email)

    if not row or row["disabled"]:
        auth_rate_limiter.record_failed_login(body.email, config)
        await UserStore.log_audit(
            conn,
            "login_failed",
            row["uid"] if row else None,
            _get_ip(request),
            _get_user_agent(request),
        )
        raise AxiomException(
            ErrorCodes.AUTH_INVALID_CREDENTIALS, "Invalid credentials", 401
        )

    assert row is not None
    if not row["password_hash"] or not UserStore.verify_password(
        row["password_hash"], body.password
    ):
        auth_rate_limiter.record_failed_login(body.email, config)
        await UserStore.log_audit(
            conn,
            "login_failed",
            row["uid"],
            _get_ip(request),
            _get_user_agent(request),
            {"reason": "invalid_credentials"},
        )
        await conn.commit()
        raise AxiomException(
            ErrorCodes.AUTH_INVALID_CREDENTIALS, "Invalid email or password", 401
        )

    if row["disabled"]:
        raise AxiomException(
            ErrorCodes.AUTH_ACCOUNT_DISABLED, "Account is disabled", 403
        )

    BruteForceProtector.reset(action="login", project_id=project_id, ip_address=ip)
    auth_rate_limiter.record_successful_login(body.email)
    await UserStore.log_audit(conn, "login_success", row["uid"], ip, ua)
    await AuthWebhookEmitter.emit(
        config, project_id, "login", row["uid"], body.email, ip, ua
    )

    if row["totp_enabled"]:
        mfa_token = token_engine.create_access_token(
            project_id=project_id,
            uid=row["uid"],
            email=row["email"] or "",
            email_verified=bool(row["email_verified"]),
            is_anonymous=bool(row["is_anonymous"]),
            totp_verified=False,
            ttl=300,
            custom_claims={"mfa_pending": True},
        )
        await conn.commit()
        return {"mfa_required": True, "mfa_token": mfa_token}

    return await _create_auth_response(conn, config, project_id, row, ip, ua)


async def refresh(request: Request, body: RefreshRequest) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    ip = _get_ip(request)
    ua = _get_user_agent(request)

    token_hash = hash_sha256(body.refresh_token)

    conn = await auth_db_manager.get_db(project_id)
    token_row = await UserStore.get_refresh_token(conn, token_hash)

    if not token_row:
        raise AxiomException(
            ErrorCodes.AUTH_TOKEN_INVALID, "Invalid refresh token", 401
        )

    if token_row["revoked"]:
        # Family revocation: token reuse detected!
        await UserStore.revoke_refresh_family(conn, token_row["family_id"])
        await UserStore.log_audit(
            conn,
            "refresh_reuse_detected",
            token_row["uid"],
            ip,
            ua,
            {"family": token_row["family_id"]},
        )
        await conn.commit()
        raise AxiomException(
            ErrorCodes.AUTH_TOKEN_STOLEN,
            "Token reuse detected. All sessions revoked.",
            401,
        )

    # Check expiry
    from datetime import datetime, timezone

    if datetime.fromisoformat(token_row["expires_at"]) < datetime.now(timezone.utc):
        raise AxiomException(
            ErrorCodes.AUTH_TOKEN_EXPIRED, "Refresh token expired", 401
        )

    user_row = await UserStore.get_user_by_uid(conn, token_row["uid"])
    if not user_row or user_row["disabled"]:
        raise AxiomException(
            ErrorCodes.AUTH_ACCOUNT_DISABLED, "Account disabled or deleted", 403
        )

    # Revoke old token
    await UserStore.revoke_refresh_token(conn, token_hash)

    # Issue new token in same family
    new_refresh = token_engine.generate_refresh_token()
    new_hash = hash_sha256(new_refresh)

    expires_at = datetime_to_iso(time.time() + config.refresh_token_ttl)
    await UserStore.issue_refresh_token(
        conn, user_row["uid"], new_hash, token_row["family_id"], expires_at, ip, ua
    )

    await UserStore.log_audit(conn, "refresh_success", user_row["uid"], ip, ua)
    await conn.commit()

    custom_claims = {}
    if config.jwt_custom_claims and user_row["metadata"]:
        meta = json.loads(user_row["metadata"])
        for claim in config.jwt_custom_claims:
            if claim in meta:
                custom_claims[claim] = meta[claim]

    access_token = token_engine.create_access_token(
        project_id=project_id,
        uid=user_row["uid"],
        email=user_row["email"] or "",
        email_verified=bool(user_row["email_verified"]),
        is_anonymous=bool(user_row["is_anonymous"]),
        totp_verified=False,
        ttl=config.access_token_ttl,
        custom_claims=custom_claims,
    )

    user_dict: Dict[str, Any] = dict(user_row)  # type: ignore
    if "password_hash" in user_dict:
        del user_dict["password_hash"]
    if "totp_secret" in user_dict:
        del user_dict["totp_secret"]
    if user_dict.get("metadata"):
        user_dict["metadata"] = json.loads(user_dict["metadata"])

    return {
        "access_token": access_token,
        "refresh_token": new_refresh,
        "expires_in": config.access_token_ttl,
        "user": user_dict,
    }


async def logout(request: Request, body: LogoutRequest) -> Dict[str, str]:
    project_id, config, payload = await _get_current_user(request)
    uid = payload["sub"]
    ip = _get_ip(request)
    ua = _get_user_agent(request)

    conn = await auth_db_manager.get_db(project_id)
    token_hash = hash_sha256(body.refresh_token)
    await conn.execute(
        "UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ? AND uid = ?",
        (token_hash, uid),
    )
    await UserStore.log_audit(conn, "logout", uid, ip, ua)
    await conn.commit()

    await AuthWebhookEmitter.emit(
        config, project_id, "logout", uid, payload.get("email"), ip, ua
    )
    return {"status": "ok"}


async def revoke_all_sessions_self(request: Request) -> Dict[str, str]:
    """DELETE /user/sessions — revokes all active sessions (logout everywhere)."""
    project_id, config, payload = await _get_current_user(request)
    uid = payload["sub"]
    ip = _get_ip(request)
    ua = _get_user_agent(request)

    conn = await auth_db_manager.get_db(project_id)
    await UserStore.revoke_all_sessions(conn, uid)
    await UserStore.log_audit(conn, "session_revoked_all", uid, ip, ua)
    await conn.commit()

    await AuthWebhookEmitter.emit(
        config, project_id, "logout", uid, payload.get("email"), ip, ua
    )
    return {"status": "ok"}


async def get_sessions(request: Request) -> List[Dict[str, Any]]:
    project_id, config, payload = await _get_current_user(request)
    uid = payload["sub"]

    conn = await auth_db_manager.get_db(project_id)
    async with conn.execute(
        "SELECT id, family_id, ip_address, user_agent, device_name, created_at, expires_at FROM refresh_tokens WHERE uid = ? AND revoked = 0",
        (uid,),
    ) as cursor:
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def revoke_session(request: Request, session_id: str) -> Dict[str, str]:
    project_id, config, payload = await _get_current_user(request)
    uid = payload["sub"]

    conn = await auth_db_manager.get_db(project_id)
    async with conn.execute(
        "SELECT id FROM refresh_tokens WHERE id = ? AND uid = ?", (session_id, uid)
    ) as cursor:
        if not await cursor.fetchone():
            raise AxiomException(ErrorCodes.DB_NOT_FOUND, "Session not found", 404)

    await conn.execute(
        "UPDATE refresh_tokens SET revoked = 1 WHERE id = ?", (session_id,)
    )
    await conn.commit()
    return {"status": "ok"}


async def anonymous_login(request: Request) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    if not config.anonymous_auth:
        raise AxiomException(
            ErrorCodes.AUTH_INSUFFICIENT_MODE, "Anonymous auth disabled", 403
        )

    conn = await auth_db_manager.get_db(project_id)
    uid = str(uuid.uuid7() if hasattr(uuid, "uuid7") else uuid.uuid4())
    now = utc_now_iso()
    expires_at = datetime_to_iso(time.time() + config.anonymous_upgrade_ttl)

    await conn.execute(
        """
        INSERT INTO users (uid, is_anonymous, anonymous_expires_at, created_at, updated_at)
        VALUES (?, 1, ?, ?, ?)
        """,
        (uid, expires_at, now, now),
    )
    await conn.commit()

    row = await UserStore.get_user_by_uid(conn, uid)
    return await _create_auth_response(
        conn, config, project_id, row, _get_ip(request), _get_user_agent(request)
    )


async def upgrade_anonymous(request: Request, body: SignupRequest) -> Dict[str, Any]:
    project_id, config, payload = await _get_current_user(request)
    if not payload.get("is_anonymous"):
        raise AxiomException(
            ErrorCodes.INPUT_VALUE_INVALID, "User is not anonymous", 400
        )

    uid = payload["sub"]
    conn = await auth_db_manager.get_db(project_id)

    try:
        await conn.execute(
            """
            UPDATE users SET
            email = ?, password_hash = ?, display_name = ?, avatar_url = ?,
            is_anonymous = 0, anonymous_expires_at = NULL, updated_at = ?
            WHERE uid = ?
            """,
            (
                body.email.lower(),
                UserStore.hash_password(body.password),
                body.display_name or "",
                body.avatar_url or "",
                utc_now_iso(),
                uid,
            ),
        )
        await conn.commit()
    except aiosqlite.IntegrityError:
        raise AxiomException(ErrorCodes.AUTH_USER_EXISTS, "Email already in use", 409)

    await AuthWebhookEmitter.emit(
        config,
        project_id,
        "signup",
        uid,
        body.email,
        _get_ip(request),
        _get_user_agent(request),
    )

    if config.email_verification:
        await _send_verification(conn, config, body.email, uid)

    row = await UserStore.get_user_by_uid(conn, uid)
    return await _create_auth_response(
        conn, config, project_id, row, _get_ip(request), _get_user_agent(request)
    )


async def verify_email(request: Request, body: VerifyEmailRequest) -> Dict[str, str]:
    project_id, config = _get_project(request)
    conn = await auth_db_manager.get_db(project_id)
    token_hash = hash_sha256(body.token)

    async with conn.execute(
        "SELECT uid, expires_at, used FROM auth_tokens WHERE token_hash = ? AND token_type = 'email_verify'",
        (token_hash,),
    ) as cursor:
        row = await cursor.fetchone()

    if not row or row["used"]:
        raise AxiomException(
            ErrorCodes.AUTH_TOKEN_INVALID, "Invalid or used token", 400
        )

    from datetime import datetime, timezone

    if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
        raise AxiomException(ErrorCodes.AUTH_TOKEN_EXPIRED, "Token expired", 400)

    await conn.execute(
        "UPDATE users SET email_verified = 1 WHERE uid = ?", (row["uid"],)
    )
    await conn.execute(
        "UPDATE auth_tokens SET used = 1 WHERE token_hash = ?", (token_hash,)
    )
    await conn.commit()
    return {"status": "ok"}


async def verify_email_get(request: Request, token: str) -> Dict[str, str]:
    project_id, config = _get_project(request)
    conn = await auth_db_manager.get_db(project_id)
    token_hash = hash_sha256(token)

    async with conn.execute(
        "SELECT uid, expires_at, used FROM auth_tokens WHERE token_hash = ? AND token_type = 'email_verify'",
        (token_hash,),
    ) as cursor:
        row = await cursor.fetchone()

    if not row or row["used"]:
        raise AxiomException(
            ErrorCodes.AUTH_TOKEN_INVALID, "Invalid or used token", 400
        )

    from datetime import datetime, timezone

    if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
        raise AxiomException(ErrorCodes.AUTH_TOKEN_EXPIRED, "Token expired", 400)

    await conn.execute(
        "UPDATE users SET email_verified = 1 WHERE uid = ?", (row["uid"],)
    )
    await conn.execute(
        "UPDATE auth_tokens SET used = 1 WHERE token_hash = ?", (token_hash,)
    )
    await conn.commit()
    # In a real app we'd redirect, but returning json for API
    return {"status": "ok", "message": "Email verified successfully"}


async def verify_otp(request: Request, body: VerifyOtpRequest) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    _check_ip_allowlist(_get_ip(request), config)
    conn = await auth_db_manager.get_db(project_id)

    async with conn.execute(
        "SELECT * FROM auth_tokens WHERE email = ? AND token_type = 'email_verify' ORDER BY created_at DESC LIMIT 1",
        (body.email.lower(),),
    ) as cursor:
        row = await cursor.fetchone()

    if not row:
        raise AxiomException(
            ErrorCodes.AUTH_OTP_INVALID, "No pending verification found", 400
        )

    if row["used"]:
        raise AxiomException(ErrorCodes.AUTH_OTP_INVALID, "Code already used", 400)

    if row["otp_attempts"] >= config.max_otp_attempts:
        raise AxiomException(
            ErrorCodes.AUTH_RATE_LIMITED,
            "Too many attempts. Please request a new code.",
            429,
        )

    from datetime import datetime, timezone

    if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
        raise AxiomException(ErrorCodes.AUTH_TOKEN_EXPIRED, "Code expired", 400)

    if row["otp_code"] != body.code:
        await conn.execute(
            "UPDATE auth_tokens SET otp_attempts = otp_attempts + 1 WHERE id = ?",
            (row["id"],),
        )
        await conn.commit()
        raise AxiomException(
            ErrorCodes.AUTH_OTP_INVALID,
            f"Invalid code (attempts: {row['otp_attempts'] + 1}/{config.max_otp_attempts})",
            400,
        )

    await conn.execute(
        "UPDATE users SET email_verified = 1 WHERE uid = ?", (row["uid"],)
    )
    await conn.execute("UPDATE auth_tokens SET used = 1 WHERE id = ?", (row["id"],))
    await conn.commit()

    user_row = await UserStore.get_user_by_uid(conn, row["uid"])
    return await _create_auth_response(
        conn, config, project_id, user_row, _get_ip(request), _get_user_agent(request)
    )


async def otp_send(request: Request, body: OtpSendRequest) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    conn = await auth_db_manager.get_db(project_id)
    row = await UserStore.get_user_by_email(conn, body.email)
    if not row or row["disabled"]:
        return {"status": "ok", "expires_in": 600}

    await _send_verification(conn, config, body.email, row["uid"])
    return {"status": "ok", "expires_in": config.verification_ttl}


async def resend(request: Request, body: ResendRequest) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    conn = await auth_db_manager.get_db(project_id)
    row = await UserStore.get_user_by_email(conn, body.email)
    if not row or row["disabled"]:
        return {"retry_after": 60}

    async with conn.execute(
        "SELECT * FROM auth_tokens WHERE email = ? AND token_type = ? AND used = 0 ORDER BY created_at DESC LIMIT 1",
        (body.email.lower(), body.type),
    ) as cursor:
        token_row = await cursor.fetchone()

    if not token_row:
        raise AxiomException(
            ErrorCodes.DB_NOT_FOUND, "No pending token found, please restart flow", 404
        )

    now = time.time()
    from datetime import datetime, timezone

    last_resent_ts = (
        datetime.fromisoformat(token_row["last_resent_at"] or token_row["created_at"])
        .replace(tzinfo=timezone.utc)
        .timestamp()
    )

    cooldown = getattr(config, "resend_cooldown", 60)
    if now - last_resent_ts < cooldown:
        raise AxiomException(ErrorCodes.AUTH_RATE_LIMITED, "Too soon", 429)

    max_resends = getattr(config, "resend_max_per_hour", 5)
    if token_row["resend_count"] >= max_resends:
        raise AxiomException(
            ErrorCodes.AUTH_RATE_LIMITED, "Too many resends. Please restart flow.", 429
        )

    new_expires = datetime_to_iso(
        time.time()
        + (
            config.magic_link_ttl
            if body.type == "magic_link"
            else config.verification_ttl
        )
    )

    if body.type == "otp" or body.type == "email_verify":
        new_code = secrets.token_hex(3).upper() if body.type == "otp" else None
        new_token = (
            secrets.token_urlsafe(32) if not new_code else secrets.token_urlsafe(32)
        )
        new_hash = hash_sha256(new_token)

        await conn.execute(
            "UPDATE auth_tokens SET otp_code = ?, token_hash = ?, resend_count = resend_count + 1, last_resent_at = ?, expires_at = ? WHERE id = ?",
            (new_code, new_hash, utc_now_iso(), new_expires, token_row["id"]),
        )

        tmpl_type = "email_verify_otp" if body.type == "otp" else "email_verify"
        placeholders = (
            {"{{.Code}}": new_code}
            if body.type == "otp"
            else {"{{.Link}}": f"{config.callback_url}?token={new_token}&type=verify"}
        )
        await EmailTransport.send_email(
            conn, config.email, tmpl_type, body.email, placeholders
        )

    elif body.type == "magic_link":
        new_token = secrets.token_urlsafe(32)
        new_hash = hash_sha256(new_token)
        await conn.execute(
            "UPDATE auth_tokens SET token_hash = ?, resend_count = resend_count + 1, last_resent_at = ?, expires_at = ? WHERE id = ?",
            (new_hash, utc_now_iso(), new_expires, token_row["id"]),
        )
        await EmailTransport.send_email(
            conn,
            config.email,
            "magic_link",
            body.email,
            {"{{.Link}}": f"{config.callback_url}?token={new_token}&type=magic_link"},
        )

    await conn.commit()
    return {"status": "ok", "retry_after": cooldown}


async def forgot_password(
    request: Request, body: ForgotPasswordRequest
) -> Dict[str, str]:
    project_id, config = _get_project(request)
    conn = await auth_db_manager.get_db(project_id)

    row = await UserStore.get_user_by_email(conn, body.email)
    if not row or row["disabled"]:
        return {"status": "ok"}  # Don't leak user existence

    token = secrets.token_urlsafe(32)
    token_hash = hash_sha256(token)
    expires_at = datetime_to_iso(time.time() + config.password_reset_ttl)

    await conn.execute(
        "INSERT INTO auth_tokens (id, uid, email, token_hash, token_type, expires_at, created_at) VALUES (?, ?, ?, ?, 'password_reset', ?, ?)",
        (
            str(uuid.uuid4()),
            row["uid"],
            body.email,
            token_hash,
            expires_at,
            utc_now_iso(),
        ),
    )
    await conn.commit()

    link = f"{config.callback_url}?token={token}&type=reset_password"
    await EmailTransport.send_email(
        conn, config.email, "password_reset", body.email, {"{{.Link}}": link}
    )
    return {"status": "ok"}


async def reset_password(
    request: Request, body: ResetPasswordRequest
) -> Dict[str, str]:
    project_id, config = _get_project(request)
    conn = await auth_db_manager.get_db(project_id)
    token_hash = hash_sha256(body.token)

    async with conn.execute(
        "SELECT uid, expires_at, used FROM auth_tokens WHERE token_hash = ? AND token_type = 'password_reset'",
        (token_hash,),
    ) as cursor:
        row = await cursor.fetchone()

    if not row or row["used"]:
        raise AxiomException(
            ErrorCodes.AUTH_TOKEN_INVALID, "Invalid or used token", 400
        )

    from datetime import datetime, timezone

    if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
        raise AxiomException(ErrorCodes.AUTH_TOKEN_EXPIRED, "Token expired", 400)

    _validate_password(body.new_password, config)

    await conn.execute(
        "UPDATE users SET password_hash = ? WHERE uid = ?",
        (UserStore.hash_password(body.new_password), row["uid"]),
    )
    await conn.execute(
        "UPDATE auth_tokens SET used = 1 WHERE token_hash = ?", (token_hash,)
    )
    # Revoke all sessions on password reset
    await UserStore.revoke_all_sessions(conn, row["uid"])
    await conn.commit()

    await AuthWebhookEmitter.emit(
        config, project_id, "password_reset", row["uid"], ip_address=_get_ip(request)
    )
    return {"status": "ok"}


async def magic_link(request: Request, body: MagicLinkRequest) -> Dict[str, str]:
    project_id, config = _get_project(request)
    conn = await auth_db_manager.get_db(project_id)

    row = await UserStore.get_user_by_email(conn, body.email)
    if not row or row["disabled"]:
        return {"status": "ok"}  # Don't leak user existence

    token = secrets.token_urlsafe(32)
    token_hash = hash_sha256(token)
    expires_at = datetime_to_iso(time.time() + config.magic_link_ttl)

    await conn.execute(
        "INSERT INTO auth_tokens (id, uid, email, token_hash, token_type, expires_at, created_at) VALUES (?, ?, ?, ?, 'magic_link', ?, ?)",
        (
            str(uuid.uuid4()),
            row["uid"],
            body.email,
            token_hash,
            expires_at,
            utc_now_iso(),
        ),
    )
    await conn.commit()

    link = f"{config.callback_url}?token={token}&type=magic_link"
    await EmailTransport.send_email(
        conn, config.email, "magic_link", body.email, {"{{.Link}}": link}
    )
    return {"status": "ok"}


async def magic_link_verify(
    request: Request, body: VerifyEmailRequest
) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    _check_ip_allowlist(_get_ip(request), config)
    conn = await auth_db_manager.get_db(project_id)
    token_hash = hash_sha256(body.token)

    async with conn.execute(
        "SELECT uid, expires_at, used FROM auth_tokens WHERE token_hash = ? AND token_type = 'magic_link'",
        (token_hash,),
    ) as cursor:
        row = await cursor.fetchone()

    if not row or row["used"]:
        raise AxiomException(
            ErrorCodes.AUTH_TOKEN_INVALID, "Invalid or used token", 400
        )

    from datetime import datetime, timezone

    if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
        raise AxiomException(ErrorCodes.AUTH_TOKEN_EXPIRED, "Token expired", 400)

    await conn.execute(
        "UPDATE auth_tokens SET used = 1 WHERE token_hash = ?", (token_hash,)
    )
    await conn.commit()

    user_row = await UserStore.get_user_by_uid(conn, row["uid"])
    assert user_row is not None

    auth_rate_limiter.record_successful_login(user_row["email"])
    await UserStore.log_audit(
        conn, "magic_link_login", row["uid"], _get_ip(request), _get_user_agent(request)
    )
    await AuthWebhookEmitter.emit(
        config,
        project_id,
        "login",
        row["uid"],
        user_row["email"],
        _get_ip(request),
        _get_user_agent(request),
    )

    return await _create_auth_response(
        conn, config, project_id, user_row, _get_ip(request), _get_user_agent(request)
    )


async def totp_enroll(request: Request) -> Dict[str, Any]:
    project_id, config, payload = await _get_current_user(request)
    if not config.totp_enabled:
        raise AxiomException(ErrorCodes.AUTH_INSUFFICIENT_MODE, "TOTP is disabled", 403)

    uid = payload["sub"]
    email = payload.get("email") or "user"

    secret = TOTPEngine.generate_secret()
    uri = TOTPEngine.get_provisioning_uri(secret, email, config.totp_issuer)
    svg = TOTPEngine.generate_qr_code_svg(uri)

    conn = await auth_db_manager.get_db(project_id)
    await conn.execute("UPDATE users SET totp_secret = ? WHERE uid = ?", (secret, uid))
    await conn.commit()

    return {"secret": secret, "qr_code_svg": svg}


async def totp_verify(request: Request, body: TotpVerifyRequest) -> Dict[str, Any]:
    project_id, config, payload = await _get_current_user(request)
    uid = payload["sub"]

    conn = await auth_db_manager.get_db(project_id)
    row = await UserStore.get_user_by_uid(conn, uid)

    assert row is not None
    if not row or not row["totp_secret"]:
        raise AxiomException(ErrorCodes.INPUT_VALUE_INVALID, "TOTP not enrolled", 400)

    is_valid = TOTPEngine.verify_totp(row["totp_secret"], body.code)

    if not is_valid:
        # Check backup codes
        is_valid = await TOTPEngine.verify_backup_code(conn, uid, body.code)

    if not is_valid:
        raise AxiomException(ErrorCodes.AUTH_OTP_INVALID, "Invalid code", 400)

    if not row["totp_enabled"]:
        # First time verification, enable it
        await conn.execute("UPDATE users SET totp_enabled = 1 WHERE uid = ?", (uid,))

    # Generate new backup codes if we just enabled it
    backup_codes = []
    if not row["totp_enabled"]:
        backup_codes = await TOTPEngine.generate_backup_codes(
            conn, uid, config.backup_codes_count
        )

    await conn.commit()

    resp = await _create_auth_response(
        conn, config, project_id, row, _get_ip(request), _get_user_agent(request)
    )
    if locals().get("backup_codes"):
        resp["backup_codes"] = backup_codes
    return resp


async def totp_confirm(request: Request, body: TotpConfirmRequest) -> Dict[str, Any]:
    project_id, config, payload = await _get_current_user(request)
    uid = payload["sub"]

    conn = await auth_db_manager.get_db(project_id)
    row = await UserStore.get_user_by_uid(conn, uid)

    assert row is not None
    if not row or not row["totp_secret"]:
        raise AxiomException(ErrorCodes.INPUT_VALUE_INVALID, "TOTP not enrolled", 400)

    is_valid = TOTPEngine.verify_totp(row["totp_secret"], body.code)

    if not is_valid:
        raise AxiomException(ErrorCodes.AUTH_OTP_INVALID, "Invalid code", 400)

    await conn.execute("UPDATE users SET totp_enabled = 1 WHERE uid = ?", (uid,))
    backup_codes = await TOTPEngine.generate_backup_codes(
        conn, uid, config.backup_codes_count
    )
    await conn.commit()

    return {"status": "ok", "totp_enabled": True, "backup_codes": backup_codes}


async def totp_disable(request: Request, body: TotpDisableRequest) -> Dict[str, Any]:
    project_id, config, payload = await _get_current_user(request)
    uid = payload["sub"]

    conn = await auth_db_manager.get_db(project_id)
    row = await UserStore.get_user_by_uid(conn, uid)
    assert row is not None
    if not row or not row["totp_secret"]:
        return {"status": "ok"}

    if not TOTPEngine.verify_totp(row["totp_secret"], body.code):
        raise AxiomException(ErrorCodes.AUTH_OTP_INVALID, "Invalid code", 400)

    await conn.execute(
        "UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE uid = ?", (uid,)
    )
    await conn.execute("DELETE FROM totp_backup_codes WHERE uid = ?", (uid,))
    await conn.commit()
    return {"status": "ok"}


async def totp_backup_verify(
    request: Request, body: TotpBackupVerifyRequest
) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    payload = token_engine.verify_access_token(body.mfa_token, project_id)

    if not payload.get("mfa_pending"):
        raise AxiomException(ErrorCodes.AUTH_TOKEN_INVALID, "Invalid MFA token", 401)

    uid = payload["sub"]
    conn = await auth_db_manager.get_db(project_id)
    row = await UserStore.get_user_by_uid(conn, uid)

    is_valid = await TOTPEngine.verify_backup_code(conn, uid, body.code)
    if not is_valid:
        raise AxiomException(ErrorCodes.AUTH_OTP_INVALID, "Invalid backup code", 400)

    await conn.commit()
    return await _create_auth_response(
        conn, config, project_id, row, _get_ip(request), _get_user_agent(request)
    )


async def totp_backup_regenerate(request: Request) -> Dict[str, Any]:
    project_id, config, payload = await _get_current_user(request)
    uid = payload["sub"]
    conn = await auth_db_manager.get_db(project_id)
    await conn.execute("DELETE FROM totp_backup_codes WHERE uid = ?", (uid,))
    backup_codes = await TOTPEngine.generate_backup_codes(
        conn, uid, config.backup_codes_count
    )
    await conn.commit()
    return {"backup_codes": backup_codes}


async def get_me(request: Request) -> Dict[str, Any]:
    project_id, config, payload = await _get_current_user(request)
    conn = await auth_db_manager.get_db(project_id)
    row = await UserStore.get_user_by_uid(conn, payload["sub"])

    user_dict: Dict[str, Any] = dict(row)  # type: ignore
    if "password_hash" in user_dict:
        del user_dict["password_hash"]
    if "totp_secret" in user_dict:
        del user_dict["totp_secret"]
    if user_dict.get("metadata"):
        user_dict["metadata"] = json.loads(user_dict["metadata"])
    return {"user": user_dict}


async def update_me(request: Request, body: UpdateUserRequest) -> Dict[str, str]:
    project_id, config, payload = await _get_current_user(request)
    conn = await auth_db_manager.get_db(project_id)

    updates = {}
    if body.display_name is not None:
        updates["display_name"] = body.display_name
    if body.avatar_url is not None:
        updates["avatar_url"] = body.avatar_url
    if body.metadata is not None:
        updates["metadata"] = json.dumps(body.metadata)

    await UserStore.update_user(conn, payload["sub"], updates)
    await conn.commit()
    return {"status": "ok"}


async def delete_me(request: Request) -> Dict[str, str]:
    project_id, config, payload = await _get_current_user(request)
    uid = payload["sub"]

    conn = await auth_db_manager.get_db(project_id)
    await conn.execute("DELETE FROM users WHERE uid = ?", (uid,))
    await UserStore.revoke_all_sessions(conn, uid)
    await UserStore.log_audit(
        conn, "account_deleted", uid, _get_ip(request), _get_user_agent(request)
    )
    await AuthWebhookEmitter.emit(
        config,
        project_id,
        "account_deleted",
        uid,
        ip_address=_get_ip(request),
        user_agent=_get_user_agent(request),
    )
    await conn.commit()
    return {"status": "ok"}


async def change_email(request: Request, body: ChangeEmailRequest) -> Dict[str, str]:
    project_id, config, payload = await _get_current_user(request)
    uid = payload["sub"]

    conn = await auth_db_manager.get_db(project_id)
    row = await UserStore.get_user_by_uid(conn, uid)
    if not row:
        raise AxiomException(ErrorCodes.AUTH_USER_NOT_FOUND, "User not found", 404)

    if not row["password_hash"] or not UserStore.verify_password(
        row["password_hash"], body.password
    ):
        raise AxiomException(
            ErrorCodes.AUTH_INVALID_CREDENTIALS, "Invalid password", 401
        )

    token = secrets.token_urlsafe(32)
    token_hash = hash_sha256(token)
    expires_at = datetime_to_iso(time.time() + config.verification_ttl)

    await conn.execute(
        "INSERT INTO auth_tokens (id, uid, email, token_hash, token_type, expires_at, created_at) VALUES (?, ?, ?, ?, 'email_change', ?, ?)",
        (
            str(uuid.uuid4()),
            uid,
            body.new_email.lower(),
            token_hash,
            expires_at,
            utc_now_iso(),
        ),
    )
    await conn.commit()

    link = f"{config.callback_url}?token={token}&type=email_change"
    await EmailTransport.send_email(
        conn, config.email, "email_change", body.new_email, {"{{.Link}}": link}
    )
    return {"status": "ok"}


async def confirm_email_change(
    request: Request, body: ConfirmEmailChangeRequest
) -> Dict[str, str]:
    project_id, config = _get_project(request)
    conn = await auth_db_manager.get_db(project_id)
    token_hash = hash_sha256(body.token)

    async with conn.execute(
        "SELECT uid, email, expires_at, used FROM auth_tokens WHERE token_hash = ? AND token_type = 'email_change'",
        (token_hash,),
    ) as cursor:
        row = await cursor.fetchone()

    if not row or row["used"]:
        raise AxiomException(
            ErrorCodes.AUTH_TOKEN_INVALID, "Invalid or used token", 400
        )

    from datetime import datetime, timezone

    if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
        raise AxiomException(ErrorCodes.AUTH_TOKEN_EXPIRED, "Token expired", 400)

    try:
        await conn.execute(
            "UPDATE users SET email = ?, email_verified = 1 WHERE uid = ?",
            (row["email"], row["uid"]),
        )
        await conn.execute(
            "UPDATE auth_tokens SET used = 1 WHERE token_hash = ?", (token_hash,)
        )
        await conn.commit()
    except aiosqlite.IntegrityError:
        raise AxiomException(ErrorCodes.AUTH_USER_EXISTS, "Email already in use", 409)

    await AuthWebhookEmitter.emit(
        config, project_id, "email_change", row["uid"], ip_address=_get_ip(request)
    )
    return {"status": "ok"}


async def update_password(
    request: Request, body: UpdatePasswordRequest
) -> Dict[str, str]:
    project_id, config, payload = await _get_current_user(request)
    uid = payload["sub"]

    conn = await auth_db_manager.get_db(project_id)
    row = await UserStore.get_user_by_uid(conn, uid)
    if not row:
        raise AxiomException(ErrorCodes.AUTH_USER_NOT_FOUND, "User not found", 404)

    if not row["password_hash"] or not UserStore.verify_password(
        row["password_hash"], body.current_password
    ):
        raise AxiomException(
            ErrorCodes.AUTH_INVALID_CREDENTIALS, "Invalid current password", 401
        )

    _validate_password(body.new_password, config)

    await conn.execute(
        "UPDATE users SET password_hash = ? WHERE uid = ?",
        (UserStore.hash_password(body.new_password), uid),
    )
    # Revoke all other sessions for security after a password change
    await UserStore.revoke_all_sessions(conn, uid)
    await conn.commit()

    return {"status": "ok"}


# ─────────────────────────────────────────────────────────────────────────────
# Admin Endpoints
# ─────────────────────────────────────────────────────────────────────────────


def _ensure_admin(api_key: str):
    global_config = GlobalConfigProvider().get_config()
    key_config = global_config.api_key.get(api_key)
    if not key_config or not key_config.full_admin:
        raise AxiomException(
            ErrorCodes.AUTH_INSUFFICIENT_MODE, "Admin access required", 403
        )


async def admin_list_users(
    request: Request, limit: int = 50, offset: int = 0
) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    _ensure_admin(project_id)
    conn = await auth_db_manager.get_db(project_id)

    users = []
    async with conn.execute(
        "SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?", (limit, offset)
    ) as cursor:
        async for row in cursor:
            user = dict(row)
            if "password_hash" in user:
                del user["password_hash"]
            if "totp_secret" in user:
                del user["totp_secret"]
            if user.get("metadata"):
                user["metadata"] = json.loads(user["metadata"])
            users.append(user)
    return {"users": users}


async def admin_get_user(request: Request, uid: str) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    _ensure_admin(project_id)
    conn = await auth_db_manager.get_db(project_id)
    row = await UserStore.get_user_by_uid(conn, uid)
    if not row:
        raise AxiomException(ErrorCodes.DB_NOT_FOUND, "User not found", 404)

    user = dict(row)
    if "password_hash" in user:
        del user["password_hash"]
    if "totp_secret" in user:
        del user["totp_secret"]
    if user.get("metadata"):
        user["metadata"] = json.loads(user["metadata"])

    audit = []
    async with conn.execute(
        "SELECT * FROM auth_audit WHERE uid = ? ORDER BY created_at DESC LIMIT 100",
        (uid,),
    ) as cursor:
        async for a_row in cursor:
            a_dict = dict(a_row)
            if a_dict.get("metadata"):
                a_dict["metadata"] = json.loads(a_dict["metadata"])
            audit.append(a_dict)

    return {"user": user, "audit": audit}


async def admin_update_user(
    request: Request, uid: str, body: AdminUpdateUserRequest
) -> Dict[str, str]:
    project_id, config = _get_project(request)
    _ensure_admin(project_id)
    conn = await auth_db_manager.get_db(project_id)

    updates = {}
    if body.email is not None:
        updates["email"] = body.email.lower()
    if body.password is not None:
        updates["password_hash"] = UserStore.hash_password(body.password)
    if body.email_verified is not None:
        updates["email_verified"] = 1 if body.email_verified else 0
    if body.disabled is not None:
        updates["disabled"] = 1 if body.disabled else 0
    if body.display_name is not None:
        updates["display_name"] = body.display_name
    if body.avatar_url is not None:
        updates["avatar_url"] = body.avatar_url
    if body.metadata is not None:
        updates["metadata"] = json.dumps(body.metadata)

    if updates:
        await UserStore.update_user(conn, uid, updates)
        await conn.commit()
    return {"status": "ok"}


async def admin_delete_user(request: Request, uid: str) -> Dict[str, str]:
    project_id, config = _get_project(request)
    _ensure_admin(project_id)
    conn = await auth_db_manager.get_db(project_id)

    await conn.execute("DELETE FROM users WHERE uid = ?", (uid,))
    await UserStore.log_audit(
        conn, "account_deleted", uid, _get_ip(request), _get_user_agent(request)
    )
    await AuthWebhookEmitter.emit(
        config,
        project_id,
        "account_deleted",
        uid,
        ip_address=_get_ip(request),
        user_agent=_get_user_agent(request),
    )
    await conn.commit()
    return {"status": "ok"}


async def admin_revoke_sessions(request: Request, uid: str) -> Dict[str, str]:
    project_id, config = _get_project(request)
    _ensure_admin(project_id)
    conn = await auth_db_manager.get_db(project_id)
    await UserStore.revoke_all_sessions(conn, uid)
    await conn.commit()
    return {"status": "ok"}


async def admin_list_templates(request: Request) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    _ensure_admin(project_id)
    conn = await auth_db_manager.get_db(project_id)
    templates = await TemplateStore.list_templates(conn)
    return {"templates": templates}


async def admin_update_template(
    request: Request, type_name: str, body: TemplateRequest
) -> Dict[str, str]:
    project_id, config = _get_project(request)
    _ensure_admin(project_id)
    conn = await auth_db_manager.get_db(project_id)
    await TemplateStore.set_template(conn, type_name, body.subject, body.html)
    await conn.commit()
    return {"status": "ok"}


async def admin_delete_template(request: Request, type_name: str) -> Dict[str, str]:
    project_id, config = _get_project(request)
    _ensure_admin(project_id)
    conn = await auth_db_manager.get_db(project_id)
    await TemplateStore.delete_template(conn, type_name)
    await conn.commit()
    return {"status": "ok"}


async def admin_import_users(
    request: Request, body: ImportUsersRequest
) -> Dict[str, str]:
    project_id, config = _get_project(request)
    _ensure_admin(project_id)
    job_id = await AuthImportExport.start_import_job(project_id, body.users)
    return {"job_id": job_id}


async def admin_import_status(request: Request, job_id: str) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    _ensure_admin(project_id)
    status = await AuthImportExport.get_import_job(project_id, job_id)
    if not status:
        raise AxiomException(ErrorCodes.DB_NOT_FOUND, "Job not found", 404)
    return status


async def admin_export_users(request: Request) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    _ensure_admin(project_id)
    users = await AuthImportExport.export_users(project_id)
    for u in users:
        if "password_hash" in u:
            del u["password_hash"]
        if "totp_secret" in u:
            del u["totp_secret"]
    return {"users": users}


async def admin_audit_log(
    request: Request, limit: int = 100, offset: int = 0
) -> Dict[str, Any]:
    project_id, config = _get_project(request)
    _ensure_admin(project_id)
    conn = await auth_db_manager.get_db(project_id)

    audit = []
    async with conn.execute(
        "SELECT * FROM auth_audit ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (limit, offset),
    ) as cursor:
        async for row in cursor:
            d = dict(row)
            if d.get("metadata"):
                d["metadata"] = json.loads(d["metadata"])
            audit.append(d)
    return {"audit": audit}
