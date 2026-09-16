const std = @import("std");
const axiom = @import("axiom");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var client = try axiom.AxiomClient.init(
        allocator,
        "http://localhost:4500",
        "admin",
        "YOUR_ADMIN_SECRET_KEY",
    );
    defer client.deinit();

    std.debug.print("Axiom SDK initialized!\nToken generated successfully.\n", .{});
}

