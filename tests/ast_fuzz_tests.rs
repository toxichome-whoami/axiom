/*
 * AST firewall and input fuzzing test suite verifying SQL injection and edge-case resilience.
 * Owned by: security
 * Key deps: axiom, sqlparser, serde_json
 * Invariants: Malformed or malicious SQL never reaches database engines unsanitized; parse errors never echo back raw input.
 * Last structural change: Phase 8 hardening AST fuzzing test suite implementation.
 */

use axiom::api::database::filter_builder::build_where_clause;
use serde_json::Value;
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;
use std::collections::HashMap;

// ─── SQL AST Parser Resilience & Bypass Tests ─────────────────────────────

#[test]
fn test_ast_multi_statement_injection_detection() {
    let malicious_sql = "SELECT * FROM users WHERE id = 1; DROP TABLE accounts; --";
    let dialect = GenericDialect {};
    let ast_res = Parser::parse_sql(&dialect, malicious_sql);

    assert!(ast_res.is_ok());
    let stmts = ast_res.unwrap();
    // Multi-statement injection produces 2 distinct AST statements
    assert_eq!(stmts.len(), 2);

    let is_drop = matches!(stmts[1], sqlparser::ast::Statement::Drop { .. });
    assert!(is_drop, "Second statement must be detected as DROP");
}

#[test]
fn test_ast_comment_obfuscation_handling() {
    let obfuscated_sql = "SELECT/*/**/*/ id, /*!50000 password */ FROM /**/ users WHERE 1=1";
    let dialect = GenericDialect {};
    let ast_res = Parser::parse_sql(&dialect, obfuscated_sql);

    // The parser successfully normalizes comments away into pure AST nodes
    assert!(ast_res.is_ok());
    let stmts = ast_res.unwrap();
    assert_eq!(stmts.len(), 1);
    assert!(matches!(stmts[0], sqlparser::ast::Statement::Query(_)));
}

#[test]
fn test_ast_union_select_statement_inspection() {
    let union_sql = "SELECT name FROM products UNION SELECT password FROM admin_users";
    let dialect = GenericDialect {};
    let ast_res = Parser::parse_sql(&dialect, union_sql);

    assert!(ast_res.is_ok());
    let stmts = ast_res.unwrap();
    assert_eq!(stmts.len(), 1);
    if let sqlparser::ast::Statement::Query(query) = &stmts[0] {
        if let sqlparser::ast::SetExpr::SetOperation { op, .. } = &*query.body {
            assert_eq!(*op, sqlparser::ast::SetOperator::Union);
        } else {
            panic!("Expected SetOperation::Union AST node");
        }
    }
}

#[test]
fn test_ast_unclosed_string_literal_returns_clean_parse_error() {
    let broken_sql = "SELECT * FROM users WHERE email = 'unclosed_string_literal";
    let dialect = GenericDialect {};
    let ast_res = Parser::parse_sql(&dialect, broken_sql);

    assert!(ast_res.is_err());
}

// ─── Filter Builder Fuzzing & Stress Tests ─────────────────────────────────

#[test]
fn test_filter_builder_deeply_nested_logical_operators() {
    // Construct deeply nested $and / $or trees: (((a=1 OR b=2) AND (c=3 OR d=4)))
    let mut filter = HashMap::new();
    let nested_tree = serde_json::json!([
        {
            "$or": [
                { "col_a": { "$eq": 1 } },
                { "col_b": { "$eq": 2 } }
            ]
        },
        {
            "$or": [
                { "col_c": { "$eq": 3 } },
                { "col_d": { "$eq": 4 } }
            ]
        }
    ]);
    filter.insert("$and".to_string(), nested_tree);

    let (clause, params) = build_where_clause(&filter);

    assert!(!clause.is_empty());
    assert_eq!(params.len(), 4);
    assert!(clause.contains("col_a = ?"));
    assert!(clause.contains("col_b = ?"));
    assert!(clause.contains("col_c = ?"));
    assert!(clause.contains("col_d = ?"));
    assert!(clause.contains(" OR "));
    assert!(clause.contains(" AND "));
}

#[test]
fn test_filter_builder_unicode_and_special_characters_fuzzing() {
    let mut filter = HashMap::new();
    let exotic_string = "こんにちは世界! \u{0001}\u{001F} \x00 ' \" \\ / <script>alert(1)</script>";
    filter.insert(
        "notes".to_string(),
        serde_json::json!({
            "$like": exotic_string
        }),
    );

    let (clause, params) = build_where_clause(&filter);

    assert_eq!(clause, "notes LIKE ?");
    assert_eq!(params.len(), 1);
    assert_eq!(params[0].as_str().unwrap(), exotic_string);
}

#[test]
fn test_filter_builder_empty_inputs_generate_empty_clause() {
    let empty_filter: HashMap<String, Value> = HashMap::new();
    let (clause, params) = build_where_clause(&empty_filter);

    assert!(clause.is_empty());
    assert!(params.is_empty());
}

#[test]
fn test_filter_builder_unknown_operator_omits_clause() {
    let mut filter = HashMap::new();
    filter.insert(
        "status".to_string(),
        serde_json::json!({
            "$non_existent_operator": "malicious_attempt"
        }),
    );

    let (clause, params) = build_where_clause(&filter);

    assert!(clause.is_empty());
    assert!(params.is_empty());
}
