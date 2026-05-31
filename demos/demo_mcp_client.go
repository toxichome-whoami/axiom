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

type MCPRequest struct {
	Method string                 `json:"method"`
	Params map[string]interface{} `json:"params"`
}

func RunMcpClient() {
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

	endpoint := fmt.Sprintf("%s/api/v1/mcp/messages", baseURL)

	// We'll call the "db_query" tool via MCP
	mcpReq := MCPRequest{
		Method: "tools/call",
		Params: map[string]interface{}{
			"name": "db_query",
			"arguments": map[string]interface{}{
				"database": "localdb",
				"sql":      "SELECT 1 as test",
			},
		},
	}

	jsonPayload, _ := json.Marshal(mcpReq)
	req, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}

	authStr := fmt.Sprintf("%s:%s", keyName, keySecret)
	encodedAuth := base64.StdEncoding.EncodeToString([]byte(authStr))
	req.Header.Set("X-Axiom-Key", encodedAuth)
	req.Header.Set("Content-Type", "application/json")

	fmt.Println("🤖 Calling MCP db_query tool...")
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal("MCP request failed:", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		log.Fatalf("Error %d: %s", resp.StatusCode, string(body))
	}

	fmt.Println("✅ MCP Message Accepted (Response sent via SSE).")
}


