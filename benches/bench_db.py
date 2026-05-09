#!/usr/bin/env python3
"""
NexusGate Unified Industrial Benchmark
=======================================
High-performance throughput measurement for both DB and FS endpoints.
Uses aiohttp for maximum client-side efficiency.

Usage:
    python benches/bench_db.py
"""

import asyncio
import os
import re
import statistics
import sys
import time
from typing import Any, Dict, List, Optional

import aiohttp
import orjson

# ─────────────────────────────────────────────────────────────────────────────
# .env Loader
# ─────────────────────────────────────────────────────────────────────────────

def _find_env_file() -> Optional[str]:
    """Locate the .env file in project root or current directory."""
    search_dirs = [
        os.path.dirname(os.path.abspath(__file__)),
        os.getcwd(),
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    ]
    for d in search_dirs:
        candidate = os.path.join(d, ".env")
        if os.path.isfile(candidate):
            return candidate
    return None

def _parse_env_file(path: str) -> Dict[str, str]:
    """Parse KEY=VALUE .env file."""
    env: Dict[str, str] = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            match = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$", line)
            if match:
                key, value = match.group(1), match.group(2)
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                    value = value[1:-1]
                env[key] = value
    return env

def _load_config() -> Dict[str, Any]:
    """Load configuration from .env or fallback to defaults."""
    env_file = _find_env_file()
    env = _parse_env_file(env_file) if env_file else {}

    if env_file:
        print(f"[config] Loaded .env from: {env_file}")

    return {
        "api_url": env.get("API_URL", "http://127.0.0.1:4500").rstrip("/"),
        "api_key": env.get("API_KEY", ""),
        "db_name": env.get("DB_NAME", "localdb"),
        "fs_alias": env.get("FS_ALIAS", "local_uploads"),
        "concurrency": int(env.get("CONCURRENCY", "200")),
        "total_requests": int(env.get("TOTAL_REQUESTS", "2000")),
    }

# ─────────────────────────────────────────────────────────────────────────────
# Performance Worker
# ─────────────────────────────────────────────────────────────────────────────

async def _run_benchmark_task(
    label: str,
    method: str,
    url: str,
    headers: Dict[str, str],
    payload: Optional[dict],
    config: Dict[str, Any]
) -> Dict[str, Any]:
    """Execute a high-concurrency benchmark for a specific endpoint."""
    concurrency = config["concurrency"]
    total = config["total_requests"]
    
    print(f"\n{'=' * 60}")
    print(f"  Benchmark: {label}")
    print(f"  Endpoint:  {url}")
    print(f"  Load:      {total} requests @ {concurrency} concurrency")
    print(f"{'=' * 60}")

    connector = aiohttp.TCPConnector(
        limit=concurrency,
        limit_per_host=concurrency,
        keepalive_timeout=60,
        force_close=False
    )

    latencies: List[float] = []
    success = 0
    failed = 0
    errors: Dict[int, int] = {}
    sem = asyncio.Semaphore(concurrency)

    # Pre-serialize body to minimize per-request CPU overhead
    body_bytes = orjson.dumps(payload) if payload else None
    if body_bytes:
        headers["Content-Type"] = "application/json"

    async def worker(session: aiohttp.ClientSession):
        nonlocal success, failed
        async with sem:
            start = time.perf_counter()
            try:
                if method == "POST":
                    async with session.post(url, headers=headers, data=body_bytes) as resp:
                        await resp.read()
                        elapsed = (time.perf_counter() - start) * 1000
                        latencies.append(elapsed)
                        if resp.status == 200:
                            success += 1
                        else:
                            errors[resp.status] = errors.get(resp.status, 0) + 1
                            failed += 1
                else:
                    async with session.get(url, headers=headers) as resp:
                        await resp.read()
                        elapsed = (time.perf_counter() - start) * 1000
                        latencies.append(elapsed)
                        if resp.status == 200:
                            success += 1
                        else:
                            errors[resp.status] = errors.get(resp.status, 0) + 1
                            failed += 1
            except Exception:
                elapsed = (time.perf_counter() - start) * 1000
                latencies.append(elapsed)
                failed += 1

    overall_start = time.perf_counter()
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [asyncio.create_task(worker(session)) for _ in range(total)]
        await asyncio.gather(*tasks)
    
    overall_duration = time.perf_counter() - overall_start
    
    return {
        "label": label,
        "duration": overall_duration,
        "success": success,
        "failed": failed,
        "throughput": total / overall_duration,
        "latency": latencies,
        "errors": errors
    }

# ─────────────────────────────────────────────────────────────────────────────
# Reporting
# ─────────────────────────────────────────────────────────────────────────────

def _p95(latencies: List[float]) -> float:
    if not latencies:
       return 0.0
    return sorted(latencies)[int(len(latencies) * 0.95)]

def _print_report(res: Dict[str, Any]):
    lat = res["latency"]
    print(f"\n  ── {res['label']} Results ──")
    print(f"    Duration:       {res['duration']:.2f}s")
    print(f"    Successful:     {res['success']}")
    print(f"    Failed:         {res['failed']}")
    print(f"    Throughput:     {res['throughput']:.2f} req/sec")
    
    if lat:
        print(f"    Latency (avg):  {statistics.mean(lat):.2f}ms")
        print(f"    Latency (P50):  {statistics.median(lat):.2f}ms")
        print(f"    Latency (P95):  {_p95(lat):.2f}ms")
        print(f"    Latency (min):  {min(lat):.2f}ms")
    
    if res["errors"]:
        for code, count in res["errors"].items():
            print(f"    HTTP {code}:      {count}")

async def main():
    config = _load_config()
    if not config["api_key"]:
        print("[error] API_KEY not found in .env")
        sys.exit(1)

    headers = {"Authorization": f"Bearer {config['api_key']}"}

    # 1. Database Benchmark
    db_res = await _run_benchmark_task(
        "Database (SQL Query)",
        "POST",
        f"{config['api_url']}/api/v1/db/{config['db_name']}/query",
        headers.copy(),
        {"sql": "SELECT 1", "params": {}},
        config
    )

    # 2. Filesystem Benchmark
    fs_res = await _run_benchmark_task(
        "Filesystem (List Directory)",
        "GET",
        f"{config['api_url']}/api/v1/fs/{config['fs_alias']}/list?path=/",
        headers.copy(),
        None,
        config
    )

    _print_report(db_res)
    _print_report(fs_res)

    print(f"\n  ✅ Benchmark complete. DB: {db_res['throughput']:.1f} req/s | FS: {fs_res['throughput']:.1f} req/s\n")

if __name__ == "__main__":
    asyncio.run(main())
