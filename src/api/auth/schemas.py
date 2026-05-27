from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class VerifyEmailRequest(BaseModel):
    token: str


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    code: str


class MagicLinkRequest(BaseModel):
    email: EmailStr


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=8)


class TotpEnrollRequest(BaseModel):
    code: str


class TotpVerifyRequest(BaseModel):
    code: str


class UpdateUserRequest(BaseModel):
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class ChangeEmailRequest(BaseModel):
    new_email: EmailStr
    password: str


class ConfirmEmailChangeRequest(BaseModel):
    token: str


class UpdatePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)


class AdminCreateUserRequest(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    email_verified: bool = False
    is_anonymous: bool = False


class AdminUpdateUserRequest(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    email_verified: Optional[bool] = None
    disabled: Optional[bool] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class TemplateRequest(BaseModel):
    subject: str
    html: str


class ImportUsersRequest(BaseModel):
    users: List[Dict[str, Any]]


class ResendRequest(BaseModel):
    email: EmailStr
    type: str


class OtpSendRequest(BaseModel):
    email: EmailStr


class TotpBackupVerifyRequest(BaseModel):
    mfa_token: str
    code: str


class TotpConfirmRequest(BaseModel):
    code: str


class TotpDisableRequest(BaseModel):
    code: str


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: Dict[str, Any]
