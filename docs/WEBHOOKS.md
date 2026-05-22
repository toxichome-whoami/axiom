# Axiom Webhooks Guide

Axiom features a high-performance event streaming system that can notify external applications of any database or file system activity in real-time.

## 1. Event Flow

1.  **Trigger**: An operation (INSERT, UPDATE, DELETE, UPLOAD, etc.) is successfully committed.
2.  **Auth**: The request must include the webhook secret as a Base64-encoded token in the `X-Axiom-Webhook-Token` header.
3.  **Match**: The event is matched against the `rule` patterns defined in `config.toml`, and the decoded token is verified against the webhook's stored secret.
4.  **Queue**: If matched and verified, the event is placed in a non-blocking internal queue.
5.  **Delivery**: A background worker picks up the event and sends it to the configured `url` via HTTP POST, signed with HMAC-SHA256.

## 2. Configuration

Webhooks are defined as individual sections in `config.toml`.

```toml
[webhook.new_user_event]
url = "https://your-app.com/api/hooks/new-user"
secret = "hmac_signing_secret_here_at_least_32_chars"
rule = "db.write@main_db:users"
enabled = true
```

### Rule Syntax: `{module}.{operation}@{alias}:{target}`

- **module**: `db` or `fs`
- **operation**: `read`, `write`, `delete`, `any`, or `*`
- **alias**: The name of the database or storage volume (or `*` for all).
- **target**: The table name or file path pattern (or `*` for all).

## 3. Authentication (Client → Gateway)

When sending requests to the gateway that should trigger webhooks, the client **must** include the webhook secret as a Base64-encoded token:

```
X-Axiom-Webhook-Token: base64(your_webhook_secret)
```

**Node.js example:**
```javascript
const webhookToken = Buffer.from('your_webhook_secret').toString('base64');

headers: {
    'Authorization': `Bearer ${apiKeyToken}`,
    'X-Axiom-Webhook-Token': webhookToken,
}
```

The gateway decodes the Base64 token and verifies it against the stored secret using constant-time comparison (`hmac.compare_digest`). If the token doesn't match, the webhook will not fire.

## 4. Payload Format (Gateway → Your App)

All webhooks are delivered as JSON POST requests with signature headers.

**Headers sent by Axiom:**
| Header | Description |
|--------|-------------|
| `X-Axiom-Signature` | `sha256=<HMAC-SHA256 hex digest>` |
| `X-Axiom-Timestamp` | Unix timestamp of delivery |

**Payload body:**
```json
{
  "event_id": "evt_01HPC9...",
  "timestamp": "2024-03-28T15:00:00Z",
  "source": "axiom-local",
  "event": {
    "module": "db",
    "operation": "write",
    "resource": "main_db",
    "target": "users",
    "action": "INSERT",
    "details": {
      "affected_rows": 1,
      "data": [
        { "id": 123, "email": "alice@example.com" }
      ]
    }
  },
  "trigger": {
    "api_key": "admin",
    "ip": "103.137.7.105",
    "request_id": "req_8899..."
  }
}
```

## 5. Signature Verification (Your App)

To ensure a webhook was actually sent by Axiom, **verify the HMAC-SHA256 signature**.

**Node.js example:**
```javascript
const crypto = require('crypto');

function verifyWebhook(rawBody, signatureHeader, secret) {
    const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
    
    return crypto.timingSafeEqual(
        Buffer.from(`sha256=${expected}`),
        Buffer.from(signatureHeader)
    );
}
```

## 6. Security Model

| Layer | Mechanism |
|-------|-----------|
| **Client → Gateway** | Webhook secret sent as Base64 in `X-Axiom-Webhook-Token` header |
| **Gateway verification** | Decodes Base64, compares with `hmac.compare_digest()` (timing-safe) |
| **Gateway → Your App** | Payload signed with `HMAC-SHA256(secret, body)` |
| **Your App verification** | Recomputes HMAC and compares signatures |

> **Note:** The raw secret is **never** sent in the outgoing webhook delivery. Only the HMAC signature is transmitted.

## 7. Reliability and Retries

Axiom uses an industrial-grade, highly-concurrent persistent delivery system to ensure webhook reliability.

### Persistent Queues and Dead Letter
- **Persistence**: If `persistence_enabled` is true, all webhooks are written to a SQLite WAL database (`webhooks.db`) before delivery. If the server crashes, deliveries resume exactly where they left off.
- **Dead Letter Queue (DLQ)**: If an event exceeds `max_retries`, it is moved to the DLQ (`webhook_dead_letter` table) for manual inspection and replay.

### Circuit Breakers
- **Protection**: Axiom tracks delivery failures per URL. If a URL fails `circuit_breaker_threshold` times in a row, the circuit "opens".
- **Backoff**: While open, all webhooks to that URL are immediately skipped (or requeued) without making network requests. After `circuit_breaker_recovery` seconds, a single "probe" request is allowed to check if the receiver is back online.

### Retries & Jitter
- **Retries**: Axiom will retry up to `max_retries` (default: 3) times.
- **Exponential Backoff**: Wait `retry_delay ^ attempt` seconds between retries.
- **Jitter**: A 50%-150% randomized jitter is applied to the backoff delay to prevent "thundering herd" problems when a receiver comes back online.

## 8. Observability API

You can inspect the state of the webhook system via the health endpoints:

- `GET /api/v1/webhooks/status`: Get current queue counts, circuit breaker states, and configuration limits.
- `GET /api/v1/webhooks/dead-letter`: List permanently failed deliveries.
- `POST /api/v1/webhooks/dead-letter/replay`: Requeue specific `event_ids` from the DLQ.
- `POST /api/v1/webhooks/circuit/{hook_name}/reset`: Manually close an open circuit.
