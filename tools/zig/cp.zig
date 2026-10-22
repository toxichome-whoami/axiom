const std = @import("std");
const builtin = @import("builtin");

pub extern "kernel32" fn GetCommandLineA() callconv(.c) [*:0]const u8;
pub extern "kernel32" fn CopyFileA(
    lpExistingFileName: [*:0]const u8,
    lpNewFileName: [*:0]const u8,
    bFailIfExists: i32,
) callconv(.c) i32;

pub fn main() u8 {
    if (builtin.os.tag == .windows) {
        const cmd_ptr = GetCommandLineA();
        const cmd = std.mem.span(cmd_ptr);
        var it = std.mem.tokenizeScalar(u8, cmd, ' ');
        _ = it.next(); // skip program name

        var src_buf: [1024:0]u8 = undefined;
        var dst_buf: [1024:0]u8 = undefined;
        var has_src = false;
        var has_dst = false;

        while (it.next()) |token| {
            if (!std.mem.startsWith(u8, token, "-")) {
                if (!has_src) {
                    if (token.len >= src_buf.len) return 1;
                    @memcpy(src_buf[0..token.len], token);
                    src_buf[token.len] = 0;
                    has_src = true;
                } else if (!has_dst) {
                    if (token.len >= dst_buf.len) return 1;
                    @memcpy(dst_buf[0..token.len], token);
                    dst_buf[token.len] = 0;
                    has_dst = true;
                }
            }
        }

        if (!has_src or !has_dst) return 0;
        const res = CopyFileA(&src_buf, &dst_buf, 0);
        return if (res != 0) 0 else 1;
    } else {
        return 0;
    }
}
