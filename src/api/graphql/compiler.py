from typing import Any, Dict, List

from graphql import (
    FieldNode,
    IntValueNode,
    ObjectValueNode,
    OperationDefinitionNode,
    StringValueNode,
    parse,
)


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

    def extract_arguments(self, field: FieldNode) -> Dict[str, Any]:
        args = {}
        if not field.arguments:
            return args
        for arg in field.arguments:
            val_node = arg.value
            if isinstance(val_node, StringValueNode):
                args[arg.name.value] = val_node.value
            elif isinstance(val_node, IntValueNode):
                args[arg.name.value] = int(val_node.value)
            elif isinstance(val_node, ObjectValueNode):
                # Basic JSON literal parsing for 'params'
                params = {}
                for field_node in val_node.fields:
                    v = field_node.value
                    if isinstance(v, StringValueNode):
                        params[field_node.name.value] = v.value
                    elif isinstance(v, IntValueNode):
                        params[field_node.name.value] = int(v.value)
                args[arg.name.value] = params
            else:
                # Fallback, just store the raw string representation
                args[arg.name.value] = str(val_node)
        return args

    def compile(self) -> List[Dict[str, Any]]:
        """
        Extracts execution intentions from the GraphQL document.
        Returns a list of operations to be executed by the router.
        """
        operations = []

        for definition in self.ast.definitions:
            if isinstance(definition, OperationDefinitionNode):
                if (
                    definition.operation.value != "query"
                    and definition.operation.value != "mutation"
                ):
                    continue

                for selection in definition.selection_set.selections:
                    if isinstance(selection, FieldNode):
                        # Handle the universal 'execute' pattern from the plan
                        if selection.name.value == "execute":
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
                                    "alias": selection.alias.value
                                    if selection.alias
                                    else selection.name.value,
                                }
                            )

                        elif selection.name.value == "databases":
                            operations.append(
                                {
                                    "type": "list_databases",
                                    "alias": selection.alias.value
                                    if selection.alias
                                    else selection.name.value,
                                }
                            )

                        # TODO: Expand with nested JSON_AGG SQLGlot compilation for standard tables
                        else:
                            raise GraphQLCompilerError(
                                f"Unsupported root field: {selection.name.value}"
                            )

        return operations
