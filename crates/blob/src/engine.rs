/*
 * Unified Blob Engine facade coordinating metadata indexing, inline storage, and file storage.
 * Owned by: blob
 * Key deps: crate::index::BlobIndex, crate::store::FileStore, crate::hash, crate::validation
 * Invariants: Validation occurs first; content hash governs deduplication; metadata commits after storage write.
 * Last structural change: Initial implementation of Phase 1 Blob Engine.
 */

use crate::error::BlobError;
use crate::hash::{constant_time_eq, hash_bytes};
use crate::index::BlobIndex;
use crate::models::{BlobMetadata, BlobStats, ListResult, NamespaceInfo};
use crate::store::FileStore;
use crate::validation::{validate_key, validate_namespace};
use bytes::Bytes;
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// Retrieved blob payload content representation.
pub enum BlobData {
    /// Small object stored directly in memory from the LSM index partition.
    Inline(Bytes),
    /// Large object streamed from an asynchronous disk file handle along with its length.
    File(tokio::fs::File, u64),
}

/// Native embedded blob storage engine.
pub struct BlobEngine {
    index: Arc<BlobIndex>,
    store: Arc<FileStore>,
    inline_max_bytes: u64,
    max_object_bytes: u64,
    verify_reads: bool,
}

impl BlobEngine {
    /// Initializes a new BlobEngine instance rooted in `base_dir`.
    /// CONTRACT:
    ///  - Precondition: `base_dir` must be writable.
    ///  - Side effects: Initializes Fjall LSM in `<base_dir>/index` and FileStore in `<base_dir>`.
    ///  - Idempotent: Yes.
    pub async fn new<P: AsRef<Path>>(
        base_dir: P,
        inline_max_bytes: u64,
        max_object_bytes: u64,
        verify_reads: bool,
    ) -> Result<Self, BlobError> {
        let base = base_dir.as_ref();
        let index_dir = base.join("index");
        tokio::fs::create_dir_all(&index_dir).await?;

        let index = Arc::new(BlobIndex::open(&index_dir)?);
        let store = Arc::new(FileStore::new(base).await?);

        Ok(Self {
            index,
            store,
            inline_max_bytes,
            max_object_bytes,
            verify_reads,
        })
    }

    /// Stores a binary payload under the specified namespace and key.
    /// CONTRACT:
    ///  - Validates namespace and key.
    ///  - Computes BLAKE3 cryptographic hash.
    ///  - Checks inline vs large payload threshold:
    ///    - Small (<= inline_max): stored directly in LSM index.
    ///    - Large (> inline_max): written to content-addressed file store with fsync.
    ///  - Atomically records metadata and updates refcounts.
    ///  - Idempotent on identical data.
    pub async fn put(
        &self,
        namespace: &str,
        key: &str,
        content_type: Option<&str>,
        data: &[u8],
    ) -> Result<BlobMetadata, BlobError> {
        validate_namespace(namespace)?;
        validate_key(key)?;

        let size = data.len() as u64;
        if size > self.max_object_bytes {
            return Err(BlobError::PayloadTooLarge {
                size,
                max: self.max_object_bytes,
            });
        }

        // Enforce namespace storage quota ceiling if configured
        if let Some(info) = self.index.get_namespace_info(namespace)? {
            if let Some(max_quota) = info.max_bytes {
                let existing_size = self.index.get_metadata(namespace, key)?.map(|m| m.size).unwrap_or(0);
                let net_bytes = info.total_bytes.saturating_sub(existing_size);
                if net_bytes + size > max_quota {
                    return Err(BlobError::QuotaExceeded {
                        namespace: namespace.to_string(),
                        current: net_bytes,
                        requested: size,
                        max: max_quota,
                    });
                }
            }
        }

        let hash = hash_bytes(data);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let is_inline = size <= self.inline_max_bytes;

        if is_inline {
            self.index.put_inline_payload(&hash, data)?;
        } else {
            self.store.write_bytes(&hash, data).await?;
        }

        let meta = BlobMetadata {
            hash: hash.clone(),
            size,
            content_type: content_type.unwrap_or("application/octet-stream").to_string(),
            created_at: now,
            inline: is_inline,
        };

        self.index.commit_put(namespace, key, &meta)?;
        Ok(meta)
    }

