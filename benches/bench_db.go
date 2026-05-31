package main

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Config struct {
	APIURL        string
	APIKey        string
	DBName        string
	FSAlias       string
	Concurrency   int
	TotalRequests int
}

func parseEnvFile(path string) map[string]string {
	env := make(map[string]string)
	content, err := os.ReadFile(path)
	if err != nil {
		return env
	}

	lines := strings.Split(string(content), "\n")
	re := regexp.MustCompile(`^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$`)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		matches := re.FindStringSubmatch(line)
		if len(matches) == 3 {
			key, value := matches[1], matches[2]
			if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[0] == value[len(value)-1] {
				value = value[1 : len(value)-1]
			}
			env[key] = value
		}
	}
	return env
}

func findEnvFile() string {
	cwd, _ := os.Getwd()
	searchDirs := []string{
		cwd,
		filepath.Join(cwd, ".."),
	}
	for _, d := range searchDirs {
		candidate := filepath.Join(d, ".env")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return ""
}

func loadConfig() Config {
	envPath := findEnvFile()
	env := make(map[string]string)
	if envPath != "" {
		fmt.Printf("[config] Loaded .env from: %s\n", envPath)
		env = parseEnvFile(envPath)
	}

	apiUrl := env["API_URL"]
	if apiUrl == "" {
		apiUrl = "http://127.0.0.1:4500"
	}
	apiUrl = strings.TrimRight(apiUrl, "/")

	apiKey := env["API_KEY"]
	// If it's a plaintext name:secret pair, base64 encode it to match backend requirements
	if strings.Contains(apiKey, ":") {
		apiKey = base64.StdEncoding.EncodeToString([]byte(apiKey))
	}

	dbName := env["DB_NAME"]
	if dbName == "" {
		dbName = "localdb"
	}

	fsAlias := env["FS_ALIAS"]
	if fsAlias == "" {
		fsAlias = "local_uploads"
	}

	concurrency := 200
	if c, err := strconv.Atoi(env["CONCURRENCY"]); err == nil {
		concurrency = c
	}

	totalReqs := 2000
	if t, err := strconv.Atoi(env["TOTAL_REQUESTS"]); err == nil {
		totalReqs = t
	}

	return Config{
		APIURL:        apiUrl,
		APIKey:        apiKey,
		DBName:        dbName,
		FSAlias:       fsAlias,
		Concurrency:   concurrency,
		TotalRequests: totalReqs,
	}
}

type BenchResult struct {
	Label      string
	Duration   float64
	Success    int
	Failed     int
	Throughput float64
	Latencies  []float64
	Errors     map[int]int
}

func runBenchmarkTask(label, method, url string, payload interface{}, config Config) BenchResult {
	fmt.Printf("\n============================================================\n")
	fmt.Printf("  Benchmark: %s\n", label)
	fmt.Printf("  Endpoint:  %s\n", url)
	fmt.Printf("  Load:      %d requests @ %d concurrency\n", config.TotalRequests, config.Concurrency)
	fmt.Printf("============================================================\n")

	transport := &http.Transport{
		MaxIdleConns:        config.Concurrency,
		MaxIdleConnsPerHost: config.Concurrency,
		MaxConnsPerHost:     config.Concurrency,
		IdleConnTimeout:     60 * time.Second,
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}

	fmt.Printf("Warming up cache for %s...\n", label)
	var warmupReq *http.Request
	if payload != nil {
		bodyBytes, _ := json.Marshal(payload)
		warmupReq, _ = http.NewRequest(method, url, bytes.NewReader(bodyBytes))
		warmupReq.Header.Set("Content-Type", "application/json")
	} else {
		warmupReq, _ = http.NewRequest(method, url, nil)
	}
	warmupReq.Header.Set("X-Axiom-Key", config.APIKey)
	if warmupResp, err := client.Do(warmupReq); err == nil {
		io.Copy(io.Discard, warmupResp.Body)
		warmupResp.Body.Close()
	}

	var bodyBytes []byte
	if payload != nil {
		bodyBytes, _ = json.Marshal(payload)
	}

	var mu sync.Mutex
	latencies := make([]float64, 0, config.TotalRequests)
	success := 0
	failed := 0
	errorsCount := make(map[int]int)

	var wg sync.WaitGroup
	requestsPerWorker := config.TotalRequests / config.Concurrency
	remainingRequests := config.TotalRequests % config.Concurrency

	overallStart := time.Now()

	for workerID := range config.Concurrency {
		wg.Add(1)

		// Calculate how many requests this specific worker should handle
		tasksForThisWorker := requestsPerWorker
		if workerID < remainingRequests {
			tasksForThisWorker++
		}

		go func(id int, tasks int) {
			defer wg.Done()

			// Initial connection ramp-up to prevent OS TCP backlog overflow
			// This sleep only happens ONCE per connection, not per request!
			time.Sleep(time.Duration(id) * 200 * time.Microsecond)

			for range tasks {
				start := time.Now()
				var resp *http.Response
				var err error

				for attempt := range 10 {
					var req *http.Request
					if payload != nil {
						req, err = http.NewRequest(method, url, bytes.NewReader(bodyBytes))
						req.Header.Set("Content-Type", "application/json")
					} else {
						req, err = http.NewRequest(method, url, nil)
					}

					if err == nil {
						req.Header.Set("X-Axiom-Key", config.APIKey)
						resp, err = client.Do(req)
						if err == nil {
							break // Success!
						}
					}
					// Exponential backoff only if the connection dropped
					time.Sleep(time.Duration(10*(attempt+1)) * time.Millisecond)
				}

				if err == nil {
					io.Copy(io.Discard, resp.Body)
					resp.Body.Close()

					elapsed := time.Since(start).Seconds() * 1000

					mu.Lock()
					latencies = append(latencies, elapsed)
					if resp.StatusCode == 200 {
						success++
					} else {
						failed++
						errorsCount[resp.StatusCode]++
					}
					mu.Unlock()
				} else {
					mu.Lock()
					failed++
					errorsCount[-1]++
					mu.Unlock()
				}
			}
		}(workerID, tasksForThisWorker)
	}

	wg.Wait()
	overallDuration := time.Since(overallStart).Seconds()

	return BenchResult{
		Label:      label,
		Duration:   overallDuration,
		Success:    success,
		Failed:     failed,
		Throughput: float64(config.TotalRequests) / overallDuration,
		Latencies:  latencies,
		Errors:     errorsCount,
	}
}

func printReport(res BenchResult) {
	fmt.Printf("\n  ── %s Results ──\n", res.Label)
	fmt.Printf("    Duration:       %.2fs\n", res.Duration)
	fmt.Printf("    Successful:     %d\n", res.Success)
	fmt.Printf("    Failed:         %d\n", res.Failed)
	fmt.Printf("    Throughput:     %.2f req/sec\n", res.Throughput)

	if len(res.Latencies) > 0 {
		sort.Float64s(res.Latencies)
		minLat := res.Latencies[0]
		median := res.Latencies[len(res.Latencies)/2]
		p95 := res.Latencies[int(float64(len(res.Latencies))*0.95)]

		var sum float64
		for _, v := range res.Latencies {
			sum += v
		}
		mean := sum / float64(len(res.Latencies))

		fmt.Printf("    Latency (avg):  %.2fms\n", mean)
		fmt.Printf("    Latency (P50):  %.2fms\n", median)
		fmt.Printf("    Latency (P95):  %.2fms\n", p95)
		fmt.Printf("    Latency (min):  %.2fms\n", minLat)
	}

	if len(res.Errors) > 0 {
		for code, count := range res.Errors {
			fmt.Printf("    HTTP %d:      %d\n", code, count)
		}
	}
}

func main() {
	config := loadConfig()
	if config.APIKey == "" {
		fmt.Println("[error] API_KEY not found in .env")
		os.Exit(1)
	}

	// 1. Database Benchmark
	dbPayload := map[string]interface{}{
		"sql":    "SELECT 1",
		"params": map[string]interface{}{},
	}
	dbRes := runBenchmarkTask(
		"Database (SQL Query)",
		"POST",
		fmt.Sprintf("%s/api/v1/db/%s/query", config.APIURL, config.DBName),
		dbPayload,
		config,
	)

	// 2. Filesystem Benchmark
	fsRes := runBenchmarkTask(
		"Filesystem (List Directory)",
		"GET",
		fmt.Sprintf("%s/api/v1/fs/%s/list?path=/", config.APIURL, config.FSAlias),
		nil,
		config,
	)

	printReport(dbRes)
	printReport(fsRes)

	fmt.Printf("\n  ✅ Benchmark complete. DB: %.1f req/s | FS: %.1f req/s\n\n", dbRes.Throughput, fsRes.Throughput)
}
