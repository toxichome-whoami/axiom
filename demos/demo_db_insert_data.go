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

type DBInsertConfig struct {
	BaseURL   string
	KeyName   string
	KeySecret string
	DB        string
	Table     string
}

type Payload struct {
	Rows []map[string]interface{} `json:"rows"`
}

type InsertResponse struct {
	Success bool  `json:"success"`
	Count   int64 `json:"affected_rows"`
}

func loadDBInsertConfig() DBInsertConfig {
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
	db := os.Getenv("AXIOM_DB")
	if db == "" {
		db = "localdb"
	}
	table := "demo_users"

	return DBInsertConfig{
		BaseURL:   baseURL,
		KeyName:   keyName,
		KeySecret: keySecret,
		DB:        db,
		Table:     table,
	}
}

func postData(endpoint string, DBInsertConfig DBInsertConfig, payload interface{}) ([]byte, error) {
	url := fmt.Sprintf("%s%s", DBInsertConfig.BaseURL, endpoint)

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return nil, err
	}

	authStr := fmt.Sprintf("%s:%s", DBInsertConfig.KeyName, DBInsertConfig.KeySecret)
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

func RunDbInsertData() {
	fmt.Println("🚀 Inserting data into Axiom...")
	DBInsertConfig := loadDBInsertConfig()

	// Example data
	payload := Payload{
		Rows: []map[string]interface{}{
			{
				"name": "Alice",
				"age":  28,
				"role": "Engineer",
			},
			{
				"name": "Bob",
				"age":  34,
				"role": "Manager",
			},
		},
	}

	// Create the table first so we don't get a 'relation does not exist' error
	createTableQuery := map[string]interface{}{
		"sql": fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (id SERIAL PRIMARY KEY, name TEXT, age INT, role TEXT)`, DBInsertConfig.Table),
	}
	queryEndpoint := fmt.Sprintf("/api/v1/db/%s/query", DBInsertConfig.DB)
	_, err := postData(queryEndpoint, DBInsertConfig, createTableQuery)
	if err != nil {
		fmt.Printf("⚠️ Warning: Table creation failed (might already exist or query invalid): %v\n", err)
	}

	endpoint := fmt.Sprintf("/api/v1/db/%s/%s/rows", DBInsertConfig.DB, DBInsertConfig.Table)
	data, err := postData(endpoint, DBInsertConfig, payload)
	if err != nil {
		log.Fatalf("❌ Insert failed: %v", err)
	}

	var apiResp InsertResponse
	if err := json.Unmarshal(data, &apiResp); err != nil {
		// Might not exactly match the struct, so just print raw body on parse failure
		fmt.Printf("Raw Response: %s\n", string(data))
		return
	}

	if apiResp.Success {
		fmt.Printf("✅ Successfully inserted %d rows into %s.%s\n", apiResp.Count, DBInsertConfig.DB, DBInsertConfig.Table)
	} else {
		fmt.Printf("⚠️ Insert processed, but success flag was false: %s\n", string(data))
	}
}


