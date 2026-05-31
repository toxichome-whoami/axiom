package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/joho/godotenv"
)

func verifySignature(payload []byte, signature, secret string) bool {
	if signature == "" {
		return false
	}
	
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	expectedMAC := hex.EncodeToString(mac.Sum(nil))
	expectedSignature := "sha256=" + expectedMAC
	
	return hmac.Equal([]byte(signature), []byte(expectedSignature))
}

func webhookHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Error reading body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	secret := os.Getenv("WEBHOOK_SECRET")
	if secret == "" {
		secret = "my_super_secret_webhook_key"
	}

	signature := r.Header.Get("X-Axiom-Signature")
	
	if !verifySignature(body, signature, secret) {
		fmt.Println("❌ Webhook signature verification failed!")
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	fmt.Println("✅ Webhook received and verified successfully!")
	fmt.Printf("Payload: %s\n", string(body))
	
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status": "ok"}`))
}

func RunWebhookReceiver() {
	_ = godotenv.Load(filepath.Join(".", ".env"))
	port := "8080"
	http.HandleFunc("/webhook", webhookHandler)
	
	fmt.Printf("🚀 Starting webhook receiver on http://localhost:%s/webhook\n", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}


