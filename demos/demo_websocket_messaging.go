package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
)

type WSAuthMessage struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

type SubscribeMessage struct {
	Type      string `json:"type"`
	RequestID string `json:"request_id"`
	Topic     string `json:"topic"`
}

func RunWebsocketMessaging() {
	_ = godotenv.Load(filepath.Join(".", ".env"))
	baseURL := os.Getenv("AXIOM_URL")
	if baseURL == "" {
		baseURL = "http://localhost:4500"
	}
	// Convert http:// to ws://
	wsURL := strings.Replace(baseURL, "http://", "ws://", 1)
	wsURL = strings.Replace(wsURL, "https://", "wss://", 1)

	keyName := os.Getenv("AXIOM_KEY_NAME")
	if keyName == "" {
		keyName = "admin"
	}
	keySecret := os.Getenv("AXIOM_KEY_SECRET")
	if keySecret == "" {
		keySecret = "default_secret"
	}

	authStr := fmt.Sprintf("%s:%s", keyName, keySecret)
	encodedAuth := base64.StdEncoding.EncodeToString([]byte(authStr))

	wsEndpoint := fmt.Sprintf("%s/api/v1/ws", wsURL)

	u, err := url.Parse(wsEndpoint)
	if err != nil {
		log.Fatal("Invalid URL:", err)
	}

	fmt.Printf("🔌 Connecting to WebSocket: %s\n", u.String())

	header := http.Header{}
	header.Set("X-Axiom-Key", encodedAuth)

	c, resp, err := websocket.DefaultDialer.Dial(u.String(), header)
	if err != nil {
		if resp != nil {
			body, _ := io.ReadAll(resp.Body)
			log.Fatalf("Dial error: %v, Status: %s, Body: %s", err, resp.Status, string(body))
		}
		log.Fatal("Dial error:", err)
	}
	defer c.Close()

	fmt.Println("🔐 Connected via authenticated HTTP header...")

	// Listen for messages in background
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			_, message, err := c.ReadMessage()
			if err != nil {
				log.Println("Read error:", err)
				return
			}
			var parsed map[string]interface{}
			if err := json.Unmarshal(message, &parsed); err == nil {
				msgType := parsed["type"]
				if msgType == "connected" {
					fmt.Printf("✅ Connected successfully! Client ID: %v\n", parsed["client_id"])

					// 2. Subscribe to a topic
					subMsg := SubscribeMessage{Type: "subscribe", RequestID: "sub1", Topic: "db:localdb:*"}
					c.WriteJSON(subMsg)
					fmt.Println("📡 Subscribed to db:localdb:*")
				} else if msgType == "heartbeat" {
					fmt.Println("💓 Heartbeat")
				} else {
					fmt.Printf("📨 Message: %s\n", string(message))
				}
			} else {
				fmt.Printf("📨 Raw Message: %s\n", string(message))
			}
		}
	}()

	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt)

	// Keep alive
	for {
		select {
		case <-done:
			return
		case <-interrupt:
			log.Println("Interrupt, closing connection...")
			err := c.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
			if err != nil {
				log.Println("Write close error:", err)
			}
			select {
			case <-done:
			case <-time.After(time.Second):
			}
			return
		}
	}
}


