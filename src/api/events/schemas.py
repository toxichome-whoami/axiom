from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class EventPayload(BaseModel):
    """Strictly typed payload for all internal events flowing through EDA."""

    action: str = Field(
        ..., description="Action performed (e.g., CREATE, UPDATE, DELETE)"
    )
    module: str = Field(..., description="Module originating the event (e.g., db, fs)")
    resource: str = Field(
        ..., description="Resource type (e.g., table name, collection)"
    )
    target: str = Field(..., description="Specific target ID or alias")
    details: Dict[str, Any] = Field(
        default_factory=dict, description="Event payload details"
    )
    request_id: Optional[str] = Field(default="", description="Tracing request ID")


class DLQEvent(BaseModel):
    """Payload format for events pushed to the Dead-Letter Queue."""

    original_event: EventPayload
    error_reason: str
    failed_attempts: int
    timestamp: float
