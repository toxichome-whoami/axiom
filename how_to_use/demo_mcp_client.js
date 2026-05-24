const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

// Using pure native HTTP streaming for zero dependencies to demonstrate MCP SSE Transport

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
    keyName: env.AXIOM_KEY_NAME || "admin",
    secret: env.AXIOM_KEY_SECRET || "ZvLpwTTxKnaxzcmuQPyPPCstUKGZGeWaampdvYPXVkeLEBDNNIOwiiyAUzgQCAxJ",
};

const TOKEN = Buffer.from(`${CONFIG.keyName}:${CONFIG.secret}`).toString("base64");
const AUTH = `Bearer ${TOKEN}`;

// ─────────────────────────────────────────────────────────────────────────────
// REST helper
// ─────────────────────────────────────────────────────────────────────────────

function postMessage(apiPath, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(apiPath, CONFIG.httpUrl);
        const protocol = url.protocol === "https:" ? https : http;

        const options = {
            method: "POST",
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
        req.write(JSON.stringify(body));
        req.end();
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo Logic
// ─────────────────────────────────────────────────────────────────────────────

async function demo() {
    console.log("=".repeat(55));
    console.log("  AXIOM MCP (MODEL CONTEXT PROTOCOL) DEMO");
    console.log("=".repeat(55));
    console.log(`  Server : ${CONFIG.httpUrl}`);
    console.log("=".repeat(55) + "\n");

    let postEndpoint = "";

    // ── 1. Connect Native HTTP Stream to MCP SSE ───────────────────────────
    const sseUrl = `${CONFIG.httpUrl}/api/v1/mcp/sse`;
    console.log(`[Listener] Connecting to MCP SSE Stream: /api/v1/mcp/sse ...`);

    const url = new URL(sseUrl);
    const protocol = url.protocol === "https:" ? https : http;

    const sseReq = protocol.request(
        sseUrl,
        {
            method: "GET",
            headers: { 
                Accept: "text/event-stream",
                Authorization: AUTH 
            },
        },
        (res) => {
            console.log(
                `[Listener] Connected to MCP stream successfully. (Status: ${res.statusCode})\n`,
            );

            let buffer = "";
            res.on("data", async (chunk) => {
                buffer += chunk.toString();
                let parts = buffer.split("\n\n");
                buffer = parts.pop(); // Keep incomplete chunk

                for (const part of parts) {
                    if (part.startsWith("event: endpoint")) {
                        const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
                        if (dataLine) {
                            postEndpoint = dataLine.slice(6).trim();
                            console.log(`[Listener] Received POST endpoint: ${postEndpoint}`);
                            
                            // ── 2. Send Initialize Message ───────────────────────────
                            console.log(`\n[Client] Sending MCP 'initialize' request...`);
                            const initMsg = {
                                jsonrpc: "2.0",
                                id: 1,
                                method: "initialize",
                                params: {
                                    protocolVersion: "2024-11-05",
                                    capabilities: {},
                                    clientInfo: {
                                        name: "AxiomTestClient",
                                        version: "1.0.0"
                                    }
                                }
                            };
                            
                            try {
                                await postMessage(postEndpoint, initMsg);
                                console.log(`[Client] Message successfully posted.`);
                            } catch (err) {
                                console.error(`[Client] Failed to post message:`, err);
                            }
                        }
                    } else if (part.startsWith("event: message")) {
                        const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
                        if (dataLine) {
                            console.log(`\n[Listener] 🔥 Received MCP Message!`);
                            try {
                                const msg = JSON.parse(dataLine.slice(6));
                                console.log(JSON.stringify(msg, null, 2));
                                
                                if (msg.id === 1 && msg.result) {
                                    // Received init response, let's ask for tools
                                    console.log(`\n[Client] Sending 'tools/list' request...`);
                                    await postMessage(postEndpoint, {
                                        jsonrpc: "2.0",
                                        id: 2,
                                        method: "tools/list",
                                        params: {}
                                    });
                                }
                                
                                if (msg.id === 2 && msg.result) {
                                    // We've successfully listed tools, we can finish
                                    console.log("\n" + "=".repeat(55));
                                    console.log("  Demo complete. Closing connection.");
                                    console.log("=".repeat(55));
                                    sseReq.destroy();
                                    process.exit(0);
                                }
                                
                            } catch (e) {
                                console.log(`Raw data: ${dataLine.slice(6)}`);
                            }
                        }
                    }
                }
            });
        },
    );

    sseReq.on("error", (err) => console.error(`[Listener] SSE Error:`, err.message));
    sseReq.end();
}

demo().catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
});
