/*
 * Overview dashboard page built with Shadcn UI primitives.
 * Owned by: ui/pages
 * Key deps: ../components/ui, ../api
 * Invariants: Real-time telemetry cards, quick-navigation cards, recent audit event log.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type SystemStatus, type AuditRecord } from '../api';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TelemetryCard,
} from '../components/ui';
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
          <Button
            size="sm"
            onClick={() => navigate('/databases')}
            className="bg-[#f38020] hover:bg-[#fa8c16] text-black font-semibold border-none"
          >
            + Connect Database
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/keys')}
          >
            Manage Keys
          </Button>
        </div>
      </div>

      {/* Telemetry Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <TelemetryCard
          title="ACTIVE DATABASES"
          value={loading ? '...' : (status?.active_databases ?? 0)}
          subtext="Healthy pools"
          icon={<Database className="w-4 h-4 text-[#f38020]" />}
        />
        <TelemetryCard
          title="REGISTERED KEYS"
          value={loading ? '...' : (status?.active_keys ?? status?.registered_keys ?? 0)}
          subtext="RBAC enforced"
          icon={<Key className="w-4 h-4 text-[#3b82f6]" />}
        />
        <TelemetryCard
          title="MEMORY FOOTPRINT"
          value={loading ? '...' : `${status?.memory_mb ?? 24} MB`}
          subtext="RSS in memory"
          icon={<Zap className="w-4 h-4 text-emerald-400" />}
        />
        <TelemetryCard
          title="GATEWAY UPTIME"
          value={loading ? '...' : formatUptime(status?.uptime_seconds ?? 0)}
          subtext="Continuous runtime"
          icon={<Clock className="w-4 h-4 text-amber-400" />}
        />
      </div>

      {/* Quick Action Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card
          onClick={() => navigate('/databases')}
          className="hover:border-[#383838] transition-colors cursor-pointer group p-4 space-y-2 bg-[#0c0c0c]"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[#f38020]" />
              <span className="text-sm font-semibold text-white">Database Pools</span>
            </div>
            <ArrowRight className="w-4 h-4 text-[#666666] group-hover:text-white transition-colors" />
          </div>
          <p className="text-xs text-[#8c8c8c] leading-relaxed">
            Attach PostgreSQL, MySQL, MSSQL, ClickHouse or LibSQL instances to the live data plane.
          </p>
        </Card>

        <Card
          onClick={() => navigate('/keys')}
          className="hover:border-[#383838] transition-colors cursor-pointer group p-4 space-y-2 bg-[#0c0c0c]"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-[#3b82f6]" />
              <span className="text-sm font-semibold text-white">API Keys & Tokens</span>
            </div>
            <ArrowRight className="w-4 h-4 text-[#666666] group-hover:text-white transition-colors" />
          </div>
          <p className="text-xs text-[#8c8c8c] leading-relaxed">
            Generate BLAKE3-hashed credentials, configure per-key rate limits, and assign RBAC roles.
          </p>
        </Card>

        <Card
          onClick={() => navigate('/metrics')}
          className="hover:border-[#383838] transition-colors cursor-pointer group p-4 space-y-2 bg-[#0c0c0c]"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold text-white">Prometheus Metrics</span>
            </div>
            <ArrowRight className="w-4 h-4 text-[#666666] group-hover:text-white transition-colors" />
          </div>
          <p className="text-xs text-[#8c8c8c] leading-relaxed">
            Inspect real-time HTTP throughput, query latency histograms, and rate-limit drops.
          </p>
        </Card>
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/audit')}
            className="text-xs text-[#8c8c8c] hover:text-white flex items-center gap-1 h-7"
          >
            <span>View all audit events</span>
            <ArrowRight className="w-3 h-3" />
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(!Array.isArray(audit) || audit.length === 0) ? (
              <TableRow>
                <TableCell colSpan={4} className="h-20 text-center text-[#666666]">
                  No control plane mutations recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              audit.map((evt) => (
                <TableRow key={evt.id}>
                  <TableCell className="font-mono text-[#8c8c8c]">
                    {new Date(evt.timestamp * 1000).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-medium text-white">{evt.actor}</TableCell>
                  <TableCell>
                    <Badge variant="orange">
                      {evt.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-[#8c8c8c]">{evt.target}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
