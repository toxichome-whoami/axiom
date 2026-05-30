import asyncio
import random
import time
from typing import Optional, Set

import httpx
import orjson
import structlog
from axiom_core.webhook import generate_signature, get_circuit_breaker  # type: ignore

from api.core import metrics
from config.provider import GlobalConfigProvider
from encoding.proto_utils import webhook_payload_dict_to_proto
from webhook.persistence import get_persistence
from webhook.queue import WebhookQueueList

logger = structlog.get_logger()

_client: Optional[httpx.AsyncClient] = None
_retry_tasks: Set[asyncio.Task] = set()
_workers: Set[asyncio.Task] = set()


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        config = GlobalConfigProvider().get_config()
        # Create a connection pool, timeouts handled per-request
        _client = httpx.AsyncClient(timeout=config.webhooks.timeout)
    return _client


def resolve_timeout(hook_name: str, config) -> int:
    hook_def = config.webhook.get(hook_name)
    if hook_def and hook_def.timeout > 0:
        return hook_def.timeout
    return config.webhooks.timeout


def resolve_max_retries(hook_name: str, config) -> int:
    hook_def = config.webhook.get(hook_name)
    if hook_def and hook_def.max_retries > 0:
        return hook_def.max_retries
    return config.webhooks.max_retries


def _schedule_retry(queue: Optional[asyncio.Queue], task: dict, delay_sec: float):
    """Schedules a retry task in-memory."""

    async def retry_routine():
        if queue is None:
            return
        if delay_sec > 0:
            await asyncio.sleep(delay_sec)
        task["attempt"] = task.get("attempt", 1) + 1
        try:
            queue.put_nowait(task)
            ensure_workers()
        except asyncio.QueueFull:
            logger.error("Webhook queue full during retry, dropping")

    t = asyncio.create_task(retry_routine())
    _retry_tasks.add(t)
    t.add_done_callback(_retry_tasks.discard)


async def _process_dispatch_task(
    task: dict, queue: Optional[asyncio.Queue], client: httpx.AsyncClient, config
):
    hook_name = task["hook_name"]
    url = task["url"]
    secret = task["secret"]
    headers = task.get("headers", {})
    payload = task["payload"]
    attempt = task.get("attempt", 1)
    event_id = task.get("event_id", "")  # Only present in persistent tasks

    breaker = get_circuit_breaker()
    persistence = get_persistence() if config.webhooks.persistence_enabled else None

    # Circuit Breaker check
    if config.webhooks.circuit_breaker_enabled:
        if not breaker.allow(url, config.webhooks.circuit_breaker_recovery):
            logger.debug("Circuit open, skipping", hook=hook_name, url=url)
            if persistence:
                # Requeue for later probe
                next_retry = time.time() + config.webhooks.circuit_breaker_recovery
                persistence.mark_failed(event_id, attempt, "Circuit Open", next_retry)
            _schedule_retry(queue, task, config.webhooks.circuit_breaker_recovery)
            return

    hook_def = config.webhook.get(hook_name)
    delivery_format = (
        getattr(hook_def, "delivery_format", "json") if hook_def else "json"
    )

    if delivery_format == "protobuf":
        payload_dict = orjson.loads(payload) if isinstance(payload, str) else payload
        proto_msg = webhook_payload_dict_to_proto(payload_dict)
        final_payload = proto_msg.SerializeToString()
        content_type = "application/x-protobuf"
    else:
        final_payload = payload
        content_type = "application/json"

    signature = generate_signature(secret, final_payload)
    request_headers = {
        "Content-Type": content_type,
        config.webhooks.secret_header: signature,
        "X-Axiom-Timestamp": str(int(time.time())),
        **headers,
    }

    req_timeout = resolve_timeout(hook_name, config)

    try:
        response = await client.post(
            url, content=final_payload, headers=request_headers, timeout=req_timeout
        )
        response.raise_for_status()

        if config.webhooks.circuit_breaker_enabled:
            breaker.record_success(url)

        if persistence:
            persistence.mark_delivered(event_id)

        metrics.increment("webhook_delivered")
        logger.debug("Webhook delivered successfully", hook=hook_name, url=url)

    except Exception as network_error:
        metrics.increment("webhook_failed")
        if config.webhooks.circuit_breaker_enabled:
            breaker.record_failure(url, config.webhooks.circuit_breaker_threshold)

        _handle_dispatch_failure(
            task,
            queue,
            persistence,
            attempt,
            hook_name,
            url,
            str(network_error),
            config,
        )


