from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from config.schema import DatabaseDefConfig
from db.engines.base import (ColumnInfo, DatabaseEngine, ForeignKeyInfo,
                             QueryResult, TableInfo)
from encoding.proto_utils import _encode_value
from generated.axiom.v1 import db_pb2

# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────


def _normalize_uri(raw_uri: str) -> str:
    """Pre-configures URI strings to inject the rapid `asyncpg` bindings natively."""
    base = raw_uri.replace("postgres://", "postgresql+asyncpg://")
    return base.replace("postgresql://", "postgresql+asyncpg://")


def _extract_ssl_kwargs(uri: str) -> dict:
    """Infers mandatory encryption protocols straight from URI assignments."""
    if "ssl=true" in uri or "sslmode=require" in uri:
        return {"ssl": True}
    return {}


def _is_mutation_query(sql: str) -> bool:
    """Identifies explicitly state-altering queries clearly."""
    return (
        sql.strip()
        .upper()
        .startswith(
            ("INSERT", "UPDATE", "DELETE", "TRUNCATE", "DROP", "CREATE", "ALTER")
        )
    )


async def _execute_mutation(conn, statement, params: dict) -> QueryResult:
    """Executes destructive changes mapping with explicitly triggered pool commits."""
    result = await conn.execute(statement, params)
    await conn.commit()
    return QueryResult(affected_rows=result.rowcount)


async def _execute_read(
    conn, statement, params: dict, return_format: str
) -> QueryResult:
    """Executes standard transactional bounds fetching explicitly nested layouts."""
    result = await conn.execute(statement, params)
    columns = list(result.keys()) if result.keys() else []

    if not result.returns_rows:
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
# Core Driver
# ─────────────────────────────────────────────────────────────────────────────


class PostgresEngine(DatabaseEngine):
    """Provides high-performance hooks interacting directly over pg_hba compliant links."""

    def __init__(self, config: DatabaseDefConfig):
        standardized_uri = _normalize_uri(config.url)
        ssl_params = _extract_ssl_kwargs(config.url)
        overflow_buffer = max(0, config.pool_max - config.pool_min)

        self.engine: AsyncEngine = create_async_engine(
            standardized_uri,
            connect_args=ssl_params,
            pool_size=config.pool_min,
            max_overflow=overflow_buffer,
            pool_timeout=config.connection_timeout,
            pool_recycle=config.max_lifetime,
            pool_pre_ping=False,
        )

    async def connect(self) -> None:
        """Handled intrinsically by declarative connections."""
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
        sql = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        async with self.engine.connect() as conn:
            result = await conn.execute(text(sql))
            return [TableInfo(name=row[0], row_count_estimate=0) for row in result]

    async def count_tables(self) -> int:
        sql = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"
        async with self.engine.connect() as conn:
            result = await conn.execute(text(sql))
            return int(result.scalar() or 0)

    async def describe_table(self, table: str) -> List[ColumnInfo]:
        sql = "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = :table;"
        async with self.engine.connect() as conn:
            result = await conn.execute(text(sql), {"table": table})
            return [
                ColumnInfo(
                    name=row[0],
                    type=row[1],
                    nullable=(row[2] == "YES"),
                    primary_key=False,
                )
                for row in result
            ]

    async def get_foreign_keys(self, table: str) -> List[ForeignKeyInfo]:
        sql = """
        SELECT
            kcu.column_name,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column
        FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = :table;
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

    async def executemany(self, sql: str, params_list: list) -> int:
        """Batch-inserts multiple rows in a single database round-trip."""
        if not params_list:
            return 0
        async with self.engine.begin() as conn:
            result = await conn.execute(text(sql), params_list)
            return result.rowcount or 0

    @property
    def dialect(self) -> str:
        return "postgres"
