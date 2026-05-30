#![allow(dead_code)]
use uuid::Uuid;

/// Generates a UUID version 7 identifier.
///
/// Format guarantees strict time-ordering which vastly improves database
/// indexing performance over random v4 UUIDs, while preventing collisions.
#[allow(dead_code)]
pub fn uuid7() -> Uuid {
    Uuid::now_v7()
}
