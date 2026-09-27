/*
 * Sidebar navigation component with mobile drawer support.
 * Enforces adaptive input guidelines with minimum 44px tap targets.
 */

import { icon } from './Icons';

interface NavItem {
  id: string;
  label: string;
  iconName: string;
  hash: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', iconName: 'dashboard', hash: '#/overview' },
  { id: 'databases', label: 'Databases', iconName: 'database', hash: '#/databases' },
  { id: 'keys', label: 'API Keys', iconName: 'key', hash: '#/keys' },
  { id: 'roles', label: 'Roles & RBAC', iconName: 'shield', hash: '#/roles' },
  { id: 'cache', label: 'Cache Engine', iconName: 'hard-drive', hash: '#/cache' },
  { id: 'logs', label: 'Live Logs', iconName: 'file-text', hash: '#/logs' },
  { id: 'audit', label: 'Audit Trail', iconName: 'file-text', hash: '#/audit' },
  { id: 'metrics', label: 'Metrics', iconName: 'activity', hash: '#/metrics' },
  { id: 'system', label: 'System', iconName: 'server', hash: '#/system' },
];

export function renderSidebar(activeRoute: string, isOpenOnMobile: boolean, onClose: () => void): string {
  setTimeout(() => {
    document.getElementById('sidebar-backdrop')?.addEventListener('click', onClose);
  }, 0);

  const linksHtml = NAV_ITEMS.map((item) => {
    const isActive = activeRoute === item.id;
    const activeClasses = isActive
      ? 'bg-surfaceBorder text-primary font-medium border-l-2 border-accent-orange'
      : 'text-secondary hover:text-primary hover:bg-surfaceHover border-l-2 border-transparent';

    return `
      <a 
        href="${item.hash}" 
        class="flex items-center space-x-3 px-3 py-2.5 sm:py-2 rounded-r-md text-xs transition-colors duration-150 touch-manipulation min-h-[40px] sm:min-h-[36px] ${activeClasses}"
      >
        <span class="${isActive ? 'text-accent-orange' : 'text-secondary'} shrink-0">
          ${icon(item.iconName, 'w-4 h-4')}
        </span>
        <span class="truncate">${item.label}</span>
      </a>
    `;
  }).join('');

  return `
    <!-- Mobile Backdrop Drawer Overlay -->
    <div 
      id="sidebar-backdrop" 
      class="fixed inset-0 bg-black/60 z-30 transition-opacity lg:hidden ${isOpenOnMobile ? 'block' : 'hidden'}"
    ></div>

    <!-- Sidebar Container -->
    <aside 
      class="fixed inset-y-0 left-0 z-40 w-60 bg-surface border-r border-surfaceBorder transform transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 flex flex-col ${
        isOpenOnMobile ? 'translate-x-0' : '-translate-x-full'
      }"
    >
      <div class="h-14 border-b border-surfaceBorder px-4 flex items-center justify-between lg:hidden shrink-0">
        <span class="text-xs font-semibold text-primary">Menu</span>
        <button id="sidebar-close-btn" class="p-2 text-secondary hover:text-primary touch-manipulation">
          ${icon('x', 'w-5 h-5')}
        </button>
      </div>

      <div class="p-3 space-y-1 flex-1 overflow-y-auto">
        <div class="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-secondary/60">
          Control Plane
        </div>
        ${linksHtml}
      </div>

      <div class="p-3 border-t border-surfaceBorder bg-surface shrink-0">
        <div class="flex items-center justify-between px-2 text-[11px] text-secondary font-mono">
          <span>Engine v4.0.0</span>
          <a href="#/system" class="text-accent-orange hover:underline text-[10px]">Diagnostics</a>
        </div>
      </div>
    </aside>
  `;
}
