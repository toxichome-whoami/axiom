from typing import Any, Dict, Optional

import requests


class AxiomAuthException(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 400,
        data: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.data = data or {}


class AxiomAuthClient:
    def __init__(self, base_url: str, api_key: str, project_id: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.project_id = project_id or api_key
        self.access_token: Optional[str] = None
        self.refresh_token: Optional[str] = None

    def set_tokens(
        self, access_token: Optional[str] = None, refresh_token: Optional[str] = None
    ) -> None:
        if access_token:
            self.access_token = access_token
        if refresh_token:
            self.refresh_token = refresh_token

    def _request(
        self,
        method: str,
        path: str,
        json: Optional[Dict[str, Any]] = None,
        require_auth: bool = False,
    ) -> Dict[str, Any]:
        headers = {
            "x-api-key": self.api_key,
        }

        if require_auth:
            if not self.access_token:
                raise AxiomAuthException(
                    "Missing access token for authenticated request", 401
                )
            headers["Authorization"] = f"Bearer {self.access_token}"

        url = f"{self.base_url}/api/v1/auth/{self.project_id}{path}"
        response = requests.request(method, url, json=json, headers=headers)

        if response.status_code == 401 and self.refresh_token and require_auth:
            # Attempt to refresh token
            self.refresh()
            headers["Authorization"] = f"Bearer {self.access_token}"
            response = requests.request(method, url, json=json, headers=headers)

        if not response.ok:
            try:
                err_data = response.json()
                msg = (
                    err_data.get("detail")
                    or err_data.get("message")
                    or "Request failed"
                )
                if (
                    not msg
                    and "error" in err_data
                    and isinstance(err_data["error"], dict)
                ):
                    msg = err_data["error"].get("message", "Request failed")
            except ValueError:
                err_data = {}
                msg = response.text or "Request failed"
            raise AxiomAuthException(msg, response.status_code, err_data)

        if not response.text:
            return {}

        return response.json()

    # --- PUBLIC ENDPOINTS ---

    def signup(
        self,
        email: str,
        password: str,
        display_name: Optional[str] = None,
        avatar_url: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        data: Dict[str, Any] = {"email": email, "password": password}
        if display_name:
            data["display_name"] = display_name
        if avatar_url:
            data["avatar_url"] = avatar_url
        if metadata:
            data["metadata"] = metadata
        res = self._request("POST", "/signup", json=data)
        self.set_tokens(res.get("access_token"), res.get("refresh_token"))
        return res

    def login(self, email: str, password: str) -> Dict[str, Any]:
        res = self._request(
            "POST", "/login", json={"email": email, "password": password}
        )
        if not res.get("mfa_required"):
            self.set_tokens(res.get("access_token"), res.get("refresh_token"))
        return res

    def refresh(self) -> Dict[str, Any]:
        if not self.refresh_token:
            raise AxiomAuthException("No refresh token available", 400)
        res = self._request(
            "POST", "/refresh", json={"refresh_token": self.refresh_token}
        )
        self.set_tokens(res.get("access_token"), res.get("refresh_token"))
        return res

    def logout(self) -> None:
        if not self.refresh_token:
            return
        self._request(
            "POST",
            "/logout",
            json={"refresh_token": self.refresh_token},
            require_auth=True,
        )
        self.access_token = None
        self.refresh_token = None

    # --- PASSWORDLESS & OTP ---

    def send_magic_link(self, email: str) -> Dict[str, Any]:
        return self._request("POST", "/magic-link", json={"email": email})

    def verify_magic_link(self, token: str) -> Dict[str, Any]:
        res = self._request("POST", "/magic-link/verify", json={"token": token})
        self.set_tokens(res.get("access_token"), res.get("refresh_token"))
        return res

    def send_otp(self, email: str) -> Dict[str, Any]:
        return self._request("POST", "/otp/send", json={"email": email})

    def verify_otp(self, email: str, code: str) -> Dict[str, Any]:
        res = self._request("POST", "/verify/otp", json={"email": email, "code": code})
        self.set_tokens(res.get("access_token"), res.get("refresh_token"))
        return res

    def resend(self, email: str, type_name: str) -> Dict[str, Any]:
        return self._request(
            "POST", "/resend", json={"email": email, "type": type_name}
        )

    def verify_email(self, token: str) -> Dict[str, Any]:
        return self._request("POST", "/verify/email", json={"token": token})

    # --- PASSWORD ---

    def forgot_password(self, email: str) -> Dict[str, Any]:
        return self._request("POST", "/password/forgot", json={"email": email})

    def reset_password(self, token: str, new_password: str) -> Dict[str, Any]:
        return self._request(
            "POST",
            "/password/reset",
            json={"token": token, "new_password": new_password},
        )

    # --- USER PROFILE ---

    def get_me(self) -> Dict[str, Any]:
        return self._request("GET", "/user", require_auth=True)

    def update_me(
        self,
        display_name: Optional[str] = None,
        avatar_url: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        data: Dict[str, Any] = {}
        if display_name is not None:
            data["display_name"] = display_name
        if avatar_url is not None:
            data["avatar_url"] = avatar_url
        if metadata is not None:
            data["metadata"] = metadata
        return self._request("PATCH", "/user", json=data, require_auth=True)

    def delete_me(self) -> Dict[str, Any]:
        return self._request("DELETE", "/user", require_auth=True)

    def change_email(self, new_email: str, password: str) -> Dict[str, Any]:
        return self._request(
            "POST",
            "/user/email",
            json={"new_email": new_email, "password": password},
            require_auth=True,
        )

    def confirm_email_change(self, token: str) -> Dict[str, Any]:
        return self._request(
            "POST", "/user/email/confirm", json={"token": token}, require_auth=True
        )

    def update_password(
        self, current_password: str, new_password: str
    ) -> Dict[str, Any]:
        return self._request(
            "POST",
            "/user/password",
            json={"current_password": current_password, "new_password": new_password},
            require_auth=True,
        )

    # --- SESSIONS ---

    def get_sessions(self) -> Dict[str, Any]:
        return self._request("GET", "/user/sessions", require_auth=True)

    def revoke_session(self, session_id: str) -> Dict[str, Any]:
        return self._request(
            "DELETE", f"/user/sessions/{session_id}", require_auth=True
        )

    def revoke_all_sessions(self) -> Dict[str, Any]:
        res = self._request("DELETE", "/user/sessions", require_auth=True)
        self.access_token = None
        self.refresh_token = None
        return res

    # --- TOTP / 2FA ---

    def totp_enroll(self) -> Dict[str, Any]:
        return self._request("POST", "/totp/enroll", require_auth=True)

    def totp_confirm(self, code: str) -> Dict[str, Any]:
        res = self._request(
            "POST", "/totp/confirm", json={"code": code}, require_auth=True
        )
        self.set_tokens(res.get("access_token"), res.get("refresh_token"))
        return res

    def totp_verify(self, mfa_token: str, code: str) -> Dict[str, Any]:
        res = self._request(
            "POST", "/totp/verify", json={"mfa_token": mfa_token, "code": code}
        )
        self.set_tokens(res.get("access_token"), res.get("refresh_token"))
        return res

    def totp_disable(self, code: str) -> Dict[str, Any]:
        return self._request(
            "POST", "/totp/disable", json={"code": code}, require_auth=True
        )

    def totp_backup_verify(self, mfa_token: str, code: str) -> Dict[str, Any]:
        res = self._request(
            "POST", "/totp/backup/verify", json={"mfa_token": mfa_token, "code": code}
        )
        self.set_tokens(res.get("access_token"), res.get("refresh_token"))
        return res

    def totp_backup_regenerate(self) -> Dict[str, Any]:
        return self._request("GET", "/totp/backup/regenerate", require_auth=True)

    # --- ANONYMOUS AUTH ---

    def anonymous_login(self) -> Dict[str, Any]:
        res = self._request("POST", "/anonymous")
        self.set_tokens(res.get("access_token"), res.get("refresh_token"))
        return res

    def upgrade_anonymous(
        self,
        email: str,
        password: str,
        display_name: Optional[str] = None,
        avatar_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        data = {"email": email, "password": password}
        if display_name:
            data["display_name"] = display_name
        if avatar_url:
            data["avatar_url"] = avatar_url
        res = self._request("POST", "/anonymous/upgrade", json=data, require_auth=True)
        self.set_tokens(res.get("access_token"), res.get("refresh_token"))
        return res
