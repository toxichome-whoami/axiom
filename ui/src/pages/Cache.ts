/*
 * Cache Engine interface displaying L1/L2 hits, misses, LRU evictions, and cache eviction controls.
 */

import { api, CacheStats } from '../api';
import { icon } from '../components/Icons';

export async function renderCache(container: HTMLElement) {
  container.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Cache Engine</h1>
          <p class="text-xs text-secondary mt-0.5">Unified L1 DashMap (RAM) and L2 SQLite (AOF) caching telemetry.</p>
        </div>
        <div class="flex items-center space-x-2">
          <button id="refresh-cache-btn" class="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
            ${icon('refresh', 'w-3.5 h-3.5')}
            <span>Refresh</span>
          </button>
          <button id="flush-cache-btn" class="flex items-center space-x-1.5 px-3 py-1.5 bg-accent-danger/20 hover:bg-accent-danger/30 text-red-400 border border-accent-danger/30 rounded-md text-xs font-medium transition-colors">
            ${icon('trash', 'w-3.5 h-3.5')}
            <span>Flush Cache</span>
          </button>
        </div>
      </div>

      <!-- Cache Metrics Grid -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="text-xs text-secondary mb-1">Overall Hit Ratio</div>
          <div id="cache-hit-rate" class="text-2xl font-semibold text-emerald-400 font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">L1 & L2 combined hits</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="text-xs text-secondary mb-1">L1 Active Entries</div>
          <div id="cache-entries" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Live entries in RAM</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="text-xs text-secondary mb-1">LRU Evictions</div>
          <div id="cache-evictions" class="text-2xl font-semibold text-accent-orange font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Capacity threshold evictions</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="text-xs text-secondary mb-1">Cache Misses</div>
          <div id="cache-misses" class="text-2xl font-semibold text-secondary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Queries passed to upstream DB</div>
        </div>
      </div>

      <!-- Tier Breakdown Details -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-4">
          <div class="flex items-center space-x-2">
            ${icon('hard-drive', 'w-4 h-4 text-accent-blue')}
            <h2 class="text-sm font-semibold text-primary">Multi-Tier Breakdown</h2>
          </div>

          <div class="space-y-3 text-xs font-mono">
            <div class="flex items-center justify-between p-3 rounded bg-background border border-surfaceBorder">
              <div>
                <div class="font-medium text-primary">L1 RAM Cache (DashMap)</div>
                <div class="text-[11px] text-secondary">Sub-microsecond latency, true LRU eviction</div>
              </div>
              <div id="l1-hits" class="text-emerald-400 font-semibold">— hits</div>
            </div>

            <div class="flex items-center justify-between p-3 rounded bg-background border border-surfaceBorder">
              <div>
                <div class="font-medium text-primary">L2 Persistent Cache (SQLite AOF)</div>
                <div class="text-[11px] text-secondary">Survives server restart and power loss</div>
              </div>
              <div id="l2-hits" class="text-accent-blue font-semibold">— hits</div>
            </div>
          </div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-3 text-xs text-secondary leading-relaxed">
          <h2 class="text-sm font-semibold text-primary">Engine Durability Invariants</h2>
          <p>
            The v4 CacheEngine unifies rate limit buckets, query responses, and idempotency tokens.
          </p>
          <ul class="list-disc pl-5 space-y-1">
            <li><strong>L1 Eviction:</strong> Strict least-recently-used (LRU) order when capacity bounds are reached.</li>
            <li><strong>TTL Sweep:</strong> Background BinaryHeap min-heap eviction thread executing on 60s intervals.</li>
            <li><strong>Cache Stampede Guard:</strong> Deduplicates concurrent queries for the same key.</li>
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

  document.getElementById('refresh-cache-btn')?.addEventListener('click', loadStats);
  document.getElementById('flush-cache-btn')?.addEventListener('click', async () => {
    if (confirm('Flush all L1 RAM and L2 persistent cache entries immediately?')) {
      try {
        await api.flushCache();
        alert('Cache flushed successfully');
        loadStats();
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Flush failed');
      }
    }
  });

  loadStats();
}
