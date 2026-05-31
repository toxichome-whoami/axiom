package main

import (
	"bufio"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
)

func RunSseClient() {
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
	table := os.Getenv("AXIOM_WS_TABLE")
	if table == "" {
		table = "users"
	}

	authStr := fmt.Sprintf("%s:%s", keyName, keySecret)
	encodedAuth := base64.StdEncoding.EncodeToString([]byte(authStr))
	// Axiom SSE endpoints support ?token= URL parameter for auth since EventSource in browsers doesn't support headers well.
	endpoint := fmt.Sprintf("%s/api/v1/sse/db/%s/%s?token=%s", baseURL, db, table, encodedAuth)

	fmt.Println(strings.Repeat("=", 55))
	fmt.Println("  AXIOM SSE (SERVER-SENT EVENTS) DEMO")
	fmt.Println(strings.Repeat("=", 55))
	fmt.Printf("  Server : %s\n", baseURL)
	fmt.Printf("  DB     : %s\n", db)
	fmt.Printf("  Table  : %s\n", table)
	fmt.Println(strings.Repeat("=", 55) + "\n")

	fmt.Printf("[Listener] Connecting to SSE Stream: %s ...\n", endpoint)

	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		log.Fatalf("Failed to create request: %v", err)
	}
	req.Header.Set("Accept", "text/event-stream")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatalf("SSE request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Fatalf("Expected 200 OK, got %d", resp.StatusCode)
	}

	fmt.Println("[Listener] Connected! Waiting for events...")

	reader := bufio.NewReader(resp.Body)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			log.Fatalf("Stream closed or error: %v", err)
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if line == ": heartbeat" {
			fmt.Println("[Listener] 💓 Heartbeat received")
			continue
		}

		if strings.HasPrefix(line, "data:") {
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			fmt.Printf("\n[Listener] 🔥 Live event received! Data: %s\n", data)
		} else {
			fmt.Printf("[Listener] Received: %s\n", line)
		}
	}
}


