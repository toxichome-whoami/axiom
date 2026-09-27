/*
 * Prometheus metrics visualizer and raw text exposition inspector.
 * Ported from binary_alive CloudflareAnalytics & TelemetryCard architecture.
 */

import { api } from '../api';
import { icon } from '../components/Icons';
import { toast } from '../components/Toast';

interface ParsedMetric {
  name: string;
  labels: Record<string, string>;
  value: number;
}

function parsePrometheusText(text: string): ParsedMetric[] {
  const lines = text.split('\n');
  const metrics: ParsedMetric[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([0-9.eE+-]+)/);
    if (!match) continue;

    const name = match[1];
    const rawLabels = match[2] || '';
    const value = parseFloat(match[3]);

    const labels: Record<string, string> = {};
    if (rawLabels) {
      const labelParts = rawLabels.split(',');
      for (const part of labelParts) {
        const [k, v] = part.split('=');
        if (k && v) {
          labels[k.trim()] = v.trim().replace(/^"|"$/g, '');
        }
      }
    }

    metrics.push({ name, labels, value });
  }

  return metrics;
}

export async function renderMetrics(container: HTMLElement) {
  let isRawVisible = false;

  container.innerHTML = `
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-white tracking-tight">Gateway Metrics</h1>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Runtime telemetry exported at <code class="text-[#f38020] font-mono">/metrics</code>.</p>
        </div>
        <div class="flex items-center gap-2">
          <button 
            id="toggle-raw-btn" 
            type="button"
            class="h-8 px-3 bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] rounded-lg text-xs font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            Toggle Raw
          </button>
          <button 
            id="copy-raw-metrics" 
            type="button"
            class="flex items-center gap-1.5 h-8 px-3 bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] rounded-lg text-xs font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            ${icon('copy', 'w-3.5 h-3.5 text-[#8c8c8c]')}
            <span>Copy Text</span>
          </button>
          <button 
            id="refresh-metrics-btn" 
            type="button"
            class="size-8 rounded-lg bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] text-[#8c8c8c] hover:text-white transition-colors flex items-center justify-center cursor-pointer" 
            title="Refresh metrics"
          >
            ${icon('refresh', 'w-3.5 h-3.5')}
          </button>
        </div>
      </div>

      <!-- Telemetry Cards Grid matching binary_alive TelemetryCard -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">HTTP Requests (Total)</span>
            <span class="text-xs font-medium text-[#3b82f6] flex items-center gap-0.5">
              <span>Traffic</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="metric-http-total" class="text-[26px] font-semibold text-white tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">inbound</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 18 Q 30 10, 60 14 T 100 4" fill="none" stroke="#3b82f6" stroke-width="2" />
            </svg>
          </div>
        </div>

        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">Database Queries</span>
            <span class="text-xs font-medium text-[#f38020] flex items-center gap-0.5">
              <span>Upstream</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="metric-db-total" class="text-[26px] font-semibold text-[#f38020] tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">executed</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 16 Q 40 8, 70 14 T 100 6" fill="none" stroke="#f38020" stroke-width="2" />
            </svg>
          </div>
        </div>

        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">Active Sockets</span>
            <span class="text-xs font-medium text-emerald-400 flex items-center gap-0.5">
              <span>Pool</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="metric-conns-total" class="text-[26px] font-semibold text-emerald-400 tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">connections</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 20 Q 30 14, 60 16 T 100 4" fill="none" stroke="#10b981" stroke-width="2" />
            </svg>
          </div>
        </div>

        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">Rate Limit Rejections</span>
            <span class="text-xs font-medium text-rose-400 flex items-center gap-0.5">
              <span>Drops</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="metric-rl-total" class="text-[26px] font-semibold text-rose-400 tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">blocked</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 12 Q 30 18, 60 15 T 100 22" fill="none" stroke="#ef4444" stroke-width="2" />
            </svg>
          </div>
        </div>
      </div>

      <!-- Breakdown Panels -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Inbound HTTP Breakdown -->
        <div class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-5 space-y-4">
          <div class="flex items-center gap-2">
            <span class="p-1.5 rounded-md bg-[#3b82f6]/10 text-[#3b82f6]">
              ${icon('activity', 'w-4 h-4')}
            </span>
            <h2 class="text-sm font-semibold text-white">Inbound HTTP Operations</h2>
          </div>
          <div id="http-breakdown-list" class="space-y-2 text-xs font-mono">
            <div class="text-[#666666] py-6 text-center font-sans">Parsing telemetry...</div>
          </div>
        </div>

        <!-- Database Breakdown -->
        <div class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-5 space-y-4">
          <div class="flex items-center gap-2">
            <span class="p-1.5 rounded-md bg-[#f38020]/10 text-[#f38020]">
              ${icon('database', 'w-4 h-4')}
            </span>
            <h2 class="text-sm font-semibold text-white">Database Query Distribution</h2>
          </div>
          <div id="db-breakdown-list" class="space-y-2 text-xs font-mono">
            <div class="text-[#666666] py-6 text-center font-sans">Parsing telemetry...</div>
          </div>
        </div>
      </div>

      <!-- Raw Exposition Block -->
      <div id="raw-metrics-section" class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-4 space-y-3 hidden shadow-2xl">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-white">Raw Prometheus Exposition</span>
          <span class="text-[11px] text-[#8c8c8c] font-mono">text/plain; version=0.0.4</span>
        </div>
        <div class="bg-[#000000] border border-[#222222] rounded-lg p-4 overflow-x-auto max-h-[480px] overflow-y-auto">
          <pre id="raw-metrics-display" class="font-mono text-xs text-[#cccccc] leading-relaxed whitespace-pre">Loading metrics...</pre>
        </div>
      </div>
    </div>
  `;

  let latestRaw = '';

  async function loadMetrics() {
    try {
      latestRaw = await api.getRawMetrics();
      const display = document.getElementById('raw-metrics-display') as HTMLElement;
      if (display) display.textContent = latestRaw;

      const parsed = parsePrometheusText(latestRaw);

      const httpTotal = parsed
        .filter((m) => m.name.includes('http_requests_total'))
        .reduce((sum, m) => sum + m.value, 0);
      (document.getElementById('metric-http-total') as HTMLElement).textContent = String(httpTotal);

      const dbTotal = parsed
        .filter((m) => m.name.includes('db_queries_total'))
        .reduce((sum, m) => sum + m.value, 0);
      (document.getElementById('metric-db-total') as HTMLElement).textContent = String(dbTotal);

      const conns = parsed
        .filter((m) => m.name.includes('pool_connections_active'))
        .reduce((sum, m) => sum + m.value, 0);
      (document.getElementById('metric-conns-total') as HTMLElement).textContent = String(conns);

      const rlDrops = parsed
        .filter((m) => m.name.includes('rate_limit_rejections_total') || m.name.includes('rate_limit_rejected'))
        .reduce((sum, m) => sum + m.value, 0);
      (document.getElementById('metric-rl-total') as HTMLElement).textContent = String(rlDrops);

      const httpEntries = parsed.filter((m) => m.name.includes('http_requests_total'));
      const httpContainer = document.getElementById('http-breakdown-list') as HTMLElement;
      if (httpEntries.length > 0) {
        httpContainer.innerHTML = httpEntries
          .map(
            (m) => `
          <div class="flex items-center justify-between p-2.5 rounded-lg bg-[#141414] border border-[#262626] text-xs">
            <div class="flex items-center gap-2">
              <span class="px-1.5 py-0.5 rounded bg-[#1a1a1a] text-white font-medium uppercase font-mono">${m.labels.method || 'GET'}</span>
              <span class="text-[#f3f4f6] truncate max-w-xs font-mono">${m.labels.path || '/'}</span>
              ${m.labels.status ? `<span class="text-[#8c8c8c]">(${m.labels.status})</span>` : ''}
            </div>
            <span class="text-emerald-400 font-medium tabular-nums">${m.value} calls</span>
          </div>
        `
          )
          .join('');
      } else {
        httpContainer.innerHTML = `<div class="text-[#666666] py-6 text-center font-sans">No HTTP requests recorded since startup.</div>`;
      }

      const dbEntries = parsed.filter((m) => m.name.includes('db_queries_total'));
      const dbContainer = document.getElementById('db-breakdown-list') as HTMLElement;
      if (dbEntries.length > 0) {
        dbContainer.innerHTML = dbEntries
          .map(
            (m) => `
          <div class="flex items-center justify-between p-2.5 rounded-lg bg-[#141414] border border-[#262626] text-xs">
            <div class="flex items-center gap-2">
              <span class="px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[#3b82f6] border border-[#262626] font-mono font-medium uppercase">
                ${m.labels.alias || 'main'}
              </span>
              <span class="text-white font-mono">${m.labels.operation || 'QUERY'}</span>
            </div>
            <span class="text-[#f38020] font-medium tabular-nums">${m.value} queries</span>
          </div>
        `
          )
          .join('');
      } else {
        dbContainer.innerHTML = `<div class="text-[#666666] py-6 text-center font-sans">No database queries recorded since startup.</div>`;
      }
    } catch {
      const display = document.getElementById('raw-metrics-display') as HTMLElement;
      if (display) display.textContent = 'Failed to scrape /metrics endpoint.';
    }
  }

  document.getElementById('refresh-metrics-btn')?.addEventListener('click', async () => {
    await loadMetrics();
    toast.info('Metrics refreshed');
  });

  document.getElementById('toggle-raw-btn')?.addEventListener('click', () => {
    isRawVisible = !isRawVisible;
    const rawSec = document.getElementById('raw-metrics-section');
    if (rawSec) {
      if (isRawVisible) {
        rawSec.classList.remove('hidden');
      } else {
        rawSec.classList.add('hidden');
      }
    }
  });

  document.getElementById('copy-raw-metrics')?.addEventListener('click', async () => {
    if (latestRaw) {
      await navigator.clipboard.writeText(latestRaw);
      toast.success('Prometheus exposition copied to clipboard');
    }
  });

  loadMetrics();
}
