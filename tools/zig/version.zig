const std = @import("std");
const builtin = @import("builtin");

const STARTUPINFOA = extern struct {
    cb: u32 = @sizeOf(STARTUPINFOA),
    lpReserved: ?[*:0]u8 = null,
    lpDesktop: ?[*:0]u8 = null,
    lpTitle: ?[*:0]u8 = null,
    dwX: u32 = 0,
    dwY: u32 = 0,
    dwXSize: u32 = 0,
    dwYSize: u32 = 0,
    dwXCountChars: u32 = 0,
    dwYCountChars: u32 = 0,
    dwFillAttribute: u32 = 0,
    dwFlags: u32 = 0,
    wShowWindow: u16 = 0,
    cbReserved2: u16 = 0,
    lpReserved2: ?*u8 = null,
    hStdInput: ?*anyopaque = null,
    hStdOutput: ?*anyopaque = null,
    hStdError: ?*anyopaque = null,
};

const PROCESS_INFORMATION = extern struct {
    hProcess: ?*anyopaque = null,
    hThread: ?*anyopaque = null,
    dwProcessId: u32 = 0,
    dwThreadId: u32 = 0,
};

pub extern "kernel32" fn CreateProcessA(
    lpApplicationName: ?[*:0]const u8,
    lpCommandLine: ?[*:0]u8,
    lpProcessAttributes: ?*anyopaque,
    lpThreadAttributes: ?*anyopaque,
    bInheritHandles: i32,
    dwCreationFlags: u32,
    lpEnvironment: ?*anyopaque,
    lpCurrentDirectory: ?[*:0]const u8,
    lpStartupInfo: *STARTUPINFOA,
    lpProcessInformation: *PROCESS_INFORMATION,
) callconv(.c) i32;

pub extern "kernel32" fn WaitForSingleObject(hHandle: ?*anyopaque, dwMilliseconds: u32) callconv(.c) u32;
pub extern "kernel32" fn GetExitCodeProcess(hProcess: ?*anyopaque, lpExitCode: *u32) callconv(.c) i32;

fn runCommand(cmd: []const u8) i32 {
    if (builtin.os.tag == .windows) {
        var cmd_buf: [1024:0]u8 = undefined;
        if (cmd.len >= cmd_buf.len) return -1;
        @memcpy(cmd_buf[0..cmd.len], cmd);
        cmd_buf[cmd.len] = 0;

        var si = STARTUPINFOA{};
        var pi = PROCESS_INFORMATION{};

        const ok = CreateProcessA(null, &cmd_buf, null, null, 1, 0, null, null, &si, &pi);
        if (ok == 0) return -1;
        defer _ = CloseHandle(pi.hProcess);
        defer _ = CloseHandle(pi.hThread);

        const INFINITE: u32 = 0xFFFFFFFF;
        _ = WaitForSingleObject(pi.hProcess, INFINITE);

        var exit_code: u32 = 0;
        _ = GetExitCodeProcess(pi.hProcess, &exit_code);
        return @intCast(exit_code);
    } else {
        return 0;
    }
}

// Windows API
pub extern "kernel32" fn GetCommandLineA() callconv(.c) [*:0]const u8;
pub extern "kernel32" fn CreateFileA(
    lpFileName: [*:0]const u8,
    dwDesiredAccess: u32,
    dwShareMode: u32,
    lpSecurityAttributes: ?*anyopaque,
    dwCreationDisposition: u32,
    dwFlagsAndAttributes: u32,
    hTemplateFile: ?*anyopaque,
) callconv(.c) ?*anyopaque;

pub extern "kernel32" fn GetFileSize(
    hFile: ?*anyopaque,
    lpFileSizeHigh: ?*u32,
) callconv(.c) u32;

pub extern "kernel32" fn ReadFile(
    hFile: ?*anyopaque,
    lpBuffer: [*]u8,
    nNumberOfBytesToRead: u32,
    lpNumberOfBytesRead: ?*u32,
    lpOverlapped: ?*anyopaque,
) callconv(.c) i32;

pub extern "kernel32" fn WriteFile(
    hFile: ?*anyopaque,
    lpBuffer: [*]const u8,
    nNumberOfBytesToWrite: u32,
    lpNumberOfBytesWritten: ?*u32,
    lpOverlapped: ?*anyopaque,
) callconv(.c) i32;

