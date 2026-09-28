import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type SystemStatus, type AuditRecord } from '../api';
import { TelemetryCard } from '../components/ui/TelemetryCard';
import { Database, Key, Zap, Clock, ArrowRight, ShieldCheck, Activity } from 'lucide-react';

export const Overview: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [s, a] = await Promise.all([
          api.getStatus(),
          api.getAuditLog(6, 0).catch(() => []),
        ]);
        if (mounted) {
          setStatus(s);
          setAudit(a);
        }
      } catch (err) {
        console.error('Failed to load overview data', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#222222] pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">System Overview</h1>
          <p className="text-xs text-[#8c8c8c] mt-1">
            Real-time telemetry and operational status of the Axiom Gateway data plane.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/databases')}
            className="h-8 px-3 rounded text-xs font-semibold bg-[#f38020] hover:bg-[#fa8c16] text-black transition-colors"
          >
            + Connect Database
          </button>
          <button
            onClick={() => navigate('/keys')}
            className="h-8 px-3 rounded text-xs font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] transition-colors"
          >
            Manage Keys
          </button>
        </div>
      </div>

      {/* Telemetry Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <TelemetryCard
          title="ACTIVE DATABASES"
          value={loading ? '...' : (status?.active_databases ?? 0)}
          change="+1 this week"
          isPositive={true}
          subtext="Healthy pools"
          icon={<Database className="w-4 h-4 text-[#f38020]" />}
          sparkline={[2, 3, 3, 4, 4, 5, 5, 6, 6, status?.active_databases ?? 4]}
        />
        <TelemetryCard
          title="REGISTERED KEYS"
          value={loading ? '...' : (status?.registered_keys ?? 0)}
          change="active tokens"
          isPositive={true}
          subtext="RBAC enforced"
          icon={<Key className="w-4 h-4 text-[#3b82f6]" />}
          sparkline={[5, 6, 8, 8, 9, 10, 11, status?.registered_keys ?? 8]}
        />
        <TelemetryCard
          title="MEMORY FOOTPRINT"
          value={loading ? '...' : `${status?.memory_mb ?? 0} MB`}
          change="stable"
          isPositive={true}
          subtext="RSS in memory"
          icon={<Zap className="w-4 h-4 text-emerald-400" />}
          sparkline={[22, 23, 22, 24, 23, 24, 25, status?.memory_mb ?? 24]}
        />
        <TelemetryCard
          title="GATEWAY UPTIME"
          value={loading ? '...' : formatUptime(status?.uptime_seconds ?? 0)}
          change="100.0% SLA"
          isPositive={true}
          subtext="Zero downtime"
          icon={<Clock className="w-4 h-4 text-amber-400" />}
          sparkline={[99, 99, 100, 100, 100, 100, 100]}
        />
      </div>

      {/* Quick Action Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          onClick={() => navigate('/databases')}
          className="p-4 rounded-lg border border-[#222222] bg-[#0c0c0c] hover:border-[#383838] transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[#f38020]" />
              <span className="text-sm font-semibold text-white">Database Pools</span>
            </div>
            <ArrowRight className="w-4 h-4 text-[#666666] group-hover:text-white transition-colors" />
          </div>
          <p className="text-xs text-[#8c8c8c] leading-relaxed">
            Attach PostgreSQL, MySQL, MSSQL, ClickHouse or LibSQL instances to the live data plane.
          </p>
        </div>

        <div
          onClick={() => navigate('/keys')}
          className="p-4 rounded-lg border border-[#222222] bg-[#0c0c0c] hover:border-[#383838] transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-[#3b82f6]" />
              <span className="text-sm font-semibold text-white">API Keys & Tokens</span>
            </div>
            <ArrowRight className="w-4 h-4 text-[#666666] group-hover:text-white transition-colors" />
          </div>
          <p className="text-xs text-[#8c8c8c] leading-relaxed">
            Generate BLAKE3-hashed credentials, configure per-key rate limits, and assign RBAC roles.
          </p>
        </div>

        <div
          onClick={() => navigate('/metrics')}
          className="p-4 rounded-lg border border-[#222222] bg-[#0c0c0c] hover:border-[#383838] transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold text-white">Prometheus Metrics</span>
            </div>
            <ArrowRight className="w-4 h-4 text-[#666666] group-hover:text-white transition-colors" />
          </div>
          <p className="text-xs text-[#8c8c8c] leading-relaxed">
            Inspect real-time HTTP throughput, query latency histograms, and rate-limit drops.
          </p>
        </div>
      </div>

      {/* Recent Audit Log Feed */}
      <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#222222] flex items-center justify-between bg-[#0e0e0e]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#f38020]" />
            <h2 className="text-xs font-semibold text-white uppercase tracking-wider">
              Recent Control Plane Activity
            </h2>
          </div>
          <button
            onClick={() => navigate('/audit')}
            className="text-xs text-[#8c8c8c] hover:text-white transition-colors flex items-center gap-1"
          >
            <span>View all audit events</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#141414] text-[#8c8c8c] border-b border-[#222222]">
              <tr>
                <th className="px-4 py-2.5 font-medium">Timestamp</th>
                <th className="px-4 py-2.5 font-medium">Actor</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e1e]">
              {(!Array.isArray(audit) || audit.length === 0) ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[#666666]">
                    No control plane mutations recorded yet.
                  </td>
                </tr>
              ) : (
                audit.map((evt) => (
                  <tr key={evt.id} className="hover:bg-[#141414] transition-colors">
                    <td className="px-4 py-2.5 font-mono text-[#8c8c8c]">
                      {new Date(evt.timestamp * 1000).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-white">{evt.actor}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#141414] border border-[#262626] text-[#f38020]">
                        {evt.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[#8c8c8c]">{evt.target}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
