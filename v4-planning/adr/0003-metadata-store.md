# ADR 0003: Metadata Store Technology

Status: Accepted
Date: 2026-09-27

## Problem
Identity, roles, and database configurations need to be mutable at runtime without restarting Axiom. The config.toml is startup-only.

## Options Considered
- A: External PostgreSQL as metadata store.
- B: Local SQLite only (no remote option).
- C: libsql — supports local SQLite file and any libsql-compatible remote URL (Turso, etc.).

## Decision
Option C. Default: `file:data/axiom.db`. Configurable to any libsql-compatible remote via `[metadata] url`.

## Why
- libsql is already a dependency (used for LibSQL/Turso DB engine and cache).
- No extra binary needed for local deployments — shared hosting compatible.
- Remote URL option supports future multi-node setups without architectural changes.
- The hot path never queries axiom.db directly — it reads an ArcSwap<Metadata> snapshot.

## Consequences
- `axiom.db` is a new required runtime file, created automatically on first start.
- Must be included in backup procedures.
- Multi-node deployments should point to a shared remote libsql URL.