pub extern "kernel32" fn CloseHandle(hObject: ?*anyopaque) callconv(.c) i32;

// POSIX externs (for Linux / macOS)
pub extern "c" fn open(path: [*:0]const u8, flags: c_int, ...) callconv(.c) c_int;
pub extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) callconv(.c) isize;
pub extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) callconv(.c) isize;
pub extern "c" fn close(fd: c_int) callconv(.c) c_int;
pub extern "c" fn lseek(fd: c_int, offset: i64, whence: c_int) callconv(.c) i64;

fn readFileAlloc(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
    var path_z_buf: [1024:0]u8 = undefined;
    if (path.len >= path_z_buf.len) return error.PathTooLong;
    @memcpy(path_z_buf[0..path.len], path);
    path_z_buf[path.len] = 0;

    if (builtin.os.tag == .windows) {
        const GENERIC_READ: u32 = 0x80000000;
        const FILE_SHARE_READ: u32 = 1;
        const OPEN_EXISTING: u32 = 3;
        const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;

        const h = CreateFileA(&path_z_buf, GENERIC_READ, FILE_SHARE_READ, null, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, null);
        if (h == null or @intFromPtr(h.?) == 0xFFFFFFFFFFFFFFFF) {
            return error.FileNotFound;
        }
        defer _ = CloseHandle(h);

        const size = GetFileSize(h, null);
        if (size == 0xFFFFFFFF) return error.ReadError;

        const buf = try allocator.alloc(u8, size);
        var bytes_read: u32 = 0;
        const ok = ReadFile(h, buf.ptr, size, &bytes_read, null);
        if (ok == 0 or bytes_read != size) {
            return error.ReadError;
        }
        return buf;
    } else {
        const O_RDONLY: c_int = 0;
        const fd = open(&path_z_buf, O_RDONLY);
        if (fd < 0) return error.FileNotFound;
        defer _ = close(fd);

        const SEEK_END: c_int = 2;
        const SEEK_SET: c_int = 0;
        const size_i64 = lseek(fd, 0, SEEK_END);
        if (size_i64 < 0) return error.ReadError;
        _ = lseek(fd, 0, SEEK_SET);

        const size: usize = @intCast(size_i64);
        const buf = try allocator.alloc(u8, size);
        const n = read(fd, buf.ptr, size);
        if (n < 0 or @as(usize, @intCast(n)) != size) return error.ReadError;
        return buf;
    }
}

fn writeFile(path: []const u8, content: []const u8) !void {
    var path_z_buf: [1024:0]u8 = undefined;
    if (path.len >= path_z_buf.len) return error.PathTooLong;
    @memcpy(path_z_buf[0..path.len], path);
    path_z_buf[path.len] = 0;

    if (builtin.os.tag == .windows) {
        const GENERIC_WRITE: u32 = 0x40000000;
        const CREATE_ALWAYS: u32 = 2;
        const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;

        const h = CreateFileA(&path_z_buf, GENERIC_WRITE, 0, null, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, null);
        if (h == null or @intFromPtr(h.?) == 0xFFFFFFFFFFFFFFFF) {
            return error.WriteError;
        }
        defer _ = CloseHandle(h);

        var written: u32 = 0;
        const ok = WriteFile(h, content.ptr, @intCast(content.len), &written, null);
        if (ok == 0 or written != content.len) {
            return error.WriteError;
        }
    } else {
        const O_WRONLY: c_int = 1;
        const O_CREAT: c_int = 64;
        const O_TRUNC: c_int = 512;
        const fd = open(&path_z_buf, O_WRONLY | O_CREAT | O_TRUNC, @as(c_int, 0o664));
        if (fd < 0) return error.WriteError;
        defer _ = close(fd);

        const n = write(fd, content.ptr, content.len);
        if (n < 0 or @as(usize, @intCast(n)) != content.len) return error.WriteError;
    }
}

