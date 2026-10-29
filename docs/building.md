<div align="center">

# Axiom Build & Toolchain Guide

### High-Performance Pure Rust & Cargo Build Pipeline

**Universal Cargo Build · Zero External Shims · Sub-15MB Binary**

[![Version](https://img.shields.io/badge/version-0.1.22%2B-111827.svg?style=flat-square)](https://github.com/toxichome-whoami/axiom/releases)
[![Rust](https://img.shields.io/badge/rust-1.88%2B-b7410e.svg?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-111827.svg?style=flat-square)](../LICENSE)
[![Platforms](https://img.shields.io/badge/platform-linux%20%C2%B7%20macos%20%C2%B7%20windows-111827.svg?style=flat-square)](https://github.com/toxichome-whoami/axiom/releases)

</div>

## Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Quick Start](#3-quick-start)
4. [Standard Development Commands](#4-standard-development-commands)
5. [Version Automation Tool](#5-version-automation-tool)
6. [Release Optimization & Binary Footprint](#6-release-optimization--binary-footprint)
7. [Directory Lifecycle & Clean-Up](#7-directory-lifecycle--clean-up)
8. [Troubleshooting & FAQ](#8-troubleshooting--faq)

## 1. Overview

Axiom is engineered as a 100% pure Rust workspace with embedded TypeScript Web UI assets. It builds directly with standard `cargo` across Windows, Linux, and macOS without requiring auxiliary compiler wrappers or external build systems.

High-performance native components (such as SQLite / LibSQL, mimalloc memory allocator, and cryptographic primitives) compile seamlessly using standard native toolchains:

- **Windows**: MSVC C++ Build Tools or MinGW GNU toolchain
- **Linux**: Standard GCC or Clang (`build-essential`)
- **macOS**: Xcode Command Line Tools (`clang`)

## 2. Prerequisites

| Tool        | Minimum | Recommended                                                    | Purpose                             |
| ----------- | ------- | -------------------------------------------------------------- | ----------------------------------- |
| **Rust**    | `1.88+` | `stable` (MSVC on Windows, GNU on Linux, Apple Clang on macOS) | Rust workspace compiler and `cargo` |
| **Node.js** | `18+`   | `20 LTS`                                                       | Admin Web UI compilation (`ui/`)    |

## 3. Quick Start

### 3-Step Build

```bash
# 1. Clone repository
git clone https://github.com/toxichome-whoami/axiom.git
cd axiom

# 2. Build the embedded Admin Web UI bundle
npm --prefix ui run build

# 3. Compile optimized release binary via Cargo
cargo build --release
```

The compiled binary will be placed at:

- **Windows**: `target/release/axiom.exe`
- **Linux / macOS**: `target/release/axiom`

Verify the output:

```bash
./target/release/axiom --version
```

> [!NOTE]
> If you are not modifying the Admin Web UI, step 2 can be skipped after the initial build, as assets in `ui/dist/` are embedded directly into the Rust binary via `rust-embed`.

## 4. Standard Development Commands

Axiom uses standard Cargo workspace commands:

| Command                                | Purpose                                                          |
| -------------------------------------- | ---------------------------------------------------------------- |
| **`cargo build --release`**            | Compile fully optimized standalone release binary                |
| **`cargo build`**                      | Fast unoptimized debug build in `target/debug/`                  |
| **`cargo check --workspace`**          | Sub-second workspace type check and syntax verification          |
| **`cargo clippy --workspace`**         | Workspace-wide linting and safety checks                         |
| **`cargo test --workspace`**           | Run full workspace test suite (all crates and integration tests) |
| **`cargo test -p <crate>`**            | Run tests for a specific crate (e.g. `cargo test -p axiom-db`)   |
| **`cargo test --test e2e_simulation`** | Run full 8-phase end-to-end integration simulation               |
| **`cargo run -p axiom -- server`**     | Compile and launch the gateway server daemon in development mode |

## 5. Version Automation Tool

Axiom includes a native Rust version automation tool (`axiom-version`) that synchronizes SemVer across all 11 workspace manifests and documentation files:

```bash
# Inspect current version from Cargo.toml
cargo run -p axiom-cli --bin axiom-version -- get

# Preview next patch bump without writing to disk
cargo run -p axiom-cli --bin axiom-version -- bump patch --dry-run

# Increment patch version (e.g. 0.1.22 -> 0.1.22) and sync Cargo.lock
cargo run -p axiom-cli --bin axiom-version -- bump patch

# Increment minor or major version
cargo run -p axiom-cli --bin axiom-version -- bump minor
cargo run -p axiom-cli --bin axiom-version -- bump major

# Set explicit version
cargo run -p axiom-cli --bin axiom-version -- set 0.2.0
```

The version tool is an isolated developer binary and is intentionally excluded from the production gateway release binary (`axiom`) to eliminate developer tool bloat in production environments.

## 6. Release Optimization & Binary Footprint

Axiom enforces aggressive release profile settings in the root `Cargo.toml` to produce a minimal, self-contained single binary:

```toml
[profile.release]
opt-level = 3          # Maximum compiler optimizations
lto = "thin"           # Cross-crate Thin Link-Time Optimization
codegen-units = 1      # Single unit maximizes inlining opportunities
panic = "abort"        # Drops unwinding tables and landing pads
strip = true           # Strips symbols, debug info, and symbol tables
```

### Binary Metrics

| Component                 | Unstripped Size | Stripped Release (`cargo build --release`) | Idle RAM Footprint |
| ------------------------- | --------------- | ------------------------------------------ | ------------------ |
| **`axiom.exe` / `axiom`** | ~45 MB          | **< 15 MB**                                | **~18 MB RSS**     |

The resulting executable includes:

- Embedded REST and Admin APIs
- Embedded Web UI dashboard (Vite single-page app)
- Content-addressed BLAKE3 blob engine (Fjall LSM)
- High-concurrency SQL query engine and AST transpiler
- In-memory / hybrid query and response caches

## 7. Directory Lifecycle & Clean-Up

Axiom keeps generated build artifacts cleanly partitioned:

| Directory  | Generated by    | Tracked in Git?   | Safe to delete?                                    |
| ---------- | --------------- | ----------------- | -------------------------------------------------- |
| `target/`  | Cargo compiler  | No (`.gitignore`) | **Yes** — run `cargo clean`                        |
| `ui/dist/` | `npm run build` | No (`.gitignore`) | **Yes** — re-built via `npm --prefix ui run build` |

## 8. Troubleshooting & FAQ

| Problem                                 | Cause                                                  | Solution                                                                                  |
| --------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **`C compiler not found` during build** | System lacks a standard C/C++ compiler for native deps | Install Visual Studio Build Tools (Windows), `build-essential` (Linux), or Xcode (macOS). |
| **Web UI returns 404 or blank page**    | Admin Web UI assets were not compiled before packaging | Run `npm --prefix ui run build` and re-compile the binary.                                |
| **Linker error during release build**   | Outdated Rust toolchain or missing system C runtime    | Ensure Rust is updated (`rustup update stable`).                                          |
