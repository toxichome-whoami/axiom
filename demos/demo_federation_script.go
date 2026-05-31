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

func RunFederationTest() {
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

	endpoint := fmt.Sprintf("%s/api/v1/federation/servers", baseURL)

	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		log.Fatal(err)
	}

	authStr := fmt.Sprintf("%s:%s", keyName, keySecret)
	encodedAuth := base64.StdEncoding.EncodeToString([]byte(authStr))
	req.Header.Set("X-Axiom-Key", encodedAuth)
	req.Header.Set("Content-Type", "application/json")

	fmt.Println("🌍 Querying Federation Status...")
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal("Federation request failed:", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		log.Fatalf("Error %d: %s", resp.StatusCode, string(body))
	}

	fmt.Println("✅ Federation Topology:")
	var prettyJSON bytes.Buffer
	json.Indent(&prettyJSON, body, "", "  ")
	fmt.Println(prettyJSON.String())
}
