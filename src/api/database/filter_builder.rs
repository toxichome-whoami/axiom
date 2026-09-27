use serde_json::Value;
use std::collections::HashMap;

pub fn sanitize_ident(ident: &str) -> String {
    ident
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_')
        .collect()
}

/// Recursively builds a WHERE clause and a vector of positional values.
/// Returns (clause, values).
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
        } else if let Some(obj) = criteria.as_object() {
            for (op, val) in obj {
                match op.as_str() {
                    "$eq" => {
                        parts.push(format!("{} = ?", sanitize_ident(col)));
                        values.push(val.clone());
                    }
                    "$ne" => {
                        parts.push(format!("{} != ?", sanitize_ident(col)));
                        values.push(val.clone());
                    }
                    "$gt" => {
                        parts.push(format!("{} > ?", sanitize_ident(col)));
                        values.push(val.clone());
                    }
                    "$gte" => {
                        parts.push(format!("{} >= ?", sanitize_ident(col)));
                        values.push(val.clone());
                    }
                    "$lt" => {
                        parts.push(format!("{} < ?", sanitize_ident(col)));
                        values.push(val.clone());
                    }
                    "$lte" => {
                        parts.push(format!("{} <= ?", sanitize_ident(col)));
                        values.push(val.clone());
                    }
                    "$like" => {
                        parts.push(format!("{} LIKE ?", sanitize_ident(col)));
                        values.push(val.clone());
                    }
                    "$ilike" => {
                        parts.push(format!("LOWER({}) LIKE LOWER(?)", sanitize_ident(col)));
                        values.push(val.clone());
                    }
                    "$in" | "$nin" => {
                        if let Some(arr) = val.as_array() {
                            let sql_op = if op == "$in" { "IN" } else { "NOT IN" };
                            let placeholders = vec!["?"; arr.len()].join(", ");
                            parts.push(format!(
                                "{} {} ({})",
                                sanitize_ident(col),
                                sql_op,
                                placeholders
                            ));
                            for item in arr {
                                values.push(item.clone());
                            }
                        }
                    }
                    "$null" => {
                        if val.as_bool().unwrap_or(true) {
                            parts.push(format!("{} IS NULL", sanitize_ident(col)));
                        } else {
                            parts.push(format!("{} IS NOT NULL", sanitize_ident(col)));
                        }
                    }
                    "$not_null" => {
                        if val.as_bool().unwrap_or(true) {
                            parts.push(format!("{} IS NOT NULL", sanitize_ident(col)));
                        } else {
                            parts.push(format!("{} IS NULL", sanitize_ident(col)));
                        }
                    }
                    "$between" => {
                        if let Some(arr) = val.as_array() {
                            if arr.len() == 2 {
                                parts.push(format!("{} BETWEEN ? AND ?", sanitize_ident(col)));
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
            parts.push(format!("{} = ?", sanitize_ident(col)));
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
        cols.push(sanitize_ident(k));
        placeholders.push("?");
        values.push(v.clone());
    }

    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        sanitize_ident(table),
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
        set_parts.push(format!("{} = ?", sanitize_ident(k)));
        values.push(v.clone());
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
        let data = HashMap::new();
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
}
