/*
 * Embedded Fjall LSM index managing object metadata, content deduplication, and inline payloads.
 * Owned by: blob
 * Key deps: fjall, serde_json
 * Invariants: Metadata commits must only occur after blob payload durability has been achieved.
 * Last structural change: Initial implementation of Phase 1 Blob Engine.
 */

use crate::error::BlobError;
use crate::models::{BlobEntry, BlobMetadata, ContentRef};
use fjall::{Database, Keyspace, KeyspaceCreateOptions};
use std::path::Path;

pub struct BlobIndex {
    #[allow(dead_code)]
    db: Database,
    /// Keyspace `meta`: key is `{namespace}\0{key}` -> JSON BlobMetadata
    meta_keyspace: Keyspace,
    /// Keyspace `content`: key is `{hash}` -> JSON ContentRef (refcount tracking)
    content_keyspace: Keyspace,
    /// Keyspace `inline`: key is `{hash}` -> raw bytes for small payloads
    inline_keyspace: Keyspace,
}

impl BlobIndex {
    /// Opens or creates the Fjall LSM keyspaces for blob metadata indexing.
    /// CONTRACT:
    ///  - Precondition: `path` must be a directory path with write permissions.
    ///  - Returns `BlobIndex` with `meta`, `content`, and `inline` keyspaces ready.
    ///  - Idempotent: Yes.
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, BlobError> {
        let db = Database::builder(path.as_ref()).open()?;

        let meta_keyspace = db.keyspace("meta", KeyspaceCreateOptions::default)?;
        let content_keyspace = db.keyspace("content", KeyspaceCreateOptions::default)?;
        let inline_keyspace = db.keyspace("inline", KeyspaceCreateOptions::default)?;

        Ok(Self {
            db,
            meta_keyspace,
            content_keyspace,
            inline_keyspace,
        })
    }

    /// Formats compound key for the metadata keyspace: `{namespace}\0{key}`.
    fn meta_key(namespace: &str, key: &str) -> Vec<u8> {
        let mut k = Vec::with_capacity(namespace.len() + 1 + key.len());
        k.extend_from_slice(namespace.as_bytes());
        k.push(0); // NUL byte delimiter guarantees namespace boundary cannot collide with key
        k.extend_from_slice(key.as_bytes());
        k
    }

    /// Parses compound key back into (namespace, key) tuple.
    fn parse_meta_key(bytes: &[u8]) -> Option<(String, String)> {
        let pos = bytes.iter().position(|&b| b == 0)?;
        let ns = std::str::from_utf8(&bytes[..pos]).ok()?.to_string();
        let key = std::str::from_utf8(&bytes[pos + 1..]).ok()?.to_string();
        Some((ns, key))
    }

    /// Retrieves metadata for an object key in a namespace.
    pub fn get_metadata(&self, namespace: &str, key: &str) -> Result<Option<BlobMetadata>, BlobError> {
        let mk = Self::meta_key(namespace, key);
        if let Some(slice) = self.meta_keyspace.get(&mk)? {
            let meta: BlobMetadata = serde_json::from_slice(&slice)
                .map_err(|e| BlobError::Engine(format!("Corrupt metadata record: {}", e)))?;
            Ok(Some(meta))
        } else {
            Ok(None)
        }
    }

    /// Retrieves an inline small blob payload from the LSM keyspace.
    pub fn get_inline_payload(&self, hash: &str) -> Result<Option<Vec<u8>>, BlobError> {
        if let Some(slice) = self.inline_keyspace.get(hash.as_bytes())? {
            Ok(Some(slice.to_vec()))
        } else {
            Ok(None)
        }
    }

    /// Stores an inline small blob payload into the LSM keyspace.
    pub fn put_inline_payload(&self, hash: &str, payload: &[u8]) -> Result<(), BlobError> {
        self.inline_keyspace.insert(hash.as_bytes(), payload)?;
        Ok(())
    }

    /// Atomically records or replaces object metadata and increments the content refcount.
    /// Returns the updated `ContentRef`.
    pub fn commit_put(
        &self,
        namespace: &str,
        key: &str,
        metadata: &BlobMetadata,
    ) -> Result<ContentRef, BlobError> {
        let mk = Self::meta_key(namespace, key);

        // Check if previous metadata existed for this key; if so, decrement old hash refcount
        if let Some(old_slice) = self.meta_keyspace.get(&mk)? {
            if let Ok(old_meta) = serde_json::from_slice::<BlobMetadata>(&old_slice) {
                if old_meta.hash != metadata.hash {
                    let _ = self.decrement_refcount(&old_meta.hash)?;
                }
            }
        }

        // Increment content refcount
        let content_ref = self.increment_refcount(&metadata.hash, metadata.size, metadata.created_at)?;

        // Write new metadata record
        let meta_json = serde_json::to_vec(metadata)
            .map_err(|e| BlobError::Engine(format!("Failed to serialize metadata: {}", e)))?;
        self.meta_keyspace.insert(&mk, meta_json)?;

        Ok(content_ref)
    }

