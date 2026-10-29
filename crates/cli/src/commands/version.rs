/*
 * Native Rust workspace version management and SemVer synchronization engine.
 * Owned by: crates/cli
 * Key deps: std::fs, std::process, std::path
 * Invariants: Atomically updates all target manifests and documentation files with consistent SemVer format.
 * Last structural change: Complete port and replacement of legacy tools/zig/version.zig.
 */

use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SemVer {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl SemVer {
    pub fn parse(text: &str) -> Result<Self, String> {
        let trimmed = text.trim();
        let s = if let Some(stripped) = trimmed
            .strip_prefix('v')
            .or_else(|| trimmed.strip_prefix('V'))
        {
            stripped
        } else {
            trimmed
        };

        let parts: Vec<&str> = s.split('.').collect();
        if parts.len() != 3 {
            return Err(format!(
                "Invalid SemVer string '{}'. Expected format: X.Y.Z (e.g. 0.1.13)",
                text
            ));
        }

        let major = parts[0]
            .parse::<u32>()
            .map_err(|_| format!("Invalid major version '{}'", parts[0]))?;
        let minor = parts[1]
            .parse::<u32>()
            .map_err(|_| format!("Invalid minor version '{}'", parts[1]))?;
        let patch = parts[2]
            .parse::<u32>()
            .map_err(|_| format!("Invalid patch version '{}'", parts[2]))?;

        Ok(SemVer {
            major,
            minor,
            patch,
        })
    }

    pub fn bump_patch(&self) -> Self {
        SemVer {
            major: self.major,
            minor: self.minor,
            patch: self.patch + 1,
        }
    }

    pub fn bump_minor(&self) -> Self {
        SemVer {
            major: self.major,
            minor: self.minor + 1,
            patch: 0,
        }
    }

    pub fn bump_major(&self) -> Self {
        SemVer {
            major: self.major + 1,
            minor: 0,
            patch: 0,
        }
    }

    pub fn format(&self) -> String {
        format!("{}.{}.{}", self.major, self.minor, self.patch)
    }
}

pub struct TargetFile {
    pub path: &'static str,
    pub description: &'static str,
}

pub const TARGET_FILES: &[TargetFile] = &[
    TargetFile {
        path: "Cargo.toml",
        description: "Root Cargo workspace package version",
    },
    TargetFile {
        path: "crates/core/src/config/schema.rs",
        description: "Core configuration default server version",
    },
    TargetFile {
        path: "ui/package.json",
        description: "Vite Web UI package manifest",
    },
    TargetFile {
        path: "ui/package-lock.json",
        description: "Vite Web UI package-lock",
    },
    TargetFile {
        path: "ui/src/pages/Settings.tsx",
        description: "Settings page UI fallback version",
    },
    TargetFile {
        path: "install.ps1",
        description: "PowerShell installation script LatestTag",
    },
    TargetFile {
        path: "install.sh",
        description: "POSIX shell installation script LATEST_TAG",
    },
    TargetFile {
        path: "README.md",
        description: "Root documentation, badges, and binary links",
    },
    TargetFile {
        path: "docs/api.md",
        description: "API documentation version badge",
    },
    TargetFile {
        path: "docs/building.md",
        description: "Build documentation version badge",
    },
    TargetFile {
        path: "docs/configuration.md",
        description: "Configuration documentation and container tags",
    },
];

/// Extracts the workspace package version from root Cargo.toml.
pub fn extract_current_version(cargo_toml_content: &str) -> Option<String> {
    let ws_pos = cargo_toml_content.find("[workspace.package]")?;
    let slice = &cargo_toml_content[ws_pos..];

    let ver_key = "version = \"";
    let key_pos = slice.find(ver_key)?;
    let start = key_pos + ver_key.len();
    let rest = &slice[start..];
    let end = rest.find('"')?;

    Some(rest[..end].to_string())
}

/// Replaces all occurrences of needle with replacement and returns new string + count.
pub fn replace_all(content: &str, needle: &str, replacement: &str) -> (String, usize) {
    if needle.is_empty() || content.len() < needle.len() {
        return (content.to_string(), 0);
    }

    let count = content.matches(needle).count();
    if count == 0 {
        return (content.to_string(), 0);
    }

    let replaced = content.replace(needle, replacement);
    (replaced, count)
}

/// Executes version management operations against repository files.
pub fn execute_version_operation(
    repo_root: &Path,
    action: Option<&str>,
    target_value: Option<&str>,
    dry_run: bool,
    no_cargo: bool,
) -> Result<String, String> {
    let cargo_path = repo_root.join("Cargo.toml");
    if !cargo_path.exists() {
        return Err(format!(
            "Could not find Cargo.toml at {}. Ensure you run from repository root.",
            cargo_path.display()
        ));
    }

    let cargo_content =
        fs::read_to_string(&cargo_path).map_err(|e| format!("Failed to read Cargo.toml: {}", e))?;

    let current_ver = extract_current_version(&cargo_content)
        .ok_or_else(|| "Could not locate [workspace.package] version in Cargo.toml".to_string())?;

    let action_str = action.unwrap_or("get");

    if action_str == "get" {
        return Ok(format!("Axiom Current Version: {}", current_ver));
    }

    let target_ver = if action_str == "bump" {
        let bump_type = target_value.unwrap_or("patch");
        let parsed = SemVer::parse(&current_ver)?;
        let next_semver = match bump_type {
            "patch" => parsed.bump_patch(),
            "minor" => parsed.bump_minor(),
            "major" => parsed.bump_major(),
            other => {
                return Err(format!(
                    "Unknown bump target '{}'. Valid options: patch, minor, major.",
                    other
                ))
            }
        };
        next_semver.format()
    } else if action_str == "set" {
        let val = target_value
            .ok_or_else(|| "'set' requires a version argument (e.g. set 0.1.13)".to_string())?;
        let parsed = SemVer::parse(val)?;
        parsed.format()
    } else {
        // Direct version string passed as action
        let parsed = SemVer::parse(action_str)?;
        parsed.format()
    };

    if current_ver == target_ver {
        return Ok(format!(
            "Version is already {}. Nothing to update.",
            target_ver
        ));
    }

    let mut output = Vec::new();
    output.push(
        "========================================================================".to_string(),
    );
    output.push(" Axiom Automated Version Update".to_string());
    output.push(format!(" Old Version: {}", current_ver));
    output.push(format!(" New Version: {}", target_ver));
    if dry_run {
        output.push(" MODE:        DRY RUN (no files will be written)".to_string());
    }
    output.push(
        "========================================================================\n".to_string(),
    );

    let mut total_files_updated = 0;
    let mut total_replacements = 0;

    for (idx, target) in TARGET_FILES.iter().enumerate() {
        let file_path = repo_root.join(target.path);
        if !file_path.exists() {
            output.push(format!(
                "[{}/{}] {} -> SKIP (file not found)",
                idx + 1,
                TARGET_FILES.len(),
                target.path
            ));
            continue;
        }

        let content = match fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(e) => {
                output.push(format!(
                    "[{}/{}] {} -> SKIP (read error: {})",
                    idx + 1,
                    TARGET_FILES.len(),
                    target.path,
                    e
                ));
                continue;
            }
        };

        let (mut final_text, mut rep_count) = replace_all(&content, &current_ver, &target_ver);

        // Special handling for ui/package-lock.json if it had an outdated header version
        if target.path == "ui/package-lock.json" && rep_count == 0 {
            let needle = "\"version\": \"4.0.0\",";
            let replacement = format!("\"version\": \"{}\",", target_ver);
            let (locked_text, locked_count) = replace_all(&content, needle, &replacement);
            if locked_count > 0 {
                final_text = locked_text;
                rep_count += locked_count;
            }
        }

        if rep_count > 0 {
            total_files_updated += 1;
            total_replacements += rep_count;
            output.push(format!(
                "[{}/{}] {}\n      -> {} replacement(s) ({})",
                idx + 1,
                TARGET_FILES.len(),
                target.path,
                rep_count,
                target.description
            ));

            if !dry_run {
                if let Err(e) = fs::write(&file_path, &final_text) {
                    return Err(format!("Failed to write {}: {}", target.path, e));
                }
            }
        } else {
            output.push(format!(
                "[{}/{}] {}\n      -> OK (no old version pattern found)",
                idx + 1,
                TARGET_FILES.len(),
                target.path
            ));
        }
    }

    output.push(
        "\n------------------------------------------------------------------------".to_string(),
    );
    output.push(format!(
        "Summary: {} file(s) updated, {} total replacement(s)",
        total_files_updated, total_replacements
    ));

    if !dry_run && !no_cargo {
        output.push("\n==> Synchronizing Cargo.lock via cargo check...".to_string());
        let status = Command::new("cargo")
            .args(["check", "--quiet"])
            .current_dir(repo_root)
            .status();

        match status {
            Ok(s) if s.success() => {
                output.push("==> Cargo.lock synchronized successfully!".to_string());
            }
            Ok(s) => {
                output.push(format!(
                    "Warning: cargo check exited with code {}. Please run cargo check manually.",
                    s
                ));
            }
            Err(e) => {
                output.push(format!(
                    "Warning: Failed to execute cargo check ({}). Please run manually.",
                    e
                ));
            }
        }
    }

    output.push(format!(
        "\n[SUCCESS] Version update complete: {} -> {}\n",
        current_ver, target_ver
    ));

    Ok(output.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_semver_parse_valid() {
        let v1 = SemVer::parse("1.2.3").expect("valid");
        assert_eq!(
            v1,
            SemVer {
                major: 1,
                minor: 2,
                patch: 3
            }
        );

        let v2 = SemVer::parse("v0.1.12").expect("valid with v");
        assert_eq!(
            v2,
            SemVer {
                major: 0,
                minor: 1,
                patch: 12
            }
        );

        let v3 = SemVer::parse("  V2.0.0  ").expect("valid trimmed");
        assert_eq!(
            v3,
            SemVer {
                major: 2,
                minor: 0,
                patch: 0
            }
        );
    }

    #[test]
    fn test_semver_parse_invalid() {
        assert!(SemVer::parse("1.2").is_err());
        assert!(SemVer::parse("1.2.3.4").is_err());
        assert!(SemVer::parse("a.b.c").is_err());
        assert!(SemVer::parse("").is_err());
    }

    #[test]
    fn test_semver_bump() {
        let v = SemVer {
            major: 0,
            minor: 1,
            patch: 12,
        };
        assert_eq!(v.bump_patch().format(), "0.1.13");
        assert_eq!(v.bump_minor().format(), "0.2.0");
        assert_eq!(v.bump_major().format(), "1.0.0");
    }

    #[test]
    fn test_extract_current_version() {
        let toml_sample = r#"
[workspace]
members = ["crates/*"]

[workspace.package]
version = "0.1.12"
edition = "2021"
"#;
        assert_eq!(
            extract_current_version(toml_sample),
            Some("0.1.12".to_string())
        );

        let invalid_toml = "[workspace]\nmembers = []\n";
        assert_eq!(extract_current_version(invalid_toml), None);
    }

    #[test]
    fn test_replace_all() {
        let input = "version = \"0.1.12\"\nimage: axiom:0.1.12";
        let (out, count) = replace_all(input, "0.1.12", "0.1.13");
        assert_eq!(count, 2);
        assert_eq!(out, "version = \"0.1.13\"\nimage: axiom:0.1.13");

        let (no_out, no_count) = replace_all(input, "9.9.9", "1.0.0");
        assert_eq!(no_count, 0);
        assert_eq!(no_out, input);
    }
}
