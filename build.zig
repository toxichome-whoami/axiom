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
}
