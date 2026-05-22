import contextvars
import datetime
import logging
import logging.handlers
import os
import queue
import sys

import structlog

from config.provider import GlobalConfigProvider

# Context var for storing request id across async functions optionally
request_id_ctx = contextvars.ContextVar("request_id", default="-")

# ─────────────────────────────────────────────────────────────────────────────
# Builders
# ─────────────────────────────────────────────────────────────────────────────


# Register a TRACE level below DEBUG in Python's logging system
TRACE_LEVEL = logging.DEBUG - 5
logging.addLevelName(TRACE_LEVEL, "TRACE")


def _resolve_log_level(level_name: str) -> int:
    log_level_map = {
        "TRACE": TRACE_LEVEL,
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARN": logging.WARNING,
        "ERROR": logging.ERROR,
    }
    return log_level_map.get(level_name.upper(), logging.INFO)


def _build_log_handlers(config) -> list[logging.Handler]:
    """Generates the underlying structural streams resolving CLI/File targets."""
    handlers = []

    # 1. Console Stream
    if config.logging.stdout:
        handlers.append(logging.StreamHandler(sys.stdout))

    # 2. Daily Local Output Stream
    today = datetime.datetime.now().strftime("%Y-%m-%d")
    log_file_path = os.path.join(
        config.logging.directory, f"{config.logging.file_prefix}_{today}.log"
    )
    handlers.append(logging.FileHandler(log_file_path))

    return handlers


def _build_formatter(format_type: str):
    """Provides the renderer bridging internal log events to terminal/JSON outputs."""
    if format_type == "json":
        return structlog.processors.JSONRenderer()

    return structlog.dev.ConsoleRenderer(colors=True)


# ─────────────────────────────────────────────────────────────────────────────
_listener = None


def setup_logging():
    global _listener
    try:
        config = GlobalConfigProvider().get_config()
    except RuntimeError:
        return

    root = logging.getLogger()

    if not config.logging.enabled:
        if _listener is not None:
            _listener.stop()
            _listener = None
        root.setLevel(logging.CRITICAL + 10)
        for h in list(root.handlers):
            root.removeHandler(h)
        root.addHandler(logging.NullHandler())

        # Configure structlog to route through standard logging library
        structlog.configure(
            processors=[
                structlog.stdlib.add_log_level,
                structlog.processors.StackInfoRenderer(),
                structlog.processors.format_exc_info,
                structlog.processors.JSONRenderer(),
            ],
            logger_factory=structlog.stdlib.LoggerFactory(),
            wrapper_class=structlog.stdlib.BoundLogger,
            cache_logger_on_first_use=True,
        )
        return

    # If already initialized and not NullHandler, just update the log level!
    if root.handlers and not isinstance(root.handlers[0], logging.NullHandler):
        root.setLevel(_resolve_log_level(config.logging.level))
        return

    if _listener is not None:
        _listener.stop()
        _listener = None

    os.makedirs(config.logging.directory, exist_ok=True)

    raw_handlers = _build_log_handlers(config)
    log_queue = queue.Queue(-1)
    queue_handler = logging.handlers.QueueHandler(log_queue)
    _listener = logging.handlers.QueueListener(log_queue, *raw_handlers)
    _listener.start()

    for h in list(root.handlers):
        root.removeHandler(h)

    root.setLevel(_resolve_log_level(config.logging.level))
    root.addHandler(queue_handler)

    # 2. Inject Structlog Pipeline
    shared_processors = [
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
    ]

    structlog.configure(
        processors=shared_processors + [_build_formatter(config.logging.format)],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # Register TRACE level with structlog
    try:
        from structlog._log_levels import _LEVEL_TO_NAME, _NAME_TO_LEVEL

        _LEVEL_TO_NAME[TRACE_LEVEL] = "TRACE"
        _NAME_TO_LEVEL["TRACE"] = TRACE_LEVEL
    except Exception:
        pass
