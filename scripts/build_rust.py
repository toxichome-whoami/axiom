import os
import subprocess
import sys
from pathlib import Path


def main():
    print("=======================================")
    print("  Nexus Gate - Rust Compiler Pipeline")
    print("=======================================\n")

    # The directory where Cargo.toml lives
    rust_dir = Path("rust_extensions/axiom_core").absolute()

    if not rust_dir.exists():
        print(f"[-] Error: Could not find rust project at {rust_dir}")
        sys.exit(1)

    # Set up environment variables
    env = os.environ.copy()

    # Windows specific fixes (MSYS2 path and ABI3 compatibility for unreleased Python versions)
    if sys.platform == "win32":
        print(
            "[*] Detected Windows OS. Applying MSYS2 and ABI3 compatibility patches..."
        )
        msys_path = r"D:\msys64_install\ucrt64\bin"
        if msys_path not in env.get("PATH", ""):
            env["PATH"] = f"{msys_path};{env.get('PATH', '')}"

        env["PYO3_USE_ABI3_FORWARD_COMPATIBILITY"] = "1"
    else:
        print("[*] Detected Unix-like OS (Linux/macOS).")

    print("[*] Compiling Rust native extension module...\n")

    # Use 'python -m maturin' so it automatically uses the current virtual environment!
    # This avoids hardcoding '.venv/Scripts' vs '.venv/bin'
    command = [sys.executable, "-m", "maturin", "develop", "--release"]

    try:
        # Run maturin inside the rust directory
        subprocess.run(command, cwd=str(rust_dir), env=env, check=True)
        print("\n[+] Build Pipeline Completed Successfully!")
        print(
            "[+] The native Rust module has been injected into your Python environment."
        )

        if len(sys.argv) > 1 and sys.argv[1] == "--test":
            test_cmd = sys.argv[2]
            print(f"\n[*] Running Test: {test_cmd}")
            env["PYTHONPATH"] = "src"
            subprocess.run(
                [sys.executable, "-c", test_cmd], cwd=".", env=env, check=True
            )

    except subprocess.CalledProcessError as e:
        print(f"\n[-] Build failed with exit code {e.returncode}")
        sys.exit(e.returncode)


if __name__ == "__main__":
    main()
