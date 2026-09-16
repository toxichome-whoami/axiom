from axiom import AxiomClient
import json

def main():
    client = AxiomClient(
        base_url="http://localhost:4500",
        key_name="admin",
        key_secret="YOUR_ADMIN_SECRET_KEY"
    )

    print("Checking databases...")
    dbs = client.list_databases()
    print(json.dumps(dbs, indent=2))

    if dbs.get("success") and dbs.get("databases"):
        db_name = dbs["databases"][0]["name"]
        
        print(f"\nExecuting raw query on {db_name}...")
        result = client.query(db_name, "SELECT 1 as connected")
        print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

