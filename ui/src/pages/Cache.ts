/*
 * Cache Engine interface displaying L1/L2 hits, misses, LRU evictions, and cache eviction controls.
 * Ported from binary_alive TelemetryCard and Cloudflare analytics dashboard.
 */

import { api } from '../api';
import { icon } from '../components/Icons';
import { toast, confirmDialog } from '../components/Toast';

export async function renderCache(container: HTMLElement) {
  let autoRefreshTimer: any = null;

  container.innerHTML = `
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-white tracking-tight">Cache Engine</h1>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Unified L1 DashMap (RAM) and L2 SQLite (AOF) telemetry and controls.</p>
        </div>
        <div class="flex items-center gap-2">
          <button 
            id="refresh-cache-btn" 
            type="button"
            class="flex items-center gap-1.5 px-3 h-8 bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] rounded-lg text-xs font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            ${icon('refresh', 'w-3.5 h-3.5 text-[#8c8c8c]')}
            <span>Refresh</span>
          </button>
          <button 
            id="flush-cache-btn" 
            type="button"
            class="flex items-center gap-1.5 px-3 h-8 bg-[#141414] hover:bg-rose-500/20 text-[#8c8c8c] hover:text-rose-400 border border-[#262626] hover:border-rose-500/30 rounded-lg text-xs font-medium transition-colors cursor-pointer"
          >
            ${icon('trash', 'w-3.5 h-3.5')}
            <span>Flush Cache</span>
          </button>
        </div>
      </div>

      <!-- Telemetry Cards Grid matching binary_alive TelemetryCard -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">Overall Hit Ratio</span>
            <span class="text-xs font-medium text-emerald-400 flex items-center gap-0.5">
              ${icon('arrow-up-right', 'w-3.5 h-3.5')}
              <span>L1+L2</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="cache-hit-rate" class="text-[26px] font-semibold text-emerald-400 tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">combined</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 20 Q 30 5, 60 12 T 100 2" fill="none" stroke="#10b981" stroke-width="2" />
            </svg>
          </div>
        </div>

        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">L1 Active Entries</span>
            <span class="text-xs font-medium text-[#3b82f6] flex items-center gap-0.5">
              ${icon('hard-drive', 'w-3.5 h-3.5')}
              <span>RAM</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="cache-entries" class="text-[26px] font-semibold text-white tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">live in heap</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 16 Q 30 18, 70 8 T 100 6" fill="none" stroke="#3b82f6" stroke-width="2" />
            </svg>
          </div>
        </div>

        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">LRU Evictions</span>
            <span class="text-xs font-medium text-[#f38020] flex items-center gap-0.5">
              ${icon('activity', 'w-3.5 h-3.5')}
              <span>Threshold</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="cache-evictions" class="text-[26px] font-semibold text-[#f38020] tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">evicted</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 22 Q 40 20, 70 12 T 100 8" fill="none" stroke="#f38020" stroke-width="2" />
            </svg>
          </div>
        </div>

        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">Cache Misses</span>
            <span class="text-xs font-medium text-[#8c8c8c] flex items-center gap-0.5">
              <span>SQL Fallback</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="cache-misses" class="text-[26px] font-semibold text-[#cccccc] tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">to DB</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 14 Q 30 16, 60 10 T 100 18" fill="none" stroke="#666666" stroke-width="2" />
            </svg>
          </div>
        </div>
      </div>

      <!-- Tier Breakdown Details -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-5 space-y-4">
          <div class="flex items-center gap-2">
            <span class="p-1.5 rounded-md bg-[#3b82f6]/10 text-[#3b82f6]">
              ${icon('hard-drive', 'w-4 h-4')}
            </span>
            <h2 class="text-sm font-semibold text-white">Multi-Tier Breakdown</h2>
          </div>

          <div class="space-y-2.5 text-xs font-mono">
            <div class="flex items-center justify-between p-3.5 rounded-lg bg-[#141414] border border-[#262626]">
              <div>
                <div class="font-medium text-white">L1 RAM Cache (DashMap)</div>
                <div class="text-[11px] text-[#8c8c8c] font-sans mt-0.5">Sub-microsecond latency, true LRU eviction</div>
              </div>
              <div id="l1-hits" class="text-emerald-400 font-semibold tabular-nums">— hits</div>
            </div>

            <div class="flex items-center justify-between p-3.5 rounded-lg bg-[#141414] border border-[#262626]">
              <div>
                <div class="font-medium text-white">L2 Persistent Cache (SQLite AOF)</div>
                <div class="text-[11px] text-[#8c8c8c] font-sans mt-0.5">Survives server restart and power interruption</div>
              </div>
              <div id="l2-hits" class="text-[#3b82f6] font-semibold tabular-nums">— hits</div>
            </div>
          </div>
        </div>

        <div class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-5 space-y-3 text-xs text-[#8c8c8c] leading-relaxed">
          <h2 class="text-sm font-semibold text-white">Engine Durability Invariants</h2>
          <p>
            The unified v4 CacheEngine manages query response caching, per-IP/per-key rate limiting windows, and idempotency replay buffers through a single memory footprint.
          </p>
          <ul class="list-disc pl-5 space-y-1.5 pt-1 text-[#cccccc]">
            <li><strong class="text-white font-medium">L1 Eviction:</strong> Strict least-recently-used (LRU) order when capacity bounds are reached.</li>
            <li><strong class="text-white font-medium">TTL Sweep:</strong> Background BinaryHeap min-heap eviction daemon executing on 60s intervals.</li>
            <li><strong class="text-white font-medium">Cache Stampede Guard:</strong> Single-flight query deduplication prevents downstream thundering herds.</li>
          </ul>
        </div>
      </div>
    </div>
  `;

  async function loadStats() {
    try {
      const stats = await api.getCacheStats();
      const totalHits = stats.hits_l1 + stats.hits_l2;
      const totalRequests = totalHits + stats.misses;
      const hitRatio = totalRequests > 0 ? ((totalHits / totalRequests) * 100).toFixed(1) : '0.0';

      (document.getElementById('cache-hit-rate') as HTMLElement).textContent = `${hitRatio}%`;
      (document.getElementById('cache-entries') as HTMLElement).textContent = String(stats.entries_count);
      (document.getElementById('cache-evictions') as HTMLElement).textContent = String(stats.evictions);
      (document.getElementById('cache-misses') as HTMLElement).textContent = String(stats.misses);
      (document.getElementById('l1-hits') as HTMLElement).textContent = `${stats.hits_l1.toLocaleString()} hits`;
      (document.getElementById('l2-hits') as HTMLElement).textContent = `${stats.hits_l2.toLocaleString()} hits`;
    } catch {}
  }

  document.getElementById('refresh-cache-btn')?.addEventListener('click', async () => {
    await loadStats();
    toast.info('Cache statistics refreshed');
  });

  document.getElementById('flush-cache-btn')?.addEventListener('click', () => {
    confirmDialog({
      title: 'Flush Cache Engine',
      message: 'Are you sure you want to flush all L1 RAM and L2 SQLite cache stores? Rate limits, query results, and idempotency keys will be wiped.',
      confirmText: 'Flush All',
      danger: true,
      onConfirm: async () => {
        try {
          await api.flushCache();
          toast.success('Cache flushed completely');
          loadStats();
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : 'Failed to flush cache');
        }
      },
    });
  });

  await loadStats();
  autoRefreshTimer = setInterval(loadStats, 10000);

  const cleanup = () => {
    clearInterval(autoRefreshTimer);
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);
}
