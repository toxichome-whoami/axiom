use axiom_sdk::AxiomClient;
use serde_json::Value;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = AxiomClient::new(
        "http://localhost:4500",
        "admin",
        "YOUR_ADMIN_SECRET_KEY",
    )?;

    println!("--- Testing Rust SDK ---");

    println!("1. list_databases:");
    println!("{:#?}", client.list_databases().await?);

    client.query::<Value>("local_pg", "CREATE TABLE IF NOT EXISTS sdk_test (id SERIAL PRIMARY KEY, name VARCHAR(255))", None).await?;

    println!("2. list_tables:");
    println!("{:#?}", client.list_tables("local_pg").await?);

    println!("3. insert_rows:");
    let new_row = serde_json::json!({"name": "Rust User"});
    println!("{:#?}", client.insert_rows("local_pg", "sdk_test", &[new_row]).await?);

    println!("4. fetch_rows:");
    println!("{:#?}", client.fetch_rows::<Value>("local_pg", "sdk_test", None).await?);

    println!("5. update_rows:");
    let mut filter = std::collections::HashMap::new();
    filter.insert("name".to_string(), serde_json::json!("Rust User"));
    let mut update = std::collections::HashMap::new();
    update.insert("name".to_string(), serde_json::json!("Updated Rust User"));
    println!("{:#?}", client.update_rows("local_pg", "sdk_test", filter, update).await?);

    println!("6. delete_rows:");
    let mut del_filter = std::collections::HashMap::new();
    del_filter.insert("name".to_string(), serde_json::json!("Updated Rust User"));
    println!("{:#?}", client.delete_rows("local_pg", "sdk_test", del_filter).await?);

    client.query::<Value>("local_pg", "DROP TABLE sdk_test", None).await?;

    println!("--- Rust Test Complete ---");
    Ok(())
}

