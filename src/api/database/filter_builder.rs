use serde_json::Value;
use std::collections::HashMap;

/// Recursively builds a WHERE clause and a vector of positional values.
/// Returns (clause, values).
pub fn build_where_clause(filter: &HashMap<String, Value>) -> (String, Vec<Value>) {
    let mut parts = Vec::new();
    let mut values = Vec::new();

    for (col, criteria) in filter {
        if col == "$or" || col == "$and" {
            let connector = if col == "$or" { " OR " } else { " AND " };
            if let Some(arr) = criteria.as_array() {
                let mut sub_clauses = Vec::new();
                for sub_filter in arr {
                    if let Some(obj) = sub_filter.as_object() {
                        // Recursively build
                        let mut map = HashMap::new();
                        for (k, v) in obj {
                            map.insert(k.clone(), v.clone());
                        }
                        let (sub_clause, mut sub_vals) = build_where_clause(&map);
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
        } else if let Some(obj) = criteria.as_object() {
            for (op, val) in obj {
                match op.as_str() {
                    "$eq" => {
                        parts.push(format!("{} = ?", col));
                        values.push(val.clone());
                    }
                    "$ne" => {
                        parts.push(format!("{} != ?", col));
                        values.push(val.clone());
                    }
                    "$gt" => {
                        parts.push(format!("{} > ?", col));
                        values.push(val.clone());
                    }
                    "$gte" => {
                        parts.push(format!("{} >= ?", col));
                        values.push(val.clone());
                    }
                    "$lt" => {
                        parts.push(format!("{} < ?", col));
                        values.push(val.clone());
                    }
                    "$lte" => {
                        parts.push(format!("{} <= ?", col));
                        values.push(val.clone());
                    }
                    "$like" => {
                        parts.push(format!("{} LIKE ?", col));
                        values.push(val.clone());
                    }
                    "$ilike" => {
                        parts.push(format!("LOWER({}) LIKE LOWER(?)", col));
                        values.push(val.clone());
                    }
                    "$in" | "$nin" => {
                        if let Some(arr) = val.as_array() {
                            let sql_op = if op == "$in" { "IN" } else { "NOT IN" };
                            let placeholders = vec!["?"; arr.len()].join(", ");
                            parts.push(format!("{} {} ({})", col, sql_op, placeholders));
                            for item in arr {
                                values.push(item.clone());
                            }
                        }
                    }
                    "$null" => {
                        if val.as_bool().unwrap_or(true) {
                            parts.push(format!("{} IS NULL", col));
                        } else {
                            parts.push(format!("{} IS NOT NULL", col));
                        }
                    }
                    "$not_null" => {
                        if val.as_bool().unwrap_or(true) {
                            parts.push(format!("{} IS NOT NULL", col));
                        } else {
                            parts.push(format!("{} IS NULL", col));
                        }
                    }
                    "$between" => {
                        if let Some(arr) = val.as_array() {
                            if arr.len() == 2 {
                                parts.push(format!("{} BETWEEN ? AND ?", col));
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
            parts.push(format!("{} = ?", col));
            values.push(criteria.clone());
        }
    }

    (parts.join(" AND "), values)
}

pub fn construct_insert(table: &str, data: &HashMap<String, Value>) -> (String, Vec<Value>) {
    let mut cols = Vec::new();
    let mut placeholders = Vec::new();
    let mut values = Vec::new();

    for (k, v) in data {
        cols.push(k.clone());
        placeholders.push("?");
        values.push(v.clone());
    }

    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        table,
        cols.join(", "),
        placeholders.join(", ")
    );

    (sql, values)
}

pub fn construct_update(
    table: &str,
    update_data: &HashMap<String, Value>,
    filter: &HashMap<String, Value>,
) -> (String, Vec<Value>) {
    let mut set_parts = Vec::new();
    let mut values = Vec::new();

    for (k, v) in update_data {
        set_parts.push(format!("{} = ?", k));
        values.push(v.clone());
    }

    let (where_clause, mut filter_vals) = build_where_clause(filter);
    values.append(&mut filter_vals);

    let sql = format!(
        "UPDATE {} SET {} WHERE {}",
        table,
        set_parts.join(", "),
        where_clause
    );

    (sql, values)
}

pub fn construct_delete(table: &str, filter: &HashMap<String, Value>) -> (String, Vec<Value>) {
    let (where_clause, values) = build_where_clause(filter);
    let sql = format!("DELETE FROM {} WHERE {}", table, where_clause);
    (sql, values)
}
