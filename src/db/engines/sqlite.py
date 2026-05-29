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
    """Pre-configures URIs injecting the correct asynchronous wrappers."""
    if not raw_uri.startswith("sqlite+aiosqlite://"):
        if raw_uri.startswith("sqlite://"):
            return raw_uri.replace("sqlite://", "sqlite+aiosqlite://")
        return f"sqlite+aiosqlite:///{raw_uri}"
    return raw_uri


def _is_mutation_query(sql: str) -> bool:
    """Identifies expressly mutating operations."""
    return (
        sql.strip()
        .upper()
        .startswith(
            ("INSERT", "UPDATE", "DELETE", "TRUNCATE", "DROP", "CREATE", "ALTER")
        )
    )


async def _execute_mutation(conn, statement, params: dict) -> QueryResult:
    """Executes destructive changes mapping with strictly blocked local commits."""
    result = await conn.execute(statement, params)
    await conn.commit()
    return QueryResult(affected_rows=result.rowcount)


async def _execute_read(
    conn, statement, params: dict, return_format: str
) -> QueryResult:
    """Returns pure non-mutating extractions bypassing unnecessary locks."""
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
# Core SQLite Engine Protocol
# ─────────────────────────────────────────────────────────────────────────────


class SQLiteEngine(DatabaseEngine):
    """Provides pure filesystem-backed persistence mappings natively."""

    def __init__(self, config: DatabaseDefConfig):
        standardized_uri = _normalize_uri(config.url)

        self.engine: AsyncEngine = create_async_engine(
            standardized_uri,
            pool_size=config.pool_max,
            max_overflow=config.pool_max,
            pool_timeout=config.connection_timeout,
            pool_recycle=config.max_lifetime,
        )

        from sqlalchemy import event
        import sqlite_vec  # type: ignore

        @event.listens_for(self.engine.sync_engine, "connect")
        def receive_connect(dbapi_connection, connection_record):
            dbapi_connection.enable_load_extension(True)
            sqlite_vec.load(dbapi_connection)
            dbapi_connection.enable_load_extension(False)

    async def connect(self) -> None:
        """Handled purely by AioSQLite background engine proxies."""
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
        sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
        async with self.engine.connect() as conn:
            result = await conn.execute(text(sql))
            return [TableInfo(name=row[0], row_count_estimate=0) for row in result]

    async def count_tables(self) -> int:
        sql = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
        async with self.engine.connect() as conn:
            result = await conn.execute(text(sql))
            return int(result.scalar() or 0)

    async def describe_table(self, table: str) -> List[ColumnInfo]:
        sql = f"PRAGMA table_info({table});"
        async with self.engine.connect() as conn:
            result = await conn.execute(text(sql))
            return [
                ColumnInfo(
                    name=row[1],
                    type=row[2],
                    nullable=not row[3],
                    primary_key=bool(row[5]),
                )
                for row in result
            ]

    async def get_foreign_keys(self, table: str) -> List[ForeignKeyInfo]:
        sql = f"PRAGMA foreign_key_list({table});"
        async with self.engine.connect() as conn:
            result = await conn.execute(text(sql))
            return [
                ForeignKeyInfo(
                    column=row[3],
                    referenced_table=row[2],
                    referenced_column=row[4],
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

    async def setup_fts5_index(self, table: str, columns: List[str]) -> None:
        """Dynamically creates an FTS5 virtual table synchronized via zero-RAM database triggers."""
        fts_table = f"{table}_fts"
        cols_str = ", ".join(columns)
        new_cols_str = ", ".join(f"new.{c}" for c in columns)
        old_cols_str = ", ".join(f"old.{c}" for c in columns)
        
        async with self.engine.begin() as conn:
            await conn.execute(text(f"CREATE VIRTUAL TABLE IF NOT EXISTS {fts_table} USING fts5({cols_str}, content='{table}', content_rowid='rowid');"))
            await conn.execute(text(f"CREATE TRIGGER IF NOT EXISTS {fts_table}_ai AFTER INSERT ON {table} BEGIN INSERT INTO {fts_table}(rowid, {cols_str}) VALUES (new.rowid, {new_cols_str}); END;"))
            await conn.execute(text(f"CREATE TRIGGER IF NOT EXISTS {fts_table}_ad AFTER DELETE ON {table} BEGIN INSERT INTO {fts_table}({fts_table}, rowid, {cols_str}) VALUES('delete', old.rowid, {old_cols_str}); END;"))
            await conn.execute(text(f"CREATE TRIGGER IF NOT EXISTS {fts_table}_au AFTER UPDATE ON {table} BEGIN INSERT INTO {fts_table}({fts_table}, rowid, {cols_str}) VALUES('delete', old.rowid, {old_cols_str}); INSERT INTO {fts_table}(rowid, {cols_str}) VALUES (new.rowid, {new_cols_str}); END;"))

    @property
    def dialect(self) -> str:
        return "sqlite"
