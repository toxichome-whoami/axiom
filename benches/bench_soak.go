package main

import (
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// SoakConfig holds runtime parameters for the steady-state soak test.
type SoakConfig struct {
	TargetURL    string
	Duration     time.Duration
	Concurrency  int
	ReportWindow time.Duration
	APIKey       string
}

// WindowStats tracks throughput and latency percentiles for an interval slice.
type WindowStats struct {
	WindowIndex int       `json:"window_index"`
	StartTime   time.Time `json:"start_time"`
	Requests    int64     `json:"requests"`
	Errors      int64     `json:"errors"`
	P50Ms       float64   `json:"latency_p50_ms"`
	P95Ms       float64   `json:"latency_p95_ms"`
	P99Ms       float64   `json:"latency_p99_ms"`
	RPS         float64   `json:"requests_per_second"`
}

// SoakReport represents the final benchmark output conforming to Master Plan Section 21.
type SoakReport struct {
	Suite             string        `json:"suite"`
	Timestamp         string        `json:"timestamp"`
	TotalRequests     int64         `json:"total_requests"`
	Successful        int64         `json:"successful"`
	Failed            int64         `json:"failed"`
	DurationSeconds   float64       `json:"duration_seconds"`
	RequestsPerSecond float64       `json:"requests_per_second"`
	LatencyP50Ms      float64       `json:"latency_p50_ms"`
	LatencyP95Ms      float64       `json:"latency_p95_ms"`
	LatencyP99Ms      float64       `json:"latency_p99_ms"`
	LatencyDriftPct   float64       `json:"latency_drift_pct"`
	ErrorDrift        float64       `json:"error_drift"`
	DriftDetected     bool          `json:"drift_detected"`
	Windows           []WindowStats `json:"windows"`
}

func main() {
	targetURL := flag.String("url", "http://127.0.0.1:4500/health", "Target endpoint URL for soak test")
	durationStr := flag.String("duration", "10s", "Soak duration (e.g. 10s, 5m, 30m)")
	concurrency := flag.Int("concurrency", 20, "Number of concurrent worker routines")
	windowStr := flag.String("window", "2s", "Sampling window duration for drift tracking")
	apiKey := flag.String("key", "", "Optional base64 X-Axiom-Key")
	flag.Parse()

	dur, err := time.ParseDuration(*durationStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Invalid duration '%s': %v\n", *durationStr, err)
		os.Exit(1)
	}

	winDur, err := time.ParseDuration(*windowStr)
	if err != nil {
		winDur = 2 * time.Second
	}

	cfg := SoakConfig{
		TargetURL:    *targetURL,
		Duration:     dur,
		Concurrency:  *concurrency,
		ReportWindow: winDur,
		APIKey:       *apiKey,
	}

	fmt.Printf("=== Axiom Soak Benchmark Starting ===\n")
	fmt.Printf("Target URL:    %s\n", cfg.TargetURL)
	fmt.Printf("Duration:      %v\n", cfg.Duration)
	fmt.Printf("Concurrency:   %d workers\n", cfg.Concurrency)
	fmt.Printf("Sample Window: %v\n\n", cfg.ReportWindow)

	report := runSoakTest(cfg)

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(report); err != nil {
		fmt.Fprintf(os.Stderr, "JSON encoding error: %v\n", err)
	}
}

func runSoakTest(cfg SoakConfig) SoakReport {
	transport := &http.Transport{
		MaxIdleConns:        cfg.Concurrency * 2,
		MaxIdleConnsPerHost: cfg.Concurrency * 2,
		IdleConnTimeout:     90 * time.Second,
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   10 * time.Second,
	}

	var totalReqs int64
	var totalErrors int64

	stopChan := make(chan struct{})
	var allLatencies []time.Duration
	var latMutex sync.Mutex

	startTime := time.Now()
	endTime := startTime.Add(cfg.Duration)

	// Window sampling structures
	var windows []WindowStats
	var winMu sync.Mutex

	// Background ticker collecting window snapshots
	ticker := time.NewTicker(cfg.ReportWindow)
	defer ticker.Stop()

	go func() {
		var lastReqs int64
		var lastErrors int64
		var lastTime = startTime
		idx := 0

		for {
			select {
			case <-stopChan:
				return
			case t := <-ticker.C:
				currReqs := atomic.LoadInt64(&totalReqs)
				currErr := atomic.LoadInt64(&totalErrors)
				deltaReqs := currReqs - lastReqs
				deltaErr := currErr - lastErrors
				elapsed := t.Sub(lastTime).Seconds()

				rps := 0.0
				if elapsed > 0 {
					rps = float64(deltaReqs) / elapsed
				}

				win := WindowStats{
					WindowIndex: idx,
					StartTime:   lastTime,
					Requests:    deltaReqs,
					Errors:      deltaErr,
					RPS:         rps,
				}

				winMu.Lock()
				windows = append(windows, win)
				winMu.Unlock()

				lastReqs = currReqs
				lastErrors = currErr
				lastTime = t
				idx++
			}
		}
	}()

	var wg sync.WaitGroup
	for i := 0; i < cfg.Concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			localLats := make([]time.Duration, 0, 1000)

			for time.Now().Before(endTime) {
				req, err := http.NewRequest("GET", cfg.TargetURL, nil)
				if err != nil {
					atomic.AddInt64(&totalErrors, 1)
					continue
				}

				if cfg.APIKey != "" {
					req.Header.Set("X-Axiom-Key", cfg.APIKey)
				}

				start := time.Now()
				resp, err := client.Do(req)
				latency := time.Since(start)

				if err != nil {
					atomic.AddInt64(&totalErrors, 1)
				} else {
					io.Copy(io.Discard, resp.Body)
					resp.Body.Close()
					if resp.StatusCode >= 400 && resp.StatusCode != 404 {
						atomic.AddInt64(&totalErrors, 1)
					}
				}

				atomic.AddInt64(&totalReqs, 1)
				localLats = append(localLats, latency)
			}

			latMutex.Lock()
			allLatencies = append(allLatencies, localLats...)
			latMutex.Unlock()
		}()
	}

	wg.Wait()
	close(stopChan)

	actualDuration := time.Since(startTime).Seconds()
	reqCount := atomic.LoadInt64(&totalReqs)
	errCount := atomic.LoadInt64(&totalErrors)
	succCount := reqCount - errCount

	// Calculate overall percentiles
	p50, p95, p99 := calcPercentiles(allLatencies)

	// Calculate latency drift: compare first window vs last window
	var driftPct float64
	var errorDrift float64
	var driftDetected bool

	winMu.Lock()
	if len(windows) >= 2 {
		firstWin := windows[0]
		lastWin := windows[len(windows)-1]

		if firstWin.RPS > 0 {
			driftPct = math.Abs(lastWin.RPS-firstWin.RPS) / firstWin.RPS * 100.0
		}
		errorDrift = float64(lastWin.Errors - firstWin.Errors)
		if driftPct > 25.0 || errorDrift > 0 {
			driftDetected = true
		}
	}
	finalWindows := windows
	winMu.Unlock()

	rps := 0.0
	if actualDuration > 0 {
		rps = float64(reqCount) / actualDuration
	}

	return SoakReport{
		Suite:             "bench_soak",
		Timestamp:         time.Now().UTC().Format(time.RFC3339),
		TotalRequests:     reqCount,
		Successful:        succCount,
		Failed:            errCount,
		DurationSeconds:   actualDuration,
		RequestsPerSecond: rps,
		LatencyP50Ms:      p50,
		LatencyP95Ms:      p95,
		LatencyP99Ms:      p99,
		LatencyDriftPct:   driftPct,
		ErrorDrift:        errorDrift,
		DriftDetected:     driftDetected,
		Windows:           finalWindows,
	}
}

func calcPercentiles(lats []time.Duration) (p50, p95, p99 float64) {
	if len(lats) == 0 {
		return 0, 0, 0
	}

	sort.Slice(lats, func(i, j int) bool {
		return lats[i] < lats[j]
	})

	n := float64(len(lats))
	idx50 := int(n * 0.50)
	idx95 := int(n * 0.95)
	idx99 := int(n * 0.99)

	if idx50 >= len(lats) {
		idx50 = len(lats) - 1
	}
	if idx95 >= len(lats) {
		idx95 = len(lats) - 1
	}
	if idx99 >= len(lats) {
		idx99 = len(lats) - 1
	}

	return float64(lats[idx50].Microseconds()) / 1000.0,
		float64(lats[idx95].Microseconds()) / 1000.0,
		float64(lats[idx99].Microseconds()) / 1000.0
}
