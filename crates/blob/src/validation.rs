/*
 * Input validation invariants for blob namespaces and object keys.
 * Owned by: blob
 * Key deps: crate::error::BlobError
 * Invariants: Path traversal (..), null bytes, and absolute paths are strictly rejected before hitting the index or disk.
 * Last structural change: Initial implementation of Phase 1 Blob Engine.
 */

use crate::error::BlobError;

const MAX_NAMESPACE_LEN: usize = 64;
const MAX_KEY_LEN: usize = 1024;

/// Validates a blob storage namespace identifier.
/// CONTRACT:
///  - Precondition: `namespace` must be non-empty, <= 64 bytes, and contain only [a-zA-Z0-9._-].
///  - Precondition: Cannot be "." or "..".
///  - Returns `Ok(())` on valid identifier, or `BlobError::InvalidNamespace`.
///  - Idempotent: Yes.
pub fn validate_namespace(namespace: &str) -> Result<(), BlobError> {
    if namespace.is_empty() {
        return Err(BlobError::InvalidNamespace(
            "Namespace name cannot be empty".to_string(),
        ));
    }

    if namespace.len() > MAX_NAMESPACE_LEN {
        return Err(BlobError::InvalidNamespace(format!(
            "Namespace exceeds maximum length of {} characters",
            MAX_NAMESPACE_LEN
        )));
    }

    if namespace == "." || namespace == ".." {
        return Err(BlobError::InvalidNamespace(
            "Namespace name cannot be '.' or '..'".to_string(),
        ));
    }

    let is_valid = namespace
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-');

    if !is_valid {
        return Err(BlobError::InvalidNamespace(
            "Namespace name may only contain ASCII alphanumeric characters, '.', '_', or '-'"
                .to_string(),
        ));
    }

    Ok(())
}

/// Validates an object key path against security and sizing invariants.
/// CONTRACT:
///  - Precondition: `key` must be 1..=1024 bytes UTF-8.
///  - Precondition: Must not start with leading slash or backslash.
///  - Precondition: Must not contain NUL byte or directory traversal segments ('..' or '.').
///  - Returns `Ok(())` or `BlobError::InvalidKey`.
///  - Idempotent: Yes.
pub fn validate_key(key: &str) -> Result<(), BlobError> {
    if key.is_empty() {
        return Err(BlobError::InvalidKey("Key cannot be empty".to_string()));
    }

    if key.len() > MAX_KEY_LEN {
        return Err(BlobError::InvalidKey(format!(
            "Key exceeds maximum length of {} characters",
            MAX_KEY_LEN
        )));
    }

    if key.starts_with('/') || key.starts_with('\\') {
        return Err(BlobError::InvalidKey(
            "Key cannot start with leading slash".to_string(),
        ));
    }

    if key.contains('\0') {
        return Err(BlobError::InvalidKey(
            "Key cannot contain null bytes".to_string(),
        ));
    }

    // Inspect individual path segments to prevent directory traversal
    for segment in key.split(['/', '\\']) {
        if segment == ".." {
            return Err(BlobError::InvalidKey(
                "Path traversal ('..') is strictly forbidden in object keys".to_string(),
            ));
        }
        if segment == "." {
            return Err(BlobError::InvalidKey(
                "Relative segment ('.') is not allowed in object keys".to_string(),
            ));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_namespaces() {
        assert!(validate_namespace("default").is_ok());
        assert!(validate_namespace("user-uploads_2026.backup").is_ok());
        assert!(validate_namespace("a").is_ok());
    }

    #[test]
    fn test_invalid_namespaces() {
        assert!(validate_namespace("").is_err());
        assert!(validate_namespace(".").is_err());
        assert!(validate_namespace("..").is_err());
        assert!(validate_namespace("user/uploads").is_err());
        assert!(validate_namespace("ns with spaces").is_err());
        assert!(validate_namespace(&"a".repeat(65)).is_err());
    }

    #[test]
    fn test_valid_keys() {
        assert!(validate_key("documents/reports/q1.pdf").is_ok());
        assert!(validate_key("avatar.png").is_ok());
        assert!(validate_key("a/b/c/d/e.txt").is_ok());
    }

    #[test]
    fn test_invalid_keys() {
        assert!(validate_key("").is_err());
        assert!(validate_key("/leading/slash.txt").is_err());
        assert!(validate_key("\\leading\\slash.txt").is_err());
        assert!(validate_key("path/../traversal.txt").is_err());
        assert!(validate_key("path/./current.txt").is_err());
        assert!(validate_key("..").is_err());
        assert!(validate_key("null\0byte.txt").is_err());
        assert!(validate_key(&"k".repeat(1025)).is_err());
    }
}
