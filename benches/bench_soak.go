package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type SoakResult struct {
	Suite              string  `json:"suite"`
	Timestamp          string  `json:"timestamp"`
	GitCommit          string  `json:"git_commit"`
	ConfiguredDuration string  `json:"configured_duration"`
	TotalRequests      int64   `json:"total_requests"`
	Successful         int64   `json:"successful"`
	Failed             int64   `json:"failed"`
	ActualDurationSec  float64 `json:"actual_duration_seconds"`
	RequestsPerSecond  float64 `json:"requests_per_second"`
	ErrorRatePercent   float64 `json:"error_rate_percent"`
}

func getGitCommit() string {
	out, err := exec.Command("git", "rev-parse", "--short", "HEAD").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}

func main() {
	targetURL := flag.String("url", "http://localhost:4500/ready", "Target URL")
	durationStr := flag.String("duration", "30s", "Soak duration (e.g. 30s, 5m, 30m)")
	concurrency := flag.Int("concurrency", 20, "Concurrent workers")
	flag.Parse()

	soakDuration, err := time.ParseDuration(*durationStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Invalid duration %s: %v\n", *durationStr, err)
		os.Exit(1)
	}

	transport := &http.Transport{
		MaxIdleConns:        500,
		MaxIdleConnsPerHost: 500,
		IdleConnTimeout:     30 * time.Second,
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   5 * time.Second,
	}

	var totalReqs int64
	var successful int64
	var failed int64

	stopTime := time.Now().Add(soakDuration)
	startTime := time.Now()
	var wg sync.WaitGroup

	for i := 0; i < *concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for time.Now().Before(stopTime) {
				atomic.AddInt64(&totalReqs, 1)
				resp, err := client.Get(*targetURL)
				if err == nil && (resp.StatusCode >= 200 && resp.StatusCode < 400) {
					atomic.AddInt64(&successful, 1)
					resp.Body.Close()
				} else {
					atomic.AddInt64(&failed, 1)
					if resp != nil {
						resp.Body.Close()
					}
				}
				// Slight pause to maintain steady state without slamming CPU
				time.Sleep(2 * time.Millisecond)
			}
		}()
	}

	wg.Wait()
	actualDuration := time.Since(startTime).Seconds()
	errorRate := 0.0
	if totalReqs > 0 {
		errorRate = (float64(failed) / float64(totalReqs)) * 100.0
	}
	rps := 0.0
	if actualDuration > 0 {
		rps = float64(totalReqs) / actualDuration
	}

	res := SoakResult{
		Suite:              "bench_soak",
		Timestamp:          time.Now().UTC().Format(time.RFC3339),
		GitCommit:          getGitCommit(),
		ConfiguredDuration: *durationStr,
		TotalRequests:      totalReqs,
		Successful:         successful,
		Failed:             failed,
		ActualDurationSec:  actualDuration,
		RequestsPerSecond:  rps,
		ErrorRatePercent:   errorRate,
	}

	out, _ := json.MarshalIndent(res, "", "  ")
	fmt.Println(string(out))
	if errorRate > 0.01 { // Max 0.01% error drift
		os.Exit(1)
	}
}
