#!/usr/bin/env python3
"""
Simulated End-to-End Automated Test Harness for Axiom
Tests clean installation, setup wizard with email, logout & dual login (username/email),
LibSQL database connection, Data panel CRUD, custom RBAC roles and API key permissions,
system endpoints, and clean teardown.
"""

import sys
import os
import shutil
import subprocess
import time
import json
import base64
import urllib.request
import urllib.error

TEST_PORT = 4598
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"
TEST_DIR = os.path.abspath("test_e2e_run")
CONFIG_PATH = os.path.join(TEST_DIR, "config.toml")
DATA_DIR = os.path.join(TEST_DIR, "data")

def log(msg, status="INFO"):
    colors = {
        "INFO": "\033[94m",
        "PASS": "\033[92m",
        "FAIL": "\033[91m",
        "WARN": "\033[93m",
        "RESET": "\033[0m"
    }
    prefix = f"{colors.get(status, '')}[{status}]{colors['RESET']}"
    print(f"{prefix} {msg}", flush=True)

def request_json(method, path, body=None, headers=None):
    url = f"{BASE_URL}{path}"
    req_headers = {
        "Content-Type": "application/json",
        "User-Agent": "Axiom-E2E-Test-Runner"
    }
    if headers:
        req_headers.update(headers)

    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp_body = resp.read().decode("utf-8")
            status = resp.status
            try:
                parsed = json.loads(resp_body) if resp_body else {}
            except json.JSONDecodeError:
                parsed = {"raw": resp_body}
            return status, parsed
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            parsed = json.loads(err_body) if err_body else {}
        except json.JSONDecodeError:
            parsed = {"raw": err_body}
        return e.code, parsed
    except Exception as ex:
        return 0, {"error": str(ex)}

