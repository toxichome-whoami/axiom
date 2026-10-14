/*
 * Domain models and data structures for native embedded blob storage metadata.
 * Owned by: blob
 * Key deps: serde
 * Invariants: Timestamps are stored as standard Unix epoch seconds; hashes are standard 64-char BLAKE3 digests.
 * Last structural change: Initial implementation of Phase 1 Blob Engine.
 */

use serde::{Deserialize, Serialize};

/// Metadata attached to an individual object within a namespace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlobMetadata {
    /// 64-character lowercase BLAKE3 cryptographic hash of object content.
    pub hash: String,
    /// Byte length of the content payload.
    pub size: u64,
    /// MIME media type of the payload (default: "application/octet-stream").
    pub content_type: String,
    /// Creation timestamp in Unix seconds.
    pub created_at: i64,
    /// Flag indicating whether payload is stored inline in the LSM keyspace or in the file store.
    pub inline: bool,
    /// Optional expiration timestamp in Unix epoch seconds (TTL).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

/// Concrete byte boundary for HTTP 206 Partial Content slicing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ByteRange {
    /// 0-indexed starting byte offset (inclusive).
    pub start: u64,
    /// 0-indexed ending byte offset (inclusive).
    pub end: u64,
    /// Total byte length of the underlying object.
    pub total: u64,
}

impl ByteRange {
    /// Returns the length in bytes of the slice represented by this range.
    #[inline]
    pub fn length(&self) -> u64 {
        if self.end >= self.start {
            self.end - self.start + 1
        } else {
            0
        }
    }
}

/// Active multipart/chunked upload session metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UploadSession {
    /// Unique identifier for the staged upload session.
    pub upload_id: String,
    /// Target namespace partition.
    pub namespace: String,
    /// Target object key.
    pub key: String,
    /// MIME content type for the final blob.
    pub content_type: String,
    /// Creation timestamp in Unix seconds.
    pub created_at: i64,
    /// Optional expiration timestamp for this upload session.
    pub expires_at: i64,
    /// List of 1-indexed part numbers successfully received.
    pub parts: Vec<u32>,
}

/// Content-addressed reference tracking deduplication and garbage collection lifecycle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContentRef {
    /// Number of active namespace keys pointing to this identical content hash.
    pub refcount: u64,
    /// Byte size of the stored blob.
    pub size: u64,
    /// Initial ingestion timestamp in Unix seconds.
    pub created_at: i64,
}

/// Full object descriptor returned by directory listing queries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlobEntry {
    pub namespace: String,
    pub key: String,
    #[serde(flatten)]
    pub metadata: BlobMetadata,
}

/// Paginated listing result envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListResult {
    pub items: Vec<BlobEntry>,
    pub next_cursor: Option<String>,
}

/// Aggregated system-wide storage engine metrics and deduplication telemetry.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlobStats {
    /// Total count of logical object records across all namespaces.
    pub total_objects: u64,
    /// Total count of distinct physical blobs stored after deduplication.
    pub unique_blobs: u64,
    /// Total logical byte volume referenced by all namespace keys.
    pub total_logical_bytes: u64,
    /// Total physical bytes occupied by distinct stored blobs.
    pub total_physical_bytes: u64,
    /// Net byte savings achieved via content-addressable deduplication.
    pub dedup_saved_bytes: u64,
    /// Count of small objects stored directly within the LSM partition.
    pub inline_objects: u64,
    /// Count of large objects stored as content-addressed files on disk.
    pub file_objects: u64,
}

/// Metadata and quota configuration for an isolated storage partition (namespace bucket).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NamespaceInfo {
    /// Namespace identifier string (1-64 alphanumeric, '.', '_', '-').
    pub name: String,
    /// Unix creation timestamp.
    pub created_at: i64,
    /// Optional hard ceiling on total logical byte consumption (None = unlimited).
    pub max_bytes: Option<u64>,
    /// Total logical object count inside this namespace.
    pub total_objects: u64,
    /// Total logical bytes occupied by objects inside this namespace.
    pub total_bytes: u64,
}
