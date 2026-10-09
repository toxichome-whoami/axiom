/*
 * Typed HTTP client interface connecting the UI directly to the Axiom Admin API.
 * Owned by: ui/api
 * Key deps: native fetch, types.ts
 * Invariants: All requests carry credentials and session token; errors are normalized to typed AxiomError objects.
 * Last structural change: Initial implementation connecting frontend directly to live Axiom backend endpoints.
 */

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    request_id?: string;
    duration_ms?: number;
    cached?: boolean;
  };
  error: {
    code: string;
    message: string;
  } | null;
}

export interface SystemStatusData {
  version: string;
  status: string;
  active_keys: number;
  active_databases: number;
  snapshot_loaded_at: number;
  current_time: number;
}

export interface HealthData {
  status: 'healthy' | 'degraded';
  uptime_seconds: number;
  system: {
    cpu_percent: number;
    memory_used_mb: number;
  };
  databases: Record<string, 'up' | 'down'>;
}

export interface DatabaseRecordApi {
  alias: string;
  engine: string;
  pool_min: number;
  pool_max: number;
  created_at: number;
}

export interface ApiKeyRecordApi {
  name: string;
  role_name: string | null;
  rate_limit: number;
  expires_at: number | null;
  created_at: number;
}

export interface PermissionRecordApi {
  id?: number;
  role_name?: string;
  database: string;
  table_name: string;
  operations: string[];
}

export interface RoleRecordApi {
  name: string;
  description: string | null;
  created_at: number;
  permissions: PermissionRecordApi[];
}

export interface CacheStatsApi {
  hits_l1?: number;
  hits_l2?: number;
  misses?: number;
  evictions?: number;
  entries_count?: number;
  hit_rate_pct?: number;
  memory_bytes_approx?: number;

  // Legacy aliases
  l1_hits?: number;
  l1_misses?: number;
  l2_hits?: number;
  l2_misses?: number;
  entries?: number;
  hit_ratio_percent?: number;
  memory_bytes?: number;
}

export interface MetricsSnapshotApi {
  http_requests_total?: number;
  http_errors_total?: number;
  queries_total?: number;
  auth_failures_total?: number;
  rate_limit_rejections_total?: number;
  process_uptime_seconds?: number;

  // Legacy aliases
  requests_total?: number;
  errors_total?: number;
  cache_hits_total?: number;
  cache_misses_total?: number;
  [key: string]: unknown;
}

export interface AuditRecordApi {
  id: number;
  timestamp: number;
  actor: string;
  action: string;
  target: string;
  details: string | null;
}

export interface UserRecordApi {
  id: number;
  username: string;
  created_at: number;
}

import { getSessionToken, clearSession } from './session';
import type { BlobMetadata, BlobStats, ListBlobsResult, NamespaceInfo } from '../types';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

const CODE_MAP: Record<string, string> = {
  UNAUTHORIZED: 'Authentication required or session expired',
  FORBIDDEN: 'Access denied: insufficient administrative privileges',
  NOT_FOUND: 'Requested resource does not exist',
  RATE_LIMIT_EXCEEDED: 'Rate limit exceeded. Please wait before retrying',
  SERVICE_UNAVAILABLE: 'Upstream database or service temporarily unavailable',
  DB_CONNECTION_FAILED: 'Could not connect to the specified database',
  DB_QUERY_FAILED: 'Query execution failed on target database',
  INVALID_CREDENTIALS: 'Invalid username or password',
  SETUP_ALREADY_COMPLETED: 'Setup wizard is permanently finalized',
};

function resolveEndpoint(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    throw new Error('Absolute URLs are prohibited for internal API calls');
  }
  return `${API_BASE}${endpoint}`;
}

// ─── Network Request Utility ─────────────────────────────────────────────────
// Ensures session tokens from session manager and cookies are sent with every call.

/**
 * Executes a typed HTTP request against the Axiom backend API.
 * CONTRACT:
 *  - Automatically attaches session credentials and Authorization header.
 *  - Dispatches 'axiom:unauthorized' event on 401 or 403 responses.
 *  - 15-second AbortController timeout prevents hung requests.
 *  - Rejects if server responds with error or non-2xx status.
 *  - Sanitizes error messages to protect against server detail leakage.
 * @param endpoint Relative URL starting with /admin/v1 or /api/v1
 * @param options Standard RequestInit options
 */
