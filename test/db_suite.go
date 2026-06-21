package main

import "fmt"

func RunDBTests() {
	testEndpoint("List Databases", "GET", "/api/v1/db/databases", nil, nil)
	testEndpoint(fmt.Sprintf("List Tables (%s)", DBName), "GET", fmt.Sprintf("/api/v1/db/%s/tables?limit=50", DBName), nil, nil)
	testEndpoint("Fetch Rows", "GET", fmt.Sprintf("/api/v1/db/%s/%s/rows?limit=5&sort=uid&order=asc", DBName, DBTable), nil, nil)
	testEndpoint("Execute SQL Query", "POST", fmt.Sprintf("/api/v1/db/%s/query", DBName), map[string]string{"sql": "SELECT 1 as test"}, nil)

	testEndpoint("GraphQL SQL Execution", "POST", "/api/v1/graphql", map[string]string{"query": fmt.Sprintf(`{ execute(dbAlias: "%s", sql: "SELECT 1 as test") }`, DBName)}, nil)
}
