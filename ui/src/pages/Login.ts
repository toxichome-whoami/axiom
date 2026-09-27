/*
 * Administrative authentication screen for Web UI.
 * Enforces constant-time Argon2 verification on the gateway.
 */

import { api } from '../api';

export function renderLogin(container: HTMLElement) {
  container.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4 bg-background">
      <div class="w-full max-w-sm bg-surface border border-borderDefault rounded-lg p-6 sm:p-8 shadow-sm">
        <div class="flex items-center space-x-3 mb-6">
          <div class="w-8 h-8 rounded-md bg-accent-orange flex items-center justify-center font-bold text-white tracking-wider">
            AX
          </div>
          <div>
            <h1 class="text-lg font-semibold text-primary">Axiom Gateway</h1>
            <p class="text-xs text-secondary">Administrative Console</p>
          </div>
        </div>

        <div id="login-error" class="hidden mb-4 p-3 rounded-md bg-accent-danger/10 border border-accent-danger/30 text-xs text-red-400"></div>

        <form id="login-form" class="space-y-4">
          <div>
            <label for="username" class="block text-xs font-medium text-secondary mb-1">Username</label>
            <input 
              id="username" 
              name="username" 
              type="text" 
              required 
              autocomplete="username"
              placeholder="admin"
              class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary placeholder:text-secondary/50 focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing"
            />
          </div>

          <div>
            <label for="password" class="block text-xs font-medium text-secondary mb-1">Password</label>
            <input 
              id="password" 
              name="password" 
              type="password" 
              required 
              autocomplete="current-password"
              placeholder="••••••••••••"
              class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary placeholder:text-secondary/50 focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing"
            />
          </div>

          <button 
            type="submit" 
            id="login-btn"
            class="w-full py-2.5 px-4 bg-accent-orange hover:bg-orange-600 active:bg-orange-700 text-white text-sm font-medium rounded-md transition-colors duration-150 flex items-center justify-center"
          >
            <span>Sign In</span>
          </button>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById('login-form') as HTMLFormElement;
  const errorBox = document.getElementById('login-error') as HTMLElement;
  const submitBtn = document.getElementById('login-btn') as HTMLButtonElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.add('hidden');
    errorBox.textContent = '';
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Verifying...</span>`;

    const username = (document.getElementById('username') as HTMLInputElement).value.trim();
    const password = (document.getElementById('password') as HTMLInputElement).value;

    try {
      const res = await api.login({ username, password });
      localStorage.setItem('axiom_session_token', res.token);
      localStorage.setItem('axiom_username', res.username);
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
