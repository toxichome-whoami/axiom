/*
 * Live-tail structured logs viewer with filters and auto-scroll controls.
 * Adheres to Section 15 of AXIOM_MASTER_PLAN.md.
 */

import { api, AuditRecord } from '../api';
import { icon } from '../components/Icons';

export async function renderLogs(container: HTMLElement) {
  let isTailing = true;
  let pollTimer: any = null;
  let levelFilter = 'ALL';
  let searchTerm = '';
  let logs: Array<{
    id: number;
    timestamp: number;
    level: string;
    target: string;
    message: string;
    details?: string;
  }> = [];

  container.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold text-primary">Structured Logs</h1>
          <p class="text-xs text-secondary mt-0.5">Live-tail execution events, control plane mutations, and security telemetry.</p>
        </div>
        <div class="flex items-center space-x-2">
          <!-- Level Filter -->
          <select id="log-level-filter" class="px-2.5 py-1.5 bg-surface border border-surfaceBorder rounded-md text-xs text-primary focus:outline-none focus:border-focusRing">
            <option value="ALL">All Levels</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>

          <!-- Search Input -->
          <input 
            id="log-search-input" 
            type="text" 
            placeholder="Search log messages..." 
            class="px-3 py-1.5 bg-surface border border-surfaceBorder rounded-md text-xs text-primary focus:outline-none focus:border-focusRing w-48 sm:w-64"
          />

          <!-- Pause / Resume Button -->
          <button id="toggle-tail-btn" class="px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs font-medium text-primary transition-colors flex items-center space-x-1.5">
            <span id="tail-status-indicator" class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span id="tail-btn-text">Live Tail</span>
          </button>

          <!-- Clear Console -->
          <button id="clear-logs-btn" class="p-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-secondary hover:text-primary transition-colors" title="Clear console">
            ${icon('trash', 'w-4 h-4')}
          </button>
        </div>
      </div>

      <!-- Log Terminal Display -->
      <div class="bg-[#121212] border border-surfaceBorder rounded-lg overflow-hidden shadow-inner flex flex-col font-mono text-xs">
        <div class="bg-surface px-4 py-2 border-b border-surfaceBorder flex items-center justify-between text-[11px] text-secondary">
          <div class="flex items-center space-x-2">
            <span class="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block"></span>
            <span class="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block"></span>
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block"></span>
            <span class="ml-2 font-semibold text-primary">axiom-gateway.log</span>
          </div>
          <span id="log-count-indicator">0 events</span>
        </div>

        <div id="log-console-body" class="p-4 space-y-1.5 overflow-y-auto max-h-[640px] min-h-[380px] divide-y divide-white/5">
          <div class="text-secondary py-8 text-center">Connecting to event stream...</div>
        </div>
      </div>
    </div>
  `;

  function renderLogEntries() {
    const consoleBody = document.getElementById('log-console-body');
    if (!consoleBody) return;

    const filtered = logs.filter((l) => {
      const matchesLevel = levelFilter === 'ALL' || l.level === levelFilter;
      const matchesSearch = !searchTerm || 
        l.message.toLowerCase().includes(searchTerm) || 
        l.target.toLowerCase().includes(searchTerm) ||
        (l.details && l.details.toLowerCase().includes(searchTerm));
      return matchesLevel && matchesSearch;
    });

    const countIndicator = document.getElementById('log-count-indicator');
    if (countIndicator) {
      countIndicator.textContent = `${filtered.length} events logged`;
    }

    if (filtered.length === 0) {
      consoleBody.innerHTML = `<div class="text-secondary py-8 text-center">No log events matching active filter.</div>`;
      return;
    }

    consoleBody.innerHTML = filtered.map((l) => {
      let badgeClass = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      if (l.level === 'WARN') {
        badgeClass = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      } else if (l.level === 'ERROR') {
        badgeClass = 'text-rose-400 bg-rose-500/10 border-rose-500/20';
      }

      const timeStr = new Date(l.timestamp * 1000).toISOString().replace('T', ' ').substring(0, 19);

      return `
        <div class="pt-1.5 flex items-start space-x-3 text-[11px] leading-relaxed hover:bg-white/[0.02] px-1 rounded">
          <span class="text-secondary/70 shrink-0 select-none">${timeStr}</span>
          <span class="px-1.5 py-0.2 rounded text-[10px] uppercase font-bold border shrink-0 ${badgeClass}">${l.level}</span>
          <span class="text-accent-blue font-semibold shrink-0">[${l.target}]</span>
          <span class="text-primary flex-1 break-all">${l.message}</span>
          ${l.details ? `<span class="text-secondary/80 text-[10px] shrink-0 truncate max-w-xs">{${l.details}}</span>` : ''}
        </div>
      `;
    }).join('');

    if (isTailing) {
      consoleBody.scrollTop = consoleBody.scrollHeight;
    }
  }

  async function fetchLatestLogs() {
    try {
      const records: AuditRecord[] = await api.getAuditLog(100, 0);
      logs = records.map((r) => {
        let level = 'INFO';
        if (r.action.includes('delete') || r.action.includes('fail')) {
          level = 'WARN';
        } else if (r.action.includes('ban') || r.action.includes('error')) {
          level = 'ERROR';
        }

        return {
          id: r.id,
          timestamp: r.timestamp,
          level,
          target: r.target,
          message: `${r.actor} performed ${r.action}`,
          details: r.details,
        };
      });

      renderLogEntries();
    } catch {
      // Background poll silently retries
    }
  }

  // Bind controls
  document.getElementById('log-level-filter')?.addEventListener('change', (e) => {
    levelFilter = (e.target as HTMLSelectElement).value;
    renderLogEntries();
  });

  document.getElementById('log-search-input')?.addEventListener('input', (e) => {
    searchTerm = (e.target as HTMLInputElement).value.trim().toLowerCase();
    renderLogEntries();
  });

  const toggleBtn = document.getElementById('toggle-tail-btn');
  const indicator = document.getElementById('tail-status-indicator');
  const btnText = document.getElementById('tail-btn-text');

  toggleBtn?.addEventListener('click', () => {
    isTailing = !isTailing;
    if (isTailing) {
      indicator?.classList.remove('bg-amber-500');
      indicator?.classList.add('bg-emerald-500', 'animate-pulse');
      if (btnText) btnText.textContent = 'Live Tail';
      fetchLatestLogs();
      pollTimer = setInterval(fetchLatestLogs, 2500);
    } else {
      indicator?.classList.remove('bg-emerald-500', 'animate-pulse');
      indicator?.classList.add('bg-amber-500');
      if (btnText) btnText.textContent = 'Paused';
      if (pollTimer) clearInterval(pollTimer);
    }
  });

  document.getElementById('clear-logs-btn')?.addEventListener('click', () => {
    logs = [];
    renderLogEntries();
  });

  // Initial fetch and start live polling
  await fetchLatestLogs();
  pollTimer = setInterval(fetchLatestLogs, 2500);

  // Clear timer when leaving route
  const handleNav = () => {
    if (pollTimer) clearInterval(pollTimer);
    window.removeEventListener('hashchange', handleNav);
  };
  window.addEventListener('hashchange', handleNav);
}
