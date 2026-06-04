import base64
from typing import Any, Optional

import httpx


class AxiomClient:
    def __init__(
        self, url: str, project_id: str = "default", api_key: Optional[str] = None
    ):
        self.url = url.rstrip("/")
        self.project_id = project_id
        self.api_key = base64.b64encode(api_key.encode()).decode() if api_key else None
        self.user_token = None
        self._http = httpx.AsyncClient(base_url=self.url)

    def set_token(self, token: str):
        self.user_token = token

    async def fetch(self, path: str, method: str = "GET", **kwargs) -> Any:
        headers = kwargs.pop("headers", {})
        if self.user_token:
            headers["X-User-Access-Token"] = self.user_token
        elif self.api_key:
            headers["X-Axiom-Key"] = self.api_key

        res = await self._http.request(method, path, headers=headers, **kwargs)
        json_res = res.json()
        if not json_res.get("success"):
            error_msg = json_res.get("error", {}).get("message", "Unknown error")
            raise Exception(error_msg)
        return json_res.get("data")

    async def close(self):
        await self._http.aclose()
