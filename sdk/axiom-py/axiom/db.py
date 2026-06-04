import json
from typing import Any, Dict, List, Optional

from .client import AxiomClient


class DatabaseAPI:
    def __init__(self, client: AxiomClient):
        self.client = client

    async def select(
        self,
        alias: str,
        table: str,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        sort: Optional[str] = None,
        order: Optional[str] = None,
        filter: Optional[Dict] = None,
    ) -> Any:
        params = {}
        if limit is not None:
            params["limit"] = str(limit)
        if cursor is not None:
            params["cursor"] = cursor
        if sort is not None:
            params["sort"] = sort
        if order is not None:
            params["order"] = order
        if filter is not None:
            params["filter"] = json.dumps(filter)

        return await self.client.fetch(
            f"/api/v1/db/{alias}/{table}/rows", params=params
        )

    async def insert(self, alias: str, table: str, rows: List[Dict]) -> Any:
        return await self.client.fetch(
            f"/api/v1/db/{alias}/{table}/rows", method="POST", json={"rows": rows}
        )

    async def update(self, alias: str, table: str, filter: Dict, update: Dict) -> Any:
        return await self.client.fetch(
            f"/api/v1/db/{alias}/{table}/rows",
            method="PATCH",
            json={"filter": filter, "update": update},
        )

    async def delete(self, alias: str, table: str, filter: Dict) -> Any:
        return await self.client.fetch(
            f"/api/v1/db/{alias}/{table}/rows", method="DELETE", json={"filter": filter}
        )

    async def query(self, alias: str, sql: str, params: Optional[Dict] = None) -> Any:
        return await self.client.fetch(
            f"/api/v1/db/{alias}/query",
            method="POST",
            json={"sql": sql, "params": params or {}},
        )
