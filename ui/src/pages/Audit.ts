/*
 * Immutable audit trail viewer for administrative and control plane events.
 */

import { api, AuditRecord } from '../api';
import { icon } from '../components/Icons';

export async function renderAudit(container: HTMLElement) {
  let allRecords: AuditRecord[] = [];
  let filterText = '';
  let currentPage = 0;
  const pageSize = 25;

  container.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold text-primary">Audit Trail</h1>
          <p class="text-xs text-secondary mt-0.5">Immutable record of control plane mutations and security actions.</p>
        </div>
        <div class="flex items-center space-x-2">
          <input 
            id="audit-search" 
            type="text" 
            placeholder="Filter actions or targets..." 
            class="px-3 py-1.5 bg-surface border border-surfaceBorder rounded-md text-xs text-primary focus:outline-none focus:border-focusRing w-56"
          />
          <button id="refresh-audit-btn" class="p-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-secondary hover:text-primary transition-colors">
            ${icon('refresh', 'w-4 h-4')}
          </button>
        </div>
      </div>

      <!-- Audit Table -->
      <div class="bg-surface border border-surfaceBorder rounded-lg overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs text-secondary">
            <thead class="bg-background text-[11px] font-semibold uppercase tracking-wider text-secondary border-b border-surfaceBorder">
              <tr>
                <th class="py-3 px-4">ID</th>
                <th class="py-3 px-4">Timestamp</th>
                <th class="py-3 px-4">Actor</th>
                <th class="py-3 px-4">Action</th>
                <th class="py-3 px-4">Target</th>
                <th class="py-3 px-4">Details</th>
              </tr>
            </thead>
            <tbody id="audit-table-body" class="divide-y divide-surfaceBorder font-mono">
              <tr>
                <td colspan="6" class="py-8 text-center text-secondary">Loading audit events...</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination Controls -->
        <div class="p-3 bg-background border-t border-surfaceBorder flex items-center justify-between text-xs text-secondary">
          <span id="page-indicator">Showing 0 events</span>
          <div class="flex space-x-2">
            <button id="prev-page-btn" disabled class="px-2.5 py-1 bg-surface border border-surfaceBorder rounded disabled:opacity-40">Previous</button>
            <button id="next-page-btn" disabled class="px-2.5 py-1 bg-surface border border-surfaceBorder rounded disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
    </div>
  `;

  function renderTableRows() {
    const tbody = document.getElementById('audit-table-body') as HTMLElement;
    const filtered = allRecords.filter((r) => 
      !filterText || 
      r.action.toLowerCase().includes(filterText) || 
      r.target.toLowerCase().includes(filterText) ||
      r.actor.toLowerCase().includes(filterText)
    );

    const start = currentPage * pageSize;
    const pageSlice = filtered.slice(start, start + pageSize);

    if (pageSlice.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-secondary">No matching audit events found.</td></tr>`;
      (document.getElementById('page-indicator') as HTMLElement).textContent = `Showing 0 of ${filtered.length} events`;
      return;
    }

    tbody.innerHTML = pageSlice.map((r) => `
      <tr class="hover:bg-surfaceHover/50 transition-colors">
        <td class="py-2.5 px-4 text-secondary text-[11px]">#${r.id}</td>
        <td class="py-2.5 px-4 text-secondary text-[11px]">${new Date(r.timestamp * 1000).toLocaleString()}</td>
        <td class="py-2.5 px-4 font-semibold text-primary">${r.actor}</td>
        <td class="py-2.5 px-4">
          <span class="px-2 py-0.5 rounded text-[11px] font-mono font-semibold uppercase bg-accent-orange/10 text-accent-orange border border-accent-orange/20">
            ${r.action}
          </span>
        </td>
        <td class="py-2.5 px-4 text-primary font-medium">${r.target}</td>
        <td class="py-2.5 px-4 text-secondary text-[11px] truncate max-w-xs">${r.details || '—'}</td>
      </tr>
    `).join('');

    const totalPages = Math.ceil(filtered.length / pageSize);
    (document.getElementById('page-indicator') as HTMLElement).textContent = 
      `Page ${currentPage + 1} of ${totalPages || 1} (${filtered.length} total events)`;

    const prevBtn = document.getElementById('prev-page-btn') as HTMLButtonElement;
    const nextBtn = document.getElementById('next-page-btn') as HTMLButtonElement;
    prevBtn.disabled = currentPage === 0;
    nextBtn.disabled = start + pageSize >= filtered.length;
  }

  async function loadAudit() {
    try {
      allRecords = await api.getAuditLog(500, 0);
      renderTableRows();
    } catch {
      const tbody = document.getElementById('audit-table-body') as HTMLElement;
      tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-red-400">Failed to load audit records.</td></tr>`;
    }
  }

  document.getElementById('audit-search')?.addEventListener('input', (e) => {
    filterText = (e.target as HTMLInputElement).value.trim().toLowerCase();
    currentPage = 0;
    renderTableRows();
  });

  document.getElementById('prev-page-btn')?.addEventListener('click', () => {
    if (currentPage > 0) {
      currentPage--;
      renderTableRows();
    }
  });

  document.getElementById('next-page-btn')?.addEventListener('click', () => {
    currentPage++;
    renderTableRows();
  });

  document.getElementById('refresh-audit-btn')?.addEventListener('click', loadAudit);

  loadAudit();
}
