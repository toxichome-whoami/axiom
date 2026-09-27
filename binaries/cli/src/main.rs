/*
 * Axiom CLI — Command-line management tool.
 * Owned by: cli
 * Key deps: tokio, axiom-core, axiom-metadata, clap
 * Invariants: CLI operations execute and cleanly terminate with standard exit codes.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

pub mod client;
pub mod commands;
pub mod cli;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    axiom_core::ConfigManager::load("config.toml").ok();
    let _ = cli::run().await?;
    Ok(())
}