    /// Retrieves an object's metadata and data stream.
    /// CONTRACT:
    ///  - Precondition: `namespace` and `key` must be valid.
    ///  - Returns `BlobError::NotFound` if missing.
    ///  - If `verify_reads` is enabled, validates BLAKE3 hash for inline payload before returning.
    pub async fn get(&self, namespace: &str, key: &str) -> Result<(BlobMetadata, BlobData), BlobError> {
        validate_namespace(namespace)?;
        validate_key(key)?;

        let meta = self
            .index
            .get_metadata(namespace, key)?
            .ok_or_else(|| BlobError::NotFound {
                namespace: namespace.to_string(),
                key: key.to_string(),
            })?;

        if meta.inline {
            let bytes_vec = self
                .index
                .get_inline_payload(&meta.hash)?
                .ok_or_else(|| BlobError::NotFound {
                    namespace: namespace.to_string(),
                    key: key.to_string(),
                })?;

            if self.verify_reads {
                let actual = hash_bytes(&bytes_vec);
                if !constant_time_eq(&actual, &meta.hash) {
                    return Err(BlobError::ChecksumMismatch {
                        expected: meta.hash,
                        actual,
                    });
                }
            }

            Ok((meta, BlobData::Inline(Bytes::from(bytes_vec))))
        } else {
            let file = self.store.open(&meta.hash).await?;
            Ok((meta.clone(), BlobData::File(file, meta.size)))
        }
    }

    /// Reads an entire object into memory.
    pub async fn get_bytes(&self, namespace: &str, key: &str) -> Result<(BlobMetadata, Vec<u8>), BlobError> {
        let (meta, data) = self.get(namespace, key).await?;
        match data {
            BlobData::Inline(bytes) => Ok((meta, bytes.to_vec())),
            BlobData::File(_, _) => {
                let file_bytes = self.store.read_bytes(&meta.hash).await?;
                if self.verify_reads {
                    let actual = hash_bytes(&file_bytes);
                    if !constant_time_eq(&actual, &meta.hash) {
                        return Err(BlobError::ChecksumMismatch {
                            expected: meta.hash,
                            actual,
                        });
                    }
                }
                Ok((meta, file_bytes))
            }
        }
    }

    /// Retrieves metadata only for an object key.
    pub fn head(&self, namespace: &str, key: &str) -> Result<BlobMetadata, BlobError> {
        validate_namespace(namespace)?;
        validate_key(key)?;

        self.index
            .get_metadata(namespace, key)?
            .ok_or_else(|| BlobError::NotFound {
                namespace: namespace.to_string(),
                key: key.to_string(),
            })
    }

