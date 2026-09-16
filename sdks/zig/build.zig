const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    _ = b.addModule("axiom", .{
        .root_source_file = b.path("src/main.zig"),
    });

    const exe = b.addExecutable(.{
        .name = "example",
        .root_source_file = b.path("examples/basic.zig"),
        .target = target,
        .optimize = optimize,
    });
    
    // In Zig 0.12+ we use root_module
    exe.root_module.addAnonymousImport("axiom", .{
        .root_source_file = b.path("src/main.zig"),
    });

    b.installArtifact(exe);
}

