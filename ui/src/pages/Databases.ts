/*
 * Managed SQL database connection registry interface.
 * Supports adding, inspecting, and deleting database pools at runtime.
 */

import { api, DatabaseRecord } from '../api';
import { icon } from '../components/Icons';

export async function renderDatabases(container: HTMLElement) {
  container.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Databases</h1>
          <p class="text-xs text-secondary mt-0.5">Manage live database connection pools and dialects.</p>
        </div>
        <button id="open-add-db-modal" class="flex items-center space-x-1.5 px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white rounded-md text-xs font-medium transition-colors">
          ${icon('plus', 'w-3.5 h-3.5')}
          <span>Connect Database</span>
        </button>
      </div>

      <!-- Databases Table -->
      <div class="bg-surface border border-surfaceBorder rounded-lg overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs text-secondary">
            <thead class="bg-background text-[11px] font-semibold uppercase tracking-wider text-secondary border-b border-surfaceBorder">
              <tr>
                <th class="py-3 px-4">Alias</th>
                <th class="py-3 px-4">Engine Dialect</th>
                <th class="py-3 px-4">Pool Bounds</th>
                <th class="py-3 px-4">Created</th>
                <th class="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="db-table-body" class="divide-y divide-surfaceBorder font-mono">
              <tr>
                <td colspan="5" class="py-8 text-center text-secondary">Loading registered databases...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Add Database Modal -->
    <div id="add-db-modal" class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-md w-full p-6 space-y-4 shadow-lg">
        <div class="flex items-center justify-between pb-2 border-b border-surfaceBorder">
          <h2 class="text-sm font-semibold text-primary">Connect New Database</h2>
          <button id="close-add-db-modal" class="text-secondary hover:text-primary">
            ${icon('x', 'w-4 h-4')}
          </button>
        </div>

        <div id="modal-error" class="hidden p-2 rounded bg-accent-danger/10 border border-accent-danger/30 text-xs text-red-400"></div>

        <form id="add-db-form" class="space-y-3 text-xs">
          <div>
            <label class="block text-secondary mb-1">Database Alias</label>
            <input id="new-db-alias" type="text" required placeholder="e.g. analytics_db" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" />
          </div>

          <div>
            <label class="block text-secondary mb-1">Engine Dialect</label>
            <select id="new-db-engine" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none">
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL / MariaDB</option>
              <option value="sqlite">SQLite / LibSQL</option>
              <option value="mssql">Microsoft SQL Server</option>
              <option value="clickhouse">ClickHouse</option>
            </select>
          </div>

          <div>
            <label class="block text-secondary mb-1">Connection URL</label>
            <input id="new-db-url" type="text" required placeholder="postgres://user:pass@localhost:5432/dbname" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary font-mono text-xs focus:border-focusRing focus:outline-none" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-secondary mb-1">Min Pool</label>
              <input id="new-db-min" type="number" value="1" min="1" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" />
            </div>
            <div>
              <label class="block text-secondary mb-1">Max Pool</label>
              <input id="new-db-max" type="number" value="10" min="1" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" />
            </div>
          </div>

          <div class="flex justify-end space-x-2 pt-3">
            <button type="button" id="cancel-add-db" class="px-3 py-1.5 bg-surfaceHover hover:bg-surfaceBorder text-secondary rounded-md">Cancel</button>
            <button type="submit" id="submit-add-db" class="px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white font-medium rounded-md">Connect</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const modal = document.getElementById('add-db-modal') as HTMLElement;
  const modalError = document.getElementById('modal-error') as HTMLElement;

  async function loadDatabases() {
    const tbody = document.getElementById('db-table-body') as HTMLElement;
    try {
      const dbs = await api.getDatabases();
      if (dbs.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" class="py-8 text-center text-secondary">
              No databases connected yet. Click "Connect Database" to add one.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = dbs.map((db) => `
        <tr class="hover:bg-surfaceHover/50 transition-colors">
          <td class="py-3 px-4 font-semibold text-primary">${db.alias}</td>
          <td class="py-3 px-4">
            <span class="px-2 py-0.5 rounded text-[11px] font-mono uppercase bg-accent-blue/10 text-accent-blue border border-accent-blue/20">
              ${db.engine}
            </span>
          </td>
          <td class="py-3 px-4 text-secondary">${db.pool_min} / ${db.pool_max} conns</td>
          <td class="py-3 px-4 text-secondary">${new Date(db.created_at * 1000).toLocaleDateString()}</td>
          <td class="py-3 px-4 text-right">
            <button data-delete-alias="${db.alias}" class="p-1 text-secondary hover:text-red-400 rounded hover:bg-surfaceHover transition-colors" title="Delete connection">
              ${icon('trash', 'w-4 h-4')}
            </button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('[data-delete-alias]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const alias = (e.currentTarget as HTMLElement).getAttribute('data-delete-alias');
          if (alias && confirm(`Are you sure you want to disconnect database '${alias}'?`)) {
            try {
              await api.deleteDatabase(alias);
              loadDatabases();
            } catch (err: unknown) {
              alert(err instanceof Error ? err.message : 'Failed to delete');
            }
          }
        });
      });
    } catch {
      tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-red-400">Failed to load databases.</td></tr>`;
    }
  }

  document.getElementById('open-add-db-modal')?.addEventListener('click', () => {
    modalError.classList.add('hidden');
    modal.classList.remove('hidden');
  });

  const closeModal = () => modal.classList.add('hidden');
  document.getElementById('close-add-db-modal')?.addEventListener('click', closeModal);
  document.getElementById('cancel-add-db')?.addEventListener('click', closeModal);

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
      closeModal();
      loadDatabases();
    } catch (err: unknown) {
      modalError.textContent = err instanceof Error ? err.message : 'Failed to add database';
      modalError.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Connect';
    }
  });

  loadDatabases();
}
