const std = @import("std");
const builtin = @import("builtin");

pub fn build(b: *std.Build) void {
    const exe_ext = if (builtin.os.tag == .windows) ".exe" else "";
    const runner_bin = "tools/zig/runner" ++ exe_ext;

    // Compile runner: compiles tools/zig/runner.zig using zig build-exe
    const compile_runner = b.addSystemCommand(&.{
        "zig", "build-exe", "-O", "ReleaseFast", "-lc", "-femit-bin=" ++ runner_bin, "tools/zig/runner.zig",
    });

    // Default step: zig build -> compiles runner and runs release build
    const build_cmd = b.addSystemCommand(&.{ runner_bin, "build", "--release" });
    build_cmd.step.dependOn(&compile_runner.step);
    b.default_step.dependOn(&build_cmd.step);

    // Version automation step: zig build version [-Dto=0.1.13] [-Ddry-run=true]
    const target_ver = b.option([]const u8, "to", "Target version (e.g. 0.1.13) or bump (patch, minor, major)");
    const dry_run = b.option(bool, "dry-run", "Simulate without writing files") orelse false;

    const version_cmd = b.addSystemCommand(&.{ "zig", "run", "tools/zig/version.zig", "--" });
    if (target_ver) |v| {
        if (std.mem.eql(u8, v, "patch") or std.mem.eql(u8, v, "minor") or std.mem.eql(u8, v, "major")) {
            version_cmd.addArgs(&.{ "bump", v });
        } else {
            version_cmd.addArgs(&.{v});
        }
    } else {
        version_cmd.addArgs(&.{"get"});
    }
    if (dry_run) {
        version_cmd.addArgs(&.{"--dry-run"});
    }

    const version_step = b.step("version", "Update or view project version across all repository files");
    version_step.dependOn(&version_cmd.step);
}
