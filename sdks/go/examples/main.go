package main

import (
	"encoding/json"
	"fmt"
	"log"

	"github.com/toxichome-whoami/axiom/sdks/go"
)

func main() {
	client := axiom.NewClient(axiom.AxiomConfig{
		BaseURL:   "http://localhost:4500",
		KeyName:   "admin",
		KeySecret: "YOUR_ADMIN_SECRET_KEY",
	})

	fmt.Println("Checking databases...")
	dbs, err := client.ListDatabases()
	if err != nil {
		log.Fatalf("Error: %v", err)
	}

	dbsJson, _ := json.MarshalIndent(dbs, "", "  ")
	fmt.Println(string(dbsJson))

	if dbs.Success && len(dbs.Databases) > 0 {
		dbName := dbs.Databases[0].Name
		fmt.Printf("\nExecuting raw query on %s...\n", dbName)
		
		res, err := client.Query(dbName, "SELECT 1 as connected", nil)
		if err != nil {
			log.Fatalf("Error: %v", err)
		}
		
		resJson, _ := json.MarshalIndent(res, "", "  ")
		fmt.Println(string(resJson))
	}
}

