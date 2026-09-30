export type EngineType = 'POSTGRESQL' | 'MYSQL' | 'MSSQL' | 'CLICKHOUSE' | 'LIBSQL';

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

export interface ApiKey {
  name: string;
  role: string;
  rateLimit: number;
  status: 'Active' | 'Revoked' | 'Expired';
  expiresAt: string | null;
  createdAt: string;
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
  permissions: PermissionRule[];
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

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  status: '200 OK' | '403 Forbidden' | '404 Not Found' | '500 Internal';
  durationMs: number;
  ipAddress?: string;
  details?: Record<string, any>;
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
