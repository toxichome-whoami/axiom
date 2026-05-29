from typing import Any, Dict, List

from graphql import (BooleanValueNode, FieldNode, FloatValueNode, IntValueNode,
                     ListValueNode, ObjectValueNode, OperationDefinitionNode,
                     StringValueNode, parse)

from config.provider import GlobalConfigProvider


class GraphQLCompilerError(Exception):
    pass


class ASTCompiler:
    """
    Walks a GraphQL AST and compiles it into a target SQL query string.
    Currently implements a basic JSON-agg architecture mapped via directives.
    """

    def __init__(self, query: str):
        self.query_string = query
        self.ast = parse(query)
        self.max_depth = GlobalConfigProvider().get_config().graphql.max_query_depth

    def _parse_value(self, val_node: Any) -> Any:
        if isinstance(val_node, StringValueNode):
            return val_node.value
        elif isinstance(val_node, IntValueNode):
            return int(val_node.value)
        elif isinstance(val_node, FloatValueNode):
            return float(val_node.value)
        elif isinstance(val_node, BooleanValueNode):
            return val_node.value
        elif isinstance(val_node, ListValueNode):
            return [self._parse_value(v) for v in val_node.values]
        elif isinstance(val_node, ObjectValueNode):
            params = {}
            for field_node in val_node.fields:
                params[field_node.name.value] = self._parse_value(field_node.value)
            return params
        else:
            return str(val_node)

    def extract_arguments(self, field: FieldNode) -> Dict[str, Any]:
        args = {}
        if not field.arguments:
            return args
        for arg in field.arguments:
            args[arg.name.value] = self._parse_value(arg.value)
        return args

    def _extract_table_selection(
        self, selection: FieldNode, current_depth: int = 1
    ) -> Dict[str, Any]:
        if current_depth > self.max_depth:
            raise GraphQLCompilerError(
                f"Query exceeds maximum allowed depth of {self.max_depth}"
            )

        columns = []
        nested = []
        if selection.selection_set:
            for sub_sel in selection.selection_set.selections:
                if isinstance(sub_sel, FieldNode):
                    if sub_sel.selection_set:
                        # Nested relation
                        nested.append(
                            self._extract_table_selection(sub_sel, current_depth + 1)
                        )
                    else:
                        columns.append(sub_sel.name.value)

        args = self.extract_arguments(selection)
        alias = selection.alias.value if selection.alias else selection.name.value

        return {
            "table": selection.name.value,
            "alias": alias,
            "columns": columns,
            "nested": nested,
            "limit": args.get("limit", 50),
            "offset": args.get("offset", 0),
            "filter": args.get("filter"),
        }

    def compile(self) -> List[Dict[str, Any]]:
        """
        Extracts execution intentions from the GraphQL document.
        Returns a list of operations to be executed by the router.
        """
        operations = []

        for definition in self.ast.definitions:
            if isinstance(definition, OperationDefinitionNode):
                is_mutation = definition.operation.value == "mutation"
                if not is_mutation and definition.operation.value != "query":
                    continue

                for selection in definition.selection_set.selections:
                    if isinstance(selection, FieldNode):
                        name = selection.name.value
                        alias = selection.alias.value if selection.alias else name

                        if is_mutation:
                            args = self.extract_arguments(selection)
                            if "dbAlias" not in args:
                                raise GraphQLCompilerError(
                                    f"Mutation '{name}' requires a 'dbAlias' argument"
                                )

                            if name.startswith("insert_"):
                                operations.append(
                                    {
                                        "type": "insert_table",
                                        "db_alias": args["dbAlias"],
                                        "table": name[7:],
                                        "rows": (
                                            args.get(
                                                "rows",
                                                (
                                                    [args.get("row")]
                                                    if "row" in args
                                                    else []
                                                ),
                                            )
                                            if "rows" in args or "row" in args
                                            else []
                                        ),
                                        "alias": alias,
                                    }
                                )
                            elif name.startswith("update_"):
                                operations.append(
                                    {
                                        "type": "update_table",
                                        "db_alias": args["dbAlias"],
                                        "table": name[7:],
                                        "filter": args.get("filter", {}),
                                        "update": args.get("update", {}),
                                        "alias": alias,
                                    }
                                )
                            elif name.startswith("delete_"):
                                operations.append(
                                    {
                                        "type": "delete_table",
                                        "db_alias": args["dbAlias"],
                                        "table": name[7:],
                                        "filter": args.get("filter", {}),
                                        "alias": alias,
                                    }
                                )
                            else:
                                raise GraphQLCompilerError(
                                    f"Unsupported mutation root field: {name}"
                                )
                            continue

                        # Handle the universal 'execute' pattern from the plan
                        if name == "execute":
                            args = self.extract_arguments(selection)
                            if "dbAlias" not in args or "sql" not in args:
                                raise GraphQLCompilerError(
                                    "execute() requires dbAlias and sql arguments"
                                )

                            operations.append(
                                {
                                    "type": "execute_sql",
                                    "db_alias": args["dbAlias"],
                                    "sql": args["sql"],
                                    "params": args.get("params", {}),
                                    "alias": alias,
                                }
                            )

                        elif name == "databases":
                            operations.append(
                                {
                                    "type": "list_databases",
                                    "alias": alias,
                                }
                            )

                        else:
                            # Treat any unknown field as a direct table query
                            args = self.extract_arguments(selection)
                            if "dbAlias" not in args:
                                raise GraphQLCompilerError(
                                    f"Field '{name}' requires a 'dbAlias' argument"
                                )

                            table_sel = self._extract_table_selection(selection)
                            table_sel["type"] = "query_table"
                            table_sel["db_alias"] = args["dbAlias"]

                            operations.append(table_sel)

        return operations
