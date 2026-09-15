<div align="center">
  <h1>Axiom</h1>
  <p><em>An open-source, ultra-lightweight API gateway for databases.</em></p>
</div>

<hr/>

## Philosophy

- **Ultra-lightweight**: Fast and efficient.
- **Universal Agnostic Target**: One language to speak to MySQL, SQLite, Postgres, and more.
- **Secure By Default**: Strict WAF, rate limits, and path traversal blockades.

## Features

- Dynamic connection pooling to any SQL dialect using `sqlx` for type-safe, compile-time verified queries.
- High performance multi-tier rate limiting with DDoS protection and lock-free `AtomicU32` counters.
- Zero-contention configuration via `OnceLock<Arc<Config>>` — all worker threads read config with no locks.

## Documentation

For comprehensive guides, API references, architecture overviews, and deployment instructions, please read the documentation in the [docs/](./docs/) directory of this repository.

## Quick Start

<details open>
<summary><b>View Quick Start Commands</b></summary>

<br>

1. `cargo build --release`
2. Run via: `./target/release/axiom` (or `axiom.exe` on Windows)
3. Check the auto-generated `config.toml` for your new Admin API Key.

**Or via Docker:**
```bash
docker compose up -d
```

> **Ports:** REST/HTTP on `:4500`

</details>

## Example CURL

<details>
<summary><b>View API Examples</b></summary>

```bash
# Query Database
curl -X POST "http://localhost:4500/api/v1/db/main_db/query" \
     -H "Authorization: Bearer <API_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"sql": "SELECT id, name FROM users WHERE active = $1", "params": [true]}'
```

</details>

## Examples and Demos

Axiom provides a set of **Golang Demos** demonstrating how to interact with the database natively via REST.

The examples are located in the `demos/` directory. 

### Usage Example
<details>
<summary><b>View Demo Execution</b></summary>

To run the unified Golang demo suite, simply use the Go CLI from within the `demos/` folder:

```bash
cd demos/
go run . [demo_name]
```

Available demos include:
- `db_fetch`: Fetch data from the database
- `db_insert`: Insert data into the database
- `db_drop`: Drop tables from the database

</details>
