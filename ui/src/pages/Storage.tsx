/*
 * Native embedded blob storage management interface for Axiom.
 * Owned by: ui/pages
 * Key deps: ./storage/StoragePage
 * Invariants: Content-addressed objects identified by BLAKE3 hash; Drive-style explorer.
 * Last structural change: Modularized into Drive-style storage architecture.
 */

export { StoragePage as Storage } from './storage/StoragePage';
export type { StorageItem } from './storage/types';
