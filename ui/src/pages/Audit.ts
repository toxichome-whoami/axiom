/*
 * Immutable audit trail viewer for administrative and control plane events.
 * Displays formatted event details, searchable actors/targets, and pagination.
 */

import { api, AuditRecord } from '../api';
import { icon } from '../components/Icons';
import { toast } from '../components/Toast';

export async function renderAudit(container: HTMLElement) {
  let allRecords: AuditRecord[] = [];
  let filterText = '';
  let currentPage = 0;
  const pageSize = 20;

  container.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold text-primary">Audit Trail</h1>
          <p class="text-xs text-secondary mt-0.5">Immutable record of control plane mutations, credential issuance, and security actions.</p>
        </div>
        <div class="flex items-center space-x-2">
          <input 
            id="audit-search" 
            type="text" 
            placeholder="Filter by action, actor, target..." 
            class="px-3 py-1.5 bg-surface border border-surfaceBorder rounded-md text-xs text-primary focus:outline-none focus:border-focusRing w-56 sm:w-64"
          />
          <button id="refresh-audit-btn" class="p-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-secondary hover:text-primary transition-colors" title="Refresh audit log">
            ${icon('refresh', 'w-4 h-4')}
          </button>
        </div>
      </div>

      <!-- Audit Table Card -->
      <div class="bg-surface border border-surfaceBorder rounded-lg overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs text-secondary">
            <thead class="bg-background text-[11px] font-semibold uppercase tracking-wider text-secondary border-b border-surfaceBorder">
              <tr>
                <th class="py-3 px-4">Event ID</th>
                <th class="py-3 px-4">Timestamp</th>
                <th class="py-3 px-4">Actor</th>
                <th class="py-3 px-4">Action</th>
                <th class="py-3 px-4">Target</th>
                <th class="py-3 px-4">Details</th>
              </tr>
            </thead>
            <tbody id="audit-table-body" class="divide-y divide-surfaceBorder font-mono">
              <tr>
                <td colspan="6" class="py-8 text-center text-secondary">Loading audit trail...</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination Controls -->
        <div class="p-3 bg-background border-t border-surfaceBorder flex items-center justify-between text-xs text-secondary">
          <span id="page-indicator">Showing 0 events</span>
          <div class="flex space-x-2">
            <button id="prev-page-btn" disabled class="px-3 py-1 bg-surface border border-surfaceBorder rounded text-secondary hover:text-primary disabled:opacity-40 disabled:pointer-events-none transition-colors">
              Previous
            </button>
            <button id="next-page-btn" disabled class="px-3 py-1 bg-surface border border-surfaceBorder rounded text-secondary hover:text-primary disabled:opacity-40 disabled:pointer-events-none transition-colors">
              Next
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Event Detail Modal -->
    <div id="audit-detail-modal" class="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-lg w-full p-6 space-y-4 shadow-xl">
        <div class="flex items-center justify-between pb-2 border-b border-surfaceBorder">
          <div class="flex items-center space-x-2 text-primary font-semibold text-sm">
            ${icon('file-text', 'w-4 h-4 text-accent-orange')}
            <span id="modal-event-title">Event Detail</span>
          </div>
          <button id="close-audit-detail" class="text-secondary hover:text-primary p-1">
            ${icon('x', 'w-4 h-4')}
          </button>
        </div>
        <div class="space-y-3 text-xs font-mono">
          <div class="bg-background p-3 rounded border border-surfaceBorder overflow-x-auto max-h-[360px] overflow-y-auto">
            <pre id="modal-event-json" class="text-secondary leading-relaxed whitespace-pre-wrap"></pre>
          </div>
        </div>
        <button id="close-audit-detail-btn" class="w-full py-2 bg-surfaceHover hover:bg-surfaceBorder text-primary text-xs font-medium rounded-md transition-colors">
          Close
        </button>
      </div>
    </div>
  `;

  const detailModal = document.getElementById('audit-detail-modal') as HTMLElement;

  function showDetailModal(record: AuditRecord) {
    (document.getElementById('modal-event-title') as HTMLElement).textContent = `Event #${record.id} — ${record.action}`;
    
    let formattedDetails = record.details || 'No additional payload metadata';
    try {
      if (record.details) {
        const parsed = JSON.parse(record.details);
        formattedDetails = JSON.stringify(parsed, null, 2);
      }
    } catch {}

    const payload = {
      id: record.id,
      timestamp: new Date(record.timestamp * 1000).toISOString(),
      actor: record.actor,
      action: record.action,
      target: record.target,
      details: formattedDetails,
    };

    (document.getElementById('modal-event-json') as HTMLElement).textContent = JSON.stringify(payload, null, 2);
    detailModal.classList.remove('hidden');
  }

  const closeDetail = () => detailModal.classList.add('hidden');
  document.getElementById('close-audit-detail')?.addEventListener('click', closeDetail);
  document.getElementById('close-audit-detail-btn')?.addEventListener('click', closeDetail);
  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) closeDetail();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !detailModal.classList.contains('hidden')) {
      closeDetail();
    }
  };
  window.addEventListener('keydown', onKey);

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
      tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-secondary font-sans">No matching audit events recorded.</td></tr>`;
      (document.getElementById('page-indicator') as HTMLElement).textContent = `Showing 0 of ${filtered.length} events`;
      return;
    }

    tbody.innerHTML = pageSlice.map((r, idx) => `
      <tr class="hover:bg-surfaceHover/40 transition-colors cursor-pointer" data-audit-idx="${start + idx}">
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

    tbody.querySelectorAll('[data-audit-idx]').forEach((row) => {
      row.addEventListener('click', (e) => {
        const idx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-audit-idx') || '0', 10);
        if (filtered[idx]) {
          showDetailModal(filtered[idx]);
        }
      });
    });

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
      tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-rose-400 font-sans">Failed to load audit records.</td></tr>`;
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

  document.getElementById('refresh-audit-btn')?.addEventListener('click', async () => {
    await loadAudit();
    toast.info('Audit log refreshed');
  });

  loadAudit();
}
