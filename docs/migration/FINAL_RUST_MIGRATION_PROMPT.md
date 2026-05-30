# Axiom Final Native Rust Migration Protocol

You are an expert Rust systems architect. You are assisting with the final phase of the Axiom backend migration.

Previously, we used a Strangler Fig pattern to migrate Python modules into a Rust `PyO3` extension (`axiom_core`). Now, we are ready for the **Final Phase**: completely eliminating Python, the `PyO3` glue, and the FastAPI server, replacing it with a 100% native Rust web server.

## Goal
Tear down the Python wrappers and migrate the main API routing and application state to a native Rust web framework (e.g., `axum` or `actix-web`), resulting in a standalone compiled Rust binary. No Python runtime should remain. As part of this transition, all Rust source files currently residing in `rust_extensions/axiom_core/src` will be moved into the root `src` directory (`D:\Python\Git_repos\axiom\src`), replacing the old Python codebase entirely.

## Workflow Instructions

When starting this final phase, follow these architectural directives:

### Step 1: Rust Server Foundation
- Modify the `Cargo.toml` in the core Rust project to build a standard `bin` executable instead of a `cdylib` extension.
- Add a high-performance Rust web framework to `Cargo.toml` (e.g., `axum` or `actix-web`), along with `tower-http` for middleware.
- Create a `src/main.rs` file to act as the true entry point of the standalone Rust application.
- Initialize the global `tokio` asynchronous runtime in `main.rs` (`#[tokio::main]`).

### Step 2: Strip PyO3 Glue
- Systematically go through the existing Rust files (e.g., `persistence.rs`, `queue.rs`, `signer.rs`).
- Remove all `#[pyclass]`, `#[pymethods]`, `#[pyfunction]`, and `PyResult` macros.
- Replace PyO3 bridging types (like `Bound<'_, PyAny>`, `PyDict`, `PyObject`) with standard Rust types (like `serde_json::Value`, `std::collections::HashMap`, etc.).
- Delete the `lib.rs` / `mod.rs` PyModule export blocks. The code is no longer a C-extension.

### Step 3: Migrate FastAPI to Axum
- Translate the Python FastAPI routers (`src/api/*`, `src/server/app.py`) directly into Rust Axum routers.
- Re-implement any Python middleware (Auth, Telemetry) using native `tower` middleware in Rust.
- Re-implement the configuration provider using `serde` and `figment` or `config` crates to load `config.toml` natively.

### Step 4: Cleanup
- Move all files from `rust_extensions/axiom_core/src/*` directly into `D:\Python\Git_repos\axiom\src`.
- Once the Rust binary successfully compiles and binds to the server port, systematically delete all `.py` files in the repository.
- Delete the `.venv` and `requirements.txt`.
- Update the Dockerfile/deployment scripts to compile and run the native Rust binary.

Please acknowledge these rules. I will now guide you on which server components to migrate first.
