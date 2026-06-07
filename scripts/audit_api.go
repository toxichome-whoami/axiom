//go:build ignore
// +build ignore

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var (
	AdminToken  string
	BaseURL     string = "http://localhost:4500"
	DBName      string = "localdb"
	StorageName string = "local_uploads"
	OutFile     string = `..\audit_full_results.txt`
)

func loadEnv() {
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
				case "STORAGE_NAME":
					StorageName = val
				}
			}
		}
	}
}

func logResult(category, name, method, url, status, message string) {
	outputBlock := fmt.Sprintf(
		"[%s] %s\nRequest: %s %s\nStatus: %s\nResponse:\n%s\n%s\n",
		category, name, method, url, status, message, strings.Repeat("-", 60),
	)
	fmt.Print(outputBlock)
	f, err := os.OpenFile(OutFile, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
	if err == nil {
		f.WriteString(outputBlock)
		f.Close()
	}
}

func doRequest(category, name, method, path string, data interface{}, headers map[string]string) map[string]interface{} {
	var reqBody io.Reader
	if data != nil {
		if strData, ok := data.(string); ok {
			reqBody = strings.NewReader(strData)
		} else {
			jsonData, _ := json.Marshal(data)
			reqBody = bytes.NewReader(jsonData)
			if headers == nil {
				headers = make(map[string]string)
			}
			if _, exists := headers["Content-Type"]; !exists {
				headers["Content-Type"] = "application/json"
			}
		}
	}

	url := BaseURL + path
	if strings.HasPrefix(path, "http") {
		url = path
	}
	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		logResult(category, name, method, url, "ERROR", err.Error())
		return nil
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if _, exists := headers["X-Axiom-Key"]; !exists && AdminToken != "" {
		req.Header.Set("X-Axiom-Key", AdminToken)
	}

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)

	if err != nil {
		logResult(category, name, method, url, "ERROR", err.Error())
		return nil
	}
	defer resp.Body.Close()

	respBodyBytes, _ := io.ReadAll(resp.Body)
	status := fmt.Sprintf("%d", resp.StatusCode)

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

	logResult(category, name, method, url, status, formattedJSON)
	return parsed
}

func doUploadRequest(category, name, path string, targetPath string, content string) {
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	w.WriteField("action", "direct")
	w.WriteField("path", targetPath)

	fw, _ := w.CreateFormFile("file", filepath.Base(targetPath))
	io.Copy(fw, strings.NewReader(content))
	w.Close()

	headers := map[string]string{
		"Content-Type": w.FormDataContentType(),
		"X-Axiom-Key":  AdminToken,
	}

	url := BaseURL + path
	req, err := http.NewRequest("POST", url, &b)
	if err != nil {
		logResult(category, name, "POST", url, "ERROR", err.Error())
		return
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		logResult(category, name, "POST", url, "ERROR", err.Error())
		return
	}
	defer resp.Body.Close()

	respBodyBytes, _ := io.ReadAll(resp.Body)
	logResult(category, name, "POST", url, fmt.Sprintf("%d", resp.StatusCode), string(respBodyBytes))
}

