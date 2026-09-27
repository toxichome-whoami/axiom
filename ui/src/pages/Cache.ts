/*
 * Cache Engine interface displaying L1/L2 hits, misses, LRU evictions, and cache eviction controls.
 */

import { api, CacheStats } from '../api';
import { icon } from '../components/Icons';
import { toast, confirmDialog } from '../components/Toast';

export async function renderCache(container: HTMLElement) {
  let autoRefreshTimer: any = null;

  container.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Cache Engine</h1>
          <p class="text-xs text-secondary mt-0.5">Unified L1 DashMap (RAM) and L2 SQLite (AOF) telemetry and controls.</p>
        </div>
        <div class="flex items-center space-x-2">
          <button id="refresh-cache-btn" class="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
            ${icon('refresh', 'w-3.5 h-3.5')}
            <span>Refresh</span>
          </button>
          <button id="flush-cache-btn" class="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-md text-xs font-medium transition-colors">
            ${icon('trash', 'w-3.5 h-3.5')}
            <span>Flush Cache</span>
          </button>
        </div>
      </div>

      <!-- Cache Metrics Grid -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">Overall Hit Ratio</div>
          <div id="cache-hit-rate" class="text-2xl font-semibold text-emerald-400 font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">L1 & L2 combined hits</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">L1 Active Entries</div>
          <div id="cache-entries" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Live entries in RAM</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">LRU Evictions</div>
          <div id="cache-evictions" class="text-2xl font-semibold text-accent-orange font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Capacity threshold evictions</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">Cache Misses</div>
          <div id="cache-misses" class="text-2xl font-semibold text-secondary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Queries forwarded to DB</div>
        </div>
      </div>

      <!-- Tier Breakdown Details -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-4 shadow-xs">
          <div class="flex items-center space-x-2">
            ${icon('hard-drive', 'w-4 h-4 text-accent-blue')}
            <h2 class="text-sm font-semibold text-primary">Multi-Tier Breakdown</h2>
          </div>

          <div class="space-y-3 text-xs font-mono">
            <div class="flex items-center justify-between p-3 rounded bg-background border border-surfaceBorder">
              <div>
                <div class="font-medium text-primary">L1 RAM Cache (DashMap)</div>
                <div class="text-[11px] text-secondary font-sans mt-0.5">Sub-microsecond latency, true LRU eviction</div>
              </div>
              <div id="l1-hits" class="text-emerald-400 font-semibold">— hits</div>
            </div>

            <div class="flex items-center justify-between p-3 rounded bg-background border border-surfaceBorder">
              <div>
                <div class="font-medium text-primary">L2 Persistent Cache (SQLite AOF)</div>
                <div class="text-[11px] text-secondary font-sans mt-0.5">Survives server restart and power loss</div>
              </div>
              <div id="l2-hits" class="text-accent-blue font-semibold">— hits</div>
            </div>
          </div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-3 text-xs text-secondary leading-relaxed shadow-xs">
          <h2 class="text-sm font-semibold text-primary">Engine Durability Invariants</h2>
          <p>
            The unified v4 CacheEngine manages query response caching, per-IP/per-key rate limiting windows, and idempotency replay buffers through a single memory footprint.
          </p>
          <ul class="list-disc pl-5 space-y-1.5 pt-1">
            <li><strong class="text-primary font-normal">L1 Eviction:</strong> Strict least-recently-used (LRU) order when capacity bounds are reached.</li>
            <li><strong class="text-primary font-normal">TTL Sweep:</strong> Background BinaryHeap min-heap eviction daemon executing on 60s intervals.</li>
            <li><strong class="text-primary font-normal">Cache Stampede Guard:</strong> Single-flight query deduplication prevents downstream thundering herds.</li>
          </ul>
        </div>
      </div>
    </div>
  `;

  async function loadStats() {
    try {
      const stats = await api.getCacheStats();
      const totalHits = stats.hits_l1 + stats.hits_l2;
      const totalOps = totalHits + stats.misses;
      const rate = totalOps > 0 ? ((totalHits / totalOps) * 100).toFixed(1) : '0.0';

      (document.getElementById('cache-hit-rate') as HTMLElement).textContent = `${rate}%`;
      (document.getElementById('cache-entries') as HTMLElement).textContent = String(stats.entries_count);
      (document.getElementById('cache-evictions') as HTMLElement).textContent = String(stats.evictions);
      (document.getElementById('cache-misses') as HTMLElement).textContent = String(stats.misses);
      (document.getElementById('l1-hits') as HTMLElement).textContent = `${stats.hits_l1} hits`;
      (document.getElementById('l2-hits') as HTMLElement).textContent = `${stats.hits_l2} hits`;
    } catch {}
  }

  document.getElementById('refresh-cache-btn')?.addEventListener('click', async () => {
    await loadStats();
    toast.info('Cache telemetry updated');
  });

  document.getElementById('flush-cache-btn')?.addEventListener('click', () => {
    confirmDialog({
      title: 'Flush Cache Engine',
      message: 'Are you sure you want to flush all L1 RAM and L2 persistent cache entries? Upstream databases will absorb full query traffic until cache re-warms.',
      confirmText: 'Flush All',
      danger: true,
      onConfirm: async () => {
        try {
          await api.flushCache();
          toast.success('Cache flushed successfully');
          loadStats();
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : 'Flush failed');
        }
      },
    });
  });

  loadStats();
  autoRefreshTimer = setInterval(loadStats, 5000);

  const cleanup = () => {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);
}
