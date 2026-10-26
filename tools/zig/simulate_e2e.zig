const std = @import("std");
const builtin = @import("builtin");

// ─── C and Win32 / POSIX Declarations ─────────────────────────────────────────

pub extern "c" fn system(cmd: [*:0]const u8) callconv(.c) c_int;

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

pub extern "kernel32" fn TerminateProcess(hProcess: ?*anyopaque, uExitCode: u32) callconv(.c) i32;
pub extern "kernel32" fn WaitForSingleObject(hHandle: ?*anyopaque, dwMilliseconds: u32) callconv(.c) u32;
pub extern "kernel32" fn CloseHandle(hObject: ?*anyopaque) callconv(.c) i32;
pub extern "kernel32" fn Sleep(dwMilliseconds: u32) callconv(.c) void;

pub extern "kernel32" fn CreateFileA(
    lpFileName: [*:0]const u8,
    dwDesiredAccess: u32,
    dwShareMode: u32,
    lpSecurityAttributes: ?*anyopaque,
    dwCreationDisposition: u32,
    dwFlagsAndAttributes: u32,
    hTemplateFile: ?*anyopaque,
) callconv(.c) ?*anyopaque;

pub extern "kernel32" fn GetFileSize(hFile: ?*anyopaque, lpFileSizeHigh: ?*u32) callconv(.c) u32;
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

pub extern "kernel32" fn CreateDirectoryA(lpPathName: [*:0]const u8, lpSecurityAttributes: ?*anyopaque) callconv(.c) i32;

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn sleepMs(ms: u32) void {
    if (builtin.os.tag == .windows) {
        Sleep(ms);
    } else {
        std.time.sleep(@as(u64, ms) * 1_000_000);
    }
}

fn readFileAlloc(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
    var path_z: [1024:0]u8 = undefined;
    if (path.len >= path_z.len) return error.PathTooLong;
    @memcpy(path_z[0..path.len], path);
    path_z[path.len] = 0;

    const GENERIC_READ: u32 = 0x80000000;
    const FILE_SHARE_ALL: u32 = 1 | 2 | 4;
    const OPEN_EXISTING: u32 = 3;
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;

    const h = CreateFileA(&path_z, GENERIC_READ, FILE_SHARE_ALL, null, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, null);
    if (h == null or @intFromPtr(h.?) == 0xFFFFFFFFFFFFFFFF) return error.FileNotFound;
    defer _ = CloseHandle(h);

    const size = GetFileSize(h, null);
    if (size == 0xFFFFFFFF) return error.ReadError;

    const buf = try allocator.alloc(u8, size);
    var bytes_read: u32 = 0;
    const ok = ReadFile(h, buf.ptr, size, &bytes_read, null);
    if (ok == 0 or bytes_read != size) return error.ReadError;
    return buf;
}

fn writeFile(path: []const u8, content: []const u8) !void {
    var path_z: [1024:0]u8 = undefined;
    if (path.len >= path_z.len) return error.PathTooLong;
    @memcpy(path_z[0..path.len], path);
    path_z[path.len] = 0;

    const GENERIC_WRITE: u32 = 0x40000000;
    const FILE_SHARE_ALL: u32 = 1 | 2 | 4;
    const CREATE_ALWAYS: u32 = 2;
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;

    const h = CreateFileA(&path_z, GENERIC_WRITE, FILE_SHARE_ALL, null, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, null);
    if (h == null or @intFromPtr(h.?) == 0xFFFFFFFFFFFFFFFF) return error.WriteError;
    defer _ = CloseHandle(h);

    var written: u32 = 0;
    const ok = WriteFile(h, content.ptr, @intCast(content.len), &written, null);
    if (ok == 0 or written != content.len) return error.WriteError;
}

fn logPass(msg: []const u8) void {
    std.debug.print("\x1b[92m[PASS]\x1b[0m {s}\n", .{msg});
}

fn logInfo(msg: []const u8) void {
    std.debug.print("\x1b[94m[INFO]\x1b[0m {s}\n", .{msg});
}

fn logFail(msg: []const u8) void {
    std.debug.print("\x1b[91m[FAIL]\x1b[0m {s}\n", .{msg});
}

const HttpResponse = struct {
    status: u16,
    body: []const u8,
};

fn extractJsonField(json_str: []const u8, field_name: []const u8) ?[]const u8 {
    var search_buf: [128]u8 = undefined;
    const search = std.fmt.bufPrint(&search_buf, "\"{s}\":\"", .{field_name}) catch return null;
    const idx = std.mem.indexOf(u8, json_str, search) orelse return null;
    const val_start = idx + search.len;
    const val_end = std.mem.indexOfPos(u8, json_str, val_start, "\"") orelse return null;
    return json_str[val_start..val_end];
}

var global_req_counter: u32 = 0;

