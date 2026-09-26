# ADR 0002: Authentication and Authorization Model

Status: Accepted (v4.0)
Date: 2026-09-27
Supersedes: config.toml [api_key.*] flat model from v3.0

## Problem
v3.0 used `full_admin: bool` and `db_scope: Vec<String>` in config.toml. This cannot express table-level or operation-level permissions without restructuring the entire config.

## Options Considered
- A: Keep flat model, add `table_scope` field.
- B: JWT-based auth with external identity provider.
- C: Faucet-style RBAC — roles and permissions in the embedded metadata store.

## Decision
Option C. Roles and permissions live in `axiom.db`. API keys reference a role. The Policy Engine evaluates permissions using an `ArcSwap<Metadata>` snapshot, adding zero locks to the hot path.

## Why
- Runtime management of keys and roles without restart.
- Clean separation: auth (identity verification) vs authz (permission evaluation).
- Consistent with production-proven patterns (Faucet, Hasura).
- `ArcSwap` snapshot means zero locking on the hot path.

## Backward Compatibility
`[api_key.*]` in config.toml continues to work. On first boot, these entries are seeded into `axiom.db` with an `admin` role. The `full_admin: bool` key is deprecated but recognized for two major versions.

## Consequences
- Phase 1: metadata store + Identity Engine
- Phase 2: Policy Engine
- Breaking change in v5.0: `full_admin` key removed from config.toml
