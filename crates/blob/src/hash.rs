/*
 * Cryptographic hashing and integrity verification using BLAKE3.
 * Owned by: blob
 * Key deps: blake3
 * Invariants: All digests formatted as standard 64-character lowercase hex strings; verification uses constant-time comparison.
 * Last structural change: Initial implementation of Phase 1 Blob Engine.
 */

/// Incremental streaming hasher for BLAKE3 checksum calculation.
pub struct Blake3StreamHasher {
    hasher: blake3::Hasher,
    bytes_read: u64,
}

impl Blake3StreamHasher {
    /// Creates a fresh BLAKE3 streaming hasher.
    pub fn new() -> Self {
        Self {
            hasher: blake3::Hasher::new(),
            bytes_read: 0,
        }
    }

    /// Appends a chunk of bytes to the running digest state.
    pub fn update(&mut self, chunk: &[u8]) {
        self.hasher.update(chunk);
        self.bytes_read += chunk.len() as u64;
    }

    /// Returns the cumulative byte count processed so far.
    pub fn bytes_read(&self) -> u64 {
        self.bytes_read
    }

    /// Finalizes the digest and produces a 64-character lowercase hexadecimal string.
    pub fn finalize_hex(&self) -> String {
        self.hasher.finalize().to_hex().to_string()
    }
}

impl Default for Blake3StreamHasher {
    fn default() -> Self {
        Self::new()
    }
}

/// Computes the BLAKE3 digest of an in-memory byte slice.
/// CONTRACT:
///  - Returns 64-character lowercase hex string.
///  - Deterministic and pure function.
pub fn hash_bytes(data: &[u8]) -> String {
    blake3::hash(data).to_hex().to_string()
}

/// Constant-time comparison between two cryptographic digest hex strings.
/// CONTRACT:
///  - Precondition: Both strings are hex digests.
///  - Timing attack resistant: avoids early return on mismatch.
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();

    if a_bytes.len() != b_bytes.len() {
        return false;
    }

    let mut result = 0u8;
    for (x, y) in a_bytes.iter().zip(b_bytes.iter()) {
        result |= x ^ y;
    }
    result == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_bytes_properties() {
        let digest1 = hash_bytes(b"hello world");
        let digest2 = hash_bytes(b"hello world");
        assert_eq!(digest1.len(), 64);
        assert_eq!(digest1, digest2);

        let digest3 = hash_bytes(b"hello world!");
        assert_ne!(digest1, digest3);
    }

    #[test]
    fn test_stream_hasher_matches_bulk() {
        let mut stream = Blake3StreamHasher::new();
        stream.update(b"hello ");
        stream.update(b"world");
        assert_eq!(stream.bytes_read(), 11);
        assert_eq!(stream.finalize_hex(), hash_bytes(b"hello world"));
    }

    #[test]
    fn test_constant_time_comparison() {
        let h1 = hash_bytes(b"sample a");
        let h2 = hash_bytes(b"sample a");
        let h3 = hash_bytes(b"sample b");

        assert!(constant_time_eq(&h1, &h2));
        assert!(!constant_time_eq(&h1, &h3));
        assert!(!constant_time_eq(&h1, "short"));
    }
}
