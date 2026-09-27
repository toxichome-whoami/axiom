/*
 * Top navigation bar component for Axiom Admin Dashboard.
 * Displays gateway status indicator, logged-in administrator, and logout action.
 */

import { api } from '../api';
import { icon } from './Icons';

export function renderNavbar(onToggleSidebar: () => void): string {
  const username = localStorage.getItem('axiom_username') || 'admin';

  setTimeout(() => {
    document.getElementById('mobile-menu-btn')?.addEventListener('click', onToggleSidebar);
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await api.logout();
      window.location.hash = '#/login';
    });
  }, 0);

  return `
    <header class="h-14 border-b border-surfaceBorder bg-surface px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20">
      <div class="flex items-center space-x-3">
        <button 
          id="mobile-menu-btn" 
          aria-label="Open Navigation Menu"
          class="lg:hidden p-2 text-secondary hover:text-primary hover:bg-surfaceHover rounded-md transition-colors"
        >
          ${icon('menu', 'w-5 h-5')}
        </button>

        <a href="#/overview" class="flex items-center space-x-2.5">
          <div class="w-6 h-6 rounded bg-accent-orange text-white flex items-center justify-center font-bold text-xs tracking-wider">
            AX
          </div>
          <span class="font-semibold text-sm text-primary tracking-tight">Axiom</span>
          <span class="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-surfaceHover text-secondary border border-surfaceBorder">v4.0</span>
        </a>
      </div>

      <div class="flex items-center space-x-4">
        <!-- Live Gateway Status Pill -->
        <div class="hidden sm:flex items-center space-x-1.5 text-xs text-secondary bg-background px-2.5 py-1 rounded-full border border-surfaceBorder">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Gateway Online</span>
        </div>

        <!-- User profile & Logout -->
        <div class="flex items-center space-x-2 text-xs">
          <span class="text-secondary font-mono">${username}</span>
          <button 
            id="logout-btn" 
            title="Sign out"
            class="p-1.5 text-secondary hover:text-red-400 hover:bg-surfaceHover rounded-md transition-colors"
          >
            ${icon('logout', 'w-4 h-4')}
          </button>
        </div>
      </div>
    </header>
  `;
}
