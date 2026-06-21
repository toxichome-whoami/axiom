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
	OutFile     = `../api_test_results.txt`
	ReportData  []string
	TotalTests  int
	PassedTests int
	FailedTests int
)

func loadEnv() {
	BaseURL = "http://localhost:4500"
	DBName = "localdb"
	DBTable = "demo_graphql_users"
	StorageName = "local_uploads"

	content, err := os.ReadFile(".env")
	if err != nil {
		content, err = os.ReadFile("../.env")
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

	TotalTests++
	if status == "500" || status == "ERROR" {
		FailedTests++
	} else {
		PassedTests++
	}

	ReportData = append(ReportData, outputBlock)

	return parsed
}

func writeLog(message, name, method, url, status string) {
	outputBlock := fmt.Sprintf(
		"Endpoint Name: %s\nRequest: %s %s\nStatus: %s\nResponse:\n%s\n%s\n",
		name, method, url, status, message, strings.Repeat("-", 60),
	)
	ReportData = append(ReportData, outputBlock)
}

func SaveReport() {
	headerText := fmt.Sprintf("AXIOM API ENDPOINT TEST RESULTS (MODULAR SUITE)\n%s\n\n", strings.Repeat("=", 60))
	summaryText := fmt.Sprintf("TOTAL TESTS: %d | PASSED: %d | FAILED (500s/ERRORs): %d\n%s\n\n", TotalTests, PassedTests, FailedTests, strings.Repeat("=", 60))

	finalContent := headerText + summaryText + strings.Join(ReportData, "")
	err := os.WriteFile(OutFile, []byte(finalContent), 0644)
	if err != nil {
		fmt.Printf("Failed to write log file: %v\n", err)
	} else {
		fmt.Printf("Tests complete. Results written to %s\n", OutFile)
	}
}
