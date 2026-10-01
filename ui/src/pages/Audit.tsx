import React, { useState, useMemo, useRef, useEffect } from 'react';
import { AuditLogEntry } from '../types';
import { DataTable, Column } from '../components/shared/DataTable';
import { TelemetryCard, formatTimeFromPct } from '../components/shared/TelemetryCard';
import { SlideOver } from '../components/ui/SlideOver';
import {
  FileText,
  KeyRound,
  Terminal as TerminalIcon,
  Search,
  Shield,
  RefreshCw,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

export function Audit() {
  const [activeTab, setActiveTab] = useState<'audit' | 'auth' | 'system'>('audit');
  const [filterText, setFilterText] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut '/' to search, 'Esc' to clear
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        if (filterText) {
          setFilterText('');
        } else {
          searchInputRef.current?.blur();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filterText]);

  const auditLogs: AuditLogEntry[] = [
    {
      id: 'aud_01',
      timestamp: '2026-09-30 18:24:12',
      actor: 'admin',
      action: 'key.create',
      target: 'key:analytics_agent',
      status: '200 OK',
      durationMs: 4.2,
      ipAddress: '127.0.0.1',
      details: {
        key_name: 'analytics_agent',
        role: 'readonly',
        rate_limit: 1000,
        metadata_refreshed: true,
      },
    },
    {
      id: 'aud_02',
      timestamp: '2026-09-30 17:15:02',
      actor: 'devops_lead',
      action: 'role.update',
      target: 'role:readwrite',
      status: '200 OK',
      durationMs: 2.1,
      ipAddress: '10.0.4.15',
      details: {
        role: 'readwrite',
        permissions_added: ['public.metrics:INSERT', 'public.metrics:UPDATE'],
      },
    },
    {
      id: 'aud_03',
      timestamp: '2026-09-30 15:40:10',
      actor: 'admin',
      action: 'database.attach',
      target: 'db:analytics_ch',
      status: '200 OK',
      durationMs: 14.8,
      ipAddress: '127.0.0.1',
      details: {
        alias: 'analytics_ch',
        dialect: 'clickhouse',
        min_connections: 4,
        max_connections: 20,
      },
    },
    {
      id: 'aud_04',
      timestamp: '2026-09-30 14:02:18',
      actor: 'admin',
      action: 'pool.bounds_update',
      target: 'db:local_db',
      status: '200 OK',
      durationMs: 1.8,
      ipAddress: '127.0.0.1',
      details: {
        alias: 'local_db',
        min_connections: 2,
        max_connections: 16,
      },
    },
    {
      id: 'aud_05',
      timestamp: '2026-09-30 11:30:45',
      actor: 'sec_officer',
      action: 'key.rotate',
      target: 'key:billing_service',
      status: '200 OK',
      durationMs: 3.4,
      ipAddress: '10.0.2.88',
      details: {
        key_name: 'billing_service',
        secret_hash_algorithm: 'BLAKE3',
        snapshot_epoch: 1420,
      },
    },
  ];

  const authLogs: AuditLogEntry[] = [
    {
      id: 'auth_01',
      timestamp: '2026-09-30 18:42:01',
      actor: 'analytics_agent',
      action: 'auth.success',
      target: 'endpoint:/api/v1/db/local_db/query',
      status: '200 OK',
      durationMs: 0.08,
      ipAddress: '192.168.1.45',
      details: {
        scheme: 'X-Axiom-Key',
        role: 'readonly',
        cached_snapshot: true,
      },
    },
    {
      id: 'auth_02',
      timestamp: '2026-09-30 18:15:33',
      actor: 'unauthorized_client',
      action: 'auth.attempt_failed',
      target: 'key:invalid_secret_hash',
      status: '403 Forbidden',
      durationMs: 0.12,
      ipAddress: '198.51.100.24',
      details: {
        reason: 'Constant-time BLAKE3 comparison mismatch',
        consecutive_failures: 2,
        ban_list_threshold: 5,
      },
    },
    {
      id: 'auth_03',
      timestamp: '2026-09-30 17:50:11',
      actor: 'worker_pool',
      action: 'auth.success',
      target: 'endpoint:/api/v1/db/local_db/rows',
      status: '200 OK',
      durationMs: 0.06,
      ipAddress: '10.0.8.12',
      details: {
        scheme: 'X-Axiom-Key',
        role: 'readwrite',
      },
    },
    {
      id: 'auth_04',
      timestamp: '2026-09-30 16:22:40',
      actor: 'scanner_bot',
      action: 'waf.blocked_uri',
      target: 'uri:/api/v1/db/..%252e%252e/admin',
      status: '403 Forbidden',
      durationMs: 0.04,
      ipAddress: '203.0.113.8',
      details: {
        waf_trigger: 'deep_url_decode_path_traversal',
        iterations: 3,
      },
    },
    {
      id: 'auth_05',
      timestamp: '2026-09-30 14:10:05',
      actor: 'default_admin',
      action: 'auth.success',
      target: 'endpoint:/admin/v1/status',
      status: '200 OK',
      durationMs: 0.05,
      ipAddress: '127.0.0.1',
      details: {
        role: 'admin',
        bypass_rl: true,
      },
    },
  ];

  const systemLogs: AuditLogEntry[] = [
    {
      id: 'sys_01',
      timestamp: '2026-09-30 18:00:00',
      actor: 'system',
      action: 'gateway.snapshot_reload',
      target: 'axiom.db',
      status: '200 OK',
      durationMs: 0.8,
      ipAddress: 'local',
      details: {
        event: 'periodic_30s_sync',
        active_keys: 3,
        active_pools: 3,
      },
    },
    {
      id: 'sys_02',
      timestamp: '2026-09-30 17:00:00',
      actor: 'system',
      action: 'cache.lru_eviction_sweep',
      target: 'cache:l1_dashmap',
      status: '200 OK',
      durationMs: 1.1,
      ipAddress: 'local',
      details: {
        evicted_entries: 0,
        current_size: 42,
        max_entries: 10000,
      },
    },
    {
      id: 'sys_03',
      timestamp: '2026-09-30 16:00:00',
      actor: 'system',
      action: 'circuit_breaker.probe_passed',
      target: 'db:analytics_ch',
      status: '200 OK',
      durationMs: 12.4,
      ipAddress: 'local',
      details: {
        circuit_state: 'CLOSED',
        consecutive_successes: 3,
      },
    },
    {
      id: 'sys_04',
      timestamp: '2026-09-30 15:00:00',
      actor: 'system',
      action: 'pool.idle_reap',
      target: 'db:postgres_primary',
      status: '200 OK',
      durationMs: 0.4,
      ipAddress: 'local',
      details: {
        closed_idle_conns: 1,
        active_retained: 2,
      },
    },
  ];

  const currentDataset = useMemo(() => {
    if (activeTab === 'audit') return auditLogs;
    if (activeTab === 'auth') return authLogs;
    return systemLogs;
  }, [activeTab]);

  const filteredLogs = useMemo(() => {
    if (!filterText.trim()) return currentDataset;
    const q = filterText.toLowerCase();
    return currentDataset.filter(
      (log) =>
        log.actor.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.target.toLowerCase().includes(q) ||
        (log.ipAddress && log.ipAddress.toLowerCase().includes(q))
    );
  }, [currentDataset, filterText]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
    }, 400);
  };

  const handleCopyJson = async () => {
    if (!selectedLog) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedLog, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1500);
    } catch {
      // Fallback
    }
  };

  const columns: Column<AuditLogEntry>[] = [
    {
      id: 'timestamp',
      header: 'Timestamp',
      accessorKey: 'timestamp',
      isResizable: true,
      width: 170,
      className: 'pl-4 pr-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">
          {row.timestamp}
        </span>
      ),
    },
    {
      id: 'actor',
      header: 'Actor / Principal',
      accessorKey: 'actor',
      isResizable: true,
      width: 180,
      className: 'px-3',
      cell: (row) => (
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px] truncate">{row.actor}</span>
        </div>
      ),
    },
    {
      id: 'action',
      header: 'Event Action',
      accessorKey: 'action',
      isResizable: true,
      width: 190,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#cccccc] font-normal">
          {row.action}
        </span>
      ),
    },
    {
      id: 'target',
      header: 'Target Resource',
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
      id: 'ipAddress',
      header: 'Source IP',
      accessorKey: 'ipAddress',
      isResizable: true,
      width: 140,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#8c8c8c] tabular-nums font-normal">
          {row.ipAddress || '—'}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status Result',
      isResizable: true,
      width: 130,
      className: 'px-3',
      cell: (row) => (
        <div className="flex items-center gap-2 text-[14px] text-white font-normal">
          <span
            className={`size-1.5 rounded-full shrink-0 ${
              row.status === '200 OK' ? 'bg-[#30a46c]' : 'bg-[#e5484d]'
            }`}
          />
          <span className={row.status === '200 OK' ? 'text-[#d4d4d4]' : 'text-[#e5484d]'}>
            {row.status}
          </span>
        </div>
      ),
    },
    {
      id: 'durationMs',
      header: 'Duration',
      isResizable: true,
      width: 110,
      headerClassName: 'justify-end pr-4 text-right',
      className: 'pl-3 pr-4 justify-end text-right',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">
          {row.durationMs} ms
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6 w-full max-w-[1600px] mx-auto pb-12 select-none font-sans">
      {/* 1. Page Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-semibold text-white tracking-tight">
            Audit logs
          </h1>
        </div>

        {/* Reload button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            title="Reload audit records"
            className="flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-white rounded-[8px] bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin opacity-50' : ''}`} />
          </button>
        </div>
      </div>

      {/* 2. Four Telemetry Cards (Cloudflare / binary_alive style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full font-sans">
        <TelemetryCard
          title="Total Events"
          value="1,428"
          subLabel="peak 2.4k/hr"
          badge={{ text: '+14.2%', icon: 'up', color: '#30a46c' }}
          gradientId="aud-events-grad"
          strokeColor="#2f80ed"
          pathD="M 0,100 C 180,85 360,50 540,65 C 720,40 900,30 1000,28"
          yAxisLabels={['2.5k', '1.5k', '500', '0']}
          tooltipMetricName="Audit Events"
          onHoverCompute={(pct, _svgX, exactYPct) => {
            const norm = exactYPct !== undefined ? Math.max(0, Math.min(1, (116 - exactYPct * 130) / 102)) : pct;
            const val = Math.round(1000 + norm * 800);
            return {
              pct,
              yPct: exactYPct ?? 0.32,
              time: formatTimeFromPct(pct),
              value: `${val.toLocaleString()} events`,
            };
          }}
        />

        <TelemetryCard
          title="Auth Success Rate"
          value="99.1%"
          subLabel="/ 12 blocked"
          badge={{ text: '99.1%', icon: 'none', color: '#2f80ed' }}
          gradientId="aud-auth-grad"
          strokeColor="#2f80ed"
          pathD="M 0,35 C 250,32 500,28 750,30 C 900,26 950,28 1000,25"
          yAxisLabels={['100%', '98%', '95%', '90%']}
          tooltipMetricName="Success Rate"
          onHoverCompute={(pct, _svgX, exactYPct) => {
            const norm = exactYPct !== undefined ? Math.max(0, Math.min(1, (116 - exactYPct * 130) / 102)) : 0.8;
            const val = (98.5 + norm * 1.2).toFixed(1);
            return {
              pct,
              yPct: exactYPct ?? 0.25,
              time: formatTimeFromPct(pct),
              value: `${val}%`,
            };
          }}
        />

        <TelemetryCard
          title="Policy Mutations"
          value="38"
          subLabel="RBAC changes"
          badge={{ text: '+6 today', icon: 'up', color: '#2f80ed' }}
          gradientId="aud-mut-grad"
          strokeColor="#2f80ed"
          pathD="M 0,85 C 200,80 400,65 600,70 C 800,55 900,50 1000,45"
          yAxisLabels={['50', '35', '15', '0']}
          tooltipMetricName="Policy Updates"
          onHoverCompute={(pct, _svgX, exactYPct) => {
            const norm = exactYPct !== undefined ? Math.max(0, Math.min(1, (116 - exactYPct * 130) / 102)) : 0.5;
            const val = Math.round(15 + norm * 35);
            return {
              pct,
              yPct: exactYPct ?? 0.45,
              time: formatTimeFromPct(pct),
              value: `${val} mutations`,
            };
          }}
        />

        <TelemetryCard
          title="Active Principals"
          value="9"
          subLabel="keys & users"
          badge={{ text: 'Zero Trust', icon: 'none', color: '#8c8c8c' }}
          gradientId="aud-prin-grad"
          strokeColor="#2f80ed"
          pathD="M 0,60 C 250,62 500,58 750,55 C 900,58 950,52 1000,50"
          yAxisLabels={['15', '10', '5', '0']}
          tooltipMetricName="Active Principals"
          onHoverCompute={(pct, _svgX, exactYPct) => ({
            pct,
            yPct: exactYPct ?? 0.5,
            time: formatTimeFromPct(pct),
            value: '9 active',
          })}
        />
      </div>

      {/* 3. DevTool Search & Tab Switcher Toolbar (Exact binary_alive structure with zero shake) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1 select-none font-sans">
        {/* Search input */}
        <label
          title="Search logs (/ or Ctrl+K)"
          className="relative flex items-center h-9 rounded-[8px] bg-transparent border border-[#262626] focus-within:border-[#2f80ed] transition-colors px-3 gap-2 w-full sm:w-[280px] md:w-[320px]"
        >
          <Search className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Search logs..."
            className="w-full bg-transparent border-0 text-[14px] text-white placeholder-[#8c8c8c] outline-none font-normal font-sans"
          />
          {filterText ? (
            <button
              type="button"
              onClick={() => {
                setFilterText('');
                searchInputRef.current?.focus();
              }}
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#222222] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer shrink-0 font-sans"
              title="Clear search"
            >
              ✕
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center ml-auto font-sans text-xs font-semibold text-[#8c8c8c] whitespace-nowrap select-none pointer-events-none shrink-0">
              /
            </kbd>
          )}
        </label>

        {/* Segmented Tab Switcher (Exact binary_alive styling: zero-jitter 75ms) */}
        <div className="inline-flex items-center p-0.5 rounded-[8px] bg-transparent border border-[#262626]">
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
            <span>Audit</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('auth')}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
              activeTab === 'auth'
                ? 'bg-[#161616] text-white border-[#333333]'
                : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
            }`}
          >
            <KeyRound className="w-4 h-4 shrink-0" />
            <span>Login / Auth</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('system')}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
              activeTab === 'system'
                ? 'bg-[#161616] text-white border-[#333333]'
                : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
            }`}
          >
            <TerminalIcon className="w-4 h-4 shrink-0" />
            <span>Gateway Engine</span>
          </button>
        </div>
      </div>

      {/* 4. Inset DataTable */}
      <DataTable
        columns={columns}
        data={filteredLogs}
        ariaLabel="Audit Trail Table"
        onRowClick={(row) => setSelectedLog(row)}
        pagination={{
          page: 1,
          pageSize: 10,
          totalCount: filteredLogs.length,
          onPageChange: () => {},
          onPageSizeChange: () => {},
        }}
      />

      {/* 6. SlideOver Event Inspector */}
      <SlideOver
        isOpen={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title={selectedLog ? `Event Details: ${selectedLog.action}` : 'Event Details'}
        subtitle={
          selectedLog
            ? `Captured at ${selectedLog.timestamp} from ${selectedLog.ipAddress || 'local daemon'}`
            : undefined
        }
      >
        {selectedLog && (
          <div className="flex-1 flex flex-col p-4 sm:p-5 overflow-y-auto font-sans space-y-4">
            {/* Summary Grid */}
            <div className="grid grid-cols-2 gap-2 text-[13px] bg-[#121212] p-3 rounded-[8px] border border-[#222222]">
              <div>
                <span className="text-[#8c8c8c] text-[11px] block">Actor</span>
                <span className="text-white font-medium">{selectedLog.actor}</span>
              </div>
              <div>
                <span className="text-[#8c8c8c] text-[11px] block">Status</span>
                <span
                  className={
                    selectedLog.status === '200 OK' ? 'text-[#30a46c] font-mono' : 'text-[#e5484d] font-mono'
                  }
                >
                  {selectedLog.status}
                </span>
              </div>
              <div>
                <span className="text-[#8c8c8c] text-[11px] block">Duration</span>
                <span className="text-[#cccccc] font-mono">{selectedLog.durationMs} ms</span>
              </div>
              <div>
                <span className="text-[#8c8c8c] text-[11px] block">Source IP</span>
                <span className="text-[#cccccc] font-mono">{selectedLog.ipAddress || 'local'}</span>
              </div>
              <div className="col-span-2 mt-1 pt-2 border-t border-[#1e1e1e]">
                <span className="text-[#8c8c8c] text-[11px] block">Target Resource</span>
                <span className="text-[#3b82f6] font-mono break-all text-[12px]">{selectedLog.target}</span>
              </div>
            </div>

            {/* JSON Payload Inspector */}
            <div className="flex-1 flex flex-col min-h-[220px]">
              <div className="flex items-center justify-between pb-1.5">
                <span className="text-[12px] font-medium text-[#8c8c8c]">Event JSON Payload</span>
                <button
                  type="button"
                  onClick={handleCopyJson}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-[#161616] hover:bg-[#202020] border border-[#262626] hover:border-[#383838] text-[12px] font-medium text-white transition-colors cursor-pointer"
                >
                  {copiedJson ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#30a46c]" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#8c8c8c]" />
                      <span>Copy JSON</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="flex-1 p-3.5 rounded-[8px] bg-[#090909] border border-[#222222] text-[#d4d4d4] font-mono text-[12px] leading-relaxed overflow-x-auto selection:bg-[#2f80ed]/40">
                {JSON.stringify(
                  {
                    id: selectedLog.id,
                    timestamp: selectedLog.timestamp,
                    actor: selectedLog.actor,
                    action: selectedLog.action,
                    target: selectedLog.target,
                    status: selectedLog.status,
                    duration_ms: selectedLog.durationMs,
                    ip_address: selectedLog.ipAddress,
                    details: selectedLog.details || {},
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  );
}
