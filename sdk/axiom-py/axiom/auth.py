from typing import Any

from .client import AxiomClient


class AuthAPI:
    def __init__(self, client: AxiomClient):
        self.client = client

    async def login(self, email: str, password: str) -> Any:
        res = await self.client.fetch(
            f"/api/v1/auth/{self.client.project_id}/login",
            method="POST",
            json={"email": email, "password": password},
        )
        if "access_token" in res:
            self.client.set_token(res["access_token"])
        return res

    async def signup(self, email: str, password: str) -> Any:
        return await self.client.fetch(
            f"/api/v1/auth/{self.client.project_id}/signup",
            method="POST",
            json={"email": email, "password": password},
        )

    async def logout(self) -> Any:
        res = await self.client.fetch(
            f"/api/v1/auth/{self.client.project_id}/logout", method="POST"
        )
        self.client.user_token = None
        return res

    async def get_user(self) -> Any:
        return await self.client.fetch(f"/api/v1/auth/{self.client.project_id}/user")

    def get_oauth_login_url(self, provider: str) -> str:
        return f"{self.client.url}/api/v1/auth/{self.client.project_id}/oauth/{provider}/login"
