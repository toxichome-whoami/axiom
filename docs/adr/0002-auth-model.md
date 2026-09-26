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

**There are no built-in roles.** Every role is operator-defined. On first boot, Axiom creates no default roles. The operator must create at least one role and one key via the Admin API or CLI before the data plane accepts any requests. This gives full control over the permission model with no hidden defaults.

## Why
- Runtime management of keys and roles without restart.
- Clean separation: auth (identity verification) vs authz (permission evaluation).
- No hidden defaults or magic built-in privileges — everything is explicit.
- Consistent with production-proven patterns (Faucet, Hasura).
- `ArcSwap` snapshot means zero locking on the hot path.

## Backward Compatibility
`[api_key.*]` in config.toml continues to work. On first boot, these entries are seeded into `axiom.db` as keys attached to a role named after the key (e.g. key `admin` → role `admin`). The operator can then modify the role's permissions via the Admin API. The `full_admin: bool` key is deprecated but recognized for two major versions — a key with `full_admin = true` in config.toml will have its seeded role initialized with permissions covering all databases and all operations.

## Consequences
- Phase 1: metadata store + Identity Engine
- Phase 2: Policy Engine
- Breaking change in v5.0: `full_admin` key removed from config.toml
