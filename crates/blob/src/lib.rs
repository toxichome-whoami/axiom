/*
 * Axiom Native Blob Engine — High-performance embedded object storage subsystem.
 * Owned by: blob
 * Key deps: fjall, blake3, tokio, axiom-core
 * Invariants: Content-addressed deduplication; BLAKE3 integrity guarantees; zero external daemons.
 * Last structural change: Initial implementation of Phase 1 Blob Engine.
 */

pub mod engine;
pub mod error;
pub mod hash;
pub mod index;
pub mod models;
pub mod store;
pub mod tickets;
pub mod validation;

pub use engine::{BlobData, BlobEngine};
pub use error::BlobError;
pub use hash::{constant_time_eq, hash_bytes, Blake3StreamHasher};
pub use models::{BlobEntry, BlobMetadata, BlobStats, ByteRange, ContentRef, ListResult, UploadSession};
pub use tickets::{generate_ticket, verify_ticket, SignedTicket};
pub use validation::{validate_key, validate_namespace};