async function request<T>(
  endpoint: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const token = getSessionToken();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && token !== 'undefined' && token !== 'null' && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Configurable abort timeout prevents UI locks on hung network calls (defaults to 15s)
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => controller.abort());
    }
  }

  try {
    const targetUrl = resolveEndpoint(endpoint);
    const res = await fetch(targetUrl, {
      ...options,
      headers,
      signal: controller.signal,
      credentials: 'include',
    });

    if (res.status === 401 || res.status === 403) {
      clearSession();
      window.dispatchEvent(new CustomEvent('axiom:unauthorized', { detail: { status: res.status } }));
    }

    const text = await res.text();
    let json: ApiResponse<T>;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Unexpected server response (HTTP ${res.status})`);
    }

    if (!res.ok || !json.success) {
      const code = json.error?.code;
      const sanitized = (code && CODE_MAP[code]) || json.error?.message || `Request failed (HTTP ${res.status})`;
      throw new Error(sanitized);
    }

    return json.data;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Admin API Operations ────────────────────────────────────────────────────

export const api = {
  // Status & Telemetry
  getStatus: () => request<SystemStatusData>('/admin/v1/status'),
  getHealth: () => request<HealthData>('/admin/v1/health'),
  reloadMetadata: () => request<{ message: string; active_keys: number; active_databases: number }>('/admin/v1/reload', { method: 'POST' }),

  // Managed Databases
  listDatabases: () => request<{ databases: DatabaseRecordApi[] }>('/admin/v1/databases'),
  addDatabase: (data: { alias: string; url: string; engine?: string; pool_min?: number; pool_max?: number; old_alias?: string }) =>
    request<{ alias: string; message: string }>('/admin/v1/databases', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteDatabase: (alias: string) =>
    request<{ message: string }>(`/admin/v1/databases/${encodeURIComponent(alias)}`, {
      method: 'DELETE',
    }),
  testDatabase: (alias: string) =>
    request<{ alias: string; status: 'up' | 'down' | 'connected'; dialect: string }>(`/admin/v1/databases/${encodeURIComponent(alias)}/test`),

  // API Key Vault
  listKeys: () => request<{ keys: ApiKeyRecordApi[] }>('/admin/v1/keys'),
  createKey: (data: { name: string; role?: string; secret?: string; rate_limit?: number; expires_at?: number | null }) =>
    request<{ name: string; role?: string; token: string; secret: string; note: string }>('/admin/v1/keys', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  rotateKey: (name: string, options?: { grace_period?: number; idempotencyKey?: string }) =>
    request<{ name: string; token: string; secret: string; note: string }>(`/admin/v1/keys/${encodeURIComponent(name)}/rotate`, {
      method: 'POST',
      headers: options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : undefined,
      body: options?.grace_period ? JSON.stringify({ grace_period: options.grace_period }) : undefined,
    }),
  deleteKey: (name: string) =>
    request<{ message: string }>(`/admin/v1/keys/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  // Roles & RBAC
  listRoles: () => request<{ roles: RoleRecordApi[] }>('/admin/v1/roles'),
  createRole: (data: { name: string; description?: string; permissions: PermissionRecordApi[] }) =>
    request<{ name: string; message: string }>('/admin/v1/roles', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRole: (name: string, data: { description?: string; permissions?: PermissionRecordApi[] }) =>
    request<{ name: string; message: string }>(`/admin/v1/roles/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteRole: (name: string) =>
    request<{ message: string }>(`/admin/v1/roles/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  // Cache Engine
  getCacheStats: () => request<CacheStatsApi>('/admin/v1/cache/stats'),
  flushCache: () => request<{ message: string }>('/admin/v1/cache/flush', { method: 'POST' }),

  // Metrics & Observability
  getMetricsSnapshot: () => request<MetricsSnapshotApi>('/admin/v1/metrics?format=json'),
  getAuditLog: (limit = 50, offset = 0) => {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit) || 50));
    const safeOffset = Math.max(0, Math.floor(offset) || 0);
    return request<AuditRecordApi[]>(`/admin/v1/audit?limit=${safeLimit}&offset=${safeOffset}`);
  },

  // Users & Authentication
  listUsers: () => request<UserRecordApi[]>('/admin/v1/users'),
  login: async (credentials: { username: string; password: string }) => {
    const res = await request<{ user?: { username: string }; username?: string; session_token?: string; token?: string; expires_at?: number }>('/admin/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    const token = res.token || res.session_token || '';
    const username = res.user?.username || res.username || credentials.username;
    return { username, token, session_token: token, expires_at: res.expires_at || 0 };
  },
  logout: () =>
    request<{ message: string }>('/admin/v1/auth/logout', {
      method: 'POST',
    }),

  // Setup Wizard
  checkSetup: () => request<{ setup_required: boolean }>('/admin/v1/setup/begin', { method: 'POST' }),
  setupAccount: async (data: { username: string; password: string }) => {
    const res = await request<{ user?: { username: string }; username?: string; session_token?: string; token?: string; expires_at?: number }>('/admin/v1/setup/account', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    const token = res.token || res.session_token || '';
    const username = res.user?.username || res.username || data.username;
    return { username, token, session_token: token, expires_at: res.expires_at || 0 };
  },
  setupDatabase: (data: { alias: string; url: string; engine?: string }) =>
    request<{ alias: string; message: string }>('/admin/v1/setup/database', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  testDatabaseUrl: (url: string, alias?: string) =>
    request<{ status: string; dialect: string; message: string }>('/admin/v1/setup/database/test', {
      method: 'POST',
      body: JSON.stringify({ url, alias }),
    }),
  setupComplete: () =>
    request<{ message: string; api_key: { name: string; token: string } }>('/admin/v1/setup/complete', {
      method: 'POST',
    }),

  // Native Blob Storage Subsystem
  getBlobStats: () => request<BlobStats>('/admin/v1/blobs/stats'),
  listBlobNamespaces: () => request<NamespaceInfo[]>('/admin/v1/blobs/namespaces'),
  createBlobNamespace: (name: string, max_bytes?: number | null) =>
    request<NamespaceInfo>('/admin/v1/blobs/namespaces', {
      method: 'POST',
      body: JSON.stringify({ name, max_bytes: max_bytes ?? null }),
    }),
  updateBlobNamespace: (name: string, data: { new_name?: string; max_bytes?: number | null }) =>
    request<NamespaceInfo>(`/admin/v1/blobs/namespaces/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteBlobNamespace: (name: string) =>
    request<{ deleted_objects: number }>(`/admin/v1/blobs/namespaces/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
  listBlobs: (namespace: string, prefix?: string, cursor?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (prefix) params.set('prefix', prefix);
    if (cursor) params.set('cursor', cursor);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<ListBlobsResult>(`/api/v1/blobs/${encodeURIComponent(namespace)}${qs}`);
  },
  uploadBlob: async (
    namespace: string,
    key: string,
    data: BodyInit,
    contentType?: string,
    signal?: AbortSignal
  ) => {
    const sanitizedKey = key.split('/').map(encodeURIComponent).join('/');
    return request<BlobMetadata>(`/api/v1/blobs/${encodeURIComponent(namespace)}/${sanitizedKey}`, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
      },
      body: data,
      signal,
      timeoutMs: 600_000, // 10-minute timeout allows large payloads
    });
  },
  deleteBlob: (namespace: string, key: string) => {
    const sanitizedKey = key.split('/').map(encodeURIComponent).join('/');
    return request<{ deleted: boolean }>(`/api/v1/blobs/${encodeURIComponent(namespace)}/${sanitizedKey}`, {
      method: 'DELETE',
    });
  },
  copyBlob: (
    src_namespace: string,
    src_key: string,
    dest_key: string,
    dest_namespace?: string,
    is_prefix?: boolean
  ) =>
    request<BlobMetadata | { copied_count: number }>('/admin/v1/blobs/copy', {
      method: 'POST',
      body: JSON.stringify({
        src_namespace,
        src_key,
        dest_namespace: dest_namespace || src_namespace,
        dest_key,
        is_prefix: !!is_prefix,
      }),
    }),
  moveBlob: (
    src_namespace: string,
    src_key: string,
    dest_key: string,
    dest_namespace?: string,
    is_prefix?: boolean
  ) =>
    request<BlobMetadata | { moved_count: number }>('/admin/v1/blobs/move', {
      method: 'POST',
      body: JSON.stringify({
        src_namespace,
        src_key,
        dest_namespace: dest_namespace || src_namespace,
        dest_key,
        is_prefix: !!is_prefix,
      }),
    }),
  deleteBlobPrefix: (namespace: string, prefix: string) =>
    request<{ deleted_objects: number }>('/admin/v1/blobs/delete-prefix', {
      method: 'POST',
      body: JSON.stringify({ namespace, prefix }),
    }),
  verifyBlob: (namespace: string, key: string) => {
    const sanitizedKey = key.split('/').map(encodeURIComponent).join('/');
    return request<{ valid: boolean }>(`/admin/v1/blobs/verify/${encodeURIComponent(namespace)}/${sanitizedKey}`, {
      method: 'POST',
    });
  },
  getBlobDownloadUrl: (namespace: string, key: string) => {
    const sanitizedKey = key.split('/').map(encodeURIComponent).join('/');
    return `/api/v1/blobs/${encodeURIComponent(namespace)}/${sanitizedKey}`;
  },
  downloadBlob: async (namespace: string, key: string) => {
    const token = getSessionToken();
    const sanitizedKey = key.split('/').map(encodeURIComponent).join('/');
    const url = `/api/v1/blobs/${encodeURIComponent(namespace)}/${sanitizedKey}`;
    const res = await fetch(url, {
      headers: token && token !== 'undefined' ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new Error(`Download failed with HTTP ${res.status}`);
    }
    return res.blob();
  },
};
