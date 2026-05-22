const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────────────────────────────────────
// Native WebSocket (Node 22+). Falls back to `ws` package if needed.
// ─────────────────────────────────────────────────────────────────────────────

let WebSocket;
try {
    WebSocket = globalThis.WebSocket ?? require("ws");
} catch {
    console.error("WebSocket not available. Run: npm install ws");
    process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

function loadEnv() {
    const envPath = path.resolve(__dirname, ".env");
    if (!fs.existsSync(envPath)) return {};
    return Object.fromEntries(
        fs
            .readFileSync(envPath, "utf8")
            .split("\n")
            .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
            .map((l) => {
                const [k, ...v] = l.split("=");
                return [k.trim(), v.join("=").trim().replace(/"/g, "")];
            }),
    );
}

const env = loadEnv();

const CONFIG = {
    httpUrl: env.AXIOM_URL || "http://localhost:4500",
    db: env.AXIOM_DB || "portfolio",
    keyName: env.AXIOM_KEY_NAME || "admin",
    secret: env.AXIOM_KEY_SECRET || "",
    table: env.AXIOM_WS_TABLE || "messages",
};

// Build the WS URL from the HTTP URL
const wsBase = CONFIG.httpUrl.replace(/^http/, "ws");
const WS_URL = `${wsBase}/api/v1/ws`;
const TOKEN = Buffer.from(`${CONFIG.keyName}:${CONFIG.secret}`).toString(
    "base64",
);
const AUTH = `Bearer ${TOKEN}`;

// ─────────────────────────────────────────────────────────────────────────────
// REST helper — used to fire DB inserts that trigger WS events
// ─────────────────────────────────────────────────────────────────────────────

function restRequest(apiPath, method = "GET", body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${CONFIG.httpUrl}${apiPath}`);
        const protocol = url.protocol === "https:" ? https : http;

        const options = {
            method,
            rejectUnauthorized: false,
            headers: {
                Authorization: AUTH,
                "Content-Type": "application/json",
            },
        };

        const req = protocol.request(url, options, (res) => {
            let raw = "";
            res.on("data", (c) => (raw += c));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(raw));
                } catch {
                    resolve(raw);
                }
            });
        });

        req.on("error", reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Client wrapper
// ─────────────────────────────────────────────────────────────────────────────

class AxiomWS {
    constructor(name) {
        this.name = name;
        this.ws = null;
        this.connected = false;
        this.onEvent = null; // callback(topic, data)
    }

    connect() {
        return new Promise((resolve, reject) => {
            console.log(`[${this.name}] Connecting to ${WS_URL} ...`);
            this.ws = new WebSocket(WS_URL);

            this.ws.onopen = () => {
                // Step 1: authenticate
                this._send({ type: "auth", token: TOKEN });
            };

            this.ws.onmessage = (event) => {
                // Some implementations return the raw string or buffer directly if using ws package
                // Native WebSocket gives a MessageEvent object with .data
                const raw =
                    typeof event.data === "string"
                        ? event.data
                        : event.toString();
                let msg;
                try {
                    msg = JSON.parse(raw);
                } catch {
                    return;
                }

                if (msg.type === "connected") {
                    this.connected = true;
                    console.log(
                        `[${this.name}] Authenticated — client_id: ${msg.client_id}`,
                    );
                    resolve(this);
                }

                if (msg.type === "ack") {
                    const status =
                        msg.status === "ok"
                            ? "subscribed"
                            : "DENIED (out of scope)";
                    console.log(
                        `[${this.name}] Topic "${msg.topic}" ${status}`,
                    );
                }

                if (msg.type === "event" && this.onEvent) {
                    this.onEvent(msg.topic, msg.data);
                }

                if (msg.type === "heartbeat") {
                    // silently acknowledge
                    this._send({ type: "pong" });
                }

                if (msg.type === "error") {
                    console.error(
                        `[${this.name}] Server error: ${msg.message}`,
                    );
                }
            };

            this.ws.onerror = (err) => {
                if (!this.connected) reject(err);
                else
                    console.error(
                        `[${this.name}] WS error:`,
                        err.message || err,
                    );
            };

            this.ws.onclose = (event) => {
                this.connected = false;
                console.log(`[${this.name}] Disconnected (code ${event.code})`);
            };
        });
    }

    subscribe(topic) {
        this._send({
            type: "subscribe",
            topic,
            request_id: `sub_${Date.now()}`,
        });
        return this;
    }

    unsubscribe(topic) {
        this._send({ type: "unsubscribe", topic });
        return this;
    }

    close() {
        this.ws?.close();
    }

    _send(obj) {
        if (this.ws?.readyState === 1 /* OPEN */) {
            this.ws.send(JSON.stringify(obj));
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Messaging System Demo
//
// Simulates two clients:
//   - "Listener"  subscribes to db:{alias}:{table} and prints incoming events
//   - "Sender"    inserts rows via REST — which triggers WS events on Listener
//
// This proves the full loop:
//   REST write → emit_event() → EventBus → WebSocket push
// ─────────────────────────────────────────────────────────────────────────────

const MESSAGES = [
    {
        sender: "alice",
        text: "Hello from the WebSocket demo!",
        ts: new Date().toISOString(),
    },
    {
        sender: "bob",
        text: "Real-time, no polling needed.",
        ts: new Date().toISOString(),
    },
    {
        sender: "alice",
        text: "Axiom pushes events instantly.",
        ts: new Date().toISOString(),
    },
];

async function demo() {
    console.log("=".repeat(55));
    console.log("  AXIOM WEBSOCKET — MESSAGING SYSTEM DEMO");
    console.log("=".repeat(55));
    console.log(`  Server : ${CONFIG.httpUrl}`);
    console.log(`  DB     : ${CONFIG.db}`);
    console.log(`  Table  : ${CONFIG.table}`);
    console.log("=".repeat(55) + "\n");

    // ── 1. Connect listener ──────────────────────────────
    const listener = new AxiomWS("Listener");

    listener.onEvent = (topic, data) => {
        console.log(`\n[Listener] Live event on "${topic}"`);
        console.log(`           action : ${data.action}`);
        if (data.details) {
            console.log(
                `           details:`,
                JSON.stringify(data.details, null, 2)
                    .split("\n")
                    .map((l) => `                    ${l}`)
                    .join("\n")
                    .trimStart(),
            );
        }
    };

    try {
        await listener.connect();
    } catch (err) {
        console.error(`\nFailed to connect: ${err.message}`);
        console.log("\nMake sure:");
        console.log("  1. Axiom is running");
        console.log("  2. features.websocket = true in config.toml");
        console.log("  3. AXIOM_URL in .env is correct");
        process.exit(1);
    }

    // ── 2. Subscribe to the messages table ──────────────
    const topic = `db:${CONFIG.db}:${CONFIG.table}`;
    listener.subscribe(topic);
    listener.subscribe(`db:${CONFIG.db}:*`); // also catch wildcard

    await sleep(300); // let ack arrive

    // ── 3. Send messages via REST ────────────────────────
    console.log(
        `\n[Sender] Inserting ${MESSAGES.length} rows into ${CONFIG.db}.${CONFIG.table} via REST ...\n`,
    );

    for (const msg of MESSAGES) {
        try {
            const res = await restRequest(
                `/api/v1/db/${CONFIG.db}/${CONFIG.table}/rows`,
                "POST",
                { rows: [msg] },
            );

            const ok = res?.success === true;
            console.log(
                `[Sender] INSERT "${msg.text.slice(0, 35)}..." → ${ok ? "OK" : "FAILED"}`,
            );
            if (!ok) console.log("         Response:", JSON.stringify(res));
        } catch (err) {
            console.log(`[Sender] INSERT failed: ${err.message}`);
        }

        await sleep(600); // small gap so events are clearly separated in output
    }

    // ── 4. Wait for last events to arrive then disconnect
    await sleep(1000);

    console.log("\n" + "=".repeat(55));
    console.log("  Demo complete. Closing connection.");
    console.log("=".repeat(55));
    listener.close();
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

demo().catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
});
