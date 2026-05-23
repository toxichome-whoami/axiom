const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
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
    url: env.AXIOM_URL || "http://localhost:4500",
    db: env.AXIOM_DB || "localdb",
    keyName: env.AXIOM_KEY_NAME || "admin",
    secret: env.AXIOM_KEY_SECRET || "",
};

const AUTH = `Bearer ${Buffer.from(`${CONFIG.keyName}:${CONFIG.secret}`).toString("base64")}`;

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Request Wrapper
// ─────────────────────────────────────────────────────────────────────────────

function graphqlRequest(query) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${CONFIG.url}/api/v1/graphql`);
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
                if (res.statusCode === 404) {
                    return reject(
                        new Error(
                            "404 Not Found — Is `features.graphql = true` in config.toml?",
                        ),
                    );
                }
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(raw) });
                } catch {
                    reject(
                        new Error(
                            `[${res.statusCode}] Failed to parse response: ${raw}`,
                        ),
                    );
                }
            });
        });

        req.on("error", reject);
        req.write(JSON.stringify({ query }));
        req.end();
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

async function runTests() {
    console.log("=".repeat(55));
    console.log("  AXIOM GRAPHQL API DEMO");
    console.log("=".repeat(55));
    console.log(`  Server : ${CONFIG.url}`);
    console.log(`  DB     : ${CONFIG.db}`);
    console.log("=".repeat(55) + "\n");

    try {
        console.log("1. Testing `databases` introspection field...");
        const dbRes = await graphqlRequest("{ databases }");
        if (dbRes.status === 200 && dbRes.data.data) {
            console.log(
                "✅ Success! Available databases:",
                dbRes.data.data.databases.join(", "),
            );
        } else {
            console.log("❌ Failed:", JSON.stringify(dbRes.data));
            return;
        }

        console.log("\n2. Testing AST-to-SQL `execute` field...");
        // Standard query returning constant to verify pipeline execution
        const sqlQuery = `{
            execute(
                dbAlias: "${CONFIG.db}",
                sql: "SELECT 1 AS test_val, 'hello' AS msg",
                params: {}
            )
        }`;

        const execRes = await graphqlRequest(sqlQuery);
        if (
            execRes.status === 200 &&
            execRes.data.data &&
            execRes.data.data.execute
        ) {
            const execData = execRes.data.data.execute;
            console.log("✅ AST transpiled successfully! Response:");
            console.log(`   Columns: ${execData.columns.join(", ")}`);
            console.log(`   Rows:    ${JSON.stringify(execData.rows)}`);
            if (execRes.data.extensions) {
                console.log(
                    `   Timing:  ${execRes.data.extensions.duration_ms}ms execution`,
                );
            }
        } else {
            console.log("❌ Failed:", JSON.stringify(execRes.data, null, 2));
        }

        console.log("\n✨ All GraphQL tests complete.");
    } catch (err) {
        console.error(`\n❌ Network Error: ${err.message}`);
    }
}

runTests();
