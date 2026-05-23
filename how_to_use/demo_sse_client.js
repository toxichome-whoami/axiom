const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

// Using pure native HTTP streaming for zero dependencies

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
    db: env.AXIOM_DB || "localdb",
    keyName: env.AXIOM_KEY_NAME || "admin",
    secret: env.AXIOM_KEY_SECRET || "",
    table: env.AXIOM_WS_TABLE || "sse_messages",
};

const TOKEN = Buffer.from(`${CONFIG.keyName}:${CONFIG.secret}`).toString(
    "base64",
);
const AUTH = `Bearer ${TOKEN}`;

// ─────────────────────────────────────────────────────────────────────────────
// REST helper
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
// Demo Logic
// ─────────────────────────────────────────────────────────────────────────────

async function demo() {
    console.log("=".repeat(55));
    console.log("  AXIOM SSE (SERVER-SENT EVENTS) DEMO");
    console.log("=".repeat(55));
    console.log(`  Server : ${CONFIG.httpUrl}`);
    console.log(`  DB     : ${CONFIG.db}`);
    console.log(`  Table  : ${CONFIG.table}`);
    console.log("=".repeat(55) + "\n");

    // ── 1. Connect Native HTTP Stream ──────────────────────────────
    const sseUrl = `${CONFIG.httpUrl}/api/v1/sse/db/${CONFIG.db}/${CONFIG.table}?token=${TOKEN}`;
    console.log(
        `[Listener] Connecting to SSE Stream: /api/v1/sse/db/${CONFIG.db}/${CONFIG.table} ...`,
    );

    const url = new URL(sseUrl);
    const protocol = url.protocol === "https:" ? https : http;

    const sseReq = protocol.request(
        sseUrl,
        {
            method: "GET",
            headers: { Accept: "text/event-stream" },
        },
        (res) => {
            console.log(
                `[Listener] Connected to SSE stream successfully. (Status: ${res.statusCode})\n`,
            );

            let buffer = "";
            res.on("data", (chunk) => {
                console.log("[RAW CHUNK]", JSON.stringify(chunk.toString()));
                buffer += chunk.toString();
                let parts = buffer.split("\n\n");
                buffer = parts.pop(); // Keep incomplete chunk

                for (const part of parts) {
                    if (part.includes("retry:")) continue;
                    if (part === ": heartbeat") {
                        console.log(`[Listener] 💓 Heartbeat received`);
                        continue;
                    }

                    if (part.startsWith("event: mutation")) {
                        const dataLine = part
                            .split("\n")
                            .find((l) => l.startsWith("data: "));
                        if (dataLine) {
                            try {
                                const data = JSON.parse(dataLine.slice(6));
                                console.log(
                                    `\n[Listener] 🔥 Live event received!`,
                                );
                                console.log(
                                    `           action : ${data.action}`,
                                );
                                if (data.details) {
                                    console.log(
                                        `           details:`,
                                        JSON.stringify(data.details, null, 2)
                                            .split("\n")
                                            .map(
                                                (l) =>
                                                    `                    ${l}`,
                                            )
                                            .join("\n")
                                            .trimStart(),
                                    );
                                }
                            } catch (e) {}
                        }
                    }
                }
            });
        },
    );

    sseReq.on("error", (err) =>
        console.error(`[Listener] SSE Error:`, err.message),
    );
    sseReq.end();

    // Wait just a tiny bit for connection to establish
    await new Promise((r) => setTimeout(r, 100));

    // ── 2. Trigger DB mutations via REST ───────────────────
    const MESSAGES = [
        {
            sender: "alice",
            text: "SSE is so lightweight!",
        },
        {
            sender: "bob",
            text: "No bidirectional overhead.",
        },
    ];

    console.log(
        `[Sender] Inserting ${MESSAGES.length} rows via REST to trigger SSE...\n`,
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
                `[Sender] INSERT → ${ok ? "OK" : "FAILED"} ${ok ? "" : JSON.stringify(res)}`,
            );
        } catch (err) {
            console.log(`[Sender] INSERT failed: ${err.message}`);
        }
    }

    // Wait for final events
    await new Promise((r) => setTimeout(r, 1000));

    console.log("\n" + "=".repeat(55));
    console.log("  Demo complete. Closing connection.");
    console.log("=".repeat(55));
    sseReq.destroy();
}

demo().catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
});