func main() {
	loadEnv()
	if AdminToken == "" {
		// Provide a default fallback token for the audit script if env fails
		AdminToken = base64.StdEncoding.EncodeToString([]byte("admin:your_secret_here"))
	}

	fmt.Println("Starting Comprehensive Axiom Audit & Security Tests...")
	os.WriteFile(OutFile, []byte(fmt.Sprintf("AXIOM COMPREHENSIVE SECURITY AUDIT RESULTS\n%s\n\n", strings.Repeat("=", 60))), 0644)

	// --- 1.1 Authentication Layer ---
	cat := "1.1 Auth Layer"
	doRequest(cat, "Valid Request", "GET", "/api/v1/db/databases", nil, nil)
	doRequest(cat, "Empty Key", "GET", "/api/v1/db/databases", nil, map[string]string{"X-Axiom-Key": ""})
	doRequest(cat, "Invalid Base64", "GET", "/api/v1/db/databases", nil, map[string]string{"X-Axiom-Key": "notbase64!!!"})
	doRequest(cat, "Wrong Secret", "GET", "/api/v1/db/databases", nil, map[string]string{"X-Axiom-Key": base64.StdEncoding.EncodeToString([]byte("admin:wrongsecret"))})
	doRequest(cat, "Colon Only", "GET", "/api/v1/db/databases", nil, map[string]string{"X-Axiom-Key": base64.StdEncoding.EncodeToString([]byte(":secret"))})
	doRequest(cat, "Name Only", "GET", "/api/v1/db/databases", nil, map[string]string{"X-Axiom-Key": base64.StdEncoding.EncodeToString([]byte("admin"))})
	doRequest(cat, "Empty Secret", "GET", "/api/v1/db/databases", nil, map[string]string{"X-Axiom-Key": base64.StdEncoding.EncodeToString([]byte("admin:"))})
	doRequest(cat, "Bearer Prefix Support", "GET", "/api/v1/db/databases", nil, map[string]string{"Authorization": "Bearer " + AdminToken})

	// --- 1.2 WAF Middleware ---
	cat = "1.2 WAF"
	doRequest(cat, "Path Traversal (Direct)", "GET", "/api/v1/db/../../../etc/passwd", nil, nil)
	doRequest(cat, "Path Traversal (Encoded)", "GET", "/api/v1/db/%2e%2e%2f%2e%2e%2fetc/passwd", nil, nil)
	doRequest(cat, "Path Traversal (Double Encoded)", "GET", "/api/v1/%252e%252e/etc/passwd", nil, nil)
	doRequest(cat, "Null Byte Injection", "GET", "/api/v1/db/localdb\x00/tables", nil, nil)

	longParams := make([]string, 55)
	for i := range longParams {
		longParams[i] = "a=b"
	}
	doRequest(cat, "Query Param Flood", "GET", "/api/v1/db/databases?"+strings.Join(longParams, "&"), nil, nil)

	longUri := strings.Repeat("a", 2100)
	doRequest(cat, "URI Too Long", "GET", "/api/v1/"+longUri, nil, nil)

	// --- 1.3 SQL Injection & AST ---
	cat = "1.3 SQL Injection"
	doRequest(cat, "Multiple Statements (Stacked)", "POST", fmt.Sprintf("/api/v1/db/%s/query", DBName), map[string]interface{}{"sql": "SELECT 1; SELECT 2", "params": map[string]interface{}{}}, nil)
	doRequest(cat, "UNION Attack", "POST", fmt.Sprintf("/api/v1/db/%s/query", DBName), map[string]interface{}{"sql": "SELECT 1 UNION SELECT secret FROM api_keys", "params": map[string]interface{}{}}, nil)
	doRequest(cat, "Sleep/Timing Attack", "POST", fmt.Sprintf("/api/v1/db/%s/query", DBName), map[string]interface{}{"sql": "SELECT pg_sleep(5)", "params": map[string]interface{}{}}, nil)
	doRequest(cat, "Dangerous DROP", "POST", fmt.Sprintf("/api/v1/db/%s/query", DBName), map[string]interface{}{"sql": "DROP TABLE users", "params": map[string]interface{}{}}, nil)
	doRequest(cat, "Comment Injection", "POST", fmt.Sprintf("/api/v1/db/%s/query", DBName), map[string]interface{}{"sql": "SELECT * FROM users; DROP TABLE users;--", "params": map[string]interface{}{}}, nil)

	// --- 1.4 Storage Traversal ---
	cat = "1.4 Storage Security"
	doRequest(cat, "Traversal via Path Param", "GET", fmt.Sprintf("/api/v1/fs/%s/download?path=/../../../etc/passwd", StorageName), nil, nil)
	doRequest(cat, "Traversal Encoded", "GET", fmt.Sprintf("/api/v1/fs/%s/download?path=%%2F..%%2F..%%2Fetc%%2Fpasswd", StorageName), nil, nil)
	doRequest(cat, "Null Byte in Filename", "GET", fmt.Sprintf("/api/v1/fs/%s/download?path=/file.txt%%00.jpg", StorageName), nil, nil)
	doRequest(cat, "Absolute Path Escape", "GET", fmt.Sprintf("/api/v1/fs/%s/download?path=/etc/passwd", StorageName), nil, nil)
	doRequest(cat, "UNC Path Escape", "GET", fmt.Sprintf("/api/v1/fs/%s/download?path=\\\\attacker.com\\share", StorageName), nil, nil)
	doUploadRequest(cat, "Blocked Extension Upload", fmt.Sprintf("/api/v1/fs/%s/upload", StorageName), "/test/evil.exe", "MZ executable bytes...")

	// --- 1.5 Edge Cases ---
	cat = "4.1 Malformed Edge Cases"
	doRequest(cat, "Malformed JSON Body", "POST", fmt.Sprintf("/api/v1/db/%s/query", DBName), "not json at all", map[string]string{"Content-Type": "application/json"})
	doRequest(cat, "Empty JSON Body", "POST", fmt.Sprintf("/api/v1/db/%s/query", DBName), "{}", map[string]string{"Content-Type": "application/json"})
	doRequest(cat, "Whitespace SQL", "POST", fmt.Sprintf("/api/v1/db/%s/query", DBName), map[string]interface{}{"sql": "   ", "params": map[string]interface{}{}}, nil)

	// Extremely long SQL string
	longSql := "SELECT " + strings.Repeat("a,", 10000) + "1"
	doRequest(cat, "Extremely Long SQL", "POST", fmt.Sprintf("/api/v1/db/%s/query", DBName), map[string]interface{}{"sql": longSql, "params": map[string]interface{}{}}, nil)

	// --- 6.1 Presigned URLs ---
	cat = "6.1 Presigned URLs"
	presignResp := doRequest(cat, "Generate Valid URL", "POST", fmt.Sprintf("/api/v1/fs/%s/presign", StorageName), map[string]interface{}{
		"path":       "/test_presign.txt",
		"method":     "GET",
		"expires_in": 3600,
	}, nil)

	if presignResp != nil && presignResp["url"] != nil {
		presignedURL := presignResp["url"].(string)
		doRequest(cat, "Access Valid URL Without Auth", "GET", presignedURL, nil, map[string]string{"X-Axiom-Key": ""})

		tamperedURL := presignedURL + "tamper"
		doRequest(cat, "Access Tampered URL", "GET", tamperedURL, nil, map[string]string{"X-Axiom-Key": ""})
	}

	// --- 6.2 Database Migrations ---
	cat = "6.2 Migrations"
	doRequest(cat, "List Migrations (Admin)", "GET", fmt.Sprintf("/api/v1/db/%s/migrations", DBName), nil, nil)
	doRequest(cat, "Apply Migrations (Admin)", "POST", fmt.Sprintf("/api/v1/db/%s/migrations", DBName), nil, nil)

	// Assuming an invalid/readonly key test
	limToken := base64.StdEncoding.EncodeToString([]byte("limited_key:limited_secret_here_32_chars_min"))
	doRequest(cat, "Apply Migrations (Non-Admin Key)", "POST", fmt.Sprintf("/api/v1/db/%s/migrations", DBName), nil, map[string]string{"X-Axiom-Key": limToken})

	// --- 6.3 OAuth 2.0 ---
	cat = "6.3 OAuth 2.0"
	doRequest(cat, "Google Redirect", "GET", "/api/v1/auth/admin/oauth/google/url", nil, nil)
	doRequest(cat, "GitHub Redirect", "GET", "/api/v1/auth/admin/oauth/github/url", nil, nil)
	doRequest(cat, "Forged Callback", "GET", "/api/v1/auth/admin/oauth/google/callback?code=fakecode&state=admin", nil, nil)

	// --- 6.4 Storage Caching ---
	cat = "6.4 Storage Cache"
	doRequest(cat, "Fetch Storage Usage", "GET", "/api/v1/fs/storages", nil, nil)

	fmt.Printf("\nComprehensive audit tests complete. Full results written to %s\n", OutFile)
}
