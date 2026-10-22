const std = @import("std");
const builtin = @import("builtin");

pub fn build(b: *std.Build) void {
    const exe_ext = if (builtin.os.tag == .windows) ".exe" else "";
    const runner_bin = "tools/zig/runner" ++ exe_ext;

    // Compile runner: compiles tools/zig/runner.c using zig cc
    const compile_runner = b.addSystemCommand(&.{
        "zig", "cc", "-O2", "-s", "-o", runner_bin, "tools/zig/runner.c",
    });

    // Setup step: ensures shims in .tools/bin are generated
    const setup_step = b.step("setup", "Generate Zig C/C++ toolchain shims in .tools/bin");
    const setup_cmd = b.addSystemCommand(&.{ runner_bin, "setup" });
    setup_cmd.step.dependOn(&compile_runner.step);
    setup_step.dependOn(&setup_cmd.step);

    // Build step: cargo build --release (default)
    const build_cmd = b.addSystemCommand(&.{ runner_bin, "build" });
    build_cmd.step.dependOn(setup_step);
    b.default_step.dependOn(&build_cmd.step);

    // Dev step: cargo build (debug profile)
    const dev_step = b.step("dev", "Compile in development mode (cargo build)");
    const dev_cmd = b.addSystemCommand(&.{ runner_bin, "dev" });
    dev_cmd.step.dependOn(setup_step);
    dev_step.dependOn(&dev_cmd.step);

    // Check step: cargo check --workspace
    const check_step = b.step("check", "Run cargo check --workspace with Zig toolchain");
    const check_cmd = b.addSystemCommand(&.{ runner_bin, "check" });
    check_cmd.step.dependOn(setup_step);
    check_step.dependOn(&check_cmd.step);

    // Clippy step: cargo clippy --workspace --all-targets
    const clippy_step = b.step("clippy", "Run cargo clippy linter with Zig toolchain");
    const clippy_cmd = b.addSystemCommand(&.{ runner_bin, "clippy" });
    clippy_cmd.step.dependOn(setup_step);
    clippy_step.dependOn(&clippy_cmd.step);

    // Test step: cargo test --workspace
    const test_step = b.step("test", "Run cargo test --workspace with Zig toolchain");
    const test_cmd = b.addSystemCommand(&.{ runner_bin, "test" });
    test_cmd.step.dependOn(setup_step);
    test_step.dependOn(&test_cmd.step);

    // Fmt step: cargo fmt --check
    const fmt_step = b.step("fmt", "Check formatting with cargo fmt");
    const fmt_cmd = b.addSystemCommand(&.{ runner_bin, "fmt" });
    fmt_cmd.step.dependOn(setup_step);
    fmt_step.dependOn(&fmt_cmd.step);

    // Run step: cargo run --bin axiom -- server run
    const run_step = b.step("run", "Run Axiom server daemon");
    const run_cmd = b.addSystemCommand(&.{ runner_bin, "run" });
    run_cmd.step.dependOn(setup_step);
    run_step.dependOn(&run_cmd.step);

    // UI step: npm run build in ui/
    const ui_step = b.step("ui", "Build Administrative Web UI frontend");
    const ui_cmd = b.addSystemCommand(&.{ runner_bin, "ui" });
    ui_cmd.step.dependOn(&compile_runner.step);
    ui_step.dependOn(&ui_cmd.step);
}
