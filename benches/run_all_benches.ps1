# Axiom Benchmark Suite Runner
param(
    [string]$BaseUrl = "http://localhost:4500",
    [int]$Requests = 2000,
    [int]$Concurrency = 20
)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "       Axiom v4 Benchmark Suite          " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

Write-Host "`n1. Running HTTP Pipeline Benchmark..." -ForegroundColor Yellow
go run bench_http.go -url "$BaseUrl/ready" -requests $Requests -concurrency $Concurrency

Write-Host "`n2. Running Auth Benchmark..." -ForegroundColor Yellow
go run bench_auth.go -url "$BaseUrl/api/v1/db/databases" -requests $Requests -concurrency $Concurrency

Write-Host "`n3. Running Soak Load Benchmark (10s sample)..." -ForegroundColor Yellow
go run bench_soak.go -url "$BaseUrl/ready" -duration "10s" -concurrency $Concurrency

Write-Host "`nBenchmark suite complete." -ForegroundColor Green
