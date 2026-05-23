<div align="center">
  <h1>Axiom Webhooks Guide</h1>
  <p><em>High-performance event streaming system for real-time external notifications</em></p>
</div>

<hr/>

## 1. Event Flow

<details open>
<summary><b>Click to see the webhook lifecycle</b></summary>
<br/>

1. **Trigger**: An operation (<kbd>INSERT</kbd>, <kbd>UPDATE</kbd>, <kbd>DELETE</kbd>, <kbd>UPLOAD</kbd>) is successfully committed.
2. **Auth**: The request must include the webhook secret as a Base64-encoded token in the `X-Axiom-Webhook-Token` header.
3. **Match**: The event is matched against the `rule` patterns defined in `config.toml`, and the decoded token is verified against the stored secret.
4. **Queue**: If matched and verified, the event is placed in a non-blocking internal queue.
5. **Delivery**: A background worker picks up the event and sends it to the configured `url` via HTTP POST, signed with <span style="color: #ff5555; font-weight: bold;">HMAC-SHA256</span>.

</details>

---

## 2. Configuration

Webhooks are defined as individual sections in `config.toml`.

```toml
[webhook.new_user_event]
url = "https://your-app.com/api/hooks/new-user"
secret = "hmac_signing_secret_here_at_least_32_chars"
rule = "db.write@main_db:users"
enabled = true
delivery_format = "json"  # or "protobuf"
```

### Rule Syntax
`{module}.{operation}@{alias}:{target}`

- <kbd>module</kbd>: `db` or `fs`
- <kbd>operation</kbd>: `read`, `write`, `delete`, `any`, or `*`
- <kbd>alias</kbd>: The name of the database or storage volume (or `*` for all).
- <kbd>target</kbd>: The table name or file path pattern (or `*` for all).

---

## 3. Authentication (Client → Gateway)

When sending requests to the gateway that should trigger webhooks, the client **must** include the webhook secret as a Base64-encoded token:

<div style="background-color: #1e1e1e; padding: 10px; border-radius: 5px;">
<code>X-Axiom-Webhook-Token: base64(your_webhook_secret)</code>
</div>

<details>
<summary><b>Node.js Example</b></summary>

```javascript
const webhookToken = Buffer.from('your_webhook_secret').toString('base64');

headers: {
    'Authorization': `Bearer ${apiKeyToken}`,
    'X-Axiom-Webhook-Token': webhookToken,
}
```
</details>

The gateway decodes the Base64 token and verifies it against the stored secret using constant-time comparison (`hmac.compare_digest`). If the token doesn't match, the webhook will **not** fire.

---

## 4. Payload Format (Gateway → Your App)

All webhooks are delivered as JSON POST requests with signature headers.

### Headers sent by Axiom

| Header | Description |
|--------|-------------|
| <code>X-Axiom-Signature</code> | `sha256=<HMAC-SHA256 hex digest>` |
| <code>X-Axiom-Timestamp</code> | Unix timestamp of delivery |

<details>
<summary><b>View JSON Payload Body</b></summary>

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
</details>

### Protobuf Delivery
If `delivery_format = "protobuf"` is configured, the exact same schema structure is compiled into a high-density binary payload. The request will be sent with `Content-Type: application/x-protobuf`.

---

## 5. Signature Verification (Your App)

To ensure a webhook was actually sent by Axiom, **verify the HMAC-SHA256 signature**.

<details open>
<summary><b>Node.js Verification Example</b></summary>

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
</details>

---

## 6. Security Model

<table style="width: 100%; border-collapse: collapse;">
  <tr style="background-color: #2d2d2d; color: white;">
    <th style="padding: 10px;">Layer</th>
    <th style="padding: 10px;">Mechanism</th>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>Client → Gateway</b></td>
    <td style="padding: 10px;">Webhook secret sent as Base64 in <code>X-Axiom-Webhook-Token</code> header</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>Gateway verification</b></td>
    <td style="padding: 10px;">Decodes Base64, compares with <code>hmac.compare_digest()</code> (timing-safe)</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>Gateway → Your App</b></td>
    <td style="padding: 10px;">Payload signed with <code>HMAC-SHA256(secret, body)</code></td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>Your App verification</b></td>
    <td style="padding: 10px;">Recomputes HMAC and compares signatures</td>
  </tr>
</table>

> <span style="font-size: 1.2em;"></span> **Note:** The raw secret is **never** sent in the outgoing webhook delivery. Only the HMAC signature is transmitted.

---

## 7. Reliability and Retries

Axiom uses an industrial-grade, highly-concurrent persistent delivery system to ensure webhook reliability.

### Persistent Queues and Dead Letter
- **Concurrency**: Webhooks are dispatched across an auto-scaling pool of up to `max_concurrent_deliveries` (default: 8) async background workers for high throughput.
- **Persistence**: Dual-backend support for persistence. If `eda.backend = "redis"`, events are pushed to high-speed **Redis Streams** (`axiom_webhooks`). Alternatively, they are written to a SQLite WAL database (`webhooks.db`). Both guarantee that if the server crashes, deliveries resume exactly where they left off.
- **Dead Letter Queue (DLQ)**: If an event exceeds `max_retries`, it is moved to the DLQ. In SQLite, this is the `webhook_dead_letter` table. In Redis EDA, a dedicated Reaper daemon uses `XPENDING` and `XCLAIM` to sweep failed events into the `axiom_events_dlq` stream for manual inspection and replay.

### Circuit Breakers
- **Protection**: Axiom tracks delivery failures per URL. If a URL fails `circuit_breaker_threshold` times in a row, the circuit "opens".
- **Backoff**: While open, all webhooks to that URL are immediately skipped (or requeued) without making network requests. After `circuit_breaker_recovery` seconds, a single "probe" request is allowed to check if the receiver is back online.

### Retries & Jitter
- **Retries**: Axiom will retry up to `max_retries` (default: 3) times.
- **Exponential Backoff**: Wait `retry_delay ^ attempt` seconds between retries.
- **Jitter**: A 50%-150% randomized jitter is applied to the backoff delay to prevent "thundering herd" problems when a receiver comes back online.

---

## 8. Observability API

You can inspect the state of the webhook system via the health endpoints:

<ul>
  <li><code>GET /api/v1/webhooks/status</code>: Get current queue counts, circuit breaker states, and configuration limits.</li>
  <li><code>GET /api/v1/webhooks/dead-letter</code>: List permanently failed deliveries.</li>
  <li><code>POST /api/v1/webhooks/dead-letter/replay</code>: Requeue specific <code>event_ids</code> from the DLQ.</li>
  <li><code>POST /api/v1/webhooks/circuit/{hook_name}/reset</code>: Manually close an open circuit.</li>
</ul>
