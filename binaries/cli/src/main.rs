/*
 * Axiom Unified Binary — Combined CLI management utility and embedded API gateway server.
 * Owned by: cli
 * Key deps: tokio, mimalloc, axiom-core, axiom-metadata, axiom-api, clap
 * Invariants: Single binary dispatches to CLI subcommands if specified, or launches the full
 *             server daemon and embedded Web UI if run without subcommands or with `server`.
 * Last structural change: Unified single-binary out-of-the-box architecture (Phase 8 -> v4.0).
 */

pub mod client;
pub mod commands;
pub mod cli;
pub mod server_runner;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

/// Checks if CLI arguments request the application version.
fn handle_version_flag(args: &[String]) -> bool {
    if args.iter().any(|arg| arg == "--version" || arg == "-v") {
        println!("Axiom v{}", env!("CARGO_PKG_VERSION"));
        return true;
    }
    false
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if handle_version_flag(&args) {
        return Ok(());
    }

    axiom_core::ConfigManager::load("config.toml").ok();

    let config = axiom_core::ConfigManager::get();
    let workers = config.server.workers as usize;
    let mut builder = tokio::runtime::Builder::new_multi_thread();
    builder.enable_all();
    if workers > 0 {
        builder.worker_threads(workers);
    }

    let rt = builder.build()?;
    rt.block_on(async {
        let ran_cli = cli::run().await?;
        if !ran_cli {
            server_runner::run_server().await?;
        }
        Ok(())
    })
}

// ─── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_handle_version_flag() {
        assert!(handle_version_flag(&["axiom".into(), "--version".into()]));
        assert!(handle_version_flag(&["axiom".into(), "-v".into()]));
        assert!(!handle_version_flag(&["axiom".into()]));
        assert!(!handle_version_flag(&["axiom".into(), "user".into(), "list".into()]));
    }
}