fn replaceAll(allocator: std.mem.Allocator, input: []const u8, needle: []const u8, replacement: []const u8) !struct { text: []const u8, count: usize } {
    if (needle.len == 0 or input.len < needle.len) {
        return .{ .text = input, .count = 0 };
    }

    var count: usize = 0;
    var i: usize = 0;
    while (i <= input.len - needle.len) {
        if (std.mem.eql(u8, input[i .. i + needle.len], needle)) {
            count += 1;
            i += needle.len;
        } else {
            i += 1;
        }
    }

    if (count == 0) {
        return .{ .text = input, .count = 0 };
    }

    const new_len = input.len + count * replacement.len - count * needle.len;
    const out = try allocator.alloc(u8, new_len);

    var src_idx: usize = 0;
    var dst_idx: usize = 0;
    while (src_idx <= input.len - needle.len) {
        if (std.mem.eql(u8, input[src_idx .. src_idx + needle.len], needle)) {
            @memcpy(out[dst_idx .. dst_idx + replacement.len], replacement);
            dst_idx += replacement.len;
            src_idx += needle.len;
        } else {
            out[dst_idx] = input[src_idx];
            dst_idx += 1;
            src_idx += 1;
        }
    }

    if (src_idx < input.len) {
        const remaining = input.len - src_idx;
        @memcpy(out[dst_idx .. dst_idx + remaining], input[src_idx..]);
        dst_idx += remaining;
    }

    return .{ .text = out, .count = count };
}

const SemVer = struct {
    major: u32,
    minor: u32,
    patch: u32,

    pub fn parse(text: []const u8) ?SemVer {
        var str = text;
        if (str.len > 0 and (str[0] == 'v' or str[0] == 'V')) {
            str = str[1..];
        }

        var it = std.mem.splitScalar(u8, str, '.');
        const s_major = it.next() orelse return null;
        const s_minor = it.next() orelse return null;
        const s_patch = it.next() orelse return null;

        const maj = std.fmt.parseInt(u32, s_major, 10) catch return null;
        const min = std.fmt.parseInt(u32, s_minor, 10) catch return null;
        const pat = std.fmt.parseInt(u32, s_patch, 10) catch return null;

        return SemVer{ .major = maj, .minor = min, .patch = pat };
    }

    pub fn formatAlloc(self: SemVer, allocator: std.mem.Allocator) ![]const u8 {
        return std.fmt.allocPrint(allocator, "{d}.{d}.{d}", .{ self.major, self.minor, self.patch });
    }
};

fn extractCurrentVersion(cargo_toml_content: []const u8) ?[]const u8 {
    // Look for [workspace.package] then version = "..."
    const ws_header = "[workspace.package]";
    const ws_pos = std.mem.indexOf(u8, cargo_toml_content, ws_header) orelse return null;
    const slice = cargo_toml_content[ws_pos..];

    const ver_key = "version = \"";
    const key_pos = std.mem.indexOf(u8, slice, ver_key) orelse return null;
    const start = key_pos + ver_key.len;
    const end = std.mem.indexOfPos(u8, slice, start, "\"") orelse return null;

    return slice[start..end];
}

const TargetFile = struct {
    path: []const u8,
    description: []const u8,
};

const TARGET_FILES = [_]TargetFile{
    .{ .path = "Cargo.toml", .description = "Root Cargo workspace package version" },
    .{ .path = "crates/core/src/config/schema.rs", .description = "Core configuration default server version" },
    .{ .path = "ui/package.json", .description = "Vite Web UI package manifest" },
    .{ .path = "ui/package-lock.json", .description = "Vite Web UI package-lock" },
    .{ .path = "ui/src/pages/Settings.tsx", .description = "Settings page UI fallback version" },
    .{ .path = "install.ps1", .description = "PowerShell installation script LatestTag" },
    .{ .path = "install.sh", .description = "POSIX shell installation script LATEST_TAG" },
    .{ .path = "README.md", .description = "Root documentation, badges, and binary links" },
    .{ .path = "docs/api.md", .description = "API documentation version badge" },
    .{ .path = "docs/building.md", .description = "Build documentation version badge" },
    .{ .path = "docs/configuration.md", .description = "Configuration documentation and container tags" },
};

