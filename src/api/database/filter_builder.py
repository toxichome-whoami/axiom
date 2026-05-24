import datetime
import re
from typing import Any, Dict, List, Tuple

_ISO8601_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$"
)


def _coerce_val(val: Any) -> Any:
    """Coerces ISO8601 date strings to Python datetime objects for strict SQL drivers."""
    if isinstance(val, str) and _ISO8601_RE.match(val):
        try:
            dt = datetime.datetime.fromisoformat(val.replace("Z", "+00:00"))
            return dt.replace(tzinfo=None)
        except Exception:
            pass
    return val


# ─────────────────────────────────────────────────────────────────────────────
# JSON Operator Translators
# ─────────────────────────────────────────────────────────────────────────────


def _process_array_operator(
    col: str, op: str, val: Any, pname: str, where_parts: list, params: dict
) -> None:
    """Matches JSON collection arrays explicitly against standard inclusion statements."""
    if not isinstance(val, (list, tuple)):
        raise ValueError(f"{op} operator requires a list or tuple structure array")

    sql_op = "IN" if op == "$in" else "NOT IN"
    in_placeholders = []

    for array_index, item in enumerate(val):
        in_pname = f"{pname}_{array_index}"
        in_placeholders.append(f":{in_pname}")
        params[in_pname] = _coerce_val(item)

    where_parts.append(f"{col} {sql_op} ({', '.join(in_placeholders)})")


def _process_null_operator(col: str, op: str, val: Any, where_parts: list) -> None:
    """Translates implicit JS definitions mapping dynamically to IS parameters."""
    if val is True:
        where_parts.append(f"{col} IS NULL" if op == "$null" else f"{col} IS NOT NULL")
    elif val is False:
        where_parts.append(f"{col} IS NOT NULL" if op == "$null" else f"{col} IS NULL")


def _process_standard_operator(
    col: str, op: str, val: Any, pname: str, where_parts: list, params: dict
) -> None:
    """Ingests basic operational tokens seamlessly."""
    math_ops = {"$gt": ">", "$gte": ">=", "$lt": "<", "$lte": "<="}

    if op == "$eq":
        where_parts.append(f"{col} = :{pname}")
    elif op == "$ne":
        where_parts.append(f"{col} != :{pname}")
    elif op in math_ops:
        where_parts.append(f"{col} {math_ops[op]} :{pname}")
    elif op == "$like":
        where_parts.append(f"{col} LIKE :{pname}")
    elif op == "$ilike":
        where_parts.append(f"LOWER({col}) LIKE LOWER(:{pname})")
    elif op == "$between":
        if not isinstance(val, list) or len(val) != 2:
            raise ValueError("$between requires a strictly bound list of 2 values")
        where_parts.append(f"{col} BETWEEN :{pname}_start AND :{pname}_end")
        params[f"{pname}_start"], params[f"{pname}_end"] = (
            _coerce_val(val[0]),
            _coerce_val(val[1]),
        )
        return
    else:
        raise ValueError(f"Operator node unsupported natively: {op}")

    params[pname] = _coerce_val(val)


def _route_filter_criteria(
    col: str, criteria: dict, param_idx: int, where_parts: list, params: dict
) -> int:
    """Isolates traversal logic bounding JSON nested trees directly."""
    for op, val in criteria.items():
        pname = f"__p_{param_idx}"
        param_idx += 1

        if op in ("$in", "$nin"):
            _process_array_operator(col, op, val, pname, where_parts, params)
        elif op in ("$null", "$not_null"):
            _process_null_operator(col, op, val, where_parts)
            param_idx -= 1
        else:
            _process_standard_operator(col, op, val, pname, where_parts, params)

    return param_idx


# ─────────────────────────────────────────────────────────────────────────────
# Recursive WHERE Clause Builder (supports $or / $and nesting)
# ─────────────────────────────────────────────────────────────────────────────