def _handle_dispatch_failure(
    task: dict,
    queue,
    persistence,
    attempt: int,
    hook_name: str,
    url: str,
    error: str,
    config,
):
    max_retries = resolve_max_retries(hook_name, config)

    if attempt > max_retries:
        logger.error(
            "Webhook max retries exceeded", hook=hook_name, url=url, error=error
        )
        if persistence and config.webhooks.dead_letter_enabled:
            persistence.move_to_dead_letter(
                queue_id=task.get("id"),
                event_id=task.get("event_id"),
                hook_name=hook_name,
                url=url,
                payload=task.get("payload"),
                attempts=attempt,
                last_error=error,
            )
        elif persistence:
            # Drop it
            persistence.mark_delivered(task.get("event_id"))
        return

    delay = min(config.webhooks.retry_delay**attempt, 300)
    if config.webhooks.retry_jitter_enabled:
        delay = delay * (0.5 + random.random())

    logger.warning(
        "Webhook delivery failed, scheduling retry",
        hook=hook_name,
        attempt=attempt,
        max_retries=max_retries,
        delay_sec=delay,
        error=error,
    )

    if persistence:
        next_retry_at = time.time() + delay
        persistence.mark_failed(task.get("event_id"), attempt + 1, error, next_retry_at)

    if queue:
        _schedule_retry(queue, task, delay)


async def dispatcher_worker(worker_id: int):
    logger.debug(f"Webhook dispatcher worker {worker_id} started")
    client = _get_client()
    queue = WebhookQueueList.get_queue()

    try:
        while True:
            try:
                task = queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            try:
                config = GlobalConfigProvider().get_config()
                await _process_dispatch_task(task, queue, client, config)
            except asyncio.CancelledError:
                raise
            except Exception as system_error:
                logger.error(
                    "Dispatcher encountered unexpected error during task processing",
                    error=str(system_error),
                )
            finally:
                queue.task_done()
    except asyncio.CancelledError:
        logger.debug(f"Webhook dispatcher worker {worker_id} shutting down")


def ensure_workers():
    config = GlobalConfigProvider().get_config()
    if not (config.features.webhook and config.webhooks.enabled):
        return
    max_workers = config.webhooks.max_concurrent_deliveries
    queue = WebhookQueueList.get_queue()
    q_size = queue.qsize()
    active_count = len(_workers)

    num_to_spawn = min(q_size, max_workers - active_count)
    if num_to_spawn > 0:
        for _ in range(num_to_spawn):
            worker_id = len(_workers) + 1
            t = asyncio.create_task(dispatcher_worker(worker_id))
            _workers.add(t)
            t.add_done_callback(_workers.discard)


def load_pending_webhooks():
    """Recovers and loads pending/processing webhooks from SQLite on startup."""
    config = GlobalConfigProvider().get_config()
    if not (
        config.features.webhook
        and config.webhooks.enabled
        and config.webhooks.persistence_enabled
    ):
        return

    persistence = get_persistence()
    if not persistence:
        return

    # Reset any stuck 'processing' tasks to 'pending'
    try:
        persistence.recover_processing_tasks()
    except Exception as e:
        logger.error("Failed to recover processing webhooks", error=str(e))

    # Fetch all pending tasks from DB
    try:
        tasks = persistence.fetch_all_pending()
        queue = WebhookQueueList.get_queue()
        now = time.time()
        for task in tasks:
            next_retry = task.get("next_retry_at", 0)
            if next_retry <= now:
                try:
                    queue.put_nowait(task)
                except asyncio.QueueFull:
                    logger.error("Queue full during startup webhook load")
            else:
                delay = next_retry - now
                _schedule_retry(queue, task, delay)
        if tasks:
            logger.info("Loaded pending webhooks from database", count=len(tasks))
            ensure_workers()
    except Exception as e:
        logger.error("Failed to load pending webhooks from database", error=str(e))


async def webhook_shutdown():
    global _client
    for task in list(_retry_tasks):
        task.cancel()
    _retry_tasks.clear()

    for task in list(_workers):
        task.cancel()
    _workers.clear()

    if _client is not None:
        await _client.aclose()
        _client = None
        logger.info("Webhook HTTP client closed")
