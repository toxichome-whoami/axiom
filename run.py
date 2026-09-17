import argparse
import subprocess
import sys
import os
import re
import shutil

# ANSI color codes
RESET = "\033[0m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
DARK_GRAY = "\033[90m"

MAIN_RS = os.path.join("src", "main.rs")

# Tokio runtime builder strings to swap in main.rs
MULTI_THREAD_MARKER = "tokio::runtime::Builder::new_multi_thread()"
SINGLE_THREAD_MARKER = "tokio::runtime::Builder::new_current_thread()"


def print_color(text, color):
    print(f"{color}{text}{RESET}")


def patch_runtime(single_thread: bool):
    """Swap Tokio runtime flavor in main.rs. Returns True if a change was made."""
    with open(MAIN_RS, "r", encoding="utf-8") as f:
        content = f.read()

    if single_thread:
        if SINGLE_THREAD_MARKER in content:
            return False
        patched = content.replace(MULTI_THREAD_MARKER, SINGLE_THREAD_MARKER)
        label = "current_thread (single-process / cPanel mode)"
    else:
        if MULTI_THREAD_MARKER in content:
            return False
        patched = content.replace(SINGLE_THREAD_MARKER, MULTI_THREAD_MARKER)
        label = "multi_thread (default mode)"

    with open(MAIN_RS, "w", encoding="utf-8") as f:
        f.write(patched)

    print_color(f"Runtime patched -> {label}", YELLOW)
    return True


def restore_runtime():
    """Always restore main.rs to multi_thread after a cpanel build."""
    with open(MAIN_RS, "r", encoding="utf-8") as f:
        content = f.read()
    if SINGLE_THREAD_MARKER in content:
        patched = content.replace(SINGLE_THREAD_MARKER, MULTI_THREAD_MARKER)
        with open(MAIN_RS, "w", encoding="utf-8") as f:
            f.write(patched)
        print_color("Runtime restored -> multi_thread", DARK_GRAY)


def run_cargo(cmd: list, env=None) -> int:
    """Stream cargo output, suppressing known noise lines. Returns exit code."""
    ignore_patterns = [
        "ignoring deprecated linker optimization setting",
        "code that will be rejected by a future version of Rust",
        "sqlx-postgres v0.7.4",
        "to see what the problems were, use the option",
        "warn(linker_messages)",
    ]
    axiom_warning_re = re.compile(r"axiom.*generated.*warning")

    process = subprocess.Popen(
        cmd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    assert process.stdout is not None
    while True:
        line = process.stdout.readline()
        if not line and process.poll() is not None:
            break
        line_stripped = line.strip()
        if not line_stripped or line_stripped == "|":
            continue
        skip = any(pat in line for pat in ignore_patterns)
        if not skip and not axiom_warning_re.search(line):
            print(line, end="")

    return process.returncode


def build_linux(cpanel: bool = False):
    env = os.environ.copy()
    env["PATH"] = "D:\\msys64_install\\ucrt64\\bin;" + env.get("PATH", "")

    if cpanel:
        print_color("Mode: cPanel / single-process (current_thread runtime)", YELLOW)
        patch_runtime(single_thread=True)

    print_color("Building Axiom for Linux (x86_64-unknown-linux-gnu.2.17)...", CYAN)

    cmd = [
        "cargo", "zigbuild",
        "--color", "always",
        "--target", "x86_64-unknown-linux-gnu.2.17",
        "--release",
    ]

    rc = run_cargo(cmd, env=env)

    if cpanel:
        restore_runtime()

    if rc != 0:
        print_color(f"Linux build failed! Aborting. Exit code: {rc}", RED)
        sys.exit(rc)

    binary_path = os.path.join(
        "target", "x86_64-unknown-linux-gnu.2.17", "release", "axiom"
    )

    if cpanel:
        dest = binary_path + "-cpanel"
        if os.path.isfile(binary_path):
            shutil.copy2(binary_path, dest)
        print_color(f"\nLinux cPanel build complete! Binary: {dest}", GREEN)
    else:
        print_color(f"\nLinux build complete! Binary: {binary_path}", GREEN)

    print_color(
        "(Skipping auto-run: Linux ELF binaries cannot run natively on Windows)",
        DARK_GRAY,
    )


def build_windows():
    print_color("Building Axiom for Windows (Release)...", CYAN)

    rc = run_cargo(["cargo", "build", "--release"])

    if rc != 0:
        print_color(f"Build failed! Aborting. Exit code: {rc}", RED)
        sys.exit(rc)

    print_color("\nStarting Axiom...", GREEN)
    target_path = os.path.join("target", "release", "axiom.exe")
    try:
        subprocess.run([target_path])
    except Exception as e:
        print_color(f"Axiom exited with error: {e}", RED)


def main():
    parser = argparse.ArgumentParser(
        description="Axiom Build and Run Script",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run.py                        Build and run for Windows (multi-thread)
  python run.py --linux                Cross-compile for Linux (multi-thread)
  python run.py --linux --cpanel       Cross-compile for Linux with single-thread
                                       Tokio runtime for cPanel / shared hosting
                                       (avoids hitting OS entry process limits)
""",
    )
    parser.add_argument(
        "--linux",
        action="store_true",
        help="Cross-compile for Linux using cargo-zigbuild",
    )
    parser.add_argument(
        "--cpanel",
        action="store_true",
        help=(
            "Use current_thread Tokio runtime instead of multi_thread. "
            "Required for cPanel and shared hosts that limit the number of "
            "OS-level entry processes. Only valid with --linux."
        ),
    )
    args = parser.parse_args()

    if args.cpanel and not args.linux:
        print_color(
            "Error: --cpanel requires --linux (cPanel targets are Linux hosts).",
            RED,
        )
        sys.exit(1)

    if args.linux:
        build_linux(cpanel=args.cpanel)
    else:
        build_windows()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        # Always restore multi_thread on Ctrl+C so the repo stays clean
        restore_runtime()
        print_color("\n[Axiom] Gracefully stopped via Ctrl+C.", GREEN)
        sys.exit(0)