fn printUsage() void {
    std.debug.print(
        \\========================================================================
        \\ Axiom Unified Version Automation (tools/zig/version.zig)
        \\========================================================================
        \\Usage:
        \\  zig run tools/zig/version.zig -- [COMMAND] [OPTIONS]
        \\
        \\Commands:
        \\  get                 Display current workspace version from Cargo.toml
        \\  <version>           Set explicit version across all files (e.g. 0.1.13)
        \\  set <version>       Same as above (e.g. set 0.1.13)
        \\  bump patch          Increment patch version (0.1.12 -> 0.1.13)
        \\  bump minor          Increment minor version (0.1.12 -> 0.2.0)
        \\  bump major          Increment major version (0.1.12 -> 1.0.0)
        \\
        \\Options:
        \\  --dry-run           Preview file changes and replacements without writing
        \\  --no-cargo          Skip running cargo check to synchronize Cargo.lock
        \\  -h, --help          Show this help message
        \\
        \\Examples:
        \\  zig run tools/zig/version.zig -- get
        \\  zig run tools/zig/version.zig -- bump patch
        \\  zig run tools/zig/version.zig -- 0.1.13
        \\  zig run tools/zig/version.zig -- 0.1.13 --dry-run
        \\========================================================================
        \\
    , .{});
}

