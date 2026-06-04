from typing import Any, Optional

from .client import AxiomClient


class StorageAPI:
    def __init__(self, client: AxiomClient):
        self.client = client

    async def list(
        self,
        alias: str,
        path: str = "/",
        limit: Optional[int] = None,
        continuation_token: Optional[str] = None,
        recursive: bool = False,
    ) -> Any:
        params = {"path": path}
        if limit is not None:
            params["limit"] = str(limit)
        if continuation_token is not None:
            params["continuation_token"] = continuation_token
        if recursive:
            params["recursive"] = "true"

        return await self.client.fetch(f"/api/v1/fs/{alias}/list", params=params)

    async def download(self, alias: str, path: str) -> Any:
        return await self.client.fetch(
            f"/api/v1/fs/{alias}/download", params={"path": path}
        )

    async def upload(
        self, alias: str, path: str, file_bytes: bytes, filename: str
    ) -> Any:
        files = {"file": (filename, file_bytes)}
        data = {"action": "direct", "path": path}

        headers = {}
        if self.client.user_token:
            headers["X-User-Access-Token"] = self.client.user_token
        elif self.client.api_key:
            headers["X-Axiom-Key"] = self.client.api_key

        res = await self.client._http.post(
            f"/api/v1/fs/{alias}/upload", data=data, files=files, headers=headers
        )
        json_res = res.json()
        if not json_res.get("success"):
            error_msg = json_res.get("error", {}).get("message", "Unknown error")
            raise Exception(error_msg)
        return json_res.get("data")

    async def generate_presigned_url(
        self,
        alias: str,
        path: str,
        method: str = "GET",
        expires_in: int = 3600,
    ) -> str:
        res = await self.client.fetch(
            f"/api/v1/fs/{alias}/presign",
            method="POST",
            json={
                "path": path,
                "method": method,
                "expires_in": expires_in,
            },
        )
        return res["url"]
