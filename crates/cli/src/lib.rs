/*
 * Axiom CLI library — modular command-line parser, subcommands, and Admin API client.
 * Owned by: crates/cli
 * Key deps: clap, rpassword, reqwest, axiom-core, axiom-metadata
 * Invariants: Self-contained CLI suite; easily testable and embeddable into the single binary.
 * Last structural change: Modularized CLI into dedicated scalable crate (v4.0).
 */

pub mod client;
pub mod commands;
pub mod cli;

pub use cli::run;
pub use client::AdminClient;
pub use commands::*;
