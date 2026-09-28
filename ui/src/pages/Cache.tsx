/*
 * Cache management page built with Shadcn UI primitives.
 * Owned by: ui/pages
 * Key deps: ../components/ui, ../api
 * Invariants: L1/L2 telemetry presentation, cache flush safety confirmation.
 */

import React, { useState, useEffect } from 'react';
import { api, type CacheStats } from '../api';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  TelemetryCard,
  toast,
  confirmAction,
} from '../components/ui';
import { Zap, RefreshCw, Trash2, Database, ShieldAlert, Cpu } from 'lucide-react';

export const Cache: React.FC = () => {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = async () => {
    try {
      setLoading(true);
      const res = await api.getCacheStats();
      setStats(res);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load cache metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleFlush = () => {
    confirmAction({
      title: 'Flush All Cache Layers',
      message: 'Flushing the cache clears all L1 DashMap entries, invalidates prepared query plans, and purges rate limit buckets. Are you sure you want to proceed?',
      confirmText: 'Flush All Caches',
      danger: true,
      onConfirm: async () => {
        try {
          await api.flushCache();
          toast.success('L1 & L2 Cache cleared successfully');
          loadStats();
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : 'Flush failed');
        }
      },
    });
  };

  const hitRatePct = stats
    ? ((stats.hits_l1 + stats.hits_l2) / Math.max(1, stats.hits_l1 + stats.hits_l2 + stats.misses) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#222222] pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Cache Engine</h1>
          <p className="text-xs text-[#8c8c8c] mt-1">
            Two-tier caching subsystem: L1 sub-microsecond DashMap in-memory tier and persistent L2 AOF.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={loadStats}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleFlush}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Flush Cache</span>
          </Button>
        </div>
      </div>

      {/* Telemetry Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <TelemetryCard
          title="L1 MEMORY HITS"
          value={loading ? '...' : (stats?.hits_l1 ?? 0)}
          subtext="DashMap RAM (< 1 µs)"
          icon={<Zap className="w-4 h-4 text-[#f38020]" />}
        />
        <TelemetryCard
          title="L2 PERSISTENT HITS"
          value={loading ? '...' : (stats?.hits_l2 ?? 0)}
          subtext="SQLite AOF (~ 50 µs)"
          icon={<Database className="w-4 h-4 text-[#3b82f6]" />}
        />
        <TelemetryCard
          title="CACHE HIT RATIO"
          value={loading ? '...' : `${hitRatePct}%`}
          isPositive={Number(hitRatePct) > 50}
          subtext="L1/L2 Combined"
          icon={<Cpu className="w-4 h-4 text-emerald-400" />}
        />
        <TelemetryCard
          title="ACTIVE ENTRIES"
          value={loading ? '...' : (stats?.entries_count ?? 0)}
          subtext="LRU managed"
          icon={<ShieldAlert className="w-4 h-4 text-amber-400" />}
        />
      </div>

      {/* Cache Architecture Blueprint */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5 space-y-3 bg-[#0c0c0c]">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#f38020]" />
            <h3 className="text-sm font-semibold text-white">L1 In-Memory DashMap Tier</h3>
          </div>
          <p className="text-xs text-[#8c8c8c] leading-relaxed">
            High-concurrency lock-sharded key-value storage. Evaluated on the hot query path before routing to downstream SQL engines. Evicts via least-recently-used heuristics when reaching memory bounds.
          </p>
          <div className="pt-2 flex items-center justify-between text-xs text-[#666666] font-mono border-t border-[#1e1e1e]">
            <span>Latency Target: &lt; 1 µs</span>
            <span>Eviction: LRU</span>
          </div>
        </Card>

        <Card className="p-5 space-y-3 bg-[#0c0c0c]">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[#3b82f6]" />
            <h3 className="text-sm font-semibold text-white">L2 Persistent SQLite AOF Tier</h3>
          </div>
          <p className="text-xs text-[#8c8c8c] leading-relaxed">
            Write-ahead journaled SQLite layer for preserving idempotency tokens and critical query plans across daemon restarts. Provides durability without requiring external Redis instances.
          </p>
          <div className="pt-2 flex items-center justify-between text-xs text-[#666666] font-mono border-t border-[#1e1e1e]">
            <span>Latency Target: ~ 50 µs</span>
            <span>Persistence: AOF WAL</span>
          </div>
        </Card>
      </div>
    </div>
  );
};
