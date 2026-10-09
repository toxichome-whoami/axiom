/*
 * Cluster Settings and Administrative Operator directory interface.
 * Owned by: ui/settings
 * Key deps: DataTable, Button, lucide-react, ../api/client
 * Invariants: Human admin users can only be created via initial setup or CLI command (axiom user add).
 * Last structural change: Connected to live /admin/v1/users, /admin/v1/status, and /admin/v1/reload.
 */

import React, { useState, useEffect } from 'react';
import { AdminUser } from '../types';
import { DataTable, Column } from '../components/shared/DataTable';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import {
  RefreshCw,
  CheckCircle2,
  Terminal,
  Shield,
  Copy,
  Check,
  Server,
  Users,
  Info,
  LayoutGrid,
  AlertTriangle,
} from 'lucide-react';
import { api, SystemStatusData, HealthData, UserRecordApi } from '../api/client';

export function Settings() {
  const [activeNav, setActiveNav] = useState<'server' | 'admins' | 'about'>('server');
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [statusData, setStatusData] = useState<SystemStatusData | null>(null);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [snapshotNotice, setSnapshotNotice] = useState(false);
  const [snapOk, setSnapOk] = useState(true);
  const [snapshotMessage, setSnapshotMessage] = useState('');
  const [copiedCli, setCopiedCli] = useState(false);
  const [endpointCategory, setEndpointCategory] = useState<'database' | 'storage'>('database');
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
    try {
      const res = await api.reloadMetadata();
      setSnapOk(true);
      setSnapshotMessage(res.message || 'Metadata snapshot synchronized');
      setSnapshotNotice(true);
      await loadLiveSettings();
      setTimeout(() => {
        setSnapshotNotice(false);
      }, 3000);
    } catch (err: unknown) {
      setSnapOk(false);
      setSnapshotMessage(err instanceof Error ? err.message : 'Failed to reload snapshot');
      setSnapshotNotice(true);
      setTimeout(() => {
        setSnapshotNotice(false);
      }, 4000);
    } finally {
      setIsReloading(false);
    }
  }

  // Exactly 3 Columns: Username, Email, Created Date (No UI Add/Remove)
  const adminColumns: Column<AdminUser>[] = [
    {
      id: 'username',
      header: 'Username',
      accessorKey: 'username',
      width: 220,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Shield className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px]">{row.username}</span>
        </div>
      ),
    },
    {
      id: 'email',
      header: 'Email',
      accessorKey: 'email',
      isFlex: true,
      className: 'px-3',
      cell: (row) => <span className="text-[14px] text-[#8c8c8c] font-normal">{row.email}</span>,
    },
    {
      id: 'createdAt',
      header: 'Created Date',
      accessorKey: 'createdAt',
      width: 180,
      className: 'px-3',
      cell: (row) => <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">{row.createdAt}</span>,
    },
  ];

  const databaseEndpoints = [
    { method: 'GET', path: '/api/v1/db/{alias}/tables', desc: 'List tables' },
    { method: 'GET', path: '/api/v1/db/{alias}/{table}/schema', desc: 'Describe table schema' },
    { method: 'GET', path: '/api/v1/db/{alias}/{table}/rows', desc: 'Query records' },
    { method: 'POST', path: '/api/v1/db/{alias}/{table}/rows', desc: 'Create records' },
    { method: 'PATCH', path: '/api/v1/db/{alias}/{table}/rows', desc: 'Update records' },
    { method: 'DELETE', path: '/api/v1/db/{alias}/{table}/rows', desc: 'Delete records' },
    { method: 'POST', path: '/api/v1/db/{alias}/query', desc: 'Execute raw SQL query' },
  ];

  const storageEndpoints = [
    { method: 'GET', path: '/api/v1/blobs/{namespace}', desc: 'List stored objects' },
    { method: 'GET', path: '/api/v1/blobs/{namespace}/{key}', desc: 'Download object payload' },
    { method: 'PUT', path: '/api/v1/blobs/{namespace}/{key}', desc: 'Upload or overwrite object' },
    { method: 'DELETE', path: '/api/v1/blobs/{namespace}/{key}', desc: 'Delete stored object' },
    { method: 'GET', path: '/admin/v1/blobs/namespaces', desc: 'List storage namespaces' },
    { method: 'POST', path: '/admin/v1/blobs/copy', desc: 'Copy object or prefix tree' },
    { method: 'POST', path: '/admin/v1/blobs/move', desc: 'Move or rename object' },
    { method: 'POST', path: '/admin/v1/blobs/verify/{namespace}/{key}', desc: 'Verify BLAKE3 checksum' },
  ];

  const renderPathWithParams = (path: string) => {
    const parts = path.split(/(\{[^}]+\})/g);
    return (
      <span className="font-mono text-[13px] text-[#e4e4e7] truncate font-normal tracking-tight">
        {parts.map((part, i) =>
          part.startsWith('{') && part.endsWith('}') ? (
            <span key={i} className="text-[#60a5fa] font-mono font-medium">
              {part}
            </span>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  return (
    <div className="w-full space-y-6 font-sans">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-medium text-white tracking-tight">Settings</h1>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={isReloading}
          onClick={handleReloadSnapshot}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1 text-[#8c8c8c] ${isReloading ? 'animate-spin' : ''}`} />
          Reload Metadata Snapshot
        </Button>
      </div>

      {/* Snapshot Feedback Toast (F-09) */}
      {snapshotNotice && (
        <div
          className={`rounded-[8px] border p-3 text-[13px] font-medium flex items-center gap-2 ${
            snapOk
              ? 'border-[#30a46c]/30 bg-[#30a46c]/10 text-[#30a46c]'
              : 'border-[#e5484d]/30 bg-[#e5484d]/10 text-[#e5484d]'
          }`}
          role="status"
        >
          {snapOk ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#30a46c]" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 text-[#e5484d]" />
          )}
          <span>{snapshotMessage || (snapOk ? 'ArcSwap metadata snapshot reloaded. Worker caches updated from axiom.db.' : 'Failed to reload snapshot.')}</span>
        </div>
      )}

      {/* Main Two-Column Layout (Matching Overview and Databases styling) */}
      <div className="flex flex-col md:flex-row gap-5 items-start">
        {/* Left Sub-Navigation */}
        <div className="w-full md:w-48 shrink-0 flex md:flex-col gap-1 font-sans">
          <button
            type="button"
            onClick={() => setActiveNav('server')}
            className={`group w-full h-8 flex items-center gap-2 px-2.5 rounded-[6px] text-[13px] transition-colors cursor-pointer text-left outline-none ${
              activeNav === 'server'
                ? 'bg-[#181920] text-white border border-[#2a2d38] font-medium shadow-xs'
                : 'text-[#8c8c8c] hover:text-white hover:bg-[#121318] border border-transparent font-normal'
            }`}
          >
            <Server
              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                activeNav === 'server' ? 'text-[#3b82f6]' : 'text-[#8c8c8c] group-hover:text-white'
              }`}
            />
            <span>Server Info</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveNav('admins')}
            className={`group w-full h-8 flex items-center gap-2 px-2.5 rounded-[6px] text-[13px] transition-colors cursor-pointer text-left outline-none ${
              activeNav === 'admins'
                ? 'bg-[#181920] text-white border border-[#2a2d38] font-medium shadow-xs'
                : 'text-[#8c8c8c] hover:text-white hover:bg-[#121318] border border-transparent font-normal'
            }`}
          >
            <Users
              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                activeNav === 'admins' ? 'text-[#3b82f6]' : 'text-[#8c8c8c] group-hover:text-white'
              }`}
            />
            <span>Admins</span>
            <span className="ml-auto text-[12px] font-sans tabular-nums text-[#71717a]">
              {admins.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveNav('about')}
            className={`group w-full h-8 flex items-center gap-2 px-2.5 rounded-[6px] text-[13px] transition-colors cursor-pointer text-left outline-none ${
              activeNav === 'about'
                ? 'bg-[#181920] text-white border border-[#2a2d38] font-medium shadow-xs'
                : 'text-[#8c8c8c] hover:text-white hover:bg-[#121318] border border-transparent font-normal'
            }`}
          >
            <Info
              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                activeNav === 'about' ? 'text-[#3b82f6]' : 'text-[#8c8c8c] group-hover:text-white'
              }`}
            />
            <span>About</span>
          </button>
        </div>

        {/* Right Main Content */}
        <div className="flex-1 w-full min-w-0">
          {/* TAB 1: SERVER INFO */}
          {activeNav === 'server' && (
            <div className="space-y-5">
              {/* Stat Metric Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-[8px] border border-[#1e2025] bg-[#0c0d10] p-4 flex flex-col justify-between hover:border-[#2a2d38] transition-colors">
                  <span className="text-[12px] font-normal text-[#8c8c8c] block">Server version</span>
                  <div className="my-1.5">
                    {isLoading ? (
                      <Skeleton className="h-7 w-20" />
                    ) : (
                      <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight">
                        v{statusData?.version || '4.0.0'}
                      </div>
                    )}
                  </div>
                  <span className="text-[12px] text-[#8c8c8c] block">Rust 2021 · Axum 0.7</span>
                </div>

                <div className="rounded-[8px] border border-[#1e2025] bg-[#0c0d10] p-4 flex flex-col justify-between hover:border-[#2a2d38] transition-colors">
                  <span className="text-[12px] font-normal text-[#8c8c8c] block">Process uptime</span>
                  <div className="my-1.5">
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
                  <span className="text-[12px] text-[#8c8c8c] block">Zero restarts</span>
                </div>

                <div className="rounded-[8px] border border-[#1e2025] bg-[#0c0d10] p-4 flex flex-col justify-between hover:border-[#2a2d38] transition-colors">
                  <span className="text-[12px] font-normal text-[#8c8c8c] block">Cluster health</span>
                  <div className="my-1.5">
                    {isLoading ? (
                      <Skeleton className="h-7 w-24" />
                    ) : (
                      <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight flex items-center gap-2 capitalize">
                        <span className={`size-2 rounded-full shrink-0 ${healthData?.status === 'degraded' ? 'bg-[#f59e0b]' : 'bg-[#30a46c]'}`} />
                        <span>{healthData?.status || 'Operational'}</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[12px] text-[#8c8c8c] block">Gateway responsive</span>
                </div>

                <div className="rounded-[8px] border border-[#1e2025] bg-[#0c0d10] p-4 flex flex-col justify-between hover:border-[#2a2d38] transition-colors">
                  <span className="text-[12px] font-normal text-[#8c8c8c] block">Active DB pools</span>
                  <div className="my-1.5">
                    {isLoading ? (
                      <Skeleton className="h-7 w-24" />
                    ) : (
                      <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight tabular-nums">
                        {statusData?.active_databases ?? 0} <span className="text-[14px] font-normal text-[#8c8c8c]">pools</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[12px] text-[#8c8c8c] block">Per-alias connection pools</span>
                </div>
              </div>

              {/* Card 2: REST API Routes */}
              <div className="rounded-[8px] border border-[#1e2025] bg-[#0c0d10] overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#1e2025] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="space-y-0.5">
                    <h2 className="text-[15px] font-medium text-white tracking-tight">REST API Routes</h2>
                    <p className="text-[12px] text-[#8c8c8c] font-normal">
                      Public gateway endpoints protected by RBAC policy engine and API keys
                    </p>
                  </div>

                  {/* Segmented Category Switcher */}
                  <div className="inline-flex items-center p-0.5 rounded-[6px] bg-[#08090c] border border-[#1e2025] shrink-0 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setEndpointCategory('database')}
                      className={`h-7 px-3 text-[12px] rounded-[5px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                        endpointCategory === 'database'
                          ? 'bg-[#181920] text-white shadow-xs font-medium'
                          : 'text-[#8c8c8c] hover:text-white font-normal'
                      }`}
                    >
                      <span>Database</span>
                      <span className="text-[11px] font-sans tabular-nums text-[#71717a]">
                        {databaseEndpoints.length}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEndpointCategory('storage')}
                      className={`h-7 px-3 text-[12px] rounded-[5px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                        endpointCategory === 'storage'
                          ? 'bg-[#181920] text-white shadow-xs font-medium'
                          : 'text-[#8c8c8c] hover:text-white font-normal'
                      }`}
                    >
                      <span>Storage</span>
                      <span className="text-[11px] font-sans tabular-nums text-[#71717a]">
                        {storageEndpoints.length}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-[#1e2025]">
                  {(endpointCategory === 'database' ? databaseEndpoints : storageEndpoints).map((ep) => (
                    <div
                      key={`${ep.method}-${ep.path}`}
                      className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-[#121318]/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span
                          className={`w-14 text-center py-0.5 rounded-[4px] text-[11px] font-mono font-medium shrink-0 ${
                            ep.method === 'GET'
                              ? 'bg-[#10b981]/10 text-[#34d399] border border-[#10b981]/25'
                              : ep.method === 'POST' || ep.method === 'PUT'
                              ? 'bg-[#3b82f6]/10 text-[#60a5fa] border border-[#3b82f6]/25'
                              : ep.method === 'PATCH'
                              ? 'bg-[#f59e0b]/10 text-[#fbbf24] border border-[#f59e0b]/25'
                              : 'bg-[#ef4444]/10 text-[#f87171] border border-[#ef4444]/25'
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
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ADMINS */}
          {activeNav === 'admins' && (
            <div className="space-y-4">
              <div className="rounded-[8px] border border-[#1e2025] bg-[#0c0d10] p-5 space-y-4">
                <div className="space-y-0.5">
                  <h2 className="text-[15px] font-medium text-white tracking-tight">Administrator Accounts</h2>
                  <p className="text-[12px] text-[#8c8c8c] font-normal">
                    Human operators authorized to access this dashboard. Accounts are managed exclusively via host CLI.
                  </p>
                </div>

                <DataTable
                  columns={adminColumns}
                  data={admins}
                  isLoading={isLoading}
                  ariaLabel="Admin Users Table"
                />
              </div>

              {/* CLI Management Callout Note Banner */}
              <div className="rounded-[8px] border border-[#1e2025] bg-[#08090c] p-4 text-[13px] text-[#8c8c8c] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-white font-medium flex items-center gap-1.5 text-[13.5px]">
                    <Terminal className="w-3.5 h-3.5 text-[#3b82f6]" />
                    Host CLI Zero-Trust Policy
                  </span>
                  <p className="text-[#8c8c8c] text-[13px] font-normal">
                    To prevent web backdoors, administrator accounts cannot be created or deleted via the UI.
                  </p>
                  <code className="text-[#60a5fa] font-mono text-[12.5px] block mt-1 bg-[#121318] px-2 py-1 rounded-[4px] border border-[#1e2025] w-fit">
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
                  <span>{copiedCli ? 'Copied' : 'Copy CLI'}</span>
                </Button>
              </div>
            </div>
          )}

          {/* TAB 3: ABOUT */}
          {activeNav === 'about' && (
            <div className="space-y-5">
              {/* Hero App Banner */}
              <div className="rounded-[8px] border border-[#1e2025] bg-[#0c0d10] p-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-[8px] bg-gradient-to-br from-[#0091ff] to-[#0066cc] flex items-center justify-center shrink-0 shadow-sm">
                    <LayoutGrid className="w-5 h-5 text-white" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[16px] font-medium text-white tracking-tight">Axiom</h2>
                      <span className="text-[12px] px-2 py-0.5 rounded-[5px] bg-[#141414] text-[#8c8c8c] border border-[#262626]">
                        v{statusData?.version || '4.0.0'}
                      </span>
                    </div>
                    <p className="text-[13px] text-[#8c8c8c] font-normal">
                      Turn any SQL database into a secure REST API. Single binary, zero configuration.
                    </p>
                  </div>
                </div>
              </div>

              {/* 2x2 Grid Info Tiles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-[8px] border border-[#1e2025] bg-[#0c0d10] p-4 space-y-1 hover:border-[#2a2d38] transition-colors">
                  <span className="text-[12px] font-normal text-[#8c8c8c] block">Built with</span>
                  <div className="text-[14px] text-white font-medium">Rust + Axum + Tokio</div>
                </div>

                <div className="rounded-[8px] border border-[#1e2025] bg-[#0c0d10] p-4 space-y-1 hover:border-[#2a2d38] transition-colors">
                  <span className="text-[12px] font-normal text-[#8c8c8c] block">Frontend</span>
                  <div className="text-[14px] text-white font-medium">React + Tailwind</div>
                </div>

                <div className="rounded-[8px] border border-[#1e2025] bg-[#0c0d10] p-4 space-y-1 hover:border-[#2a2d38] transition-colors">
                  <span className="text-[12px] font-normal text-[#8c8c8c] block">Supported databases</span>
                  <div className="text-[14px] text-white font-medium">PostgreSQL, MySQL, MSSQL, LibSQL, ClickHouse</div>
                </div>

                <div className="rounded-[8px] border border-[#1e2025] bg-[#0c0d10] p-4 space-y-1 hover:border-[#2a2d38] transition-colors">
                  <span className="text-[12px] font-normal text-[#8c8c8c] block">Core features</span>
                  <div className="text-[14px] text-white font-medium">RBAC, MCP Server, AST Firewall, L1/L2 Cache</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
