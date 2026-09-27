/*
 * System diagnostics and runtime environment specifications.
 * Ported from binary_alive Settings & Process architecture.
 */

import { api, SystemStatus } from '../api';
import { icon } from '../components/Icons';
import { toast } from '../components/Toast';

export async function renderSystem(container: HTMLElement) {
  container.innerHTML = `
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-white tracking-tight">System Diagnostics</h1>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Runtime architecture, kernel diagnostics, and memory subsystem telemetry.</p>
        </div>
        <div class="flex items-center gap-2">
          <button 
            id="copy-sys-diag-btn" 
            type="button"
            class="flex items-center gap-1.5 px-3 h-8 bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] rounded-lg text-xs font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            ${icon('copy', 'w-3.5 h-3.5 text-[#8c8c8c]')}
            <span>Copy Diagnostics</span>
          </button>
          <button 
            id="refresh-sys-btn" 
            type="button"
            class="size-8 rounded-lg bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] text-[#8c8c8c] hover:text-white transition-colors flex items-center justify-center cursor-pointer" 
            title="Refresh diagnostics"
          >
            ${icon('refresh', 'w-3.5 h-3.5')}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Runtime Details Panel -->
        <div class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-5 space-y-4">
          <div class="flex items-center gap-2 text-white font-semibold text-sm">
            <span class="p-1.5 rounded-md bg-[#f38020]/10 text-[#f38020]">
              ${icon('server', 'w-4 h-4')}
            </span>
            <span>Runtime Specifications</span>
          </div>

          <div class="space-y-2.5 text-xs font-mono">
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Binary Version</span>
              <span class="text-white font-medium">Axiom v4.0.0</span>
            </div>
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Async Runtime</span>
              <span class="text-white">Tokio Multi-Threaded</span>
            </div>
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Memory Allocator</span>
              <span class="text-white">mimalloc (secure zero-on-free)</span>
            </div>
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Metadata Store</span>
              <span class="text-white">libsql (local axiom.db / remote Turso)</span>
            </div>
            <div class="flex justify-between py-2">
              <span class="text-[#8c8c8c] font-sans">Protocol Handlers</span>
              <span class="text-white">HTTP/1.1 REST + MCP v1 + Prometheus</span>
            </div>
          </div>
        </div>

        <!-- Live Diagnostics Panel -->
        <div class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-5 space-y-4">
          <div class="flex items-center gap-2 text-white font-semibold text-sm">
            <span class="p-1.5 rounded-md bg-emerald-500/10 text-emerald-400">
              ${icon('activity', 'w-4 h-4')}
            </span>
            <span>Live Process Telemetry</span>
          </div>

          <div class="space-y-2.5 text-xs font-mono">
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Process Uptime</span>
              <span id="sys-uptime" class="text-white font-semibold tabular-nums">—</span>
            </div>
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Resident Set Size (RSS)</span>
              <span id="sys-mem" class="text-white font-semibold tabular-nums">—</span>
            </div>
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Process CPU Utilization</span>
              <span id="sys-cpu" class="text-white font-semibold tabular-nums">—</span>
            </div>
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Active Connection Pools</span>
              <span id="sys-pools" class="text-white font-semibold tabular-nums">—</span>
            </div>
            <div class="flex justify-between py-2">
              <span class="text-[#8c8c8c] font-sans">Registered Client Keys</span>
              <span id="sys-keys" class="text-white font-semibold tabular-nums">—</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  let currentDiagText = '';

  async function loadSystemStats() {
    try {
      const status: SystemStatus = await api.getStatus();
      const uptimeMins = Math.floor(status.uptime_seconds / 60);
      const uptimeStr = uptimeMins < 60 ? `${uptimeMins} minutes` : `${Math.floor(uptimeMins / 60)}h ${uptimeMins % 60}m`;

      (document.getElementById('sys-uptime') as HTMLElement).textContent = uptimeStr;
      (document.getElementById('sys-mem') as HTMLElement).textContent = `${status.memory_mb} MB`;
      (document.getElementById('sys-cpu') as HTMLElement).textContent = `${status.cpu_percent.toFixed(1)}%`;
      (document.getElementById('sys-pools') as HTMLElement).textContent = `${status.active_databases} databases`;
      (document.getElementById('sys-keys') as HTMLElement).textContent = `${status.registered_keys} keys`;

      currentDiagText = JSON.stringify(status, null, 2);
    } catch {}
  }

  document.getElementById('copy-sys-diag-btn')?.addEventListener('click', async () => {
    if (currentDiagText) {
      await navigator.clipboard.writeText(currentDiagText);
      toast.success('System diagnostics copied to clipboard');
    }
  });

  document.getElementById('refresh-sys-btn')?.addEventListener('click', async () => {
    await loadSystemStats();
    toast.info('Diagnostics refreshed');
  });

  loadSystemStats();
}
