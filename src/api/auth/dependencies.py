from typing import Any, Dict, List

from fastapi import Request

from src.api.auth.handlers import _get_current_user
from src.api.errors import AxiomException, ErrorCodes


class RequireRole:
    """
    FastAPI Dependency for Role-Based Access Control (RBAC).
    Extracts the user's role from the JWT payload and verifies it against allowed roles.

    Usage:
        @app.get("/admin/dashboard", dependencies=[Depends(RequireRole("admin"))])
    """

    def __init__(self, allowed_roles: List[str] | str):
        if isinstance(allowed_roles, str):
            self.allowed_roles = [allowed_roles]
        else:
            self.allowed_roles = allowed_roles

    async def __call__(self, request: Request) -> Dict[str, Any]:
        """
        Verify the user has the required role.
        """
        project_id, config, payload = await _get_current_user(request)

        # Check if role exists in JWT payload (custom claims)
        user_role = payload.get("role")

        if not user_role:
            raise AxiomException(
                ErrorCodes.AUTH_SCOPE_DENIED,
                "Access denied. Missing role claim in token.",
                403,
            )

        if user_role not in self.allowed_roles:
            raise AxiomException(
                ErrorCodes.AUTH_SCOPE_DENIED,
                f"Access denied. Required role: {self.allowed_roles}, but got: {user_role}.",
                403,
            )

        return payload
