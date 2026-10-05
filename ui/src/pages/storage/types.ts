/*
 * Storage type definitions for Axiom Drive filesystem interface.
 * Owned by: ui/pages/storage
 * Key deps: ../../types (BlobEntry, BlobStats, NamespaceInfo)
 * Invariants: Items are discriminated by type ('folder' | 'file'); fullKey is canonical path.
 * Last structural change: Initial modularization for Drive-style storage architecture.
 */

import { BlobEntry, BlobStats, NamespaceInfo } from '../../types';

export type StorageViewMode = 'list' | 'grid';

export interface StorageItem {
  id: string;
  type: 'folder' | 'file';
  name: string;
  fullKey: string;
  size?: number;
  itemCount?: number;
  totalBytes?: number;
  inline?: boolean;
  content_type?: string;
  hash?: string;
  created_at?: number;
  rawBlob?: BlobEntry;
}

export interface ClipboardState {
  mode: 'copy' | 'cut';
  namespace: string;
  key: string;
  name: string;
  isFolder: boolean;
}

export type StorageTierFilter = 'all' | 'inline' | 'disk';
