from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol

# ─────────────────────────────────────────────────────────────────────────────
# Core Data Structural Types (DTOs)
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class ColumnInfo:
    """Represents unified structural schema layout for a singular table column."""

    name: str
    type: str
    nullable: bool
    primary_key: bool


@dataclass
class ForeignKeyInfo:
    """Represents a database-level constraint pointing a column to a referenced table."""

    column: str
    referenced_table: str
    referenced_column: str


@dataclass
class TableInfo:
    """Represents top-level macroscopic statistics natively polled from a given schema."""

    name: str
    row_count_estimate: int
    columns: Optional[List[ColumnInfo]] = None
    foreign_keys: Optional[List[ForeignKeyInfo]] = None


@dataclass
class QueryResult:
    """Universal payload wrapping varying Engine driver row responses into a strict typing."""

    columns: Optional[List[str]] = None
    rows: Optional[List[Dict[str, Any]]] = None
    affected_rows: Optional[int] = None
    proto_msg: Optional[Any] = None


# ─────────────────────────────────────────────────────────────────────────────
# Abstract Implementation Protocol
# ─────────────────────────────────────────────────────────────────────────────


class DatabaseEngine(Protocol):
    """
    Strict typing contract ensuring all database drivers implement identical
    asynchronous interfaces for Axiom dynamic federation mapping.
    """

    async def connect(self) -> None:
        """Initializes raw driver connection pools to the remote persistent storage."""
        ...

    async def disconnect(self) -> None:
        """Gracefully shutters active pool connections to prevent query hangs or leaks."""
        ...

    async def health_check(self) -> bool:
        """Fast asynchronous connectivity test measuring alive state without mutating data."""
        ...

    async def list_tables(self) -> List[TableInfo]:
        """Dynamically introspects the connected database to map all targetable resources."""
        ...

    async def count_tables(self) -> int:
        """Fast scalar query to efficiently count tables without massive O(N) allocation."""
        ...

    async def describe_table(self, table: str) -> List[ColumnInfo]:
        """Extracts low-level entity boundaries for parameter validation mappings."""
        ...

    async def get_foreign_keys(self, table: str) -> List[ForeignKeyInfo]:
        """Introspects strict database-level relationships to power automatic graph resolution."""
        ...

    async def execute(
        self,
        sql: str,
        params: Optional[Dict[str, Any]] = None,
        return_format: str = "json",
    ) -> QueryResult:
        """Transmits sanitized parameterized statements directly to the target node."""
        ...

    @property
    def dialect(self) -> str:
        """Yields the target sqlglot AST parsing dialect compatible with this driver."""
        ...
