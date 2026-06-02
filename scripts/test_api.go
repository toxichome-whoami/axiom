//go:build ignore
// +build ignore

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

var (
	AdminToken  string
	BaseURL     string
	DBName      string
	DBTable     string
	StorageName string
	OutFile     = `..\api_test_results.txt`
)

func loadEnv() {
	BaseURL = "http://localhost:4500"
	DBName = "localdb"
	DBTable = "demo_graphql_users"
	StorageName = "local_uploads"

	content, err := os.ReadFile(".env")
	if err != nil {
		content, err = os.ReadFile("scripts/.env")
	}
	if err == nil {
		for _, line := range strings.Split(string(content), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				val := strings.TrimSpace(parts[1])
				switch key {
				case "AXIOM_URL":
					BaseURL = val
				case "AXIOM_TOKEN":
					AdminToken = val
				case "DB_NAME":
					DBName = val
				case "DB_TABLE":
					DBTable = val
				case "STORAGE_NAME":
					StorageName = val
				}
			}
		}
	}
}

func testEndpoint(name, method, path string, data interface{}, headers map[string]string) map[string]interface{} {
	if headers == nil {
		headers = make(map[string]string)
	}

	if _, exists := headers["X-Axiom-Key"]; !exists {
		headers["X-Axiom-Key"] = AdminToken
	}

	var reqBody io.Reader
	if data != nil {
		if strData, ok := data.(string); ok {
			reqBody = strings.NewReader(strData)
		} else {
			jsonData, err := json.Marshal(data)
			if err != nil {
				fmt.Printf("Error marshaling data for %s: %v\n", name, err)
				return nil
			}
			reqBody = bytes.NewReader(jsonData)
			if _, exists := headers["Content-Type"]; !exists {
				headers["Content-Type"] = "application/json"
			}
		}
	}

	url := BaseURL + path
	fmt.Printf("Testing %s -> %s %s\n", name, method, url)

	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		writeLog(fmt.Errorf("Failed to create request: %v", err).Error(), name, method, url, "ERROR")
		return nil
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)

	var status string
	var respBodyBytes []byte

	if err != nil {
		status = "ERROR"
		respBodyBytes = []byte(err.Error())
	} else {
		status = fmt.Sprintf("%d", resp.StatusCode)
		defer resp.Body.Close()
		respBodyBytes, _ = io.ReadAll(resp.Body)
	}

	var parsed map[string]interface{}
	var formattedJSON string

	if json.Unmarshal(respBodyBytes, &parsed) == nil {
		indentData, err := json.MarshalIndent(parsed, "", "  ")
		if err == nil {
			formattedJSON = string(indentData)
		} else {
			formattedJSON = string(respBodyBytes)
		}
	} else {
		formattedJSON = string(respBodyBytes)
	}

	outputBlock := fmt.Sprintf(
		"Endpoint Name: %s\nRequest: %s %s\nStatus: %s\nResponse:\n%s\n%s\n",
		name, method, url, status, formattedJSON, strings.Repeat("-", 60),
	)

	// Append to file
	f, err := os.OpenFile(OutFile, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
	if err == nil {
		f.WriteString(outputBlock)
		f.Close()
	}

	return parsed
}

