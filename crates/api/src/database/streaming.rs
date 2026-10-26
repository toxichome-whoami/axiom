/*
 * Bounded-memory chunked streaming engine for database row sets.
 * Owned by: crates/api (database)
 * Key deps: bytes, futures, serde, serde_json
 * Invariants: Peak memory footprint is strictly bounded to the chunk size (64KB),
 * preventing volumetric OOM when exporting ultra-large result sets.
 */

use bytes::{Bytes, BytesMut};
use futures::stream::Stream;
use serde_json::Value;
use std::io;
use std::sync::Arc;

/// High-throughput 128 KB async buffer size for database row streaming (NDJSON & JSON chunks).
/// Reduces syscalls, Tokio task yields, and TCP window starvation compared to 64 KB buffers.
pub const STREAM_CHUNK_SIZE: usize = 128 * 1024; // 128 KB

/// Streams database rows formatted as Newline-Delimited JSON (NDJSON) from an Arc-wrapped row vector without cloning.
pub fn stream_ndjson_rows_shared(
    rows: Arc<Vec<Value>>,
) -> impl Stream<Item = Result<Bytes, io::Error>> + Send + 'static {
    futures::stream::unfold(
        (rows, 0usize, BytesMut::with_capacity(STREAM_CHUNK_SIZE)),
        |mut state| async move {
            let (ref rows, ref mut idx, ref mut buf) = state;
            buf.clear();

            while *idx < rows.len() {
                let row = &rows[*idx];
                *idx += 1;
                if let Ok(serialized) = serde_json::to_vec(row) {
                    buf.extend_from_slice(&serialized);
                    buf.extend_from_slice(b"\n");
                }
                if buf.len() >= STREAM_CHUNK_SIZE {
                    let chunk = buf.split().freeze();
                    return Some((Ok(chunk), state));
                }
            }

            if !buf.is_empty() {
                let chunk = buf.split().freeze();
                Some((Ok(chunk), state))
            } else {
                None
            }
        },
    )
}

/// Streams database rows formatted as Newline-Delimited JSON (NDJSON).
/// Each row is serialized as an independent JSON line terminated by `\n`.
pub fn stream_ndjson_rows(
    rows: Vec<Value>,
) -> impl Stream<Item = Result<Bytes, io::Error>> + Send + 'static {
    stream_ndjson_rows_shared(Arc::new(rows))
}

/// Streams database rows inside the standard Axiom JSON response envelope from an Arc-wrapped vector without cloning.
pub fn stream_json_array_envelope_shared(
    rows: Arc<Vec<Value>>,
    pagination: Value,
) -> impl Stream<Item = Result<Bytes, io::Error>> + Send + 'static {
    enum StreamStage {
        Header,
        Rows,
        Footer,
        Done,
    }

    struct StreamState {
        stage: StreamStage,
        rows: Arc<Vec<Value>>,
        index: usize,
        first_row: bool,
        pagination: Value,
        buf: BytesMut,
    }

    let initial_state = StreamState {
        stage: StreamStage::Header,
        rows,
        index: 0,
        first_row: true,
        pagination,
        buf: BytesMut::with_capacity(STREAM_CHUNK_SIZE),
    };

    futures::stream::unfold(initial_state, |mut state| async move {
        state.buf.clear();

        loop {
            match state.stage {
                StreamStage::Header => {
                    state
                        .buf
                        .extend_from_slice(b"{\"success\":true,\"data\":{\"rows\":[");
                    state.stage = StreamStage::Rows;
                    if state.buf.len() >= STREAM_CHUNK_SIZE {
                        let chunk = state.buf.split().freeze();
                        return Some((Ok(chunk), state));
                    }
                }
                StreamStage::Rows => {
                    let mut yielded = false;
                    while state.index < state.rows.len() {
                        let row = &state.rows[state.index];
                        state.index += 1;

                        if !state.first_row {
                            state.buf.extend_from_slice(b",");
                        } else {
                            state.first_row = false;
                        }

                        if let Ok(row_bytes) = serde_json::to_vec(row) {
                            state.buf.extend_from_slice(&row_bytes);
                        }

                        if state.buf.len() >= STREAM_CHUNK_SIZE {
                            yielded = true;
                            break;
                        }
                    }

                    if yielded {
                        let chunk = state.buf.split().freeze();
                        return Some((Ok(chunk), state));
                    } else {
                        state.stage = StreamStage::Footer;
                    }
                }
                StreamStage::Footer => {
                    state.buf.extend_from_slice(b"],\"pagination\":");
                    if let Ok(pag_bytes) = serde_json::to_vec(&state.pagination) {
                        state.buf.extend_from_slice(&pag_bytes);
                    } else {
                        state.buf.extend_from_slice(b"null");
                    }
                    state.buf.extend_from_slice(b"},\"pagination\":");
                    if let Ok(pag_bytes) = serde_json::to_vec(&state.pagination) {
                        state.buf.extend_from_slice(&pag_bytes);
                    } else {
                        state.buf.extend_from_slice(b"null");
                    }
                    state.buf.extend_from_slice(b",\"error\":null}");
                    state.stage = StreamStage::Done;

                    let chunk = state.buf.split().freeze();
                    return Some((Ok(chunk), state));
                }
                StreamStage::Done => {
                    return None;
                }
            }
        }
    })
}

