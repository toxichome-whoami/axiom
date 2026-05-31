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
	"time"

	"github.com/joho/godotenv"
)

type AuthConfig struct {
	BaseURL   string
	KeyName   string
	KeySecret string
}

func loadAuthConfig() AuthConfig {
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
	return AuthConfig{baseURL, keyName, keySecret}
}

func doRequest(method, endpoint string, AuthConfig AuthConfig, payload interface{}, token string) (map[string]interface{}, error) {
	url := fmt.Sprintf("%s%s", AuthConfig.BaseURL, endpoint)
	var bodyReader io.Reader

	if payload != nil {
		jsonPayload, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewBuffer(jsonPayload)
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, err
	}

	if token != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	} else {
		authStr := fmt.Sprintf("%s:%s", AuthConfig.KeyName, AuthConfig.KeySecret)
		encodedAuth := base64.StdEncoding.EncodeToString([]byte(authStr))
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", encodedAuth))
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("JSON parse error: %v, body: %s", err, string(body))
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("API Error: %d - %v", resp.StatusCode, result)
	}

	return result, nil
}

func RunAuthFlow() {
	fmt.Println("=== Axiom Auth Demo ===")
	AuthConfig := loadAuthConfig()

	// 1. Anonymous Login
	fmt.Println("\n[1] Logging in anonymously...")
	anonRes, err := doRequest("POST", "/api/v1/auth/anonymous", AuthConfig, nil, "")
	if err != nil {
		log.Fatalf("Anonymous login failed: %v", err)
	}
	userObj := anonRes["user"].(map[string]interface{})
	fmt.Printf("Success! Anonymous User ID: %v\n", userObj["uid"])
	accessToken := anonRes["access_token"].(string)
	fmt.Printf("Access Token: %s\n", accessToken)

	// 2. Fetch User Profile
	fmt.Println("\n[2] Fetching profile via /me...")
	meRes, err := doRequest("GET", "/api/v1/auth/user", AuthConfig, nil, accessToken)
	if err != nil {
		log.Fatalf("Fetch profile failed: %v", err)
	}
	fmt.Printf("Profile: %v\n", meRes["user"])

	// 3. Upgrade Anonymous User
	demoEmail := fmt.Sprintf("test_%d@example.com", time.Now().UnixNano())
	demoPass := "super_secure_password_123!"
	fmt.Printf("\n[3] Upgrading anonymous account to %s...\n", demoEmail)

	upgradePayload := map[string]interface{}{
		"email":        demoEmail,
		"password":     demoPass,
		"display_name": "Demo User Go",
	}
	upgradeRes, err := doRequest("POST", "/api/v1/auth/anonymous/upgrade", AuthConfig, upgradePayload, accessToken)
	if err != nil {
		log.Fatalf("Upgrade failed: %v", err)
	}
	fmt.Println("Upgrade successful! User is now permanent.")
	upgUser := upgradeRes["user"].(map[string]interface{})
	fmt.Printf("Email Verified? %v\n", upgUser["email_verified"])

	// 4. Logout
	fmt.Println("\n[4] Logging out...")
	_, err = doRequest("POST", "/api/v1/auth/logout", AuthConfig, nil, accessToken)
	if err != nil {
		log.Fatalf("Logout failed: %v", err)
	}
	fmt.Println("Logged out successfully.")

	// 5. Log back in
	fmt.Println("\n[5] Logging back in...")
	loginPayload := map[string]interface{}{
		"email":    demoEmail,
		"password": demoPass,
	}
	loginRes, err := doRequest("POST", "/api/v1/auth/login", AuthConfig, loginPayload, "")
	if err != nil {
		log.Fatalf("Login failed: %v", err)
	}
	loggedInUser := loginRes["user"].(map[string]interface{})
	fmt.Printf("Login successful! Welcome back, %v\n", loggedInUser["display_name"])
}


