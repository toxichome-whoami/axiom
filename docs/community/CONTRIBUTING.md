# Contributing

---

## Development Setup

```bash
git clone https://github.com/toxichome-whoami/axiom.git
cd axiom
cargo build          # debug build
cargo test --workspace  # run all 153 tests
```

No additional tools required. The Web UI build is optional — if `npm` is not installed, `cargo build` falls back to the existing `ui/dist` bundle.

---

## Running Tests

```bash
cargo test --workspace      # full suite (unit + integration + security)
cargo test -p axiom-db      # DB engine tests only
cargo test -p axiom-policy  # RBAC tests only
```

All 153 tests must pass before a PR is opened. Tests that require an external database connection are skipped automatically when the database is not reachable.

---

## Lint

```bash
cargo clippy --workspace --all-targets -- -D warnings
```

No new warnings. Existing `#[allow(...)]` annotations are scoped and documented.

---

## Commit Style

```
type(scope): short description

Types: fix, feat, perf, refactor, docs, test, chore
Scope: the crate or component (cache, auth, mssql, waf, cli, etc.)

Examples:
  fix(cache): prevent RBAC bypass on result cache hit
  feat(cli): add config to-env subcommand
  perf(db): switch PgColKind to enum dispatch
  docs(readme): rewrite without Docker references
```

One logical change per commit. No `--allow-dirty`. Squash fixup commits before opening a PR.

---

## Code Standards

- No `unwrap()` or `expect()` outside of tests and `main()` startup
- No `Box<dyn Error>` on hot paths — use typed error enums
- All public functions have a doc comment with `CONTRACT:` section (precondition, side effects, idempotency)
- No dead code — remove it; don't `#[allow(dead_code)]` permanently
- Config keys read at startup go in `crates/core/src/config/schema.rs` with a `Default` impl and a unit test

---

## PR Requirements

1. `cargo test --workspace` passes
2. `cargo clippy` clean
3. New behaviour covered by a test (unit or integration in `tests/integration.rs`)
4. Commit message follows the style above
5. If changing the API surface or config schema, update `docs/reference/`

---

## Architecture

Before making structural changes, read `v4-planning/AXIOM_MASTER_PLAN.md`. Key invariants:

- Middleware order is WAF → Rate Limit → Auth → RBAC → Handler. Do not reorder.
- `PolicyEngine::evaluate` is the single RBAC checkpoint. Do not add secondary checks in handlers.
- The result cache lookup in `QueryExecutionPipeline` must run **after** `PolicyEngine::evaluate`.
- `ConfigManager::get()` returns a lock-free `Arc` clone. Config is immutable after startup.
- `ArcSwap<MetadataSnapshot>` is the only live-state source on the hot path. No direct `axiom.db` queries in request handlers.
