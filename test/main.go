package main

import (
	"fmt"
)

func main() {
	loadEnv()

	fmt.Println("Starting modular API tests...")

	RunCoreTests()
	RunDBTests()
	RunStorageTests()

	bearer, refreshToken := RunAuthTests()
	RunAdminTests()
	RunAuthLogoutTest(bearer, refreshToken)

	SaveReport()
}
