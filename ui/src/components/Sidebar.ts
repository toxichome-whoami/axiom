/*
 * Sidebar navigation component for Axiom Admin Dashboard.
 * Ported directly from binary_alive Sidebar (Cloudflare & Vercel design system).
 * Width: 260px, OLED black `#000000`, border `#222222`, Quick Search (Ctrl+K), and sectioned items.
 */

import { icon } from './Icons';

interface NavItem {
  id: string;
  label: string;
  iconName: string;
  hash: string;
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    title: 'Data Plane',
    items: [
      { id: 'overview', label: 'Overview', iconName: 'dashboard', hash: '#/overview' },
      { id: 'databases', label: 'Databases', iconName: 'database', hash: '#/databases' },
      { id: 'cache', label: 'Cache Engine', iconName: 'hard-drive', hash: '#/cache' },
    ],
  },
  {
    title: 'Access & Security',
    items: [
      { id: 'keys', label: 'API Keys', iconName: 'key', hash: '#/keys' },
      { id: 'roles', label: 'Roles & RBAC', iconName: 'shield', hash: '#/roles' },
      { id: 'audit', label: 'Audit Trail', iconName: 'file-text', hash: '#/audit' },
    ],
  },
  {
    title: 'System & Telemetry',
    items: [
      { id: 'metrics', label: 'Metrics', iconName: 'activity', hash: '#/metrics' },
      { id: 'logs', label: 'Live Logs', iconName: 'file-text', hash: '#/logs' },
      { id: 'system', label: 'System', iconName: 'server', hash: '#/system' },
    ],
  },
];

export function renderSidebar(activeRoute: string, isOpenOnMobile: boolean, onClose: () => void): string {
  setTimeout(() => {
    document.getElementById('sidebar-backdrop')?.addEventListener('click', onClose);
    document.getElementById('sidebar-quick-search-btn')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('open-global-search'));
    });
  }, 0);

  const sectionsHtml = SECTIONS.map((sec) => {
    const itemsHtml = sec.items
      .map((item) => {
        const isActive = activeRoute === item.id;
        return `
        <li class="relative">
          <a
            href="${item.hash}"
            class="group/menu-button relative flex w-full min-w-0 cursor-pointer items-center rounded-lg outline-none min-h-[34px] py-0 text-sm font-medium transition-colors duration-150 gap-2.5 px-3 ${
              isActive
                ? 'bg-[#111111] text-white border-l-2 border-[#f38020]'
                : 'text-[#d4d4d4] hover:bg-[#161616] hover:text-white border-l-2 border-transparent'
            }"
          >
            <span class="${isActive ? 'text-[#f38020]' : 'text-[#8c8c8c]'} opacity-75 group-hover/menu-button:opacity-100">
              ${icon(item.iconName, 'w-4 h-4')}
            </span>
            <span class="truncate text-[13px]">${item.label}</span>
            ${
              item.badge
                ? `<span class="ml-auto inline-flex items-center rounded-full border border-dashed border-[#383838] px-1.5 py-0.5 text-[11px] font-medium text-[#d4d4d4] select-none">${item.badge}</span>`
                : ''
            }
          </a>
        </li>
      `;
      })
      .join('');

    return `
      <div class="flex min-w-0 flex-col gap-y-px">
        <div class="mt-4 mb-2 truncate px-3 text-xs font-medium uppercase tracking-wider text-[#8c8c8c]">
          ${sec.title}
        </div>
        <ul class="m-0 flex min-w-0 list-none flex-col items-stretch gap-y-px p-0">
          ${itemsHtml}
        </ul>
      </div>
    `;
  }).join('');

  return `
    <!-- Mobile Backdrop -->
    <div
      id="sidebar-backdrop"
      class="fixed inset-0 z-40 bg-black/80 backdrop-blur-xs md:hidden ${isOpenOnMobile ? 'block' : 'hidden'} animate-in fade-in duration-200"
    ></div>

    <!-- Main Sidebar Shell -->
    <aside
      class="flex min-h-screen shrink-0 flex-col bg-[#000000] border-r border-[#222222] w-[260px] fixed md:sticky top-0 h-screen select-none z-40 transition-transform duration-200 ${
        isOpenOnMobile ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }"
    >
      <!-- Top Header: Logo, Name and Version Badge -->
      <div class="flex h-[58px] shrink-0 items-center justify-between border-b border-[#222222] px-4 select-none relative z-30">
        <a href="#/overview" class="flex items-center gap-2.5 bg-transparent border-0 p-0 cursor-pointer min-w-0 group">
          <div class="size-6 rounded-[4px] bg-[#f38020] text-white flex items-center justify-center font-bold text-xs tracking-wider shadow-xs transition-transform group-hover:scale-105">
            AX
          </div>
          <span class="text-[16px] text-[#F2F3F3] font-semibold tracking-wide truncate">
            Axiom
          </span>
          <span class="inline-flex items-center px-1.5 py-0.5 rounded-[4px] bg-[#161718] border border-[#26282A] text-[11px] font-mono text-[#A1A1A1] tracking-normal">
            v4.0.0
          </span>
        </a>

        <!-- Mobile close button -->
        <button
          id="sidebar-close-btn"
          class="p-1 text-[#8c8c8c] hover:text-white md:hidden shrink-0 cursor-pointer"
          aria-label="Close sidebar"
        >
          ${icon('x', 'w-5 h-5')}
        </button>
      </div>

      <!-- Navigation Viewport & Scroll Area -->
      <nav class="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden px-[11px] py-3 scrollbar-thin scrollbar-thumb-[#222222]">
        <!-- Quick Search Bar (Ctrl+K) -->
        <div class="w-full shrink-0 px-0.5 mb-2">
          <button
            id="sidebar-quick-search-btn"
            type="button"
            class="group items-center select-none border-0 rounded-lg bg-[#0c0c0c] text-[#d4d4d4] ring-1 ring-[#262626] hover:ring-[#3b82f6] flex h-8 text-xs font-normal shrink-0 w-full overflow-hidden px-3 gap-2.5 transition-all cursor-pointer text-left"
          >
            ${icon('search', 'w-3.5 h-3.5 text-[#8c8c8c] shrink-0 opacity-60')}
            <span class="text-xs text-[#8c8c8c] font-normal flex-1">Quick search...</span>
            <kbd class="ml-auto font-sans text-[11px] font-semibold text-[#d4d4d4] whitespace-nowrap select-none pointer-events-none shrink-0">
              <span class="text-[#8c8c8c] font-medium">Ctrl</span>&nbsp;K
            </kbd>
          </button>
        </div>

        <!-- Sections Menu -->
        ${sectionsHtml}
      </nav>

      <!-- Footer -->
      <div class="flex h-12 min-h-[48px] shrink-0 items-center justify-between border-t border-[#222222] bg-[#000000] px-4 sticky bottom-0 z-20 text-xs text-[#8c8c8c]">
        <div class="flex items-center gap-2">
          <span class="size-2 rounded-full bg-emerald-400"></span>
          <span class="font-mono text-[11px]">Control Plane</span>
        </div>
        <a href="#/system" class="text-[#8c8c8c] hover:text-white transition-colors text-[11px]">
          Docs & API
        </a>
      </div>
    </aside>
  `;
}
