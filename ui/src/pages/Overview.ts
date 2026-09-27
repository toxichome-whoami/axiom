/*
 * System overview dashboard displaying metrics, resource usage, and quick actions.
 */

import { api, SystemStatus, CacheStats, AuditRecord } from '../api';
import { icon } from '../components/Icons';

export async function renderOverview(container: HTMLElement) {
  container.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Overview</h1>
          <p class="text-xs text-secondary mt-0.5">Real-time gateway status and system health.</p>
        </div>
        <button id="refresh-overview" class="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
          ${icon('refresh', 'w-3.5 h-3.5')}
          <span>Refresh</span>
        </button>
      </div>

      <!-- Stat Cards Grid -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="flex items-center justify-between text-secondary mb-1">
            <span class="text-xs font-medium">Databases</span>
            ${icon('database', 'w-4 h-4 text-accent-blue')}
          </div>
          <div id="stat-dbs" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Configured connection pools</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="flex items-center justify-between text-secondary mb-1">
            <span class="text-xs font-medium">API Keys</span>
            ${icon('key', 'w-4 h-4 text-accent-orange')}
          </div>
          <div id="stat-keys" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Active client credentials</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="flex items-center justify-between text-secondary mb-1">
            <span class="text-xs font-medium">Cache Hit Rate</span>
            ${icon('hard-drive', 'w-4 h-4 text-emerald-400')}
          </div>
          <div id="stat-cache-rate" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div id="stat-cache-entries" class="text-[11px] text-secondary mt-1">0 active entries</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="flex items-center justify-between text-secondary mb-1">
            <span class="text-xs font-medium">System Uptime</span>
            ${icon('activity', 'w-4 h-4 text-purple-400')}
          </div>
          <div id="stat-uptime" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div id="stat-mem" class="text-[11px] text-secondary mt-1">Memory RSS: — MB</div>
        </div>
      </div>

      <!-- Quick Actions & Recent Activity -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Quick Actions -->
        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-4">
          <h2 class="text-sm font-semibold text-primary">Quick Actions</h2>
          <div class="space-y-2">
            <a href="#/databases" class="flex items-center justify-between p-3 rounded-md bg-background border border-surfaceBorder hover:border-borderDefault transition-colors group">
              <div class="flex items-center space-x-3">
                <span class="p-2 rounded bg-accent-blue/10 text-accent-blue">${icon('database', 'w-4 h-4')}</span>
                <div>
                  <div class="text-xs font-medium text-primary group-hover:text-accent-orange">Connect Database</div>
                  <div class="text-[11px] text-secondary">Add PostgreSQL, MySQL, SQLite, MSSQL</div>
                </div>
              </div>
              <span class="text-secondary group-hover:text-primary">&rarr;</span>
            </a>

            <a href="#/keys" class="flex items-center justify-between p-3 rounded-md bg-background border border-surfaceBorder hover:border-borderDefault transition-colors group">
              <div class="flex items-center space-x-3">
                <span class="p-2 rounded bg-accent-orange/10 text-accent-orange">${icon('key', 'w-4 h-4')}</span>
                <div>
                  <div class="text-xs font-medium text-primary group-hover:text-accent-orange">Create API Key</div>
                  <div class="text-[11px] text-secondary">Generate secure machine token</div>
                </div>
              </div>
              <span class="text-secondary group-hover:text-primary">&rarr;</span>
            </a>

            <a href="#/cache" class="flex items-center justify-between p-3 rounded-md bg-background border border-surfaceBorder hover:border-borderDefault transition-colors group">
              <div class="flex items-center space-x-3">
                <span class="p-2 rounded bg-emerald-500/10 text-emerald-400">${icon('hard-drive', 'w-4 h-4')}</span>
                <div>
                  <div class="text-xs font-medium text-primary group-hover:text-accent-orange">Inspect Cache</div>
                  <div class="text-[11px] text-secondary">L1 RAM & L2 disk persistence</div>
                </div>
              </div>
              <span class="text-secondary group-hover:text-primary">&rarr;</span>
            </a>
          </div>
        </div>

        <!-- Recent Audit Log Activity -->
        <div class="lg:col-span-2 bg-surface border border-surfaceBorder p-5 rounded-lg space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-primary">Recent Control Plane Activity</h2>
            <a href="#/audit" class="text-xs text-accent-orange hover:underline">View all</a>
          </div>

          <div id="overview-audit-list" class="space-y-2">
            <div class="text-xs text-secondary py-4 text-center">Loading audit log...</div>
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
        api.getAuditLog(5, 0).catch(() => []),
      ]);

      if (status) {
        (document.getElementById('stat-dbs') as HTMLElement).textContent = String(status.active_databases);
        (document.getElementById('stat-keys') as HTMLElement).textContent = String(status.registered_keys);
        
        const uptimeMins = Math.floor(status.uptime_seconds / 60);
        const uptimeStr = uptimeMins < 60 ? `${uptimeMins}m` : `${Math.floor(uptimeMins / 60)}h ${uptimeMins % 60}m`;
        (document.getElementById('stat-uptime') as HTMLElement).textContent = uptimeStr;
        (document.getElementById('stat-mem') as HTMLElement).textContent = `Memory RSS: ${status.memory_mb} MB | CPU: ${status.cpu_percent.toFixed(1)}%`;
      }

      if (cache) {
        const totalHits = cache.hits_l1 + cache.hits_l2;
        const totalRequests = totalHits + cache.misses;
        const rate = totalRequests > 0 ? ((totalHits / totalRequests) * 100).toFixed(1) : '0.0';
        (document.getElementById('stat-cache-rate') as HTMLElement).textContent = `${rate}%`;
        (document.getElementById('stat-cache-entries') as HTMLElement).textContent = `${cache.entries_count} L1 cached entries`;
      }

      const auditList = document.getElementById('overview-audit-list') as HTMLElement;
      if (audit && audit.length > 0) {
        auditList.innerHTML = audit.map((rec) => `
          <div class="flex items-center justify-between py-2 px-3 rounded bg-background border border-surfaceBorder text-xs">
            <div class="flex items-center space-x-2">
              <span class="font-mono text-accent-orange font-semibold">${rec.action}</span>
              <span class="text-primary">${rec.target}</span>
              ${rec.details ? `<span class="text-secondary text-[11px]">(${rec.details})</span>` : ''}
            </div>
            <div class="text-secondary text-[11px] font-mono">
              ${new Date(rec.timestamp * 1000).toLocaleTimeString()}
            </div>
          </div>
        `).join('');
      } else {
        auditList.innerHTML = `<div class="text-xs text-secondary py-4 text-center">No recent audit log entries recorded.</div>`;
      }
    } catch {}
  }

  document.getElementById('refresh-overview')?.addEventListener('click', loadData);
  loadData();
}
