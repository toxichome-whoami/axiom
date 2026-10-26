/*
 * Input validation invariants for blob namespaces and object keys.
 * Owned by: blob
 * Key deps: crate::error::BlobError
 * Invariants: Path traversal (..), null bytes, colon / alternate data streams, and reserved device names are strictly rejected before hitting the index or disk.
 * Last structural change: Security hardening against Windows Alternate Data Streams and device names.
 */

use crate::error::BlobError;

const MAX_NAMESPACE_LEN: usize = 64;
const MAX_KEY_LEN: usize = 1024;

const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Validates a blob storage namespace identifier.
/// CONTRACT:
///  - Precondition: `namespace` must be non-empty, <= 64 bytes, and contain only [a-zA-Z0-9._-].
///  - Precondition: Cannot be "." or "..", or a reserved Windows device name.
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

    if WINDOWS_RESERVED_NAMES
        .iter()
        .any(|&res| res.eq_ignore_ascii_case(namespace))
    {
        return Err(BlobError::InvalidNamespace(format!(
            "Reserved device name '{}' cannot be used as a namespace name",
            namespace
        )));
    }

    Ok(())
}

/// Validates an object key path against security and sizing invariants.
/// CONTRACT:
///  - Precondition: `key` must be 1..=1024 bytes UTF-8.
///  - Precondition: Must not start with leading slash or backslash.
///  - Precondition: Must not contain NUL byte, Alternate Data Streams (':'), empty segments ('//'), or directory traversal ('..' or '.').
///  - Precondition: Segments must not match Windows reserved device names (e.g. CON, AUX, NUL).
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

    // Reject Windows Alternate Data Streams and drive letter colons (SEC-3.2)
    if key.contains(':') {
        return Err(BlobError::InvalidKey(
            "Alternate data streams and drive prefixes (':') are strictly forbidden in object keys".to_string(),
        ));
    }

    // Inspect individual path segments to prevent directory traversal & device file hijacking
    for segment in key.split(['/', '\\']) {
        if segment.is_empty() {
            return Err(BlobError::InvalidKey(
                "Empty path segment ('//') is not allowed in object keys".to_string(),
            ));
        }
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

        // Check Windows reserved device names (stem before extension, e.g. CON, aux.txt, NUL.png)
        let stem = segment.split('.').next().unwrap_or(segment);
        if WINDOWS_RESERVED_NAMES
            .iter()
            .any(|&res| res.eq_ignore_ascii_case(stem))
        {
            return Err(BlobError::InvalidKey(format!(
                "Reserved device name '{}' is strictly forbidden in object keys",
                segment
            )));
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
        assert!(validate_namespace("CON").is_err());
        assert!(validate_namespace("aux").is_err());
        assert!(validate_namespace("NUL").is_err());
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
        assert!(validate_key("file.txt::$DATA").is_err());
        assert!(validate_key("C:/Windows/System32").is_err());
        assert!(validate_key("CON").is_err());
        assert!(validate_key("documents/aux.txt").is_err());
        assert!(validate_key("uploads//file.txt").is_err());
    }
}
