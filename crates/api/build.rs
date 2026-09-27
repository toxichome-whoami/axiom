/*
 * Cargo build script compiling Vite frontend into ui/dist before rust-embed packaging.
 * Owned by: crates/api
 * Key deps: std::process::Command, std::fs
 * Invariants: If npm is available and UI sources changed, rebuilds Vite bundle; otherwise falls back to existing ui/dist.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use std::path::Path;
use std::process::Command;

fn main() {
    let ui_dir = Path::new("../../ui");
    let ui_dist = ui_dir.join("dist");
    let ui_dist_index = ui_dist.join("index.html");

    // Track input files so Cargo re-runs build script when frontend sources change
    println!("cargo:rerun-if-changed=../../ui/src");
    println!("cargo:rerun-if-changed=../../ui/index.html");
    println!("cargo:rerun-if-changed=../../ui/package.json");
    println!("cargo:rerun-if-changed=../../ui/vite.config.ts");
    println!("cargo:rerun-if-changed=../../ui/tailwind.config.js");

    let needs_build = if !ui_dist_index.exists() {
        true
    } else {
        // Check if any source file is newer than dist/index.html
        is_newer(&ui_dir.join("src"), &ui_dist_index)
            || is_newer(&ui_dir.join("index.html"), &ui_dist_index)
            || is_newer(&ui_dir.join("package.json"), &ui_dist_index)
            || is_newer(&ui_dir.join("vite.config.ts"), &ui_dist_index)
    };

    if needs_build {
        println!("cargo:warning=Building Axiom Web UI Vite bundle...");

        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("cmd");
            c.args(["/C", "npm", "run", "build"]);
            c
        } else {
            let mut c = Command::new("npm");
            c.args(["run", "build"]);
            c
        };

        cmd.current_dir(ui_dir);

        match cmd.status() {
            Ok(status) if status.success() => {
                println!("cargo:warning=Axiom Web UI Vite bundle built successfully.");
            }
            Ok(status) => {
                println!(
                    "cargo:warning=npm run build exited with status: {}. Using existing ui/dist assets.",
                    status
                );
            }
            Err(e) => {
                println!(
                    "cargo:warning=Failed to invoke npm ({:?}). Using existing ui/dist assets.",
                    e
                );
            }
        }
    }

    // Safety fallback: ensure ui/dist/index.html exists so rust-embed compiles even on headless machines without node
    if !ui_dist_index.exists() {
        let _ = std::fs::create_dir_all(&ui_dist);
        let fallback_html = r#"<!DOCTYPE html>
<html>
<head><title>Axiom Web UI</title></head>
<body style="background:#1F1F1F;color:#F5F5F5;font-family:sans-serif;padding:40px;text-align:center;">
<h2>Axiom Web UI</h2>
<p>Production bundle not found. Run <code>npm run build</code> inside the <code>ui/</code> directory to compile the dashboard.</p>
</body></html>"#;
        let _ = std::fs::write(&ui_dist_index, fallback_html);
    }
}

fn is_newer(src: &Path, reference: &Path) -> bool {
    let Ok(ref_meta) = reference.metadata() else {
        return true;
    };
    let Ok(ref_time) = ref_meta.modified() else {
        return true;
    };

    if src.is_file() {
        if let Ok(meta) = src.metadata() {
            if let Ok(src_time) = meta.modified() {
                return src_time > ref_time;
            }
        }
    } else if src.is_dir() {
        if let Ok(entries) = std::fs::read_dir(src) {
            for entry in entries.flatten() {
                let p = entry.path();
                if is_newer(&p, reference) {
                    return true;
                }
            }
        }
    }

    false
}
