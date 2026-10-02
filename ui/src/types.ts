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

export type PermissionOperation = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

export interface PermissionRule {
  database: string;
  table: string;
  operations: PermissionOperation[];
}

export interface RbacRole {
  name: string;
  description: string;
  createdAt: string;
  permissions: { database: string; table: string; operations: ('SELECT' | 'INSERT' | 'UPDATE' | 'DELETE')[] }[];
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
