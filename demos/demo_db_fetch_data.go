package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
)

// DBFetchConfig holds the application configuration
type DBFetchConfig struct {
	BaseURL   string
	KeyName   string
	KeySecret string
}

// Database represents a database entity returned by Axiom
type Database struct {
	Name        string `json:"name"`
	Engine      string `json:"engine"`
	Status      string `json:"status"`
	TablesCount int    `json:"tables_count"`
	Mode        string `json:"mode"`
}

// ApiResponse represents the top-level API response
type ApiResponse struct {
	Databases []Database `json:"databases"`
}

func loadDBFetchConfig() DBFetchConfig {
	// Try loading from .env
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

	return DBFetchConfig{
		BaseURL:   baseURL,
		KeyName:   keyName,
		KeySecret: keySecret,
	}
}

func fetchFromAPI(endpoint string, DBFetchConfig DBFetchConfig) ([]byte, error) {
	url := fmt.Sprintf("%s%s", DBFetchConfig.BaseURL, endpoint)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	// Generate Basic Auth token (base64)
	authStr := fmt.Sprintf("%s:%s", DBFetchConfig.KeyName, DBFetchConfig.KeySecret)
	encodedAuth := base64.StdEncoding.EncodeToString([]byte(authStr))
	req.Header.Set("X-Axiom-Key", encodedAuth)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("API Error: %d - %s", resp.StatusCode, string(body))
	}

	return body, nil
}

func displayDatabases(databases []Database) {
	if len(databases) == 0 {
		fmt.Println("📭 No databases configured.")
		return
	}

	fmt.Printf("%-20s %-10s %-10s %-10s %-10s\n", "Name", "Engine", "Status", "Tables", "Mode")
	fmt.Println(strings.Repeat("-", 65))
	for _, db := range databases {
		fmt.Printf("%-20s %-10s %-10s %-10d %-10s\n", db.Name, db.Engine, db.Status, db.TablesCount, db.Mode)
	}
	fmt.Printf("\n✨ Successfully fetched %d database(s).\n", len(databases))
}

func RunDbFetchData() {
	fmt.Println("🔍 Querying Axiom for databases...")
	DBFetchConfig := loadDBFetchConfig()

	data, err := fetchFromAPI("/api/v1/db/databases", DBFetchConfig)
	if err != nil {
		log.Fatalf("❌ Fetch failed: %v", err)
	}

	var apiResp ApiResponse
	if err := json.Unmarshal(data, &apiResp); err != nil {
		log.Fatalf("❌ Failed to parse JSON: %v", err)
	}

	displayDatabases(apiResp.Databases)
}
