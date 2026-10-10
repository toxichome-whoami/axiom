export type EngineType =
  | 'PostgreSQL'
  | 'MySQL'
  | 'MSSQL'
  | 'ClickHouse'
  | 'LibSQL'
  | 'POSTGRESQL'
  | 'MYSQL'
  | 'MSSQL'
  | 'CLICKHOUSE'
  | 'LIBSQL';

export function formatEngine(engine: string): string {
  if (!engine) return '';
  const norm = engine.trim().toLowerCase();
  switch (norm) {
    case 'postgresql':
    case 'postgres':
      return 'PostgreSQL';
    case 'mysql':
      return 'MySQL';
    case 'mariadb':
      return 'MariaDB';
    case 'mssql':
    case 'sqlserver':
      return 'MSSQL';
    case 'clickhouse':
      return 'ClickHouse';
    case 'libsql':
    case 'sqlite':
      return 'LibSQL';
    default:
      return engine.charAt(0).toUpperCase() + engine.slice(1).toLowerCase();
  }
}

export interface DatabasePool {
  alias: string;
  engine: EngineType;
  version?: string;
  url: string;
  minConnections: number;
  maxConnections: number;
  idleTimeoutSeconds: number;
  readonly: boolean;
  status: 'Ready' | 'Degraded' | 'Offline';
  latencyMs: number;
}

export interface RetiringSecret {
  maskedSecret: string;
  expiresAt: string;
  expiresTimestamp: number;
  gracePeriod: string;
}

export interface ApiKey {
  name: string;
  role: string;
  rateLimit: number;
  status: 'Active' | 'Revoked' | 'Expired';
  expiresAt: string | null;
  createdAt: string;
  currentSecretMasked?: string;
  retiringSecret?: RetiringSecret | null;
}

export type DbOperation = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
export type BlobOperation = 'READ' | 'WRITE' | 'DELETE';
export type PermissionOperation = DbOperation | BlobOperation | '*';

export interface PermissionRule {
  database: string;
  table: string;
  operations: (PermissionOperation | string)[];
  resourceType?: 'database' | 'blob';
}

export interface RbacRole {
  name: string;
  description: string;
  createdAt: string;
  permissions: { database: string; table: string; operations: string[] }[];
}

export interface McpTool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  permissionRequired: string;
}

export interface AdminUser {
  username: string;
  email: string;
  createdAt: string;
}

export interface ApiRoutePreset {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  defaultBody: string;
  defaultParams: string;
}

export interface BlobMetadata {
  hash: string;
  size: number;
  content_type: string;
  created_at: number;
  inline: boolean;
}

export interface BlobEntry {
  namespace: string;
  key: string;
  hash: string;
  size: number;
  content_type: string;
  created_at: number;
  inline: boolean;
}

export interface BlobStats {
  total_objects: number;
  unique_blobs: number;
  total_logical_bytes: number;
  total_physical_bytes: number;
  dedup_saved_bytes: number;
  inline_objects: number;
  file_objects: number;
}

export interface ListBlobsResult {
  items: BlobEntry[];
  next_cursor: string | null;
}

export interface NamespaceInfo {
  name: string;
  created_at: number;
  max_bytes: number | null;
  total_objects: number;
  total_bytes: number;
}

// ─── Table Editor & Schema Types ─────────────────────────────────────────────

export interface ColumnInfoApi {
  name: string;
  type: string;
  nullable: boolean;
  primary_key: boolean;
}

export interface ForeignKeyInfoApi {
  column: string;
  referenced_table: string;
  referenced_column: string;
}

export interface TableInfoApi {
  name: string;
  row_count_estimate: number;
  columns?: ColumnInfoApi[];
  foreign_keys?: ForeignKeyInfoApi[];
}

export interface TableRowsResponse {
  rows: Record<string, unknown>[];
  pagination: {
    limit: number;
    has_more: boolean;
    next_cursor: string | null;
  };
}

export interface QueryResultApi {
  success?: boolean;
  columns?: string[];
  rows?: Record<string, unknown>[];
  affected_rows?: number;
  truncated?: boolean;
  next_cursor?: string;
  duration_ms?: number;
}

