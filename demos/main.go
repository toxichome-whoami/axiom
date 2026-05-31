package main

import (
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("❌ Please specify a demo to run!")
		fmt.Println("Available demos:")
		fmt.Println("  auth       - RunAuthFlow")
		fmt.Println("  db_fetch   - RunDbFetchData")
		fmt.Println("  db_insert  - RunDbInsertData")
		fmt.Println("  db_drop    - RunDbDropTables")
		fmt.Println("  fs_upload  - RunFsFileUpload")
		fmt.Println("  sse        - RunSseClient")
		fmt.Println("  websocket  - RunWebsocketMessaging")
		fmt.Println("  webhook    - RunWebhookReceiver")
		fmt.Println("  graphql    - RunGraphqlApi")
		fmt.Println("  mcp        - RunMcpClient")
		fmt.Println("  federation - RunFederationTest")
		fmt.Println("\nExample usage: go run . auth")
		return
	}

	demo := os.Args[1]

	switch demo {
	case "auth":
		RunAuthFlow()
	case "db_fetch":
		RunDbFetchData()
	case "db_insert":
		RunDbInsertData()
	case "db_drop":
		RunDbDropTables()
	case "fs_upload":
		RunFsFileUpload()
	case "sse":
		RunSseClient()
	case "websocket":
		RunWebsocketMessaging()
	case "webhook":
		RunWebhookReceiver()
	case "graphql":
		RunGraphqlApi()
	case "mcp":
		RunMcpClient()
	case "federation":
		RunFederationTest()
	default:
		fmt.Printf("❌ Unknown demo: %s\n", demo)
	}
}
