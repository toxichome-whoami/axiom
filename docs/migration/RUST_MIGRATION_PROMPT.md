# Axiom Python-to-Rust Migration Protocol

You are an expert Rust and Python PyO3 developer assisting with a total codebase migration for the Axiom system. We are systematically rewriting a Python API into a 100% native Rust application via the Strangler Fig pattern. 

**ABSOLUTE RULE**: When rewriting a Python file into Rust, you MUST use pure, native Rust code (e.g. native Rust crates like `tokio`, `rusqlite`, `async-nats`, `reqwest`, etc.). **DO NOT** embed Python strings using `PyModule::from_code_bound`. **DO NOT** use `py.import_bound()` to proxy standard Python libraries unless absolutely unavoidable (like integrating with a complex Python object we haven't migrated yet). The end goal is to remove the Python runtime completely, which means our Rust code cannot rely on Python libraries.

## Workflow Instructions

When I ask you to migrate a file (e.g. `src/webhook/persistence.py`), follow these steps precisely:

### Step 1: Scaffold using our script
Run the provided migration script. This script automatically deletes the Python file and scaffolds the correct directory structure and PyO3 bindings in the `rust_extensions/axiom_core/src` folder.
```powershell
python scripts/rustify.py src/path/to/target.py
```

### Step 2: Implement Native Rust
Read the original Python file logic (you can check git history if the script already deleted it). Implement the logic natively in Rust inside `rust_extensions/axiom_core/src/path/to/target.rs`.

- **Databases**: Use `rusqlite` for SQLite. Use `redis` for Redis Streams. Use `async-nats` for NATS Jetstream.
- **Asynchronous Execution**: If the Python code relies heavily on `asyncio`, you must use a Rust `tokio` runtime to manage asynchronous background execution natively in Rust.
- **Data Structures**: Use native Rust concurrency types (e.g. `OnceLock`, `tokio::sync::mpsc`, `DashMap`).

### Step 3: PyModule Export
Manually update `rust_extensions/axiom_core/src/lib.rs` (or the respective parent `mod.rs` file) to export your new Rust structs and functions into Python. For example:
```rust
m.add_class::<target::TargetClass>()?;
m.add_function(wrap_pyfunction!(target::target_function, m)?)?;
```

### Step 4: Fix Global Imports
Because the Python file is gone, grep the codebase and fix all Python files that were importing from it so they import from the Rust library instead.
Example: `from axiom_core.webhook.persistence import get_persistence`

### Step 5: Compile and Test
Compile the Rust extension using our automated script:
```powershell
python scripts/build_rust.py
```
If you need to test it instantly, you can pass a python command:
```powershell
python scripts/build_rust.py --test "from axiom_core... import ...; print(test_output())"
```

Please acknowledge these rules. I will now give you a target file to migrate.
