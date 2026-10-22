const std = @import("std");
const builtin = @import("builtin");

pub fn build(b: *std.Build) void {
    const exe_ext = if (builtin.os.tag == .windows) ".exe" else "";
    const runner_bin = ".tools/runner" ++ exe_ext;

    // Compile runner: compiles tools/zig/runner.c using zig cc
    const compile_runner = b.addSystemCommand(&.{
        "zig", "cc", "-O2", "-s", "-o", runner_bin, "tools/zig/runner.c",
    });

    // Setup step: ensures shims in .tools/bin are generated
    const setup_step = b.step("setup", "Generate Zig C/C++ toolchain shims in .tools/bin");
    const setup_cmd = b.addSystemCommand(&.{ runner_bin, "setup" });
    setup_cmd.step.dependOn(&compile_runner.step);
    setup_step.dependOn(&setup_cmd.step);

    // Build step: cargo build --release
    const build_cmd = b.addSystemCommand(&.{ runner_bin, "build" });
    build_cmd.step.dependOn(setup_step);
    b.default_step.dependOn(&build_cmd.step);

    // Check step: cargo check --workspace
    const check_step = b.step("check", "Run cargo check --workspace with Zig toolchain");
    const check_cmd = b.addSystemCommand(&.{ runner_bin, "check" });
    check_cmd.step.dependOn(setup_step);
    check_step.dependOn(&check_cmd.step);

    // Test step: cargo test --workspace
    const test_step = b.step("test", "Run cargo test --workspace with Zig toolchain");
    const test_cmd = b.addSystemCommand(&.{ runner_bin, "test" });
    test_cmd.step.dependOn(setup_step);
    test_step.dependOn(&test_cmd.step);

    // UI step: npm run build in ui/
    const ui_step = b.step("ui", "Build Administrative Web UI frontend");
    const ui_cmd = b.addSystemCommand(&.{ runner_bin, "ui" });
    ui_cmd.step.dependOn(&compile_runner.step);
    ui_step.dependOn(&ui_cmd.step);
}
