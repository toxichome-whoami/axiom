/*
 * Immutable audit trail viewer for administrative and control plane events.
 * Ported from binary_alive DataTable & Dialog architecture.
 * Displays formatted event details, searchable actors/targets, and pagination.
 */

import { api, AuditRecord } from '../api';
import { icon } from '../components/Icons';
import { toast } from '../components/Toast';

export async function renderAudit(container: HTMLElement) {
  let allRecords: AuditRecord[] = [];
  let filterText = '';
  let currentPage = 1;
  const pageSize = 15;

  container.innerHTML = `
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-xl font-semibold text-white tracking-tight">Audit Trail</h1>
            <span id="audit-count-badge" class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#141414] border border-[#262626] text-[#8c8c8c]">0 events</span>
          </div>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Immutable record of control plane mutations, credential issuance, and security actions.</p>
        </div>

        <div class="flex items-center gap-2.5">
          <!-- Search input -->
          <div class="relative w-56 sm:w-72">
            <span class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#8c8c8c]">
              ${icon('search', 'w-3.5 h-3.5 opacity-60')}
            </span>
            <input 
              id="audit-search" 
              type="text" 
              placeholder="Filter by action, actor, target..." 
              class="w-full h-8 pl-8 pr-3 rounded-lg bg-[#0c0c0c] border border-[#262626] text-xs text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
            />
          </div>

          <button 
            id="refresh-audit-btn" 
            type="button"
            class="size-8 rounded-lg bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] text-[#8c8c8c] hover:text-white transition-colors flex items-center justify-center cursor-pointer shrink-0" 
            title="Refresh audit log"
          >
            ${icon('refresh', 'w-3.5 h-3.5')}
          </button>
        </div>
      </div>

      <!-- Audit Table Container in Cloudflare DataTable Pattern -->
      <div class="border border-[#262626] rounded-lg overflow-hidden bg-[#0e0e0e] flex flex-col text-[14px]">
        <div class="overflow-x-auto w-full">
          <table class="w-full text-left border-collapse min-w-[760px]">
            <thead class="sticky top-0 z-10">
              <tr class="border-b border-[#222222] bg-[#141414] h-[40px] text-[13px] font-medium text-white">
                <th class="px-4">Event ID</th>
                <th class="px-4">Timestamp</th>
                <th class="px-4">Actor</th>
                <th class="px-4">Action</th>
                <th class="px-4">Target Resource</th>
                <th class="px-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody id="audit-table-body" class="divide-y divide-[#1e1e1e] text-[13px] text-[#cccccc]">
              <tr>
                <td colspan="6" class="px-4 py-12 text-center text-xs text-[#666666]">
                  <div class="h-4 w-1/3 mx-auto rounded bg-[#1a1a1a] animate-pulse"></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination Controls matching DataTable.tsx in binary_alive -->
        <div class="flex items-center justify-between px-4 py-2.5 border-t border-[#222222] bg-[#0e0e0e] text-[13px] text-[#8c8c8c]">
          <span id="page-indicator">Showing events</span>
          <div class="flex items-center gap-2 select-none">
            <button 
              id="prev-page-btn" 
              type="button"
              disabled 
              class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] border border-[#262626] hover:border-[#383838] disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
            >
              ${icon('chevron-left', 'w-3.5 h-3.5')}
              <span>Previous</span>
            </button>
            <span id="page-number-display" class="px-2 text-xs">Page 1 of 1</span>
            <button 
              id="next-page-btn" 
              type="button"
              disabled 
              class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] border border-[#262626] hover:border-[#383838] disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
            >
              <span>Next</span>
              ${icon('chevron-right', 'w-3.5 h-3.5')}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Event Detail Modal -->
    <div id="audit-detail-modal" class="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden select-none animate-in fade-in">
      <div class="bg-[#0e0e0e] border border-[#262626] rounded-lg max-w-lg w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between pb-3 border-b border-[#222222]">
          <div class="flex items-center gap-2 text-white font-semibold text-sm">
            ${icon('file-text', 'w-4 h-4 text-[#f38020]')}
            <span id="modal-event-title">Event Detail</span>
          </div>
          <button id="close-audit-detail" class="text-[#8c8c8c] hover:text-white p-1 cursor-pointer">
            ${icon('x', 'w-4 h-4')}
          </button>
        </div>
        <div class="space-y-3 font-mono text-xs">
          <div class="bg-[#0a0a0b] p-3 rounded-lg border border-[#222222] overflow-x-auto max-h-[360px] overflow-y-auto">
            <pre id="modal-event-json" class="text-[#cccccc] leading-relaxed whitespace-pre-wrap"></pre>
          </div>
        </div>
        <button id="close-audit-detail-btn" class="w-full h-8 bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-white text-xs font-medium rounded-lg transition-colors cursor-pointer">
          Close
        </button>
      </div>
    </div>
  `;

  const detailModal = document.getElementById('audit-detail-modal') as HTMLElement;

  function showDetailModal(record: AuditRecord) {
    (document.getElementById('modal-event-title') as HTMLElement).textContent = `Event #${record.id} — ${record.action}`;
    (document.getElementById('modal-event-json') as HTMLElement).textContent = JSON.stringify(record, null, 2);
    detailModal.classList.remove('hidden');
  }

  function getFilteredRecords() {
    if (!filterText) return allRecords;
    const q = filterText.toLowerCase();
    return allRecords.filter(
      (r) =>
        r.action.toLowerCase().includes(q) ||
        r.actor.toLowerCase().includes(q) ||
        r.target.toLowerCase().includes(q) ||
        (r.details && r.details.toLowerCase().includes(q))
    );
  }

  function renderTable() {
    const tbody = document.getElementById('audit-table-body') as HTMLElement;
    const pageIndicator = document.getElementById('page-indicator') as HTMLElement;
    const pageNumberDisplay = document.getElementById('page-number-display') as HTMLElement;
    const prevBtn = document.getElementById('prev-page-btn') as HTMLButtonElement;
    const nextBtn = document.getElementById('next-page-btn') as HTMLButtonElement;
    const countBadge = document.getElementById('audit-count-badge') as HTMLElement;

    const filtered = getFilteredRecords();
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, total);
    const pageItems = filtered.slice(startIdx, endIdx);

    if (countBadge) countBadge.textContent = `${total} event${total === 1 ? '' : 's'}`;

    if (total === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-12 text-center text-xs text-[#666666]">No audit log events match current query.</td></tr>`;
      pageIndicator.textContent = 'Showing 0 events';
      pageNumberDisplay.textContent = 'Page 1 of 1';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    pageIndicator.innerHTML = `Showing <span class="text-white font-medium tabular-nums">${startIdx + 1}–${endIdx}</span> of <span class="text-white font-medium tabular-nums">${total}</span>`;
    pageNumberDisplay.innerHTML = `Page <span class="text-white font-medium tabular-nums">${currentPage}</span> of <span class="text-white font-medium tabular-nums">${totalPages}</span>`;
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;

    tbody.innerHTML = pageItems
      .map(
        (r) => `
      <tr class="h-[44px] hover:bg-[#161616] transition-colors">
        <td class="px-4 py-2 font-mono text-xs text-[#8c8c8c] tabular-nums">#${r.id}</td>
        <td class="px-4 py-2 font-mono text-xs text-[#8c8c8c] tabular-nums whitespace-nowrap">
          ${new Date(r.timestamp * 1000).toLocaleString()}
        </td>
        <td class="px-4 py-2 font-mono text-xs text-white">
          <div class="flex items-center gap-1.5">
            <span class="size-1.5 rounded-full bg-[#f38020]"></span>
            <span>${r.actor}</span>
          </div>
        </td>
        <td class="px-4 py-2">
          <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono uppercase bg-[#141414] text-[#f38020] border border-[#262626]">
            ${r.action}
          </span>
        </td>
        <td class="px-4 py-2 font-mono text-xs text-white">${r.target}</td>
        <td class="px-4 py-2 text-right">
          <button 
            data-audit-id="${r.id}" 
            class="h-7 px-2.5 rounded bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] text-xs font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            Inspect
          </button>
        </td>
      </tr>
    `
      )
      .join('');

    tbody.querySelectorAll('[data-audit-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = parseInt((e.currentTarget as HTMLElement).getAttribute('data-audit-id') || '0', 10);
        const record = allRecords.find((r) => r.id === id);
        if (record) showDetailModal(record);
      });
    });
  }

  async function loadAuditRecords() {
    try {
      allRecords = await api.getAuditLog(500, 0);
      renderTable();
    } catch {
      const tbody = document.getElementById('audit-table-body') as HTMLElement;
      tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-rose-400 text-xs">Failed to load audit records.</td></tr>`;
    }
  }

  document.getElementById('audit-search')?.addEventListener('input', (e) => {
    filterText = (e.target as HTMLInputElement).value.trim();
    currentPage = 1;
    renderTable();
  });

  document.getElementById('refresh-audit-btn')?.addEventListener('click', async () => {
    await loadAuditRecords();
    toast.info('Audit trail refreshed');
  });

  document.getElementById('prev-page-btn')?.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  });

  document.getElementById('next-page-btn')?.addEventListener('click', () => {
    currentPage++;
    renderTable();
  });

  const closeDetail = () => detailModal.classList.add('hidden');
  document.getElementById('close-audit-detail')?.addEventListener('click', closeDetail);
  document.getElementById('close-audit-detail-btn')?.addEventListener('click', closeDetail);

  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) closeDetail();
  });

  await loadAuditRecords();
}
