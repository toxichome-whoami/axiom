import asyncio
from typing import Optional

from config.provider import GlobalConfigProvider


class WebhookQueueList:
    """Manages the in-memory buffered transmission buffer queue."""

    _queue: Optional[asyncio.Queue] = None
    _maxsize: int = 0

    @classmethod
    def get_queue(cls) -> asyncio.Queue:
        if cls._queue is None:
            config = GlobalConfigProvider().get_config()
            cls._maxsize = config.webhooks.queue_size
            cls._queue = asyncio.Queue(maxsize=cls._maxsize)
        return cls._queue
