import argparse
import subprocess
import sys
import os
import re

# ANSI color codes
RESET = "\033[0m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
DARK_GRAY = "\033[90m"

def print_color(text, color):
    print(f"{color}{text}{RESET}")

def build_linux():
    print_color("Setting up MSYS2 environment for Linux cross-compilation...", YELLOW)
    env = os.environ.copy()
    env["PATH"] = "D:\\msys64_install\\ucrt64\\bin;" + env.get("PATH", "")

    print_color("Building Axiom for Linux (x86_64-unknown-linux-gnu.2.17)...", CYAN)

    cmd = ["cargo", "zigbuild", "--color", "always", "--target", "x86_64-unknown-linux-gnu.2.17", "--release"]

    process = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")

    ignore_patterns = [
        "ignoring deprecated linker optimization setting",
        "code that will be rejected by a future version of Rust",
        "sqlx-postgres v0.7.4",
        "to see what the problems were, use the option",
        "warn(linker_messages)"
    ]
    axiom_warning_re = re.compile(r"axiom.*generated.*warning")

    assert process.stdout is not None, "stdout should be piped"
    while True:
        line = process.stdout.readline()
        if not line and process.poll() is not None:
            break
        line_stripped = line.strip()

        if not line_stripped or line_stripped == "|":
            continue

        skip = False
        for pat in ignore_patterns:
            if pat in line:
                skip = True
                break

        if not skip and not axiom_warning_re.search(line):
            print(line, end="")

    if process.returncode != 0:
        print_color(f"Linux build failed! Aborting. Exit code: {process.returncode}", RED)
        sys.exit(process.returncode)

    print_color("\nLinux build complete! Binary is located in: target\\x86_64-unknown-linux-gnu.2.17\\release\\axiom", GREEN)
    print_color("(Skipping metadata injection and auto-run since Linux ELF binaries don't use Windows icons and cannot run natively on Windows)", DARK_GRAY)

def build_windows():
    print_color("Building Axiom for Windows (Release)...", CYAN)

    cmd = ["cargo", "build", "--release"]
    result = subprocess.run(cmd)

    if result.returncode != 0:
        print_color(f"Build failed! Aborting. Exit code: {result.returncode}", RED)
        sys.exit(result.returncode)

    print_color("\nStarting Axiom...", GREEN)
    target_path = os.path.join("target", "release", "axiom.exe")
    try:
        subprocess.run([target_path])
    except Exception as e:
        print_color(f"Axiom exited with error: {e}", RED)

def main():
    parser = argparse.ArgumentParser(description="Axiom Build and Run Script")
    parser.add_argument("--linux", action="store_true", help="Build for Linux using zigbuild")
    args = parser.parse_args()

    if args.linux:
        build_linux()
    else:
        build_windows()

if __name__ == "__main__":
    main()
