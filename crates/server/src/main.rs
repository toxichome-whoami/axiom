/*
 * Axiom Unified Binary — Combined CLI management utility and embedded API gateway server.
 * Owned by: crates/server
 * Key deps: tokio, mimalloc, axiom-core, axiom-metadata, axiom-api, clap, rustls
 * Invariants: Single binary dispatches to CLI subcommands if specified, or launches the full
 *             server daemon and embedded Web UI if run without subcommands or with `server`.
 * Last structural change: Unified single-binary out-of-the-box architecture (Phase 8 -> v4.0).
 */

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
    let _ = rustls::crypto::ring::default_provider().install_default();
    let args: Vec<String> = std::env::args().collect();
    if handle_version_flag(&args) {
        return Ok(());
    }

    let mut config_path = "config.toml".to_string();
    for i in 0..args.len() {
        if (args[i] == "-c" || args[i] == "--config") && i + 1 < args.len() {
            config_path = args[i + 1].clone();
            break;
        }
    }
    axiom_core::ConfigManager::load(&config_path).ok();

    let config = axiom_core::ConfigManager::get();
    let mut workers = config.server.workers as usize;
    if let Ok(env_w) = std::env::var("TOKIO_WORKER_THREADS") {
        if let Ok(w) = env_w.parse::<usize>() {
            workers = w;
        }
    }
    // Adaptive worker thread sizing: clamp default to [2, 8] to avoid thread/stack bloat on large machines
    if workers == 0 {
        let available = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(2);
        workers = available.clamp(2, 8);
    }
    let rt = if workers == 1 {
        let mut builder = tokio::runtime::Builder::new_current_thread();
        builder.enable_all();
        builder.max_blocking_threads(1);
        builder.build()?
    } else {
        let mut builder = tokio::runtime::Builder::new_multi_thread();
        builder.enable_all();
        builder.worker_threads(workers);
        // Cap blocking thread pool to 32 (Tokio default is 512) to conserve OS thread handles and stacks
        builder.max_blocking_threads(32);
        builder.build()?
    };
    rt.block_on(async {
        match axiom_cli::run().await {
            Ok(false) => {
                server_runner::run_server().await?;
            }
            Ok(true) => {}
            Err(e) => {
                eprintln!("Error: {}", e);
                std::process::exit(1);
            }
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
        assert!(!handle_version_flag(&[
            "axiom".into(),
            "user".into(),
            "list".into()
        ]));
    }

    #[test]
    fn test_server_config_defaults() {
        let config = axiom_core::AxiomConfig::default();
        assert_eq!(config.server.port, 4500);
        assert_eq!(config.server.host, "127.0.0.1");
        assert_eq!(config.server.shutdown_timeout, 30);
    }
}
