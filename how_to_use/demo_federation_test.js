const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

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
    secret: env.AXIOM_KEY_SECRET || "",
};

const AUTH = `Bearer ${Buffer.from(`${CONFIG.keyName}:${CONFIG.secret}`).toString("base64")}`;

// ─────────────────────────────────────────────────────────────────────────────
// REST helper
// ─────────────────────────────────────────────────────────────────────────────

function restRequest(apiPath, method = "GET") {
    return new Promise((resolve, reject) => {
        const url = new URL(`${CONFIG.httpUrl}${apiPath}`);
        const protocol = url.protocol === "https:" ? https : http;

        const req = protocol.request(
            url,
            {
                method,
                rejectUnauthorized: false,
                headers: { Authorization: AUTH },
            },
            (res) => {
                let raw = "";
                res.on("data", (c) => (raw += c));
                res.on("end", () => {
                    try {
                        resolve({
                            status: res.statusCode,
                            data: JSON.parse(raw),
                        });
                    } catch {
                        resolve({ status: res.statusCode, data: raw });
                    }
                });
            },
        );

        req.on("error", reject);
        req.end();
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo Logic
// ─────────────────────────────────────────────────────────────────────────────

async function demo() {
    console.log("=".repeat(55));
    console.log("  AXIOM FEDERATION DATA MESH DEMO");
    console.log("=".repeat(55));
    console.log(`  Server : ${CONFIG.httpUrl}`);
    console.log("=".repeat(55) + "\n");

    console.log(`[Demo] 1. Checking Federation Mesh Status...`);
    const statusRes = await restRequest("/api/v1/fed/servers");

    if (statusRes.status === 404) {
        console.log(`\n❌ Federation is currently DISABLED!`);
        console.log(`\nTo test Federation, you must enable it in config.toml:`);
        console.log(`  [features]`);
        console.log(`  federation = true`);
        console.log(`\nYou also need to restart the Axiom server.\n`);
        return;
    }

    if (statusRes.status === 403) {
        console.log(
            `\n❌ Permission Denied! Federation mesh status requires full_admin privileges.\n`,
        );
        return;
    }

    console.log(`\n✅ Federation is ENABLED!`);
    console.log(`\nMesh Topology:`);
    console.log(JSON.stringify(statusRes.data, null, 2));

    console.log(`\n[Demo] 2. How to Query a Federated Database`);
    console.log(
        `\nOnce Federation is configured, remote resources are automatically prefixed.`,
    );
    console.log(
        `For example, if you connected to a server named "node_b" with a database "main_db":\n`,
    );
    console.log(`  GET /api/v1/db/node_b_main_db/tables`);
    console.log(
        `\nAxiom transparently intercepts this request, sends it to node_b via gRPC, and returns the response as if it were local!`,
    );
    console.log(
        `\nTo simulate this locally, set up self-federation by pointing a connector to 127.0.0.1 in config.toml.\n`,
    );
}

demo().catch((err) => {
    console.error("Unexpected error:", err.message);
    process.exit(1);
});
