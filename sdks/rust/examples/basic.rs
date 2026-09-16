use axiom_sdk::AxiomClient;
use serde_json::Value;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = AxiomClient::new(
        "http://localhost:4500",
        "admin",
        "YOUR_ADMIN_SECRET_KEY",
    )?;

    println!("Checking databases...");
    let dbs = client.list_databases().await?;
    println!("{:#?}", dbs);

    if let Some(databases) = dbs.databases {
        if let Some(db) = databases.first() {
            println!("\nExecuting raw query on {}...", db.name);
            let result: axiom_sdk::models::QueryResponse<Value> = client
                .query(&db.name, "SELECT 1 as connected", None)
                .await?;
            println!("{:#?}", result);
        }
    }

    Ok(())
}

