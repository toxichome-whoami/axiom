/*
 * Content-addressed file storage manager for large binary blobs on local SSD/NVMe.
 * Owned by: blob
 * Key deps: tokio::fs, std::path::PathBuf
 * Invariants: Disk paths derive strictly from the 64-character BLAKE3 hash; writes use temp file + sync + atomic rename.
 * Last structural change: Initial implementation of Phase 1 Blob Engine.
 */

use crate::error::BlobError;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

pub struct FileStore {
    base_dir: PathBuf,
    data_dir: PathBuf,
    tmp_dir: PathBuf,
}

impl FileStore {
    /// Initializes the file store directory structure.
    /// CONTRACT:
    ///  - Precondition: `base_dir` must be a valid directory path on a writable volume.
    ///  - Side effects: Creates `base_dir`, `data/`, and `tmp/` directories if they do not exist.
    ///  - Idempotent: Yes.
    pub async fn new<P: AsRef<Path>>(base_dir: P) -> Result<Self, BlobError> {
        let base_dir = base_dir.as_ref().to_path_buf();
        let data_dir = base_dir.join("data");
        let tmp_dir = base_dir.join("tmp");

        tokio::fs::create_dir_all(&data_dir).await?;
        tokio::fs::create_dir_all(&tmp_dir).await?;

        let store = Self {
            base_dir,
            data_dir,
            tmp_dir,
        };

        // Sweep any orphaned temporary upload files remaining from previous crashes
        let _ = store.sweep_orphaned_tmp().await;

        Ok(store)
    }

    /// Computes the sharded content-addressed filesystem path for a given BLAKE3 hash.
    /// Format: `<data_dir>/ab/cd/<hash>`
    /// Invariant: Input `hash` must be 64 characters; derives path strictly from hex characters.
    pub fn content_path(&self, hash: &str) -> Result<PathBuf, BlobError> {
        if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(BlobError::Engine(format!(
                "Invalid content hash for storage path: {}",
                hash
            )));
        }

