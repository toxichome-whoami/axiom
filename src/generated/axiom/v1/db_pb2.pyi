# pyright: reportPrivateUsage=false, reportAttributeAccessIssue=false, reportAssignmentType=false, reportUnusedImport=false
# type: ignore
# flake8: noqa
# ruff: noqa
from collections.abc import Iterable as _Iterable
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar
from typing import Optional as _Optional
from typing import Union as _Union

from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from google.protobuf.internal import containers as _containers

DESCRIPTOR: _descriptor.FileDescriptor

class ExecuteQueryRequest(_message.Message):
    __slots__ = ("sql", "params", "db_alias", "limit", "offset", "options")

    class OptionsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(
            self, key: _Optional[str] = ..., value: _Optional[str] = ...
        ) -> None: ...

    SQL_FIELD_NUMBER: _ClassVar[int]
    PARAMS_FIELD_NUMBER: _ClassVar[int]
    DB_ALIAS_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    OPTIONS_FIELD_NUMBER: _ClassVar[int]
    sql: str
    params: _containers.RepeatedScalarFieldContainer[str]
    db_alias: str
    limit: int
    offset: int
    options: _containers.ScalarMap[str, str]
    def __init__(
        self,
        sql: _Optional[str] = ...,
        params: _Optional[_Iterable[str]] = ...,
        db_alias: _Optional[str] = ...,
        limit: _Optional[int] = ...,
        offset: _Optional[int] = ...,
        options: _Optional[_Mapping[str, str]] = ...,
    ) -> None: ...

class ExecuteQueryResponse(_message.Message):
    __slots__ = ("columns", "rows", "affected_rows")
    COLUMNS_FIELD_NUMBER: _ClassVar[int]
    ROWS_FIELD_NUMBER: _ClassVar[int]
    AFFECTED_ROWS_FIELD_NUMBER: _ClassVar[int]
    columns: _containers.RepeatedScalarFieldContainer[str]
    rows: _containers.RepeatedCompositeFieldContainer[Row]
    affected_rows: int
    def __init__(
        self,
        columns: _Optional[_Iterable[str]] = ...,
        rows: _Optional[_Iterable[_Union[Row, _Mapping]]] = ...,
        affected_rows: _Optional[int] = ...,
    ) -> None: ...

class Row(_message.Message):
    __slots__ = ("values",)
    VALUES_FIELD_NUMBER: _ClassVar[int]
    values: _containers.RepeatedCompositeFieldContainer[Value]
    def __init__(
        self, values: _Optional[_Iterable[_Union[Value, _Mapping]]] = ...
    ) -> None: ...

class Value(_message.Message):
    __slots__ = ("string_val", "int_val", "float_val", "bool_val", "bytes_val")
    STRING_VAL_FIELD_NUMBER: _ClassVar[int]
    INT_VAL_FIELD_NUMBER: _ClassVar[int]
    FLOAT_VAL_FIELD_NUMBER: _ClassVar[int]
    BOOL_VAL_FIELD_NUMBER: _ClassVar[int]
    BYTES_VAL_FIELD_NUMBER: _ClassVar[int]
    string_val: str
    int_val: int
    float_val: float
    bool_val: bool
    bytes_val: bytes
    def __init__(
        self,
        string_val: _Optional[str] = ...,
        int_val: _Optional[int] = ...,
        float_val: _Optional[float] = ...,
        bool_val: bool = ...,
        bytes_val: _Optional[bytes] = ...,
    ) -> None: ...

class InsertRequest(_message.Message):
    __slots__ = ("db_alias", "table", "rows")
    DB_ALIAS_FIELD_NUMBER: _ClassVar[int]
    TABLE_FIELD_NUMBER: _ClassVar[int]
    ROWS_FIELD_NUMBER: _ClassVar[int]
    db_alias: str
    table: str
    rows: _containers.RepeatedCompositeFieldContainer[Row]
    def __init__(
        self,
        db_alias: _Optional[str] = ...,
        table: _Optional[str] = ...,
        rows: _Optional[_Iterable[_Union[Row, _Mapping]]] = ...,
    ) -> None: ...

