package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"

	"github.com/joho/godotenv"
)

func RunFsFileUpload() {
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

	storageAlias := "local_uploads"
	endpoint := fmt.Sprintf("/api/v1/fs/%s/upload", storageAlias)
	url := fmt.Sprintf("%s%s", baseURL, endpoint)

	fmt.Println("🚀 Uploading file to Axiom Storage...")

	// Create a dummy file to upload
	fileContent := []byte("Hello, this is a test file uploaded via Go!")
	
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "demo_upload.txt")
	if err != nil {
		log.Fatalf("Failed to create form file: %v", err)
	}
	part.Write(fileContent)
	writer.Close()

	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		log.Fatalf("Failed to create request: %v", err)
	}

	authStr := fmt.Sprintf("%s:%s", keyName, keySecret)
	encodedAuth := base64.StdEncoding.EncodeToString([]byte(authStr))
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", encodedAuth))
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatalf("Upload failed: %v", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Fatalf("API Error: %d - %s", resp.StatusCode, string(respBody))
	}

	fmt.Printf("✅ Upload successful! Response: %s\n", string(respBody))
}