    /// Deletes an object key from the specified namespace.
    /// CONTRACT:
    ///  - If the refcount reaches zero, cleans up underlying storage (inline LSM or file).
    ///  - Returns `true` if key existed and was deleted, `false` otherwise.
    pub async fn delete(&self, namespace: &str, key: &str) -> Result<bool, BlobError> {
        validate_namespace(namespace)?;
        validate_key(key)?;

        let (meta_opt, should_delete_physical) = self.index.commit_delete(namespace, key)?;
        if let Some(meta) = meta_opt {
            if should_delete_physical && !meta.inline {
                let _ = self.store.remove(&meta.hash).await;
            }
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Lists object keys in a namespace matching an optional prefix.
    pub fn list(
        &self,
        namespace: &str,
        prefix: Option<&str>,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<ListResult, BlobError> {
        validate_namespace(namespace)?;
        let (items, next_cursor) = self.index.list(namespace, prefix, cursor, limit)?;
        Ok(ListResult { items, next_cursor })
    }

    /// Explicitly verifies cryptographic integrity of an object against its recorded BLAKE3 hash.
    pub async fn verify_integrity(&self, namespace: &str, key: &str) -> Result<bool, BlobError> {
        let (meta, bytes) = self.get_bytes(namespace, key).await?;
        let computed = hash_bytes(&bytes);
        Ok(constant_time_eq(&computed, &meta.hash))
    }

    /// Computes aggregated metrics and deduplication stats.
    pub fn stats(&self) -> Result<BlobStats, BlobError> {
        self.index.compute_stats()
    }

    /// Lists all distinct namespaces containing stored objects.
    pub fn list_namespaces(&self) -> Result<Vec<String>, BlobError> {
        self.index.list_namespaces()
    }

    /// Registers a new namespace with an optional quota limit.
    pub fn create_namespace(&self, name: &str, max_bytes: Option<u64>) -> Result<NamespaceInfo, BlobError> {
        validate_namespace(name)?;
        self.index.create_namespace(name, max_bytes)
    }

    /// Retrieves detailed info and live metrics for a single namespace.
    pub fn get_namespace(&self, name: &str) -> Result<Option<NamespaceInfo>, BlobError> {
        validate_namespace(name)?;
        self.index.get_namespace_info(name)
    }

    /// Lists all namespaces with their metadata and storage usage metrics.
    pub fn list_namespaces_info(&self) -> Result<Vec<NamespaceInfo>, BlobError> {
        self.index.list_namespaces_info()
    }

    /// Updates quota or renames a namespace.
    pub fn update_namespace(
        &self,
        name: &str,
        new_name: Option<&str>,
        max_bytes: Option<Option<u64>>,
    ) -> Result<NamespaceInfo, BlobError> {
        validate_namespace(name)?;
        if let Some(nn) = new_name {
            validate_namespace(nn)?;
        }
        self.index.update_namespace(name, new_name, max_bytes)
    }

    /// Duplicates an existing object into a target key/namespace at zero physical I/O cost (content-addressed refcount increment).
    /// CONTRACT:
    ///  - Precondition: Source object must exist.
    ///  - Precondition: Target namespace must have sufficient quota headroom.
    ///  - Side effects: Increments BLAKE3 hash refcount; writes new metadata record.
    pub async fn copy_blob(
        &self,
        src_ns: &str,
        src_key: &str,
        dest_ns: &str,
        dest_key: &str,
    ) -> Result<BlobMetadata, BlobError> {
        validate_namespace(src_ns)?;
        validate_key(src_key)?;
        validate_namespace(dest_ns)?;
        validate_key(dest_key)?;

        let src_meta = self.index.get_metadata(src_ns, src_key)?.ok_or_else(|| {
            BlobError::NotFound {
                namespace: src_ns.to_string(),
                key: src_key.to_string(),
            }
        })?;

        // Enforce destination quota ceiling
        if let Some(info) = self.index.get_namespace_info(dest_ns)? {
            if let Some(max_quota) = info.max_bytes {
                let existing_size = self
                    .index
                    .get_metadata(dest_ns, dest_key)?
                    .map(|m| m.size)
                    .unwrap_or(0);
                let net_bytes = info.total_bytes.saturating_sub(existing_size);
                if net_bytes + src_meta.size > max_quota {
                    return Err(BlobError::QuotaExceeded {
                        namespace: dest_ns.to_string(),
                        current: net_bytes,
                        requested: src_meta.size,
                        max: max_quota,
                    });
                }
            }
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let dest_meta = BlobMetadata {
            hash: src_meta.hash.clone(),
            size: src_meta.size,
            content_type: src_meta.content_type.clone(),
            created_at: now,
            inline: src_meta.inline,
        };

        self.index.commit_put(dest_ns, dest_key, &dest_meta)?;
        Ok(dest_meta)
    }

    /// Moves or renames an existing object to a target key or namespace.
    /// CONTRACT:
    ///  - Precondition: Source object must exist.
    ///  - Side effects: Performs zero-cost copy then deletes source key.
    pub async fn move_blob(
        &self,
        src_ns: &str,
        src_key: &str,
        dest_ns: &str,
        dest_key: &str,
    ) -> Result<BlobMetadata, BlobError> {
        if src_ns == dest_ns && src_key == dest_key {
            return self.head(src_ns, src_key);
        }
        let meta = self.copy_blob(src_ns, src_key, dest_ns, dest_key).await?;
        let _ = self.delete(src_ns, src_key).await?;
        Ok(meta)
    }

    /// Recursively copies all objects matching a prefix into a destination prefix.
    pub async fn copy_prefix(
        &self,
        src_ns: &str,
        src_prefix: &str,
        dest_ns: &str,
        dest_prefix: &str,
    ) -> Result<u64, BlobError> {
        validate_namespace(src_ns)?;
        validate_namespace(dest_ns)?;
        let (items, _) = self.index.list(src_ns, Some(src_prefix), None, 100_000)?;
        let mut count = 0u64;
        for entry in items {
            let rel = &entry.key[src_prefix.len()..];
            let new_key = format!("{}{}", dest_prefix, rel);
            self.copy_blob(src_ns, &entry.key, dest_ns, &new_key).await?;
            count += 1;
        }
        Ok(count)
    }

    /// Recursively moves all objects matching a prefix into a destination prefix.
    pub async fn move_prefix(
        &self,
        src_ns: &str,
        src_prefix: &str,
        dest_ns: &str,
        dest_prefix: &str,
    ) -> Result<u64, BlobError> {
        validate_namespace(src_ns)?;
        validate_namespace(dest_ns)?;
        let (items, _) = self.index.list(src_ns, Some(src_prefix), None, 100_000)?;
        let mut count = 0u64;
        for entry in items {
            let rel = &entry.key[src_prefix.len()..];
            let new_key = format!("{}{}", dest_prefix, rel);
            self.move_blob(src_ns, &entry.key, dest_ns, &new_key).await?;
            count += 1;
        }
        Ok(count)
    }

    /// Recursively deletes all objects matching a prefix.
    pub async fn delete_prefix(&self, ns: &str, prefix: &str) -> Result<u64, BlobError> {
        validate_namespace(ns)?;
        let (items, _) = self.index.list(ns, Some(prefix), None, 100_000)?;
        let mut count = 0u64;
        for entry in items {
            if self.delete(ns, &entry.key).await? {
                count += 1;
            }
        }
        Ok(count)
    }

    /// Deletes a namespace and purges all objects inside it.
    pub async fn delete_namespace(&self, namespace: &str) -> Result<u64, BlobError> {
        validate_namespace(namespace)?;
        let (items, _) = self.index.list(namespace, None, None, 100_000)?;
        let mut deleted_count = 0u64;
        for entry in items {
            if self.delete(namespace, &entry.key).await? {
                deleted_count += 1;
            }
        }
        self.index.remove_namespace_record(namespace)?;
        Ok(deleted_count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_blob_engine_inline_and_large_flow() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = BlobEngine::new(tmp.path(), 64, 1024 * 1024, true)
            .await
            .unwrap();

        let ns = "test-ns";

        // 1. Small inline object (<= 64 bytes)
        let small_data = b"small inline payload";
        let meta1 = engine.put(ns, "small.txt", Some("text/plain"), small_data).await.unwrap();
        assert!(meta1.inline);
        assert_eq!(meta1.size, small_data.len() as u64);

        let (read_meta1, read_bytes1) = engine.get_bytes(ns, "small.txt").await.unwrap();
        assert_eq!(read_meta1.hash, meta1.hash);
        assert_eq!(&read_bytes1[..], small_data);

        // 2. Large object (> 64 bytes)
        let large_data = vec![42u8; 256];
        let meta2 = engine.put(ns, "large.bin", Some("application/octet-stream"), &large_data).await.unwrap();
        assert!(!meta2.inline);
        assert_eq!(meta2.size, 256);

        let (read_meta2, read_bytes2) = engine.get_bytes(ns, "large.bin").await.unwrap();
        assert_eq!(read_meta2.hash, meta2.hash);
        assert_eq!(read_bytes2, large_data);

        // 3. Deduplication check: storing identical large data under a second key
        let meta3 = engine.put(ns, "copy_large.bin", None, &large_data).await.unwrap();
        assert_eq!(meta3.hash, meta2.hash);

        let stats = engine.stats().unwrap();
        assert_eq!(stats.total_objects, 3);
        assert_eq!(stats.unique_blobs, 2);
        assert_eq!(stats.dedup_saved_bytes, 256); // 1 duplicate large object saved 256 bytes

        // 4. Verify integrity
        assert!(engine.verify_integrity(ns, "large.bin").await.unwrap());

        // 5. List items
        let list = engine.list(ns, None, None, 10).unwrap();
        assert_eq!(list.items.len(), 3);

        // 6. Delete first large copy (underlying file should still exist for second key)
        assert!(engine.delete(ns, "large.bin").await.unwrap());
        let (_, still_there) = engine.get_bytes(ns, "copy_large.bin").await.unwrap();
        assert_eq!(still_there, large_data);

        // 7. Delete second large copy (now physical file is deleted)
        assert!(engine.delete(ns, "copy_large.bin").await.unwrap());
        assert!(engine.get(ns, "copy_large.bin").await.is_err());
    }

    #[tokio::test]
    async fn test_blob_engine_filesystem_operations() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = BlobEngine::new(tmp.path(), 64, 1024 * 1024, true)
            .await
            .unwrap();

        let ns = "fs-test";

        // 1. Put initial files in virtual directory
        engine.put(ns, "docs/readme.txt", Some("text/plain"), b"hello world").await.unwrap();
        engine.put(ns, "docs/spec.pdf", Some("application/pdf"), b"pdf content").await.unwrap();

        // 2. Copy blob
        let copied = engine.copy_blob(ns, "docs/readme.txt", ns, "docs/readme_copy.txt").await.unwrap();
        assert_eq!(copied.size, 11);
        let (_, copy_bytes) = engine.get_bytes(ns, "docs/readme_copy.txt").await.unwrap();
        assert_eq!(&copy_bytes[..], b"hello world");

        // 3. Move blob (rename)
        let moved = engine.move_blob(ns, "docs/readme_copy.txt", ns, "docs/readme_renamed.txt").await.unwrap();
        assert_eq!(moved.size, 11);
        assert!(engine.get(ns, "docs/readme_copy.txt").await.is_err());
        assert!(engine.get(ns, "docs/readme_renamed.txt").await.is_ok());

        // 4. Copy prefix (folder copy)
        let copied_count = engine.copy_prefix(ns, "docs/", ns, "backup/docs/").await.unwrap();
        assert_eq!(copied_count, 3);
        assert!(engine.get(ns, "backup/docs/readme.txt").await.is_ok());
        assert!(engine.get(ns, "backup/docs/spec.pdf").await.is_ok());
        assert!(engine.get(ns, "backup/docs/readme_renamed.txt").await.is_ok());

        // 5. Delete prefix (folder delete)
        let deleted_count = engine.delete_prefix(ns, "backup/").await.unwrap();
        assert_eq!(deleted_count, 3);
        assert!(engine.get(ns, "backup/docs/readme.txt").await.is_err());
    }
}
