/*
 * Live-tail structured logs viewer with search filters and auto-scroll controls.
 * Ported from binary_alive Terminal & Logs architecture.
 */

import { api, AuditRecord } from '../api';
import { icon } from '../components/Icons';
import { toast } from '../components/Toast';

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
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-xl font-semibold text-white tracking-tight">Structured Logs</h1>
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#141414] border border-[#262626] text-[#8c8c8c]">Stdout/JSON</span>
          </div>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Live-tail execution events, control plane mutations, and security telemetry.</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- Level Filter -->
          <select 
            id="log-level-filter" 
            class="h-8 px-2.5 rounded-lg bg-[#0c0c0c] border border-[#262626] text-xs text-white focus:border-[#3b82f6] outline-none transition-colors"
          >
            <option value="ALL">All Levels</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>

          <!-- Search Input -->
          <div class="relative w-44 sm:w-56">
            <span class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#8c8c8c]">
              ${icon('search', 'w-3.5 h-3.5 opacity-60')}
            </span>
            <input 
              id="log-search-input" 
              type="text" 
              placeholder="Search events..." 
              class="w-full h-8 pl-8 pr-3 rounded-lg bg-[#0c0c0c] border border-[#262626] text-xs text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
            />
          </div>

          <!-- Pause / Resume Button -->
          <button 
            id="toggle-tail-btn" 
            type="button"
            class="h-8 px-3 rounded-lg bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] text-xs font-medium text-white transition-colors flex items-center gap-2 cursor-pointer"
          >
            <span id="tail-status-indicator" class="size-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span id="tail-btn-text">Live Tail</span>
          </button>

          <!-- Clear Console -->
          <button 
            id="clear-logs-btn" 
            type="button"
            class="size-8 rounded-lg bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] text-[#8c8c8c] hover:text-white transition-colors flex items-center justify-center cursor-pointer" 
            title="Clear buffer"
          >
            ${icon('trash', 'w-3.5 h-3.5')}
          </button>
        </div>
      </div>

      <!-- Log Terminal Display Container matching binary_alive Terminal -->
      <div class="border border-[#262626] rounded-lg overflow-hidden bg-[#000000] flex flex-col font-mono text-xs shadow-2xl">
        <div class="bg-[#141414] px-4 h-[40px] border-b border-[#222222] flex items-center justify-between text-[11px] text-[#8c8c8c]">
          <div class="flex items-center gap-2">
            <span class="size-2 rounded-full bg-emerald-400"></span>
            <span class="font-medium text-white">axiom-event-stream</span>
          </div>
          <span id="log-count-indicator" class="tabular-nums">0 events</span>
        </div>

        <div id="log-console-body" class="p-4 space-y-1 overflow-y-auto max-h-[640px] min-h-[400px] select-text">
          <div class="text-[#666666] py-12 text-center font-sans">Connecting to live event stream...</div>
        </div>
      </div>
    </div>
  `;

  function renderLogEntries() {
    const consoleBody = document.getElementById('log-console-body');
    if (!consoleBody) return;

    const filtered = logs.filter((l) => {
      const matchesLevel = levelFilter === 'ALL' || l.level === levelFilter;
      const matchesSearch =
        !searchTerm ||
        l.message.toLowerCase().includes(searchTerm) ||
        l.target.toLowerCase().includes(searchTerm) ||
        (l.details && l.details.toLowerCase().includes(searchTerm));
      return matchesLevel && matchesSearch;
    });

    const countIndicator = document.getElementById('log-count-indicator');
    if (countIndicator) {
      countIndicator.textContent = `${filtered.length} event${filtered.length === 1 ? '' : 's'}`;
    }

    if (filtered.length === 0) {
      consoleBody.innerHTML = `<div class="text-[#666666] py-12 text-center font-sans">No log events matching active filter.</div>`;
      return;
    }

    consoleBody.innerHTML = filtered
      .map((l) => {
        let badgeColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
        if (l.level === 'WARN') {
          badgeColor = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
        } else if (l.level === 'ERROR') {
          badgeColor = 'text-rose-400 bg-rose-500/10 border-rose-500/20';
        }

        const timeStr = new Date(l.timestamp * 1000).toISOString().replace('T', ' ').substring(11, 19);

        return `
        <div class="py-0.5 flex items-start gap-2.5 text-[12px] leading-relaxed hover:bg-[#111111] px-1.5 rounded transition-colors font-mono">
          <span class="text-[#666666] shrink-0 select-none tabular-nums">${timeStr}</span>
          <span class="px-1.5 py-0.2 rounded text-[10px] uppercase font-bold border shrink-0 ${badgeColor}">${l.level}</span>
          <span class="text-[#3b82f6] font-medium shrink-0">[${l.target}]</span>
          <span class="text-[#f3f4f6] flex-1 break-all">${l.message}</span>
          ${l.details ? `<span class="text-[#8c8c8c] text-[11px] shrink-0 truncate max-w-xs">{${l.details}}</span>` : ''}
        </div>
      `;
      })
      .join('');

    if (isTailing) {
      consoleBody.scrollTop = consoleBody.scrollHeight;
    }
  }

  async function fetchLatestLogs() {
    try {
      const records: AuditRecord[] = await api.getAuditLog(100, 0);
      logs = records.map((r) => {
        let level = 'INFO';
        if (r.action.includes('delete') || r.action.includes('fail') || r.action.includes('rotate')) {
          level = 'WARN';
        } else if (r.action.includes('ban') || r.action.includes('error')) {
          level = 'ERROR';
        }

        return {
          id: r.id,
          timestamp: r.timestamp,
          level,
          target: r.target,
          message: `${r.actor} executed ${r.action}`,
          details: r.details,
        };
      });

      renderLogEntries();
    } catch {}
  }

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
      indicator?.classList.remove('bg-amber-400');
      indicator?.classList.add('bg-emerald-400', 'animate-pulse');
      if (btnText) btnText.textContent = 'Live Tail';
      fetchLatestLogs();
      pollTimer = setInterval(fetchLatestLogs, 2500);
      toast.info('Log live-tail resumed');
    } else {
      indicator?.classList.remove('bg-emerald-400', 'animate-pulse');
      indicator?.classList.add('bg-amber-400');
      if (btnText) btnText.textContent = 'Paused';
      if (pollTimer) clearInterval(pollTimer);
      toast.info('Log live-tail paused');
    }
  });

  document.getElementById('clear-logs-btn')?.addEventListener('click', () => {
    logs = [];
    renderLogEntries();
    toast.info('Log buffer cleared');
  });

  await fetchLatestLogs();
  pollTimer = setInterval(fetchLatestLogs, 2500);

  const cleanup = () => {
    if (pollTimer) clearInterval(pollTimer);
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);
}