def request_raw(method, path, headers=None):
    url = f"{BASE_URL}{path}"
    req_headers = {"User-Agent": "Axiom-E2E-Test-Runner"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")
    except Exception as ex:
        return 0, str(ex)

def find_binary():
    candidates = [
        os.path.join("target", "debug", "axiom.exe"),
        os.path.join("target", "debug", "axiom"),
        os.path.join("target", "release", "axiom.exe"),
        os.path.join("target", "release", "axiom"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return os.path.abspath(c)
    return None

def main():
    log("=== Axiom Simulated End-to-End Test Suite ===", "INFO")
    
    # 1. Clean Environment
    if os.path.exists(TEST_DIR):
        log(f"Cleaning previous test directory: {TEST_DIR}", "INFO")
        shutil.rmtree(TEST_DIR, ignore_errors=True)
    os.makedirs(DATA_DIR, exist_ok=True)
    db_file = os.path.join("data", "test_app_e2e.db")
    if os.path.exists(db_file):
        try:
            os.remove(db_file)
        except OSError:
            pass

    # 2. Prepare Config
    config_content = f"""[server]
host = "127.0.0.1"
port = {TEST_PORT}
max_connections = 1000
request_timeout = 15
body_limit = "10mb"
allowed_ips = ["127.0.0.1"]
trusted_proxies = ["127.0.0.1"]
cors_origins = ["*"]
shutdown_timeout = 5

[logging]
enabled = true
level = "INFO"
format = "pretty"
directory = "{TEST_DIR.replace(chr(92), '/')}/logs"
file_prefix = "axiom_test"
max_file_size = "10mb"
max_files = 2
stdout = true

[rate_limit]
enabled = true
backend = "memory"
window = 60
max_requests = 1000
burst = 100
penalty_threshold = 20
penalty_cooldown = 60

[cache]
enabled = true
backend = "memory"
query_cache = false
query_results_ttl = 0
schema_ttl = 60

[metadata]
url = "file:{DATA_DIR.replace(chr(92), '/')}/axiom.db"
token = ""
reload_interval = 5
"""
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        f.write(config_content)
    log(f"Created test config at {CONFIG_PATH}", "INFO")

    # 3. Locate Binary
    binary = find_binary()
    if not binary:
        log("Compiling axiom binary...", "INFO")
        build_res = subprocess.run(["cargo", "build", "-p", "axiom"], check=True)
        binary = find_binary()
        if not binary:
            log("Failed to find or build axiom binary!", "FAIL")
            sys.exit(1)
    log(f"Using binary: {binary}", "INFO")

    # 4. Start Server Process
    log(f"Launching Axiom server on port {TEST_PORT}...", "INFO")
    proc = subprocess.Popen(
        [binary, "server", "-c", CONFIG_PATH],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    try:
        # Wait for server readiness
        healthy = False
        for _ in range(40):
            status, res = request_json("GET", "/ready")
            if status == 200:
                healthy = True
                break
            time.sleep(0.5)

        if not healthy:
            log("Server failed to respond to /health in time!", "FAIL")
            proc.terminate()
            stdout, stderr = proc.communicate(timeout=5)
            print("STDOUT:\n", stdout)
            print("STDERR:\n", stderr)
            sys.exit(1)

        log("Server healthy and listening on test port.", "PASS")

        # ─── Stage 1: Setup Wizard Check ─────────────────────────────────────
        status, data = request_json("POST", "/admin/v1/setup/begin")
        assert status == 200, f"setup/begin failed: {status} {data}"
        assert data.get("data", {}).get("setup_required") is True, "setup_required should be True on clean boot"
        log("Stage 1: Setup wizard readiness check passed.", "PASS")

        # ─── Stage 2: Create Account with Email ──────────────────────────────
        admin_user = "MasterDev"
        admin_email = "master@axiom.enterprise"
        admin_pass = "ProductionSecurePassword999!"

        status, data = request_json("POST", "/admin/v1/setup/account", {
            "username": admin_user,
            "email": admin_email,
            "password": admin_pass
        })
        assert status == 200, f"setup/account failed: {status} {data}"
        session_token = data.get("data", {}).get("session_token")
        assert session_token, "setup/account must return session_token"
        log("Stage 2: Setup account with email created successfully.", "PASS")

        auth_headers = {"Authorization": f"Bearer {session_token}"}

        # ─── Stage 3: Connect LibSQL Database ─────────────────────────────────
        status, data = request_json("POST", "/admin/v1/setup/database", {
            "alias": "testdb",
            "engine": "LibSQL",
            "url": "sqlite://data/test_app_e2e.db"
        }, headers=auth_headers)
        assert status == 200, f"setup/database failed: {status} {data}"
        log("Stage 3: LibSQL test database connected.", "PASS")

        # ─── Stage 4: Complete Setup Wizard ───────────────────────────────────
        status, data = request_json("POST", "/admin/v1/setup/complete", headers=auth_headers)
        assert status == 200, f"setup/complete failed: {status} {data}"
        log("Stage 4: Setup completed and locked.", "PASS")

        # ─── Stage 5: Logout & Dual Login (Username and Email) ─────────────────
        log("Stage 5: Testing Logout -> Dual Login...", "INFO")
        status, data = request_json("POST", "/admin/v1/auth/logout", headers=auth_headers)
        assert status == 200, f"logout failed: {status} {data}"

        # Old session should now be rejected
        status, data = request_json("GET", "/admin/v1/status", headers=auth_headers)
        assert status == 401, f"Logged out session should return 401, got: {status}"

        # Login using USERNAME
        status, data = request_json("POST", "/admin/v1/auth/login", {
            "username": admin_user,
            "password": admin_pass
        })
        assert status == 200, f"Login with username failed: {status} {data}"
        username_session = data.get("data", {}).get("session_token")
        assert username_session, "Login response missing session_token"
        assert data.get("data", {}).get("username") == admin_user

        # Test authenticated call with username session
        status, data = request_json("GET", "/admin/v1/status", headers={"Authorization": f"Bearer {username_session}"})
        assert status == 200, f"Status check with username session failed: {status}"
        log("  -> Login with USERNAME succeeded.", "PASS")

        # Logout again
        status, data = request_json("POST", "/admin/v1/auth/logout", headers={"Authorization": f"Bearer {username_session}"})
        assert status == 200

        # Login using EMAIL
        status, data = request_json("POST", "/admin/v1/auth/login", {
            "username": admin_email,
            "password": admin_pass
        })
        assert status == 200, f"Login with email failed: {status} {data}"
        email_session = data.get("data", {}).get("session_token")
        assert email_session, "Login with email missing session_token"
        # Canonical username should be resolved
        assert data.get("data", {}).get("username") == admin_user, f"Expected canonical username {admin_user}, got {data.get('data', {}).get('username')}"

        # Test authenticated call with email session
        session_token = email_session
        auth_headers = {"Authorization": f"Bearer {session_token}"}
        status, data = request_json("GET", "/admin/v1/status", headers=auth_headers)
        assert status == 200, f"Status check with email session failed: {status}"
        log("  -> Login with EMAIL succeeded (resolved canonical username).", "PASS")

        # Test wrong password returns 401
        status, data = request_json("POST", "/admin/v1/auth/login", {
            "username": admin_user,
            "password": "WrongPassword999!"
        })
        assert status == 401, f"Expected 401 for bad password, got {status}"
        log("  -> Invalid credentials properly rejected (401).", "PASS")

        # ─── Stage 6: Data Panel CRUD Operations ──────────────────────────────
        log("Stage 6: Testing Data Panel CRUD operations...", "INFO")
        
        # Create Table
        status, data = request_json("POST", "/api/v1/db/testdb/query", {
            "query": "CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL, active INTEGER DEFAULT 1);"
        }, headers=auth_headers)
        assert status == 200, f"CREATE TABLE failed: {status} {data}"

        # List Tables
        status, data = request_json("GET", "/api/v1/db/testdb/tables", headers=auth_headers)
        assert status == 200, f"List tables failed: {status} {data}"
        tables = [t.get("name") for t in data.get("data", {}).get("tables", [])]
        assert "products" in tables, f"Expected 'products' in tables: {tables}"
        log("  -> DDL & List Tables verified.", "PASS")

        # Insert Rows
        status, data = request_json("POST", "/api/v1/db/testdb/products/rows", {
            "rows": [
                {"name": "Mechanical Keyboard", "price": 129.50, "active": 1},
                {"name": "Wireless Mouse", "price": 49.99, "active": 1},
                {"name": "USB-C Hub", "price": 29.99, "active": 0}
            ]
        }, headers=auth_headers)
        assert status == 200, f"Insert rows failed: {status} {data}"
        log("  -> Insert rows verified.", "PASS")

        # Fetch Rows
        status, data = request_json("GET", "/api/v1/db/testdb/products/rows?limit=10", headers=auth_headers)
        assert status == 200, f"Fetch rows failed: {status} {data}"
        rows = data.get("data", {}).get("rows", [])
        assert len(rows) == 3, f"Expected 3 rows, got {len(rows)}"
        log("  -> Fetch rows verified (count = 3).", "PASS")

        # Update Rows
        status, data = request_json("PATCH", "/api/v1/db/testdb/products/rows", {
            "filter": {"name": {"eq": "Wireless Mouse"}},
            "update": {"price": 39.99}
        }, headers=auth_headers)
        assert status == 200, f"Update rows failed: {status} {data}"

        # Verify Update
        status, data = request_json("POST", "/api/v1/db/testdb/query", {
            "query": "SELECT price FROM products WHERE name = 'Wireless Mouse';"
        }, headers=auth_headers)
        assert status == 200, f"Query failed: {status} {data}"
        q_rows = data.get("rows") or data.get("data", {}).get("rows", [])
        assert len(q_rows) == 1, f"Expected 1 row, got {len(q_rows)}: {data}"
        price_val = q_rows[0].get("price") if isinstance(q_rows[0], dict) else q_rows[0][0]
        assert abs(float(price_val) - 39.99) < 0.01, f"Updated price mismatch: {price_val}"
        log("  -> Update rows verified.", "PASS")

        # Delete Rows
        status, data = request_json("DELETE", "/api/v1/db/testdb/products/rows", {
            "filter": {"name": {"eq": "USB-C Hub"}}
        }, headers=auth_headers)
        assert status == 200, f"Delete rows failed: {status} {data}"

        status, data = request_json("GET", "/api/v1/db/testdb/products/rows?limit=10", headers=auth_headers)
        assert status == 200
        rows = data.get("data", {}).get("rows", [])
        assert len(rows) == 2, f"Expected 2 rows after delete, got {len(rows)}"
        log("  -> Delete rows verified.", "PASS")

        # ─── Stage 7: RBAC Roles and API Key Permissions ──────────────────────
        log("Stage 7: Testing RBAC Roles & API Key Permissions...", "INFO")

        # Create Role with SELECT only on 'products' table
        status, data = request_json("POST", "/admin/v1/roles", {
            "name": "catalog_reader",
            "description": "Read-only access to products catalog",
            "permissions": [
                {
                    "database": "testdb",
                    "table_name": "products",
                    "operations": ["SELECT"]
                }
            ]
        }, headers=auth_headers)
        assert status in (200, 201), f"Create role failed: {status} {data}"
        log("  -> Created role 'catalog_reader'.", "PASS")

        # Create API Key assigned to 'catalog_reader'
        key_name = "reader_app_key"
        status, data = request_json("POST", "/admin/v1/keys", {
            "name": key_name,
            "role": "catalog_reader"
        }, headers=auth_headers)
        assert status in (200, 201), f"Create API key failed: {status} {data}"
        key_secret = data.get("data", {}).get("secret")
        assert key_secret, "API key response missing secret"

        raw_auth = f"{key_name}:{key_secret}"
        encoded_auth = base64.b64encode(raw_auth.encode("utf-8")).decode("utf-8")
        api_key_headers = {"X-Axiom-Key": encoded_auth}

        # 1. Permitted SELECT on products table using API Key -> Should succeed (200)
        status, data = request_json("POST", "/api/v1/db/testdb/query", {
            "query": "SELECT id, name, price FROM products;"
        }, headers=api_key_headers)
        assert status == 200, f"Expected 200 OK for allowed SELECT query, got: {status} {data}"
        log("  -> Permitted SELECT query returned 200 OK.", "PASS")

        # 2. Permitted list_tables using API Key -> Should succeed (200)
        status, data = request_json("GET", "/api/v1/db/testdb/tables", headers=api_key_headers)
        assert status == 200, f"Expected 200 OK for list_tables with table-scoped role, got: {status} {data}"
        log("  -> List tables with table-scoped role returned 200 OK.", "PASS")

        # 3. Permitted scalar query SELECT 1 using API Key -> Should succeed (200)
        status, data = request_json("POST", "/api/v1/db/testdb/query", {
            "query": "SELECT 1;"
        }, headers=api_key_headers)
        assert status == 200, f"Expected 200 OK for scalar query, got: {status} {data}"
        log("  -> Table-less scalar query returned 200 OK.", "PASS")

        # 4. FORBIDDEN Mutation: INSERT using read-only key -> Must return 403 Forbidden!
        status, data = request_json("POST", "/api/v1/db/testdb/products/rows", {
            "rows": [{"name": "Hacked Product", "price": 0.01}]
        }, headers=api_key_headers)
        assert status == 403, f"Expected 403 Forbidden for disallowed INSERT, got: {status} {data}"
        log("  -> Disallowed INSERT blocked with 403 Forbidden.", "PASS")

        # 5. FORBIDDEN Raw Mutation query: DELETE using read-only key -> Must return 403 Forbidden!
        status, data = request_json("POST", "/api/v1/db/testdb/query", {
            "query": "DELETE FROM products;"
        }, headers=api_key_headers)
        assert status == 403, f"Expected 403 Forbidden for disallowed DELETE query, got: {status} {data}"
        log("  -> Disallowed DELETE SQL blocked with 403 Forbidden.", "PASS")

        # 6. FORBIDDEN Table: Accessing disallowed table -> Must return 403 Forbidden!
        status, data = request_json("POST", "/api/v1/db/testdb/query", {
            "query": "SELECT * FROM secret_audit_logs;"
        }, headers=api_key_headers)
        assert status == 403, f"Expected 403 Forbidden for ungranted table, got: {status} {data}"
        log("  -> Unauthorized table access blocked with 403 Forbidden.", "PASS")

        # ─── Stage 8: Verify System & Admin Endpoints ─────────────────────────
        log("Stage 8: Verifying System and Admin Endpoints...", "INFO")
        endpoints = [
            ("GET", "/admin/v1/status"),
            ("GET", "/admin/v1/databases"),
            ("GET", "/admin/v1/keys"),
            ("GET", "/admin/v1/roles"),
            ("GET", "/admin/v1/users"),
            ("GET", "/admin/v1/cache/stats"),
            ("GET", "/admin/v1/audit"),
            ("GET", "/admin/v1/health"),
            ("GET", "/admin/v1/cluster/status"),
            ("GET", "/admin/v1/blobs/namespaces"),
        ]
        for meth, ep in endpoints:
            st, res = request_json(meth, ep, headers=auth_headers)
            assert st == 200, f"Endpoint {ep} returned status {st}: {res}"
            log(f"  -> {ep} returned 200 OK.", "PASS")

        # Verify UI Route returns HTML without black screen / waf block
        st_ui, html_ui = request_raw("GET", "/system")
        assert st_ui == 200, f"/system returned {st_ui}"
        assert "<!DOCTYPE html>" in html_ui or "<html" in html_ui, "UI did not return valid HTML"
        log("  -> /system returned valid HTML document.", "PASS")

        log("=================================================", "PASS")
        log("ALL SIMULATED E2E VERIFICATION STAGES PASSED!    ", "PASS")
        log("=================================================", "PASS")

    finally:
        log("Shutting down Axiom test server...", "INFO")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        
        # Cleanup test directory
        if os.path.exists(TEST_DIR):
            shutil.rmtree(TEST_DIR, ignore_errors=True)
            log(f"Cleaned up test directory: {TEST_DIR}", "INFO")
        db_file = os.path.join("data", "test_app_e2e.db")
        if os.path.exists(db_file):
            try:
                os.remove(db_file)
            except OSError:
                pass

if __name__ == "__main__":
    main()
