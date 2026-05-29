import time
from typing import Any, Dict, Optional

import orjson
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from api.database.handlers import (QueryExecutionPipeline, build_where_clause,
                                   get_db_engine)
from config.provider import GlobalConfigProvider
from server.middleware.auth import get_auth_context

from .compiler import ASTCompiler, GraphQLCompilerError

router = APIRouter(tags=["GraphQL"])


class GraphQLRequest(BaseModel):
    query: str
    operationName: Optional[str] = None
    variables: Optional[Dict[str, Any]] = None


async def _resolve_nested(
    engine,
    db_cfg,
    auth_context,
    request,
    db_alias,
    parent_table,
    parent_rows,
    nested_ops,
):
    if not parent_rows or not nested_ops:
        return

    for nested_op in nested_ops:
        child_table = nested_op["table"]

        try:
            fks = await engine.get_foreign_keys(child_table)
        except Exception:
            fks = []

        join_col_child = None
        join_col_parent = None
        for fk in fks:
            if fk.referenced_table == parent_table:
                join_col_child = fk.column
                join_col_parent = fk.referenced_column
                break

        if not join_col_child:
            join_col_child = f"{parent_table[:-1] if parent_table.endswith('s') else parent_table}_id"
            join_col_parent = "id"

        parent_ids = list(
            {
                r.get(join_col_parent)
                for r in parent_rows
                if r.get(join_col_parent) is not None
            }
        )
        if not parent_ids:
            for row in parent_rows:
                row[nested_op["alias"]] = []
            continue

        columns = ", ".join(nested_op["columns"]) if nested_op["columns"] else "*"
        if join_col_child not in nested_op["columns"] and nested_op["columns"]:
            columns += f", {join_col_child}"

        placeholders = ", ".join(f":p{i}" for i in range(len(parent_ids)))
        sql = f"SELECT {columns} FROM {child_table} WHERE {join_col_child} IN ({placeholders})"
        params = {f"p{i}": pid for i, pid in enumerate(parent_ids)}

        db_result = await QueryExecutionPipeline.run_query(
            engine=engine,
            db_cfg=db_cfg,
            auth=auth_context,
            request=request,
            db_name=db_alias,
            sql=sql,
            params=params,
        )
        child_rows = db_result.rows or []

        if nested_op.get("nested"):
            await _resolve_nested(
                engine,
                db_cfg,
                auth_context,
                request,
                db_alias,
                child_table,
                child_rows,
                nested_op["nested"],
            )

        from collections import defaultdict

        grouped = defaultdict(list)
        for cr in child_rows:
            grouped[cr[join_col_child]].append(cr)

        for pr in parent_rows:
            pr[nested_op["alias"]] = grouped.get(pr.get(join_col_parent), [])