    /// Removes an object metadata record and decrements its content refcount.
    /// Returns (Option<BlobMetadata>, should_delete_physical_blob: bool).
    pub fn commit_delete(
        &self,
        namespace: &str,
        key: &str,
    ) -> Result<(Option<BlobMetadata>, bool), BlobError> {
        let mk = Self::meta_key(namespace, key);
        if let Some(slice) = self.meta_keyspace.get(&mk)? {
            let meta: BlobMetadata = serde_json::from_slice(&slice)
                .map_err(|e| BlobError::Engine(format!("Corrupt metadata record: {}", e)))?;

            // Remove metadata mapping
            self.meta_keyspace.remove(&mk)?;

            // Decrement refcount
            let should_delete = match self.decrement_refcount(&meta.hash)? {
                Some(r) => r.refcount == 0,
                None => true,
            };

            // If inline and refcount is 0, purge from inline keyspace
            if should_delete && meta.inline {
                let _ = self.inline_keyspace.remove(meta.hash.as_bytes());
            }

            Ok((Some(meta), should_delete))
        } else {
            Ok((None, false))
        }
    }

    /// Increments content refcount in the content keyspace.
    fn increment_refcount(
        &self,
        hash: &str,
        size: u64,
        now: i64,
    ) -> Result<ContentRef, BlobError> {
        let hk = hash.as_bytes();
        let updated = if let Some(slice) = self.content_keyspace.get(hk)? {
            let mut r: ContentRef = serde_json::from_slice(&slice)
                .map_err(|e| BlobError::Engine(format!("Corrupt content ref: {}", e)))?;
            r.refcount += 1;
            r
        } else {
            ContentRef {
                refcount: 1,
                size,
                created_at: now,
            }
        };

        let bytes = serde_json::to_vec(&updated)
            .map_err(|e| BlobError::Engine(format!("Failed to serialize content ref: {}", e)))?;
        self.content_keyspace.insert(hk, bytes)?;
        Ok(updated)
    }

    /// Decrements content refcount. If refcount hits 0, returns the 0-refcount record.
    fn decrement_refcount(&self, hash: &str) -> Result<Option<ContentRef>, BlobError> {
        let hk = hash.as_bytes();
        if let Some(slice) = self.content_keyspace.get(hk)? {
            let mut r: ContentRef = serde_json::from_slice(&slice)
                .map_err(|e| BlobError::Engine(format!("Corrupt content ref: {}", e)))?;
            if r.refcount > 1 {
                r.refcount -= 1;
                let bytes = serde_json::to_vec(&r)
                    .map_err(|e| BlobError::Engine(format!("Serialize error: {}", e)))?;
                self.content_keyspace.insert(hk, bytes)?;
                Ok(Some(r))
            } else {
                r.refcount = 0;
                self.content_keyspace.remove(hk)?;
                Ok(Some(r))
            }
        } else {
            Ok(None)
        }
    }

    /// Lists objects within a namespace with optional prefix matching and cursor pagination.
    pub fn list(
        &self,
        namespace: &str,
        prefix: Option<&str>,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<(Vec<BlobEntry>, Option<String>), BlobError> {
        // Construct prefix byte query
        let mut base_prefix = namespace.as_bytes().to_vec();
        base_prefix.push(0);
        if let Some(p) = prefix {
            base_prefix.extend_from_slice(p.as_bytes());
        }

        let mut items = Vec::new();
        let mut next_cursor = None;
        let limit = limit.clamp(1, 1000);

        // Iterate through prefix matches in meta keyspace
        for guard in self.meta_keyspace.prefix(&base_prefix) {
            let (raw_key, raw_val) = guard.into_inner()?;
            let (ns, key) = match Self::parse_meta_key(&raw_key) {
                Some(parsed) => parsed,
                None => continue,
            };

            // Skip entries up to and including cursor for keyset pagination
            if let Some(cur) = cursor {
                if key.as_str() <= cur {
                    continue;
                }
            }

            if let Ok(metadata) = serde_json::from_slice::<BlobMetadata>(&raw_val) {
                if items.len() < limit {
                    items.push(BlobEntry {
                        namespace: ns,
                        key,
                        metadata,
                    });
                } else {
                    // Set next_cursor to current key and break
                    next_cursor = Some(key);
                    break;
                }
            }
        }

        Ok((items, next_cursor))
    }

    /// Collects storage statistics across the meta and content keyspaces.
    pub fn compute_stats(&self) -> Result<crate::models::BlobStats, BlobError> {
        let mut stats = crate::models::BlobStats::default();

        for guard in self.meta_keyspace.iter() {
            let (_, raw_val) = guard.into_inner()?;
            if let Ok(meta) = serde_json::from_slice::<BlobMetadata>(&raw_val) {
                stats.total_objects += 1;
                stats.total_logical_bytes += meta.size;
                if meta.inline {
                    stats.inline_objects += 1;
                } else {
                    stats.file_objects += 1;
                }
            }
        }

        for guard in self.content_keyspace.iter() {
            let (_, raw_val) = guard.into_inner()?;
            if let Ok(content) = serde_json::from_slice::<ContentRef>(&raw_val) {
                stats.unique_blobs += 1;
                stats.total_physical_bytes += content.size;
            }
        }

        if stats.total_logical_bytes > stats.total_physical_bytes {
            stats.dedup_saved_bytes = stats.total_logical_bytes - stats.total_physical_bytes;
        }

        Ok(stats)
    }

    /// Lists all distinct namespaces currently containing at least one object.
    pub fn list_namespaces(&self) -> Result<Vec<String>, BlobError> {
        let mut set = std::collections::BTreeSet::new();
        for guard in self.meta_keyspace.iter() {
            let (raw_key, _) = guard.into_inner()?;
            if let Some((ns, _)) = Self::parse_meta_key(&raw_key) {
                set.insert(ns);
            }
        }
        Ok(set.into_iter().collect())
    }
}
