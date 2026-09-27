/*
 * Top navigation bar component for Axiom Admin Dashboard.
 * Displays live gateway ping indicator, metadata reload trigger, and active administrator profile.
 */

import { api } from '../api';
import { icon } from './Icons';
import { toast } from './Toast';

export function renderNavbar(onToggleSidebar: () => void): string {
  const username = localStorage.getItem('axiom_username') || 'admin';

  setTimeout(() => {
    document.getElementById('mobile-menu-btn')?.addEventListener('click', onToggleSidebar);
    
    document.getElementById('reload-meta-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('reload-meta-btn') as HTMLButtonElement;
      btn.disabled = true;
      btn.classList.add('opacity-50');
      try {
        await api.reloadMetadata();
        toast.success('Metadata snapshot reloaded into memory');
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Reload failed');
      } finally {
        btn.disabled = false;
        btn.classList.remove('opacity-50');
      }
    });

    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await api.logout();
      toast.info('Signed out of administrative session');
      window.location.hash = '#/login';
    });

    // Real live health probe
    const checkLiveHealth = async () => {
      const pill = document.getElementById('navbar-health-pill');
      const dot = document.getElementById('navbar-health-dot');
      const text = document.getElementById('navbar-health-text');
      if (!pill || !dot || !text) return;

      const start = performance.now();
      try {
        const res = await api.getHealth();
        const latency = Math.round(performance.now() - start);
        if (res.status === 'ok') {
          dot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
          text.textContent = `Online (${latency}ms)`;
        } else {
          dot.className = 'w-2 h-2 rounded-full bg-amber-400';
          text.textContent = 'Degraded';
        }
      } catch {
        dot.className = 'w-2 h-2 rounded-full bg-rose-500';
        text.textContent = 'Disconnected';
      }
    };

    checkLiveHealth();
    const interval = setInterval(checkLiveHealth, 15000);

    const cleanup = () => {
      clearInterval(interval);
      window.removeEventListener('hashchange', cleanup);
    };
    window.addEventListener('hashchange', cleanup);
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

        <a href="#/overview" class="flex items-center space-x-2.5 group">
          <div class="w-6 h-6 rounded bg-accent-orange text-white flex items-center justify-center font-bold text-xs tracking-wider shadow-xs transition-transform group-hover:scale-105">
            AX
          </div>
          <span class="font-semibold text-sm text-primary tracking-tight">Axiom</span>
          <span class="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-surfaceHover text-secondary border border-surfaceBorder">v4.0</span>
        </a>
      </div>

      <div class="flex items-center space-x-3 sm:space-x-4">
        <!-- Live Gateway Status Indicator -->
        <div id="navbar-health-pill" class="hidden sm:flex items-center space-x-1.5 text-xs text-secondary bg-background px-2.5 py-1 rounded-full border border-surfaceBorder">
          <span id="navbar-health-dot" class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span id="navbar-health-text">Online</span>
        </div>

        <!-- Reload Config Button -->
        <button 
          id="reload-meta-btn"
          title="Hot-reload metadata and snapshot from axiom.db"
          class="flex items-center space-x-1.5 px-2.5 py-1 bg-surfaceHover hover:bg-surfaceBorder text-secondary hover:text-primary rounded-md text-xs transition-colors border border-surfaceBorder"
        >
          ${icon('refresh', 'w-3 h-3')}
          <span class="hidden md:inline">Reload Snapshot</span>
        </button>

        <!-- User profile & Logout -->
        <div class="flex items-center space-x-2 pl-2 border-l border-surfaceBorder text-xs">
          <div class="w-6 h-6 rounded-full bg-accent-orange/20 text-accent-orange flex items-center justify-center font-bold text-[11px] uppercase">
            ${username.charAt(0)}
          </div>
          <span class="text-secondary font-mono hidden sm:inline">${username}</span>
          <button 
            id="logout-btn" 
            title="Sign out of console"
            class="p-1.5 text-secondary hover:text-red-400 hover:bg-surfaceHover rounded-md transition-colors"
          >
            ${icon('logout', 'w-4 h-4')}
          </button>
        </div>
      </div>
    </header>
  `;
}