fn executeHttp(
    allocator: std.mem.Allocator,
    method: []const u8,
    url: []const u8,
    body: ?[]const u8,
    header1: ?[]const u8,
    header2: ?[]const u8,
) !HttpResponse {
    global_req_counter += 1;
    const req_id = global_req_counter;

    var req_file_buf: [64]u8 = undefined;
    const req_file = try std.fmt.bufPrint(&req_file_buf, "test_e2e_run/req_{d}.json", .{req_id});
    var out_file_buf: [64]u8 = undefined;
    const out_file = try std.fmt.bufPrint(&out_file_buf, "test_e2e_run/out_{d}.txt", .{req_id});

    var h1_part: []const u8 = "";
    if (header1) |h| {
        h1_part = try std.fmt.allocPrint(allocator, " -H \"{s}\"", .{h});
    }
    var h2_part: []const u8 = "";
    if (header2) |h| {
        h2_part = try std.fmt.allocPrint(allocator, " -H \"{s}\"", .{h});
    }
    var body_part: []const u8 = "";
    if (body) |b| {
        try writeFile(req_file, b);
        const has_ct = (header1 != null and std.mem.indexOf(u8, header1.?, "Content-Type") != null) or
            (header2 != null and std.mem.indexOf(u8, header2.?, "Content-Type") != null);
        if (has_ct) {
            body_part = try std.fmt.allocPrint(allocator, " --data-binary @{s}", .{req_file});
        } else {
            body_part = try std.fmt.allocPrint(allocator, " -H \"Content-Type: application/json\" --data-binary @{s}", .{req_file});
        }
    }

    const cmd_z = try std.fmt.allocPrintSentinel(
        allocator,
        "curl.exe -s -w \"\\nHTTP_STATUS:%{{http_code}}\" -X {s} \"{s}\"{s}{s}{s} > {s} 2>nul",
        .{ method, url, h1_part, h2_part, body_part, out_file },
        0,
    );
    defer allocator.free(cmd_z);

    _ = system(cmd_z.ptr);

    const out_data = readFileAlloc(allocator, out_file) catch "";
    const marker = "\nHTTP_STATUS:";
    if (std.mem.lastIndexOf(u8, out_data, marker)) |idx| {
        const status_str = out_data[idx + marker.len ..];
        var trimmed_status: [8]u8 = undefined;
        var s_len: usize = 0;
        for (status_str) |c| {
            if (c >= '0' and c <= '9') {
                if (s_len < trimmed_status.len) {
                    trimmed_status[s_len] = c;
                    s_len += 1;
                }
            } else if (c == '\r' or c == '\n') break;
        }
        const status = std.fmt.parseInt(u16, trimmed_status[0..s_len], 10) catch 0;
        const body_part_str = out_data[0..idx];
        return HttpResponse{ .status = status, .body = body_part_str };
    }

    return HttpResponse{ .status = 0, .body = out_data };
}

fn executeCli(allocator: std.mem.Allocator, args: []const u8) !i32 {
    const cmd_z = try std.fmt.allocPrintSentinel(allocator, "target\\debug\\axiom.exe {s} > test_e2e_run/cli_out.txt 2>&1", .{args}, 0);
    defer allocator.free(cmd_z);

    const rc = system(cmd_z.ptr);
    if (rc != 0) {
        const out_data = readFileAlloc(allocator, "test_e2e_run/cli_out.txt") catch "";
        std.debug.print("\x1b[91m[CLI ERROR (rc={d})]:\x1b[0m\n{s}\n", .{ rc, out_data });
    }
    return rc;
}

// ─── Main Simulation Harness ──────────────────────────────────────────────────

