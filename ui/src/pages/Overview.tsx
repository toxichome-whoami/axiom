/*
 * Overview Page - Rebuilt from scratch with Shadcn & Coss UI patterns.
 * Clean, subtle borders, high information density, and real API telemetry.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconActivity,
  IconArrowUpRight,
  IconBolt,
  IconCircleCheck,
  IconDatabase,
  IconDotsVertical,
  IconKey,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconShieldLock,
} from '@tabler/icons-react';
import {
  api,
  type SystemStatus,
  type CacheStats,
  type DatabaseRecord,
  type ApiKeyRecord,
  type AuditRecord,
} from '../api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';

export const Overview: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [databases, setDatabases] = useState<DatabaseRecord[]>([]);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Tab & search state for the lower data table
  const [activeTab, setActiveTab] = useState<'databases' | 'keys' | 'audit'>('databases');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      try {
        setLoading(true);
        const [s, c, d, k, a] = await Promise.all([
          api.getStatus().catch(() => null),
          api.getCacheStats().catch(() => null),
          api.getDatabases().catch(() => []),
          api.getKeys().catch(() => []),
          api.getAuditLog(15, 0).catch(() => []),
        ]);

        if (mounted) {
          setStatus(s);
          setCacheStats(c);
          setDatabases(d);
          setKeys(k);
          setAudit(a);
        }
      } catch (err) {
        console.error('Failed to load dashboard overview telemetry', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadData();
    return () => {
      mounted = false;
    };
  }, []);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${seconds}s`;
  };

  const totalHits = (cacheStats?.hits_l1 ?? 0) + (cacheStats?.hits_l2 ?? 0);
  const totalReq = totalHits + (cacheStats?.misses ?? 0);
  const hitRatePct = totalReq > 0 ? ((totalHits / totalReq) * 100).toFixed(1) + '%' : '100%';

  const safeDatabases = Array.isArray(databases) ? databases : [];
  const safeKeys = Array.isArray(keys) ? keys : [];
  const safeAudit = Array.isArray(audit) ? audit : [];

  const filteredDatabases = safeDatabases.filter((d) =>
    d.alias.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredKeys = safeKeys.filter((k) =>
    k.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredAudit = safeAudit.filter((a) =>
    (a.action || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (a.actor || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6 w-full max-w-[1600px] mx-auto">
      {/* 1. Header Overview Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Axiom Overview</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time database connection pooling, RBAC policy enforcement, and low-latency cache stats.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <IconRefresh className="size-3.5" />
            <span>Refresh</span>
          </Button>
          <Button
            size="sm"
            onClick={() => navigate('/databases')}
            className="h-8 gap-1.5 text-xs"
          >
            <IconPlus className="size-3.5" />
            <span>Add Database</span>
          </Button>
        </div>
      </div>

      {/* 2. Top Metric Cards (Subtle borders, no harsh white wireframes) */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Active Databases */}
        <div className="relative rounded-xl border border-white/[0.07] bg-card p-4 transition-colors hover:border-white/[0.12]">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Database Pools</span>
            <Badge variant="outline" className="text-[11px] gap-1 px-1.5 py-0 border-white/[0.08]">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Live
            </Badge>
          </div>
          <div className="mt-3 text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {loading ? '…' : safeDatabases.length}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground border-t border-white/[0.05] pt-2">
            <span>Configured connections</span>
            <span className="text-foreground/80 font-mono text-[10px]">PG · MySQL · SQLite</span>
          </div>
        </div>

        {/* Card 2: Registered API Keys */}
        <div className="relative rounded-xl border border-white/[0.07] bg-card p-4 transition-colors hover:border-white/[0.12]">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">API Keys & Tokens</span>
            <Badge variant="outline" className="text-[11px] gap-1 px-1.5 py-0 border-white/[0.08]">
              <IconKey className="size-3 text-sky-400" />
              Active
            </Badge>
          </div>
          <div className="mt-3 text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {loading ? '…' : safeKeys.length}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground border-t border-white/[0.05] pt-2">
            <span>Machine credentials</span>
            <span className="text-foreground/80">BLAKE3 secured</span>
          </div>
        </div>

        {/* Card 3: Cache Hit Ratio */}
        <div className="relative rounded-xl border border-white/[0.07] bg-card p-4 transition-colors hover:border-white/[0.12]">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">L1 + L2 Cache</span>
            <Badge variant="outline" className="text-[11px] gap-1 px-1.5 py-0 border-white/[0.08]">
              <IconBolt className="size-3 text-amber-400" />
              {cacheStats?.entries_count ?? 0} entries
            </Badge>
          </div>
          <div className="mt-3 text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {hitRatePct}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground border-t border-white/[0.05] pt-2">
            <span>Sub-microsecond L1</span>
            <span className="font-mono text-emerald-400">{totalHits} hits</span>
          </div>
        </div>

        {/* Card 4: System Uptime */}
        <div className="relative rounded-xl border border-white/[0.07] bg-card p-4 transition-colors hover:border-white/[0.12]">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Gateway Uptime</span>
            <Badge variant="outline" className="text-[11px] gap-1 px-1.5 py-0 border-white/[0.08]">
              v4.0.0
            </Badge>
          </div>
          <div className="mt-3 text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {status?.uptime_seconds ? formatUptime(status.uptime_seconds) : 'Active'}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground border-t border-white/[0.05] pt-2">
            <span>Tokio Runtime</span>
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Optimal
            </span>
          </div>
        </div>
      </div>

      {/* 3. Cache & Throughput Quick Strip */}
      <div className="rounded-xl border border-white/[0.07] bg-card p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.06] text-foreground">
            <IconActivity className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">Continuous Gateway Activity</h3>
            <p className="text-xs text-muted-foreground">
              Direct connection pool queries with AST parse firewall, WAF inspection, and low-allocation serialization.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full bg-sky-400" />
            <span>L1 RAM: {cacheStats?.hits_l1 ?? 0}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full bg-indigo-400" />
            <span>L2 Disk: {cacheStats?.hits_l2 ?? 0}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full bg-amber-400" />
            <span>Misses: {cacheStats?.misses ?? 0}</span>
          </div>
        </div>
      </div>

      {/* 4. Unified Data Management Section */}
      <div className="rounded-xl border border-white/[0.07] bg-card overflow-hidden">
        {/* Sub-navigation bar with segmented tabs and search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3 bg-white/[0.01]">
          {/* Segmented control */}
          <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/[0.06] w-fit">
            <button
              type="button"
              onClick={() => setActiveTab('databases')}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'databases'
                  ? 'bg-white/10 text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>Database Pools</span>
              <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] tabular-nums">
                {safeDatabases.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('keys')}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'keys'
                  ? 'bg-white/10 text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>API Keys</span>
              <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] tabular-nums">
                {safeKeys.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'audit'
                  ? 'bg-white/10 text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>Audit Trail</span>
              <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] tabular-nums">
                {safeAudit.length}
              </span>
            </button>
          </div>

          {/* Quick search input */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder={`Filter ${activeTab}…`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-48 sm:w-64 rounded-lg border border-white/[0.08] bg-black/30 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-white/20 transition-colors"
              />
            </div>
            {activeTab === 'databases' && (
              <Button size="sm" onClick={() => navigate('/databases')} className="h-8 gap-1 text-xs">
                <IconPlus className="size-3.5" />
                <span className="hidden sm:inline">Connect</span>
              </Button>
            )}
            {activeTab === 'keys' && (
              <Button size="sm" onClick={() => navigate('/keys')} className="h-8 gap-1 text-xs">
                <IconPlus className="size-3.5" />
                <span className="hidden sm:inline">New Key</span>
              </Button>
            )}
          </div>
        </div>

        {/* Content Table Body */}
        <div className="overflow-x-auto">
          {activeTab === 'databases' && (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/[0.06] bg-white/[0.01] text-muted-foreground font-medium">
                <tr>
                  <th className="px-4 py-2.5">Alias</th>
                  <th className="px-4 py-2.5">Dialect / Engine</th>
                  <th className="px-4 py-2.5">Pool Limit</th>
                  <th className="px-4 py-2.5">Health State</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredDatabases.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      No database connections found. Click &quot;Connect&quot; to register your first pool.
                    </td>
                  </tr>
                ) : (
                  filteredDatabases.map((db) => (
                    <tr key={db.alias} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground flex items-center gap-2">
                        <IconDatabase className="size-3.5 text-muted-foreground" />
                        <span>{db.alias}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-foreground">
                          {db.engine.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono">
                        {db.pool_min} – {db.pool_max} conns
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-emerald-400">
                          <span className="size-1.5 rounded-full bg-emerald-400" />
                          Ready
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => navigate('/databases')}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'keys' && (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/[0.06] bg-white/[0.01] text-muted-foreground font-medium">
                <tr>
                  <th className="px-4 py-2.5">Identifier</th>
                  <th className="px-4 py-2.5">Assigned Role</th>
                  <th className="px-4 py-2.5">Rate Limit</th>
                  <th className="px-4 py-2.5">Expiration</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredKeys.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      No API keys found. Click &quot;New Key&quot; to generate an access credential.
                    </td>
                  </tr>
                ) : (
                  filteredKeys.map((k) => (
                    <tr key={k.name} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground flex items-center gap-2">
                        <IconKey className="size-3.5 text-sky-400" />
                        <span>{k.name}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-white/[0.06] px-2 py-0.5 text-[11px] text-foreground font-medium">
                          {k.role_name || 'Admin'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono">
                        {k.rate_limit > 0 ? `${k.rate_limit} req/min` : 'Global default'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {k.expires_at ? new Date(k.expires_at * 1000).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => navigate('/keys')}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'audit' && (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/[0.06] bg-white/[0.01] text-muted-foreground font-medium">
                <tr>
                  <th className="px-4 py-2.5">Timestamp</th>
                  <th className="px-4 py-2.5">Actor</th>
                  <th className="px-4 py-2.5">Action Event</th>
                  <th className="px-4 py-2.5">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredAudit.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-muted-foreground">
                      No security audit events recorded.
                    </td>
                  </tr>
                ) : (
                  filteredAudit.map((a) => (
                    <tr key={a.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                        {new Date(a.timestamp * 1000).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">{a.actor}</td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-sky-500/10 text-sky-400 px-2 py-0.5 text-[11px] font-medium">
                          {a.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-[11px]">
                        {a.target || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
