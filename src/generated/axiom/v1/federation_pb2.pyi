# pyright: reportPrivateUsage=false, reportAttributeAccessIssue=false, reportAssignmentType=false, reportUnusedImport=false
# type: ignore
# flake8: noqa
# ruff: noqa
from axiom.v1 import db_pb2 as _db_pb2
from axiom.v1 import fs_pb2 as _fs_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class NodeStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    UNKNOWN: _ClassVar[NodeStatus]
    UP: _ClassVar[NodeStatus]
    DEGRADED: _ClassVar[NodeStatus]
    DOWN: _ClassVar[NodeStatus]

UNKNOWN: NodeStatus
UP: NodeStatus
DEGRADED: NodeStatus
DOWN: NodeStatus

class HealthCheckRequest(_message.Message):
    __slots__ = ("node_id",)
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    node_id: str
    def __init__(self, node_id: _Optional[str] = ...) -> None: ...

class HealthUpdate(_message.Message):
    __slots__ = ("status", "latency_ms", "databases", "storages")
    class DatabasesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(
            self, key: _Optional[str] = ..., value: _Optional[str] = ...
        ) -> None: ...

    class StoragesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(
            self, key: _Optional[str] = ..., value: _Optional[str] = ...
        ) -> None: ...

    STATUS_FIELD_NUMBER: _ClassVar[int]
    LATENCY_MS_FIELD_NUMBER: _ClassVar[int]
    DATABASES_FIELD_NUMBER: _ClassVar[int]
    STORAGES_FIELD_NUMBER: _ClassVar[int]
    status: NodeStatus
    latency_ms: float
    databases: _containers.ScalarMap[str, str]
    storages: _containers.ScalarMap[str, str]
    def __init__(
        self,
        status: _Optional[_Union[NodeStatus, str]] = ...,
        latency_ms: _Optional[float] = ...,
        databases: _Optional[_Mapping[str, str]] = ...,
        storages: _Optional[_Mapping[str, str]] = ...,
    ) -> None: ...

class ListDatabasesRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListDatabasesResponse(_message.Message):
    __slots__ = ("databases",)
    DATABASES_FIELD_NUMBER: _ClassVar[int]
    databases: _containers.RepeatedCompositeFieldContainer[DatabaseInfo]
    def __init__(
        self, databases: _Optional[_Iterable[_Union[DatabaseInfo, _Mapping]]] = ...
    ) -> None: ...

class DatabaseInfo(_message.Message):
    __slots__ = ("name", "engine", "mode", "tables_count")
    NAME_FIELD_NUMBER: _ClassVar[int]
    ENGINE_FIELD_NUMBER: _ClassVar[int]
    MODE_FIELD_NUMBER: _ClassVar[int]
    TABLES_COUNT_FIELD_NUMBER: _ClassVar[int]
    name: str
    engine: str
    mode: str
    tables_count: int
    def __init__(
        self,
        name: _Optional[str] = ...,
        engine: _Optional[str] = ...,
        mode: _Optional[str] = ...,
        tables_count: _Optional[int] = ...,
    ) -> None: ...

class ListTablesRequest(_message.Message):
    __slots__ = ("db_alias", "limit", "offset")
    DB_ALIAS_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    db_alias: str
    limit: int
    offset: int
    def __init__(
        self,
        db_alias: _Optional[str] = ...,
        limit: _Optional[int] = ...,
        offset: _Optional[int] = ...,
    ) -> None: ...

class DownloadFileRequest(_message.Message):
    __slots__ = ("storage_alias", "path")
    STORAGE_ALIAS_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    storage_alias: str
    path: str
    def __init__(
        self, storage_alias: _Optional[str] = ..., path: _Optional[str] = ...
    ) -> None: ...

class FileChunk(_message.Message):
    __slots__ = ("data",)
    DATA_FIELD_NUMBER: _ClassVar[int]
    data: bytes
    def __init__(self, data: _Optional[bytes] = ...) -> None: ...

class UploadChunk(_message.Message):
    __slots__ = ("storage_alias", "filename", "data", "is_last")
    STORAGE_ALIAS_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    IS_LAST_FIELD_NUMBER: _ClassVar[int]
    storage_alias: str
    filename: str
    data: bytes
    is_last: bool
    def __init__(
        self,
        storage_alias: _Optional[str] = ...,
        filename: _Optional[str] = ...,
        data: _Optional[bytes] = ...,
        is_last: bool = ...,
    ) -> None: ...

class NodeInfoRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class NodeInfoResponse(_message.Message):
    __slots__ = ("node_id", "version", "databases", "storages")
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    DATABASES_FIELD_NUMBER: _ClassVar[int]
    STORAGES_FIELD_NUMBER: _ClassVar[int]
    node_id: str
    version: str
    databases: _containers.RepeatedScalarFieldContainer[str]
    storages: _containers.RepeatedScalarFieldContainer[str]
    def __init__(
        self,
        node_id: _Optional[str] = ...,
        version: _Optional[str] = ...,
        databases: _Optional[_Iterable[str]] = ...,
        storages: _Optional[_Iterable[str]] = ...,
    ) -> None: ...