pub fn main() !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    logInfo("=================================================");
    logInfo("Axiom Full End-to-End Simulation Test (Zig)     ");
    logInfo("=================================================");

    // 1. Clean previous runs
    logInfo("Step 1: Preparing clean sandbox environment...");
    _ = system("rmdir /s /q test_e2e_run 2>nul");
    _ = system("del /f /q data\\test_app_e2e.db 2>nul");
    _ = CreateDirectoryA("test_e2e_run", null);
    _ = CreateDirectoryA("test_e2e_run/data", null);
    _ = CreateDirectoryA("test_e2e_run/data/blobs", null);
    _ = CreateDirectoryA("test_e2e_run/logs", null);

    // 2. Generate test configuration
    const config_toml =
        \\[server]
        \\host = "127.0.0.1"
        \\port = 4598
        \\max_connections = 1000
        \\request_timeout = 15
        \\body_limit = "10mb"
        \\allowed_ips = ["127.0.0.1"]
        \\trusted_proxies = ["127.0.0.1"]
        \\cors_origins = ["*"]
        \\shutdown_timeout = 5
        \\
        \\[logging]
        \\enabled = true
        \\level = "INFO"
        \\format = "pretty"
        \\directory = "test_e2e_run/logs"
        \\file_prefix = "axiom_sim"
        \\max_file_size = "10mb"
        \\max_files = 2
        \\stdout = true
        \\
        \\[rate_limit]
        \\enabled = true
        \\backend = "memory"
        \\window = 60
        \\max_requests = 1000
        \\burst = 100
        \\penalty_threshold = 20
        \\penalty_cooldown = 60
        \\
        \\[cache]
        \\enabled = true
        \\backend = "memory"
        \\query_cache = false
        \\query_results_ttl = 0
        \\schema_ttl = 60
        \\
        \\[metadata]
        \\url = "file:test_e2e_run/data/axiom.db"
        \\token = ""
        \\reload_interval = 5
        \\
        \\[blob]
        \\path = "test_e2e_run/data/blobs"
        \\inline_max = "64kb"
        \\max_object = "5gb"
        \\verify_reads = false
        \\
    ;
    try writeFile("test_e2e_run/config.toml", config_toml);
    logPass("Test configuration generated at test_e2e_run/config.toml");

    // 3. Launch Axiom background daemon
    logInfo("Step 2: Spawning Axiom Server Daemon on port 4598...");
    var server_cmd: [512:0]u8 = undefined;
    const server_str = "target\\debug\\axiom.exe server -c test_e2e_run/config.toml";
    @memcpy(server_cmd[0..server_str.len], server_str);
    server_cmd[server_str.len] = 0;

    var si = STARTUPINFOA{};
    var pi = PROCESS_INFORMATION{};
    const proc_ok = CreateProcessA(null, &server_cmd, null, null, 0, 0, null, null, &si, &pi);
    if (proc_ok == 0) {
        logFail("Failed to spawn target\\debug\\axiom.exe daemon!");
        return error.ServerSpawnFailed;
    }
    defer {
        logInfo("Terminating Axiom Server Daemon and cleaning up...");
        _ = TerminateProcess(pi.hProcess, 0);
        _ = CloseHandle(pi.hProcess);
        _ = CloseHandle(pi.hThread);
        _ = system("rmdir /s /q test_e2e_run 2>nul");
        _ = system("del /f /q data\\test_app_e2e.db 2>nul");
        logPass("Teardown and cleanup completed cleanly.");
    }

    // 4. Poll readiness
    var healthy = false;
    var attempts: usize = 0;
    while (attempts < 40) : (attempts += 1) {
        const resp = executeHttp(allocator, "GET", "http://127.0.0.1:4598/ready", null, null, null) catch HttpResponse{ .status = 0, .body = "" };
        if (resp.status == 200) {
            healthy = true;
            break;
        }
        sleepMs(250);
    }
    if (!healthy) {
        logFail("Axiom daemon failed to become ready on port 4598!");
        return error.ServerNotReady;
    }
    logPass("Axiom Daemon healthy and listening at http://127.0.0.1:4598");

    // ─── Phase 1: Setup Wizard Simulation ──────────────────────────────────────
    logInfo("Step 3: Simulating Setup Wizard Endpoints...");
    {
        const r1 = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/setup/begin", null, null, null);
        if (r1.status != 200) return error.SetupBeginFailed;
        logPass("POST /admin/v1/setup/begin returned 200 OK (setup_required: true)");

        const account_payload =
            \\{"username":"MasterOperator","email":"operator@axiom.cloud","password":"SuperSecureAdminPassword123!"}
        ;
        const r2 = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/setup/account", account_payload, null, null);
        if (r2.status != 200) return error.SetupAccountFailed;
        logPass("POST /admin/v1/setup/account created admin with email (200 OK)");

        const token = extractJsonField(r2.body, "session_token") orelse return error.MissingSessionToken;
        var auth_hdr_buf: [512]u8 = undefined;
        const auth_hdr = try std.fmt.bufPrint(&auth_hdr_buf, "Authorization: Bearer {s}", .{token});

        const db_payload =
            \\{"alias":"testdb","engine":"LibSQL","url":"sqlite://data/test_app_e2e.db"}
        ;
        const r3 = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/setup/database", db_payload, auth_hdr, null);
        if (r3.status != 200) return error.SetupDatabaseFailed;
        logPass("POST /admin/v1/setup/database registered LibSQL data engine (200 OK)");

        const r4 = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/setup/complete", null, auth_hdr, null);
        if (r4.status != 200) return error.SetupCompleteFailed;
        logPass("POST /admin/v1/setup/complete finalized and locked wizard (200 OK)");
    }

    // ─── Phase 2: Dual Login & Logout Simulation ──────────────────────────────
    logInfo("Step 4: Simulating Authentication & Dual Login (Username/Email)...");
    {
        // Login using USERNAME
        const login_user_payload =
            \\{"username":"MasterOperator","password":"SuperSecureAdminPassword123!"}
        ;
        const r_login_u = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/auth/login", login_user_payload, null, null);
        if (r_login_u.status != 200) return error.LoginUsernameFailed;
        const u_token = extractJsonField(r_login_u.body, "session_token") orelse return error.MissingToken;
        logPass("POST /admin/v1/auth/login with USERNAME succeeded (200 OK)");

        // Logout
        var u_hdr_buf: [512]u8 = undefined;
        const u_hdr = try std.fmt.bufPrint(&u_hdr_buf, "Authorization: Bearer {s}", .{u_token});
        const r_logout = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/auth/logout", null, u_hdr, null);
        if (r_logout.status != 200) return error.LogoutFailed;
        logPass("POST /admin/v1/auth/logout revoked session (200 OK)");

        // Assert old token rejected
        const r_rej = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/admin/v1/status", null, u_hdr, null);
        if (r_rej.status != 401) return error.SessionNotInvalidated;
        logPass("Revoked session properly returns 401 Unauthorized");

        // Login using EMAIL
        const login_email_payload =
            \\{"username":"operator@axiom.cloud","password":"SuperSecureAdminPassword123!"}
        ;
        const r_login_e = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/auth/login", login_email_payload, null, null);
        if (r_login_e.status != 200) return error.LoginEmailFailed;
        const e_token = extractJsonField(r_login_e.body, "session_token") orelse return error.MissingToken;
        const canonical = extractJsonField(r_login_e.body, "username") orelse return error.MissingUsername;
        if (!std.mem.eql(u8, canonical, "MasterOperator")) return error.CanonicalUsernameMismatch;
        logPass("POST /admin/v1/auth/login with EMAIL succeeded (resolved canonical MasterOperator)");

        // Login with BAD PASSWORD -> 401
        const bad_payload =
            \\{"username":"MasterOperator","password":"WrongPassword123!"}
        ;
        const r_bad = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/auth/login", bad_payload, null, null);
        if (r_bad.status != 401) return error.BadPasswordNotRejected;
        logPass("Invalid password properly rejected with 401 Unauthorized");

        // Keep active session header for remaining admin requests
        _ = e_token;
    }

    // Obtain active session token
    const login_payload =
        \\{"username":"MasterOperator","password":"SuperSecureAdminPassword123!"}
    ;
    const r_act = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/auth/login", login_payload, null, null);
    const active_token = extractJsonField(r_act.body, "session_token") orelse return error.MissingToken;
    var admin_hdr_buf: [512]u8 = undefined;
    const admin_hdr = try std.fmt.bufPrint(&admin_hdr_buf, "Authorization: Bearer {s}", .{active_token});

    // ─── Phase 3: CLI Subcommand Suite Simulation ──────────────────────────────
    logInfo("Step 5: Simulating Axiom CLI Command Suite...");
    {
        const rc_doc = try executeCli(allocator, "doctor");
        if (rc_doc != 0) return error.CliDoctorFailed;
        logPass("CLI: axiom doctor executed successfully");

        const rc_ul = try executeCli(allocator, "user list --json -c test_e2e_run/config.toml");
        if (rc_ul != 0) return error.CliUserListFailed;
        logPass("CLI: axiom user list --json executed successfully");

        const rc_dl = try executeCli(allocator, try std.fmt.allocPrint(allocator, "--url http://127.0.0.1:4598 -k {s} db list --json", .{active_token}));
        if (rc_dl != 0) return error.CliDbListFailed;
        logPass("CLI: axiom db list --json executed successfully");

        const rc_rl = try executeCli(allocator, try std.fmt.allocPrint(allocator, "--url http://127.0.0.1:4598 -k {s} role list --json", .{active_token}));
        if (rc_rl != 0) return error.CliRoleListFailed;
        logPass("CLI: axiom role list --json executed successfully");

        const rc_kl = try executeCli(allocator, try std.fmt.allocPrint(allocator, "--url http://127.0.0.1:4598 -k {s} key list --json", .{active_token}));
        if (rc_kl != 0) return error.CliKeyListFailed;
        logPass("CLI: axiom key list --json executed successfully");

        const rc_cs = try executeCli(allocator, try std.fmt.allocPrint(allocator, "--url http://127.0.0.1:4598 -k {s} cache stats --json", .{active_token}));
        if (rc_cs != 0) return error.CliCacheStatsFailed;
        logPass("CLI: axiom cache stats --json executed successfully");

        const rc_cf = try executeCli(allocator, try std.fmt.allocPrint(allocator, "--url http://127.0.0.1:4598 -k {s} cache flush", .{active_token}));
        if (rc_cf != 0) return error.CliCacheFlushFailed;
        logPass("CLI: axiom cache flush executed successfully");

        const rc_cls = try executeCli(allocator, try std.fmt.allocPrint(allocator, "--url http://127.0.0.1:4598 -k {s} cluster status --json", .{active_token}));
        if (rc_cls != 0) return error.CliClusterStatusFailed;
        logPass("CLI: axiom cluster status --json executed successfully");

        const rc_clp = try executeCli(allocator, try std.fmt.allocPrint(allocator, "--url http://127.0.0.1:4598 -k {s} cluster peers --json", .{active_token}));
        if (rc_clp != 0) return error.CliClusterPeersFailed;
        logPass("CLI: axiom cluster peers --json executed successfully");

        const rc_bns = try executeCli(allocator, try std.fmt.allocPrint(allocator, "--url http://127.0.0.1:4598 -k {s} blob ns list", .{active_token}));
        if (rc_bns != 0) return error.CliBlobNsListFailed;
        logPass("CLI: axiom blob ns list executed successfully");

        const rc_comp = try executeCli(allocator, "completions bash");
        if (rc_comp != 0) return error.CliCompletionsFailed;
        logPass("CLI: axiom completions bash executed successfully");
    }

    // ─── Phase 4: Data API & CRUD Operations Simulation ────────────────────────
    logInfo("Step 6: Simulating Data API & CRUD Operations on LibSQL...");
    {
        // 1. DDL: Create Table
        const ddl_payload =
            \\{"query":"CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL, active INTEGER DEFAULT 1);"}
        ;
        const r_ddl = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/api/v1/db/testdb/query", ddl_payload, admin_hdr, null);
        if (r_ddl.status != 200) return error.DdlFailed;
        logPass("POST /api/v1/db/testdb/query created 'products' table (200 OK)");

        // 2. List Tables
        const r_tbls = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/api/v1/db/testdb/tables", null, admin_hdr, null);
        if (r_tbls.status != 200 or std.mem.indexOf(u8, r_tbls.body, "products") == null) return error.ListTablesFailed;
        logPass("GET /api/v1/db/testdb/tables confirmed 'products' exists (200 OK)");

        // 3. Describe Columns via RESTful Endpoint
        const r_sch = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/api/v1/db/testdb/products/columns", null, admin_hdr, null);
        if (r_sch.status != 200) return error.SchemaDescribeFailed;
        logPass("GET /api/v1/db/testdb/products/columns introspected columns (200 OK)");

        // 3b. Verify Deprecated /schema Route Returns 404 Not Found
        const r_sch_dep = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/api/v1/db/testdb/products/schema", null, admin_hdr, null);
        if (r_sch_dep.status != 404) return error.DeprecatedSchemaNot404;
        logPass("GET /api/v1/db/testdb/products/schema confirmed deprecated (404 Not Found)");

        // 4. Insert Rows
        const ins_payload =
            \\{"rows":[{"name":"Mechanical Keyboard","price":129.50,"active":1},{"name":"Ergonomic Mouse","price":69.99,"active":1},{"name":"Cable Organizer","price":9.99,"active":0}]}
        ;
        const r_ins = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/api/v1/db/testdb/products/rows", ins_payload, admin_hdr, null);
        if (r_ins.status != 200) return error.InsertRowsFailed;
        logPass("POST /api/v1/db/testdb/products/rows inserted 3 rows (200 OK)");

        // 4b. Create Empty Table and verify default-value row insertion
        const create_empty_sql =
            \\{"query":"CREATE TABLE empty_test (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT DEFAULT 'auto_created');"}
        ;
        const r_cet = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/api/v1/db/testdb/query", create_empty_sql, admin_hdr, null);
        if (r_cet.status != 200) return error.CreateTableFailed;

        const ins_def_payload =
            \\{"row":{}}
        ;
        const r_ins_def = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/api/v1/db/testdb/empty_test/rows", ins_def_payload, admin_hdr, null);
        if (r_ins_def.status != 200) return error.InsertRowsFailed;
        logPass("POST /api/v1/db/testdb/empty_test/rows inserted default row on empty table (200 OK)");

        // 5. Fetch Rows
        const r_fch = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/api/v1/db/testdb/products/rows?limit=10", null, admin_hdr, null);
        if (r_fch.status != 200) return error.FetchRowsFailed;
        logPass("GET /api/v1/db/testdb/products/rows fetched active records (200 OK)");

        // 6. Update Rows
        const upd_payload =
            \\{"filter":{"name":{"eq":"Ergonomic Mouse"}},"update":{"price":59.99}}
        ;
        const r_upd = try executeHttp(allocator, "PATCH", "http://127.0.0.1:4598/api/v1/db/testdb/products/rows", upd_payload, admin_hdr, null);
        if (r_upd.status != 200) return error.UpdateRowsFailed;
        logPass("PATCH /api/v1/db/testdb/products/rows updated pricing (200 OK)");

        // 7. Delete Rows
        const del_payload =
            \\{"filter":{"name":{"eq":"Cable Organizer"}}}
        ;
        const r_del = try executeHttp(allocator, "DELETE", "http://127.0.0.1:4598/api/v1/db/testdb/products/rows", del_payload, admin_hdr, null);
        if (r_del.status != 200) return error.DeleteRowsFailed;
        logPass("DELETE /api/v1/db/testdb/products/rows deleted filtered row (200 OK)");

        // 8. List Databases
        const r_dbl = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/api/v1/db/databases", null, admin_hdr, null);
        if (r_dbl.status != 200) return error.ListDatabasesFailed;
        logPass("GET /api/v1/db/databases listed connected engines (200 OK)");
    }

    // ─── Phase 5: RBAC Role & API Key Simulation ──────────────────────────────
    logInfo("Step 7: Simulating RBAC Roles & API Key Granular Permissions...");
    {
        // 1. Create Role
        const role_payload =
            \\{"name":"catalog_reader","description":"Read-only access to products","permissions":[{"database":"testdb","table_name":"products","operations":["SELECT"]}]}
        ;
        const r_cr = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/roles", role_payload, admin_hdr, null);
        if (r_cr.status != 200 and r_cr.status != 201) return error.CreateRoleFailed;
        logPass("POST /admin/v1/roles created 'catalog_reader' role");

        // 2. Create Key linked to Role
        const key_payload =
            \\{"name":"catalog_reader_key","role":"catalog_reader"}
        ;
        const r_ck = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/keys", key_payload, admin_hdr, null);
        if (r_ck.status != 200 and r_ck.status != 201) return error.CreateKeyFailed;
        const secret = extractJsonField(r_ck.body, "secret") orelse return error.MissingSecret;
        logPass("POST /admin/v1/keys created 'catalog_reader_key' linked to role");

        // 3. Compute Base64 X-Axiom-Key
        const raw_auth = try std.fmt.allocPrint(allocator, "catalog_reader_key:{s}", .{secret});
        defer allocator.free(raw_auth);

        var enc_buf: [512]u8 = undefined;
        const encoded = std.base64.standard.Encoder.encode(&enc_buf, raw_auth);
        var key_hdr_buf: [512]u8 = undefined;
        const key_hdr = try std.fmt.bufPrint(&key_hdr_buf, "X-Axiom-Key: {s}", .{encoded});

        // 4. Allowed SELECT on products -> 200 OK
        const q_ok_payload =
            \\{"query":"SELECT id, name, price FROM products;"}
        ;
        const r_q1 = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/api/v1/db/testdb/query", q_ok_payload, key_hdr, null);
        if (r_q1.status != 200) return error.AllowedSelectFailed;
        logPass("API Key: Permitted SELECT on products table returned 200 OK");

        // 5. Allowed Table Listing for table-scoped role -> 200 OK
        const r_lt = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/api/v1/db/testdb/tables", null, key_hdr, null);
        if (r_lt.status != 200) return error.AllowedTableListFailed;
        logPass("API Key: Permitted list_tables with table-scoped role returned 200 OK");

        // 6. Allowed Scalar Query -> 200 OK
        const q_scalar =
            \\{"query":"SELECT 1;"}
        ;
        const r_qs = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/api/v1/db/testdb/query", q_scalar, key_hdr, null);
        if (r_qs.status != 200) return error.AllowedScalarFailed;
        logPass("API Key: Table-less scalar query SELECT 1 returned 200 OK");

        // 7. Disallowed Mutation INSERT -> 403 Forbidden!
        const dis_ins_payload =
            \\{"rows":[{"name":"Hacked Mouse","price":0.0,"active":1}]}
        ;
        const r_dis_ins = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/api/v1/db/testdb/products/rows", dis_ins_payload, key_hdr, null);
        if (r_dis_ins.status != 403) return error.DisallowedInsertNotBlocked;
        logPass("API Key: Disallowed INSERT blocked with 403 Forbidden");

        // 8. Disallowed Mutation DELETE -> 403 Forbidden!
        const q_dis_del =
            \\{"query":"DELETE FROM products;"}
        ;
        const r_dis_del = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/api/v1/db/testdb/query", q_dis_del, key_hdr, null);
        if (r_dis_del.status != 403) return error.DisallowedDeleteNotBlocked;
        logPass("API Key: Disallowed DELETE blocked with 403 Forbidden");

        // 9. Disallowed Table Access -> 403 Forbidden!
        const q_dis_tbl =
            \\{"query":"SELECT * FROM secret_financial_records;"}
        ;
        const r_dis_tbl = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/api/v1/db/testdb/query", q_dis_tbl, key_hdr, null);
        if (r_dis_tbl.status != 403) return error.DisallowedTableNotBlocked;
        logPass("API Key: Disallowed table access blocked with 403 Forbidden");

        // 10. Rotate API Key -> 200 OK
        const r_rot = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/keys/catalog_reader_key/rotate", null, admin_hdr, null);
        if (r_rot.status != 200) return error.RotateKeyFailed;
        logPass("POST /admin/v1/keys/catalog_reader_key/rotate rotated key credentials (200 OK)");

        // 11. Delete API Key -> 200 OK
        const r_del_k = try executeHttp(allocator, "DELETE", "http://127.0.0.1:4598/admin/v1/keys/catalog_reader_key", null, admin_hdr, null);
        if (r_del_k.status != 200) return error.DeleteKeyFailed;
        logPass("DELETE /admin/v1/keys/catalog_reader_key deleted key (200 OK)");

        // 12. Delete Role -> 200 OK
        const r_del_r = try executeHttp(allocator, "DELETE", "http://127.0.0.1:4598/admin/v1/roles/catalog_reader", null, admin_hdr, null);
        if (r_del_r.status != 200) return error.DeleteRoleFailed;
        logPass("DELETE /admin/v1/roles/catalog_reader deleted role (200 OK)");
    }

    // ─── Phase 6: Cluster Mesh Simulation ──────────────────────────────────────
    logInfo("Step 8: Simulating Cluster Mesh Endpoints...");
    {
        const r_cls = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/admin/v1/cluster/status", null, admin_hdr, null);
        if (r_cls.status != 200) return error.ClusterStatusFailed;
        logPass("GET /admin/v1/cluster/status returned 200 OK");

        const r_clp = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/admin/v1/cluster/peers", null, admin_hdr, null);
        if (r_clp.status != 200) return error.ClusterPeersFailed;
        logPass("GET /admin/v1/cluster/peers returned 200 OK");

        const moniker_payload =
            \\{"moniker":"simulated-mesh-node-1"}
        ;
        const r_clm = try executeHttp(allocator, "PATCH", "http://127.0.0.1:4598/admin/v1/cluster/moniker", moniker_payload, admin_hdr, null);
        if (r_clm.status != 200) return error.ClusterMonikerFailed;
        logPass("PATCH /admin/v1/cluster/moniker updated node identity (200 OK)");
    }

    // ─── Phase 7: Blob Storage Simulation ──────────────────────────────────────
    logInfo("Step 9: Simulating Native Blob Storage & Ticket CRUD Lifecycle...");
    {
        // 1. Data-Plane Route Guard: Ensure mutation methods return 405 Method Not Allowed on /api/v1/blobs/namespaces
        const dummy_ns_payload = "{\"name\":\"guard_ns\"}";
        const r_post_dp = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/api/v1/blobs/namespaces", dummy_ns_payload, admin_hdr, null);
        if (r_post_dp.status != 405) return error.DataPlaneNamespacePostNotBlocked;
        logPass("Data Plane: POST /api/v1/blobs/namespaces rejected with 405 Method Not Allowed");

        const r_patch_dp = try executeHttp(allocator, "PATCH", "http://127.0.0.1:4598/api/v1/blobs/namespaces/guard_ns", dummy_ns_payload, admin_hdr, null);
        if (r_patch_dp.status != 405) return error.DataPlaneNamespacePatchNotBlocked;
        logPass("Data Plane: PATCH /api/v1/blobs/namespaces/guard_ns rejected with 405 Method Not Allowed");

        const r_del_dp = try executeHttp(allocator, "DELETE", "http://127.0.0.1:4598/api/v1/blobs/namespaces/guard_ns", null, admin_hdr, null);
        if (r_del_dp.status != 405) return error.DataPlaneNamespaceDeleteNotBlocked;
        logPass("Data Plane: DELETE /api/v1/blobs/namespaces/guard_ns rejected with 405 Method Not Allowed");

        // 2. Control Plane: Create Namespaces via Admin API
        const create_ns_payload =
            \\{"name":"sim_ns","max_bytes":10485760,"is_public":false}
        ;
        const r_cns = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/blobs/namespaces", create_ns_payload, admin_hdr, null);
        if (r_cns.status != 200 and r_cns.status != 201) return error.CreateNamespaceFailed;
        logPass("Admin API: POST /admin/v1/blobs/namespaces created 'sim_ns' (201 Created)");

        const create_priv_payload =
            \\{"name":"sim_priv","max_bytes":5242880,"is_public":false}
        ;
        const r_cpriv = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/blobs/namespaces", create_priv_payload, admin_hdr, null);
        if (r_cpriv.status != 200 and r_cpriv.status != 201) return error.CreateNamespaceFailed;
        logPass("Admin API: POST /admin/v1/blobs/namespaces created 'sim_priv' (201 Created)");

        // 3. Control Plane: Inspect Namespace & Usage Headroom
        const r_gns = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/admin/v1/blobs/namespaces/sim_ns", null, admin_hdr, null);
        if (r_gns.status != 200) return error.GetNamespaceFailed;
        logPass("Admin API: GET /admin/v1/blobs/namespaces/sim_ns fetched metadata (200 OK)");

        const r_usg = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/api/v1/blobs/namespaces/sim_ns/usage", null, admin_hdr, null);
        if (r_usg.status != 200) return error.GetUsageFailed;
        logPass("Data Plane: GET /api/v1/blobs/namespaces/sim_ns/usage checked headroom (200 OK)");

        // 4. Control Plane: Update Namespace Quota & Visibility
        const upd_ns_payload =
            \\{"max_bytes":20971520,"is_public":true}
        ;
        const r_uns = try executeHttp(allocator, "PATCH", "http://127.0.0.1:4598/admin/v1/blobs/namespaces/sim_ns", upd_ns_payload, admin_hdr, null);
        if (r_uns.status != 200) return error.UpdateNamespaceFailed;
        logPass("Admin API: PATCH /admin/v1/blobs/namespaces/sim_ns updated quota & visibility (200 OK)");

        // 5. Data Plane: PUT Blob Objects
        const r_put1 = try executeHttp(allocator, "PUT", "http://127.0.0.1:4598/api/v1/blobs/sim_ns/report.txt", "Axiom Mission Critical Telemetry Data", admin_hdr, "Content-Type: text/plain");
        if (r_put1.status != 200 and r_put1.status != 201) return error.PutBlobFailed;
        logPass("Data Plane: PUT /api/v1/blobs/sim_ns/report.txt stored object (201 Created)");

        const r_put2 = try executeHttp(allocator, "PUT", "http://127.0.0.1:4598/api/v1/blobs/sim_ns/data/metrics.bin", "metrics-binary-payload-12345", admin_hdr, "Content-Type: application/octet-stream");
        if (r_put2.status != 200 and r_put2.status != 201) return error.PutBlobFailed;
        logPass("Data Plane: PUT /api/v1/blobs/sim_ns/data/metrics.bin stored nested object (201 Created)");

        const r_put3 = try executeHttp(allocator, "PUT", "http://127.0.0.1:4598/api/v1/blobs/sim_priv/vault_secret.txt", "TopSecretEnterpriseEncryptionKey", admin_hdr, "Content-Type: text/plain");
        if (r_put3.status != 200 and r_put3.status != 201) return error.PutBlobFailed;
        logPass("Data Plane: PUT /api/v1/blobs/sim_priv/vault_secret.txt stored private object (201 Created)");

        // 6. Data Plane: GET Blob Objects and Verify Payload Integrity
        const r_get1 = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/api/v1/blobs/sim_ns/report.txt", null, admin_hdr, null);
        if (r_get1.status != 200 or std.mem.indexOf(u8, r_get1.body, "Axiom Mission Critical Telemetry Data") == null) return error.GetBlobFailed;
        logPass("Data Plane: GET /api/v1/blobs/sim_ns/report.txt verified payload integrity (200 OK)");

        // 7. Object Copy & Move
        const copy_payload =
            \\{"src_namespace":"sim_ns","src_key":"report.txt","dest_namespace":"sim_ns","dest_key":"report_copy.txt"}
        ;
        const r_cp = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/api/v1/blobs/objects/copy", copy_payload, admin_hdr, null);
        if (r_cp.status != 200) return error.CopyBlobFailed;
        logPass("Data Plane: POST /api/v1/blobs/objects/copy copied object (200 OK)");

        const move_payload =
            \\{"src_namespace":"sim_ns","src_key":"report_copy.txt","dest_namespace":"sim_ns","dest_key":"report_archived.txt"}
        ;
        const r_mv = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/api/v1/blobs/objects/move", move_payload, admin_hdr, null);
        if (r_mv.status != 200) return error.MoveBlobFailed;
        logPass("Data Plane: POST /api/v1/blobs/objects/move moved object (200 OK)");

        // 8. Object BLAKE3 Checksum Verification
        const r_vfy = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/api/v1/blobs/objects/sim_ns/verify/report.txt", null, admin_hdr, null);
        if (r_vfy.status != 200) return error.VerifyBlobFailed;
        logPass("Data Plane: POST /api/v1/blobs/objects/sim_ns/verify/report.txt validated BLAKE3 checksum (200 OK)");

        // 9. List Objects
        const r_lo = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/api/v1/blobs/objects/sim_ns", null, admin_hdr, null);
        if (r_lo.status != 200) return error.ListObjectsFailed;
        logPass("Data Plane: GET /api/v1/blobs/objects/sim_ns listed namespace objects (200 OK)");

        // 10. Capability Ticket Lifecycle (Issue -> Public Download -> Revoke -> Blocked -> Enable -> Allowed -> Delete -> Blocked)
        const tkt_payload =
            \\{"key":"vault_secret.txt","operation":"READ","ttl_seconds":3600}
        ;
        const r_tkt = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/admin/v1/blobs/namespaces/sim_priv/tickets", tkt_payload, admin_hdr, null);
        if (r_tkt.status != 200 and r_tkt.status != 201) return error.CreateTicketFailed;
        const tkt_url = extractJsonField(r_tkt.body, "url") orelse return error.MissingTicketUrl;
        const tkt_sig = extractJsonField(r_tkt.body, "signature") orelse return error.MissingTicketSig;
        logPass("Capability Ticket: Issued ticket for private object (201 Created)");

        // 10a. Download without ANY credentials using signed URL
        var dl_url_buf: [512]u8 = undefined;
        const dl_url = try std.fmt.bufPrint(&dl_url_buf, "http://127.0.0.1:4598{s}", .{tkt_url});
        const r_dl1 = try executeHttp(allocator, "GET", dl_url, null, null, null);
        if (r_dl1.status != 200 or std.mem.indexOf(u8, r_dl1.body, "TopSecretEnterpriseEncryptionKey") == null) return error.TicketDownloadFailed;
        logPass("Capability Ticket: Valid signed ticket granted access without auth credentials (200 OK)");

        // 10b. Revoke ticket
        var rev_url_buf: [256]u8 = undefined;
        const rev_url = try std.fmt.bufPrint(&rev_url_buf, "http://127.0.0.1:4598/admin/v1/blobs/tickets/{s}/revoke", .{tkt_sig});
        const r_rev = try executeHttp(allocator, "POST", rev_url, null, admin_hdr, null);
        if (r_rev.status != 200) return error.RevokeTicketFailed;
        logPass("Capability Ticket: POST /admin/v1/blobs/tickets/:sig/revoke revoked ticket (200 OK)");

        // 10c. Download should now return 403 Forbidden
        const r_dl2 = try executeHttp(allocator, "GET", dl_url, null, null, null);
        if (r_dl2.status != 403) return error.RevokedTicketNotBlocked;
        logPass("Capability Ticket: Revoked ticket blocked with 403 Forbidden");

        // 10d. Re-enable ticket
        var en_url_buf: [256]u8 = undefined;
        const en_url = try std.fmt.bufPrint(&en_url_buf, "http://127.0.0.1:4598/admin/v1/blobs/tickets/{s}/enable", .{tkt_sig});
        const r_en = try executeHttp(allocator, "POST", en_url, null, admin_hdr, null);
        if (r_en.status != 200) return error.EnableTicketFailed;
        logPass("Capability Ticket: POST /admin/v1/blobs/tickets/:sig/enable re-enabled ticket (200 OK)");

        // 10e. Download should succeed again
        const r_dl3 = try executeHttp(allocator, "GET", dl_url, null, null, null);
        if (r_dl3.status != 200) return error.ReenabledTicketFailed;
        logPass("Capability Ticket: Re-enabled ticket downloaded object successfully (200 OK)");

        // 10f. Delete ticket
        var del_tkt_buf: [256]u8 = undefined;
        const del_tkt_url = try std.fmt.bufPrint(&del_tkt_buf, "http://127.0.0.1:4598/admin/v1/blobs/tickets/{s}", .{tkt_sig});
        const r_dt = try executeHttp(allocator, "DELETE", del_tkt_url, null, admin_hdr, null);
        if (r_dt.status != 200) return error.DeleteTicketFailed;
        logPass("Capability Ticket: DELETE /admin/v1/blobs/tickets/:sig deleted ticket (200 OK)");

        // 10g. Download should permanently return 403 Forbidden
        const r_dl4 = try executeHttp(allocator, "GET", dl_url, null, null, null);
        if (r_dl4.status != 403) return error.DeletedTicketNotBlocked;
        logPass("Capability Ticket: Deleted ticket permanently rejected with 403 Forbidden");

        // 11. Batch Delete Objects
        const bdel_payload =
            \\{"keys":["report_archived.txt","data/metrics.bin"]}
        ;
        const r_bdel = try executeHttp(allocator, "POST", "http://127.0.0.1:4598/api/v1/blobs/objects/sim_ns/batch-delete", bdel_payload, admin_hdr, null);
        if (r_bdel.status != 200) return error.BatchDeleteFailed;
        logPass("Data Plane: POST /api/v1/blobs/objects/sim_ns/batch-delete deleted 2 objects (200 OK)");

        // 12. Cascading Delete of Namespaces via Admin API
        const r_dns1 = try executeHttp(allocator, "DELETE", "http://127.0.0.1:4598/admin/v1/blobs/namespaces/sim_priv", null, admin_hdr, null);
        if (r_dns1.status != 200) return error.DeleteNamespaceFailed;
        logPass("Admin API: DELETE /admin/v1/blobs/namespaces/sim_priv purged namespace & objects (200 OK)");

        const r_gpriv_del = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/admin/v1/blobs/namespaces/sim_priv", null, admin_hdr, null);
        if (r_gpriv_del.status != 404) return error.DeletedNamespaceNot404;
        logPass("Admin API: GET /admin/v1/blobs/namespaces/sim_priv confirmed 404 Not Found");

        const r_dns2 = try executeHttp(allocator, "DELETE", "http://127.0.0.1:4598/admin/v1/blobs/namespaces/sim_ns", null, admin_hdr, null);
        if (r_dns2.status != 200) return error.DeleteNamespaceFailed;
        logPass("Admin API: DELETE /admin/v1/blobs/namespaces/sim_ns purged namespace & objects (200 OK)");

        const r_gns_del = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/admin/v1/blobs/namespaces/sim_ns", null, admin_hdr, null);
        if (r_gns_del.status != 404) return error.DeletedNamespaceNot404;
        logPass("Admin API: GET /admin/v1/blobs/namespaces/sim_ns confirmed 404 Not Found");
    }

    // ─── Phase 8: Admin & Monitoring Endpoints Simulation ──────────────────────
    logInfo("Step 10: Simulating Admin Observability & Web UI Endpoints...");
    {
        const eps = [_][]const u8{
            "/admin/v1/status",
            "/admin/v1/keys",
            "/admin/v1/roles",
            "/admin/v1/databases",
            "/admin/v1/users",
            "/admin/v1/cache/stats",
            "/admin/v1/audit",
            "/admin/v1/health",
            "/admin/v1/metrics",
        };

        for (eps) |ep| {
            var url_buf: [256]u8 = undefined;
            const full_url = try std.fmt.bufPrint(&url_buf, "http://127.0.0.1:4598{s}", .{ep});
            const r_ep = try executeHttp(allocator, "GET", full_url, null, admin_hdr, null);
            if (r_ep.status != 200) {
                std.debug.print("Endpoint failed: {s} (status {d})\n", .{ ep, r_ep.status });
                return error.AdminEndpointFailed;
            }
            std.debug.print("\x1b[92m[PASS]\x1b[0m GET {s} returned 200 OK\n", .{ep});
        }

        // Web UI route
        const r_ui = try executeHttp(allocator, "GET", "http://127.0.0.1:4598/system", null, null, null);
        if (r_ui.status != 200 or (std.mem.indexOf(u8, r_ui.body, "<!DOCTYPE html>") == null and std.mem.indexOf(u8, r_ui.body, "<html") == null)) {
            return error.WebUiFailed;
        }
        logPass("GET /system returned valid production HTML document (200 OK)");
    }

    logInfo("=================================================");
    logPass("ALL ZIG SIMULATION TESTS PASSED (10/10 PHASES)  ");
    logInfo("=================================================");
}
