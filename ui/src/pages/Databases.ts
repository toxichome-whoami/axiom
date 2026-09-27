/*
 * Managed SQL database connection registry interface.
 * Ported from binary_alive DataTable & Dialog architecture.
 * Supports searching, live ping health-testing, and managing database pools.
 */

import { api, DatabaseRecord } from '../api';
import { icon } from '../components/Icons';
import { toast, confirmDialog } from '../components/Toast';

export async function renderDatabases(container: HTMLElement) {
  let allDatabases: DatabaseRecord[] = [];
  let filterQuery = '';

  container.innerHTML = `
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Page Header & Action Controls -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-xl font-semibold text-white tracking-tight">Databases</h1>
            <span id="db-count-badge" class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#141414] border border-[#262626] text-[#8c8c8c]">0 pools</span>
          </div>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Manage live connection pools, upstream dialects, and health probes.</p>
        </div>

        <div class="flex items-center gap-2.5">
          <!-- Search input -->
          <div class="relative w-48 sm:w-64">
            <span class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#8c8c8c]">
              ${icon('search', 'w-3.5 h-3.5 opacity-60')}
            </span>
            <input
              id="db-search-input"
              type="text"
              placeholder="Filter databases..."
              class="w-full h-8 pl-8 pr-3 rounded-lg bg-[#0c0c0c] border border-[#262626] text-xs text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
            />
          </div>

          <button 
            id="open-add-db-modal" 
            type="button"
            class="flex items-center gap-1.5 px-3 h-8 bg-[#f38020] hover:bg-[#e07018] text-white rounded-lg text-xs font-medium transition-colors shadow-xs cursor-pointer shrink-0"
          >
            ${icon('plus', 'w-3.5 h-3.5')}
            <span>Connect Database</span>
          </button>
        </div>
      </div>

      <!-- Databases Table Container in Cloudflare DataTable Pattern -->
      <div class="border border-[#262626] rounded-lg overflow-hidden bg-[#0e0e0e] flex flex-col text-[14px]">
        <div class="overflow-x-auto w-full">
          <table class="w-full text-left border-collapse min-w-[700px]">
            <thead class="sticky top-0 z-10">
              <tr class="border-b border-[#222222] bg-[#141414] h-[40px] text-[13px] font-medium text-white">
                <th class="px-4">Database Alias</th>
                <th class="px-4">Engine Dialect</th>
                <th class="px-4">Pool Bounds</th>
                <th class="px-4">Registered Date</th>
                <th class="px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="db-table-body" class="divide-y divide-[#1e1e1e] text-[13px] text-[#cccccc]">
              <tr>
                <td colspan="5" class="px-4 py-12 text-center text-xs text-[#666666]">
                  <div class="h-4 w-1/3 mx-auto rounded bg-[#1a1a1a] animate-pulse"></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Table Footer -->
        <div class="flex items-center justify-between px-4 py-2.5 border-t border-[#222222] bg-[#0e0e0e] text-[12px] text-[#8c8c8c]">
          <span id="db-footer-status">Showing databases</span>
          <span class="font-mono text-[11px] text-[#666666]">DashMap Pool Registry</span>
        </div>
      </div>
    </div>

    <!-- Connect Database Modal matching Dialog.tsx in binary_alive -->
    <div id="add-db-modal" class="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden select-none animate-in fade-in">
      <div class="bg-[#0e0e0e] border border-[#262626] rounded-lg max-w-md w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between pb-3 border-b border-[#222222]">
          <div class="flex items-center gap-2">
            <span class="p-1.5 rounded-md bg-[#3b82f6]/10 text-[#3b82f6]">
              ${icon('database', 'w-4 h-4')}
            </span>
            <h2 class="text-sm font-semibold text-white">Connect Upstream Database</h2>
          </div>
          <button id="close-add-db-modal" class="text-[#8c8c8c] hover:text-white p-1 cursor-pointer">
            ${icon('x', 'w-4 h-4')}
          </button>
        </div>

        <div id="modal-error" class="hidden p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

        <form id="add-db-form" class="space-y-4 text-xs">
          <div>
            <label for="new-db-alias" class="block text-[#8c8c8c] mb-1 font-medium">Database Alias</label>
            <input 
              id="new-db-alias" 
              type="text" 
              required 
              placeholder="e.g. analytics_db" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none font-mono text-xs transition-colors" 
            />
          </div>

          <div>
            <label for="new-db-engine" class="block text-[#8c8c8c] mb-1 font-medium">Engine Dialect</label>
            <select 
              id="new-db-engine" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white focus:border-[#3b82f6] outline-none text-xs transition-colors"
            >
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL / MariaDB</option>
              <option value="sqlite">SQLite / LibSQL</option>
              <option value="mssql">Microsoft SQL Server</option>
              <option value="clickhouse">ClickHouse</option>
            </select>
          </div>

          <div>
            <label for="new-db-url" class="block text-[#8c8c8c] mb-1 font-medium">Connection URL</label>
            <input 
              id="new-db-url" 
              type="text" 
              required 
              placeholder="postgres://user:pass@localhost:5432/dbname" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] font-mono text-xs focus:border-[#3b82f6] outline-none transition-colors" 
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="new-db-min" class="block text-[#8c8c8c] mb-1 font-medium">Min Connections</label>
              <input 
                id="new-db-min" 
                type="number" 
                value="1" 
                min="1" 
                class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white font-mono text-xs focus:border-[#3b82f6] outline-none transition-colors" 
              />
            </div>
            <div>
              <label for="new-db-max" class="block text-[#8c8c8c] mb-1 font-medium">Max Connections</label>
              <input 
                id="new-db-max" 
                type="number" 
                value="10" 
                min="1" 
                class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white font-mono text-xs focus:border-[#3b82f6] outline-none transition-colors" 
              />
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-3 border-t border-[#222222]">
            <button type="button" id="cancel-add-db" class="h-8 px-3 rounded-lg bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-[#cccccc] hover:text-white font-medium transition-colors cursor-pointer">
              Cancel
            </button>
            <button type="submit" id="submit-add-db" class="h-8 px-3.5 rounded-lg bg-[#f38020] hover:bg-[#e07018] text-white font-medium transition-colors shadow-xs cursor-pointer">
              Connect Pool
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  const modal = document.getElementById('add-db-modal') as HTMLElement;
  const modalError = document.getElementById('modal-error') as HTMLElement;

  function renderTableRows(dbs: DatabaseRecord[]) {
    const tbody = document.getElementById('db-table-body') as HTMLElement;
    const countBadge = document.getElementById('db-count-badge') as HTMLElement;
    const footerStatus = document.getElementById('db-footer-status') as HTMLElement;

    if (countBadge) countBadge.textContent = `${allDatabases.length} pool${allDatabases.length === 1 ? '' : 's'}`;

    if (dbs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="px-4 py-12 text-center text-xs text-[#666666]">
            ${
              filterQuery
                ? `No databases match "${filterQuery}".`
                : 'No databases connected yet. Click "Connect Database" to register your first pool.'
            }
          </td>
        </tr>
      `;
      if (footerStatus) footerStatus.textContent = 'Showing 0 databases';
      return;
    }

    if (footerStatus) footerStatus.textContent = `Showing ${dbs.length} of ${allDatabases.length} database pool${allDatabases.length === 1 ? '' : 's'}`;

    tbody.innerHTML = dbs
      .map(
        (db) => `
      <tr class="h-[44px] hover:bg-[#161616] transition-colors">
        <td class="px-4 py-2 font-mono font-medium text-white text-xs">
          <div class="flex items-center gap-2">
            <span class="size-2 rounded-full bg-emerald-400"></span>
            <span>${db.alias}</span>
          </div>
        </td>
        <td class="px-4 py-2">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono uppercase bg-[#141414] border border-[#262626] text-[#3b82f6]">
            ${db.engine}
          </span>
        </td>
        <td class="px-4 py-2 font-mono text-xs text-[#8c8c8c]">
          ${db.pool_min}..${db.pool_max} conns
        </td>
        <td class="px-4 py-2 font-mono text-xs text-[#8c8c8c]">
          ${new Date(db.created_at * 1000).toLocaleDateString()}
        </td>
        <td class="px-4 py-2 text-right">
          <div class="inline-flex items-center gap-1.5 justify-end">
            <button 
              data-test-alias="${db.alias}" 
              class="h-7 px-2.5 rounded bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] text-xs font-medium text-[#cccccc] hover:text-white transition-colors flex items-center gap-1 cursor-pointer" 
              title="Test database pool connectivity"
            >
              ${icon('activity', 'w-3 h-3 text-[#3b82f6]')}
              <span>Ping</span>
            </button>
            <button 
              data-delete-alias="${db.alias}" 
              class="size-7 rounded bg-[#141414] hover:bg-rose-500/20 border border-[#262626] hover:border-rose-500/30 text-[#8c8c8c] hover:text-rose-400 transition-colors flex items-center justify-center cursor-pointer" 
              title="Disconnect database pool"
            >
              ${icon('trash', 'w-3.5 h-3.5')}
            </button>
          </div>
        </td>
      </tr>
    `
      )
      .join('');

    // Bind Test Connection buttons
    tbody.querySelectorAll('[data-test-alias]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const alias = (e.currentTarget as HTMLElement).getAttribute('data-test-alias');
        if (!alias) return;
        const button = e.currentTarget as HTMLButtonElement;
        button.disabled = true;
        button.innerHTML = `${icon('refresh', 'w-3 h-3 animate-spin')} <span>Pinging...</span>`;

        try {
          const res = await api.testDatabase(alias);
          toast.success(`Pool '${alias}' healthy (dialect: ${res.dialect})`);
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : `Ping failed for '${alias}'`);
        } finally {
          button.disabled = false;
          button.innerHTML = `${icon('activity', 'w-3 h-3 text-[#3b82f6]')} <span>Ping</span>`;
        }
      });
    });

    // Bind Delete buttons
    tbody.querySelectorAll('[data-delete-alias]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const alias = (e.currentTarget as HTMLElement).getAttribute('data-delete-alias');
        if (!alias) return;

        confirmDialog({
          title: 'Disconnect Database',
          message: `Are you sure you want to disconnect database '${alias}'? In-flight queries will be closed.`,
          confirmText: 'Disconnect',
          danger: true,
          onConfirm: async () => {
            try {
              await api.deleteDatabase(alias);
              toast.success(`Database '${alias}' disconnected`);
              loadDatabases();
            } catch (err: unknown) {
              toast.error(err instanceof Error ? err.message : 'Failed to disconnect database');
            }
          },
        });
      });
    });
  }

  async function loadDatabases() {
    try {
      allDatabases = await api.getDatabases();
      applyFilter();
    } catch {
      const tbody = document.getElementById('db-table-body') as HTMLElement;
      tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-rose-400 text-xs">Failed to load registered databases.</td></tr>`;
    }
  }

  function applyFilter() {
    const q = filterQuery.trim().toLowerCase();
    const filtered = q
      ? allDatabases.filter((d) => d.alias.toLowerCase().includes(q) || d.engine.toLowerCase().includes(q))
      : allDatabases;
    renderTableRows(filtered);
  }

  document.getElementById('db-search-input')?.addEventListener('input', (e) => {
    filterQuery = (e.target as HTMLInputElement).value;
    applyFilter();
  });

  const closeModal = () => modal.classList.add('hidden');
  const openModal = () => {
    modalError.classList.add('hidden');
    modal.classList.remove('hidden');
    (document.getElementById('new-db-alias') as HTMLInputElement)?.focus();
  };

  document.getElementById('open-add-db-modal')?.addEventListener('click', openModal);
  document.getElementById('close-add-db-modal')?.addEventListener('click', closeModal);
  document.getElementById('cancel-add-db')?.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  };
  window.addEventListener('keydown', onKey);

  document.getElementById('add-db-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    modalError.classList.add('hidden');
    const alias = (document.getElementById('new-db-alias') as HTMLInputElement).value.trim();
    const engine = (document.getElementById('new-db-engine') as HTMLSelectElement).value;
    const url = (document.getElementById('new-db-url') as HTMLInputElement).value.trim();
    const pool_min = parseInt((document.getElementById('new-db-min') as HTMLInputElement).value, 10) || 1;
    const pool_max = parseInt((document.getElementById('new-db-max') as HTMLInputElement).value, 10) || 10;

    const submitBtn = document.getElementById('submit-add-db') as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Connecting...';

    try {
      await api.addDatabase({ alias, engine, url, pool_min, pool_max });
      toast.success(`Database '${alias}' connected successfully`);
      closeModal();
      loadDatabases();
    } catch (err: unknown) {
      modalError.textContent = err instanceof Error ? err.message : 'Failed to add database';
      modalError.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Connect Pool';
    }
  });

  loadDatabases();
}
