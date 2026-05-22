from collections.abc import Iterable as _Iterable
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar
from typing import Optional as _Optional
from typing import Union as _Union

from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from google.protobuf.internal import containers as _containers

DESCRIPTOR: _descriptor.FileDescriptor

class ListDirectoryRequest(_message.Message):
    __slots__ = ("storage_alias", "path", "limit", "offset")
    STORAGE_ALIAS_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    storage_alias: str
    path: str
    limit: int
    offset: int
    def __init__(
        self,
        storage_alias: _Optional[str] = ...,
        path: _Optional[str] = ...,
        limit: _Optional[int] = ...,
        offset: _Optional[int] = ...,
    ) -> None: ...

class DirectoryEntry(_message.Message):
    __slots__ = ("name", "path", "is_dir", "size", "modified", "mime_type")
    NAME_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    IS_DIR_FIELD_NUMBER: _ClassVar[int]
    SIZE_FIELD_NUMBER: _ClassVar[int]
    MODIFIED_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    name: str
    path: str
    is_dir: bool
    size: int
    modified: str
    mime_type: str
    def __init__(
        self,
        name: _Optional[str] = ...,
        path: _Optional[str] = ...,
        is_dir: bool = ...,
        size: _Optional[int] = ...,
        modified: _Optional[str] = ...,
        mime_type: _Optional[str] = ...,
    ) -> None: ...

class ListDirectoryResponse(_message.Message):
    __slots__ = ("total", "entries")
    TOTAL_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    total: int
    entries: _containers.RepeatedCompositeFieldContainer[DirectoryEntry]
    def __init__(
        self,
        total: _Optional[int] = ...,
        entries: _Optional[_Iterable[_Union[DirectoryEntry, _Mapping]]] = ...,
    ) -> None: ...

class FileUploadRequest(_message.Message):
    __slots__ = ("storage_alias", "path", "content", "mime_type")
    STORAGE_ALIAS_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    storage_alias: str
    path: str
    content: bytes
    mime_type: str
    def __init__(
        self,
        storage_alias: _Optional[str] = ...,
        path: _Optional[str] = ...,
        content: _Optional[bytes] = ...,
        mime_type: _Optional[str] = ...,
    ) -> None: ...

class StorageResponse(_message.Message):
    __slots__ = ("directory", "write")
    DIRECTORY_FIELD_NUMBER: _ClassVar[int]
    WRITE_FIELD_NUMBER: _ClassVar[int]
    directory: ListDirectoryResponse
    write: FsWriteResult
    def __init__(
        self,
        directory: _Optional[_Union[ListDirectoryResponse, _Mapping]] = ...,
        write: _Optional[_Union[FsWriteResult, _Mapping]] = ...,
    ) -> None: ...

class FsWriteResult(_message.Message):
    __slots__ = ("affected_rows", "last_insert_id")
    AFFECTED_ROWS_FIELD_NUMBER: _ClassVar[int]
    LAST_INSERT_ID_FIELD_NUMBER: _ClassVar[int]
    affected_rows: int
    last_insert_id: int
    def __init__(
        self, affected_rows: _Optional[int] = ..., last_insert_id: _Optional[int] = ...
    ) -> None: ...
