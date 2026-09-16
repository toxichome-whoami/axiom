<div align="center">

# Contributing to Axiom

*Guidelines for collaborating, reporting issues, and submitting code*

</div>


Thank you for your interest in contributing to Axiom! Every bug report, suggestion, and pull request genuinely helps improve the project.


## 1. Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md) before participating. We expect all contributors to treat each other with respect.


## 2. Getting Started

### Requirements

| Tool | Version | Notes |
|---|---|---|
| Rust + Cargo | **1.88+** | Install via [rustup.rs](https://rustup.rs) |
| MSYS2 UCRT64 | Latest | Windows only  needed for C libs |
| Zig + cargo-zigbuild | Latest | Only if cross-compiling to Linux |

### Setup

```bash
# Fork and clone
git clone https://github.com/toxichome-whoami/axiom.git
cd axiom

# Copy config
cp config.example.toml config.toml

# Build and run (Windows)
.\run.ps1

# Build and run (Linux / macOS)
cargo build
./target/debug/axiom
```


## 3. Project Structure

```text
axiom/
 src/
    api/          # Route handlers and request/response logic
    config/       # Config schema, loading, and validation
    db/           # Database engines and connection pooling
    middleware/   # Auth, rate limiting, WAF, cache, logging
    security/     # Ban list, threat tracking
    server/       # App setup, lifespan daemons
    utils/        # Shared types and helpers
    main.rs       # Entry point
 docs/             # All documentation
 demos/            # Go REST API examples
 benches/          # Go benchmark suite
 scripts/          # Build tooling
 run.ps1           # Windows build wrapper
```


## 4. Development Workflow

```bash
# 1. Create a branch
git checkout -b feature/your-feature-name

# 2. Make your changes

# 3. Validate
cargo check

# 4. Lint - zero warnings expected
cargo clippy

# 5. Build
cargo build

# 6. Test
cargo test
```

> [!IMPORTANT]
> All contributions must pass `cargo clippy` with **zero warnings**. We enforce a warning-free codebase. Run `cargo clippy --fix` to auto-resolve common issues.


## 5. Commit Style

Use conventional commit prefixes:

| Prefix | Use for |
|---|---|
| `feat:` | New features |
| `fix:` | Bug fixes |
| `chore:` | Build, tooling, or config changes |
| `docs:` | Documentation only |
| `refactor:` | Code restructuring without behavior change |
| `perf:` | Performance improvements |

**Example:**
```
feat: add $between filter operator to fetch_rows
fix: correct cursor pagination boundary on empty result set
docs: update CONFIGURATION.md with circuit_breaker section
```


## 6. Pull Request Process

1. Sync your branch with `main` before opening a PR
2. Write clear, descriptive commit messages (see above)
3. Update relevant files in `docs/` if you change any public API, config schema, or behavior
4. Keep PRs focused  one feature or fix per PR
5. A maintainer will review your code and may request changes before merging

> [!NOTE]
> Large architectural changes should be discussed via a GitHub Issue **before** opening a PR to avoid wasted effort.


## 7. Reporting Bugs

Open an issue on GitHub and include:

- **What you expected** to happen
- **What actually happened** (include error messages or logs)
- **Steps to reproduce**  minimal reproduction if possible
- **Your `config.toml`** with all secrets **REDACTED**
- **Your OS and Rust version** (`rustc --version`)


## 8. Security Vulnerabilities

> [!CAUTION]
> Do **not** open a public GitHub Issue for security vulnerabilities.

Report security issues privately through **[toxichome.cc](https://toxichome.cc)**. We will acknowledge receipt within 48 hours and work to resolve it as quickly as possible.


<div align="center">

*Axiom  a [Toxichome](https://toxichome.cc) open-source project*

</div>
