package main

import (
	"fmt"
	"os"
)

func main() {  
	if len(os.Args) < 2 {
		fmt.Println("❌ Please specify a demo to run!")
		fmt.Println("Available demos:")
		fmt.Println("  db_fetch   - RunDbFetchData")
		fmt.Println("  db_insert  - RunDbInsertData")
		fmt.Println("  db_drop    - RunDbDropTables")
		fmt.Println("\nExample usage: go run . db_fetch")
		return
	}

	demo := os.Args[1]

	switch demo {
	case "db_fetch":
		RunDbFetchData()
	case "db_insert":
		RunDbInsertData()
	case "db_drop":
		RunDbDropTables()
	default:
		fmt.Printf("❌ Unknown demo: %s\n", demo)
	}
}