        // Shard by first two 2-character hex prefixes to keep directory entries balanced
        let p1 = &hash[0..2];
        let p2 = &hash[2..4];
        Ok(self.data_dir.join(p1).join(p2).join(hash))
    }

    /// Determines whether the given content hash already exists in storage.
    pub async fn exists(&self, hash: &str) -> bool {
        match self.content_path(hash) {
            Ok(path) => tokio::fs::try_exists(path).await.unwrap_or(false),
            Err(_) => false,
        }
    }

    /// Persists raw bytes directly to content-addressed storage with atomic write guarantees.
    /// CONTRACT:
    ///  - Side effects: Writes temp file, fsyncs, atomically renames to final sharded path.
    ///  - Idempotent: Yes (deduplication skips write if target path exists).
    pub async fn write_bytes(&self, hash: &str, data: &[u8]) -> Result<(), BlobError> {
        let target_path = self.content_path(hash)?;

        // Deduplication check: if file already exists with same hash, skip write
        if tokio::fs::try_exists(&target_path).await.unwrap_or(false) {
            return Ok(());
        }

        let temp_filename = format!("upload_{}_{}.tmp", hash, uuid::Uuid::new_v4());
        let temp_path = self.tmp_dir.join(temp_filename);

        // Stream bytes to staging file
        let mut file = tokio::fs::File::create(&temp_path).await?;
        file.write_all(data).await?;
        file.sync_all().await?;
        drop(file);

        // Ensure parent directory (ab/cd) exists
        if let Some(parent) = target_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        // Atomic rename into content-addressed location
        if let Err(e) = tokio::fs::rename(&temp_path, &target_path).await {
            // If target already exists (concurrent write of same content), remove temp and succeed
            if tokio::fs::try_exists(&target_path).await.unwrap_or(false) {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Ok(());
            }
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(BlobError::Io(format!("Failed to commit blob file: {}", e)));
        }

        Ok(())
    }

    /// Opens an existing stored blob for asynchronous reading.
    pub async fn open(&self, hash: &str) -> Result<tokio::fs::File, BlobError> {
        let path = self.content_path(hash)?;
        tokio::fs::File::open(path)
            .await
            .map_err(|e| BlobError::Io(format!("Failed to open blob file: {}", e)))
    }

    /// Reads the entire content of a blob into memory.
    pub async fn read_bytes(&self, hash: &str) -> Result<Vec<u8>, BlobError> {
        let path = self.content_path(hash)?;
        tokio::fs::read(path)
            .await
            .map_err(|e| BlobError::Io(format!("Failed to read blob file: {}", e)))
    }

    /// Deletes the physical blob file from content-addressed storage.
    pub async fn remove(&self, hash: &str) -> Result<bool, BlobError> {
        let path = self.content_path(hash)?;
        if tokio::fs::try_exists(&path).await.unwrap_or(false) {
            tokio::fs::remove_file(path).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Sweeps any abandoned upload files in the staging directory.
    pub async fn sweep_orphaned_tmp(&self) -> Result<usize, BlobError> {
        let mut count = 0;
        let mut read_dir = tokio::fs::read_dir(&self.tmp_dir).await?;
        while let Ok(Some(entry)) = read_dir.next_entry().await {
            let path = entry.path();
            if path.is_file() {
                if let Ok(()) = tokio::fs::remove_file(&path).await {
                    count += 1;
                }
            }
        }
        Ok(count)
    }

    /// Exposes base directory path.
    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }

    /// Writes an individual chunk/part into upload staging storage.
    /// CONTRACT:
    ///  - Precondition: `upload_id` must consist of alphanumeric, '-', or '_' chars.
    ///  - Part numbers must be >= 1.
    ///  - Atomically creates staging folder and writes chunk file.
    pub async fn write_upload_part(&self, upload_id: &str, part_number: u32, data: &[u8]) -> Result<(), BlobError> {
        if !upload_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err(BlobError::InvalidKey("Invalid upload session id".to_string()));
        }
        let staging_dir = self.tmp_dir.join("staging").join(upload_id);
        tokio::fs::create_dir_all(&staging_dir).await?;

        let part_filename = format!("part_{:06}.part", part_number);
        let part_path = staging_dir.join(part_filename);

        let mut file = tokio::fs::File::create(&part_path).await?;
        file.write_all(data).await?;
        file.sync_all().await?;
        Ok(())
    }

    /// Assembles all ordered parts of a chunked upload into final content-addressed storage.
    /// CONTRACT:
    ///  - Streams each part in order, calculating BLAKE3 hash incrementally without holding entire file in RAM.
    ///  - Dedup: if content with identical hash exists, skips duplicate file creation.
    ///  - Atomically commits blob to content-addressed storage and purges staging directory.
    ///  - Returns `(hash, total_bytes)`.
    pub async fn assemble_upload_parts(&self, upload_id: &str, parts: &[u32]) -> Result<(String, u64), BlobError> {
        let staging_dir = self.tmp_dir.join("staging").join(upload_id);
        if !tokio::fs::try_exists(&staging_dir).await.unwrap_or(false) {
            return Err(BlobError::UploadSessionNotFound(upload_id.to_string()));
        }

        let mut sorted_parts = parts.to_vec();
        sorted_parts.sort_unstable();

        let temp_filename = format!("assembly_{}_{}.tmp", upload_id, uuid::Uuid::new_v4());
        let temp_path = self.tmp_dir.join(temp_filename);
        let mut dest_file = tokio::fs::File::create(&temp_path).await?;

        let mut hasher = crate::hash::Blake3StreamHasher::new();
        let mut buffer = vec![0u8; 64 * 1024]; // 64KB stream buffer for constant memory usage

        for part_num in &sorted_parts {
            let part_filename = format!("part_{:06}.part", part_num);
            let part_path = staging_dir.join(&part_filename);
            let mut src_file = tokio::fs::File::open(&part_path).await.map_err(|e| {
                BlobError::Io(format!("Missing part {} in staging: {}", part_num, e))
            })?;

            loop {
                use tokio::io::AsyncReadExt;
                let n = src_file.read(&mut buffer).await?;
                if n == 0 {
                    break;
                }
                hasher.update(&buffer[..n]);
                dest_file.write_all(&buffer[..n]).await?;
            }
        }

        dest_file.sync_all().await?;
        drop(dest_file);

        let hash = hasher.finalize_hex();
        let total_bytes = hasher.bytes_read();
        let target_path = self.content_path(&hash)?;

        // Deduplication check: if target already exists, drop temp file
        if tokio::fs::try_exists(&target_path).await.unwrap_or(false) {
            let _ = tokio::fs::remove_file(&temp_path).await;
        } else {
            if let Some(parent) = target_path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            if let Err(e) = tokio::fs::rename(&temp_path, &target_path).await {
                if !tokio::fs::try_exists(&target_path).await.unwrap_or(false) {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    return Err(BlobError::Io(format!("Failed to commit assembled blob: {}", e)));
                }
                let _ = tokio::fs::remove_file(&temp_path).await;
            }
        }

        // Clean up staging folder
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;

        Ok((hash, total_bytes))
    }

    /// Aborts an active upload session and cleans up its staged parts.
    pub async fn abort_upload_staging(&self, upload_id: &str) -> Result<(), BlobError> {
        let staging_dir = self.tmp_dir.join("staging").join(upload_id);
        if tokio::fs::try_exists(&staging_dir).await.unwrap_or(false) {
            tokio::fs::remove_dir_all(staging_dir).await?;
        }
        Ok(())
    }

    /// Verifies physical file integrity against its expected BLAKE3 hash.
    /// Returns `Ok(true)` if intact, `Ok(false)` on checksum mismatch.
    pub async fn scrub_file(&self, hash: &str) -> Result<bool, BlobError> {
        let path = self.content_path(hash)?;
        if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
            return Ok(false);
        }

        use tokio::io::AsyncReadExt;
        let mut file = tokio::fs::File::open(path).await?;
        let mut hasher = crate::hash::Blake3StreamHasher::new();
        let mut buffer = vec![0u8; 64 * 1024];

        loop {
            let n = file.read(&mut buffer).await?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }

        let actual = hasher.finalize_hex();
        Ok(crate::hash::constant_time_eq(&actual, hash))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_file_store_lifecycle() {
        let tmp = tempfile::tempdir().unwrap();
        let store = FileStore::new(tmp.path()).await.unwrap();

        let dummy_hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let payload = b"large binary data payload for test";

        assert!(!store.exists(dummy_hash).await);

        store.write_bytes(dummy_hash, payload).await.unwrap();
        assert!(store.exists(dummy_hash).await);

        let read_back = store.read_bytes(dummy_hash).await.unwrap();
        assert_eq!(&read_back[..], payload);

        // Test deduplication on re-write
        store.write_bytes(dummy_hash, payload).await.unwrap();
        assert!(store.exists(dummy_hash).await);

        let removed = store.remove(dummy_hash).await.unwrap();
        assert!(removed);
        assert!(!store.exists(dummy_hash).await);
    }
}