class UpdateRequest(_message.Message):
    __slots__ = ("db_alias", "table", "set_values", "where_clause", "where_params")
    DB_ALIAS_FIELD_NUMBER: _ClassVar[int]
    TABLE_FIELD_NUMBER: _ClassVar[int]
    SET_VALUES_FIELD_NUMBER: _ClassVar[int]
    WHERE_CLAUSE_FIELD_NUMBER: _ClassVar[int]
    WHERE_PARAMS_FIELD_NUMBER: _ClassVar[int]
    db_alias: str
    table: str
    set_values: Row
    where_clause: str
    where_params: _containers.RepeatedScalarFieldContainer[str]
    def __init__(
        self,
        db_alias: _Optional[str] = ...,
        table: _Optional[str] = ...,
        set_values: _Optional[_Union[Row, _Mapping]] = ...,
        where_clause: _Optional[str] = ...,
        where_params: _Optional[_Iterable[str]] = ...,
    ) -> None: ...

class DeleteRequest(_message.Message):
    __slots__ = ("db_alias", "table", "where_clause", "where_params")
    DB_ALIAS_FIELD_NUMBER: _ClassVar[int]
    TABLE_FIELD_NUMBER: _ClassVar[int]
    WHERE_CLAUSE_FIELD_NUMBER: _ClassVar[int]
    WHERE_PARAMS_FIELD_NUMBER: _ClassVar[int]
    db_alias: str
    table: str
    where_clause: str
    where_params: _containers.RepeatedScalarFieldContainer[str]
    def __init__(
        self,
        db_alias: _Optional[str] = ...,
        table: _Optional[str] = ...,
        where_clause: _Optional[str] = ...,
        where_params: _Optional[_Iterable[str]] = ...,
    ) -> None: ...

class DatabaseResponse(_message.Message):
    __slots__ = ("query", "tables", "schema", "write")
    QUERY_FIELD_NUMBER: _ClassVar[int]
    TABLES_FIELD_NUMBER: _ClassVar[int]
    SCHEMA_FIELD_NUMBER: _ClassVar[int]
    WRITE_FIELD_NUMBER: _ClassVar[int]
    query: ExecuteQueryResponse
    tables: ListTablesResponse
    schema: SchemaResponse
    write: WriteResult
    def __init__(
        self,
        query: _Optional[_Union[ExecuteQueryResponse, _Mapping]] = ...,
        tables: _Optional[_Union[ListTablesResponse, _Mapping]] = ...,
        schema: _Optional[_Union[SchemaResponse, _Mapping]] = ...,
        write: _Optional[_Union[WriteResult, _Mapping]] = ...,
    ) -> None: ...

class ListTablesResponse(_message.Message):
    __slots__ = ("tables",)
    TABLES_FIELD_NUMBER: _ClassVar[int]
    tables: _containers.RepeatedCompositeFieldContainer[TableInfo]
    def __init__(
        self, tables: _Optional[_Iterable[_Union[TableInfo, _Mapping]]] = ...
    ) -> None: ...

class TableInfo(_message.Message):
    __slots__ = ("name", "type")
    NAME_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    name: str
    type: str
    def __init__(
        self, name: _Optional[str] = ..., type: _Optional[str] = ...
    ) -> None: ...

class SchemaResponse(_message.Message):
    __slots__ = ("columns",)
    COLUMNS_FIELD_NUMBER: _ClassVar[int]
    columns: _containers.RepeatedCompositeFieldContainer[ColumnInfo]
    def __init__(
        self, columns: _Optional[_Iterable[_Union[ColumnInfo, _Mapping]]] = ...
    ) -> None: ...

class ColumnInfo(_message.Message):
    __slots__ = ("name", "type", "nullable", "default_value", "is_primary_key")
    NAME_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    NULLABLE_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_VALUE_FIELD_NUMBER: _ClassVar[int]
    IS_PRIMARY_KEY_FIELD_NUMBER: _ClassVar[int]
    name: str
    type: str
    nullable: bool
    default_value: str
    is_primary_key: bool
    def __init__(
        self,
        name: _Optional[str] = ...,
        type: _Optional[str] = ...,
        nullable: bool = ...,
        default_value: _Optional[str] = ...,
        is_primary_key: bool = ...,
    ) -> None: ...

class WriteResult(_message.Message):
    __slots__ = ("affected_rows", "last_insert_id")
    AFFECTED_ROWS_FIELD_NUMBER: _ClassVar[int]
    LAST_INSERT_ID_FIELD_NUMBER: _ClassVar[int]
    affected_rows: int
    last_insert_id: int
    def __init__(
        self, affected_rows: _Optional[int] = ..., last_insert_id: _Optional[int] = ...
    ) -> None: ...
