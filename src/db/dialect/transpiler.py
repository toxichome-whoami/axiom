import functools
from typing import Optional

import sqlglot
from sqlglot.errors import ParseError

# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────


def _resolve_target_dialect(to_dialect: str) -> str:
    """Normalizes generic engine names to literal parser definitions expected by SQLGlot."""
    if to_dialect == "mssql":
        return "tsql"
    return to_dialect


_ast_conversion_cache = None


def _get_ast_conversion_cache():
    global _ast_conversion_cache
    if _ast_conversion_cache is None:
        from config.provider import GlobalConfigProvider

        config = GlobalConfigProvider().get_config()
        maxsize = 4096
        if hasattr(config, "performance") and hasattr(
            config.performance, "transpiler_cache_size"
        ):
            maxsize = config.performance.transpiler_cache_size
        _ast_conversion_cache = functools.lru_cache(maxsize=maxsize)(
            _execute_ast_conversion_impl
        )
    return _ast_conversion_cache


def _execute_ast_conversion_impl(
    sql: str, to_dialect: str, from_dialect: Optional[str] = None
) -> str:
    """Applies profound Abstract Syntax Tree conversions mutating the raw queries securely."""
    try:
        # sqlglot.transpile handles AST conversion under the hood. Returns a list.
        result = sqlglot.transpile(sql, read=from_dialect, write=to_dialect)

        # Validation strictly enforces single-statement ingestion prior to this method
        return result[0]

    except ParseError as ast_error:
        from api.errors import ErrorCodes, AxiomException

        raise AxiomException(
            code=ErrorCodes.DB_QUERY_INVALID,
            message="Failed to parse SQL query.",
            details=str(ast_error),
            status_code=400,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Entrypoint Component
# ─────────────────────────────────────────────────────────────────────────────


def transpile_sql(sql: str, to_dialect: str, from_dialect: Optional[str] = None) -> str:
    """
    Consumes a generalized SQL dialect statement and generates a natively
    compliant statement identical in capability formatted for the given target.

    Supported targets correspond to generic driver architectures (e.g., 'postgres', 'mysql').
    """
    mapped_target = _resolve_target_dialect(to_dialect)
    cache_fn = _get_ast_conversion_cache()
    return cache_fn(sql, mapped_target, from_dialect)
