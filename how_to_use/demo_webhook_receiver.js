const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const readline = require("readline");

/**
 * NEXUSGATE UNIFIED MANAGEMENT TOOL
 * ──────────────────────────────────────────────────────────────────────────
 * 1. Synchronized Database Provisioning
 * 2. Real-time Webhook Notification Receiver
 * 3. Interactive SQL / Message CLI
 */

// ─────────────────────────────────────────────────────────────────────────────
// 🛠️  1. Environment & Secrets
// ─────────────────────────────────────────────────────────────────────────────

function loadSettings() {
    const envPath = path.resolve(__dirname, ".env");
    const rawEnv = fs.existsSync(envPath)
        ? fs.readFileSync(envPath, "utf8")
        : "";

    const settings = Object.fromEntries(
        rawEnv
            .split("\n")
            .filter((line) => line.includes("="))
            .map((line) => {
                const [k, ...v] = line.split("=");
                return [k.trim(), v.join("=").trim().replace(/"/g, "")];
            }),
    );

    return {
        apiKeyName: settings.AXIOM_KEY_NAME || "example",
        apiKeySecret: settings.AXIOM_KEY_SECRET || "your_secret_key_here",
        webhookSecret:
            settings.AXIOM_WEBHOOK_SECRET || "your_webhook_secret_here",
        baseUrl: settings.AXIOM_URL || "http://localhost:4500",
        dbName: settings.AXIOM_DB || "example_db",
        localPort: parseInt(settings.TOOL_PORT || "3111"),
        webhookPath: "/api/sync",
    };
}

const CONFIG = loadSettings();
const AUTH_TOKEN = `Bearer ${Buffer.from(`${CONFIG.apiKeyName}:${CONFIG.apiKeySecret}`).toString("base64")}`;

const readlineInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

/**
 * Standard communications handler for Axiom API.
 */
async function apiPost(endpoint, requestBody = null, method = "POST") {
    const targetUrl = new URL(`${CONFIG.baseUrl}${endpoint}`);
    const payload = requestBody ? JSON.stringify(requestBody) : "";

    const options = {
        method,
        rejectUnauthorized: false,
        headers: {
            Authorization: AUTH_TOKEN,
            "Content-Type": "application/json",
            "X-Axiom-Webhook-Token": Buffer.from(CONFIG.webhookSecret).toString(
                "base64",
            ),
            ...(requestBody
                ? { "Content-Length": Buffer.byteLength(payload) }
                : {}),
        },
    };

    return new Promise((resolve, reject) => {
        const networkModule = targetUrl.protocol === "https:" ? https : http;
        const req = networkModule.request(targetUrl, options, (res) => {
            let dataAccumulator = "";
            res.on("data", (chunk) => (dataAccumulator += chunk));
            res.on("end", () => {
                try {
                    const json = JSON.parse(dataAccumulator);
                    if (res.statusCode >= 200 && res.statusCode < 300)
                        return resolve(json);
                    reject(
                        new Error(
                            json.error?.message ||
                                `API Status ${res.statusCode}`,
                        ),
                    );
                } catch (e) {
                    reject(
                        new Error(
                            `Non-JSON response received: ${dataAccumulator}`,
                        ),
                    );
                }
            });
        });

        req.on("error", reject);
        if (requestBody) req.write(payload);
        req.end();
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 🛠️  2. Database Provisioning
// ─────────────────────────────────────────────────────────────────────────────

async function ensureMessagingTableExists() {
    process.stdout.write(`🔍 Verifying 'messages' table existence... `);
    try {
        const dbsResponse = await apiPost("/api/v1/db/databases", null, "GET");
        const dbInfo = dbsResponse.data.databases.find(
            (d) => d.name === CONFIG.dbName,
        );
        const engine = dbInfo ? dbInfo.engine.toLowerCase() : "mysql";

        const tablesResponse = await apiPost(
            `/api/v1/db/${CONFIG.dbName}/tables`,
            null,
            "GET",
        );
        const messagesTable = tablesResponse.data.tables.find(
            (t) => t.name.toLowerCase() === "messages",
        );

        if (messagesTable) {
            const hasContentColumn =
                messagesTable.columns &&
                messagesTable.columns.some(
                    (c) => c.name.toLowerCase() === "content",
                );
            if (hasContentColumn) {
                return console.log("✅ Present.");
            }
            console.log('⚠️  Present but missing "content" column.');
            process.stdout.write(
                `🏗️  Adding 'content' column to 'messages'... `,
            );
            await apiPost(`/api/v1/db/${CONFIG.dbName}/query`, {
                sql: `ALTER TABLE messages ADD COLUMN content TEXT`,
            });
            return console.log("✅ Added.");
        }

        console.log("❌ Not found.");
        process.stdout.write(
            `🏗️  Initializing 'messages' structure for ${engine}... `,
        );

        let createSql = "";
        if (engine === "postgres") {
            createSql = `CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`;
        } else if (engine === "sqlite") {
            createSql = `CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`;
        } else {
            createSql = `CREATE TABLE IF NOT EXISTS messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`;
        }

        await apiPost(`/api/v1/db/${CONFIG.dbName}/query`, {
            sql: createSql,
        });
        console.log("✅ Initialized.");
    } catch (err) {
        console.log(`⚠️  Bootstrap Warning: ${err.message}\n`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 3. Security & Validation
// ─────────────────────────────────────────────────────────────────────────────

function isSignatureValid(rawPayload, receivedSignature) {
    if (!CONFIG.webhookSecret) return true;

    const calculatedHmac = crypto.createHmac("sha256", CONFIG.webhookSecret);
    const digest = calculatedHmac.update(rawPayload).digest("hex");

    return `sha256=${digest}` === receivedSignature;
}

// ─────────────────────────────────────────────────────────────────────────────
// 📡 4. Webhook Networking
// ─────────────────────────────────────────────────────────────────────────────

function handleIncomingWebhook(req, res) {
    if (req.method !== "POST" || req.url !== CONFIG.webhookPath) {
        res.writeHead(404);
        return res.end();
    }

    let payloadBuffer = "";
    req.on("data", (chunk) => (payloadBuffer += chunk));
    req.on("end", () => dispatchWebhookData(req, res, payloadBuffer));
}

function dispatchWebhookData(req, res, rawPayload) {
    const signature = req.headers["x-axiom-signature"];

    if (!isSignatureValid(rawPayload, signature)) {
        console.log(`\n❌ [SECURITY ALERT] Blocking invalid HMAC Signature!`);
        res.writeHead(401);
        return res.end();
    }

    console.log(`\n\n🔔 [WEBHOOK] Verified HMAC-SHA256 Payload Received:`);
    try {
        const parsed = JSON.parse(rawPayload);
        const toDisplay = parsed.data !== undefined ? parsed.data : parsed;
        console.log(JSON.stringify(toDisplay, null, 2));
    } catch (e) {
        console.log(`Raw Content: ${rawPayload}`);
    }

    process.stdout.write("\n💬 Enter SQL Query or Message: ");
    res.writeHead(200);
    res.end("OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// 💬 5. Interactive UI
// ─────────────────────────────────────────────────────────────────────────────

function parseCommand(userInput) {
    const cleanInput = userInput.trim();
    const isExplicitSql =
        /^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|DESCRIBE|SHOW)/i.test(
            cleanInput,
        );

    if (isExplicitSql) {
        return { sql: cleanInput, original: cleanInput, isNative: true };
    }

    // Wrap plain text as a database message
    const escapedMessage = cleanInput.replace(/'/g, "''");
    const wrappedSql = `INSERT INTO messages (content) VALUES ('${escapedMessage}')`;

    return { sql: wrappedSql, original: cleanInput, isNative: false };
}

async function startInteractivePrompt() {
    readlineInterface.question(
        "\n💬 Enter SQL Query or Message: ",
        async (input) => {
            if (!input.trim()) return startInteractivePrompt();
            if (input.toLowerCase() === "exit") process.exit(0);

            const command = parseCommand(input);

            console.log(
                command.isNative
                    ? `🛠️  Running primitive SQL...`
                    : `📝 Persistence layer wrapping...`,
            );

            try {
                const result = await apiPost(
                    `/api/v1/db/${CONFIG.dbName}/query`,
                    { sql: command.sql },
                );

                if (command.isNative) {
                    console.log(
                        `✅ Success! Affected rows: ${result.data.affected_rows}`,
                    );
                    if (result.data.rows?.length > 0)
                        console.table(result.data.rows.slice(0, 5));
                } else {
                    console.log(`🚀 Message committed to memory!`);
                }
            } catch (err) {
                console.log(`❌ Communication Failure: ${err.message}`);
            }

            startInteractivePrompt();
        },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 🚀 6. Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function bootstrap() {
    console.log("==========================================");
    console.log("🚀 NEXUSGATE UNIFIED MANAGEMENT TOOL");
    console.log("==========================================");

    await ensureMessagingTableExists();

    const webhookServer = http.createServer(handleIncomingWebhook);

    webhookServer.listen(CONFIG.localPort, "0.0.0.0", () => {
        console.log(
            `📡 Webhook Listener Active: http://localhost:${CONFIG.localPort}${CONFIG.webhookPath}`,
        );
        console.log(`🔑 Validation Mode: HMAC-SHA256`);
        console.log("------------------------------------------");
        console.log(
            "Interface ready. Type a sentence to save it as a message, or raw SQL.\n",
        );
        startInteractivePrompt();
    });
}

bootstrap().catch((err) => console.error(`Failed to start: ${err.message}`));
