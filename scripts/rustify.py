import os
import sys
from pathlib import Path


def setup_rust_file(rel_path):
    # Rel_path is something like webhook/health.py
    parts = list(rel_path.parts)
    parts[-1] = parts[-1].replace(".py", ".rs")

    rust_src_dir = Path("rust_extensions/axiom_core/src")
    rust_file_path = rust_src_dir.joinpath(*parts)

    # Create directories if they don't exist
    rust_file_path.parent.mkdir(parents=True, exist_ok=True)

    # Create boilerplate rust file
    if not rust_file_path.exists():
        with open(rust_file_path, "w", encoding="utf-8") as f:
            module_name = parts[-1].replace(".rs", "")
            f.write("use pyo3::prelude::*;\n\n")
            f.write(f"// TODO: Implement {module_name} in Rust\n")
        print(f"[+] Created {rust_file_path}")
    else:
        print(f"[*] {rust_file_path} already exists")


def inject_mod_rs(rel_path):
    parts = list(rel_path.parts)
    module_name = parts[-1].replace(".py", "")

    if len(parts) > 1:
        # It's inside a directory, e.g. webhook/health.py
        # We need to ensure webhook/mod.rs exists and has pub mod health;
        rust_src_dir = Path("rust_extensions/axiom_core/src")
        parent_dir = rust_src_dir.joinpath(*parts[:-1])
        mod_rs_path = parent_dir / "mod.rs"

        mod_statement = f"pub mod {module_name};\n"

        if not mod_rs_path.exists():
            with open(mod_rs_path, "w", encoding="utf-8") as f:
                f.write(mod_statement)
                f.write("\nuse pyo3::prelude::*;\n\n")
                f.write("#[pymodule]\n")
                f.write(
                    f"pub fn {parts[-2]}(_py: Python, m: &Bound<'_, PyModule>) -> PyResult<()> {{\n"
                )
                f.write(f"    // m.add_class::<{module_name}::SomeClass>()?;\n")
                f.write("    Ok(())\n")
                f.write("}\n")
            print(f"[+] Created {mod_rs_path} and added {module_name}")
        else:
            with open(mod_rs_path, "r", encoding="utf-8") as f:
                content = f.read()
            if mod_statement not in content:
                with open(mod_rs_path, "w", encoding="utf-8") as f:
                    f.write(mod_statement + content)
                print(f"[+] Injected {module_name} into {mod_rs_path}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python rustify.py src/path/to/file.py")
        sys.exit(1)

    target_py = Path(sys.argv[1])

    if not target_py.exists():
        print(f"[-] File {target_py} does not exist.")
        sys.exit(1)

    if not str(target_py).replace("\\", "/").startswith("src/"):
        print("[-] Target file must be inside the src/ directory.")
        sys.exit(1)

    # Get relative path from src/
    rel_path = target_py.relative_to("src")

    print(f"[*] Migrating {target_py} to Rust...")

    setup_rust_file(rel_path)
    inject_mod_rs(rel_path)

    # Delete the python file
    os.remove(target_py)
    print(f"[+] Deleted {target_py} (Strangler Fig Migration)")

    print("\n[!] Migration Scaffolding Complete!")
    print(
        "[!] Remember to update `rust_extensions/axiom_core/src/lib.rs` and the parent `mod.rs` PyModule block to expose the new Rust code to Python!"
    )


if __name__ == "__main__":
    main()
