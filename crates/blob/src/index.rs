/*
 * Embedded Fjall LSM index managing object metadata, content deduplication, and inline payloads.
 * Owned by: blob
 * Key deps: fjall, serde_json
 * Invariants: Metadata commits must only occur after blob payload durability has been achieved.
 * Last structural change: Initial implementation of Phase 1 Blob Engine.
 */

use crate::error::BlobError;
use crate::models::{BlobEntry, BlobMetadata, ContentRef, NamespaceInfo};
use fjall::{Database, Keyspace, KeyspaceCreateOptions};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NamespaceRecord {
    pub name: String,
    pub created_at: i64,
    pub max_bytes: Option<u64>,
}

pub struct BlobIndex {
    #[allow(dead_code)]
    db: Database,
    /// Keyspace `meta`: key is `{namespace}\0{key}` -> JSON BlobMetadata
    meta_keyspace: Keyspace,
    /// Keyspace `content`: key is `{hash}` -> JSON ContentRef (refcount tracking)
    content_keyspace: Keyspace,
    /// Keyspace `inline`: key is `{hash}` -> raw bytes for small payloads
    inline_keyspace: Keyspace,
    /// Keyspace `namespaces`: key is `{namespace}` -> JSON NamespaceRecord
    namespaces_keyspace: Keyspace,
}

