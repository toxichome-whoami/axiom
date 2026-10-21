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
use crate::models::{BlobMetadata, BlobStats, ByteRange, ListResult, NamespaceInfo, UploadSession};
use crate::store::FileStore;
use crate::validation::{validate_key, validate_namespace};
use bytes::Bytes;
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;

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
    session_locks: dashmap::DashMap<String, Arc<tokio::sync::Mutex<()>>>,
    session_hashers: dashmap::DashMap<String, Arc<tokio::sync::Mutex<crate::hash::Blake3StreamHasher>>>,
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
            session_locks: dashmap::DashMap::new(),
            session_hashers: dashmap::DashMap::new(),
        })
    }

    /// Obtains an isolated concurrency lock for an upload session.
    fn get_session_lock(&self, upload_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.session_locks
            .entry(upload_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    /// Obtains or initializes the running streaming BLAKE3 hasher for an active upload session.
    fn get_session_hasher(&self, upload_id: &str) -> Arc<tokio::sync::Mutex<crate::hash::Blake3StreamHasher>> {
        self.session_hashers
            .entry(upload_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(crate::hash::Blake3StreamHasher::new())))
            .clone()
    }

    /// Stores a streamed binary payload under the specified namespace and key.
    /// CONTRACT:
    ///  - Single-pass hashing during receipt.
    ///  - Inlined into LSM if <= inline_max_bytes; persisted to CAS file if > inline_max_bytes.
    ///  - O(1) memory footprint.
    pub async fn put_stream<R: tokio::io::AsyncRead + Unpin>(
        &self,
        namespace: &str,
        key: &str,
        content_type: Option<&str>,
        reader: &mut R,
        ttl_seconds: Option<u64>,
        metadata: Option<std::collections::HashMap<String, String>>,
    ) -> Result<BlobMetadata, BlobError> {
        validate_namespace(namespace)?;
        validate_key(key)?;

        let mut hasher = crate::hash::Blake3StreamHasher::new();
        let mut hashing_reader = crate::hash::HashingAsyncReader::new(reader, &mut hasher);

        let temp_filename = format!("upload_stream_{}.tmp", uuid::Uuid::new_v4());
        let temp_path = self.store.base_dir().join("tmp").join(temp_filename);
        if let Some(parent) = temp_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let mut file = tokio::fs::File::create(&temp_path).await?;
        let mut buffer = vec![0u8; 128 * 1024];
        let mut size = 0u64;

        loop {
            use tokio::io::AsyncReadExt;
            let n = hashing_reader.read(&mut buffer).await?;
            if n == 0 {
                break;
            }
            if size + (n as u64) > self.max_object_bytes {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Err(BlobError::PayloadTooLarge {
                    size: size + (n as u64),
                    max: self.max_object_bytes,
                });
            }
            file.write_all(&buffer[..n]).await?;
            size += n as u64;
        }

        file.sync_data().await?;
        drop(file);

        let hash = hasher.finalize_hex();

        // Enforce namespace storage quota ceiling
        if let Some(info) = self.index.get_namespace_info(namespace)? {
            if let Some(max_quota) = info.max_bytes {
                let existing_size = self.index.get_metadata(namespace, key)?.map(|m| m.size).unwrap_or(0);
                let net_bytes = info.total_bytes.saturating_sub(existing_size);
                if net_bytes + size > max_quota {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    return Err(BlobError::QuotaExceeded {
                        namespace: namespace.to_string(),
                        current: net_bytes,
                        requested: size,
                        max: max_quota,
                    });
                }
            }
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let is_inline = size <= self.inline_max_bytes;

        if is_inline {
            let data = tokio::fs::read(&temp_path).await?;
            self.index.put_inline_payload(&hash, &data)?;
            let _ = tokio::fs::remove_file(&temp_path).await;
        } else {
            let target_path = self.store.content_path(&hash)?;
            if tokio::fs::try_exists(&target_path).await.unwrap_or(false) {
                let _ = tokio::fs::remove_file(&temp_path).await;
            } else {
                if let Some(parent) = target_path.parent() {
                    tokio::fs::create_dir_all(parent).await?;
                }
                if let Err(e) = tokio::fs::rename(&temp_path, &target_path).await {
                    if !tokio::fs::try_exists(&target_path).await.unwrap_or(false) {
                        let _ = tokio::fs::remove_file(&temp_path).await;
                        return Err(BlobError::Io(format!("Failed to commit streamed blob: {}", e)));
                    }
                    let _ = tokio::fs::remove_file(&temp_path).await;
                }
            }
        }

        let expires_at = ttl_seconds.map(|ttl| now + ttl as i64);

        let meta = BlobMetadata {
            hash,
            size,
            content_type: content_type.unwrap_or("application/octet-stream").to_string(),
            created_at: now,
            inline: is_inline,
            expires_at,
            metadata: metadata.unwrap_or_default(),
        };

        self.index.commit_put(namespace, key, &meta)?;
        Ok(meta)
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
        self.put_with_options(namespace, key, content_type, data, None, None).await
    }

    /// Stores a binary payload with optional TTL lifecycle expiration and custom user metadata tags.
    pub async fn put_with_options(
        &self,
        namespace: &str,
        key: &str,
        content_type: Option<&str>,
        data: &[u8],
        ttl_seconds: Option<u64>,
        metadata: Option<std::collections::HashMap<String, String>>,
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

        let expires_at = ttl_seconds.map(|ttl| now + ttl as i64);

        let meta = BlobMetadata {
            hash: hash.clone(),
            size,
            content_type: content_type.unwrap_or("application/octet-stream").to_string(),
            created_at: now,
            inline: is_inline,
            expires_at,
            metadata: metadata.unwrap_or_default(),
        };

        self.index.commit_put(namespace, key, &meta)?;
        Ok(meta)
    }

    /// Retrieves an arbitrary sub-slice of an object (HTTP 206 Partial Content).
    /// CONTRACT:
    ///  - Precondition: `start < meta.size`.
    ///  - Zero-copy slicing for inlined blobs in RAM.
    ///  - Asynchronous file seeking for disk blobs.
    ///  - Returns `(BlobMetadata, ByteRange, BlobData)` with bounded length.
    pub async fn get_range(
        &self,
        namespace: &str,
        key: &str,
        start: u64,
        end: Option<u64>,
    ) -> Result<(BlobMetadata, ByteRange, BlobData), BlobError> {
        validate_namespace(namespace)?;
        validate_key(key)?;

        let meta = self
            .index
            .get_metadata(namespace, key)?
            .ok_or_else(|| BlobError::NotFound {
                namespace: namespace.to_string(),
                key: key.to_string(),
            })?;

        if meta.size == 0 {
            return Err(BlobError::InvalidRange("Cannot slice empty blob".to_string()));
        }

        if start >= meta.size {
            return Err(BlobError::InvalidRange(format!(
                "Range start {} exceeds blob size {}",
                start, meta.size
            )));
        }

        let end = end.unwrap_or(meta.size - 1).min(meta.size - 1);
        if start > end {
            return Err(BlobError::InvalidRange(format!(
                "Range start {} cannot exceed end {}",
                start, end
            )));
        }

        let range = ByteRange {
            start,
            end,
            total: meta.size,
        };
        let slice_len = range.length();

        if meta.inline {
            let bytes_vec = self
                .index
                .get_inline_payload(&meta.hash)?
                .ok_or_else(|| BlobError::NotFound {
                    namespace: namespace.to_string(),
                    key: key.to_string(),
                })?;

            let bytes = Bytes::from(bytes_vec);
            let sliced = bytes.slice((start as usize)..=(end as usize));
            Ok((meta, range, BlobData::Inline(sliced)))
        } else {
            use tokio::io::AsyncSeekExt;
            let mut file = self.store.open(&meta.hash).await?;
            file.seek(std::io::SeekFrom::Start(start)).await?;
            Ok((meta, range, BlobData::File(file, slice_len)))
        }
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

    /// Deletes multiple objects in a batch operation (S3 Multi-Object Delete).
    /// CONTRACT:
    ///  - Iterates keys, validating and deleting each.
    ///  - S3 idempotent semantics: non-existent keys are reported as deleted.
    ///  - Returns `DeleteObjectsResult` detailing successes and failures.
    pub async fn delete_objects(
        &self,
        namespace: &str,
        keys: &[String],
    ) -> Result<crate::models::DeleteObjectsResult, BlobError> {
        validate_namespace(namespace)?;
        let mut result = crate::models::DeleteObjectsResult::default();
        for key in keys {
            if let Err(e) = validate_key(key) {
                result.errors.push((key.clone(), e.to_string()));
                continue;
            }
            match self.delete(namespace, key).await {
                Ok(_) => result.deleted.push(key.clone()),
                Err(BlobError::NotFound { .. }) => {
                    result.deleted.push(key.clone());
                }
                Err(e) => result.errors.push((key.clone(), e.to_string())),
            }
        }
        Ok(result)
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

    /// Registers a new namespace with an optional quota limit and public status.
    pub fn create_namespace(&self, name: &str, max_bytes: Option<u64>, is_public: bool) -> Result<NamespaceInfo, BlobError> {
        validate_namespace(name)?;
        self.index.create_namespace(name, max_bytes, is_public)
    }

    /// Checks whether the specified namespace allows unauthenticated public reads.
    pub fn is_namespace_public(&self, namespace: &str) -> Result<bool, BlobError> {
        self.index.is_namespace_public(namespace)
    }

    /// Retrieves CORS allowed origins for the specified namespace.
    pub fn get_namespace_cors(&self, namespace: &str) -> Result<Vec<String>, BlobError> {
        self.index.get_namespace_cors(namespace)
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

    /// Updates quota, visibility (is_public), CORS, or renames a namespace.
    pub fn update_namespace(
        &self,
        name: &str,
        new_name: Option<&str>,
        max_bytes: Option<Option<u64>>,
        is_public: Option<bool>,
        cors_origins: Option<Vec<String>>,
    ) -> Result<NamespaceInfo, BlobError> {
        validate_namespace(name)?;
        if let Some(nn) = new_name {
            validate_namespace(nn)?;
        }
        self.index.update_namespace(name, new_name, max_bytes, is_public, cors_origins)
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
            expires_at: src_meta.expires_at,
            metadata: src_meta.metadata.clone(),
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

        if src_ns == dest_ns {
            if src_prefix == dest_prefix {
                return Err(BlobError::InvalidKey(
                    "Source and destination prefixes cannot be identical".to_string(),
                ));
            }
            if dest_prefix.starts_with(src_prefix) {
                return Err(BlobError::InvalidKey(
                    "Cannot copy a prefix into itself or a sub-prefix of itself".to_string(),
                ));
            }
        }

        let mut count = 0u64;
        let mut cursor = None;
        loop {
            let (items, next_cursor) = self.index.list(src_ns, Some(src_prefix), cursor.as_deref(), 1000)?;
            if items.is_empty() {
                break;
            }
            for entry in items {
                let rel = &entry.key[src_prefix.len()..];
                let new_key = format!("{}{}", dest_prefix, rel);
                self.copy_blob(src_ns, &entry.key, dest_ns, &new_key).await?;
                count += 1;
            }
            if next_cursor.is_none() {
                break;
            }
            cursor = next_cursor;
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

        if src_ns == dest_ns {
            if src_prefix == dest_prefix {
                return Err(BlobError::InvalidKey(
                    "Source and destination prefixes cannot be identical".to_string(),
                ));
            }
            if dest_prefix.starts_with(src_prefix) {
                return Err(BlobError::InvalidKey(
                    "Cannot move a prefix into itself or a sub-prefix of itself".to_string(),
                ));
            }
        }

        let mut count = 0u64;
        loop {
            let (items, _) = self.index.list(src_ns, Some(src_prefix), None, 1000)?;
            if items.is_empty() {
                break;
            }
            let mut moved_any = false;
            for entry in items {
                let rel = &entry.key[src_prefix.len()..];
                let new_key = format!("{}{}", dest_prefix, rel);
                self.move_blob(src_ns, &entry.key, dest_ns, &new_key).await?;
                count += 1;
                moved_any = true;
            }
            if !moved_any {
                break;
            }
        }
        Ok(count)
    }

    /// Recursively deletes all objects matching a prefix.
    pub async fn delete_prefix(&self, ns: &str, prefix: &str) -> Result<u64, BlobError> {
        validate_namespace(ns)?;
        let mut count = 0u64;
        loop {
            let (items, _) = self.index.list(ns, Some(prefix), None, 1000)?;
            if items.is_empty() {
                break;
            }
            let mut deleted_any = false;
            for entry in items {
                if self.delete(ns, &entry.key).await? {
                    count += 1;
                    deleted_any = true;
                }
            }
            if !deleted_any {
                break;
            }
        }
        Ok(count)
    }

    /// Deletes a namespace and purges all objects inside it.
    pub async fn delete_namespace(&self, namespace: &str) -> Result<u64, BlobError> {
        validate_namespace(namespace)?;
        let mut deleted_count = 0u64;
        loop {
            let (items, _) = self.index.list(namespace, None, None, 1000)?;
            if items.is_empty() {
                break;
            }
            let mut deleted_any = false;
            for entry in items {
                if self.delete(namespace, &entry.key).await? {
                    deleted_count += 1;
                    deleted_any = true;
                }
            }
            if !deleted_any {
                break;
            }
        }
        self.index.remove_namespace_record(namespace)?;
        Ok(deleted_count)
    }

    /// Initializes a new resumable upload session with optional declared total size, expected checksum, and owner.
    #[allow(clippy::too_many_arguments)]
    pub async fn init_resumable_upload(
        &self,
        namespace: &str,
        key: &str,
        content_type: Option<&str>,
        total_size: Option<u64>,
        checksum: Option<&str>,
        owner: Option<&str>,
        ttl_seconds: Option<u64>,
    ) -> Result<UploadSession, BlobError> {
        validate_namespace(namespace)?;
        validate_key(key)?;

        if let Some(total) = total_size {
            if total > self.max_object_bytes {
                return Err(BlobError::PayloadTooLarge {
                    size: total,
                    max: self.max_object_bytes,
                });
            }

            // Check namespace quota upfront if total_size is known
            if let Some(info) = self.index.get_namespace_info(namespace)? {
                if let Some(max_quota) = info.max_bytes {
                    let existing_size = self
                        .index
                        .get_metadata(namespace, key)?
                        .map(|m| m.size)
                        .unwrap_or(0);
                    let net_bytes = info.total_bytes.saturating_sub(existing_size);
                    if net_bytes + total > max_quota {
                        return Err(BlobError::QuotaExceeded {
                            namespace: namespace.to_string(),
                            current: net_bytes,
                            requested: total,
                            max: max_quota,
                        });
                    }
                }
            }
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let expires_at = now + ttl_seconds.unwrap_or(86400) as i64;

        let upload_id = uuid::Uuid::new_v4().to_string();
        let session = UploadSession {
            upload_id,
            namespace: namespace.to_string(),
            key: key.to_string(),
            content_type: content_type.unwrap_or("application/octet-stream").to_string(),
            created_at: now,
            expires_at,
            parts: Vec::new(),
            total_size,
            received_bytes: 0,
            checksum: checksum.map(|s| s.to_string()),
            owner: owner.map(|s| s.to_string()),
        };

        self.index.save_upload_session(&session)?;
        Ok(session)
    }

    /// Initializes a new multipart / chunked upload session (legacy compatibility).
    pub async fn init_chunked_upload(
        &self,
        namespace: &str,
        key: &str,
        content_type: Option<&str>,
        ttl_seconds: Option<u64>,
    ) -> Result<UploadSession, BlobError> {
        self.init_resumable_upload(namespace, key, content_type, None, None, None, ttl_seconds).await
    }

    /// Retrieves an active upload session by its upload_id.
    pub fn get_upload_session(&self, upload_id: &str) -> Result<Option<UploadSession>, BlobError> {
        self.index.get_upload_session(upload_id)
    }

    /// Queries the authoritative number of bytes successfully persisted on disk for an upload session.
    pub async fn get_upload_offset(&self, upload_id: &str) -> Result<u64, BlobError> {
        let mut session = self
            .index
            .get_upload_session(upload_id)?
            .ok_or_else(|| BlobError::UploadSessionNotFound(upload_id.to_string()))?;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        if now > session.expires_at {
            let _ = self.abort_chunked_upload(upload_id).await;
            return Err(BlobError::UploadSessionNotFound("Upload session expired".to_string()));
        }

        // Authoritative check: physical bytes persisted to disk
        let disk_bytes = self.store.get_staging_size(upload_id).await?;
        if disk_bytes != session.received_bytes {
            session.received_bytes = disk_bytes;
            self.index.save_upload_session(&session)?;
        }

        Ok(disk_bytes)
    }

    /// Streams an incoming byte range directly into the upload staging file starting at `offset`.
    /// Handles concurrency via per-session mutex, enforces payload ceilings and quotas,
    /// persists data using fsync, and updates confirmed offset in the LSM index.
    pub async fn write_resumable_stream<R: tokio::io::AsyncRead + Unpin>(
        &self,
        upload_id: &str,
        offset: u64,
        reader: &mut R,
        max_bytes: Option<u64>,
    ) -> Result<u64, BlobError> {
        let lock = self.get_session_lock(upload_id);
        let _guard = lock.lock().await;

        let mut session = self
            .index
            .get_upload_session(upload_id)?
            .ok_or_else(|| BlobError::UploadSessionNotFound(upload_id.to_string()))?;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        if now > session.expires_at {
            let _ = self.abort_chunked_upload(upload_id).await;
            return Err(BlobError::UploadSessionNotFound("Upload session expired".to_string()));
        }

        if let Some(total) = session.total_size {
            if let Some(len) = max_bytes {
                if offset + len > total {
                    return Err(BlobError::InvalidRange(format!(
                        "Range offset {} + length {} exceeds declared total size {}",
                        offset, len, total
                    )));
                }
            }
        }

        if let Some(len) = max_bytes {
            if offset + len > self.max_object_bytes {
                return Err(BlobError::PayloadTooLarge {
                    size: offset + len,
                    max: self.max_object_bytes,
                });
            }
        }

        let bytes_written = {
            let hasher_arc = self.get_session_hasher(upload_id);
            let mut hasher_guard = hasher_arc.lock().await;

            // If offset rewound or reset, rebuild hasher to stay consistent
            if offset == 0 {
                *hasher_guard = crate::hash::Blake3StreamHasher::new();
            }

            let mut hashing_reader = crate::hash::HashingAsyncReader::new(reader, &mut *hasher_guard);
            self.store
                .write_resumable_stream(upload_id, offset, &mut hashing_reader, max_bytes)
                .await?
        };

        let new_offset = offset + bytes_written;
        session.received_bytes = new_offset;
        self.index.save_upload_session(&session)?;

        Ok(bytes_written)
    }

    /// Writes raw byte slice at `offset` for resumable upload sessions.
    pub async fn write_resumable_bytes(
        &self,
        upload_id: &str,
        offset: u64,
        data: &[u8],
    ) -> Result<u64, BlobError> {
        let mut cursor = std::io::Cursor::new(data);
        self.write_resumable_stream(upload_id, offset, &mut cursor, Some(data.len() as u64)).await
    }

    /// Writes an individual chunk/part to upload staging storage (legacy multipart).
    pub async fn write_chunk(
        &self,
        upload_id: &str,
        part_number: u32,
        data: &[u8],
    ) -> Result<(), BlobError> {
        if part_number == 0 {
            return Err(BlobError::InvalidKey("Part number must be >= 1".to_string()));
        }

        let lock = self.get_session_lock(upload_id);
        let _guard = lock.lock().await;

        let mut session = self
            .index
            .get_upload_session(upload_id)?
            .ok_or_else(|| BlobError::UploadSessionNotFound(upload_id.to_string()))?;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        if now > session.expires_at {
            let _ = self.abort_chunked_upload(upload_id).await;
            return Err(BlobError::UploadSessionNotFound("Upload session expired".to_string()));
        }

        self.store.write_upload_part(upload_id, part_number, data).await?;

        if !session.parts.contains(&part_number) {
            session.parts.push(part_number);
            session.parts.sort_unstable();
            self.index.save_upload_session(&session)?;
        }

        Ok(())
    }

    /// Finalizes a resumable or chunked upload: computes BLAKE3 hash incrementally,
    /// verifies checksum and total size invariants, commits metadata to the index,
    /// and purges staging artifacts.
    pub async fn finalize_resumable_upload(
        &self,
        upload_id: &str,
    ) -> Result<BlobMetadata, BlobError> {
        let lock = self.get_session_lock(upload_id);
        let _guard = lock.lock().await;

        let session = self
            .index
            .get_upload_session(upload_id)?
            .ok_or_else(|| BlobError::UploadSessionNotFound(upload_id.to_string()))?;

        let precomputed_hash = if let Some((_, hasher_lock)) = self.session_hashers.remove(upload_id) {
            let h = hasher_lock.lock().await;
            if h.bytes_read() == session.received_bytes && session.received_bytes > 0 {
                Some(h.finalize_hex())
            } else {
                None
            }
        } else {
            None
        };

        let (hash, size) = self.store.finalize_resumable_upload_with_hash(upload_id, precomputed_hash).await?;

        if let Some(total) = session.total_size {
            if size != total {
                let _ = self.store.remove(&hash).await;
                return Err(BlobError::InvalidRange(format!(
                    "Finalized blob size {} does not match declared total size {}",
                    size, total
                )));
            }
        }

        if size > self.max_object_bytes {
            let _ = self.store.remove(&hash).await;
            return Err(BlobError::PayloadTooLarge {
                size,
                max: self.max_object_bytes,
            });
        }

        if let Some(ref expected_checksum) = session.checksum {
            if !constant_time_eq(&hash, expected_checksum) {
                let _ = self.store.remove(&hash).await;
                return Err(BlobError::ChecksumMismatch {
                    expected: expected_checksum.clone(),
                    actual: hash,
                });
            }
        }

        // Check namespace quota
        if let Some(info) = self.index.get_namespace_info(&session.namespace)? {
            if let Some(max_quota) = info.max_bytes {
                let existing_size = self
                    .index
                    .get_metadata(&session.namespace, &session.key)?
                    .map(|m| m.size)
                    .unwrap_or(0);
                let net_bytes = info.total_bytes.saturating_sub(existing_size);
                if net_bytes + size > max_quota {
                    let _ = self.store.remove(&hash).await;
                    return Err(BlobError::QuotaExceeded {
                        namespace: session.namespace.clone(),
                        current: net_bytes,
                        requested: size,
                        max: max_quota,
                    });
                }
            }
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let meta = BlobMetadata {
            hash,
            size,
            content_type: session.content_type,
            created_at: now,
            inline: false,
            expires_at: None,
            metadata: std::collections::HashMap::new(),
        };

        self.index.commit_put(&session.namespace, &session.key, &meta)?;
        let _ = self.index.delete_upload_session(upload_id);
        self.session_locks.remove(upload_id);
        self.session_hashers.remove(upload_id);

        Ok(meta)
    }

    /// Completes a chunked upload by assembling parts and committing object metadata.
    pub async fn complete_chunked_upload(
        &self,
        upload_id: &str,
    ) -> Result<BlobMetadata, BlobError> {
        self.finalize_resumable_upload(upload_id).await
    }

    /// Aborts an active chunked upload session and purges staging data.
    pub async fn abort_chunked_upload(&self, upload_id: &str) -> Result<(), BlobError> {
        self.store.abort_upload_staging(upload_id).await?;
        self.index.delete_upload_session(upload_id)?;
        self.session_locks.remove(upload_id);
        self.session_hashers.remove(upload_id);
        Ok(())
    }

    /// Sets staging file length for testing sparse files without real disk allocation.
    pub async fn set_staging_len_for_test(&self, upload_id: &str, len: u64) -> Result<(), BlobError> {
        self.store.set_staging_len_for_test(upload_id, len).await
    }

    /// Sweeps all expired upload sessions and removes their temporary staging files.
    pub async fn sweep_expired_upload_sessions(&self) -> Result<usize, BlobError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let sessions = self.index.list_upload_sessions()?;
        let mut swept = 0;
        let mut active_ids = std::collections::HashSet::new();

        for session in sessions {
            if now >= session.expires_at {
                let _ = self.store.abort_upload_staging(&session.upload_id).await;
                let _ = self.index.delete_upload_session(&session.upload_id);
                self.session_locks.remove(&session.upload_id);
                self.session_hashers.remove(&session.upload_id);
                swept += 1;
            } else {
                active_ids.insert(session.upload_id);
            }
        }

        let orphaned = self.store.sweep_orphaned_staging(&active_ids).await.unwrap_or(0);
        Ok(swept + orphaned)
    }

    /// Scrubs an individual stored blob file against its expected BLAKE3 checksum.
    pub async fn scrub_blob(&self, hash: &str) -> Result<bool, BlobError> {
        self.store.scrub_file(hash).await
    }

    /// Performs a full storage integrity audit, returning `(verified_count, corrupted_count)`.
    pub async fn scrub_all(&self) -> Result<(u64, u64), BlobError> {
        let hashes = self.index.list_content_hashes()?;
        let mut verified = 0u64;
        let mut corrupted = 0u64;

        for hash in hashes {
            match self.scrub_blob(&hash).await {
                Ok(true) => verified += 1,
                _ => corrupted += 1,
            }
        }

        Ok((verified, corrupted))
    }

    /// Identifies and removes expired blobs, reclaiming disk space when refcounts reach 0.
    pub async fn sweep_expired(&self) -> Result<usize, BlobError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let deleted = self.index.sweep_expired_blobs(now)?;
        let count = deleted.len();

        for (_, _, hash, should_delete) in deleted {
            if should_delete {
                let _ = self.store.remove(&hash).await;
            }
        }

        let upload_swept = self.sweep_expired_upload_sessions().await.unwrap_or(0);

        Ok(count + upload_swept)
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

    #[tokio::test]
    async fn test_blob_engine_range_requests() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = BlobEngine::new(tmp.path(), 16, 1024 * 1024, false)
            .await
            .unwrap();

        let ns = "range-test";

        // 1. Inline payload (10 bytes <= 16)
        let inline_data = b"0123456789";
        engine.put(ns, "inline.txt", None, inline_data).await.unwrap();

        let (_, r1, data1) = engine.get_range(ns, "inline.txt", 2, Some(6)).await.unwrap();
        assert_eq!(r1.start, 2);
        assert_eq!(r1.end, 6);
        assert_eq!(r1.length(), 5);
        if let BlobData::Inline(b) = data1 {
            assert_eq!(&b[..], b"23456");
        } else {
            panic!("Expected inline blob");
        }

        // 2. Large disk payload (100 bytes > 16)
        let large_data: Vec<u8> = (0..100).collect();
        engine.put(ns, "large.bin", None, &large_data).await.unwrap();

        let (_, r2, data2) = engine.get_range(ns, "large.bin", 10, Some(19)).await.unwrap();
        assert_eq!(r2.start, 10);
        assert_eq!(r2.end, 19);
        assert_eq!(r2.length(), 10);
        if let BlobData::File(mut file, len) = data2 {
            assert_eq!(len, 10);
            use tokio::io::AsyncReadExt;
            let mut buf = vec![0u8; 10];
            file.read_exact(&mut buf).await.unwrap();
            assert_eq!(buf, (10..20).collect::<Vec<u8>>());
        } else {
            panic!("Expected file blob");
        }

        // 3. Out-of-bounds range checks
        assert!(engine.get_range(ns, "large.bin", 100, None).await.is_err());
        assert!(engine.get_range(ns, "large.bin", 50, Some(40)).await.is_err());
    }

    #[tokio::test]
    async fn test_blob_engine_chunked_upload_lifecycle() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = BlobEngine::new(tmp.path(), 64, 1024 * 1024, false)
            .await
            .unwrap();

        let ns = "chunk-test";
        let session = engine.init_chunked_upload(ns, "assembled.bin", Some("application/octet-stream"), None).await.unwrap();

        let part1 = b"AAAA";
        let part2 = b"BBBB";
        let part3 = b"CCCC";

        // Write parts (even in out-of-order sequence)
        engine.write_chunk(&session.upload_id, 2, part2).await.unwrap();
        engine.write_chunk(&session.upload_id, 1, part1).await.unwrap();
        engine.write_chunk(&session.upload_id, 3, part3).await.unwrap();

        // Complete upload
        let meta = engine.complete_chunked_upload(&session.upload_id).await.unwrap();
        assert_eq!(meta.size, 12);

        // Verify assembled content
        let (_, content) = engine.get_bytes(ns, "assembled.bin").await.unwrap();
        assert_eq!(&content[..], b"AAAABBBBCCCC");

        // Verify session deleted after completion
        assert!(engine.complete_chunked_upload(&session.upload_id).await.is_err());
    }

    #[tokio::test]
    async fn test_blob_engine_scrubbing_and_expiry() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = BlobEngine::new(tmp.path(), 8, 1024 * 1024, false)
            .await
            .unwrap();

        let ns = "scrub-test";
        let payload = vec![77u8; 128]; // Disk file
        let meta = engine.put_with_options(ns, "temp.bin", None, &payload, Some(0), None).await.unwrap();

        // Scrub check passes
        assert!(engine.scrub_blob(&meta.hash).await.unwrap());
        let (verified, corrupted) = engine.scrub_all().await.unwrap();
        assert_eq!(verified, 1);
        assert_eq!(corrupted, 0);

        // Sweep expired blobs (TTL = 0s)
        let swept_count = engine.sweep_expired().await.unwrap();
        assert_eq!(swept_count, 1);
        assert!(engine.get(ns, "temp.bin").await.is_err());
    }

    #[tokio::test]
    async fn test_blob_engine_prefix_self_nesting_prevention() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = BlobEngine::new(tmp.path(), 8, 1024 * 1024, false)
            .await
            .unwrap();

        let ns = "nest-test";
        engine.put(ns, "folder/file.txt", None, b"hello").await.unwrap();

        // 1. Same prefix should fail
        let copy_same = engine.copy_prefix(ns, "folder/", ns, "folder/").await;
        assert!(copy_same.is_err());

        let move_same = engine.move_prefix(ns, "folder/", ns, "folder/").await;
        assert!(move_same.is_err());

        // 2. Sub-prefix should fail (prevents infinite loop)
        let copy_sub = engine.copy_prefix(ns, "folder/", ns, "folder/sub/").await;
        assert!(copy_sub.is_err());

        let move_sub = engine.move_prefix(ns, "folder/", ns, "folder/sub/").await;
        assert!(move_sub.is_err());

        // 3. Different destination prefix should succeed
        let move_valid = engine.move_prefix(ns, "folder/", ns, "other/").await;
        assert!(move_valid.is_ok());
        assert_eq!(move_valid.unwrap(), 1);
        assert!(engine.get(ns, "other/file.txt").await.is_ok());
        assert!(engine.get(ns, "folder/file.txt").await.is_err());
    }

    #[tokio::test]
    async fn test_blob_engine_resumable_upload_lifecycle() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = BlobEngine::new(tmp.path(), 8, 1024 * 1024, true).await.unwrap();

        let ns = "resumable-ns";
        let full_data = b"0123456789ABCDEF0123456789ABCDEF"; // 32 bytes
        let total_size = full_data.len() as u64;

        let session = engine
            .init_resumable_upload(ns, "resumable.bin", Some("application/octet-stream"), Some(total_size), None, Some("test_user"), None)
            .await
            .unwrap();

        // 1. Initial offset is 0
        assert_eq!(engine.get_upload_offset(&session.upload_id).await.unwrap(), 0);

        // 2. Upload first chunk (16 bytes)
        let chunk1 = &full_data[0..16];
        let written1 = engine.write_resumable_bytes(&session.upload_id, 0, chunk1).await.unwrap();
        assert_eq!(written1, 16);
        assert_eq!(engine.get_upload_offset(&session.upload_id).await.unwrap(), 16);

        // 3. Upload second chunk (16 bytes) at offset 16
        let chunk2 = &full_data[16..32];
        let written2 = engine.write_resumable_bytes(&session.upload_id, 16, chunk2).await.unwrap();
        assert_eq!(written2, 16);
        assert_eq!(engine.get_upload_offset(&session.upload_id).await.unwrap(), 32);

        // 4. Finalize
        let meta = engine.finalize_resumable_upload(&session.upload_id).await.unwrap();
        assert_eq!(meta.size, 32);

        // 5. Verify payload matches original 32 bytes
        let (_, retrieved) = engine.get_bytes(ns, "resumable.bin").await.unwrap();
        assert_eq!(&retrieved[..], full_data);
    }

    #[tokio::test]
    async fn test_blob_engine_resumable_interruption_and_gap_protection() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = BlobEngine::new(tmp.path(), 8, 1024 * 1024, true).await.unwrap();

        let ns = "gap-ns";
        let session = engine
            .init_resumable_upload(ns, "gap.bin", None, Some(100), None, None, None)
            .await
            .unwrap();

        // Write first 40 bytes
        let chunk1 = vec![b'A'; 40];
        engine.write_resumable_bytes(&session.upload_id, 0, &chunk1).await.unwrap();
        assert_eq!(engine.get_upload_offset(&session.upload_id).await.unwrap(), 40);

        // Gap write: client attempts to write at offset 60 (skipping bytes 40-59)
        let chunk_gap = vec![b'B'; 20];
        let gap_err = engine.write_resumable_bytes(&session.upload_id, 60, &chunk_gap).await;
        assert!(gap_err.is_err());
        match gap_err.unwrap_err() {
            BlobError::OffsetMismatch { expected, actual } => {
                assert_eq!(expected, 40);
                assert_eq!(actual, 60);
            }
            other => panic!("Expected OffsetMismatch, got {:?}", other),
        }

        // Server confirmed offset still 40 (gap write rejected)
        assert_eq!(engine.get_upload_offset(&session.upload_id).await.unwrap(), 40);

        // Rewind write: client retries from offset 30 (rewind 10 bytes)
        let chunk_rewind = vec![b'C'; 30];
        engine.write_resumable_bytes(&session.upload_id, 30, &chunk_rewind).await.unwrap();
        assert_eq!(engine.get_upload_offset(&session.upload_id).await.unwrap(), 60);

        // Complete remaining 40 bytes (60..100)
        let chunk_end = vec![b'D'; 40];
        engine.write_resumable_bytes(&session.upload_id, 60, &chunk_end).await.unwrap();
        assert_eq!(engine.get_upload_offset(&session.upload_id).await.unwrap(), 100);

        let meta = engine.finalize_resumable_upload(&session.upload_id).await.unwrap();
        assert_eq!(meta.size, 100);
    }

    #[tokio::test]
    async fn test_blob_engine_resumable_server_restart_recovery() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().to_path_buf();

        let upload_id;
        let test_data = b"RESTART_RESUME_TEST_DATA_PERSISTENCE";
        let part1 = &test_data[0..16]; // 16 bytes
        let part2 = &test_data[16..];  // remaining 20 bytes

        // Phase 1: Upload first part in initial server instance
        {
            let engine1 = BlobEngine::new(&path, 8, 1024 * 1024, true).await.unwrap();
            let session = engine1
                .init_resumable_upload("restart-ns", "restart.txt", None, Some(test_data.len() as u64), None, None, None)
                .await
                .unwrap();
            upload_id = session.upload_id.clone();

            let written = engine1.write_resumable_bytes(&upload_id, 0, part1).await.unwrap();
            assert_eq!(written, 16);
            assert_eq!(engine1.get_upload_offset(&upload_id).await.unwrap(), 16);
            // Engine1 is dropped here (simulating server crash or reboot)
        }

        // Phase 2: Open brand-new BlobEngine instance on the exact same directory
        {
            let engine2 = BlobEngine::new(&path, 8, 1024 * 1024, true).await.unwrap();

            // Session exists in persistent index
            let session = engine2.get_upload_session(&upload_id).unwrap().expect("Session must survive restart");
            assert_eq!(session.key, "restart.txt");

            // Server-confirmed offset survived restart on disk
            let offset = engine2.get_upload_offset(&upload_id).await.unwrap();
            assert_eq!(offset, 16, "Confirmed offset must match persisted file size after restart");

            // Resume upload of remaining bytes from offset 16
            let written = engine2.write_resumable_bytes(&upload_id, offset, part2).await.unwrap();
            assert_eq!(written, part2.len() as u64);
            assert_eq!(engine2.get_upload_offset(&upload_id).await.unwrap(), test_data.len() as u64);

            // Finalize upload
            let meta = engine2.finalize_resumable_upload(&upload_id).await.unwrap();
            assert_eq!(meta.size, test_data.len() as u64);

            let (_, content) = engine2.get_bytes("restart-ns", "restart.txt").await.unwrap();
            assert_eq!(&content[..], test_data);
        }
    }

    #[tokio::test]
    async fn test_blob_engine_resumable_simulation_14gb_of_20gb() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = BlobEngine::new(tmp.path(), 8, 50 * 1024 * 1024 * 1024, false).await.unwrap();

        const GIB: u64 = 1024 * 1024 * 1024;
        let total_size: u64 = 20 * GIB;     // 20 GB
        let uploaded_part1: u64 = 14 * GIB; // 14 GB
        let _remaining_part2: u64 = 6 * GIB; // 6 GB

        // 1. Initialize session for a 20 GB file
        let session = engine
            .init_resumable_upload("video-bucket", "large_20gb_video.mp4", Some("video/mp4"), Some(total_size), None, Some("video_uploader"), None)
            .await
            .unwrap();

        // 2. Simulate 14 GB upload using sparse file allocation (zero physical disk consumption)
        engine.set_staging_len_for_test(&session.upload_id, uploaded_part1).await.unwrap();

        // 3. Network drops! Client reconnects and queries server-confirmed offset
        let confirmed_offset = engine.get_upload_offset(&session.upload_id).await.unwrap();
        assert_eq!(
            confirmed_offset,
            uploaded_part1,
            "Server confirmed offset must be exactly 14 GB (15,032,385,536 bytes)"
        );

        // 4. Verify client cannot skip ahead: client asking for 15 GB must be rejected
        let invalid_chunk = vec![0u8; 1024];
        let bad_skip = engine.write_resumable_bytes(&session.upload_id, 15 * GIB, &invalid_chunk).await;
        assert!(bad_skip.is_err());

        // 5. Client resumes uploading from the confirmed 14 GB offset up to 20 GB
        engine.set_staging_len_for_test(&session.upload_id, total_size).await.unwrap();
        let final_offset = engine.get_upload_offset(&session.upload_id).await.unwrap();
        assert_eq!(final_offset, total_size, "Final offset must equal 20 GB");

        // 6. Complete and verify finalization handles the full 20 GB file
        let meta = engine.finalize_resumable_upload(&session.upload_id).await.unwrap();
        assert_eq!(meta.size, total_size);
        assert_eq!(meta.content_type, "video/mp4");
        assert!(!meta.inline);

        // Verify head metadata reflects the full 20 GB object
        let head_meta = engine.head("video-bucket", "large_20gb_video.mp4").unwrap();
        assert_eq!(head_meta.size, 20 * GIB);
    }

    #[tokio::test]
    async fn test_blob_engine_resumable_checksum_mismatch() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = BlobEngine::new(tmp.path(), 8, 1024 * 1024, true).await.unwrap();

        let expected_wrong_hash = "0000000000000000000000000000000000000000000000000000000000000000";
        let session = engine
            .init_resumable_upload("cs-ns", "corrupt.bin", None, Some(5), Some(expected_wrong_hash), None, None)
            .await
            .unwrap();

        engine.write_resumable_bytes(&session.upload_id, 0, b"HELLO").await.unwrap();

        // Finalization must fail with ChecksumMismatch and not commit blob to metadata index
        let result = engine.finalize_resumable_upload(&session.upload_id).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            BlobError::ChecksumMismatch { expected, .. } => {
                assert_eq!(expected, expected_wrong_hash);
            }
            other => panic!("Expected ChecksumMismatch, got {:?}", other),
        }

        // Object must NOT exist in the index
        assert!(engine.get("cs-ns", "corrupt.bin").await.is_err());
    }

    #[tokio::test]
    async fn test_blob_engine_resumable_ttl_expiry_sweep() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = BlobEngine::new(tmp.path(), 8, 1024 * 1024, false).await.unwrap();

        // Create upload session
        let mut session = engine
            .init_resumable_upload("ttl-ns", "expired.bin", None, Some(10), None, None, Some(3600))
            .await
            .unwrap();

        engine.write_resumable_bytes(&session.upload_id, 0, b"12345").await.unwrap();

        // Expire the session explicitly in metadata
        session.expires_at = 1;
        engine.index.save_upload_session(&session).unwrap();

        // Sweep expired upload sessions
        let swept = engine.sweep_expired_upload_sessions().await.unwrap();
        assert!(swept >= 1);

        // Session must be purged
        assert!(engine.get_upload_session(&session.upload_id).unwrap().is_none());
        assert!(engine.get_upload_offset(&session.upload_id).await.is_err());
    }

    #[tokio::test]
    async fn test_blob_engine_public_namespace_and_batch_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = BlobEngine::new(tmp.path(), 64, 1024 * 1024, false).await.unwrap();

        let ns = "public-media";
        let info = engine.create_namespace(ns, None, true).unwrap();
        assert!(info.is_public);
        assert!(engine.is_namespace_public(ns).unwrap());

        // Put object with custom metadata tags
        let mut custom_meta = std::collections::HashMap::new();
        custom_meta.insert("author".to_string(), "alice".to_string());
        custom_meta.insert("license".to_string(), "mit".to_string());

        let meta = engine.put_with_options(
            ns,
            "banner.jpg",
            Some("image/jpeg"),
            b"JPEG_BINARY_DATA",
            None,
            Some(custom_meta.clone()),
        ).await.unwrap();

        assert_eq!(meta.metadata.get("author").unwrap(), "alice");
        assert_eq!(meta.metadata.get("license").unwrap(), "mit");

        // Put another object
        engine.put(ns, "logo.png", Some("image/png"), b"PNG_DATA").await.unwrap();

        // Batch delete both objects
        let del_res = engine.delete_objects(ns, &[
            "banner.jpg".to_string(),
            "logo.png".to_string(),
            "nonexistent.txt".to_string(),
        ]).await.unwrap();

        assert_eq!(del_res.deleted.len(), 3);
        assert!(del_res.errors.is_empty());
        assert!(engine.get(ns, "banner.jpg").await.is_err());
        assert!(engine.get(ns, "logo.png").await.is_err());
    }
}
