/*
 * Standalone executable binary for Axiom workspace SemVer automation.
 * Owned by: crates/cli
 * Key deps: clap, axiom_cli::commands::version
 * Invariants: Allows version bumping without building or linking server runtime components.
 * Last structural change: Complete port and replacement of legacy tools/zig/version.zig.
 */

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "axiom-version")]
#[command(author, version, about = "Axiom workspace SemVer automation tool", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Direct target version or command if not specified via subcommand (e.g. "0.1.13")
    #[arg(index = 1)]
    direct_target: Option<String>,

    /// Preview file changes and replacements without writing
    #[arg(long, global = true)]
    dry_run: bool,

    /// Skip running cargo check to synchronize Cargo.lock
    #[arg(long, global = true)]
    no_cargo: bool,

    /// Path to Axiom repository root (defaults to current working directory)
    #[arg(long, global = true)]
    repo_root: Option<PathBuf>,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Display current workspace version from Cargo.toml
    Get,
    /// Increment version (patch, minor, or major)
    Bump {
        /// Target component to increment: patch, minor, or major
        #[arg(default_value = "patch")]
        target: String,
    },
    /// Set explicit version across all target files (e.g. 0.1.13)
    Set {
        /// The new version string (e.g. 0.1.13)
        version: String,
    },
}

fn main() {
    let cli = Cli::parse();
    let root = cli
        .repo_root
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let (action, target_value) = match cli.command {
        Some(Commands::Get) => (Some("get"), None),
        Some(Commands::Bump { target }) => (Some("bump"), Some(target)),
        Some(Commands::Set { version }) => (Some("set"), Some(version)),
        None => {
            if let Some(target) = cli.direct_target {
                if target == "get" {
                    (Some("get"), None)
                } else if target == "bump" {
                    (Some("bump"), Some("patch".to_string()))
                } else {
                    (Some("set"), Some(target))
                }
            } else {
                (Some("get"), None)
            }
        }
    };

    match axiom_cli::commands::version::execute_version_operation(
        &root,
        action,
        target_value.as_deref(),
        cli.dry_run,
        cli.no_cargo,
    ) {
        Ok(output) => {
            println!("{}", output);
        }
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    }
}
