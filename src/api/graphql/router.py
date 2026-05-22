import time
from typing import Any, Dict, Optional

import orjson
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from api.database.handlers import QueryExecutionPipeline, get_db_engine
from config.provider import GlobalConfigProvider
from server.middleware.auth import get_auth_context

from .compiler import ASTCompiler, GraphQLCompilerError

router = APIRouter(tags=["GraphQL"])


class GraphQLRequest(BaseModel):
    query: str
    operationName: Optional[str] = None
    variables: Optional[Dict[str, Any]] = None


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
