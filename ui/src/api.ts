/*
 * Type-safe API client for Axiom Gateway and Administrative endpoints.
 * Handles session tokens, base URL routing, and structured error responses.
 */

export interface SystemStatus {
  gateway: string;
  version: string;
  uptime_seconds: number;
  cpu_percent: number;
  memory_mb: number;
  active_databases: number;
  registered_keys: number;
  registered_roles: number;
}

export interface DatabaseRecord {
  alias: string;
  url?: string;
  engine: string;
  pool_min: number;
  pool_max: number;
  created_at: number;
}

export interface ApiKeyRecord {
  name: string;
  role_name?: string;
  rate_limit: number;
  expires_at?: number;
  created_at: number;
}

export interface PermissionRecord {
  id?: number;
  role_name?: string;
  database: string;
  table_name: string;
  operations: string[];
}

export interface RoleRecord {
  name: string;
  description?: string;
  created_at: number;
  permissions: PermissionRecord[];
}

export interface CacheStats {
  hits_l1: number;
  hits_l2: number;
  misses: number;
  evictions: number;
  entries_count: number;
  hit_rate: number;
}

export interface AuditRecord {
  id: number;
  timestamp: number;
  actor: string;
  action: string;
  target: string;
  details?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    request_id?: string;
    duration_ms?: number;
  };
}

class ApiClient {
  private getHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    const token = localStorage.getItem('axiom_session_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = path.startsWith('/') ? path : `/${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...(options.headers || {}),
      },
    });

    if (res.status === 401) {
      if (!window.location.hash.includes('#/login') && !window.location.hash.includes('#/setup')) {
        localStorage.removeItem('axiom_session_token');
        localStorage.removeItem('axiom_username');
        window.location.hash = '#/login';
      }
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/plain')) {
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      return text as unknown as T;
    }

    const json: ApiResponse<T> = await res.json();
    if (!json.success && json.error) {
      throw new Error(json.error.message || json.error.code || 'API error');
    }
    return json.data;
  }

  // Setup API
  async checkSetupStatus(): Promise<{ setup_required: boolean }> {
    return this.request<{ setup_required: boolean }>('/admin/v1/setup/begin', { method: 'POST' });
  }

  async createAdminAccount(data: { username: string; password: string }): Promise<{ token: string; username: string }> {
    return this.request<{ token: string; username: string }>('/admin/v1/setup/account', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async setupDatabase(data: { alias: string; url: string; engine?: string }): Promise<{ message: string }> {
    return this.request<{ message: string }>('/admin/v1/setup/database', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async completeSetup(): Promise<{ message: string }> {
    return this.request<{ message: string }>('/admin/v1/setup/complete', { method: 'POST' });
  }

  // Auth API
  async login(data: { username: string; password: string }): Promise<{ token: string; username: string }> {
    return this.request<{ token: string; username: string }>('/admin/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async logout(): Promise<void> {
    try {
      await this.request('/admin/v1/auth/logout', { method: 'POST' });
    } finally {
      localStorage.removeItem('axiom_session_token');
      localStorage.removeItem('axiom_username');
    }
  }

  // Admin Operations
  async getStatus(): Promise<SystemStatus> {
    return this.request<SystemStatus>('/admin/v1/status');
  }

  async getDatabases(): Promise<DatabaseRecord[]> {
    return this.request<DatabaseRecord[]>('/admin/v1/databases');
  }

  async addDatabase(data: { alias: string; url: string; engine?: string; pool_min?: number; pool_max?: number }): Promise<void> {
    return this.request<void>('/admin/v1/databases', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteDatabase(alias: string): Promise<void> {
    return this.request<void>(`/admin/v1/databases/${encodeURIComponent(alias)}`, {
      method: 'DELETE',
    });
  }

  async getKeys(): Promise<ApiKeyRecord[]> {
    return this.request<ApiKeyRecord[]>('/admin/v1/keys');
  }

  async createKey(data: { name: string; role?: string; secret?: string; rate_limit?: number }): Promise<{ secret: string; key_name: string; token_header: string }> {
    return this.request<{ secret: string; key_name: string; token_header: string }>('/admin/v1/keys', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteKey(name: string): Promise<void> {
    return this.request<void>(`/admin/v1/keys/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  async getRoles(): Promise<RoleRecord[]> {
    return this.request<RoleRecord[]>('/admin/v1/roles');
  }

  async createRole(data: { name: string; description?: string; permissions: PermissionRecord[] }): Promise<void> {
    return this.request<void>('/admin/v1/roles', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateRole(name: string, data: { description?: string; permissions?: PermissionRecord[] }): Promise<void> {
    return this.request<void>(`/admin/v1/roles/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteRole(name: string): Promise<void> {
    return this.request<void>(`/admin/v1/roles/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  async getCacheStats(): Promise<CacheStats> {
    return this.request<CacheStats>('/admin/v1/cache/stats');
  }

  async flushCache(): Promise<void> {
    return this.request<void>('/admin/v1/cache/flush', { method: 'POST' });
  }

  async getAuditLog(limit = 100, offset = 0): Promise<AuditRecord[]> {
    return this.request<AuditRecord[]>(`/admin/v1/audit?limit=${limit}&offset=${offset}`);
  }

  async testDatabase(alias: string): Promise<{ alias: string; status: string; dialect: string; message: string }> {
    return this.request<{ alias: string; status: string; dialect: string; message: string }>(
      `/admin/v1/databases/${encodeURIComponent(alias)}/test`
    );
  }

  async rotateKey(name: string): Promise<{ name: string; token: string; secret: string; note: string }> {
    return this.request<{ name: string; token: string; secret: string; note: string }>(
      `/admin/v1/keys/${encodeURIComponent(name)}/rotate`,
      { method: 'POST' }
    );
  }

  async reloadMetadata(): Promise<{ message: string }> {
    return this.request<{ message: string }>('/admin/v1/reload', { method: 'POST' });
  }

  async getHealth(): Promise<{ status: string; version: string }> {
    return this.request<{ status: string; version: string }>('/health');
  }

  async getRawMetrics(): Promise<string> {
    return this.request<string>('/metrics');
  }
}

export const api = new ApiClient();
