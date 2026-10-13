/*
 * Safe SQL WHERE clause generator, CRUD SQL builder, and SQL identifier sanitizer.
 * Owned by: crates/api (database)
 * Key deps: serde_json
 * Invariants: All user-supplied column/table identifiers are strictly filtered to alphanumeric and underscore characters;
 *             all literal values are extracted into parameterized positional values with '?' placeholders to prevent SQL injection.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use axiom_core::ColumnInfo;
use serde_json::Value;
use std::collections::HashMap;

/// Coerces string filter criteria values into strongly typed numbers or booleans
/// if the target column schema type is numeric or boolean.
/// This prevents type mismatch errors in strictly typed databases (like PostgreSQL).
pub fn coerce_filter_values(filter: &mut HashMap<String, Value>, columns: &[ColumnInfo]) {
    for (key, criteria) in filter.iter_mut() {
        if key == "$or" || key == "$and" {
            if let Some(arr) = criteria.as_array_mut() {
                for item in arr {
                    if let Some(obj) = item.as_object_mut() {
                        let mut sub_map: HashMap<String, Value> = obj.clone().into_iter().collect();
                        coerce_filter_values(&mut sub_map, columns);
                        *item = serde_json::to_value(sub_map).unwrap_or_default();
                    }
                }
            }
        } else {
            if let Some(col_info) = columns.iter().find(|c| c.name.eq_ignore_ascii_case(key)) {
                let ty = col_info.r#type.to_lowercase();
                let is_int = ty.contains("int") || ty.contains("serial");
                let is_float = ty.contains("float")
                    || ty.contains("double")
                    || ty.contains("real")
                    || ty.contains("num")
                    || ty.contains("dec");
                let is_bool = ty.contains("bool");

                let coerce_single = |val: &mut Value| {
                    if let Value::String(s) = val {
                        let trimmed = s.trim();
                        if is_int {
                            if let Ok(i) = trimmed.parse::<i64>() {
                                *val = Value::Number(i.into());
                            }
                        } else if is_float {
                            if let Ok(f) = trimmed.parse::<f64>() {
                                if let Some(n) = serde_json::Number::from_f64(f) {
                                    *val = Value::Number(n);
                                }
                            }
                        } else if is_bool {
                            if trimmed.eq_ignore_ascii_case("true") {
                                *val = Value::Bool(true);
                            } else if trimmed.eq_ignore_ascii_case("false") {
                                *val = Value::Bool(false);
                            }
                        }
                    }
                };

                if let Some(obj) = criteria.as_object_mut() {
                    for (_op, op_val) in obj.iter_mut() {
                        if let Some(arr) = op_val.as_array_mut() {
                            for item in arr {
                                coerce_single(item);
                            }
                        } else {
                            coerce_single(op_val);
                        }
                    }
                } else {
                    coerce_single(criteria);
                }
            }
        }
    }
}

/// Coerces string record values in insert/update data into strongly typed numbers or booleans
/// if the target column schema type is numeric or boolean.
pub fn coerce_record_values(record: &mut HashMap<String, Value>, columns: &[ColumnInfo]) {
    for (key, val) in record.iter_mut() {
        if let Some(col_info) = columns.iter().find(|c| c.name.eq_ignore_ascii_case(key)) {
            let ty = col_info.r#type.to_lowercase();
            let is_int = ty.contains("int") || ty.contains("serial");
            let is_float = ty.contains("float")
                || ty.contains("double")
                || ty.contains("real")
                || ty.contains("num")
                || ty.contains("dec");
            let is_bool = ty.contains("bool");

            if let Value::String(s) = val {
                let trimmed = s.trim();
                if is_int {
                    if let Ok(i) = trimmed.parse::<i64>() {
                        *val = Value::Number(i.into());
                    }
                } else if is_float {
                    if let Ok(f) = trimmed.parse::<f64>() {
                        if let Some(n) = serde_json::Number::from_f64(f) {
                            *val = Value::Number(n);
                        }
                    }
                } else if is_bool {
                    if trimmed.eq_ignore_ascii_case("true") {
                        *val = Value::Bool(true);
                    } else if trimmed.eq_ignore_ascii_case("false") {
                        *val = Value::Bool(false);
                    }
                }
            }
        }
    }
}

/// Strips all characters from an identifier except alphanumeric characters and underscores.
/// CONTRACT:
///  - Precondition: `ident` string reference.
///  - Returns sanitized string safe for unquoted SQL identifier placement.
///  - Idempotent: Yes. Pure function with zero allocations beyond the returned string.
pub fn sanitize_ident(ident: &str) -> std::borrow::Cow<'_, str> {
    if ident.chars().all(|c| c.is_alphanumeric() || c == '_') {
        std::borrow::Cow::Borrowed(ident)
    } else {
        std::borrow::Cow::Owned(
            ident
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '_')
                .collect(),
        )
    }
}

/// Wraps an identifier with dialect-specific quotes to safely handle SQL reserved keywords and case sensitivity.
pub fn quote_ident_dialect(ident: &str, dialect: &str) -> String {
    let clean = sanitize_ident(ident);
    let d = dialect.to_lowercase();
    if d.contains("mysql") || d.contains("mariadb") {
        format!("`{}`", clean.replace('`', "``"))
    } else if d.contains("mssql") || d.contains("sqlserver") {
        format!("[{}]", clean.replace(']', "]]"))
    } else {
        // PostgreSQL, SQLite, LibSQL, ClickHouse, Generic
        format!("\"{}\"", clean.replace('"', "\"\""))
    }
}

/// Recursively builds a parameterized SQL WHERE clause and corresponding positional parameter values.
/// CONTRACT:
///  - Precondition: `filter` map representing JSON query expressions (supports `$eq`, `$gt`, `$in`, `$or`, etc.).
///  - Returns `(clause_string, values_vector)`. If filter is empty, clause_string is empty.
///  - Guarantees: All identifiers sanitized via `sanitize_ident`; all values returned separately for parameterized execution.
pub fn build_where_clause(filter: &HashMap<String, Value>) -> (String, Vec<Value>) {
    build_where_clause_inner(filter.iter())
}

fn build_where_clause_inner<'a, I>(filter: I) -> (String, Vec<Value>)
where
    I: Iterator<Item = (&'a String, &'a Value)>,
{
    let mut parts = Vec::new();
    let mut values = Vec::new();

    for (col, criteria) in filter {
        if col == "$or" || col == "$and" {
            let connector = if col == "$or" { " OR " } else { " AND " };
            if let Some(arr) = criteria.as_array() {
                let mut sub_clauses = Vec::new();
                for sub_filter in arr {
                    if let Some(obj) = sub_filter.as_object() {
                        let (sub_clause, mut sub_vals) = build_where_clause_inner(obj.iter());
                        if !sub_clause.is_empty() {
                            sub_clauses.push(format!("({})", sub_clause));
                            values.append(&mut sub_vals);
                        }
                    }
                }
                if !sub_clauses.is_empty() {
                    parts.push(format!("({})", sub_clauses.join(connector)));
                }
            }
        } else {
            let clean_col = sanitize_ident(col);
            if clean_col.is_empty() {
                continue;
            }
            if let Some(obj) = criteria.as_object() {
                for (op, val) in obj {
                    let norm_op = op.strip_prefix('$').unwrap_or(op.as_str());
                    match norm_op {
                        "eq" => {
                            parts.push(format!("{} = ?", clean_col));
                            values.push(val.clone());
                        }
                        "ne" | "neq" => {
                            parts.push(format!("{} != ?", clean_col));
                            values.push(val.clone());
                        }
                        "gt" => {
                            parts.push(format!("{} > ?", clean_col));
                            values.push(val.clone());
                        }
                        "gte" => {
                            parts.push(format!("{} >= ?", clean_col));
                            values.push(val.clone());
                        }
                        "lt" => {
                            parts.push(format!("{} < ?", clean_col));
                            values.push(val.clone());
                        }
                        "lte" => {
                            parts.push(format!("{} <= ?", clean_col));
                            values.push(val.clone());
                        }
                        "like" => {
                            parts.push(format!("{} LIKE ?", clean_col));
                            values.push(val.clone());
                        }
                        "ilike" => {
                            parts.push(format!("LOWER({}) LIKE LOWER(?)", clean_col));
                            values.push(val.clone());
                        }
                        "in" | "nin" => {
                            if let Some(arr) = val.as_array() {
                                let sql_op = if norm_op == "in" { "IN" } else { "NOT IN" };
                                let placeholders = vec!["?"; arr.len()].join(", ");
                                parts.push(format!(
                                    "{} {} ({})",
                                    clean_col,
                                    sql_op,
                                    placeholders
                                ));
                                for item in arr {
                                    values.push(item.clone());
                                }
                            }
                        }
                        "null" | "is_null" => {
                            if val.as_bool().unwrap_or(true) {
                                parts.push(format!("{} IS NULL", clean_col));
                            } else {
                                parts.push(format!("{} IS NOT NULL", clean_col));
                            }
                        }
                        "not_null" | "is_not_null" => {
                            if val.as_bool().unwrap_or(true) {
                                parts.push(format!("{} IS NOT NULL", clean_col));
                            } else {
                                parts.push(format!("{} IS NULL", clean_col));
                            }
                        }
                        "between" => {
                            if let Some(arr) = val.as_array() {
                                if arr.len() == 2 {
                                    parts.push(format!("{} BETWEEN ? AND ?", clean_col));
                                    values.push(arr[0].clone());
                                    values.push(arr[1].clone());
                                }
                            }
                        }
                        _ => {} // Ignore unsupported operators
                    }
                }
            } else {
                // Exact equality
                parts.push(format!("{} = ?", clean_col));
                values.push(criteria.clone());
            }
        }
    }

    (parts.join(" AND "), values)
}

// ─── CRUD Statement Generation ──────────────────────────────────────────────
// Parameterized SQL generation for direct single-table operations.

/// Generates a parameterized INSERT statement and parameter bindings from a key-value record map.
/// CONTRACT:
///  - Precondition: `table` is non-empty; `data` contains column-to-value mappings.
///  - Returns `(sql_string, parameters)`.
///  - Guarantees: All column names sanitized via `sanitize_ident`.
pub fn construct_insert(table: &str, data: &HashMap<String, Value>) -> (String, Vec<Value>) {
    let mut cols = Vec::new();
    let mut placeholders = Vec::new();
    let mut values = Vec::new();

    for (k, v) in data {
        let clean_k = sanitize_ident(k);
        if clean_k.is_empty() {
            continue;
        }
        cols.push(clean_k);
        placeholders.push("?");
        values.push(v.clone());
    }

    if cols.is_empty() {
        return (String::new(), Vec::new());
    }

    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        sanitize_ident(table),
        cols.join(", "),
        placeholders.join(", ")
    );

    (sql, values)
}

/// Generates a parameterized UPDATE statement with sanitized SET columns and WHERE predicate.
/// CONTRACT:
///  - Precondition: `table` is non-empty; `update_data` contains new values; `filter` defines target rows.
///  - Returns `(sql_string, parameters)`.
pub fn construct_update(
    table: &str,
    update_data: &HashMap<String, Value>,
    filter: &HashMap<String, Value>,
) -> (String, Vec<Value>) {
    let mut set_parts = Vec::new();
    let mut values = Vec::new();

    for (k, v) in update_data {
        let clean_k = sanitize_ident(k);
        if clean_k.is_empty() {
            continue;
        }
        set_parts.push(format!("{} = ?", clean_k));
        values.push(v.clone());
    }

    if set_parts.is_empty() {
        return (String::new(), Vec::new());
    }

    let (where_clause, mut filter_vals) = build_where_clause(filter);
    values.append(&mut filter_vals);

    let sql = format!(
        "UPDATE {} SET {} WHERE {}",
        sanitize_ident(table),
        set_parts.join(", "),
        where_clause
    );

    (sql, values)
}

/// Generates a parameterized DELETE statement with a sanitized WHERE predicate.
/// CONTRACT:
///  - Precondition: `table` is non-empty; `filter` defines rows to delete.
///  - Returns `(sql_string, parameters)`.
pub fn construct_delete(table: &str, filter: &HashMap<String, Value>) -> (String, Vec<Value>) {
    let (where_clause, values) = build_where_clause(filter);
    let sql = format!(
        "DELETE FROM {} WHERE {}",
        sanitize_ident(table),
        where_clause
    );
    (sql, values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_construct_insert() {
        let mut data = HashMap::new();
        data.insert("name".to_string(), json!("alice"));
        data.insert("age".to_string(), json!(30));
        let (sql, values) = construct_insert("users", &data);
        assert!(sql.starts_with("INSERT INTO users"));
        assert_eq!(values.len(), 2);
    }

    #[test]
    fn test_construct_insert_sanitize_table() {
        let mut data = HashMap::new();
        data.insert("id".to_string(), json!(1));
        let (sql, _) = construct_insert("users; DROP TABLE x", &data);
        assert!(sql.contains("usersDROPTABLEx"));
        assert!(!sql.contains(";"));
    }

    #[test]
    fn test_construct_update() {
        let mut update_data = HashMap::new();
        update_data.insert("name".to_string(), json!("bob"));
        
        let mut filter = HashMap::new();
        filter.insert("id".to_string(), json!({ "$eq": 1 }));
        
        let (sql, values) = construct_update("users", &update_data, &filter);
        assert!(sql.starts_with("UPDATE users SET"));
        assert!(sql.contains("WHERE id = ?"));
        assert_eq!(values.len(), 2);
    }

    #[test]
    fn test_construct_delete() {
        let mut filter = HashMap::new();
        filter.insert("id".to_string(), json!({ "$eq": 42 }));
        
        let (sql, values) = construct_delete("users", &filter);
        assert_eq!(sql, "DELETE FROM users WHERE id = ?");
        assert_eq!(values.len(), 1);
    }

    #[test]
    fn test_build_where_clause_operators() {
        let mut f = HashMap::new();
        
        f.insert("f_ne".to_string(), json!({ "$ne": 1 }));
        let (sql, _) = build_where_clause(&f);
        assert!(sql.contains("f_ne != ?"));

        f.clear();
        f.insert("f_gt".to_string(), json!({ "$gt": 1 }));
        f.insert("f_gte".to_string(), json!({ "$gte": 1 }));
        f.insert("f_lt".to_string(), json!({ "$lt": 1 }));
        f.insert("f_lte".to_string(), json!({ "$lte": 1 }));
        let (sql, _) = build_where_clause(&f);
        assert!(sql.contains("f_gt > ?"));
        assert!(sql.contains("f_gte >= ?"));
        assert!(sql.contains("f_lt < ?"));
        assert!(sql.contains("f_lte <= ?"));

        f.clear();
        f.insert("f_ilike".to_string(), json!({ "$ilike": "a" }));
        let (sql, _) = build_where_clause(&f);
        assert!(sql.contains("LOWER(f_ilike) LIKE LOWER(?)"));

        f.clear();
        f.insert("f_in".to_string(), json!({ "$in": [1, 2, 3] }));
        let (sql, _) = build_where_clause(&f);
        assert!(sql.contains("f_in IN (?, ?, ?)"));

        f.clear();
        f.insert("f_nin".to_string(), json!({ "$nin": [1] }));
        let (sql, _) = build_where_clause(&f);
        assert!(sql.contains("f_nin NOT IN (?)"));

        f.clear();
        f.insert("f_null_true".to_string(), json!({ "$null": true }));
        let (sql, _) = build_where_clause(&f);
        assert!(sql.contains("f_null_true IS NULL"));

        f.clear();
        f.insert("f_null_false".to_string(), json!({ "$null": false }));
        let (sql, _) = build_where_clause(&f);
        assert!(sql.contains("f_null_false IS NOT NULL"));

        f.clear();
        f.insert("f_not_null_true".to_string(), json!({ "$not_null": true }));
        let (sql, _) = build_where_clause(&f);
        assert!(sql.contains("f_not_null_true IS NOT NULL"));

        f.clear();
        f.insert("f_between".to_string(), json!({ "$between": [10, 20] }));
        let (sql, vals) = build_where_clause(&f);
        assert!(sql.contains("f_between BETWEEN ? AND ?"));
        assert_eq!(vals.len(), 2);

        f.clear();
        f.insert("status".to_string(), json!("active"));
        let (sql, _) = build_where_clause(&f);
        assert!(sql.contains("status = ?"));
    }

    #[test]
    fn test_sanitize_ident() {
        assert_eq!(sanitize_ident("val!d_123;--"), "vald_123");
    }

    #[test]
    fn test_coerce_filter_values() {
        let cols = vec![
            ColumnInfo {
                name: "id".to_string(),
                r#type: "integer".to_string(),
                nullable: false,
                primary_key: true,
            },
            ColumnInfo {
                name: "price".to_string(),
                r#type: "numeric".to_string(),
                nullable: true,
                primary_key: false,
            },
            ColumnInfo {
                name: "is_active".to_string(),
                r#type: "boolean".to_string(),
                nullable: false,
                primary_key: false,
            },
            ColumnInfo {
                name: "title".to_string(),
                r#type: "varchar".to_string(),
                nullable: false,
                primary_key: false,
            },
        ];

        let mut filter = HashMap::new();
        filter.insert("id".to_string(), json!({ "eq": "42" }));
        filter.insert("price".to_string(), json!({ "gte": "19.99" }));
        filter.insert("is_active".to_string(), json!({ "eq": "true" }));
        filter.insert("title".to_string(), json!({ "eq": "123" }));

        coerce_filter_values(&mut filter, &cols);

        assert_eq!(filter.get("id").unwrap().get("eq").unwrap(), &json!(42));
        assert_eq!(filter.get("price").unwrap().get("gte").unwrap(), &json!(19.99));
        assert_eq!(filter.get("is_active").unwrap().get("eq").unwrap(), &json!(true));
        assert_eq!(filter.get("title").unwrap().get("eq").unwrap(), &json!("123"));
    }

    #[test]
    fn test_coerce_record_values() {
        let cols = vec![
            ColumnInfo {
                name: "id".to_string(),
                r#type: "bigint".to_string(),
                nullable: false,
                primary_key: true,
            },
            ColumnInfo {
                name: "amount".to_string(),
                r#type: "float8".to_string(),
                nullable: true,
                primary_key: false,
            },
            ColumnInfo {
                name: "verified".to_string(),
                r#type: "bool".to_string(),
                nullable: false,
                primary_key: false,
            },
            ColumnInfo {
                name: "notes".to_string(),
                r#type: "text".to_string(),
                nullable: true,
                primary_key: false,
            },
        ];

        let mut record = HashMap::new();
        record.insert("id".to_string(), json!("1001"));
        record.insert("amount".to_string(), json!("99.5"));
        record.insert("verified".to_string(), json!("true"));
        record.insert("notes".to_string(), json!("12345"));

        coerce_record_values(&mut record, &cols);

        assert_eq!(record.get("id").unwrap(), &json!(1001));
        assert_eq!(record.get("amount").unwrap(), &json!(99.5));
        assert_eq!(record.get("verified").unwrap(), &json!(true));
        assert_eq!(record.get("notes").unwrap(), &json!("12345"));
    }

    #[test]
    fn test_construct_insert_and_update_empty_columns() {
        // 1. Completely empty map
        let empty_map = HashMap::new();
        let (insert_sql_1, insert_vals_1) = construct_insert("users", &empty_map);
        assert!(insert_sql_1.is_empty());
        assert!(insert_vals_1.is_empty());

        let (update_sql_1, update_vals_1) = construct_update("users", &empty_map, &empty_map);
        assert!(update_sql_1.is_empty());
        assert!(update_vals_1.is_empty());

        // 2. Map containing only non-alphanumeric/invalid keys that sanitize to empty strings
        let mut invalid_map = HashMap::new();
        invalid_map.insert("$$$".to_string(), json!("val"));
        invalid_map.insert("   ".to_string(), json!("val2"));

        let (insert_sql_2, insert_vals_2) = construct_insert("users", &invalid_map);
        assert!(insert_sql_2.is_empty());
        assert!(insert_vals_2.is_empty());

        let (update_sql_2, update_vals_2) = construct_update("users", &invalid_map, &empty_map);
        assert!(update_sql_2.is_empty());
        assert!(update_vals_2.is_empty());

        // 3. Valid map works normally
        let mut valid_map = HashMap::new();
        valid_map.insert("name".to_string(), json!("Alice"));
        let (insert_sql_3, insert_vals_3) = construct_insert("users", &valid_map);
        assert_eq!(insert_sql_3, "INSERT INTO users (name) VALUES (?)");
        assert_eq!(insert_vals_3, vec![json!("Alice")]);
    }
}