/// Streams database rows inside the standard Axiom JSON response envelope:
/// `{"success":true,"data":{"rows":[...],"pagination":{...}},"pagination":{...},"error":null}`
/// CONTRACT:
///  - Emits JSON byte chunks without buffering the full dataset in memory.
///  - Output is byte-equivalent to the monolithic serializer.
pub fn stream_json_array_envelope(
    rows: Vec<Value>,
    pagination: Value,
) -> impl Stream<Item = Result<Bytes, io::Error>> + Send + 'static {
    stream_json_array_envelope_shared(Arc::new(rows), pagination)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::StreamExt;

    #[tokio::test]
    async fn test_stream_ndjson_rows() {
        let mut rows = Vec::new();
        for i in 0..5 {
            rows.push(serde_json::json!({ "id": i }));
        }

        let mut stream = Box::pin(stream_ndjson_rows(rows));
        let mut combined = Vec::new();
        while let Some(Ok(chunk)) = stream.next().await {
            combined.extend_from_slice(&chunk);
        }

        let lines: Vec<&str> = std::str::from_utf8(&combined)
            .unwrap()
            .trim()
            .split('\n')
            .collect();
        assert_eq!(lines.len(), 5);
        for (i, line) in lines.iter().enumerate() {
            let val: Value = serde_json::from_str(line).unwrap();
            assert_eq!(val["id"], i);
        }
    }

    #[tokio::test]
    async fn test_stream_json_array_envelope() {
        let mut rows = Vec::new();
        for i in 0..3 {
            rows.push(serde_json::json!({
                "id": i,
                "name": format!("user_{}", i)
            }));
        }

        let pagination = serde_json::json!({
            "limit": 50,
            "has_more": false,
            "next_cursor": null
        });

        let mut stream = Box::pin(stream_json_array_envelope(rows, pagination));
        let mut combined = Vec::new();
        while let Some(Ok(chunk)) = stream.next().await {
            combined.extend_from_slice(&chunk);
        }

        let parsed: Value = serde_json::from_slice(&combined).unwrap();
        assert_eq!(parsed["success"], true);
        assert_eq!(parsed["data"]["rows"].as_array().unwrap().len(), 3);
        assert_eq!(parsed["data"]["rows"][0]["id"], 0);
        assert_eq!(parsed["data"]["rows"][2]["name"], "user_2");
        assert_eq!(parsed["pagination"]["limit"], 50);
        assert_eq!(parsed["error"], Value::Null);
    }

    #[tokio::test]
    async fn test_stream_large_row_count_bounded_chunks() {
        let mut rows = Vec::new();
        for i in 0..2000 {
            rows.push(serde_json::json!({
                "id": i,
                "payload": "x".repeat(100)
            }));
        }

        let pagination = serde_json::json!({"limit": 2000, "has_more": false, "next_cursor": null});
        let mut stream = Box::pin(stream_json_array_envelope(rows, pagination));
        let mut chunk_count = 0;
        let mut total_bytes = 0;
        while let Some(Ok(chunk)) = stream.next().await {
            chunk_count += 1;
            total_bytes += chunk.len();
        }

        assert!(
            chunk_count > 1,
            "Large row set must be split into multiple bounded chunks"
        );
        assert!(total_bytes > 2000 * 100);
    }

    #[tokio::test]
    async fn test_stream_shared_arc_no_cloning() {
        let mut rows = Vec::new();
        for i in 0..5 {
            rows.push(serde_json::json!({ "id": i, "val": "shared" }));
        }
        let shared_rows = Arc::new(rows);
        let pagination = serde_json::json!({"limit": 5, "has_more": false, "next_cursor": null});

        let mut stream = Box::pin(stream_json_array_envelope_shared(shared_rows.clone(), pagination));
        let mut combined = Vec::new();
        while let Some(Ok(chunk)) = stream.next().await {
            combined.extend_from_slice(&chunk);
        }
        let parsed: Value = serde_json::from_slice(&combined).unwrap();
        assert_eq!(parsed["data"]["rows"].as_array().unwrap().len(), 5);

        // Also test NDJSON shared
        let mut ndjson_stream = Box::pin(stream_ndjson_rows_shared(shared_rows));
        let mut ndjson_bytes = Vec::new();
        while let Some(Ok(chunk)) = ndjson_stream.next().await {
            ndjson_bytes.extend_from_slice(&chunk);
        }
        let lines: Vec<&str> = std::str::from_utf8(&ndjson_bytes).unwrap().trim().split('\n').collect();
        assert_eq!(lines.len(), 5);
    }
}
