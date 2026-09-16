const std = @import("std");
const base64 = std.base64;

pub const FetchRowsParams = struct {
    limit: ?usize = null,
    cursor: ?[]const u8 = null,
    sort: ?[]const u8 = null,
    order: ?[]const u8 = null,
    filter: ?[]const u8 = null, // JSON string, e.g. "{\"active\":true}"
    fields: ?[]const u8 = null,
};

pub const AxiomClient = struct {
    allocator: std.mem.Allocator,
    base_url: []const u8,
    token: []u8,

    pub fn init(
        allocator: std.mem.Allocator,
        base_url: []const u8,
        key_name: []const u8,
        key_secret: []const u8,
    ) !AxiomClient {
        // Build "key_name:key_secret" and base64-encode it
        const auth_str = try std.fmt.allocPrint(allocator, "{s}:{s}", .{ key_name, key_secret });
        defer allocator.free(auth_str);

        const encoder = base64.standard.Encoder;
        const token_len = encoder.calcSize(auth_str.len);
        const token = try allocator.alloc(u8, token_len);
        _ = encoder.encode(token, auth_str);

        const trimmed = if (std.mem.endsWith(u8, base_url, "/")) base_url[0 .. base_url.len - 1] else base_url;

        return AxiomClient{
            .allocator = allocator,
            .base_url = try allocator.dupe(u8, trimmed),
            .token = token,
        };
    }

    pub fn deinit(self: *AxiomClient) void {
        self.allocator.free(self.base_url);
        self.allocator.free(self.token);
    }

    /// Sends an HTTP request and returns the response body as an allocated []u8.
    /// Caller must free the returned slice.
    pub fn request(
        self: *AxiomClient,
        method: std.http.Method,
        endpoint: []const u8,
        payload: ?[]const u8,
    ) ![]u8 {
        var client = std.http.Client{ .allocator = self.allocator };
        defer client.deinit();

        // Build full URL
        const full_url = try std.fmt.allocPrint(self.allocator, "{s}{s}", .{ self.base_url, endpoint });
        defer self.allocator.free(full_url);

        const uri = try std.Uri.parse(full_url);

        // Build auth header value: "X-Axiom-Key: <token>"
        const auth_header_value = try std.fmt.allocPrint(self.allocator, "{s}", .{self.token});
        defer self.allocator.free(auth_header_value);

        // Extra headers
        const extra_headers = [_]std.http.Header{
            .{ .name = "X-Axiom-Key", .value = auth_header_value },
            .{ .name = "Content-Type", .value = "application/json" },
        };

        // Server header buffer
        var header_buf: [8192]u8 = undefined;

        var req = try client.open(method, uri, .{
            .server_header_buffer = &header_buf,
            .extra_headers = &extra_headers,
        });
        defer req.deinit();

        // Set content-length and send headers
        if (payload) |body| {
            req.transfer_encoding = .{ .content_length = body.len };
            try req.send();
            try req.writeAll(body);
        } else {
            req.transfer_encoding = .{ .content_length = 0 };
            try req.send();
        }
        try req.finish();
        try req.wait();

        // Read response body
        var body_list = std.ArrayList(u8).init(self.allocator);
        errdefer body_list.deinit();
        try req.reader().readAllArrayList(&body_list, 10 * 1024 * 1024); // 10MB max

        return body_list.toOwnedSlice();
    }

    // ─── API Methods ──────────────────────────────────────────────────────────

    /// List all databases. Returns JSON bytes — caller must free.
    pub fn listDatabases(self: *AxiomClient) ![]u8 {
        return self.request(.GET, "/api/v1/db/databases", null);
    }

    /// List all tables in a database. Returns JSON bytes — caller must free.
    pub fn listTables(self: *AxiomClient, db: []const u8) ![]u8 {
        const endpoint = try std.fmt.allocPrint(self.allocator, "/api/v1/db/{s}/tables", .{db});
        defer self.allocator.free(endpoint);
        return self.request(.GET, endpoint, null);
    }

    pub fn describeTable(self: *AxiomClient, db: []const u8, table: []const u8) ![]u8 {
        const endpoint = try std.fmt.allocPrint(self.allocator, "/api/v1/db/{s}/{s}/schema", .{ db, table });
        defer self.allocator.free(endpoint);
        return self.request(.GET, endpoint, null);
    }

    /// Fetch rows with optional cursor pagination. Returns JSON bytes — caller must free.
    pub fn fetchRows(self: *AxiomClient, db: []const u8, table: []const u8, params: ?FetchRowsParams) ![]u8 {
        var qs = std.ArrayList(u8).init(self.allocator);
        defer qs.deinit();

        if (params) |p| {
            var first = true;

            if (p.limit) |limit| {
                try qs.writer().print("{s}limit={d}", .{ if (first) "?" else "&", limit });
                first = false;
            }
            if (p.cursor) |cursor| {
                try qs.writer().print("{s}cursor={s}", .{ if (first) "?" else "&", cursor });
                first = false;
            }
            if (p.sort) |sort| {
                try qs.writer().print("{s}sort={s}", .{ if (first) "?" else "&", sort });
                first = false;
            }
            if (p.order) |order| {
                try qs.writer().print("{s}order={s}", .{ if (first) "?" else "&", order });
                first = false;
            }
            if (p.filter) |f| {
                // Caller is responsible for passing a valid JSON string
                try qs.writer().print("{s}filter={s}", .{ if (first) "?" else "&", f });
                first = false;
            }
            if (p.fields) |fields| {
                try qs.writer().print("{s}fields={s}", .{ if (first) "?" else "&", fields });
            }
        }

        const endpoint = try std.fmt.allocPrint(
            self.allocator,
            "/api/v1/db/{s}/{s}/rows{s}",
            .{ db, table, qs.items },
        );
        defer self.allocator.free(endpoint);
        return self.request(.GET, endpoint, null);
    }

    /// Insert rows. `json_payload` must be a JSON array string. Returns JSON bytes — caller must free.
    pub fn insertRows(self: *AxiomClient, db: []const u8, table: []const u8, json_payload: []const u8) ![]u8 {
        const endpoint = try std.fmt.allocPrint(self.allocator, "/api/v1/db/{s}/{s}/rows", .{ db, table });
        defer self.allocator.free(endpoint);
        return self.request(.POST, endpoint, json_payload);
    }

    /// Update rows. `json_payload` must be `{"filter":{...},"update":{...}}`. Returns JSON bytes — caller must free.
    pub fn updateRows(self: *AxiomClient, db: []const u8, table: []const u8, json_payload: []const u8) ![]u8 {
        const endpoint = try std.fmt.allocPrint(self.allocator, "/api/v1/db/{s}/{s}/rows", .{ db, table });
        defer self.allocator.free(endpoint);
        return self.request(.PATCH, endpoint, json_payload);
    }

    /// Delete rows. `json_payload` must be a JSON object of filter conditions. Returns JSON bytes — caller must free.
    pub fn deleteRows(self: *AxiomClient, db: []const u8, table: []const u8, json_payload: []const u8) ![]u8 {
        const endpoint = try std.fmt.allocPrint(self.allocator, "/api/v1/db/{s}/{s}/rows", .{ db, table });
        defer self.allocator.free(endpoint);
        return self.request(.DELETE, endpoint, json_payload);
    }

    /// Execute a raw SQL query. `json_payload` must be `{"sql":"...","params":{...}}`. Returns JSON bytes — caller must free.
    pub fn query(self: *AxiomClient, db: []const u8, json_payload: []const u8) ![]u8 {
        const endpoint = try std.fmt.allocPrint(self.allocator, "/api/v1/db/{s}/query", .{db});
        defer self.allocator.free(endpoint);
        return self.request(.POST, endpoint, json_payload);
    }
};
