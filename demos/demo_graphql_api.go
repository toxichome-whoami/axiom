package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/joho/godotenv"
)

func RunGraphqlApi() {
	_ = godotenv.Load(filepath.Join(".", ".env"))
	baseURL := os.Getenv("AXIOM_URL")
	if baseURL == "" {
		baseURL = "http://localhost:4500"
	}
	keyName := os.Getenv("AXIOM_KEY_NAME")
	if keyName == "" {
		keyName = "admin"
	}
	keySecret := os.Getenv("AXIOM_KEY_SECRET")
	if keySecret == "" {
		keySecret = "default_secret"
	}

	endpoint := fmt.Sprintf("%s/api/v1/graphql", baseURL)

	authStr := fmt.Sprintf("%s:%s", keyName, keySecret)
	encodedAuth := base64.StdEncoding.EncodeToString([]byte(authStr))

	// Create the users table first to avoid 'relation does not exist' or 'column does not exist' errors
	createTableQuery := map[string]interface{}{
		"sql": `CREATE TABLE IF NOT EXISTS demo_graphql_users (uid UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT, display_name TEXT)`,
	}
	createTableJSON, _ := json.Marshal(createTableQuery)
	reqCreateTable, _ := http.NewRequest("POST", fmt.Sprintf("%s/api/v1/db/localdb/query", baseURL), bytes.NewBuffer(createTableJSON))
	reqCreateTable.Header.Set("X-Axiom-Key", encodedAuth)
	reqCreateTable.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	_, _ = client.Do(reqCreateTable)

	// Example query to fetch users
	query := `
	query {
		demo_graphql_users(dbAlias: "localdb") {
			uid
			email
			display_name
		}
	}
	`

	payload := map[string]interface{}{
		"query": query,
	}

	jsonPayload, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}

	authStr = fmt.Sprintf("%s:%s", keyName, keySecret)
	encodedAuth = base64.StdEncoding.EncodeToString([]byte(authStr))
	req.Header.Set("X-Axiom-Key", encodedAuth)
	req.Header.Set("Content-Type", "application/json")

	fmt.Println("📡 Sending GraphQL Query...")
	client = &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal("GraphQL request failed:", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		log.Fatalf("Error %d: %s", resp.StatusCode, string(body))
	}

	fmt.Println("✅ Response:")

	// Pretty print
	var prettyJSON bytes.Buffer
	json.Indent(&prettyJSON, body, "", "  ")
	fmt.Println(prettyJSON.String())
}
