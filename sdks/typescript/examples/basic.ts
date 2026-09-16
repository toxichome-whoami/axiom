import { AxiomClient } from "../src/index";

async function run() {
  const client = new AxiomClient({
    baseUrl: "http://localhost:4500",
    keyName: "admin",
    keySecret: "YOUR_ADMIN_SECRET_KEY"
  });

  console.log("Checking databases...");
  const dbs = await client.listDatabases();
  console.log(JSON.stringify(dbs, null, 2));

  if (dbs.success && dbs.databases?.length) {
    const dbName = dbs.databases[0].name;

    console.log(`\nExecuting raw query on ${dbName}...`);
    const result = await client.query(dbName, "SELECT 1 as connected");
    console.log(JSON.stringify(result, null, 2));
  }
}

run();
