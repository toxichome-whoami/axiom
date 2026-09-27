/*
 * Administrative authentication screen for Web UI.
 * Ported from binary_alive Login architecture (Cloudflare & Vercel design system).
 * Enforces constant-time Argon2 verification on the gateway.
 */

import { api } from '../api';
import { toast } from '../components/Toast';

export function renderLogin(container: HTMLElement) {
  container.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4 bg-[#000000] select-none font-sans">
      <div class="w-full max-w-sm bg-[#0e0e0e] border border-[#262626] rounded-xl p-8 shadow-2xl space-y-6 animate-in fade-in zoom-in-95">
        <div class="flex items-center gap-3">
          <div class="size-9 rounded-lg bg-[#f38020] flex items-center justify-center font-bold text-white tracking-wider shadow-xs text-sm">
            AX
          </div>
          <div>
            <h1 class="text-base font-semibold text-white tracking-tight">Axiom Gateway</h1>
            <p class="text-xs text-[#8c8c8c]">Administrative Console</p>
          </div>
        </div>

        <div id="login-error" class="hidden p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

        <form id="login-form" class="space-y-4 text-xs">
          <div>
            <label for="username" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Username</label>
            <input 
              id="username" 
              name="username" 
              type="text" 
              required 
              autocomplete="username"
              placeholder="admin"
              class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
            />
          </div>

          <div>
            <label for="password" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Password</label>
            <input 
              id="password" 
              name="password" 
              type="password" 
              required 
              autocomplete="current-password"
              placeholder="••••••••••••"
              class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
            />
          </div>

          <button 
            type="submit" 
            id="login-btn"
            class="w-full h-9 bg-[#f38020] hover:bg-[#e07018] active:bg-[#d06810] text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center shadow-xs cursor-pointer mt-2"
          >
            <span>Sign In</span>
          </button>
        </form>

        <div class="pt-2 border-t border-[#222222] text-center text-[11px] text-[#666666] font-mono">
          Engine v4.0.0 • Pure Single-Binary
        </div>
      </div>
    </div>
  `;

  const form = document.getElementById('login-form') as HTMLFormElement;
  const errorBox = document.getElementById('login-error') as HTMLElement;
  const submitBtn = document.getElementById('login-btn') as HTMLButtonElement;

  (document.getElementById('username') as HTMLInputElement)?.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.add('hidden');
    errorBox.textContent = '';
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Verifying credentials...</span>`;

    const username = (document.getElementById('username') as HTMLInputElement).value.trim();
    const password = (document.getElementById('password') as HTMLInputElement).value;

    try {
      const res = await api.login({ username, password });
      localStorage.setItem('axiom_session_token', res.token);
      localStorage.setItem('axiom_username', res.username);
      toast.success(`Welcome back, ${res.username}`);
      window.location.hash = '#/overview';
    } catch (err: unknown) {
      errorBox.textContent = err instanceof Error ? err.message : 'Invalid credentials';
      errorBox.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Sign In</span>`;
    }
  });
}
