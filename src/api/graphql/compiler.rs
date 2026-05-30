use graphql_parser::query::{parse_query, Document, Definition, OperationDefinition, Selection, Field, Value};
use std::collections::HashMap;
use serde_json::Value as JsonValue;

#[derive(Debug)]
pub enum ASTOperation {
    QueryTable {
        db_alias: String,
        table: String,
        columns: Vec<String>,
        alias: String,
        limit: i32,
        offset: i32,
        nested: Vec<ASTOperation>, // Supports basic nesting
    },
    ExecuteSql {
        db_alias: String,
        sql: String,
        params: HashMap<String, JsonValue>,
        alias: String,
    },
    ListDatabases {
        alias: String,
    }
}

pub struct ASTCompiler {
    max_depth: i32,
}

impl ASTCompiler {
    pub fn new(max_depth: i32) -> Self {
        Self { max_depth }
    }

    fn parse_value<'a>(&self, val: &Value<'a, &'a str>) -> JsonValue {
        match val {
            Value::Variable(v) => JsonValue::String(format!("${}", v)),
            Value::Int(i) => JsonValue::Number(i.as_i64().unwrap_or(0).into()),
            Value::Float(f) => JsonValue::Number(serde_json::Number::from_f64(*f).unwrap()),
            Value::String(s) => JsonValue::String(s.to_string()),
            Value::Boolean(b) => JsonValue::Bool(*b),
            Value::Null => JsonValue::Null,
            Value::Enum(e) => JsonValue::String(e.to_string()),
            Value::List(l) => {
                let vec: Vec<JsonValue> = l.iter().map(|v| self.parse_value(v)).collect();
                JsonValue::Array(vec)
            },
            Value::Object(o) => {
                let mut map = serde_json::Map::new();
                for (k, v) in o {
                    map.insert(k.to_string(), self.parse_value(v));
                }
                JsonValue::Object(map)
            }
        }
    }

    fn extract_arguments<'a>(&self, field: &Field<'a, &'a str>) -> HashMap<String, JsonValue> {
        let mut args = HashMap::new();
        for (name, val) in &field.arguments {
            args.insert(name.to_string(), self.parse_value(val));
        }
        args
    }

    fn extract_table_selection<'a>(&self, field: &Field<'a, &'a str>, current_depth: i32) -> Result<ASTOperation, String> {
        if current_depth > self.max_depth {
            return Err(format!("Query exceeds maximum allowed depth of {}", self.max_depth));
        }

        let mut columns = Vec::new();
        let mut nested = Vec::new();

        for selection in &field.selection_set.items {
            if let Selection::Field(sub_field) = selection {
                if sub_field.selection_set.items.is_empty() {
                    columns.push(sub_field.name.to_string());
                } else {
                    nested.push(self.extract_table_selection(sub_field, current_depth + 1)?);
                }
            }
        }

        let args = self.extract_arguments(field);
        let alias = field.alias.map(|a| a.to_string()).unwrap_or_else(|| field.name.to_string());
        
        let db_alias = args.get("dbAlias").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(50) as i32;
        let offset = args.get("offset").and_then(|v| v.as_i64()).unwrap_or(0) as i32;

        Ok(ASTOperation::QueryTable {
            db_alias,
            table: field.name.to_string(),
            columns,
            alias,
            limit,
            offset,
            nested,
        })
    }

    pub fn compile(&self, query: &str) -> Result<Vec<ASTOperation>, String> {
        let ast = parse_query::<&str>(query).map_err(|e| e.to_string())?;
        let mut operations = Vec::new();

        for def in ast.definitions {
            if let Definition::Operation(op) = def {
                let selection_set = match op {
                    OperationDefinition::Query(q) => q.selection_set,
                    OperationDefinition::SelectionSet(s) => s,
                    OperationDefinition::Mutation(_) => return Err("Mutations are currently unsupported in this basic Rust stub".to_string()),
                    OperationDefinition::Subscription(_) => return Err("Subscriptions not supported".to_string()),
                };

                for selection in selection_set.items {
                    if let Selection::Field(field) = selection {
                        let name = field.name;
                        let alias = field.alias.map(|a| a.to_string()).unwrap_or_else(|| name.to_string());
                        let args = self.extract_arguments(&field);

                        if name == "execute" {
                            let db_alias = args.get("dbAlias").and_then(|v| v.as_str()).ok_or("dbAlias required")?.to_string();
                            let sql = args.get("sql").and_then(|v| v.as_str()).ok_or("sql required")?.to_string();
                            let params = args.get("params").and_then(|v| v.as_object()).cloned().unwrap_or_default();
                            
                            let mut param_map = HashMap::new();
                            for (k, v) in params {
                                param_map.insert(k, v);
                            }

                            operations.push(ASTOperation::ExecuteSql {
                                db_alias,
                                sql,
                                params: param_map,
                                alias,
                            });
                        } else if name == "databases" {
                            operations.push(ASTOperation::ListDatabases { alias });
                        } else {
                            if args.get("dbAlias").is_none() {
                                return Err(format!("Field '{}' requires a 'dbAlias' argument", name));
                            }
                            let op = self.extract_table_selection(&field, 1)?;
                            operations.push(op);
                        }
                    }
                }
            }
        }

        Ok(operations)
    }
}
