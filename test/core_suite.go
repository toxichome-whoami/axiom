package main

func RunCoreTests() {
	testEndpoint("Health Check", "GET", "/health", nil, map[string]string{})
	testEndpoint("Metrics", "GET", "/metrics", nil, map[string]string{"X-Axiom-Key": AdminToken})
	testEndpoint("Health Ready Check", "GET", "/ready", nil, map[string]string{})

	testEndpoint("List Federated Servers", "GET", "/api/v1/fed/servers", nil, nil)

	testEndpoint("Webhook Status", "GET", "/api/v1/webhook/status", nil, map[string]string{"X-Axiom-Key": AdminToken})
	testEndpoint("Webhook Dead Letter", "GET", "/api/v1/webhook/dead-letter", nil, map[string]string{"X-Axiom-Key": AdminToken})
	testEndpoint("Webhook Dead Letter Replay", "POST", "/api/v1/webhook/dead-letter/replay", map[string]string{"event_id": "dummy"}, map[string]string{"X-Axiom-Key": AdminToken})

	testEndpoint("SSE Health", "GET", "/api/v1/sse/health", nil, nil)
	testEndpoint("SSE Metrics", "GET", "/api/v1/sse/metrics", nil, nil)
	testEndpoint("WebSocket Handshake (Probe)", "GET", "/api/v1/ws", nil, nil)
	testEndpoint("MCP Messages", "POST", "/api/v1/mcp/messages", map[string]string{"jsonrpc": "2.0"}, nil)
}
