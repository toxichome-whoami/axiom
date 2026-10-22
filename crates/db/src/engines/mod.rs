/*
 * Database engine implementations across PostgreSQL, MySQL, MariaDB, MSSQL, LibSQL, and ClickHouse.
 * Owned by: crates/db (engines)
 * Key deps: sqlx, tiberius, libsql, reqwest
 * Invariants: All engine adapters implement DatabaseEngine trait and normalize schema metadata to uniform structs.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

pub mod base;
pub mod clickhouse;
pub mod libsql;
pub mod mssql;
pub mod mysql;
pub mod postgres;
