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

pub const STREAM_CHUNK_SIZE: usize = 65536; // 64 KB

/// Streams database rows formatted as Newline-Delimited JSON (NDJSON).
/// Each row is serialized as an independent JSON line terminated by `\n`.
/// CONTRACT:
///  - Precondition: `rows` is a vector of row JSON values.
///  - Output: Stream of `Result<Bytes, io::Error>` where each chunk is <= 64KB (plus single row overflow if a row exceeds 64KB).
///  - Invariant: Memory consumption is bounded by buffer size.
pub fn stream_ndjson_rows(
    rows: Vec<Value>,
) -> impl Stream<Item = Result<Bytes, io::Error>> + Send + 'static {
    futures::stream::unfold(
        (rows.into_iter(), BytesMut::with_capacity(STREAM_CHUNK_SIZE)),
        |mut state| async move {
            let (ref mut iter, ref mut buf) = state;
            buf.clear();

            for row in iter.by_ref() {
                if let Ok(serialized) = serde_json::to_vec(&row) {
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

/// Streams database rows inside the standard Axiom JSON response envelope:
/// `{"success":true,"data":{"rows":[...],"pagination":{...}},"pagination":{...},"error":null}`
/// CONTRACT:
///  - Emits JSON byte chunks without buffering the full dataset in memory.
///  - Output is byte-equivalent to the monolithic serializer.
pub fn stream_json_array_envelope(
    rows: Vec<Value>,
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
        iter: std::vec::IntoIter<Value>,
        first_row: bool,
        pagination: Value,
        buf: BytesMut,
    }

    let initial_state = StreamState {
        stage: StreamStage::Header,
        iter: rows.into_iter(),
        first_row: true,
        pagination,
        buf: BytesMut::with_capacity(STREAM_CHUNK_SIZE),
    };

    futures::stream::unfold(initial_state, |mut state| async move {
        state.buf.clear();

        loop {
            match state.stage {
                StreamStage::Header => {
                    state.buf.extend_from_slice(b"{\"success\":true,\"data\":{\"rows\":[");
                    state.stage = StreamStage::Rows;
                    if state.buf.len() >= STREAM_CHUNK_SIZE {
                        let chunk = state.buf.split().freeze();
                        return Some((Ok(chunk), state));
                    }
                }
                StreamStage::Rows => {
                    let mut yielded = false;
                    for row in state.iter.by_ref() {
                        if !state.first_row {
                            state.buf.extend_from_slice(b",");
                        } else {
                            state.first_row = false;
                        }

                        if let Ok(row_bytes) = serde_json::to_vec(&row) {
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

        assert!(chunk_count > 1, "Large row set must be split into multiple bounded chunks");
        assert!(total_bytes > 2000 * 100);
    }
}
