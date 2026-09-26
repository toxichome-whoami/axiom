# ADR 0001: Tokio Runtime Mode

Status: Accepted
Date: 2026-09-27

## Problem
Axiom must run on both shared cPanel hosting (strict OS entry-process limits) and dedicated servers (multi-core parallelism).

## Options Considered
- A: Always single-thread (current_thread). Safe on cPanel, wastes CPU on VPS.
- B: Always multi-thread. Fast on VPS, may exhaust cPanel entry-process limits.
- C: Runtime selectable via compile-time flag and config.

## Decision
Option C. Default: `tokio::runtime::Builder::new_multi_thread()`. The `run.py --cpanel` flag patches `src/main.rs` to `new_current_thread()` before compiling, producing a separate `axiom-cpanel` binary. Thread count is controlled by `[server] workers`.

## Consequences
- Shared-host users compile with `--cpanel`. Documentation must be explicit about this.
- VPS/dedicated users use the standard multi-thread binary.
- Multi-thread binary saturates multiple CPU cores under load.
