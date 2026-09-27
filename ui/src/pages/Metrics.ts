/*
 * Prometheus metrics visualizer and raw text exposition inspector.
 * Parses standard exposition format into visual telemetry cards and provides raw export.
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

    // Pattern: metric_name{label="val",...} 123.45 OR metric_name 123
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
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Prometheus Metrics</h1>
          <p class="text-xs text-secondary mt-0.5">Runtime telemetry exported at <code class="text-accent-orange font-mono">/metrics</code>.</p>
        </div>
        <div class="flex items-center space-x-2">
          <button id="toggle-raw-btn" class="px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
            Toggle Raw Feed
          </button>
          <button id="copy-raw-metrics" class="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
            ${icon('copy', 'w-3.5 h-3.5')}
            <span>Copy Text</span>
          </button>
          <button id="refresh-metrics-btn" class="p-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-secondary hover:text-primary transition-colors" title="Refresh metrics">
            ${icon('refresh', 'w-4 h-4')}
          </button>
        </div>
      </div>

      <!-- Telemetry Visual Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">HTTP Requests (Total)</div>
          <div id="metric-http-total" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Gateway inbound queries</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">Database Queries</div>
          <div id="metric-db-total" class="text-2xl font-semibold text-accent-blue font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Upstream SQL executions</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">Active Pool Conns</div>
          <div id="metric-conns-total" class="text-2xl font-semibold text-emerald-400 font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Live connected sockets</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">Rate Limit Drops</div>
          <div id="metric-rl-total" class="text-2xl font-semibold text-accent-orange font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">429 Too Many Requests</div>
        </div>
      </div>

      <!-- Breakdown Panels -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Endpoint Activity Breakdown -->
        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-4 shadow-xs">
          <div class="flex items-center space-x-2">
            ${icon('activity', 'w-4 h-4 text-accent-orange')}
            <h2 class="text-sm font-semibold text-primary">Inbound HTTP Operations</h2>
          </div>
          <div id="http-breakdown-list" class="space-y-2 text-xs font-mono">
            <div class="text-secondary py-4 text-center">Parsing telemetry...</div>
          </div>
        </div>

        <!-- Database Activity Breakdown -->
        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-4 shadow-xs">
          <div class="flex items-center space-x-2">
            ${icon('database', 'w-4 h-4 text-accent-blue')}
            <h2 class="text-sm font-semibold text-primary">Database Query Distribution</h2>
          </div>
          <div id="db-breakdown-list" class="space-y-2 text-xs font-mono">
            <div class="text-secondary py-4 text-center">Parsing telemetry...</div>
          </div>
        </div>
      </div>

      <!-- Raw Exposition Block (Collapsible) -->
      <div id="raw-metrics-section" class="bg-surface border border-surfaceBorder rounded-lg p-4 space-y-3 hidden shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-primary">Raw Prometheus 0.0.4 Output</span>
          <span class="text-[11px] text-secondary font-mono">text/plain</span>
        </div>
        <div class="bg-background border border-surfaceBorder rounded-md p-4 overflow-x-auto max-h-[480px] overflow-y-auto">
          <pre id="raw-metrics-display" class="font-mono text-[11px] text-secondary leading-relaxed whitespace-pre">Loading metrics...</pre>
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

      // Total HTTP requests
      const httpTotal = parsed
        .filter((m) => m.name.includes('http_requests_total'))
        .reduce((sum, m) => sum + m.value, 0);
      (document.getElementById('metric-http-total') as HTMLElement).textContent = String(httpTotal);

      // Total DB queries
      const dbTotal = parsed
        .filter((m) => m.name.includes('db_queries_total'))
        .reduce((sum, m) => sum + m.value, 0);
      (document.getElementById('metric-db-total') as HTMLElement).textContent = String(dbTotal);

      // Active connections
      const conns = parsed
        .filter((m) => m.name.includes('pool_connections_active'))
        .reduce((sum, m) => sum + m.value, 0);
      (document.getElementById('metric-conns-total') as HTMLElement).textContent = String(conns);

      // Rate limit rejections
      const rlDrops = parsed
        .filter((m) => m.name.includes('rate_limit_rejections_total') || m.name.includes('rate_limit_rejected'))
        .reduce((sum, m) => sum + m.value, 0);
      (document.getElementById('metric-rl-total') as HTMLElement).textContent = String(rlDrops);

      // Render HTTP breakdown
      const httpEntries = parsed.filter((m) => m.name.includes('http_requests_total'));
      const httpContainer = document.getElementById('http-breakdown-list') as HTMLElement;
      if (httpEntries.length > 0) {
        httpContainer.innerHTML = httpEntries.map((m) => `
          <div class="flex items-center justify-between p-2 rounded bg-background border border-surfaceBorder text-[11px]">
            <div class="flex items-center space-x-2">
              <span class="px-1.5 py-0.5 rounded bg-surfaceHover font-semibold uppercase">${m.labels.method || 'GET'}</span>
              <span class="text-primary truncate max-w-xs">${m.labels.path || '/'}</span>
              ${m.labels.status ? `<span class="text-secondary">(${m.labels.status})</span>` : ''}
            </div>
            <span class="text-emerald-400 font-semibold">${m.value} calls</span>
          </div>
        `).join('');
      } else {
        httpContainer.innerHTML = `<div class="text-secondary py-4 text-center">No HTTP requests recorded since startup.</div>`;
      }

      // Render DB breakdown
      const dbEntries = parsed.filter((m) => m.name.includes('db_queries_total'));
      const dbContainer = document.getElementById('db-breakdown-list') as HTMLElement;
      if (dbEntries.length > 0) {
        dbContainer.innerHTML = dbEntries.map((m) => `
          <div class="flex items-center justify-between p-2 rounded bg-background border border-surfaceBorder text-[11px]">
            <div class="flex items-center space-x-2">
              <span class="px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue border border-accent-blue/20 font-semibold uppercase">
                ${m.labels.alias || 'main'}
              </span>
              <span class="text-primary">${m.labels.operation || 'QUERY'}</span>
            </div>
            <span class="text-accent-orange font-semibold">${m.value} queries</span>
          </div>
        `).join('');
      } else {
        dbContainer.innerHTML = `<div class="text-secondary py-4 text-center">No database queries recorded since startup.</div>`;
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
