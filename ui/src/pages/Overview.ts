/*
 * System overview dashboard displaying metrics, resource usage, and quick actions.
 * Ported from binary_alive TelemetryCard and Cloudflare analytics dashboard.
 */

import { api } from '../api';
import { icon } from '../components/Icons';
import { toast } from '../components/Toast';

export async function renderOverview(container: HTMLElement) {
  container.innerHTML = `
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Page Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-white tracking-tight">Overview</h1>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Real-time gateway status, connection pools, and cache telemetry.</p>
        </div>
        <button 
          id="refresh-overview" 
          type="button"
          class="flex items-center gap-1.5 px-3 h-8 bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] rounded-lg text-xs font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
        >
          ${icon('refresh', 'w-3.5 h-3.5 text-[#8c8c8c]')}
          <span>Refresh</span>
        </button>
      </div>

      <!-- Telemetry Cards Grid matching binary_alive TelemetryCard -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <!-- Databases Card -->
        <a href="#/databases" class="block rounded-lg bg-[#0e0e0e] border border-[#222222] hover:border-[#383838] transition-colors p-4 relative group overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal group-hover:text-[#cccccc] transition-colors">Active Databases</span>
            <span class="text-xs font-medium text-emerald-400 flex items-center gap-0.5">
              ${icon('arrow-up-right', 'w-3.5 h-3.5')}
              <span>Pools</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="stat-dbs" class="text-[26px] font-semibold text-white tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">configured</span>
          </div>
          <div class="w-full h-10 mt-3 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 20 Q 25 10, 50 16 T 100 4" fill="none" stroke="#3b82f6" stroke-width="2" />
            </svg>
          </div>
        </a>

        <!-- API Keys Card -->
        <a href="#/keys" class="block rounded-lg bg-[#0e0e0e] border border-[#222222] hover:border-[#383838] transition-colors p-4 relative group overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal group-hover:text-[#cccccc] transition-colors">Registered API Keys</span>
            <span class="text-xs font-medium text-[#f38020] flex items-center gap-0.5">
              ${icon('key', 'w-3.5 h-3.5')}
              <span>Tokens</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="stat-keys" class="text-[26px] font-semibold text-white tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">active</span>
          </div>
          <div class="w-full h-10 mt-3 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 18 Q 30 5, 60 14 T 100 6" fill="none" stroke="#f38020" stroke-width="2" />
            </svg>
          </div>
        </a>

        <!-- Cache Hit Rate Card -->
        <a href="#/cache" class="block rounded-lg bg-[#0e0e0e] border border-[#222222] hover:border-[#383838] transition-colors p-4 relative group overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal group-hover:text-[#cccccc] transition-colors">Cache Hit Ratio</span>
            <span class="text-xs font-medium text-emerald-400 flex items-center gap-0.5">
              ${icon('arrow-up-right', 'w-3.5 h-3.5')}
              <span>L1+L2</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="stat-cache-rate" class="text-[26px] font-semibold text-emerald-400 tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span id="stat-cache-entries" class="text-xs text-[#8c8c8c]">0 entries</span>
          </div>
          <div class="w-full h-10 mt-3 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 22 Q 25 12, 50 15 T 100 2" fill="none" stroke="#10b981" stroke-width="2" />
            </svg>
          </div>
        </a>

        <!-- Uptime & Diagnostics Card -->
        <a href="#/system" class="block rounded-lg bg-[#0e0e0e] border border-[#222222] hover:border-[#383838] transition-colors p-4 relative group overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal group-hover:text-[#cccccc] transition-colors">System Uptime</span>
            <span class="text-xs font-medium text-purple-400 flex items-center gap-0.5">
              ${icon('activity', 'w-3.5 h-3.5')}
              <span>Healthy</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="stat-uptime" class="text-[26px] font-semibold text-white tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span id="stat-mem" class="text-xs text-[#8c8c8c]">RSS: — MB</span>
          </div>
          <div class="w-full h-10 mt-3 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 16 Q 30 8, 70 12 T 100 5" fill="none" stroke="#a855f7" stroke-width="2" />
            </svg>
          </div>
        </a>
      </div>

      <!-- Quick Actions & Recent Activity -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Quick Actions Panel -->
        <div class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-5 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-medium text-white">Management Actions</h2>
            <span class="text-[11px] text-[#666666] font-mono">v4.0</span>
          </div>
          <div class="space-y-2">
            <a href="#/databases" class="flex items-center justify-between p-3 rounded-lg bg-[#141414] border border-[#262626] hover:border-[#383838] hover:bg-[#1a1a1a] transition-all group">
              <div class="flex items-center gap-3">
                <span class="p-2 rounded-md bg-[#3b82f6]/10 text-[#3b82f6]">${icon('database', 'w-4 h-4')}</span>
                <div>
                  <div class="text-xs font-medium text-white group-hover:text-[#f38020] transition-colors">Connect Database</div>
                  <div class="text-[11px] text-[#8c8c8c]">PostgreSQL, MySQL, SQLite, MSSQL</div>
                </div>
              </div>
              <span class="text-[#666666] group-hover:text-white transition-colors">&rarr;</span>
            </a>

            <a href="#/keys" class="flex items-center justify-between p-3 rounded-lg bg-[#141414] border border-[#262626] hover:border-[#383838] hover:bg-[#1a1a1a] transition-all group">
              <div class="flex items-center gap-3">
                <span class="p-2 rounded-md bg-[#f38020]/10 text-[#f38020]">${icon('key', 'w-4 h-4')}</span>
                <div>
                  <div class="text-xs font-medium text-white group-hover:text-[#f38020] transition-colors">Issue API Key</div>
                  <div class="text-[11px] text-[#8c8c8c]">Generate credential with role grants</div>
                </div>
              </div>
              <span class="text-[#666666] group-hover:text-white transition-colors">&rarr;</span>
            </a>

            <a href="#/cache" class="flex items-center justify-between p-3 rounded-lg bg-[#141414] border border-[#262626] hover:border-[#383838] hover:bg-[#1a1a1a] transition-all group">
              <div class="flex items-center gap-3">
                <span class="p-2 rounded-md bg-emerald-500/10 text-emerald-400">${icon('hard-drive', 'w-4 h-4')}</span>
                <div>
                  <div class="text-xs font-medium text-white group-hover:text-[#f38020] transition-colors">Inspect Cache Engine</div>
                  <div class="text-[11px] text-[#8c8c8c]">L1 RAM + L2 SQLite persistence</div>
                </div>
              </div>
              <span class="text-[#666666] group-hover:text-white transition-colors">&rarr;</span>
            </a>
          </div>
        </div>

        <!-- Recent Audit Log Table in DataTable Pattern -->
        <div class="lg:col-span-2 border border-[#262626] rounded-lg overflow-hidden bg-[#0e0e0e] flex flex-col">
          <div class="flex items-center justify-between px-4 py-3 bg-[#141414] border-b border-[#222222]">
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-medium text-white">Recent Control Plane Activity</h2>
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-[#1a1a1a] border border-[#262626] text-[#8c8c8c]">Live</span>
            </div>
            <a href="#/audit" class="text-xs text-[#f38020] hover:underline font-medium">View full trail &rarr;</a>
          </div>

          <div class="overflow-x-auto w-full">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b border-[#222222] bg-[#141414] h-[36px] text-xs text-[#8c8c8c] font-medium">
                  <th class="px-4">Action</th>
                  <th class="px-4">Target Resource</th>
                  <th class="px-4 hidden sm:table-cell">Details</th>
                  <th class="px-4 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody id="overview-audit-list" class="divide-y divide-[#1e1e1e] text-[13px]">
                <tr>
                  <td colspan="4" class="px-4 py-8 text-center text-xs text-[#666666]">
                    <div class="h-4 w-1/2 mx-auto rounded bg-[#1a1a1a] animate-pulse"></div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  async function loadData() {
    try {
      const [status, cache, audit] = await Promise.all([
        api.getStatus().catch(() => null),
        api.getCacheStats().catch(() => null),
        api.getAuditLog(6, 0).catch(() => []),
      ]);

      if (status) {
        (document.getElementById('stat-dbs') as HTMLElement).textContent = String(status.active_databases);
        (document.getElementById('stat-keys') as HTMLElement).textContent = String(status.registered_keys);
        
        const uptimeMins = Math.floor(status.uptime_seconds / 60);
        const uptimeStr = uptimeMins < 60 ? `${uptimeMins}m` : `${Math.floor(uptimeMins / 60)}h ${uptimeMins % 60}m`;
        (document.getElementById('stat-uptime') as HTMLElement).textContent = uptimeStr;
        (document.getElementById('stat-mem') as HTMLElement).textContent = `RSS: ${status.memory_mb} MB`;
      }

      if (cache) {
        const totalHits = cache.hits_l1 + cache.hits_l2;
        const totalRequests = totalHits + cache.misses;
        const rate = totalRequests > 0 ? ((totalHits / totalRequests) * 100).toFixed(1) : '0.0';
        (document.getElementById('stat-cache-rate') as HTMLElement).textContent = `${rate}%`;
        (document.getElementById('stat-cache-entries') as HTMLElement).textContent = `${cache.entries_count} L1 items`;
      }

      const auditList = document.getElementById('overview-audit-list') as HTMLElement;
      if (audit && audit.length > 0) {
        auditList.innerHTML = audit.map((rec) => `
          <tr class="h-[40px] hover:bg-[#161616] transition-colors">
            <td class="px-4 py-2">
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-medium uppercase bg-[#161616] text-[#f38020] border border-[#262626]">
                ${rec.action}
              </span>
            </td>
            <td class="px-4 py-2 font-mono text-white text-xs">${rec.target}</td>
            <td class="px-4 py-2 text-[#8c8c8c] text-xs truncate max-w-xs hidden sm:table-cell">${rec.details || '—'}</td>
            <td class="px-4 py-2 text-[#8c8c8c] text-xs font-mono text-right tabular-nums">
              ${new Date(rec.timestamp * 1000).toLocaleTimeString()}
            </td>
          </tr>
        `).join('');
      } else {
        auditList.innerHTML = `
          <tr>
            <td colspan="4" class="px-4 py-8 text-center text-xs text-[#666666]">
              No recent audit log entries recorded.
            </td>
          </tr>
        `;
      }
    } catch {}
  }

  document.getElementById('refresh-overview')?.addEventListener('click', async () => {
    await loadData();
    toast.info('Overview telemetry refreshed');
  });

  loadData();
}