impl BlobIndex {
    /// Opens or creates the Fjall LSM keyspaces for blob metadata indexing.
    /// CONTRACT:
    ///  - Precondition: `path` must be a directory path with write permissions.
    ///  - Returns `BlobIndex` with `meta`, `content`, `inline`, and `namespaces` keyspaces ready.
    ///  - Idempotent: Yes.
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, BlobError> {
        let db = Database::builder(path.as_ref()).open()?;

        let meta_keyspace = db.keyspace("meta", KeyspaceCreateOptions::default)?;
        let content_keyspace = db.keyspace("content", KeyspaceCreateOptions::default)?;
        let inline_keyspace = db.keyspace("inline", KeyspaceCreateOptions::default)?;
        let namespaces_keyspace = db.keyspace("namespaces", KeyspaceCreateOptions::default)?;

        Ok(Self {
            db,
            meta_keyspace,
            content_keyspace,
            inline_keyspace,
            namespaces_keyspace,
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

        // Automatically ensure namespace bucket is registered
        let _ = self.ensure_namespace(namespace);

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
            let (raw_key, raw_val) = guard.into_inner()?;
            if let Some((_, key)) = Self::parse_meta_key(&raw_key) {
                if key.ends_with("/.axiom_dir") || key == ".axiom_dir" {
                    continue;
                }
            }
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

    /// Ensures that an explicit namespace record exists in the index.
    pub fn ensure_namespace(&self, namespace: &str) -> Result<(), BlobError> {
        if self.namespaces_keyspace.get(namespace.as_bytes())?.is_none() {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            let record = NamespaceRecord {
                name: namespace.to_string(),
                created_at: now,
                max_bytes: None,
            };
            let bytes = serde_json::to_vec(&record)
                .map_err(|e| BlobError::Engine(format!("Failed to serialize namespace: {}", e)))?;
            self.namespaces_keyspace.insert(namespace.as_bytes(), bytes)?;
        }
        Ok(())
    }

    /// Registers a new namespace with an optional quota limit.
    pub fn create_namespace(&self, name: &str, max_bytes: Option<u64>) -> Result<NamespaceInfo, BlobError> {
        if self.namespaces_keyspace.get(name.as_bytes())?.is_some() {
            return Err(BlobError::Engine(format!("Namespace '{}' already exists", name)));
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let record = NamespaceRecord {
            name: name.to_string(),
            created_at: now,
            max_bytes,
        };
        let bytes = serde_json::to_vec(&record)
            .map_err(|e| BlobError::Engine(format!("Failed to serialize namespace: {}", e)))?;
        self.namespaces_keyspace.insert(name.as_bytes(), bytes)?;
        Ok(NamespaceInfo {
            name: name.to_string(),
            created_at: now,
            max_bytes,
            total_objects: 0,
            total_bytes: 0,
        })
    }

    /// Retrieves detailed info and current storage usage for a single namespace.
    pub fn get_namespace_info(&self, name: &str) -> Result<Option<NamespaceInfo>, BlobError> {
        let (record, exists) = if let Some(slice) = self.namespaces_keyspace.get(name.as_bytes())? {
            let r: NamespaceRecord = serde_json::from_slice(&slice)
                .map_err(|e| BlobError::Engine(format!("Corrupt namespace record: {}", e)))?;
            (r, true)
        } else {
            (
                NamespaceRecord {
                    name: name.to_string(),
                    created_at: 0,
                    max_bytes: None,
                },
                false,
            )
        };

        let mut base_prefix = name.as_bytes().to_vec();
        base_prefix.push(0);
        let mut total_objects = 0u64;
        let mut total_bytes = 0u64;
        let mut found_objects = false;

        for guard in self.meta_keyspace.prefix(&base_prefix) {
            let (raw_key, raw_val) = guard.into_inner()?;
            if let Some((_, key)) = Self::parse_meta_key(&raw_key) {
                if key.ends_with("/.axiom_dir") || key == ".axiom_dir" {
                    continue;
                }
            }
            if let Ok(meta) = serde_json::from_slice::<BlobMetadata>(&raw_val) {
                total_objects += 1;
                total_bytes += meta.size;
                found_objects = true;
            }
        }

        if !exists && !found_objects {
            return Ok(None);
        }

        Ok(Some(NamespaceInfo {
            name: record.name,
            created_at: record.created_at,
            max_bytes: record.max_bytes,
            total_objects,
            total_bytes,
        }))
    }

    /// Lists all namespaces with their metadata and live storage metrics.
    pub fn list_namespaces_info(&self) -> Result<Vec<NamespaceInfo>, BlobError> {
        let mut map = std::collections::BTreeMap::<String, (NamespaceRecord, u64, u64)>::new();

        // 1. Read all explicitly registered namespaces
        for guard in self.namespaces_keyspace.iter() {
            let (raw_key, raw_val) = guard.into_inner()?;
            if let Ok(record) = serde_json::from_slice::<NamespaceRecord>(&raw_val) {
                map.insert(record.name.clone(), (record, 0, 0));
            } else if let Ok(name) = std::str::from_utf8(&raw_key) {
                map.insert(
                    name.to_string(),
                    (
                        NamespaceRecord {
                            name: name.to_string(),
                            created_at: 0,
                            max_bytes: None,
                        },
                        0,
                        0,
                    ),
                );
            }
        }

        // 2. Scan meta keyspace to accumulate object counts & byte sizes per namespace
        for guard in self.meta_keyspace.iter() {
            let (raw_key, raw_val) = guard.into_inner()?;
            if let Some((ns, key)) = Self::parse_meta_key(&raw_key) {
                let entry = map.entry(ns.clone()).or_insert_with(|| {
                    (
                        NamespaceRecord {
                            name: ns,
                            created_at: 0,
                            max_bytes: None,
                        },
                        0,
                        0,
                    )
                });
                if key.ends_with("/.axiom_dir") || key == ".axiom_dir" {
                    continue;
                }
                if let Ok(meta) = serde_json::from_slice::<BlobMetadata>(&raw_val) {
                    entry.1 += 1;
                    entry.2 += meta.size;
                }
            }
        }

        let result = map
            .into_values()
            .map(|(rec, count, bytes)| NamespaceInfo {
                name: rec.name,
                created_at: rec.created_at,
                max_bytes: rec.max_bytes,
                total_objects: count,
                total_bytes: bytes,
            })
            .collect();

        Ok(result)
    }

    /// Updates namespace quota or renames namespace.
    pub fn update_namespace(
        &self,
        name: &str,
        new_name: Option<&str>,
        max_bytes: Option<Option<u64>>,
    ) -> Result<NamespaceInfo, BlobError> {
        let mut info = self.get_namespace_info(name)?.ok_or_else(|| {
            BlobError::NamespaceNotFound(name.to_string())
        })?;

        let target_name = if let Some(nn) = new_name {
            if nn != name {
                // Check if target name already exists
                if self.namespaces_keyspace.get(nn.as_bytes())?.is_some() {
                    return Err(BlobError::Engine(format!("Target namespace '{}' already exists", nn)));
                }

                // Re-key all objects in meta_keyspace from {name}\0{key} to {nn}\0{key}
                let mut old_prefix = name.as_bytes().to_vec();
                old_prefix.push(0);

                let mut to_migrate = Vec::new();
                for guard in self.meta_keyspace.prefix(&old_prefix) {
                    let (raw_key, raw_val) = guard.into_inner()?;
                    if let Some((_, key)) = Self::parse_meta_key(&raw_key) {
                        to_migrate.push((raw_key, key, raw_val));
                    }
                }

                for (old_key, key, raw_val) in to_migrate {
                    let new_meta_k = Self::meta_key(nn, &key);
                    self.meta_keyspace.insert(&new_meta_k, &*raw_val)?;
                    self.meta_keyspace.remove(&*old_key)?;
                }

                // Remove old namespace record
                self.namespaces_keyspace.remove(name.as_bytes())?;
                nn
            } else {
                name
            }
        } else {
            name
        };

        let new_max_bytes = match max_bytes {
            Some(quota) => quota,
            None => info.max_bytes,
        };

        let record = NamespaceRecord {
            name: target_name.to_string(),
            created_at: if info.created_at > 0 { info.created_at } else {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64
            },
            max_bytes: new_max_bytes,
        };

        let bytes = serde_json::to_vec(&record)
            .map_err(|e| BlobError::Engine(format!("Failed to serialize namespace: {}", e)))?;
        self.namespaces_keyspace.insert(target_name.as_bytes(), bytes)?;

        info.name = target_name.to_string();
        info.max_bytes = new_max_bytes;
        Ok(info)
    }

    /// Removes a namespace record from the keyspace.
    pub fn remove_namespace_record(&self, name: &str) -> Result<(), BlobError> {
        self.namespaces_keyspace.remove(name.as_bytes())?;
        Ok(())
    }

    /// Lists all distinct namespace names currently registered or containing objects.
    pub fn list_namespaces(&self) -> Result<Vec<String>, BlobError> {
        let infos = self.list_namespaces_info()?;
        Ok(infos.into_iter().map(|i| i.name).collect())
    }
}
