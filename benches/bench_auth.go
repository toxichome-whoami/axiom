package main

import (
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type BenchResult struct {
	Suite             string  `json:"suite"`
	Timestamp         string  `json:"timestamp"`
	GitCommit         string  `json:"git_commit"`
	TotalRequests     int64   `json:"total_requests"`
	Successful        int64   `json:"successful"`
	Failed            int64   `json:"failed"`
	DurationSeconds   float64 `json:"duration_seconds"`
	RequestsPerSecond float64 `json:"requests_per_second"`
	LatencyP50Ms      float64 `json:"latency_p50_ms"`
	LatencyP95Ms      float64 `json:"latency_p95_ms"`
	LatencyP99Ms      float64 `json:"latency_p99_ms"`
}

func getGitCommit() string {
	out, err := exec.Command("git", "rev-parse", "--short", "HEAD").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}

func main() {
	targetURL := flag.String("url", "http://localhost:4500/api/v1/db/databases", "Target Auth URL")
	keyName := flag.String("key", "test_admin", "API Key name")
	keySecret := flag.String("secret", "test_secret", "API Key secret")
	totalReqs := flag.Int64("requests", 5000, "Total number of requests")
	concurrency := flag.Int("concurrency", 50, "Number of concurrent goroutines")
	flag.Parse()

	rawCreds := fmt.Sprintf("%s:%s", *keyName, *keySecret)
	encodedToken := base64.StdEncoding.EncodeToString([]byte(rawCreds))

	transport := &http.Transport{
		MaxIdleConns:        500,
		MaxIdleConnsPerHost: 500,
		IdleConnTimeout:     30 * time.Second,
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   5 * time.Second,
	}

	latencies := make([]float64, *totalReqs)
	var latenciesLock sync.Mutex
	var successful int64
	var failed int64
	var reqCounter int64

	startTime := time.Now()
	var wg sync.WaitGroup

	for i := 0; i < *concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				idx := atomic.AddInt64(&reqCounter, 1) - 1
				if idx >= *totalReqs {
					break
				}

				req, err := http.NewRequest("GET", *targetURL, nil)
				if err != nil {
					atomic.AddInt64(&failed, 1)
					continue
				}
				req.Header.Set("X-Axiom-Key", encodedToken)

				reqStart := time.Now()
				resp, err := client.Do(req)
				elapsedMs := float64(time.Since(reqStart).Microseconds()) / 1000.0

				if err == nil && (resp.StatusCode >= 200 && resp.StatusCode < 400) {
					atomic.AddInt64(&successful, 1)
					resp.Body.Close()
				} else {
					atomic.AddInt64(&failed, 1)
					if resp != nil {
						resp.Body.Close()
					}
				}

				latenciesLock.Lock()
				latencies[idx] = elapsedMs
				latenciesLock.Unlock()
			}
		}()
	}

	wg.Wait()
	totalDuration := time.Since(startTime).Seconds()

	sort.Float64s(latencies)
	p50 := latencies[int(float64(len(latencies))*0.50)]
	p95 := latencies[int(float64(len(latencies))*0.95)]
	p99 := latencies[int(float64(len(latencies))*0.99)]

	rps := float64(*totalReqs) / totalDuration

	res := BenchResult{
		Suite:             "bench_auth",
		Timestamp:         time.Now().UTC().Format(time.RFC3339),
		GitCommit:         getGitCommit(),
		TotalRequests:     *totalReqs,
		Successful:        successful,
		Failed:            failed,
		DurationSeconds:   totalDuration,
		RequestsPerSecond: rps,
		LatencyP50Ms:      p50,
		LatencyP95Ms:      p95,
		LatencyP99Ms:      p99,
	}

	out, _ := json.MarshalIndent(res, "", "  ")
	fmt.Println(string(out))
	if failed > 0 {
		os.Exit(1)
	}
}
