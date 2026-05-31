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

type DBDropConfig struct {
	BaseURL   string
	KeyName   string
	KeySecret string
	DB        string
	Table     string
}

func loadDBDropConfig() DBDropConfig {
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

	return DBDropConfig{
		BaseURL:   baseURL,
		KeyName:   keyName,
		KeySecret: keySecret,
		DB:        db,
		Table:     table,
	}
}

func dropTable(endpoint string, DBDropConfig DBDropConfig) ([]byte, error) {
	url := fmt.Sprintf("%s%s", DBDropConfig.BaseURL, endpoint)

	queryPayload := map[string]interface{}{
		"sql": fmt.Sprintf("DROP TABLE IF EXISTS %s", DBDropConfig.Table),
	}
	jsonPayload, _ := json.Marshal(queryPayload)

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return nil, err
	}

	authStr := fmt.Sprintf("%s:%s", DBDropConfig.KeyName, DBDropConfig.KeySecret)
	encodedAuth := base64.StdEncoding.EncodeToString([]byte(authStr))
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", encodedAuth))
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

func RunDbDropTables() {
	fmt.Println("🗑️ Dropping table from Axiom...")
	DBDropConfig := loadDBDropConfig()

	endpoint := fmt.Sprintf("/api/v1/db/%s/query", DBDropConfig.DB)

	fmt.Printf("Warning: Dropping table %s in database %s!\n", DBDropConfig.Table, DBDropConfig.DB)
	data, err := dropTable(endpoint, DBDropConfig)
	if err != nil {
		log.Fatalf("❌ Drop failed: %v", err)
	}

	fmt.Printf("✅ Table dropped successfully. Response: %s\n", string(data))
}


