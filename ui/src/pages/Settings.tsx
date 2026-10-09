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

  const apiEndpoints = [
    { method: 'GET', path: '/api/v1/db/{alias}/tables', desc: 'List tables' },
    { method: 'GET', path: '/api/v1/db/{alias}/{table}/schema', desc: 'Describe table schema' },
    { method: 'GET', path: '/api/v1/db/{alias}/{table}/rows', desc: 'Query records' },
    { method: 'POST', path: '/api/v1/db/{alias}/{table}/rows', desc: 'Create records' },
    { method: 'PATCH', path: '/api/v1/db/{alias}/{table}/rows', desc: 'Update records' },
    { method: 'DELETE', path: '/api/v1/db/{alias}/{table}/rows', desc: 'Delete records' },
    { method: 'POST', path: '/api/v1/db/{alias}/query', desc: 'Execute raw SQL query' },
  ];

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
                ? 'bg-[#161616] text-white border border-[#333333] font-medium'
                : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent font-normal'
            }`}
          >
            <Server
              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                activeNav === 'server' ? 'text-[#2f80ed]' : 'text-[#8c8c8c] group-hover:text-white'
              }`}
            />
            <span>Server Info</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveNav('admins')}
            className={`group w-full h-8 flex items-center gap-2 px-2.5 rounded-[6px] text-[13px] transition-colors cursor-pointer text-left outline-none ${
              activeNav === 'admins'
                ? 'bg-[#161616] text-white border border-[#333333] font-medium'
                : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent font-normal'
            }`}
          >
            <Users
              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                activeNav === 'admins' ? 'text-[#2f80ed]' : 'text-[#8c8c8c] group-hover:text-white'
              }`}
            />
            <span>Admins</span>
            <span
              className={`ml-auto text-[11px] px-1.5 py-0.2 rounded-full tabular-nums transition-colors ${
                activeNav === 'admins'
                  ? 'bg-[#1d4ed8]/20 text-[#60a5fa]'
                  : 'bg-[#161616] text-[#737373] group-hover:text-[#a3a3a3]'
              }`}
            >
              {admins.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveNav('about')}
            className={`group w-full h-8 flex items-center gap-2 px-2.5 rounded-[6px] text-[13px] transition-colors cursor-pointer text-left outline-none ${
              activeNav === 'about'
                ? 'bg-[#161616] text-white border border-[#333333] font-medium'
                : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent font-normal'
            }`}
          >
            <Info
              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                activeNav === 'about' ? 'text-[#2f80ed]' : 'text-[#8c8c8c] group-hover:text-white'
              }`}
            />
            <span>About</span>
          </button>
        </div>

        {/* Right Main Content */}
        <div className="flex-1 w-full min-w-0">
          {/* TAB 1: SERVER INFO */}
          {activeNav === 'server' && (
            <div className="space-y-4">
              {/* Server Information & Endpoints Card */}
              <div className="rounded-[8px] border border-[#262626] bg-[#0e0e0e] p-5 space-y-4">
                <div className="space-y-0.5">
                  <h2 className="text-[14px] font-medium text-white">Server Information</h2>
                  <p className="text-[13px] text-[#8c8c8c]">
                    Current configuration and runtime details
                  </p>
                </div>

                {/* 2x2 Grid Info Tiles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-3.5 space-y-1">
                    <span className="text-[12px] font-normal text-[#8c8c8c]">Server Version</span>
                    {isLoading ? (
                      <Skeleton className="h-4 w-16" />
                    ) : (
                      <div className="font-mono text-[13px] text-white font-normal">v{statusData?.version || '4.0.0'}</div>
                    )}
                  </div>

                  <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-3.5 space-y-1">
                    <span className="text-[12px] font-normal text-[#8c8c8c]">Process Uptime</span>
                    {isLoading ? (
                      <Skeleton className="h-4 w-24" />
                    ) : (
                      <div className="font-mono text-[13px] text-white font-normal">
                        {healthData?.uptime_seconds
                          ? `${Math.floor(healthData.uptime_seconds / 3600)}h ${Math.floor((healthData.uptime_seconds % 3600) / 60)}m ${healthData.uptime_seconds % 60}s`
                          : 'Active'}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-3.5 space-y-1">
                    <span className="text-[12px] font-normal text-[#8c8c8c]">Cluster Health</span>
                    {isLoading ? (
                      <Skeleton className="h-4 w-20" />
                    ) : (
                      <div className="font-mono text-[13px] text-[#30a46c] font-normal flex items-center gap-1.5 capitalize">
                        <span className="size-1.5 rounded-full bg-[#30a46c]" />
                        {healthData?.status || 'healthy'}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-3.5 space-y-1">
                    <span className="text-[12px] font-normal text-[#8c8c8c]">Active DB Pools</span>
                    {isLoading ? (
                      <Skeleton className="h-4 w-24" />
                    ) : (
                      <div className="font-mono text-[13px] text-white font-normal">
                        {statusData?.active_databases ?? 0} connected
                      </div>
                    )}
                  </div>
                </div>

                {/* API Endpoints Section */}
                <div className="space-y-2 pt-1">
                  <span className="text-[13px] font-medium text-white block">API Endpoints</span>
                  <div className="rounded-[8px] border border-[#262626] bg-[#111111] divide-y divide-[#262626] overflow-hidden">
                    {apiEndpoints.map((ep) => (
                      <div
                        key={`${ep.method}-${ep.path}`}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-[#141414] transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`px-2 py-0.5 rounded-[4px] text-[11px] font-medium font-sans shrink-0 ${
                              ep.method === 'GET'
                                ? 'bg-[#072714]/70 text-[#34d399] border border-[#059669]/30'
                                : ep.method === 'POST'
                                ? 'bg-[#0c1f3d]/70 text-[#60a5fa] border border-[#2563eb]/30'
                                : ep.method === 'PATCH'
                                ? 'bg-[#2b1704]/70 text-[#fb923c] border border-[#ea580c]/30'
                                : 'bg-[#370e11]/70 text-[#f87171] border border-[#dc2626]/30'
                            }`}
                          >
                            {ep.method}
                          </span>
                          <span className="font-mono text-[13px] text-white truncate font-normal">{ep.path}</span>
                        </div>
                        <span className="text-[13px] text-[#8c8c8c] shrink-0 font-normal">{ep.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ADMINS */}
          {activeNav === 'admins' && (
            <div className="space-y-4">
              <div className="rounded-[8px] border border-[#262626] bg-[#0e0e0e] p-5 space-y-4">
                <div className="space-y-0.5">
                  <h2 className="text-[14px] font-medium text-white">Administrator Accounts</h2>
                  <p className="text-[13px] text-[#8c8c8c]">
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
              <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-4 text-[13px] text-[#8c8c8c] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-white font-medium flex items-center gap-1.5 text-[13px]">
                    <Terminal className="w-3.5 h-3.5 text-[#2f80ed]" />
                    Host CLI Zero-Trust Policy
                  </span>
                  <p className="text-[#8c8c8c] text-[13px]">
                    To prevent web backdoors, administrator accounts cannot be created or deleted via the UI.
                  </p>
                  <code className="text-[#60a5fa] font-mono text-[12px] block mt-1">
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
            <div className="space-y-4">
              <div className="rounded-[8px] border border-[#262626] bg-[#0e0e0e] p-5 space-y-4">
                <div className="space-y-0.5">
                  <h2 className="text-[14px] font-medium text-white">About Axiom</h2>
                  <p className="text-[13px] text-[#8c8c8c]">
                    Open-source database-to-REST API generator
                  </p>
                </div>

                {/* Hero App Banner */}
                <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-4 flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-[8px] bg-gradient-to-br from-[#0091ff] to-[#0066cc] flex items-center justify-center shrink-0 shadow-sm">
                    <LayoutGrid className="w-5 h-5 text-white" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[14px] font-medium text-white">Axiom</div>
                    <p className="text-[13px] text-[#8c8c8c]">
                      Turn any SQL database into a secure REST API. Single binary, zero configuration.
                    </p>
                  </div>
                </div>

                {/* 2x2 Grid Info Tiles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-3.5 space-y-1">
                    <span className="text-[12px] font-normal text-[#8c8c8c]">Built With</span>
                    <div className="text-[14px] text-white font-medium">Rust + Axum + Tokio</div>
                  </div>

                  <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-3.5 space-y-1">
                    <span className="text-[12px] font-normal text-[#8c8c8c]">Frontend</span>
                    <div className="text-[14px] text-white font-medium">React + Tailwind</div>
                  </div>

                  <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-3.5 space-y-1">
                    <span className="text-[12px] font-normal text-[#8c8c8c]">Supported DBs</span>
                    <div className="text-[14px] text-white font-medium">PostgreSQL, MySQL, MSSQL, LibSQL, ClickHouse</div>
                  </div>

                  <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-3.5 space-y-1">
                    <span className="text-[12px] font-normal text-[#8c8c8c]">Features</span>
                    <div className="text-[14px] text-white font-medium">RBAC, MCP Server, AST Firewall, L1/L2 Cache</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
