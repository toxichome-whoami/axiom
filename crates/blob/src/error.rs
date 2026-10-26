/*
 * Strongly-typed domain error definitions for native embedded blob storage operations.
 * Owned by: blob
 * Key deps: std::fmt, std::io
 * Invariants: Error messages must never expose raw host filesystem paths to unprivileged callers; disk exhaustion maps cleanly to InsufficientStorage (HTTP 507).
 * Last structural change: Security hardening mapping disk exhaustion to InsufficientStorage.
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
    NotFound { namespace: String, key: String },
    /// Attempted to write to an object key that already exists when overwrite is forbidden.
    AlreadyExists { namespace: String, key: String },
    /// Upload payload exceeded configured size ceiling.
    PayloadTooLarge { size: u64, max: u64 },
    /// Storage quota for the target namespace would be exceeded.
    QuotaExceeded {
        namespace: String,
        current: u64,
        requested: u64,
        max: u64,
    },
    /// BLAKE3 cryptographic checksum mismatch during verification.
    ChecksumMismatch { expected: String, actual: String },
    /// HTTP Range specification was malformed or unsatisfiable.
    InvalidRange(String),
    /// Capability ticket signature or expiration was invalid.
    InvalidTicket(String),
    /// Multipart / chunked upload session was not found or expired.
    UploadSessionNotFound(String),
    /// Upload offset mismatch during resumable upload.
    OffsetMismatch { expected: u64, actual: u64 },
    /// Host filesystem disk space exhausted (ENOSPC / ERROR_DISK_FULL).
    InsufficientStorage(String),
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
            Self::QuotaExceeded {
                namespace,
                current,
                requested,
                max,
            } => {
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
            Self::OffsetMismatch { expected, actual } => write!(
                f,
                "Upload offset mismatch: expected offset {}, but received {}",
                expected, actual
            ),
            Self::InsufficientStorage(msg) => write!(f, "Host storage full: {}", msg),
            Self::Io(msg) => write!(f, "Storage I/O failure: {}", msg),
            Self::Engine(msg) => write!(f, "Storage engine error: {}", msg),
        }
    }
}

impl std::error::Error for BlobError {}

impl From<std::io::Error> for BlobError {
    fn from(err: std::io::Error) -> Self {
        #[cfg(target_os = "windows")]
        let is_disk_full =
            err.raw_os_error() == Some(112) || err.kind() == std::io::ErrorKind::StorageFull;
        #[cfg(not(target_os = "windows"))]
        let is_disk_full =
            err.raw_os_error() == Some(28) || err.kind() == std::io::ErrorKind::StorageFull;

        let msg = err.to_string();
        let is_disk_full_msg = msg.contains("not enough space")
            || msg.contains("No space left")
            || msg.contains("disk full");

        if is_disk_full || is_disk_full_msg {
            Self::InsufficientStorage(msg)
        } else {
            Self::Io(msg)
        }
    }
}

impl From<fjall::Error> for BlobError {
    fn from(err: fjall::Error) -> Self {
        Self::Engine(err.to_string())
    }
}
