/*
 * Content-addressed file storage manager for large binary blobs on local SSD/NVMe.
 * Owned by: blob
 * Key deps: tokio::fs, std::path::PathBuf
 * Invariants: Disk paths derive strictly from the 64-character BLAKE3 hash; writes use temp file + sync + atomic rename.
 * Last structural change: Initial implementation of Phase 1 Blob Engine.
 */

use crate::error::BlobError;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};

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

    /// Computes the isolated staging directory for an active upload session.
    pub fn staging_dir(&self, upload_id: &str) -> Result<PathBuf, BlobError> {
        if !upload_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err(BlobError::InvalidKey("Invalid upload session id".to_string()));
        }
        Ok(self.tmp_dir.join("staging").join(upload_id))
    }

    /// Computes the path to the staged append-only resumable payload file.
    pub fn staging_data_path(&self, upload_id: &str) -> Result<PathBuf, BlobError> {
        Ok(self.staging_dir(upload_id)?.join("data.bin"))
    }

    /// Returns the exact number of bytes successfully persisted on disk for an upload session.
    pub async fn get_staging_size(&self, upload_id: &str) -> Result<u64, BlobError> {
        let path = self.staging_data_path(upload_id)?;
        if tokio::fs::try_exists(&path).await.unwrap_or(false) {
            let meta = tokio::fs::metadata(&path).await?;
            Ok(meta.len())
        } else {
            Ok(0)
        }
    }

    /// Streams an incoming byte range directly into the staging file starting at `offset`.
    /// CONTRACT:
    ///  - If `offset > current_size`, returns `BlobError::OffsetMismatch` (gap protection).
    ///  - If `offset < current_size`, truncates file back to `offset` (prevents duplicate / stale trailing bytes).
    ///  - Writes in bounded 64KB chunks to guarantee O(1) RAM usage.
    ///  - Calls `file.sync_data()` before returning to guarantee physical durability.
    pub async fn write_resumable_stream<R: AsyncRead + Unpin>(
        &self,
        upload_id: &str,
        offset: u64,
        reader: &mut R,
        max_bytes: Option<u64>,
    ) -> Result<u64, BlobError> {
        let staging_dir = self.staging_dir(upload_id)?;
        tokio::fs::create_dir_all(&staging_dir).await?;

        let data_path = self.staging_data_path(upload_id)?;
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&data_path)
            .await?;

        let curr_len = file.metadata().await?.len();
        if offset > curr_len {
            return Err(BlobError::OffsetMismatch {
                expected: curr_len,
                actual: offset,
            });
        }

        if curr_len > offset {
            file.set_len(offset).await?;
        }
        file.seek(SeekFrom::Start(offset)).await?;

        let mut buffer = vec![0u8; 64 * 1024];
        let mut bytes_written = 0u64;

        loop {
            let to_read = match max_bytes {
                Some(limit) => {
                    let rem = limit.saturating_sub(bytes_written);
                    if rem == 0 {
                        break;
                    }
                    (buffer.len() as u64).min(rem) as usize
                }
                None => buffer.len(),
            };

            let n = reader.read(&mut buffer[..to_read]).await?;
            if n == 0 {
                break;
            }

            file.write_all(&buffer[..n]).await?;
            bytes_written += n as u64;
        }

        file.sync_data().await?;
        Ok(bytes_written)
    }

    /// Sets staging file length directly for sparse file tests without physical disk allocation.
    pub async fn set_staging_len_for_test(&self, upload_id: &str, len: u64) -> Result<(), BlobError> {
        let staging_dir = self.staging_dir(upload_id)?;
        tokio::fs::create_dir_all(&staging_dir).await?;
        let data_path = self.staging_data_path(upload_id)?;
        let file = tokio::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&data_path)
            .await?;
        file.set_len(len).await?;
        file.sync_all().await?;
        Ok(())
    }

    /// Finalizes a resumable upload session: hashes staging data incrementally,
    /// performs zero-copy commit into content-addressed storage, and purges staging directory.
    pub async fn finalize_resumable_upload(&self, upload_id: &str) -> Result<(String, u64), BlobError> {
        let staging_dir = self.staging_dir(upload_id)?;
        let data_path = self.staging_data_path(upload_id)?;

        if tokio::fs::try_exists(&data_path).await.unwrap_or(false) {
            let mut file = tokio::fs::File::open(&data_path).await?;
            let mut hasher = crate::hash::Blake3StreamHasher::new();
            let mut buffer = vec![0u8; 64 * 1024];

            loop {
                let n = file.read(&mut buffer).await?;
                if n == 0 {
                    break;
                }
                hasher.update(&buffer[..n]);
            }
            drop(file);

            let hash = hasher.finalize_hex();
            let total_bytes = hasher.bytes_read();
            let target_path = self.content_path(&hash)?;

            // Content-addressed deduplication: if identical payload exists, discard temp file
            if tokio::fs::try_exists(&target_path).await.unwrap_or(false) {
                let _ = tokio::fs::remove_file(&data_path).await;
            } else {
                if let Some(parent) = target_path.parent() {
                    tokio::fs::create_dir_all(parent).await?;
                }
                if let Err(e) = tokio::fs::rename(&data_path, &target_path).await {
                    if !tokio::fs::try_exists(&target_path).await.unwrap_or(false) {
                        let _ = tokio::fs::remove_file(&data_path).await;
                        return Err(BlobError::Io(format!("Failed to commit resumable blob: {}", e)));
                    }
                    let _ = tokio::fs::remove_file(&data_path).await;
                }
            }

            let _ = tokio::fs::remove_dir_all(&staging_dir).await;
            Ok((hash, total_bytes))
        } else {
            // Check for legacy multipart upload parts
            let mut part_numbers = Vec::new();
            if tokio::fs::try_exists(&staging_dir).await.unwrap_or(false) {
                let mut read_dir = tokio::fs::read_dir(&staging_dir).await?;
                while let Ok(Some(entry)) = read_dir.next_entry().await {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with("part_") && name.ends_with(".part") {
                        if let Ok(num) = name["part_".len()..name.len() - ".part".len()].parse::<u32>() {
                            part_numbers.push(num);
                        }
                    }
                }
            }

            if !part_numbers.is_empty() {
                self.assemble_upload_parts(upload_id, &part_numbers).await
            } else {
                Err(BlobError::UploadSessionNotFound(format!(
                    "No staged upload data found for session '{}'",
                    upload_id
                )))
            }
        }
    }

    /// Writes an individual chunk/part into upload staging storage.
    /// CONTRACT:
    ///  - Precondition: `upload_id` must consist of alphanumeric, '-', or '_' chars.
    ///  - Part numbers must be >= 1.
    ///  - Atomically creates staging folder and writes chunk file.
    pub async fn write_upload_part(&self, upload_id: &str, part_number: u32, data: &[u8]) -> Result<(), BlobError> {
        let staging_dir = self.staging_dir(upload_id)?;
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
        let staging_dir = self.staging_dir(upload_id)?;
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
        let staging_dir = self.staging_dir(upload_id)?;
        if tokio::fs::try_exists(&staging_dir).await.unwrap_or(false) {
            tokio::fs::remove_dir_all(staging_dir).await?;
        }
        Ok(())
    }

    /// Sweeps orphaned staging directories that do not belong to active sessions.
    pub async fn sweep_orphaned_staging(&self, active_upload_ids: &std::collections::HashSet<String>) -> Result<usize, BlobError> {
        let staging_root = self.tmp_dir.join("staging");
        if !tokio::fs::try_exists(&staging_root).await.unwrap_or(false) {
            return Ok(0);
        }
        let mut count = 0;
        let mut read_dir = tokio::fs::read_dir(&staging_root).await?;
        while let Ok(Some(entry)) = read_dir.next_entry().await {
            let path = entry.path();
            if path.is_dir() {
                if let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) {
                    if !active_upload_ids.contains(dir_name) {
                        if let Ok(()) = tokio::fs::remove_dir_all(&path).await {
                            count += 1;
                        }
                    }
                }
            }
        }
        Ok(count)
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
