import os
import sys
from typing import Any

import orjson

# Ensure generated directory is in the path for imports to work
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "generated")
)

from axiom.v1 import webhook_pb2  # type: ignore


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
