use dashmap::DashMap;
use once_cell::sync::Lazy;

// Simple in-memory tracker for chunked upload sessions
// In a real prod setup, this would be backed by Redis for multi-node support.
static UPLOAD_SESSIONS: Lazy<DashMap<String, serde_json::Value>> = Lazy::new(DashMap::new);

pub struct ChunkedUploadManager;

impl ChunkedUploadManager {
    pub fn initiate(upload_id: &str, session_data: serde_json::Value) {
        UPLOAD_SESSIONS.insert(upload_id.to_string(), session_data);
    }

    pub fn get_session(upload_id: &str) -> Option<serde_json::Value> {
        UPLOAD_SESSIONS.get(upload_id).map(|v| v.clone())
    }

    pub fn cancel(upload_id: &str) {
        UPLOAD_SESSIONS.remove(upload_id);
    }

    pub fn update_progress(
        upload_id: &str,
        chunk_index: usize,
        bytes_written: u64,
    ) -> Result<(), String> {
        if let Some(mut session) = UPLOAD_SESSIONS.get_mut(upload_id) {
            if let Some(obj) = session.as_object_mut() {
                if let Some(uploaded_bytes) = obj.get_mut("uploaded_bytes") {
                    if let Some(val) = uploaded_bytes.as_u64() {
                        *uploaded_bytes = serde_json::Value::Number((val + bytes_written).into());
                    }
                }

                if let Some(uploaded_chunks) = obj.get_mut("uploaded_chunks") {
                    if let Some(arr) = uploaded_chunks.as_array_mut() {
                        arr.push(serde_json::Value::Number(chunk_index.into()));
                    }
                }
                return Ok(());
            }
        }
        Err("Session not found".to_string())
    }

    pub async fn finalize(upload_id: &str, target_path: &str) -> Result<serde_json::Value, String> {
        if let Some((_, session)) = UPLOAD_SESSIONS.remove(upload_id) {
            // In a full implementation we would concatenate temp chunk files here.
            // For this stub, we assume the chunks were appended sequentially to target_path,
            // or we're skipping actual merge for simplicity.

            Ok(serde_json::json!({
                "status": "finalized",
                "size": session.get("total_size").unwrap_or(&serde_json::Value::Number(0.into())),
                "path": target_path
            }))
        } else {
            Err("Session not found or expired".to_string())
        }
    }
}
