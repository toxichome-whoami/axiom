/*
 * System diagnostics and runtime environment specifications.
 */

import { api, SystemStatus } from '../api';
import { icon } from '../components/Icons';
import { toast } from '../components/Toast';

export async function renderSystem(container: HTMLElement) {
  container.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">System Information</h1>
          <p class="text-xs text-secondary mt-0.5">Runtime architecture, kernel diagnostics, and memory subsystem telemetry.</p>
        </div>
        <div class="flex items-center space-x-2">
          <button id="copy-sys-diag-btn" class="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
            ${icon('copy', 'w-3.5 h-3.5')}
            <span>Copy Diagnostics</span>
          </button>
          <button id="refresh-sys-btn" class="p-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-secondary hover:text-primary transition-colors" title="Refresh diagnostics">
            ${icon('refresh', 'w-4 h-4')}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Runtime Details -->
        <div class="bg-surface border border-surfaceBorder rounded-lg p-5 space-y-4 shadow-xs">
          <div class="flex items-center space-x-2 text-primary font-semibold text-sm">
            ${icon('server', 'w-4 h-4 text-accent-orange')}
            <span>Runtime Specifications</span>
          </div>

          <div class="space-y-2.5 text-xs font-mono">
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Binary Version</span>
              <span class="text-primary font-bold">Axiom v4.0.0</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Async Runtime</span>
              <span class="text-primary">Tokio Multi-Threaded</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Memory Allocator</span>
              <span class="text-primary">mimalloc (secure zero-on-free)</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Metadata Store</span>
              <span class="text-primary">libsql (local axiom.db / remote Turso)</span>
            </div>
            <div class="flex justify-between py-1.5">
              <span class="text-secondary font-sans">Protocol Handlers</span>
              <span class="text-primary">HTTP/1.1 REST + MCP v1 + Prometheus</span>
            </div>
          </div>
        </div>

        <!-- Live Diagnostics -->
        <div class="bg-surface border border-surfaceBorder rounded-lg p-5 space-y-4 shadow-xs">
          <div class="flex items-center space-x-2 text-primary font-semibold text-sm">
            ${icon('activity', 'w-4 h-4 text-emerald-400')}
            <span>Live Process Diagnostics</span>
          </div>

          <div class="space-y-2.5 text-xs font-mono">
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Process Uptime</span>
              <span id="sys-uptime" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Resident Set Size (RSS)</span>
              <span id="sys-mem" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Process CPU Utilization</span>
              <span id="sys-cpu" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Active Connection Pools</span>
              <span id="sys-pools" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5">
              <span class="text-secondary font-sans">Registered Client Keys</span>
              <span id="sys-keys" class="text-primary font-semibold">—</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  let currentDiagText = '';

  async function loadSystemStats() {
    try {
      const status = await api.getStatus();
      const uptimeMins = Math.floor(status.uptime_seconds / 60);
      const uptimeStr = uptimeMins < 60 ? `${uptimeMins} minutes` : `${Math.floor(uptimeMins / 60)}h ${uptimeMins % 60}m`;

      (document.getElementById('sys-uptime') as HTMLElement).textContent = uptimeStr;
      (document.getElementById('sys-mem') as HTMLElement).textContent = `${status.memory_mb} MB`;
      (document.getElementById('sys-cpu') as HTMLElement).textContent = `${status.cpu_percent.toFixed(1)}%`;
      (document.getElementById('sys-pools') as HTMLElement).textContent = `${status.active_databases} pools`;
      (document.getElementById('sys-keys') as HTMLElement).textContent = `${status.registered_keys} keys`;

      currentDiagText = JSON.stringify(status, null, 2);
    } catch {}
  }

  document.getElementById('refresh-sys-btn')?.addEventListener('click', async () => {
    await loadSystemStats();
    toast.info('Diagnostics updated');
  });

  document.getElementById('copy-sys-diag-btn')?.addEventListener('click', async () => {
    if (currentDiagText) {
      await navigator.clipboard.writeText(currentDiagText);
      toast.success('System diagnostics copied to clipboard');
    }
  });

  loadSystemStats();
}
