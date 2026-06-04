from typing import Optional

from .auth import AuthAPI
from .client import AxiomClient
from .db import DatabaseAPI
from .fs import StorageAPI


class Axiom:
    def __init__(
        self, url: str, project_id: str = "default", api_key: Optional[str] = None
    ):
        self.client = AxiomClient(url=url, project_id=project_id, api_key=api_key)
        self.auth = AuthAPI(self.client)
        self.db = DatabaseAPI(self.client)
        self.fs = StorageAPI(self.client)

    async def close(self):
        await self.client.close()


__all__ = ["Axiom", "AxiomClient"]
