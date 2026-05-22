# pyright: reportPrivateUsage=false, reportAttributeAccessIssue=false, reportAssignmentType=false, reportUnusedImport=false
# type: ignore
# flake8: noqa
# ruff: noqa
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class WebhookPayload(_message.Message):
    __slots__ = ("event_id", "timestamp", "source", "event", "trigger")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    EVENT_FIELD_NUMBER: _ClassVar[int]
    TRIGGER_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    timestamp: str
    source: str
    event: WebhookEvent
    trigger: WebhookTrigger
    def __init__(
        self,
        event_id: _Optional[str] = ...,
        timestamp: _Optional[str] = ...,
        source: _Optional[str] = ...,
        event: _Optional[_Union[WebhookEvent, _Mapping]] = ...,
        trigger: _Optional[_Union[WebhookTrigger, _Mapping]] = ...,
    ) -> None: ...

class WebhookEvent(_message.Message):
    __slots__ = ("module", "operation", "resource", "target", "action", "details")
    MODULE_FIELD_NUMBER: _ClassVar[int]
    OPERATION_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    TARGET_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    DETAILS_FIELD_NUMBER: _ClassVar[int]
    module: str
    operation: str
    resource: str
    target: str
    action: str
    details: bytes
    def __init__(
        self,
        module: _Optional[str] = ...,
        operation: _Optional[str] = ...,
        resource: _Optional[str] = ...,
        target: _Optional[str] = ...,
        action: _Optional[str] = ...,
        details: _Optional[bytes] = ...,
    ) -> None: ...

class WebhookTrigger(_message.Message):
    __slots__ = ("api_key", "ip", "request_id", "webhook_token")
    API_KEY_FIELD_NUMBER: _ClassVar[int]
    IP_FIELD_NUMBER: _ClassVar[int]
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    WEBHOOK_TOKEN_FIELD_NUMBER: _ClassVar[int]
    api_key: str
    ip: str
    request_id: str
    webhook_token: str
    def __init__(
        self,
        api_key: _Optional[str] = ...,
        ip: _Optional[str] = ...,
        request_id: _Optional[str] = ...,
        webhook_token: _Optional[str] = ...,
    ) -> None: ...
