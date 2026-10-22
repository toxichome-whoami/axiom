/*
 * Chronologically monotonic UUID generation utility (UUID v7).
 * Owned by: core
 * Key deps: uuid
 * Invariants: UUID v7 guarantees chronological monotonicity for DB indexing.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use uuid::Uuid;

/// Generates a RFC 9562 chronologically monotonic UUID version 7 string.
/// CONTRACT:
///  - Time-ordered: High-order 48 bits encode Unix epoch millisecond timestamp.
///  - Monotonicity: Sequential values within the same millisecond increment sub-field entropy.
///  - Index-friendly: Minimizes B-tree index fragmentation in database primary keys compared to random UUIDv4.
///  - Returns: 36-character hyphenated UUID string.
///  - Side effects: Reads system clock and secure system entropy.
pub fn uuid7() -> String {
    Uuid::now_v7().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_uuid7_valid_format_and_version() {
        let id_str = uuid7();
        let parsed = Uuid::parse_str(&id_str).expect("uuid7 should produce valid UUID string");
        assert_eq!(parsed.get_version_num(), 7, "UUID version must be 7");
    }

    #[test]
    fn test_uuid7_uniqueness() {
        let id1 = uuid7();
        let id2 = uuid7();
        assert_ne!(
            id1, id2,
            "consecutive uuid7 calls must produce distinct identifiers"
        );
    }
}
