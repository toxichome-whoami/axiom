import React, { useState, useEffect } from 'react';
import { api, type CacheStats } from '../api';
import { TelemetryCard } from '../components/ui/TelemetryCard';
import { toast } from '../components/ui/Toast';
import { confirmAction } from '../components/ui/ConfirmDialog';
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
          <button
            onClick={loadStats}
            className="h-8 px-3 rounded text-xs font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#8c8c8c]" />
            <span>Refresh</span>
          </button>
          <button
            onClick={handleFlush}
            className="h-8 px-3 rounded text-xs font-medium text-rose-400 hover:text-white bg-rose-500/10 hover:bg-rose-600 border border-rose-500/20 hover:border-rose-600 transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Flush Cache</span>
          </button>
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

      {/* Breakdown Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-lg border border-[#222222] bg-[#0c0c0c] space-y-4">
          <h2 className="text-xs font-semibold text-white uppercase tracking-wider">
            Cache Durability & Eviction
          </h2>
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-[#1c1c1c]">
              <span className="text-[#8c8c8c]">Eviction Policy</span>
              <span className="font-mono text-white">True LRU (Least Recently Used)</span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-[#1c1c1c]">
              <span className="text-[#8c8c8c]">L1 Max Capacity</span>
              <span className="font-mono text-white">10,000 entries (bounded)</span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-[#1c1c1c]">
              <span className="text-[#8c8c8c]">TTL Cleanup Interval</span>
              <span className="font-mono text-white">BinaryHeap min-heap sweep</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8c8c8c]">Recorded Evictions</span>
              <span className="font-mono text-[#f38020]">{stats?.evictions ?? 0}</span>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-lg border border-[#222222] bg-[#0c0c0c] space-y-4">
          <h2 className="text-xs font-semibold text-white uppercase tracking-wider">
            Subsystem Routing Map
          </h2>
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-[#1c1c1c]">
              <span className="text-[#8c8c8c]">Rate Limit Counters</span>
              <span className="font-mono text-[#3b82f6]">Tier: Ephemeral (RAM)</span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-[#1c1c1c]">
              <span className="text-[#8c8c8c]">Query Results Cache</span>
              <span className="font-mono text-[#3b82f6]">Tier: Memory-only (5s TTL)</span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-[#1c1c1c]">
              <span className="text-[#8c8c8c]">Idempotency Keys</span>
              <span className="font-mono text-[#3b82f6]">Tier: Journaled (24h AOF)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8c8c8c]">Schema Metadata</span>
              <span className="font-mono text-[#3b82f6]">Tier: Memory-only (300s TTL)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