@router.post("")
async def execute_graphql(
    request: Request,
    payload: GraphQLRequest,
    auth_context=Depends(get_auth_context),
):
    """
    High-performance GraphQL endpoint.
    Bypasses standard python resolvers and directly compiles AST to backend operations.
    """
    config = GlobalConfigProvider().get_config()
    if not config.features.graphql:
        return Response(status_code=404, content=b"GraphQL is disabled")

    from server.middleware.auth import feature_in_scope

    if not feature_in_scope("graphql", auth_context):
        return Response(
            status_code=403,
            content=b'{"errors":[{"message":"API key does not have permission to use the GraphQL subsystem."}]}',
            media_type="application/json",
        )

    start_time = time.perf_counter()

    try:
        # 1. Parse & Compile AST
        compiler = ASTCompiler(payload.query)
        operations = compiler.compile()

        # 2. Execute Operations
        results = {}
        for op in operations:
            alias = op.get("alias", "data")

            if op["type"] == "execute_sql":
                engine, db_cfg = await get_db_engine(op["db_alias"], auth_context)

                # Re-use existing high-performance query pipeline
                # This automatically applies WAF, query validation, transpilation, and caching
                db_result = await QueryExecutionPipeline.run_query(
                    engine=engine,
                    db_cfg=db_cfg,
                    auth=auth_context,
                    request=request,
                    db_name=op["db_alias"],
                    sql=op["sql"],
                    params=op["params"],
                )

                # Fast path: we just return the raw dictionary.
                # In the future, if the database returns a raw JSON string via JSON_AGG,
                # we can skip serialization here entirely.
                results[alias] = {
                    "columns": db_result.columns or [],
                    "rows": db_result.rows or [],
                    "affectedRows": db_result.affected_rows or 0,
                }

            elif op["type"] == "query_table":
                engine, db_cfg = await get_db_engine(op["db_alias"], auth_context)

                # Dynamically construct SQL from AST fields
                columns = ", ".join(op["columns"]) if op["columns"] else "*"
                table = op["table"]
                limit = op.get("limit", 50)
                offset = op.get("offset", 0)

                sql = f"SELECT {columns} FROM {table}"
                params = {}

                if op.get("filter"):
                    where_sql, filter_params = build_where_clause(op["filter"])
                    if where_sql:
                        sql += f" WHERE {where_sql}"
                        params.update(filter_params)

                sql += f" LIMIT {limit} OFFSET {offset}"

                db_result = await QueryExecutionPipeline.run_query(
                    engine=engine,
                    db_cfg=db_cfg,
                    auth=auth_context,
                    request=request,
                    db_name=op["db_alias"],
                    sql=sql,
                    params=params,
                )

                # Standard GraphQL expects an array of objects
                rows = db_result.rows or []

                if rows and op.get("nested"):
                    await _resolve_nested(
                        engine,
                        db_cfg,
                        auth_context,
                        request,
                        op["db_alias"],
                        op["table"],
                        rows,
                        op["nested"],
                    )

                results[alias] = rows

            elif op["type"] == "insert_table":
                engine, db_cfg = await get_db_engine(op["db_alias"], auth_context)
                affected = 0
                for row in op["rows"]:
                    cols = ", ".join(row.keys())
                    vals = ", ".join(f":{k}" for k in row.keys())
                    sql = f"INSERT INTO {op['table']} ({cols}) VALUES ({vals})"
                    res = await QueryExecutionPipeline.run_query(
                        engine, db_cfg, auth_context, request, op["db_alias"], sql, row
                    )
                    affected += res.affected_rows or 0
                results[alias] = {"affectedRows": affected}

            elif op["type"] == "update_table":
                engine, db_cfg = await get_db_engine(op["db_alias"], auth_context)
                set_clause = ", ".join(f"{k} = :_set_{k}" for k in op["update"].keys())
                sql = f"UPDATE {op['table']} SET {set_clause}"
                params = {f"_set_{k}": v for k, v in op["update"].items()}

                if op.get("filter"):
                    where_sql, filter_params = build_where_clause(op["filter"])
                    if where_sql:
                        sql += f" WHERE {where_sql}"
                        params.update(filter_params)

                res = await QueryExecutionPipeline.run_query(
                    engine, db_cfg, auth_context, request, op["db_alias"], sql, params
                )
                results[alias] = {"affectedRows": res.affected_rows or 0}

            elif op["type"] == "delete_table":
                engine, db_cfg = await get_db_engine(op["db_alias"], auth_context)
                sql = f"DELETE FROM {op['table']}"
                params = {}

                if op.get("filter"):
                    where_sql, filter_params = build_where_clause(op["filter"])
                    if where_sql:
                        sql += f" WHERE {where_sql}"
                        params.update(filter_params)
                else:
                    raise GraphQLCompilerError(
                        "DELETE mutations require a filter to prevent wiping tables."
                    )

                res = await QueryExecutionPipeline.run_query(
                    engine, db_cfg, auth_context, request, op["db_alias"], sql, params
                )
                results[alias] = {"affectedRows": res.affected_rows or 0}

            elif op["type"] == "list_databases":
                # Mock response for databases
                results[alias] = [
                    {"alias": k, "engine": v.engine, "mode": v.mode}
                    for k, v in config.database.items()
                ]

        duration_ms = (time.perf_counter() - start_time) * 1000

        # Build final response
        response_payload = {
            "data": results,
            "extensions": {"duration_ms": round(duration_ms, 3)},
        }

        return Response(
            content=orjson.dumps(response_payload), media_type="application/json"
        )

    except GraphQLCompilerError as e:
        return Response(
            status_code=400,
            content=orjson.dumps({"errors": [{"message": str(e)}]}),
            media_type="application/json",
        )
    except Exception as e:
        return Response(
            status_code=500,
            content=orjson.dumps(
                {"errors": [{"message": "Internal Server Error", "details": str(e)}]}
            ),
            media_type="application/json",
        )
