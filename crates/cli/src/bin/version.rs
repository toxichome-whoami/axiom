/*
 * Standalone executable binary for Axiom workspace SemVer automation.
 * Owned by: crates/cli
 * Key deps: clap, axiom_cli::commands::version
 * Invariants: Allows version bumping without building or linking server runtime components.
 * Last structural change: Intelligent argument normalization for -h <subcommand> and clean CLI schema.
 */

use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(ValueEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum BumpTarget {
    /// Increment patch version (e.g. 0.1.21 -> 0.1.22)
    Patch,
    /// Increment minor version (e.g. 0.1.21 -> 0.2.0)
    Minor,
    /// Increment major version (e.g. 0.1.21 -> 1.0.0)
    Major,
}

impl BumpTarget {
    pub fn as_str(&self) -> &'static str {
        match self {
            BumpTarget::Patch => "patch",
            BumpTarget::Minor => "minor",
            BumpTarget::Major => "major",
        }
    }
}

#[derive(Parser, Debug)]
#[command(name = "axiom-version")]
#[command(author, version, about = "Axiom workspace SemVer automation tool", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

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
        /// Target SemVer component to increment
        #[arg(value_enum, default_value_t = BumpTarget::Patch)]
        target: BumpTarget,
    },
    /// Set explicit version across all target files (e.g. 0.1.13)
    Set {
        /// Explicit version string (e.g. 0.1.13 or v0.1.13)
        #[arg(value_name = "VERSION")]
        version: String,
    },
}

/// Normalizes CLI arguments to handle:
///  1. `-h <subcommand>` / `--help <subcommand>` -> `<subcommand> --help`
///  2. Bare invocation -> `get`
///  3. Direct SemVer argument (e.g. `0.1.22`) -> `set 0.1.22`
fn normalize_args(args: &[String]) -> Vec<String> {
    if args.is_empty() {
        return vec!["axiom-version".to_string(), "get".to_string()];
    }

    let program = args[0].clone();
    if args.len() == 1 {
        return vec![program, "get".to_string()];
    }

    let rest = &args[1..];

    // Check if user ran `-h <subcommand>` or `--help <subcommand>` (e.g. `-h bump` or `--dry-run -h bump`)
    let mut normalized = vec![program];
    let mut pending_subcommand_help: Option<String> = None;
    let mut i = 0;

    while i < rest.len() {
        let arg = &rest[i];
        if (arg == "-h" || arg == "--help") && i + 1 < rest.len() {
            let next_arg = &rest[i + 1];
            if is_known_subcommand(next_arg) {
                pending_subcommand_help = Some(next_arg.clone());
                i += 2;
                continue;
            }
        }
        normalized.push(arg.clone());
        i += 1;
    }

    if let Some(subcmd) = pending_subcommand_help {
        // Prepend the subcommand and append --help
        let mut final_args = vec![normalized[0].clone(), subcmd, "--help".to_string()];
        // Append any other flags that were provided (e.g. --dry-run)
        for arg in &normalized[1..] {
            if arg != "-h" && arg != "--help" {
                final_args.push(arg.clone());
            }
        }
        return final_args;
    }

    // Check if the first positional non-flag argument is a SemVer string
    for (idx, arg) in rest.iter().enumerate() {
        if !arg.starts_with('-') {
            if axiom_cli::commands::version::SemVer::parse(arg).is_ok() {
                let mut rewritten = vec![normalized[0].clone()];
                // Include any flags that preceded the version string
                for prior_arg in &rest[..idx] {
                    rewritten.push(prior_arg.clone());
                }
                rewritten.push("set".to_string());
                rewritten.push(arg.clone());
                // Include any flags that followed the version string
                for subsequent_arg in &rest[idx + 1..] {
                    rewritten.push(subsequent_arg.clone());
                }
                return rewritten;
            }
            break;
        }
    }

    normalized
}

fn is_known_subcommand(name: &str) -> bool {
    matches!(name, "get" | "bump" | "set")
}

fn main() {
    let raw_args: Vec<String> = std::env::args().collect();
    let normalized = normalize_args(&raw_args);
    let cli = Cli::parse_from(&normalized);

    let root = cli
        .repo_root
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let (action, target_value) = match cli.command {
        Commands::Get => (Some("get"), None),
        Commands::Bump { target } => (Some("bump"), Some(target.as_str())),
        Commands::Set { ref version } => (Some("set"), Some(version.as_str())),
    };

    match axiom_cli::commands::version::execute_version_operation(
        &root,
        action,
        target_value,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_empty_args() {
        let args = vec!["axiom-version".to_string()];
        assert_eq!(
            normalize_args(&args),
            vec!["axiom-version".to_string(), "get".to_string()]
        );
    }

    #[test]
    fn test_normalize_help_subcommand() {
        let args = vec![
            "axiom-version".to_string(),
            "-h".to_string(),
            "bump".to_string(),
        ];
        assert_eq!(
            normalize_args(&args),
            vec![
                "axiom-version".to_string(),
                "bump".to_string(),
                "--help".to_string()
            ]
        );
    }

    #[test]
    fn test_normalize_direct_semver() {
        let args = vec!["axiom-version".to_string(), "0.1.22".to_string()];
        assert_eq!(
            normalize_args(&args),
            vec![
                "axiom-version".to_string(),
                "set".to_string(),
                "0.1.22".to_string()
            ]
        );
    }
}
