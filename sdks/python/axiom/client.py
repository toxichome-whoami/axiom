import base64
import json
from typing import Any, Dict, Iterator, List, Optional, Union
import httpx


class AxiomClient:
    """
    Official Python SDK for the Axiom API Gateway.

    Usage:
        client = AxiomClient(
            base_url="http://localhost:4500",
            key_name="admin",
            key_secret="YOUR_SECRET"
        )
        dbs = client.list_databases()
    """

    def __init__(self, base_url: str, key_name: str, key_secret: str, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        token = base64.b64encode(f"{key_name}:{key_secret}".encode("utf-8")).decode("utf-8")
        self._client = httpx.Client(
            timeout=timeout,
            headers={
                "Content-Type": "application/json",
                "X-Axiom-Key": token,
            },
        )

    def close(self) -> None:
        """Close the underlying HTTP connection pool. Call when done."""
        self._client.close()

    def __enter__(self) -> "AxiomClient":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def _request(self, method: str, endpoint: str, **kwargs: Any) -> Dict[str, Any]:
        try:
            url = self.base_url + endpoint
            response = self._client.request(method, url, **kwargs)
            result = response.json()
            if not response.is_success:
                return {
                    "success": False,
                    "error": result.get("error", {"code": "UNKNOWN", "message": f"HTTP {response.status_code}"}),
                }
            return result
        except httpx.RequestError as exc:
            return {"success": False, "error": {"code": "NETWORK_ERROR", "message": str(exc)}}

    def list_databases(self) -> Dict[str, Any]:
        """List all databases the API key has access to."""
        return self._request("GET", "/api/v1/db/databases")

    def list_tables(self, db: str) -> Dict[str, Any]:
        """List all tables in a specific database."""
        return self._request("GET", f"/api/v1/db/{db}/tables")

    def fetch_rows(
        self,
        db: str,
        table: str,
        limit: int = 50,
        cursor: Optional[str] = None,
        row_filter: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
        order: Optional[str] = None,
        fields: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Fetch rows from a table with keyset cursor pagination.

        Args:
            db:         Database alias (e.g. "main_db")
            table:      Table name
            limit:      Maximum rows to return (default 50)
            cursor:     Opaque cursor string from a previous response's next_cursor
            row_filter: Dict of column:value pairs to filter by
            sort:       Column name to sort by
            order:      "asc" or "desc"
            fields:     Comma-separated list of columns to return (e.g. "id,name")
        """
        params: Dict[str, Any] = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        if row_filter:
            params["filter"] = json.dumps(row_filter)
        if sort:
            params["sort"] = sort
        if order:
            params["order"] = order
        if fields:
            params["fields"] = fields
        return self._request("GET", f"/api/v1/db/{db}/{table}/rows", params=params)

    def fetch_all_rows(
        self,
        db: str,
        table: str,
        limit: int = 100,
        row_filter: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
        order: Optional[str] = None,
    ) -> Iterator[List[Dict[str, Any]]]:
        """
        Generator that transparently pages through ALL rows using the cursor.
        Yields each page's list of rows.

        Usage:
            for page in client.fetch_all_rows("main_db", "users"):
                for row in page:
                    print(row)
        """
        cursor: Optional[str] = None
        while True:
            resp = self.fetch_rows(db, table, limit=limit, cursor=cursor, row_filter=row_filter, sort=sort, order=order)
            rows = resp.get("rows") or []
            yield rows
            pagination = resp.get("pagination") or {}
            next_cursor = pagination.get("next_cursor")
            if not next_cursor or not rows:
                break
            cursor = next_cursor

    def insert_rows(
        self,
        db: str,
        table: str,
        rows: Union[Dict[str, Any], List[Dict[str, Any]]],
    ) -> Dict[str, Any]:
        """Insert one or multiple rows. Pass a single dict or a list of dicts."""
        payload = rows if isinstance(rows, list) else [rows]
        return self._request("POST", f"/api/v1/db/{db}/{table}/rows", json=payload)

    def update_rows(
        self,
        db: str,
        table: str,
        row_filter: Dict[str, Any],
        update: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Update all rows matching row_filter with the values in update."""
        return self._request(
            "PATCH",
            f"/api/v1/db/{db}/{table}/rows",
            json={"filter": row_filter, "update": update},
        )

    def delete_rows(
        self,
        db: str,
        table: str,
        row_filter: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Delete all rows matching row_filter."""
        return self._request("DELETE", f"/api/v1/db/{db}/{table}/rows", json=row_filter)

    def query(
        self,
        db: str,
        sql: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Execute a raw SQL query with optional parameters."""
        payload: Dict[str, Any] = {"sql": sql}
        if params:
            payload["params"] = params
        return self._request("POST", f"/api/v1/db/{db}/query", json=payload)
