import base64
import json
from typing import Any, Dict, List, Optional, Union
import httpx

class AxiomClient:
    def __init__(self, base_url: str, key_name: str, key_secret: str, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        
        token = base64.b64encode(f"{key_name}:{key_secret}".encode("utf-8")).decode("utf-8")
        
        self.client = httpx.Client(
            base_url=self.base_url,
            timeout=timeout,
            headers={
                "Content-Type": "application/json",
                "X-Axiom-Key": token
            }
        )

    def _request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        try:
            response = self.client.request(method, endpoint, **kwargs)
            result = response.json()
            if not response.is_success:
                return {
                    "success": False,
                    "error": result.get("error", {"code": "UNKNOWN", "message": f"HTTP {response.status_code}"})
                }
            return result
        except httpx.RequestError as exc:
            return {
                "success": False,
                "error": {"code": "NETWORK_ERROR", "message": str(exc)}
            }

    def list_databases(self) -> Dict[str, Any]:
        """List all databases the API key has access to."""
        return self._request("GET", "/api/v1/db/databases")

    def list_tables(self, db: str) -> Dict[str, Any]:
        "\""List all tables in a specific database."\""
        return self._request("GET", f"/api/v1/db/{db}/tables")

    def fetch_rows(
        self, 
        db: str, 
        table: str, 
        limit: int = 50, 
        cursor: Optional[str] = None, 
        filter: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
        order: Optional[str] = None
    ) -> Dict[str, Any]:
        """Fetch rows from a specific table with keyset cursor pagination."""
        params = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        if filter:
            params["filter"] = json.dumps(filter)
        if sort:
            params["sort"] = sort
        if order:
            params["order"] = order
            
        return self._request("GET", f"/api/v1/db/{db}/{table}/rows", params=params)

    def insert_rows(self, db: str, table: str, rows: Union[Dict[str, Any], List[Dict[str, Any]]]) -> Dict[str, Any]:
        """Insert one or multiple rows into a table."""
        payload = rows if isinstance(rows, list) else [rows]
        return self._request("POST", f"/api/v1/db/{db}/{table}/rows", json=payload)

    def update_rows(self, db: str, table: str, filter: Dict[str, Any], update: Dict[str, Any]) -> Dict[str, Any]:
        """Update rows matching a filter."""
        return self._request("PATCH", f"/api/v1/db/{db}/{table}/rows", json={"filter": filter, "update": update})

    def delete_rows(self, db: str, table: str, filter: Dict[str, Any]) -> Dict[str, Any]:
        """Delete rows matching a filter."""
        return self._request("DELETE", f"/api/v1/db/{db}/{table}/rows", json=filter)

    def query(self, db: str, sql: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute a raw SQL query with optional parameters."""
        payload = {"sql": sql}
        if params:
            payload["params"] = params
        return self._request("POST", f"/api/v1/db/{db}/query", json=payload)


