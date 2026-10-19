/*
 * Peer-to-peer cluster mesh coordination module for multi-node deployments without external database dependencies.
 * Owned by: api::cluster
 * Key deps: axum, reqwest, axiom-metadata
 * Invariants: Operates over embedded SQLite; enforces cryptographic mutual handshakes and packet signing.
 */

pub mod broadcaster;
pub mod handlers;
pub mod router;
pub mod signing;

pub use broadcaster::ClusterBroadcaster;
pub use router::cluster_router;