def _build_where_recursive(
    filter_json: Dict[str, Any], param_idx: int = 0
) -> Tuple[str, Dict[str, Any], int]:
    """
    Recursively converts a filter dict to a parameterized WHERE clause.
    Supports logical operators: $or, $and (each takes a list of sub-filters).

    Example:
        {"$or": [{"status": "active"}, {"role": "admin"}]}
        → "(status = :__p_0 OR role = :__p_1)"
    """
    where_parts: list = []
    params: Dict[str, Any] = {}

    for col, criteria in filter_json.items():
        # ── Logical operators: $or / $and ────────────────────────────────────
        if col in ("$or", "$and"):
            if not isinstance(criteria, list):
                raise ValueError(f"{col} requires a list of filter objects")
            connector = " OR " if col == "$or" else " AND "
            sub_clauses: List[str] = []
            for sub_filter in criteria:
                sub_clause, sub_params, param_idx = _build_where_recursive(
                    sub_filter, param_idx
                )
                if sub_clause:
                    sub_clauses.append(f"({sub_clause})")
                    params.update(sub_params)
            if sub_clauses:
                where_parts.append(f"({connector.join(sub_clauses)})")

        # ── Comparison operators: {"col": {"$gt": 5}} ───────────────────────
        elif isinstance(criteria, dict):
            param_idx = _route_filter_criteria(
                col, criteria, param_idx, where_parts, params
            )

        # ── Exact equality: {"col": value} ──────────────────────────────────
        else:
            pname = f"__p_{param_idx}"
            param_idx += 1
            where_parts.append(f"{col} = :{pname}")
            params[pname] = criteria

    return " AND ".join(where_parts), params, param_idx


# ─────────────────────────────────────────────────────────────────────────────
# Public WHERE Clause Interface
# ─────────────────────────────────────────────────────────────────────────────


def build_where_clause(filter_json: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    """
    Converts a JSON filter object into a parameterized SQL WHERE clause.

    Supported operators:
      $eq, $ne, $gt, $gte, $lt, $lte   — comparisons
      $like, $ilike                     — pattern matching
      $in, $nin                         — membership
      $between                          — range (requires [min, max] list)
      $null, $not_null                  — NULL checks
      $or, $and                         — logical nesting (list of sub-filters)
    """
    clause, params, _ = _build_where_recursive(filter_json)
    return clause, params


# ─────────────────────────────────────────────────────────────────────────────
# Dynamic SQL Generators
# ─────────────────────────────────────────────────────────────────────────────


def construct_insert(table: str, data: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    """Single-row INSERT with positional param names."""
    cols = list(data.keys())
    placeholders = [f":p_{i}" for i in range(len(cols))]
    sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
    return sql, {f"p_{i}": _coerce_val(val) for i, val in enumerate(data.values())}


def construct_bulk_insert(
    table: str, rows: List[Dict[str, Any]]
) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Generates a SINGLE INSERT statement with column-name params suitable for
    executemany, sending all rows to the database in ONE round-trip.

    Returns (sql, params_list) where params_list is a list of dicts —
    one per row — all keyed by column name.
    """
    if not rows:
        return "", []

    # Normalise: use the union of all column names, fill missing with None
    all_cols: List[str] = list(dict.fromkeys(col for row in rows for col in row))
    placeholders = ", ".join(f":{col}" for col in all_cols)
    sql = f"INSERT INTO {table} ({', '.join(all_cols)}) VALUES ({placeholders})"
    params_list = [{col: _coerce_val(row.get(col)) for col in all_cols} for row in rows]
    return sql, params_list


def construct_update(
    table: str, update_data: Dict[str, Any], filter_json: Dict[str, Any]
) -> Tuple[str, Dict[str, Any]]:
    set_parts = []
    params = {}

    for index, (col_key, col_val) in enumerate(update_data.items()):
        pname = f"up_p_{index}"
        set_parts.append(f"{col_key} = :{pname}")
        params[pname] = _coerce_val(col_val)

    where_clause, filter_params = build_where_clause(filter_json)
    if not where_clause:
        raise ValueError(
            "Update filter nodes cannot inherently be executed unconstrained."
        )

    params.update(filter_params)
    return f"UPDATE {table} SET {', '.join(set_parts)} WHERE {where_clause}", params


def construct_delete(
    table: str, filter_json: Dict[str, Any]
) -> Tuple[str, Dict[str, Any]]:
    where_clause, params = build_where_clause(filter_json)
    if not where_clause:
        raise ValueError("Delete operations mandate structurally bound node limits.")
    return f"DELETE FROM {table} WHERE {where_clause}", params
