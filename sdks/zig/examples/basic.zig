const std = @import("std");
const axiom = @import("axiom");

pub fn main() !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var client = try axiom.AxiomClient.init(
        allocator,
        "http://localhost:4500",
        "admin",
        "YOUR_ADMIN_SECRET_KEY",
    );
    defer client.deinit();

    // List databases
    const dbs = try client.listDatabases();
    defer allocator.free(dbs);
    std.debug.print("Databases: {s}\n", .{dbs});

    // Fetch rows with cursor pagination
    const rows = try client.fetchRows("local_pg", "users", axiom.FetchRowsParams{
        .limit = 10,
        .sort = "id",
        .order = "asc",
    });
    defer allocator.free(rows);
    std.debug.print("Rows: {s}\n", .{rows});

    // Insert a row
    const insert_result = try client.insertRows(
        "local_pg",
        "users",
        \\[{"name": "Alice", "email": "alice@example.com"}]
    );
    defer allocator.free(insert_result);
    std.debug.print("Insert: {s}\n", .{insert_result});

    // Execute raw query
    const query_result = try client.query(
        "local_pg",
        \\{"sql": "SELECT 1 as connected"}
    );
    defer allocator.free(query_result);
    std.debug.print("Query: {s}\n", .{query_result});
}
