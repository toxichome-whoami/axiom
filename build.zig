const std = @import("std");

pub fn build(b: *std.Build) void {
    // Setup step: compiles the lightweight toolchain shims into .tools/bin/
    const setup_step = b.step("setup", "Generate Zig C/C++ toolchain shims in .tools/bin");
    const setup_cmd = b.addSystemCommand(&.{
        "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tools/zig/setup_toolchain.ps1",
    });
    setup_step.dependOn(&setup_cmd.step);

    // Build step: cargo build --release
    const build_cmd = b.addSystemCommand(&.{
        "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        "$env:PATH = (Resolve-Path .tools/bin).Path + ';' + $env:PATH; cargo build --release",
    });
    build_cmd.step.dependOn(setup_step);
    b.default_step.dependOn(&build_cmd.step);

    // Check step: cargo check --workspace
    const check_step = b.step("check", "Run cargo check --workspace with Zig toolchain");
    const check_cmd = b.addSystemCommand(&.{
        "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        "$env:PATH = (Resolve-Path .tools/bin).Path + ';' + $env:PATH; cargo check --workspace",
    });
    check_cmd.step.dependOn(setup_step);
    check_step.dependOn(&check_cmd.step);

    // Test step: cargo test --workspace
    const test_step = b.step("test", "Run cargo test --workspace with Zig toolchain");
    const test_cmd = b.addSystemCommand(&.{
        "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        "$env:PATH = (Resolve-Path .tools/bin).Path + ';' + $env:PATH; cargo test --workspace -- --test-threads=1",
    });
    test_cmd.step.dependOn(setup_step);
    test_step.dependOn(&test_cmd.step);

    // UI step: npm run build in ui/
    const ui_step = b.step("ui", "Build Administrative Web UI frontend");
    const ui_cmd = b.addSystemCommand(&.{
        "npm", "--prefix", "ui", "run", "build",
    });
    ui_step.dependOn(&ui_cmd.step);
}
