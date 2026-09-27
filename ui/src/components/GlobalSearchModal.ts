/*
 * Global Quick Search palette (Ctrl+K) for Axiom Admin Dashboard.
 * Ported from binary_alive GlobalSearchModal with keyboard navigation.
 */

import { icon } from './Icons';

interface SearchItem {
  id: string;
  label: string;
  category: string;
  hash: string;
  iconName: string;
}

const SEARCH_ITEMS: SearchItem[] = [
  { id: 'overview', label: 'Overview Dashboard', category: 'Data Plane', hash: '#/overview', iconName: 'dashboard' },
  { id: 'databases', label: 'Databases & Connections', category: 'Data Plane', hash: '#/databases', iconName: 'database' },
  { id: 'cache', label: 'Cache Engine Telemetry', category: 'Data Plane', hash: '#/cache', iconName: 'hard-drive' },
  { id: 'keys', label: 'API Keys & Secrets', category: 'Access & Security', hash: '#/keys', iconName: 'key' },
  { id: 'roles', label: 'Roles & RBAC Policies', category: 'Access & Security', hash: '#/roles', iconName: 'shield' },
  { id: 'audit', label: 'Audit Trail Logs', category: 'Access & Security', hash: '#/audit', iconName: 'file-text' },
  { id: 'metrics', label: 'Prometheus Metrics', category: 'Observability', hash: '#/metrics', iconName: 'activity' },
  { id: 'logs', label: 'Live Server Logs', category: 'Observability', hash: '#/logs', iconName: 'file-text' },
  { id: 'system', label: 'System Diagnostics & Info', category: 'System', hash: '#/system', iconName: 'server' },
];

export function initGlobalSearch() {
  let isOpen = false;
  let query = '';
  let selectedIndex = 0;

  const ensureModal = (): HTMLElement => {
    let el = document.getElementById('global-search-modal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'global-search-modal';
      el.className = 'fixed inset-0 z-50 bg-black/80 backdrop-blur-xs hidden flex items-start justify-center pt-24 px-4 select-none';
      document.body.appendChild(el);
    }
    return el;
  };

  const getFilteredItems = () => {
    const q = query.trim().toLowerCase();
    if (!q) return SEARCH_ITEMS;
    return SEARCH_ITEMS.filter((item) =>
      item.label.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
    );
  };

  const renderModal = () => {
    const modal = ensureModal();
    if (!isOpen) {
      modal.classList.add('hidden');
      return;
    }
    modal.classList.remove('hidden');

    const filtered = getFilteredItems();
    if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);

    modal.innerHTML = `
      <div id="search-modal-card" class="bg-[#0c0c0c] border border-[#262626] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in fade-in zoom-in-95">
        <!-- Input Header -->
        <div class="flex items-center px-4 border-b border-[#222222] bg-[#000000] h-12">
          ${icon('search', 'w-4 h-4 text-[#8c8c8c] mr-3')}
          <input
            id="global-search-input"
            type="text"
            placeholder="Type a command or jump to page..."
            value="${query}"
            autocomplete="off"
            spellcheck="false"
            class="w-full bg-transparent text-[14px] text-white placeholder-[#666666] outline-none border-0"
          />
          <kbd class="ml-2 px-1.5 py-0.5 text-[11px] font-mono text-[#8c8c8c] bg-[#161616] border border-[#262626] rounded">ESC</kbd>
        </div>

        <!-- Results List -->
        <div class="max-h-72 overflow-y-auto p-1.5 space-y-0.5">
          ${
            filtered.length === 0
              ? `<div class="py-8 text-center text-xs text-[#666666]">No matching navigation routes found.</div>`
              : filtered
                  .map((item, idx) => {
                    const isSelected = idx === selectedIndex;
                    return `
              <div 
                data-index="${idx}"
                class="search-result-item flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  isSelected ? 'bg-[#1a1a1a] text-white' : 'text-[#8c8c8c] hover:bg-[#141414] hover:text-white'
                }"
              >
                <div class="flex items-center gap-2.5">
                  <span class="${isSelected ? 'text-[#f38020]' : 'text-[#8c8c8c]'}">
                    ${icon(item.iconName, 'w-4 h-4')}
                  </span>
                  <span class="text-xs font-medium">${item.label}</span>
                </div>
                <span class="text-[11px] text-[#666666] font-mono uppercase">${item.category}</span>
              </div>
            `;
                  })
                  .join('')
          }
        </div>

        <!-- Footer -->
        <div class="px-4 py-2 border-t border-[#222222] bg-[#0a0a0a] flex items-center justify-between text-[11px] text-[#666666]">
          <div class="flex items-center gap-3">
            <span><kbd class="font-mono text-[#8c8c8c]">↑↓</kbd> navigate</span>
            <span><kbd class="font-mono text-[#8c8c8c]">↵</kbd> select</span>
          </div>
          <span>Axiom Console</span>
        </div>
      </div>
    `;

    const input = document.getElementById('global-search-input') as HTMLInputElement;
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.addEventListener('input', (e) => {
        query = (e.target as HTMLInputElement).value;
        selectedIndex = 0;
        renderModal();
      });
    }

    modal.querySelectorAll('.search-result-item').forEach((itemEl) => {
      itemEl.addEventListener('click', () => {
        const idx = parseInt(itemEl.getAttribute('data-index') || '0', 10);
        const target = filtered[idx];
        if (target) {
          close();
          window.location.hash = target.hash;
        }
      });
    });
  };

  const open = () => {
    isOpen = true;
    query = '';
    selectedIndex = 0;
    renderModal();
  };

  const close = () => {
    isOpen = false;
    renderModal();
  };

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (isOpen) close();
      else open();
    } else if (isOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const filtered = getFilteredItems();
        if (filtered.length > 0) {
          selectedIndex = (selectedIndex + 1) % filtered.length;
          renderModal();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const filtered = getFilteredItems();
        if (filtered.length > 0) {
          selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
          renderModal();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const filtered = getFilteredItems();
        if (filtered[selectedIndex]) {
          const target = filtered[selectedIndex];
          close();
          window.location.hash = target.hash;
        }
      }
    }
  });

  window.addEventListener('open-global-search', () => open());

  document.addEventListener('mousedown', (e) => {
    if (!isOpen) return;
    const modal = document.getElementById('global-search-modal');
    const card = document.getElementById('search-modal-card');
    if (modal && card && e.target === modal) {
      close();
    }
  });
}
