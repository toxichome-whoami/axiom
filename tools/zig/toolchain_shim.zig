const std = @import("std");
const builtin = @import("builtin");

pub extern "c" fn __p___argc() callconv(.c) *c_int;
pub extern "c" fn __p___argv() callconv(.c) *[*]?[*:0]u8;
pub extern "c" fn _spawnvp(mode: c_int, cmdname: [*:0]const u8, argv: [*]const ?[*:0]const u8) callconv(.c) isize;

pub fn main() u8 {
    const argc = @as(usize, @intCast(__p___argc().*));
    const argv = __p___argv().*;

    const exe = if (argc > 0 and argv[0] != null) std.mem.span(argv[0].?) else "";

    var subcmd: [*:0]const u8 = "cc";
    var is_dlltool = false;

    if (std.mem.indexOf(u8, exe, "dlltool") != null) {
        subcmd = "dlltool";
        is_dlltool = true;
    } else if (std.mem.indexOf(u8, exe, "g++") != null or
        std.mem.indexOf(u8, exe, "c++") != null or
        std.mem.indexOf(u8, exe, "clang++") != null)
    {
        subcmd = "c++";
    } else if (std.mem.indexOf(u8, exe, "ar") != null) {
        subcmd = "ar";
    }

    var has_m = false;
    if (is_dlltool) {
        var i: usize = 1;
        while (i < argc) : (i += 1) {
            if (argv[i]) |arg| {
                if (std.mem.eql(u8, std.mem.span(arg), "-m")) {
                    has_m = true;
                    break;
                }
            }
        }
    }

    // Allocate array for arguments
    var new_args: [4096]?[*:0]const u8 = undefined;
    var out: usize = 0;

    new_args[out] = "zig";
    out += 1;
    new_args[out] = subcmd;
    out += 1;

    if (is_dlltool and !has_m) {
        new_args[out] = "-m";
        out += 1;
        new_args[out] = "i386:x86-64";
        out += 1;
    }

    if (!is_dlltool and !std.mem.eql(u8, std.mem.span(subcmd), "ar")) {
        new_args[out] = "-Wno-date-time";
        out += 1;
        new_args[out] = "-fno-sanitize=all";
        out += 1;
    }

    var i: usize = 1;
    while (i < argc) : (i += 1) {
        if (argv[i]) |arg_ptr| {
            const arg = std.mem.span(arg_ptr);
            if (std.mem.eql(u8, arg, "--target=x86_64-pc-windows-gnu")) {
                new_args[out] = "-target";
                out += 1;
                new_args[out] = "x86_64-windows-gnu";
                out += 1;
            } else if (std.mem.eql(u8, arg, "-target") and i + 1 < argc and argv[i + 1] != null and std.mem.eql(u8, std.mem.span(argv[i + 1].?), "x86_64-pc-windows-gnu")) {
                new_args[out] = "-target";
                out += 1;
                new_args[out] = "x86_64-windows-gnu";
                out += 1;
                i += 1;
            } else if (std.mem.eql(u8, arg, "x86_64-pc-windows-gnu")) {
                new_args[out] = "x86_64-windows-gnu";
                out += 1;
            } else {
                new_args[out] = arg_ptr;
                out += 1;
            }
        }
    }
    new_args[out] = null;

    const ret = _spawnvp(0, "zig", &new_args);
    return @as(u8, @truncate(@as(usize, @bitCast(ret))));
}
