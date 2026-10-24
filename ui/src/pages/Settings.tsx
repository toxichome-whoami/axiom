/*
 * Cluster Settings and Administrative Operator directory interface.
 * Owned by: ui/settings
 * Key deps: DataTable, Button, lucide-react, ../api/client
 * Invariants: Human admin users can only be created via initial setup or CLI command (axiom user add).
 * Last structural change: Standardized on Axiom pure dark neutral palette, horizontal tab navigation, and 13px typography.
 */

import React, { useState, useEffect } from 'react';
import { AdminUser } from '../types';
import { DataTable, Column } from '../components/shared/DataTable';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import {
  RefreshCw,
  Terminal,
  Shield,
  Copy,
  Check,
  Server,
  Users,
  Info,
  Code2,
  Cpu,
  Layers,
  Lock,
  Database,
  HardDrive,
  Activity,
} from 'lucide-react';
import { api, SystemStatusData, HealthData, UserRecordApi } from '../api/client';

export function Settings() {
  const [activeTab, setActiveTab] = useState<'server' | 'admins' | 'routes' | 'about'>('server');
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [statusData, setStatusData] = useState<SystemStatusData | null>(null);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedCli, setCopiedCli] = useState(false);
  const [endpointCategory, setEndpointCategory] = useState<'database' | 'storage'>('database');
  const [searchRoutes, setSearchRoutes] = useState('');
  const fetchGenRef = React.useRef(0);

  const loadLiveSettings = async () => {
    const curGen = ++fetchGenRef.current;
    try {
      const [usersRes, statusRes, healthRes] = await Promise.allSettled([
        api.listUsers(),
        api.getStatus(),
        api.getHealth(),
      ]);

      if (curGen !== fetchGenRef.current) return;

      if (usersRes.status === 'fulfilled') {
        const userList: UserRecordApi[] = usersRes.value;
        setAdmins(
          userList.map((u) => ({
            username: u.username,
            email: `${u.username}@axiom.local`,
            createdAt: new Date(u.created_at * 1000).toISOString().split('T')[0],
          }))
        );
      }

      if (statusRes.status === 'fulfilled') {
        setStatusData(statusRes.value);
      }
      if (healthRes.status === 'fulfilled') {
        setHealthData(healthRes.value);
      }
    } catch {
      // Keep existing state
    } finally {
      if (curGen === fetchGenRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadLiveSettings();
  }, []);

  async function handleReloadSnapshot() {
    setIsReloading(true);
    const minSpinPromise = new Promise((resolve) => setTimeout(resolve, 600));
    try {
      await Promise.all([api.reloadMetadata(), minSpinPromise]);
      await loadLiveSettings();
    } catch {
      // Keep existing state
    } finally {
      setIsReloading(false);
    }
  }

  const adminColumns: Column<AdminUser>[] = [
    {
      id: 'username',
      header: 'Username',
      accessorKey: 'username',
      width: 240,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Shield className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[13px]">{row.username}</span>
        </div>
      ),
    },
    {
      id: 'email',
      header: 'Email',
      accessorKey: 'email',
      isFlex: true,
      className: 'px-3',
      cell: (row) => <span className="text-[13px] text-[#8c8c8c] font-normal">{row.email}</span>,
    },
    {
      id: 'createdAt',
      header: 'Created Date',
      accessorKey: 'createdAt',
      width: 180,
      className: 'px-3',
      cell: (row) => <span className="tabular-nums text-[13px] text-[#8c8c8c] font-normal">{row.createdAt}</span>,
    },
  ];

  const databaseEndpoints = [
    { method: 'GET', path: '/api/v1/db/{alias}/tables', desc: 'List tables in target database service' },
    { method: 'GET', path: '/api/v1/db/{alias}/{table}/schema', desc: 'Describe table columns, types, and foreign keys' },
    { method: 'GET', path: '/api/v1/db/{alias}/{table}/rows', desc: 'Query table records with cursor pagination and filters' },
    { method: 'POST', path: '/api/v1/db/{alias}/{table}/rows', desc: 'Insert single or batch records' },
    { method: 'PATCH', path: '/api/v1/db/{alias}/{table}/rows', desc: 'Update records matching filter criteria' },
    { method: 'DELETE', path: '/api/v1/db/{alias}/{table}/rows', desc: 'Delete records matching filter criteria' },
    { method: 'POST', path: '/api/v1/db/{alias}/query', desc: 'Execute raw SQL query with AST firewall validation' },
  ];

  const storageEndpoints = [
    { method: 'GET', path: '/api/v1/blobs/{namespace}', desc: 'List stored objects and virtual folders' },
    { method: 'GET', path: '/api/v1/blobs/{namespace}/{key}', desc: 'Download object content' },
    { method: 'GET', path: '/api/v1/blobs/public/{namespace}/{key}', desc: 'Direct static CDN media with 304 caching' },
    { method: 'PUT', path: '/api/v1/blobs/{namespace}/{key}', desc: 'Upload or overwrite object' },
    { method: 'DELETE', path: '/api/v1/blobs/{namespace}/{key}', desc: 'Delete stored object' },
    { method: 'POST', path: '/api/v1/blobs/{namespace}/delete-objects', desc: 'Batch delete multiple objects' },
    { method: 'GET', path: '/admin/v1/blobs/namespaces', desc: 'List storage namespaces with quota telemetry' },
    { method: 'POST', path: '/admin/v1/blobs/copy', desc: 'Copy object or prefix tree' },
    { method: 'POST', path: '/admin/v1/blobs/move', desc: 'Move or rename object' },
    { method: 'POST', path: '/admin/v1/blobs/verify/{namespace}/{key}', desc: 'Verify BLAKE3 cryptographic checksum' },
  ];

  const renderPathWithParams = (path: string) => {
    const parts = path.split(/(\{[^}]+\})/g);
    return (
      <span className="font-mono text-[13px] text-[#e4e4e7] truncate font-normal tracking-tight">
        {parts.map((part, i) =>
          part.startsWith('{') && part.endsWith('}') ? (
            <span key={i} className="text-[#3b82f6] font-mono font-medium">
              {part}
            </span>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  const currentEndpoints = endpointCategory === 'database' ? databaseEndpoints : storageEndpoints;
  const filteredEndpoints = currentEndpoints.filter(
    (ep) =>
      ep.path.toLowerCase().includes(searchRoutes.toLowerCase()) ||
      ep.desc.toLowerCase().includes(searchRoutes.toLowerCase()) ||
      ep.method.toLowerCase().includes(searchRoutes.toLowerCase())
  );

  return (
    <div className="w-full max-w-[1600px] mx-auto pb-12 select-none font-sans space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-medium text-white tracking-tight">Settings</h1>
          <p className="text-[13px] text-[#8c8c8c] mt-0.5">
            Gateway runtime environment, administrator users, and operational configuration
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isReloading}
            onClick={handleReloadSnapshot}
            title="Reload metadata snapshot"
            aria-label="Reload metadata snapshot"
            className="flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-white rounded-[8px] bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReloading ? 'animate-spin opacity-50' : ''}`} />
          </button>
        </div>
      </div>

      {/* Top Segmented Navigation Tabs (Matches Overview, Databases, and Cluster) */}
      <div className="flex items-center gap-1 p-0.5 rounded-[8px] bg-[#0c0c0c] border border-[#262626] w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('server')}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium transition-colors cursor-pointer outline-none ${
            activeTab === 'server'
              ? 'bg-[#161616] text-white border border-[#333333]'
              : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent'
          }`}
        >
          <Server className="w-3.5 h-3.5 shrink-0" />
          <span>Server Info</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('admins')}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium transition-colors cursor-pointer outline-none ${
            activeTab === 'admins'
              ? 'bg-[#161616] text-white border border-[#333333]'
              : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent'
          }`}
        >
          <Users className="w-3.5 h-3.5 shrink-0" />
          <span>Admins</span>
          <span className="ml-1 text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[#8c8c8c]">
            {admins.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('routes')}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium transition-colors cursor-pointer outline-none ${
            activeTab === 'routes'
              ? 'bg-[#161616] text-white border border-[#333333]'
              : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent'
          }`}
        >
          <Code2 className="w-3.5 h-3.5 shrink-0" />
          <span>API Routes</span>
          <span className="ml-1 text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[#8c8c8c]">
            {databaseEndpoints.length + storageEndpoints.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('about')}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium transition-colors cursor-pointer outline-none ${
            activeTab === 'about'
              ? 'bg-[#161616] text-white border border-[#333333]'
              : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent'
          }`}
        >
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>About</span>
        </button>
      </div>

      {/* TAB 1: SERVER INFO */}
      {activeTab === 'server' && (
        <div className="space-y-6">
          {/* Stat Metric Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 flex flex-col justify-between hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">Server version</span>
              <div className="my-2">
                {isLoading ? (
                  <Skeleton className="h-7 w-20" />
                ) : (
                  <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight">
                    v{statusData?.version || '0.1.15'}
                  </div>
                )}
              </div>
              <span className="text-[12px] text-[#737373] block">Rust 2021 · Axum 0.7</span>
            </div>

            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 flex flex-col justify-between hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">Process uptime</span>
              <div className="my-2">
                {isLoading ? (
                  <Skeleton className="h-7 w-28" />
                ) : (
                  <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight tabular-nums">
                    {healthData?.uptime_seconds
                      ? `${Math.floor(healthData.uptime_seconds / 3600)}h ${Math.floor((healthData.uptime_seconds % 3600) / 60)}m`
                      : 'Active'}
                  </div>
                )}
              </div>
              <span className="text-[12px] text-[#737373] block">Zero unplanned restarts</span>
            </div>

            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 flex flex-col justify-between hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">Gateway health</span>
              <div className="my-2">
                {isLoading ? (
                  <Skeleton className="h-7 w-24" />
                ) : (
                  <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight flex items-center gap-2 capitalize">
                    <span
                      className={`size-2 rounded-full shrink-0 ${
                        healthData?.status === 'degraded' ? 'bg-[#f59e0b]' : 'bg-[#30a46c]'
                      }`}
                    />
                    <span>{healthData?.status || 'Operational'}</span>
                  </div>
                )}
              </div>
              <span className="text-[12px] text-[#737373] block">API gateway responsive</span>
            </div>

            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 flex flex-col justify-between hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">Active DB pools</span>
              <div className="my-2">
                {isLoading ? (
                  <Skeleton className="h-7 w-24" />
                ) : (
                  <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight tabular-nums">
                    {statusData?.active_databases ?? 0} <span className="text-[13px] font-normal text-[#8c8c8c]">pools</span>
                  </div>
                )}
              </div>
              <span className="text-[12px] text-[#737373] block">Per-alias connection pools</span>
            </div>
          </div>

          {/* System Subsystems & Architecture Specs */}
          <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#222222]">
              <h2 className="text-[14px] font-medium text-white tracking-tight">Runtime Subsystems & Engine Architecture</h2>
              <p className="text-[13px] text-[#8c8c8c] font-normal mt-0.5">
                Core compiled engine specifications and low-latency execution pipeline
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#222222]">
              <div className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-[6px] bg-[#141414] border border-[#262626] text-[#3b82f6] shrink-0 mt-0.5">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[13px] font-medium text-white">Tokio Asynchronous Core</div>
                    <div className="text-[13px] text-[#8c8c8c] leading-relaxed">
                      Multi-threaded work-stealing scheduler with bounded channels and non-blocking I/O.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-[6px] bg-[#141414] border border-[#262626] text-[#34d399] shrink-0 mt-0.5">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[13px] font-medium text-white">Zero-Lock Metadata Snapshot</div>
                    <div className="text-[13px] text-[#8c8c8c] leading-relaxed">
                      Hot-path reads execute via ArcSwap snapshot with zero mutex locks per request.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-[6px] bg-[#141414] border border-[#262626] text-[#eab308] shrink-0 mt-0.5">
                    <HardDrive className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[13px] font-medium text-white">Content-Addressable Blob Engine</div>
                    <div className="text-[13px] text-[#8c8c8c] leading-relaxed">
                      Inline tiny blob RAM tier (&lt;64KB) + disk S3 store with BLAKE3 cryptographic deduplication.
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-[6px] bg-[#141414] border border-[#262626] text-[#f43f5e] shrink-0 mt-0.5">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[13px] font-medium text-white">AST SQL Firewall & WAF</div>
                    <div className="text-[13px] text-[#8c8c8c] leading-relaxed">
                      Parses incoming SQL into an abstract syntax tree to guarantee query safety before DB dispatch.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-[6px] bg-[#141414] border border-[#262626] text-[#a855f7] shrink-0 mt-0.5">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[13px] font-medium text-white">Circuit Breaker & Ban Propagation</div>
                    <div className="text-[13px] text-[#8c8c8c] leading-relaxed">
                      Tracks database health states and automatically isolates failing pool aliases with 503 fast-fail.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-[6px] bg-[#141414] border border-[#262626] text-[#06b6d4] shrink-0 mt-0.5">
                    <Database className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[13px] font-medium text-white">Multi-Dialect Connection Pooling</div>
                    <div className="text-[13px] text-[#8c8c8c] leading-relaxed">
                      Native protocol multiplexers for PostgreSQL, MySQL, MSSQL, LibSQL, ClickHouse, Snowflake, and Oracle.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ADMINS */}
      {activeTab === 'admins' && (
        <div className="space-y-5">
          <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#222222]">
              <h2 className="text-[14px] font-medium text-white tracking-tight">Administrator Accounts</h2>
              <p className="text-[13px] text-[#8c8c8c] font-normal mt-0.5">
                Human operators authorized to access this dashboard. Accounts are managed exclusively via host CLI.
              </p>
            </div>

            <div className="p-4">
              <DataTable
                columns={adminColumns}
                data={admins}
                isLoading={isLoading}
                ariaLabel="Admin Users Table"
              />
            </div>
          </div>

          {/* CLI Management Callout Banner */}
          <div className="rounded-[8px] border border-[#262626] bg-[#0e0e0e] p-4 text-[13px] text-[#8c8c8c] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-white font-medium flex items-center gap-2 text-[13px]">
                <Terminal className="w-4 h-4 text-[#3b82f6]" />
                <span>Host CLI Zero-Trust Policy</span>
              </div>
              <p className="text-[#8c8c8c] text-[13px] font-normal leading-relaxed">
                To prevent web backdoors, administrator accounts cannot be created or deleted via the UI.
              </p>
              <code className="text-[#60a5fa] font-mono text-[12px] block mt-1.5 bg-[#141414] px-2.5 py-1 rounded-[4px] border border-[#262626] w-fit select-all">
                axiom user add &lt;username&gt; --email &lt;email&gt;
              </code>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText('axiom user add <username> --email <email>');
                  setCopiedCli(true);
                  setTimeout(() => setCopiedCli(false), 2000);
                } catch {
                  // Clipboard access error
                }
              }}
            >
              {copiedCli ? <Check className="w-3.5 h-3.5 text-[#30a46c]" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="text-[13px]">{copiedCli ? 'Copied' : 'Copy CLI'}</span>
            </Button>
          </div>
        </div>
      )}

      {/* TAB 3: REST API ROUTES */}
      {activeTab === 'routes' && (
        <div className="space-y-4">
          <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#222222] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="space-y-0.5">
                <h2 className="text-[14px] font-medium text-white tracking-tight">REST API Route Catalog</h2>
                <p className="text-[13px] text-[#8c8c8c] font-normal">
                  Gateway endpoints protected by RBAC policy engine and API keys
                </p>
              </div>

              {/* Segmented Category Switcher */}
              <div className="inline-flex items-center p-0.5 rounded-[6px] bg-[#141414] border border-[#262626] shrink-0 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setEndpointCategory('database')}
                  className={`h-7 px-3 text-[12px] rounded-[5px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                    endpointCategory === 'database'
                      ? 'bg-[#1e1e1e] text-white shadow-xs font-medium border border-[#333333]'
                      : 'text-[#8c8c8c] hover:text-white font-normal border border-transparent'
                  }`}
                >
                  <Database className="w-3.5 h-3.5 text-[#3b82f6]" />
                  <span>Database</span>
                  <span className="text-[11px] font-mono tabular-nums text-[#737373]">
                    {databaseEndpoints.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setEndpointCategory('storage')}
                  className={`h-7 px-3 text-[12px] rounded-[5px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                    endpointCategory === 'storage'
                      ? 'bg-[#1e1e1e] text-white shadow-xs font-medium border border-[#333333]'
                      : 'text-[#8c8c8c] hover:text-white font-normal border border-transparent'
                  }`}
                >
                  <HardDrive className="w-3.5 h-3.5 text-[#eab308]" />
                  <span>Storage</span>
                  <span className="text-[11px] font-mono tabular-nums text-[#737373]">
                    {storageEndpoints.length}
                  </span>
                </button>
              </div>
            </div>

            {/* Filter Search Input */}
            <div className="px-5 py-3 border-b border-[#222222] bg-[#0e0e0e]">
              <input
                type="text"
                value={searchRoutes}
                onChange={(e) => setSearchRoutes(e.target.value)}
                placeholder="Search endpoints by path or description..."
                className="w-full h-8 px-3 rounded-[6px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#3b82f6] text-[13px] text-white placeholder-[#666666] outline-none transition-colors"
              />
            </div>

            <div className="divide-y divide-[#1e1e1e]">
              {filteredEndpoints.length === 0 ? (
                <div className="p-8 text-center text-[#8c8c8c] text-[13px]">
                  No endpoints matched "{searchRoutes}"
                </div>
              ) : (
                filteredEndpoints.map((ep) => (
                  <div
                    key={`${ep.method}-${ep.path}`}
                    className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-[#121212] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span
                        className={`w-14 text-center py-0.5 rounded-[4px] text-[11px] font-mono font-medium shrink-0 ${
                          ep.method === 'GET'
                            ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/40'
                            : ep.method === 'POST' || ep.method === 'PUT'
                            ? 'bg-blue-950/40 text-blue-400 border border-blue-800/40'
                            : ep.method === 'PATCH'
                            ? 'bg-amber-950/40 text-amber-400 border border-amber-800/40'
                            : 'bg-rose-950/40 text-rose-400 border border-rose-800/40'
                        }`}
                      >
                        {ep.method}
                      </span>
                      {renderPathWithParams(ep.path)}
                    </div>
                    <div className="shrink-0">
                      <span className="text-[13px] text-[#8c8c8c] hidden md:block font-normal">{ep.desc}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: ABOUT */}
      {activeTab === 'about' && (
        <div className="space-y-5">
          {/* Hero App Banner */}
          <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 rounded-[8px] bg-gradient-to-br from-[#1d4ed8] to-[#2563eb] flex items-center justify-center shrink-0 shadow-sm border border-[#3b82f6]/30">
                <span className="font-['Montserrat',sans-serif] font-bold text-[18px] text-white tracking-wider">AX</span>
              </div>
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-[16px] font-semibold text-white tracking-tight">Axiom Gateway</h2>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-[4px] bg-[#161616] text-[#8c8c8c] border border-[#2a2a2a]">
                    v{statusData?.version || '0.1.15'}
                  </span>
                </div>
                <p className="text-[13px] text-[#8c8c8c] font-normal leading-relaxed">
                  Turn any SQL database or storage namespace into a secure, low-latency REST API. Single binary, zero external runtime dependencies.
                </p>
              </div>
            </div>
          </div>

          {/* Technical Specifications Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 space-y-1.5 hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">Core Technology</span>
              <div className="text-[13px] text-white font-medium">Rust 2021 + Axum 0.7 + Tokio multi-threaded</div>
              <p className="text-[12px] text-[#737373]">Engineered for sub-millisecond query routing and minimal memory footprint.</p>
            </div>

            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 space-y-1.5 hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">Frontend Architecture</span>
              <div className="text-[13px] text-white font-medium">React 19 + TypeScript + Vite + Tailwind CSS</div>
              <p className="text-[12px] text-[#737373]">Embedded directly into the release binary via rust-embed.</p>
            </div>

            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 space-y-1.5 hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">Supported SQL Engines</span>
              <div className="text-[13px] text-white font-medium">PostgreSQL, MySQL, MariaDB, MSSQL, LibSQL, ClickHouse, Snowflake, Oracle</div>
              <p className="text-[12px] text-[#737373]">Native driver multiplexing with per-alias connection pools and circuit breakers.</p>
            </div>

            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 space-y-1.5 hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">Security & Protocols</span>
              <div className="text-[13px] text-white font-medium">RBAC, Model Context Protocol (MCP), AST SQL Firewall, L1/L2 Cache</div>
              <p className="text-[12px] text-[#737373]">Zero-trust policy enforcement, constant-time hashing, and AI agent integration.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
