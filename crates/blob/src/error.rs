/*
 * Strongly-typed domain error definitions for native embedded blob storage operations.
 * Owned by: blob
 * Key deps: std::fmt, std::io
 * Invariants: Error messages must never expose raw host filesystem paths to unprivileged callers.
 * Last structural change: Initial implementation of Phase 1 Blob Engine.
 */

use std::fmt;

#[derive(Debug)]
pub enum BlobError {
    /// Namespace identifier failed validation invariants (e.g. invalid characters or length).
    InvalidNamespace(String),
    /// Object key violated security or structural rules (e.g. path traversal, NUL byte, empty).
    InvalidKey(String),
    /// The specified namespace does not exist.
    NamespaceNotFound(String),
    /// The requested blob was not found within the designated namespace.
    NotFound {
        namespace: String,
        key: String,
    },
    /// Attempted to write to an object key that already exists when overwrite is forbidden.
    AlreadyExists {
        namespace: String,
        key: String,
    },
    /// Upload payload exceeded configured size ceiling.
    PayloadTooLarge {
        size: u64,
        max: u64,
    },
    /// Storage quota for the target namespace would be exceeded.
    QuotaExceeded {
        namespace: String,
        current: u64,
        requested: u64,
        max: u64,
    },
    /// BLAKE3 cryptographic checksum mismatch during verification.
    ChecksumMismatch {
        expected: String,
        actual: String,
    },
    /// HTTP Range specification was malformed or unsatisfiable.
    InvalidRange(String),
    /// Capability ticket signature or expiration was invalid.
    InvalidTicket(String),
    /// Multipart / chunked upload session was not found or expired.
    UploadSessionNotFound(String),
    /// Host filesystem input/output failure.
    Io(String),
    /// Underlying LSM database or indexing failure.
    Engine(String),
}

impl fmt::Display for BlobError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidNamespace(msg) => write!(f, "Invalid namespace: {}", msg),
            Self::InvalidKey(msg) => write!(f, "Invalid blob key: {}", msg),
            Self::NamespaceNotFound(ns) => write!(f, "Namespace '{}' not found", ns),
            Self::NotFound { namespace, key } => {
                write!(f, "Blob '{}/{}' not found", namespace, key)
            }
            Self::AlreadyExists { namespace, key } => {
                write!(f, "Blob '{}/{}' already exists", namespace, key)
            }
            Self::PayloadTooLarge { size, max } => {
                write!(f, "Payload size {} exceeds limit of {} bytes", size, max)
            }
            Self::QuotaExceeded { namespace, current, requested, max } => {
                write!(
                    f,
                    "Namespace '{}' quota exceeded: current {} B + payload {} B exceeds limit of {} B",
                    namespace, current, requested, max
                )
            }
            Self::ChecksumMismatch { expected, actual } => write!(
                f,
                "Integrity failure: expected checksum {}, calculated {}",
                expected, actual
            ),
            Self::InvalidRange(msg) => write!(f, "Invalid range: {}", msg),
            Self::InvalidTicket(msg) => write!(f, "Invalid capability ticket: {}", msg),
            Self::UploadSessionNotFound(id) => write!(f, "Upload session '{}' not found", id),
            Self::Io(msg) => write!(f, "Storage I/O failure: {}", msg),
            Self::Engine(msg) => write!(f, "Storage engine error: {}", msg),
        }
    }
}

impl std::error::Error for BlobError {}

impl From<std::io::Error> for BlobError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err.to_string())
    }
}

impl From<fjall::Error> for BlobError {
    fn from(err: fjall::Error) -> Self {
        Self::Engine(err.to_string())
    }
}
