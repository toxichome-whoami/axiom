/*
 * Logging subsystem modules for tracing setup and log file rotation.
 * Owned by: crates/core (logging)
 * Key deps: tracing, tracing_subscriber
 * Invariants: Structured JSON format in production; human-readable format in development.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

pub mod rotator;
pub mod setup;
