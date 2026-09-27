/*
 * System diagnostics and runtime environment specifications.
 */

import { api, SystemStatus } from '../api';
import { icon } from '../components/Icons';

export async function renderSystem(container: HTMLElement) {
  container.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 class="text-xl font-semibold text-primary">System Information</h1>
        <p class="text-xs text-secondary mt-0.5">Runtime architecture and process diagnostics.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Runtime Details -->
        <div class="bg-surface border border-surfaceBorder rounded-lg p-5 space-y-4">
          <div class="flex items-center space-x-2 text-primary font-semibold text-sm">
            ${icon('server', 'w-4 h-4 text-accent-orange')}
            <span>Runtime Specifications</span>
          </div>

          <div class="space-y-2.5 text-xs font-mono">
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Binary Version</span>
              <span class="text-primary font-bold">Axiom v4.0.0</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Async Runtime</span>
              <span class="text-primary">Tokio Multi-Threaded</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Memory Allocator</span>
              <span class="text-primary">mimalloc (secure zero-on-free)</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Metadata Engine</span>
              <span class="text-primary">libsql (local axiom.db / remote Turso)</span>
            </div>
            <div class="flex justify-between py-1.5">
              <span class="text-secondary">Protocol Handlers</span>
              <span class="text-primary">HTTP/1.1 JSON + MCP v1 + Prometheus</span>
            </div>
          </div>
        </div>

        <!-- Live Diagnostics -->
        <div class="bg-surface border border-surfaceBorder rounded-lg p-5 space-y-4">
          <div class="flex items-center space-x-2 text-primary font-semibold text-sm">
            ${icon('activity', 'w-4 h-4 text-emerald-400')}
            <span>Live Process Diagnostics</span>
          </div>

          <div class="space-y-2.5 text-xs font-mono">
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Process Uptime</span>
              <span id="sys-uptime" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Resident Set Size (RSS)</span>
              <span id="sys-mem" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Process CPU Load</span>
              <span id="sys-cpu" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Active DB Pools</span>
              <span id="sys-pools" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5">
              <span class="text-secondary">Active Client Keys</span>
              <span id="sys-keys" class="text-primary font-semibold">—</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  async function loadSystemStats() {
    try {
      const status = await api.getStatus();
      const uptimeMins = Math.floor(status.uptime_seconds / 60);
      const uptimeStr = uptimeMins < 60 ? `${uptimeMins} minutes` : `${Math.floor(uptimeMins / 60)} hours, ${uptimeMins % 60} minutes`;

      (document.getElementById('sys-uptime') as HTMLElement).textContent = uptimeStr;
      (document.getElementById('sys-mem') as HTMLElement).textContent = `${status.memory_mb} MB`;
      (document.getElementById('sys-cpu') as HTMLElement).textContent = `${status.cpu_percent.toFixed(1)}%`;
      (document.getElementById('sys-pools') as HTMLElement).textContent = `${status.active_databases} connected`;
      (document.getElementById('sys-keys') as HTMLElement).textContent = `${status.registered_keys} keys registered`;
    } catch {}
  }

  loadSystemStats();
}
