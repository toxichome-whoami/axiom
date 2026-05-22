# pyright: reportPrivateUsage=false, reportAttributeAccessIssue=false, reportAssignmentType=false, reportUnusedImport=false
# type: ignore
# flake8: noqa
# ruff: noqa
from axiom.v1 import db_pb2 as _db_pb2
from axiom.v1 import fs_pb2 as _fs_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ResponseEnvelope(_message.Message):
    __slots__ = ("success", "meta", "data", "db", "fs", "error")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    META_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    DB_FIELD_NUMBER: _ClassVar[int]
    FS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    success: bool
    meta: Meta
    data: bytes
    db: _db_pb2.DatabaseResponse
    fs: _fs_pb2.StorageResponse
    error: Error
    def __init__(
        self,
        success: bool = ...,
        meta: _Optional[_Union[Meta, _Mapping]] = ...,
        data: _Optional[bytes] = ...,
        db: _Optional[_Union[_db_pb2.DatabaseResponse, _Mapping]] = ...,
        fs: _Optional[_Union[_fs_pb2.StorageResponse, _Mapping]] = ...,
        error: _Optional[_Union[Error, _Mapping]] = ...,
    ) -> None: ...

class Meta(_message.Message):
    __slots__ = ("request_id", "timestamp", "duration_ms", "server", "version")
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    SERVER_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    request_id: str
    timestamp: str
    duration_ms: float
    server: str
    version: str
    def __init__(
        self,
        request_id: _Optional[str] = ...,
        timestamp: _Optional[str] = ...,
        duration_ms: _Optional[float] = ...,
        server: _Optional[str] = ...,
        version: _Optional[str] = ...,
    ) -> None: ...

class Error(_message.Message):
    __slots__ = ("code", "message", "details")
    class DetailsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(
            self, key: _Optional[str] = ..., value: _Optional[str] = ...
        ) -> None: ...

    CODE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    DETAILS_FIELD_NUMBER: _ClassVar[int]
    code: str
    message: str
    details: _containers.ScalarMap[str, str]
    def __init__(
        self,
        code: _Optional[str] = ...,
        message: _Optional[str] = ...,
        details: _Optional[_Mapping[str, str]] = ...,
    ) -> None: ...
