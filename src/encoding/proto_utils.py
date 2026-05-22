import orjson
import os
import sys
from typing import Any

# Ensure generated directory is in the path for imports to work
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "generated")
)

from axiom.v1 import db_pb2, fs_pb2, webhook_pb2  # type: ignore


def _encode_value(pb_val: Any, val: Any) -> None:
    if val is None:
        return
    elif isinstance(val, str):
        pb_val.string_val = val
    elif isinstance(val, bool):
        pb_val.bool_val = val
    elif isinstance(val, int):
        pb_val.int_val = val
    elif isinstance(val, float):
        pb_val.float_val = val
    elif isinstance(val, bytes):
        pb_val.bytes_val = val
    else:
        pb_val.string_val = str(val)


def query_result_to_proto(result_dict: dict) -> db_pb2.QueryResponse:
    pb = db_pb2.QueryResponse()
    columns = result_dict.get("columns") or []
    pb.columns.extend(columns)

    rows = result_dict.get("rows")
    if rows:
        for row in rows:
            pb_row = pb.rows.add()
            for col in columns:
                val = row.get(col)
                pb_val = pb_row.values.add()
                _encode_value(pb_val, val)

    affected_rows = result_dict.get("affected_rows")
    if affected_rows is not None:
        pb.affected_rows = affected_rows
    return pb


def list_dir_to_proto(total: int, entries: list) -> fs_pb2.ListDirectoryResponse:
    pb = fs_pb2.ListDirectoryResponse()
    pb.total = total
    for entry in entries:
        pb_entry = pb.entries.add()
        pb_entry.name = entry.get("name", "")
        pb_entry.path = entry.get("path", "")
        pb_entry.is_dir = entry.get("is_dir", False)
        pb_entry.size = entry.get("size", 0)
        pb_entry.modified = entry.get("modified", "")
        pb_entry.mime_type = entry.get("mime_type", "")
    return pb


def webhook_payload_dict_to_proto(payload_dict: dict) -> webhook_pb2.WebhookPayload:
    pb = webhook_pb2.WebhookPayload()
    pb.event_id = payload_dict.get("event_id", "")
    pb.timestamp = payload_dict.get("timestamp", "")
    pb.source = payload_dict.get("source", "")

    event_dict = payload_dict.get("event", {})
    pb.event.module = event_dict.get("module", "")
    pb.event.operation = event_dict.get("operation", "")
    pb.event.resource = event_dict.get("resource", "")
    pb.event.target = event_dict.get("target", "")
    pb.event.action = event_dict.get("action", "")

    details = event_dict.get("details")
    if details:
        pb.event.details = orjson.dumps(details)

    trigger_dict = payload_dict.get("trigger", {})
    pb.trigger.api_key = trigger_dict.get("api_key", "")
    ip = trigger_dict.get("ip")
    if ip:
        pb.trigger.ip = ip
    pb.trigger.request_id = trigger_dict.get("request_id", "")
    token = trigger_dict.get("webhook_token")
    if token:
        pb.trigger.webhook_token = token

    return pb
