/*
 * Axiom first-time setup wizard (4-step walkthrough).
 * Ported from binary_alive Setup / Wizard architecture (Cloudflare & Vercel design system).
 * Locks permanently after completion to prevent administrative hijacking.
 */

import { api } from '../api';
import { icon } from '../components/Icons';
import { toast } from '../components/Toast';

export function renderSetup(container: HTMLElement) {
  let currentStep = 1;
  let adminUsername = '';
  let adminPassword = '';
  let dbAlias = '';
  let dbUrl = '';
  let dbEngine = 'postgres';
  let sessionToken = '';

  function render() {
    container.innerHTML = `
      <div class="min-h-screen flex items-center justify-center p-4 bg-[#000000] select-none font-sans">
        <div class="w-full max-w-lg bg-[#0e0e0e] border border-[#262626] rounded-xl p-6 sm:p-8 shadow-2xl space-y-6 animate-in fade-in zoom-in-95">
          
          <!-- Stepper Indicator -->
          <div class="flex items-center justify-between border-b border-[#222222] pb-4">
            <div class="flex items-center gap-2.5">
              <div class="size-7 rounded-[4px] bg-[#f38020] text-white flex items-center justify-center font-bold text-xs tracking-wider shadow-xs">
                AX
              </div>
              <span class="text-sm font-semibold text-white">Axiom Setup Wizard</span>
            </div>
            <div class="text-xs text-[#8c8c8c] font-mono">
              Step ${currentStep} of 4
            </div>
          </div>

          <div id="setup-error" class="hidden p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

          ${renderStepContent()}

        </div>
      </div>
    `;

    bindEvents();
  }

  function renderStepContent(): string {
    switch (currentStep) {
      case 1:
        return `
          <div class="space-y-4 text-xs">
            <h2 class="text-lg font-semibold text-white">Welcome to Axiom Gateway</h2>
            <p class="text-xs text-[#8c8c8c] leading-relaxed">
              Axiom is a high-performance SQL API gateway that unifies connection pooling, 
              RBAC authorization, high-speed L1/L2 caching, and Model Context Protocol (MCP) into a single binary.
            </p>
            <div class="bg-[#141414] border border-[#262626] rounded-lg p-4 space-y-2 text-[#8c8c8c]">
              <div class="flex items-center gap-2 text-white font-medium">
                ${icon('shield', 'w-4 h-4 text-[#f38020]')}
                <span>What we will configure:</span>
              </div>
              <ul class="list-disc pl-5 space-y-1.5 pt-1 text-[#cccccc]">
                <li>Create the primary administrative owner account.</li>
                <li>Connect your first upstream SQL database (PostgreSQL, MySQL, SQLite, MSSQL, ClickHouse).</li>
                <li>Bootstrap the persistent cryptographic metadata store (<code class="text-white font-mono">axiom.db</code>).</li>
              </ul>
            </div>
            <button id="step1-next" class="w-full h-9 bg-[#f38020] hover:bg-[#e07018] text-white text-xs font-medium rounded-lg transition-colors shadow-xs cursor-pointer">
              Begin Configuration &rarr;
            </button>
          </div>
        `;

      case 2:
        return `
          <form id="step2-form" class="space-y-4 text-xs">
            <div>
              <h2 class="text-lg font-semibold text-white">Create Primary Administrator</h2>
              <p class="text-xs text-[#8c8c8c] mt-0.5">This account owns and manages the Web UI console and operator policies.</p>
            </div>

            <div>
              <label for="admin-user" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Admin Username</label>
              <input 
                id="admin-user" 
                type="text" 
                required 
                placeholder="admin"
                value="${adminUsername}"
                class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
              />
            </div>

            <div>
              <label for="admin-pass" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Master Password</label>
              <input 
                id="admin-pass" 
                type="password" 
                required 
                minlength="8"
                placeholder="Minimum 8 characters"
                value="${adminPassword}"
                class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
              />
            </div>

            <button type="submit" id="step2-next" class="w-full h-9 bg-[#f38020] hover:bg-[#e07018] text-white text-xs font-medium rounded-lg transition-colors shadow-xs cursor-pointer">
              Continue to Database Setup &rarr;
            </button>
          </form>
        `;

      case 3:
        return `
          <form id="step3-form" class="space-y-4 text-xs">
            <div>
              <h2 class="text-lg font-semibold text-white">Connect First Database</h2>
              <p class="text-xs text-[#8c8c8c] mt-0.5">Register an upstream SQL database pool. You can also skip this and add databases later.</p>
            </div>

            <div>
              <label for="db-alias" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Database Alias</label>
              <input 
                id="db-alias" 
                type="text" 
                placeholder="main_db"
                value="${dbAlias}"
                class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors font-mono"
              />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="db-engine" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Engine Dialect</label>
                <select 
                  id="db-engine"
                  class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white focus:border-[#3b82f6] outline-none transition-colors"
                >
                  <option value="postgres" ${dbEngine === 'postgres' ? 'selected' : ''}>PostgreSQL</option>
                  <option value="mysql" ${dbEngine === 'mysql' ? 'selected' : ''}>MySQL / MariaDB</option>
                  <option value="sqlite" ${dbEngine === 'sqlite' ? 'selected' : ''}>SQLite / LibSQL</option>
                  <option value="mssql" ${dbEngine === 'mssql' ? 'selected' : ''}>Microsoft SQL Server</option>
                  <option value="clickhouse" ${dbEngine === 'clickhouse' ? 'selected' : ''}>ClickHouse</option>
                </select>
              </div>
              <div>
                <label for="pool-size" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Max Connections</label>
                <input 
                  id="pool-size" 
                  type="number" 
                  value="10" 
                  class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white font-mono focus:border-[#3b82f6] outline-none transition-colors"
                />
              </div>
            </div>

            <div>
              <label for="db-url" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Connection URL</label>
              <input 
                id="db-url" 
                type="text" 
                placeholder="postgres://user:pass@localhost:5432/mydb"
                value="${dbUrl}"
                class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors font-mono"
              />
            </div>

            <div class="flex gap-2.5 pt-2">
              <button type="button" id="step3-skip" class="flex-1 h-9 bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-[#cccccc] hover:text-white text-xs font-medium rounded-lg transition-colors cursor-pointer">
                Skip for Now
              </button>
              <button type="submit" id="step3-next" class="flex-1 h-9 bg-[#f38020] hover:bg-[#e07018] text-white text-xs font-medium rounded-lg transition-colors shadow-xs cursor-pointer">
                Save & Continue
              </button>
            </div>
          </form>
        `;

      case 4:
        return `
          <div class="space-y-4 text-xs">
            <div class="text-center py-4">
              <div class="size-12 rounded-full bg-emerald-500/10 text-emerald-400 mx-auto flex items-center justify-center mb-3">
                ${icon('check', 'w-6 h-6')}
              </div>
              <h2 class="text-xl font-semibold text-white">Setup Complete!</h2>
              <p class="text-xs text-[#8c8c8c] mt-1">Axiom Gateway is initialized and the wizard is now permanently locked.</p>
            </div>

            <div class="bg-[#141414] border border-[#262626] rounded-lg p-4 space-y-2">
              <div class="text-[#8c8c8c] font-medium">Session Token:</div>
              <div class="flex items-center justify-between bg-[#0e0e0e] p-2.5 rounded border border-[#262626] font-mono text-[11px] text-white overflow-x-auto">
                <span class="truncate">${sessionToken || 'Active Session Established'}</span>
              </div>
            </div>

            <button id="step4-finish" class="w-full h-9 bg-[#f38020] hover:bg-[#e07018] text-white text-xs font-medium rounded-lg transition-colors shadow-xs cursor-pointer">
              Launch Gateway Dashboard &rarr;
            </button>
          </div>
        `;
      default:
        return '';
    }
  }

  function bindEvents() {
    const errorBox = document.getElementById('setup-error') as HTMLElement;

    if (currentStep === 1) {
      document.getElementById('step1-next')?.addEventListener('click', () => {
        currentStep = 2;
        render();
      });
    } else if (currentStep === 2) {
      (document.getElementById('admin-user') as HTMLInputElement)?.focus();

      document.getElementById('step2-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        adminUsername = (document.getElementById('admin-user') as HTMLInputElement).value.trim();
        adminPassword = (document.getElementById('admin-pass') as HTMLInputElement).value;

        const nextBtn = document.getElementById('step2-next') as HTMLButtonElement;
        nextBtn.disabled = true;
        nextBtn.textContent = 'Creating Account...';

        try {
          const res = await api.createAdminAccount({ username: adminUsername, password: adminPassword });
          sessionToken = res.token;
          localStorage.setItem('axiom_session_token', res.token);
          localStorage.setItem('axiom_username', res.username);
          toast.success('Admin account created');
          currentStep = 3;
          render();
        } catch (err: unknown) {
          errorBox.textContent = err instanceof Error ? err.message : 'Account creation failed';
          errorBox.classList.remove('hidden');
          nextBtn.disabled = false;
          nextBtn.textContent = 'Continue to Database Setup';
        }
      });
    } else if (currentStep === 3) {
      (document.getElementById('db-alias') as HTMLInputElement)?.focus();

      document.getElementById('step3-skip')?.addEventListener('click', async () => {
        try {
          await api.completeSetup();
          toast.info('Database setup skipped');
          currentStep = 4;
          render();
        } catch {
          currentStep = 4;
          render();
        }
      });

      document.getElementById('step3-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        dbAlias = (document.getElementById('db-alias') as HTMLInputElement).value.trim();
        dbEngine = (document.getElementById('db-engine') as HTMLSelectElement).value;
        dbUrl = (document.getElementById('db-url') as HTMLInputElement).value.trim();

        if (dbAlias && dbUrl) {
          try {
            await api.setupDatabase({ alias: dbAlias, url: dbUrl, engine: dbEngine });
            toast.success(`Connected database '${dbAlias}'`);
          } catch (err: unknown) {
            errorBox.textContent = err instanceof Error ? err.message : 'Failed to register database';
            errorBox.classList.remove('hidden');
            return;
          }
        }

        try {
          await api.completeSetup();
        } catch {}

        currentStep = 4;
        render();
      });
    } else if (currentStep === 4) {
      document.getElementById('step4-finish')?.addEventListener('click', () => {
        window.location.hash = '#/overview';
      });
    }
  }

  render();
}
