/*
 * Top navigation bar component for Axiom Admin Dashboard.
 * Ported from binary_alive CollapsedHeader (Cloudflare & Vercel design system).
 * Height: 58px, pitch-black background, subtle borders, live ping probe, and user popover dropdown.
 */

import { api } from '../api';
import { icon } from './Icons';
import { toast } from './Toast';

export function renderNavbar(onToggleSidebar: () => void): string {
  const username = localStorage.getItem('axiom_username') || 'admin';

  setTimeout(() => {
    // Mobile navigation toggle
    document.getElementById('mobile-menu-btn')?.addEventListener('click', onToggleSidebar);

    // User popover dropdown toggle
    const userBtn = document.getElementById('user-menu-btn');
    const userPopover = document.getElementById('user-popover-menu');

    if (userBtn && userPopover) {
      userBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !userPopover.classList.contains('hidden');
        if (isOpen) {
          userPopover.classList.add('hidden');
        } else {
          userPopover.classList.remove('hidden');
        }
      });

      document.addEventListener('click', (e) => {
        if (!userBtn.contains(e.target as Node) && !userPopover.contains(e.target as Node)) {
          userPopover.classList.add('hidden');
        }
      });
    }

    // Hot-reload metadata snapshot
    document.getElementById('reload-meta-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('reload-meta-btn') as HTMLButtonElement;
      if (!btn) return;
      btn.disabled = true;
      btn.classList.add('opacity-50');
      try {
        await api.reloadMetadata();
        toast.success('Metadata snapshot refreshed from axiom.db');
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Reload failed');
      } finally {
        btn.disabled = false;
        btn.classList.remove('opacity-50');
      }
    });

    // Logout trigger
    const handleLogout = async () => {
      await api.logout();
      toast.info('Signed out of administrative console');
      window.location.hash = '#/login';
    };

    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
    document.getElementById('popover-logout-btn')?.addEventListener('click', handleLogout);

    // Real live health probe with ping measurement
    const checkLiveHealth = async () => {
      const dot = document.getElementById('navbar-health-dot');
      const text = document.getElementById('navbar-health-text');
      if (!dot || !text) return;

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
    <header class="h-[58px] bg-[#000000] shrink-0 border-b border-[#222222] flex items-center px-4 z-20 sticky top-0 gap-2 select-none">
      <!-- Mobile drawer toggle -->
      <button
        id="mobile-menu-btn"
        class="p-1.5 -ml-1 text-[#8c8c8c] hover:text-white rounded-lg md:hidden hover:bg-[#161616] transition-colors cursor-pointer"
        aria-label="Toggle navigation"
        type="button"
      >
        ${icon('menu', 'w-5 h-5')}
      </button>

      <!-- Brand icon on mobile -->
      <div class="flex items-center gap-2 md:hidden">
        <div class="size-6 rounded-[4px] bg-[#f38020] text-white flex items-center justify-center font-bold text-xs tracking-wider">
          AX
        </div>
        <span class="font-semibold text-sm text-white tracking-tight">Axiom</span>
      </div>

      <!-- Right controls matching Cloudflare CollapsedHeader -->
      <div class="ml-auto flex items-center gap-2">
        <!-- Live Gateway Ping Status -->
        <div id="navbar-health-pill" class="hidden sm:flex items-center gap-2 text-xs text-[#8c8c8c] bg-[#0c0c0c] px-3 py-1.5 rounded-lg border border-[#262626]">
          <span id="navbar-health-dot" class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span id="navbar-health-text" class="font-mono">Online</span>
        </div>

        <!-- Reload Config Button -->
        <button 
          id="reload-meta-btn"
          type="button"
          title="Hot-reload metadata snapshot from axiom.db"
          class="flex items-center gap-1.5 px-3 h-8 bg-[#0c0c0c] hover:bg-[#161616] text-[#cccccc] hover:text-white rounded-lg text-xs font-medium transition-colors border border-[#262626] cursor-pointer"
        >
          ${icon('refresh', 'w-3.5 h-3.5 text-[#8c8c8c]')}
          <span class="hidden md:inline">Reload Snapshot</span>
        </button>

        <!-- User Menu Popover Trigger -->
        <div class="relative">
          <button
            id="user-menu-btn"
            type="button"
            aria-label="User menu"
            class="size-8 rounded-lg text-[#8c8c8c] hover:text-white hover:bg-[#161616] flex items-center justify-center transition-colors cursor-pointer"
          >
            ${icon('user', 'w-4 h-4')}
          </button>

          <!-- Popover Dropdown Menu -->
          <div
            id="user-popover-menu"
            class="hidden absolute right-0 top-full mt-2 w-[260px] bg-[#0e0e0e] border border-[#262626] rounded-[8px] shadow-2xl p-1.5 z-50 select-none animate-in fade-in zoom-in-95 font-sans"
          >
            <!-- Account info header -->
            <div class="p-2.5 rounded-lg bg-[#141414] border border-[#1f1f1f] mb-1">
              <div class="flex items-center justify-between gap-1">
                <span class="text-[14px] font-medium text-white truncate leading-tight">
                  ${username}
                </span>
                <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium text-[#8c8c8c] bg-[#1a1a1a] border border-[#262626] capitalize shrink-0">
                  Admin
                </span>
              </div>
              <p class="text-[12px] text-[#8c8c8c] truncate leading-tight mt-1 font-mono">
                ${username}@localhost
              </p>
            </div>

            <!-- Navigation Items -->
            <div class="space-y-0.5 py-0.5">
              <a
                href="#/system"
                class="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-lg transition-colors cursor-pointer"
              >
                ${icon('settings', 'w-4 h-4 text-[#8c8c8c]')}
                <span>System Settings</span>
              </a>

              <a
                href="#/audit"
                class="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-lg transition-colors cursor-pointer"
              >
                ${icon('file-text', 'w-4 h-4 text-[#8c8c8c]')}
                <span>Audit Logs</span>
              </a>

              <a
                href="#/metrics"
                class="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-lg transition-colors cursor-pointer"
              >
                ${icon('activity', 'w-4 h-4 text-[#8c8c8c]')}
                <span>Gateway Metrics</span>
              </a>
            </div>

            <!-- Edge-to-edge line through padding -->
            <div class="-mx-1.5 h-px bg-[#222222] my-1.5"></div>

            <!-- Sign out button -->
            <button
              id="popover-logout-btn"
              type="button"
              class="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] font-normal text-[#d4d4d4] hover:text-rose-400 hover:bg-[#1a1a1a] rounded-lg transition-colors cursor-pointer text-left"
            >
              ${icon('logout', 'w-4 h-4 text-[#8c8c8c]')}
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  `;
}