func writeLog(message, name, method, url, status string) {
	outputBlock := fmt.Sprintf(
		"Endpoint Name: %s\nRequest: %s %s\nStatus: %s\nResponse:\n%s\n%s\n",
		name, method, url, status, message, strings.Repeat("-", 60),
	)
	f, err := os.OpenFile(OutFile, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
	if err == nil {
		f.WriteString(outputBlock)
		f.Close()
	}
}

func main() {
	loadEnv()

	fmt.Println("Starting custom API tests...")

	// Initialize File
	headerText := fmt.Sprintf("AXIOM API ENDPOINT TEST RESULTS (CUSTOM SCRIPT)\n%s\n\n", strings.Repeat("=", 60))
	err := os.WriteFile(OutFile, []byte(headerText), 0644)
	if err != nil {
		fmt.Printf("Failed to initialize log file: %v\n", err)
		return
	}

	testEmail := fmt.Sprintf("tester_%d@example.com", time.Now().Unix())

	// 1. Core Endpoints
	testEndpoint("Health Check", "GET", "/health", nil, map[string]string{})
	testEndpoint("Metrics", "GET", "/metrics", nil, map[string]string{"X-Axiom-Key": AdminToken})

	// 2. Database Endpoints
	testEndpoint("List Databases", "GET", "/api/v1/db/databases", nil, nil)
	testEndpoint(fmt.Sprintf("List Tables (%s)", DBName), "GET", fmt.Sprintf("/api/v1/db/%s/tables?limit=50", DBName), nil, nil)
	testEndpoint("Fetch Rows", "GET", fmt.Sprintf("/api/v1/db/%s/%s/rows?limit=5&sort=uid&order=asc", DBName, DBTable), nil, nil)
	testEndpoint("Execute SQL Query", "POST", fmt.Sprintf("/api/v1/db/%s/query", DBName), map[string]string{"sql": "SELECT 1 as test"}, nil)

	// 3. File System Endpoints
	testEndpoint("List Storages", "GET", "/api/v1/fs/storages", nil, nil)
	testEndpoint("List Root Folder", "GET", fmt.Sprintf("/api/v1/fs/%s/list?path=/", StorageName), nil, nil)
	testEndpoint("Initiate Upload", "POST", fmt.Sprintf("/api/v1/fs/%s/action", StorageName), map[string]string{"action": "initiate"}, nil)

	// 4. GraphQL Endpoint
	testEndpoint("GraphQL SQL Execution", "POST", "/api/v1/graphql", map[string]string{"query": fmt.Sprintf(`{ execute(dbAlias: "%s", sql: "SELECT 1 as test") }`, DBName)}, nil)

	// 5. Federation
	testEndpoint("List Federated Servers", "GET", "/api/v1/fed/servers", nil, nil)

	// 6. Auth Endpoints
	testEndpoint("Auth JWKS", "GET", "/api/v1/auth/.well-known/jwks.json", nil, map[string]string{})
	testEndpoint("Auth Signup", "POST", "/api/v1/auth/signup", map[string]string{"email": testEmail, "password": "password123"}, nil)
	loginResp := testEndpoint("Auth Login", "POST", "/api/v1/auth/login", map[string]string{"email": testEmail, "password": "password123"}, nil)

	bearer := make(map[string]string)
	if loginResp != nil {
		if success, ok := loginResp["success"].(bool); ok && success {
			if token, ok := loginResp["access_token"].(string); ok {
				bearer["X-User-Access-Token"] = token
			}
		}
	}

	testEndpoint("Auth Magic Link", "POST", "/api/v1/auth/magic-link", map[string]string{"email": testEmail}, nil)

	// 7. Remaining Auth Endpoints (Requires Bearer)
	testEndpoint("Auth Anonymous", "POST", "/api/v1/auth/anonymous", nil, nil)
	testEndpoint("Auth User Sessions", "GET", "/api/v1/auth/user/sessions", nil, bearer)
	testEndpoint("Auth TOTP Enroll", "POST", "/api/v1/auth/totp/enroll", nil, bearer)
	testEndpoint("Auth Change Email", "POST", "/api/v1/auth/user/email", map[string]string{"new_email": "new@example.com", "password": "password123"}, bearer)
	testEndpoint("Auth Change Password", "POST", "/api/v1/auth/user/password", map[string]string{"new_password": "newpassword123", "current_password": "password123"}, bearer)
	testEndpoint("Auth Forgot Password", "POST", "/api/v1/auth/password/forgot", map[string]string{"email": testEmail}, nil)

	var refreshToken string
	if loginResp != nil {
		if success, ok := loginResp["success"].(bool); ok && success {
			if rToken, ok := loginResp["refresh_token"].(string); ok {
				refreshToken = rToken
			}
		}
	}

	testEndpoint("Auth Refresh", "POST", "/api/v1/auth/refresh", map[string]string{"refresh_token": refreshToken}, bearer)

	// 8. Admin Endpoints
	testEndpoint("Admin List Users", "GET", "/api/v1/auth/admin/users", nil, map[string]string{"X-Axiom-Key": AdminToken})
	testEndpoint("Admin Audit Logs", "GET", "/api/v1/auth/admin/audit", nil, map[string]string{"X-Axiom-Key": AdminToken})
	testEndpoint("Admin Templates", "GET", "/api/v1/auth/admin/templates", nil, map[string]string{"X-Axiom-Key": AdminToken})

	// 9. Remaining Core / Real-time / Extra
	testEndpoint("Health Ready Check", "GET", "/ready", nil, map[string]string{})

	// Run logout last to invalidate session
	testEndpoint("Auth Logout", "POST", "/api/v1/auth/logout", map[string]string{"refresh_token": refreshToken}, bearer)

	fmt.Printf("Tests complete. Results written to %s\n", OutFile)
}
