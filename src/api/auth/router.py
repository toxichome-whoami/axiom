from fastapi import APIRouter, Request

from src.api.auth import handlers
from src.api.auth.schemas import (
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
from src.api.auth.token_engine import token_engine

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/.well-known/jwks.json")
async def get_jwks():
    return token_engine.get_jwks()


@router.post("/signup")
async def signup(request: Request, body: SignupRequest):
    return await handlers.signup(request, body)


@router.post("/login")
async def login(request: Request, body: LoginRequest):
    return await handlers.login(request, body)


@router.post("/refresh")
async def refresh(request: Request, body: RefreshRequest):
    return await handlers.refresh(request, body)


@router.post("/logout")
async def logout(request: Request, body: LogoutRequest):
    return await handlers.logout(request, body)


@router.get("/user/sessions")
async def get_sessions(request: Request):
    return await handlers.get_sessions(request)


@router.delete("/user/sessions")
async def revoke_all_sessions(request: Request):
    return await handlers.revoke_all_sessions_self(request)


@router.delete("/user/sessions/{session_id}")
async def revoke_session(request: Request, session_id: str):
    return await handlers.revoke_session(request, session_id)


@router.post("/anonymous")
async def anonymous_login(request: Request):
    return await handlers.anonymous_login(request)


@router.post("/anonymous/upgrade")
async def upgrade_anonymous(request: Request, body: SignupRequest):
    return await handlers.upgrade_anonymous(request, body)


@router.post("/verify/email")
async def verify_email(request: Request, body: VerifyEmailRequest):
    return await handlers.verify_email(request, body)


@router.get("/verify")
async def verify_email_get(request: Request, token: str):
    return await handlers.verify_email_get(request, token)


@router.post("/verify/otp")
async def verify_otp(request: Request, body: VerifyOtpRequest):
    return await handlers.verify_otp(request, body)


@router.post("/otp/send")
async def otp_send(request: Request, body: OtpSendRequest):
    return await handlers.otp_send(request, body)


@router.post("/resend")
async def resend(request: Request, body: ResendRequest):
    return await handlers.resend(request, body)


@router.post("/magic-link")
async def magic_link(request: Request, body: MagicLinkRequest):
    return await handlers.magic_link(request, body)


@router.post("/magic-link/verify")
async def magic_link_verify(request: Request, body: VerifyEmailRequest):
    return await handlers.magic_link_verify(request, body)


@router.post("/password/forgot")
async def forgot_password(request: Request, body: ForgotPasswordRequest):
    return await handlers.forgot_password(request, body)


@router.post("/password/reset")
async def reset_password(request: Request, body: ResetPasswordRequest):
    return await handlers.reset_password(request, body)


@router.post("/totp/enroll")
async def totp_enroll(request: Request):
    return await handlers.totp_enroll(request)


@router.post("/totp/confirm")
async def totp_confirm(request: Request, body: TotpConfirmRequest):
    return await handlers.totp_confirm(request, body)


@router.post("/totp/verify")
async def totp_verify(request: Request, body: TotpVerifyRequest):
    return await handlers.totp_verify(request, body)


@router.post("/totp/disable")
async def totp_disable(request: Request, body: TotpDisableRequest):
    return await handlers.totp_disable(request, body)


@router.post("/totp/backup/verify")
async def totp_backup_verify(request: Request, body: TotpBackupVerifyRequest):
    return await handlers.totp_backup_verify(request, body)


@router.get("/totp/backup/regenerate")
async def totp_backup_regenerate(request: Request):
    return await handlers.totp_backup_regenerate(request)


@router.get("/user")
async def get_me(request: Request):
    return await handlers.get_me(request)


@router.patch("/user")
async def update_me(request: Request, body: UpdateUserRequest):
    return await handlers.update_me(request, body)


@router.delete("/user")
async def delete_me(request: Request):
    return await handlers.delete_me(request)


@router.post("/user/email")
async def change_email(request: Request, body: ChangeEmailRequest):
    return await handlers.change_email(request, body)


@router.post("/user/email/confirm")
async def confirm_email_change(request: Request, body: ConfirmEmailChangeRequest):
    return await handlers.confirm_email_change(request, body)


@router.post("/user/password")
async def update_password(request: Request, body: UpdatePasswordRequest):
    return await handlers.update_password(request, body)


@router.get("/admin/users")
async def admin_list_users(request: Request, limit: int = 50, offset: int = 0):
    return await handlers.admin_list_users(request, limit, offset)


@router.get("/admin/users/{uid}")
async def admin_get_user(request: Request, uid: str):
    return await handlers.admin_get_user(request, uid)


@router.patch("/admin/users/{uid}")
async def admin_update_user(
    request: Request, uid: str, body: handlers.AdminUpdateUserRequest
):
    return await handlers.admin_update_user(request, uid, body)


@router.delete("/admin/users/{uid}")
async def admin_delete_user(request: Request, uid: str):
    return await handlers.admin_delete_user(request, uid)


@router.post("/admin/users/{uid}/sessions/revoke")
async def admin_revoke_sessions(request: Request, uid: str):
    return await handlers.admin_revoke_sessions(request, uid)


@router.get("/admin/templates")
async def admin_list_templates(request: Request):
    return await handlers.admin_list_templates(request)


@router.put("/admin/templates/{type_name}")
async def admin_update_template(
    request: Request, type_name: str, body: TemplateRequest
):
    return await handlers.admin_update_template(request, type_name, body)


@router.delete("/admin/templates/{type_name}")
async def admin_delete_template(request: Request, type_name: str):
    return await handlers.admin_delete_template(request, type_name)


@router.post("/admin/users/import")
async def admin_import_users(request: Request, body: ImportUsersRequest):
    return await handlers.admin_import_users(request, body)


@router.get("/admin/users/import/{job_id}")
async def admin_import_status(request: Request, job_id: str):
    return await handlers.admin_import_status(request, job_id)


@router.get("/admin/users/export")
async def admin_export_users(request: Request):
    return await handlers.admin_export_users(request)


@router.get("/admin/audit")
async def admin_audit_log(request: Request, limit: int = 100, offset: int = 0):
    return await handlers.admin_audit_log(request, limit, offset)
