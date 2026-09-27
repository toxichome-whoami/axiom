/*
 * Prometheus metrics exposition visualizer and raw text inspector.
 */

import { api } from '../api';
import { icon } from '../components/Icons';

export async function renderMetrics(container: HTMLElement) {
  container.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Prometheus Metrics</h1>
          <p class="text-xs text-secondary mt-0.5">Exposition format scraped at <code class="text-accent-orange font-mono">/metrics</code>.</p>
        </div>
        <div class="flex items-center space-x-2">
          <button id="copy-raw-metrics" class="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
            ${icon('copy', 'w-3.5 h-3.5')}
            <span>Copy Exposition</span>
          </button>
          <button id="refresh-metrics-btn" class="p-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-secondary hover:text-primary transition-colors">
            ${icon('refresh', 'w-4 h-4')}
          </button>
        </div>
      </div>

      <!-- Raw Exposition Block -->
      <div class="bg-surface border border-surfaceBorder rounded-lg p-4 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-primary">Live Scraping Endpoint Feed</span>
          <span class="text-[11px] text-secondary font-mono">text/plain; version=0.0.4</span>
        </div>
        <div class="bg-background border border-surfaceBorder rounded-md p-4 overflow-x-auto max-h-[600px] overflow-y-auto">
          <pre id="raw-metrics-display" class="font-mono text-xs text-secondary leading-relaxed whitespace-pre">Loading metrics...</pre>
        </div>
      </div>
    </div>
  `;

  async function loadMetrics() {
    try {
      const raw = await api.getRawMetrics();
      const display = document.getElementById('raw-metrics-display') as HTMLElement;
      display.textContent = raw;
    } catch {
      const display = document.getElementById('raw-metrics-display') as HTMLElement;
      display.textContent = 'Failed to load /metrics endpoint.';
    }
  }

  document.getElementById('refresh-metrics-btn')?.addEventListener('click', loadMetrics);
  document.getElementById('copy-raw-metrics')?.addEventListener('click', () => {
    const text = (document.getElementById('raw-metrics-display') as HTMLElement).textContent || '';
    navigator.clipboard.writeText(text);
    alert('Prometheus exposition copied to clipboard!');
  });

  loadMetrics();
}
