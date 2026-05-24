"""MSSQL (SQL Server) engine implementation using aioodbc."""

from typing import Any, Dict, List, Optional

try:
    HAS_AIOODBC = True
except ImportError:
    HAS_AIOODBC = False
    create_async_engine: Any = None
    AsyncEngine: Any = None
    text: Any = None

# ─────────────────────────────────────────────────────────────────────────────
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from config.schema import DatabaseDefConfig
from db.engines.base import (
    ColumnInfo,
    DatabaseEngine,
    ForeignKeyInfo,
    QueryResult,
    TableInfo,
)
from encoding.proto_utils import _encode_value
from generated.axiom.v1 import db_pb2

# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────


def _normalize_uri(raw_uri: str) -> str:
    """Safely transposes human-readable schemes to driver-specific representations."""
    if raw_uri.startswith("mssql://"):
        return raw_uri.replace("mssql://", "mssql+aioodbc://")
    if raw_uri.startswith("sqlserver://"):
        return raw_uri.replace("sqlserver://", "mssql+aioodbc://")
    return raw_uri


def _is_mutation_query(sql: str) -> bool:
    """Determines if the raw payload enforces write locks or mutates schema/data."""
    return (
        sql.strip()
        .upper()
        .startswith(
            ("INSERT", "UPDATE", "DELETE", "TRUNCATE", "DROP", "CREATE", "ALTER")
        )
    )


async def _execute_mutation(conn, statement, params: dict) -> QueryResult:
    """Dispatches a mutation and forces an explicit commit."""
    result = await conn.execute(statement, params)
    await conn.commit()
    return QueryResult(affected_rows=result.rowcount)


async def _execute_read(
    conn, statement, params: dict, return_format: str
) -> QueryResult:
    """Resolves standard non-mutating statements into explicit mapping lists."""
    result = await conn.execute(statement, params)
    columns = list(result.keys()) if result.keys() else []

    if not result.returns_rows:
        # Commit dynamically to free isolation level row locks gracefully
        await conn.commit()
        return QueryResult(columns=columns, rows=[], affected_rows=result.rowcount)

    if return_format == "protobuf":
        pb = db_pb2.ExecuteQueryResponse()
        pb.columns.extend(columns)

        for row in result:
            pb_row = pb.rows.add()
            for val in row:
                _encode_value(pb_row.values.add(), val)

        return QueryResult(columns=columns, affected_rows=result.rowcount, proto_msg=pb)
    else:
        rows = [dict(row._mapping) for row in result]
        return QueryResult(columns=columns, rows=rows, affected_rows=result.rowcount)


# ─────────────────────────────────────────────────────────────────────────────
# MSSQL Driver
# ─────────────────────────────────────────────────────────────────────────────


class MSSQLEngine(DatabaseEngine):
    """Microsoft SQL Server async engine via aioodbc + SQLAlchemy."""

    def __init__(self, config: DatabaseDefConfig):
        if not HAS_AIOODBC:
            raise RuntimeError(
                "MSSQL support requires: pip install aioodbc pyodbc. "
                "Install via: pip install axiom[mssql]"
            )

        standardized_uri = _normalize_uri(config.url)
        overflow_buffer = max(0, config.pool_max - config.pool_min)

        self.engine: Any = create_async_engine(
            standardized_uri,
            pool_size=config.pool_min,
            max_overflow=overflow_buffer,
            pool_timeout=config.connection_timeout,
            pool_recycle=config.max_lifetime,
            pool_pre_ping=False,
        )

    async def connect(self) -> None:
        """Driver pools are natively managed by the lazy-loading SQLAlchemy core."""
        pass

    async def disconnect(self) -> None:
        await self.engine.dispose()

    async def health_check(self) -> bool:
        try:
            async with self.engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    async def list_tables(self) -> List[TableInfo]:
        sql = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
        async with self.engine.connect() as conn:
            result = await conn.execute(text(sql))
            return [TableInfo(name=row[0], row_count_estimate=0) for row in result]

    async def count_tables(self) -> int:
        sql = "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'"
        async with self.engine.connect() as conn:
            result = await conn.execute(text(sql))
            return result.scalar()

    async def describe_table(self, table: str) -> List[ColumnInfo]:
        sql = """
        SELECT
            c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE,
            CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PK
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN (
            SELECT ku.COLUMN_NAME
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
            WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND ku.TABLE_NAME = :table
        ) pk ON pk.COLUMN_NAME = c.COLUMN_NAME
        WHERE c.TABLE_NAME = :table
        ORDER BY c.ORDINAL_POSITION
        """
        async with self.engine.connect() as conn:
            result = await conn.execute(text(sql), {"table": table})
            return [
                ColumnInfo(
                    name=row[0],
                    type=row[1],
                    nullable=(row[2] == "YES"),
                    primary_key=bool(row[3]),
                )
                for row in result
            ]

    async def get_foreign_keys(self, table: str) -> List[ForeignKeyInfo]:
        sql = """
        SELECT
            c.name AS column_name,
            OBJECT_NAME(fk.referenced_object_id) AS referenced_table,
            rc.name AS referenced_column
        FROM sys.foreign_keys fk
        INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        INNER JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
        INNER JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
        WHERE OBJECT_NAME(fk.parent_object_id) = :table;
        """
        async with self.engine.connect() as conn:
            result = await conn.execute(text(sql), {"table": table})
            return [
                ForeignKeyInfo(
                    column=row[0],
                    referenced_table=row[1],
                    referenced_column=row[2],
                )
                for row in result
            ]

    async def execute(
        self,
        sql: str,
        params: Optional[Dict[str, Any]] = None,
        return_format: str = "json",
    ) -> QueryResult:
        query_params = params or {}
        statement = text(sql)

        async with self.engine.connect() as conn:
            if _is_mutation_query(sql):
                return await _execute_mutation(conn, statement, query_params)
            return await _execute_read(conn, statement, query_params, return_format)

    @property
    def dialect(self) -> str:
        return "tsql"
