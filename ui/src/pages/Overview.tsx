import React, { useState, useMemo } from 'react';
import { NavPath } from '../components/Layout';
import { SlideOver } from '../components/ui/SlideOver';
import { DataTable, Column } from '../components/shared/DataTable';
import { TelemetryCard } from '../components/shared/TelemetryCard';
import { Database, Key, RefreshCw, Search, FileText } from 'lucide-react';

interface OverviewProps {
  onNavigate: (path: NavPath) => void;
}

interface DatabaseRow {
  alias: string;
  engine: string;
  conns: string;
  status: 'Ready' | 'Connecting' | 'Degraded';
  latency: string;
}

interface KeyRow {
  name: string;
  role: string;
  rateLimit: string;
  status: 'Active' | 'Revoked';
  created: string;
}

interface AuditRow {
  time: string;
  actor: string;
  action: string;
  target: string;
  status: '200 OK' | '403 Forbidden';
}

export function Overview({ onNavigate }: OverviewProps) {
  const [activeTab, setActiveTab] = useState<'databases' | 'keys' | 'audit'>('databases');
  const [searchFilter, setSearchFilter] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Edit DB SlideOver State
  const [editDbOpen, setEditDbOpen] = useState(false);
  const [dbMinConns, setDbMinConns] = useState(1);
  const [dbMaxConns, setDbMaxConns] = useState(10);
  const [dbTimeout, setDbTimeout] = useState(30);
  const [dbUpdatedNotice, setDbUpdatedNotice] = useState(false);

  // Edit Key SlideOver State
  const [editKeyOpen, setEditKeyOpen] = useState(false);
  const [keyRole, setKeyRole] = useState('admin');
  const [keyRate, setKeyRate] = useState(10000);
  const [keyUpdatedNotice, setKeyUpdatedNotice] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Sample Data Sets
  const rawDbData: DatabaseRow[] = [
    {
      alias: 'local_db',
      engine: 'POSTGRESQL',
      conns: `${dbMinConns} – ${dbMaxConns} active`,
      status: 'Ready',
      latency: '0.42 ms',
    },
    {
      alias: 'analytics_clickhouse',
      engine: 'CLICKHOUSE',
      conns: '2 – 20 active',
      status: 'Ready',
      latency: '1.15 ms',
    },
    {
      alias: 'turso_edge_cache',
      engine: 'LIBSQL',
      conns: '1 – 5 active',
      status: 'Ready',
      latency: '0.18 ms',
    },
  ];

  const rawKeyData: KeyRow[] = [
    {
      name: 'default_admin',
      role: keyRole,
      rateLimit: `${keyRate.toLocaleString()} req/m`,
      status: 'Active',
      created: '2026-09-28',
    },
    {
      name: 'backend_worker',
      role: 'readwrite',
      rateLimit: '5,000 req/m',
      status: 'Active',
      created: '2026-09-29',
    },
    {
      name: 'grafana_telemetry',
      role: 'readonly',
      rateLimit: '2,000 req/m',
      status: 'Active',
      created: '2026-09-30',
    },
  ];

  const rawAuditData: AuditRow[] = [
    { time: '12:45:00', actor: 'admin', action: 'auth.login', target: '/admin/v1/auth', status: '200 OK' },
    { time: '12:30:15', actor: 'system', action: 'pool.connect', target: 'local_db', status: '200 OK' },
    { time: '12:15:22', actor: 'attacker_ip', action: 'waf.blocked', target: '/api/v1/query?drop=1', status: '403 Forbidden' },
    { time: '12:00:00', actor: 'system', action: 'gateway.boot', target: '0.0.0.0:4500', status: '200 OK' },
  ];

  const filteredDbData = useMemo(() => {
    if (!searchFilter.trim()) return rawDbData;
    const q = searchFilter.toLowerCase();
    return rawDbData.filter(d => d.alias.toLowerCase().includes(q) || d.engine.toLowerCase().includes(q));
  }, [rawDbData, searchFilter]);

  const filteredKeyData = useMemo(() => {
    if (!searchFilter.trim()) return rawKeyData;
    const q = searchFilter.toLowerCase();
    return rawKeyData.filter(k => k.name.toLowerCase().includes(q) || k.role.toLowerCase().includes(q));
  }, [rawKeyData, searchFilter]);

  const filteredAuditData = useMemo(() => {
    if (!searchFilter.trim()) return rawAuditData;
    const q = searchFilter.toLowerCase();
    return rawAuditData.filter(a => a.actor.toLowerCase().includes(q) || a.action.toLowerCase().includes(q) || a.target.toLowerCase().includes(q));
  }, [rawAuditData, searchFilter]);

  // Table Column Definitions
  const dbColumns: Column<DatabaseRow>[] = [
    {
      id: 'alias',
      header: 'Database Alias',
      accessorKey: 'alias',
      isSortable: true,
      width: 240,
      className: 'pl-4 pr-3',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Database className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px]">{row.alias}</span>
        </div>
      ),
    },
    {
      id: 'engine',
      header: 'Engine',
      accessorKey: 'engine',
      width: 170,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#cccccc] font-normal">
          {row.engine}
        </span>
      ),
    },
    {
      id: 'conns',
      header: 'Pool Connections',
      accessorKey: 'conns',
      width: 170,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#d4d4d4] font-normal">
          {row.conns}
        </span>
      ),
    },
    {
      id: 'latency',
      header: 'Ping Latency',
      accessorKey: 'latency',
      width: 140,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">
          {row.latency}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Health Status',
      accessorKey: 'status',
      width: 150,
      className: 'px-3',
      cell: (row) => (
        <div className="flex items-center gap-2 text-[14px] text-white font-normal">
          <span
            className={`size-1.5 rounded-full shrink-0 ${
              row.status === 'Ready' ? 'bg-[#30a46c]' : 'bg-[#f59e0b]'
            }`}
          />
          <span>{row.status}</span>
        </div>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      isFlex: true,
      headerClassName: 'justify-end pr-4 text-right',
      className: 'pl-3 pr-4 justify-end',
      cell: () => (
        <div className="flex items-center justify-end gap-2 w-full">
          <button
            type="button"
            onClick={() => setEditDbOpen(true)}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-white hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/ui/databases')}
            className="inline-flex items-center justify-center h-7 px-2.5 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-white bg-transparent hover:bg-[#161616] border border-transparent hover:border-[#262626] transition-colors cursor-pointer shrink-0"
          >
            Manage &rarr;
          </button>
        </div>
      ),
    },
  ];

  const keyColumns: Column<KeyRow>[] = [
    {
      id: 'name',
      header: 'Key Identifier',
      accessorKey: 'name',
      isSortable: true,
      width: 240,
      className: 'pl-4 pr-3',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Key className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px]">{row.name}</span>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      accessorKey: 'role',
      width: 170,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#cccccc] font-normal">
          {row.role}
        </span>
      ),
    },
    {
      id: 'rateLimit',
      header: 'Rate Limit',
      accessorKey: 'rateLimit',
      width: 170,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">
          {row.rateLimit}
        </span>
      ),
    },
    {
      id: 'created',
      header: 'Created Date',
      accessorKey: 'created',
      width: 150,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">
          {row.created}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      width: 140,
      className: 'px-3',
      cell: (row) => (
        <div className="flex items-center gap-2 text-[14px] text-white font-normal">
          <span
            className={`size-1.5 rounded-full shrink-0 ${
              row.status === 'Active' ? 'bg-[#30a46c]' : 'bg-[#e5484d]'
            }`}
          />
          <span>{row.status}</span>
        </div>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      isFlex: true,
      headerClassName: 'justify-end pr-4 text-right',
      className: 'pl-3 pr-4 justify-end',
      cell: () => (
        <div className="flex items-center justify-end gap-2 w-full">
          <button
            type="button"
            onClick={() => setEditKeyOpen(true)}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-white hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Modify
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/ui/keys')}
            className="inline-flex items-center justify-center h-7 px-2.5 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-white bg-transparent hover:bg-[#161616] border border-transparent hover:border-[#262626] transition-colors cursor-pointer shrink-0"
          >
            Details &rarr;
          </button>
        </div>
      ),
    },
  ];

  const auditColumns: Column<AuditRow>[] = [
    {
      id: 'time',
      header: 'Timestamp',
      accessorKey: 'time',
      width: 180,
      className: 'pl-4 pr-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">
          {row.time}
        </span>
      ),
    },
    {
      id: 'actor',
      header: 'Actor',
      accessorKey: 'actor',
      width: 170,
      className: 'px-3',
      cell: (row) => (
        <span className="font-medium text-white text-[14px]">{row.actor}</span>
      ),
    },
    {
      id: 'action',
      header: 'Event Action',
      accessorKey: 'action',
      width: 180,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#cccccc] font-normal">
          {row.action}
        </span>
      ),
    },
    {
      id: 'target',
      header: 'Target URI / Pool',
      accessorKey: 'target',
      isFlex: true,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#8c8c8c] font-normal truncate block" title={row.target}>
          {row.target}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status Result',
      width: 140,
      headerClassName: 'justify-end pr-4 text-right',
      className: 'pl-3 pr-4 justify-end',
      cell: (row) => (
        <div className="flex items-center justify-end gap-2 text-[14px] text-white font-normal w-full">
          <span
            className={`size-1.5 rounded-full shrink-0 ${
              row.status.startsWith('200') ? 'bg-[#30a46c]' : 'bg-[#e5484d]'
            }`}
          />
          <span className={row.status.startsWith('200') ? 'text-[#d4d4d4]' : 'text-[#e5484d]'}>
            {row.status}
          </span>
        </div>
      ),
    },
  ];

  function handleSaveDb() {
    setDbUpdatedNotice(true);
    setTimeout(() => {
      setDbUpdatedNotice(false);
      setEditDbOpen(false);
    }, 600);
  }

  function handleSaveKey() {
    setKeyUpdatedNotice(true);
    setTimeout(() => {
      setKeyUpdatedNotice(false);
      setEditKeyOpen(false);
    }, 600);
  }

  return (
    <div className="space-y-6 w-full max-w-[1600px] mx-auto pb-12 select-none font-sans">
      {/* Top Header Row with Actions (Cloudflare / binary_alive style) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-semibold text-white tracking-tight">
            Overview
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Refresh metrics button */}
          <button
            type="button"
            onClick={handleRefresh}
            title="Refresh metrics"
            className="flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-white rounded-[8px] bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin opacity-50' : ''}`} />
          </button>

          {/* New API Key button */}
          <button
            type="button"
            onClick={() => onNavigate('/ui/keys')}
            className="h-8 px-3 rounded-[8px] border border-[#262626] bg-[#0c0c0c] hover:bg-[#141414] hover:border-[#383838] text-[13px] font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer inline-flex items-center gap-1.5"
          >
            <Key className="w-3.5 h-3.5 text-[#8c8c8c]" />
            <span>New API Key</span>
          </button>

          {/* Connect Database primary button */}
          <button
            type="button"
            onClick={() => onNavigate('/ui/databases')}
            className="group relative inline-flex items-center justify-center h-8 px-3.5 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] text-[13px]"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
            />
            <span className="relative flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5" />
              <span>Connect Database</span>
            </span>
          </button>
        </div>
      </div>

      {/* 4 Telemetry Analytics Cards Grid (Clean technical minimal style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full font-sans">
        <TelemetryCard
          title="Throughput (req/s)"
          value="1,420"
          subLabel="peak 2.1k"
          badge={{ text: '+12.4%', icon: 'up', color: '#2f80ed' }}
          gradientId="ov-throughput"
          strokeColor="#2f80ed"
          pathD="M 0,105 C 150,95 280,45 450,55 C 600,65 750,20 1000,35"
          yAxisLabels={['2k', '1.5k', '500', '0']}
          tooltipMetricName="Throughput"
          onHoverCompute={(pct) => ({
            pct,
            yPct: 0.35 + Math.sin(pct * 4) * 0.15,
            time: 'Live Telemetry',
            value: `${Math.round(1200 + pct * 600)} req/s`,
          })}
        />

        <TelemetryCard
          title="L1 Cache Hit Ratio"
          value="99.4%"
          subLabel="<1µs lookup"
          badge={{ text: '<1µs L1', icon: 'none', color: '#8c8c8c' }}
          gradientId="ov-cache"
          strokeColor="#2f80ed"
          pathD="M 0,40 C 200,35 400,28 600,32 C 800,25 900,28 1000,26"
          yAxisLabels={['100%', '95%', '90%', '80%']}
          tooltipMetricName="Cache Hit Ratio"
          onHoverCompute={(pct) => ({
            pct,
            yPct: 0.25,
            time: 'Live Window',
            value: '99.4%',
          })}
        />

        <TelemetryCard
          title="Pipeline p95 Latency"
          value="0.74 ms"
          subLabel="AST + Pool"
          badge={{ text: '-8.1%', icon: 'down', color: '#2f80ed' }}
          gradientId="ov-latency"
          strokeColor="#2f80ed"
          pathD="M 0,85 C 200,80 400,95 600,60 C 800,70 900,45 1000,50"
          yAxisLabels={['2.0ms', '1.0ms', '0.5ms', '0ms']}
          tooltipMetricName="p95 Latency"
          onHoverCompute={(pct) => ({
            pct,
            yPct: 0.45,
            time: 'Recent Requests',
            value: `${(0.65 + pct * 0.2).toFixed(2)} ms`,
          })}
        />

        <TelemetryCard
          title="Active Pool Connections"
          value="3 / 35"
          subLabel="3 live pools"
          badge={{ text: '3 active', icon: 'none', color: '#8c8c8c' }}
          gradientId="ov-pools"
          strokeColor="#2f80ed"
          pathD="M 0,90 C 250,92 500,80 750,75 C 900,78 950,72 1000,70"
          yAxisLabels={['35', '20', '10', '0']}
          tooltipMetricName="Active Connections"
          onHoverCompute={(pct) => ({
            pct,
            yPct: 0.65,
            time: 'Connection Saturation',
            value: `${Math.round(2 + pct * 3)} active`,
          })}
        />
      </div>

      {/* Table Controls Toolbar & Segmented Tabs (Matches binary_alive Logs.tsx exactly) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1 select-none font-sans">
        {/* Search filter input */}
        <label
          title="Search current view (/ or Ctrl+K)"
          className="relative flex items-center h-9 rounded-[8px] bg-transparent border border-[#262626] focus-within:border-[#2f80ed] transition-colors px-3 gap-2 w-full sm:w-[280px] md:w-[320px]"
        >
          <Search className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search records..."
            className="w-full bg-transparent border-0 text-[14px] text-white placeholder-[#8c8c8c] outline-none font-normal font-sans"
          />
          {searchFilter && (
            <button
              type="button"
              onClick={() => setSearchFilter('')}
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#222222] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer shrink-0 font-sans"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </label>

        {/* Tab Switcher (Segmented Control matching binary_alive with zero layout shift) */}
        <div className="inline-flex items-center p-0.5 rounded-[8px] bg-transparent border border-[#262626]">
          <button
            type="button"
            onClick={() => setActiveTab('databases')}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
              activeTab === 'databases'
                ? 'bg-[#161616] text-white border-[#333333]'
                : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
            }`}
          >
            <Database className="w-4 h-4 shrink-0" />
            <span>Databases</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('keys')}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
              activeTab === 'keys'
                ? 'bg-[#161616] text-white border-[#333333]'
                : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
            }`}
          >
            <Key className="w-4 h-4 shrink-0" />
            <span>API Keys</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
              activeTab === 'audit'
                ? 'bg-[#161616] text-white border-[#333333]'
                : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
            }`}
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span>Audit Trail</span>
          </button>
        </div>
      </div>

      {/* DataTable direct render (No duplicate outer border wrapper) */}
      {activeTab === 'databases' && (
        <DataTable
          columns={dbColumns}
          data={filteredDbData}
          ariaLabel="Active Database Pools"
          pagination={{
            page: 1,
            pageSize: 10,
            totalCount: filteredDbData.length,
            onPageChange: () => {},
            onPageSizeChange: () => {},
          }}
        />
      )}

      {activeTab === 'keys' && (
        <DataTable
          columns={keyColumns}
          data={filteredKeyData}
          ariaLabel="Configured API Keys"
          pagination={{
            page: 1,
            pageSize: 10,
            totalCount: filteredKeyData.length,
            onPageChange: () => {},
            onPageSizeChange: () => {},
          }}
        />
      )}

      {activeTab === 'audit' && (
        <DataTable
          columns={auditColumns}
          data={filteredAuditData}
          ariaLabel="System Audit Trail"
          pagination={{
            page: 1,
            pageSize: 10,
            totalCount: filteredAuditData.length,
            onPageChange: () => {},
            onPageSizeChange: () => {},
          }}
        />
      )}

      {/* Edit Database Bounds SlideOver */}
      <SlideOver
        isOpen={editDbOpen}
        onClose={() => setEditDbOpen(false)}
        title="Edit Database Pool Bounds"
        subtitle="Update connection pool limits and probe timeout for local_db."
      >
        <div className="space-y-4 font-sans">
          {dbUpdatedNotice && (
            <div className="p-3 bg-[#30a46c]/10 border border-[#30a46c]/20 text-[#30a46c] text-[13px] rounded-[8px]">
              Connection bounds successfully committed to axiom.db snapshot.
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#8c8c8c]">Minimum Idle Connections</label>
            <input
              type="number"
              min={1}
              max={20}
              value={dbMinConns}
              onChange={(e) => setDbMinConns(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#2f80ed] text-[13px] text-white outline-none font-sans"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#8c8c8c]">Maximum Active Connections</label>
            <input
              type="number"
              min={5}
              max={100}
              value={dbMaxConns}
              onChange={(e) => setDbMaxConns(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#2f80ed] text-[13px] text-white outline-none font-sans"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#8c8c8c]">Probe Timeout (seconds)</label>
            <input
              type="number"
              min={5}
              max={120}
              value={dbTimeout}
              onChange={(e) => setDbTimeout(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#2f80ed] text-[13px] text-white outline-none font-sans"
            />
          </div>
          <div className="pt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditDbOpen(false)}
              className="h-9 px-4 rounded-[8px] text-[13px] font-medium text-[#cccccc] hover:text-white bg-transparent border border-[#262626] hover:border-[#383838] hover:bg-[#161616] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveDb}
              className="group relative inline-flex items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] text-[13px]"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative">Commit Bounds</span>
            </button>
          </div>
        </div>
      </SlideOver>

      {/* Edit API Key SlideOver */}
      <SlideOver
        isOpen={editKeyOpen}
        onClose={() => setEditKeyOpen(false)}
        title="Modify API Key Configuration"
        subtitle="Update rate limits and assigned RBAC role for default_admin."
      >
        <div className="space-y-4 font-sans">
          {keyUpdatedNotice && (
            <div className="p-3 bg-[#30a46c]/10 border border-[#30a46c]/20 text-[#30a46c] text-[13px] rounded-[8px]">
              API Key permissions updated in ArcSwap metadata snapshot.
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#8c8c8c]">Assigned Role</label>
            <select
              value={keyRole}
              onChange={(e) => setKeyRole(e.target.value)}
              className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#2f80ed] text-[13px] text-white outline-none font-sans"
            >
              <option value="admin">admin (Full Cluster Access)</option>
              <option value="readwrite">readwrite (CRUD Scoped)</option>
              <option value="readonly">readonly (SELECT Queries Only)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#8c8c8c]">Rate Limit (requests / minute)</label>
            <input
              type="number"
              step={1000}
              value={keyRate}
              onChange={(e) => setKeyRate(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#2f80ed] text-[13px] text-white outline-none font-sans"
            />
          </div>
          <div className="pt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditKeyOpen(false)}
              className="h-9 px-4 rounded-[8px] text-[13px] font-medium text-[#cccccc] hover:text-white bg-transparent border border-[#262626] hover:border-[#383838] hover:bg-[#161616] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveKey}
              className="group relative inline-flex items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] text-[13px]"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative">Update Policy</span>
            </button>
          </div>
        </div>
      </SlideOver>
    </div>
  );
}