pub fn main() !u8 {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Parse command line arguments
    var args: [32][]const u8 = undefined;
    var arg_count: usize = 0;

    if (builtin.os.tag == .windows) {
        const cmd_raw = GetCommandLineA();
        const cmd = std.mem.span(cmd_raw);
        var i: usize = 0;
        while (i < cmd.len) {
            while (i < cmd.len and (cmd[i] == ' ' or cmd[i] == '\t')) : (i += 1) {}
            if (i >= cmd.len) break;

            const start = i;
            var in_quote = false;
            while (i < cmd.len) : (i += 1) {
                if (cmd[i] == '"') {
                    in_quote = !in_quote;
                } else if (!in_quote and (cmd[i] == ' ' or cmd[i] == '\t')) {
                    break;
                }
            }
            var slice = cmd[start..i];
            if (slice.len >= 2 and slice[0] == '"' and slice[slice.len - 1] == '"') {
                slice = slice[1 .. slice.len - 1];
            }
            if (arg_count < args.len) {
                args[arg_count] = slice;
                arg_count += 1;
            }
        }
    }

    // Skip the program executable arg
    const effective_args = if (arg_count > 1) args[1..arg_count] else args[0..0];

    var dry_run = false;
    var no_cargo = false;
    var cmd_action: ?[]const u8 = null;
    var cmd_value: ?[]const u8 = null;

    for (effective_args) |arg| {
        if (std.mem.eql(u8, arg, "--dry-run")) {
            dry_run = true;
        } else if (std.mem.eql(u8, arg, "--no-cargo")) {
            no_cargo = true;
        } else if (std.mem.eql(u8, arg, "-h") or std.mem.eql(u8, arg, "--help")) {
            printUsage();
            return 0;
        } else if (cmd_action == null) {
            cmd_action = arg;
        } else if (cmd_value == null) {
            cmd_value = arg;
        }
    }

    // 1. Read Cargo.toml to extract current version
    const cargo_content = readFileAlloc(allocator, "Cargo.toml") catch |err| {
        std.debug.print("Error: Could not read Cargo.toml: {any}\nEnsure you run this from the Axiom repository root.\n", .{err});
        return 1;
    };

    const current_ver_raw = extractCurrentVersion(cargo_content) orelse {
        std.debug.print("Error: Could not locate [workspace.package] version in Cargo.toml\n", .{});
        return 1;
    };
    const current_ver = current_ver_raw;

    // Handle "get" or no argument
    if (cmd_action == null or std.mem.eql(u8, cmd_action.?, "get")) {
        std.debug.print("\nAxiom Current Version: {s}\n\n", .{current_ver});
        return 0;
    }

    var target_ver: []const u8 = undefined;

    if (std.mem.eql(u8, cmd_action.?, "bump")) {
        const bump_type = cmd_value orelse "patch";
        const parsed = SemVer.parse(current_ver) orelse {
            std.debug.print("Error: Failed to parse current version '{s}' as SemVer.\n", .{current_ver});
            return 1;
        };

        var next_semver = parsed;
        if (std.mem.eql(u8, bump_type, "patch")) {
            next_semver.patch += 1;
        } else if (std.mem.eql(u8, bump_type, "minor")) {
            next_semver.minor += 1;
            next_semver.patch = 0;
        } else if (std.mem.eql(u8, bump_type, "major")) {
            next_semver.major += 1;
            next_semver.minor = 0;
            next_semver.patch = 0;
        } else {
            std.debug.print("Error: Unknown bump target '{s}'. Valid: patch, minor, major.\n", .{bump_type});
            return 1;
        }

        target_ver = try next_semver.formatAlloc(allocator);
    } else if (std.mem.eql(u8, cmd_action.?, "set")) {
        const val = cmd_value orelse {
            std.debug.print("Error: 'set' requires a version argument, e.g.: zig run tools/zig/version.zig -- set 0.1.13\n", .{});
            return 1;
        };
        var clean_val = val;
        if (clean_val.len > 0 and (clean_val[0] == 'v' or clean_val[0] == 'V')) {
            clean_val = clean_val[1..];
        }
        if (SemVer.parse(clean_val) == null) {
            std.debug.print("Error: Invalid SemVer string '{s}'. Expected format: X.Y.Z (e.g. 0.1.13)\n", .{clean_val});
            return 1;
        }
        target_ver = clean_val;
    } else {
        // Direct version passed e.g. "0.1.13" or "v0.1.13"
        var clean_val = cmd_action.?;
        if (clean_val.len > 0 and (clean_val[0] == 'v' or clean_val[0] == 'V')) {
            clean_val = clean_val[1..];
        }
        if (SemVer.parse(clean_val) == null) {
            std.debug.print("Error: Unknown command or invalid version '{s}'.\nRun with --help for usage.\n", .{cmd_action.?});
            return 1;
        }
        target_ver = clean_val;
    }

    if (std.mem.eql(u8, current_ver, target_ver)) {
        std.debug.print("Version is already {s}. Nothing to update.\n", .{target_ver});
        return 0;
    }

    std.debug.print("\n========================================================================\n", .{});
    std.debug.print(" Axiom Automated Version Update\n", .{});
    std.debug.print(" Old Version: {s}\n", .{current_ver});
    std.debug.print(" New Version: {s}\n", .{target_ver});
    if (dry_run) {
        std.debug.print(" MODE:        DRY RUN (no files will be written)\n", .{});
    }
    std.debug.print("========================================================================\n\n", .{});

    var total_files_updated: usize = 0;
    var total_replacements: usize = 0;

    for (TARGET_FILES, 1..) |target, idx| {
        const file_content = readFileAlloc(allocator, target.path) catch |err| {
            std.debug.print("[{d}/{d}] {s} -> SKIP (Could not open: {any})\n", .{ idx, TARGET_FILES.len, target.path, err });
            continue;
        };

        // Perform replacement of old version with new version
        const rep = try replaceAll(allocator, file_content, current_ver, target_ver);

        // Special handling for ui/package-lock.json if it had an outdated header version like 4.0.0
        var final_text = rep.text;
        var total_rep_count = rep.count;

        if (std.mem.eql(u8, target.path, "ui/package-lock.json") and total_rep_count == 0) {
            // Check if it has "version": "4.0.0" for axiom-ui
            const pkg_rep = try replaceAll(allocator, file_content, "\"version\": \"4.0.0\",", try std.fmt.allocPrint(allocator, "\"version\": \"{s}\",", .{target_ver}));
            if (pkg_rep.count > 0) {
                final_text = pkg_rep.text;
                total_rep_count += pkg_rep.count;
            }
        }

        if (total_rep_count > 0) {
            total_files_updated += 1;
            total_replacements += total_rep_count;
            std.debug.print("[{d}/{d}] {s}\n      -> {d} replacement(s) ({s})\n", .{
                idx,
                TARGET_FILES.len,
                target.path,
                total_rep_count,
                target.description,
            });

            if (!dry_run) {
                try writeFile(target.path, final_text);
            }
        } else {
            std.debug.print("[{d}/{d}] {s}\n      -> OK (no old version pattern found)\n", .{ idx, TARGET_FILES.len, target.path });
        }
    }

    std.debug.print("\n------------------------------------------------------------------------\n", .{});
    std.debug.print("Summary: {d} file(s) updated, {d} total replacement(s)\n", .{ total_files_updated, total_replacements });

    if (!dry_run and !no_cargo) {
        std.debug.print("\n==> Synchronizing Cargo.lock via cargo check...\n", .{});
        const res = runCommand("cargo check --quiet");
        if (res == 0) {
            std.debug.print("==> Cargo.lock synchronized successfully!\n", .{});
        } else {
            std.debug.print("Warning: cargo check returned non-zero code {d}. Please run cargo check manually.\n", .{res});
        }
    }

    std.debug.print("\n[SUCCESS] Version update complete: {s} -> {s}\n\n", .{ current_ver, target_ver });
    return 0;
}
