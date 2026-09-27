/*
 * Policy subsystem root providing RBAC authorization evaluation and permission checks.
 * Owned by: policy
 * Key deps: crate::policy::engine
 * Invariants: Policy evaluation is stateless and lock-free.
 * Last structural change: Phase 2 initial implementation.
 */

pub mod engine;

pub use engine::PolicyEngine;
