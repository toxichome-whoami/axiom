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
  operations: ('SELECT' | 'INSERT' | 'UPDATE' | 'DELETE')[];
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

// ─── Network Request Utility ─────────────────────────────────────────────────
// Ensures session tokens from localStorage and cookies are sent with every call.

/**
 * Executes a typed HTTP request against the Axiom backend API.
 * CONTRACT:
 *  - Automatically attaches session credentials and Authorization header.
 *  - Rejects if server responds with error or non-2xx status.
 *  - Safe to retry idempotent GET calls.
 * @param endpoint Relative URL starting with /admin/v1 or /api/v1
 * @param options Standard RequestInit options
 */
async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('axiom_session_token');
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && token !== 'undefined' && token !== 'null' && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let json: ApiResponse<T>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid server response (${res.status}): ${text.slice(0, 100)}`);
  }

  if (!res.ok || !json.success) {
    const errorMsg = json.error?.message || `Request failed with status ${res.status}`;
    throw new Error(errorMsg);
  }

  return json.data;
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
  rotateKey: (name: string) =>
    request<{ name: string; token: string; secret: string; note: string }>(`/admin/v1/keys/${encodeURIComponent(name)}/rotate`, {
      method: 'POST',
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
  getAuditLog: (limit = 50, offset = 0) =>
    request<AuditRecordApi[]>(`/admin/v1/audit?limit=${limit}&offset=${offset}`),

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
};
