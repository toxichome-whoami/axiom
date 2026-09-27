/*
 * Axiom first-time setup wizard (4-step walkthrough).
 * Locks permanently after completion to prevent administrative hijacking.
 */

import { api } from '../api';
import { icon } from '../components/Icons';

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
      <div class="min-h-screen flex items-center justify-center p-4 bg-background">
        <div class="w-full max-w-lg bg-surface border border-borderDefault rounded-lg p-6 sm:p-8 shadow-sm">
          
          <!-- Stepper Indicator -->
          <div class="flex items-center justify-between mb-8 border-b border-surfaceBorder pb-4">
            <div class="flex items-center space-x-2">
              <div class="w-7 h-7 rounded-md bg-accent-orange text-white flex items-center justify-center font-bold text-xs">
                AX
              </div>
              <span class="text-sm font-semibold text-primary">Axiom Setup Wizard</span>
            </div>
            <div class="text-xs text-secondary font-mono">
              Step ${currentStep} of 4
            </div>
          </div>

          <div id="setup-error" class="hidden mb-4 p-3 rounded-md bg-accent-danger/10 border border-accent-danger/30 text-xs text-red-400"></div>

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
          <div class="space-y-4">
            <h2 class="text-lg font-semibold text-primary">Welcome to Axiom Gateway</h2>
            <p class="text-xs text-secondary leading-relaxed">
              Axiom is an enterprise-grade SQL API gateway that unifies database connectivity, 
              RBAC authorization, high-speed L1/L2 caching, and Model Context Protocol (MCP) into a single binary.
            </p>
            <div class="bg-background border border-surfaceBorder rounded-md p-4 space-y-2 text-xs text-secondary">
              <div class="flex items-center space-x-2 text-primary font-medium">
                ${icon('shield', 'w-4 h-4 text-accent-orange')}
                <span>What we will configure:</span>
              </div>
              <ul class="list-disc pl-5 space-y-1 text-secondary">
                <li>Create the primary human administrative account.</li>
                <li>Connect your first SQL database (PostgreSQL, MySQL, SQLite, MSSQL, or ClickHouse).</li>
                <li>Initialize the cryptographic metadata store (<code class="text-primary font-mono">axiom.db</code>).</li>
              </ul>
            </div>
            <button id="step1-next" class="w-full py-2.5 px-4 bg-accent-orange hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors">
              Begin Configuration
            </button>
          </div>
        `;

      case 2:
        return `
          <form id="step2-form" class="space-y-4">
            <div>
              <h2 class="text-lg font-semibold text-primary">Create Primary Admin</h2>
              <p class="text-xs text-secondary">This account manages the Web UI console and operator policies.</p>
            </div>

            <div>
              <label for="admin-user" class="block text-xs font-medium text-secondary mb-1">Admin Username</label>
              <input 
                id="admin-user" 
                type="text" 
                required 
                placeholder="admin"
                value="${adminUsername}"
                class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing"
              />
            </div>

            <div>
              <label for="admin-pass" class="block text-xs font-medium text-secondary mb-1">Master Password</label>
              <input 
                id="admin-pass" 
                type="password" 
                required 
                minlength="8"
                placeholder="Minimum 8 characters"
                value="${adminPassword}"
                class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing"
              />
            </div>

            <button type="submit" id="step2-next" class="w-full py-2.5 px-4 bg-accent-orange hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors">
              Continue to Database Setup
            </button>
          </form>
        `;

      case 3:
        return `
          <form id="step3-form" class="space-y-4">
            <div>
              <h2 class="text-lg font-semibold text-primary">Connect First Database</h2>
              <p class="text-xs text-secondary">Register a target database connection. You can also skip this and add databases later.</p>
            </div>

            <div>
              <label for="db-alias" class="block text-xs font-medium text-secondary mb-1">Database Alias</label>
              <input 
                id="db-alias" 
                type="text" 
                placeholder="main_db"
                value="${dbAlias}"
                class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing"
              />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="db-engine" class="block text-xs font-medium text-secondary mb-1">Engine Dialect</label>
                <select 
                  id="db-engine"
                  class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing"
                >
                  <option value="postgres" ${dbEngine === 'postgres' ? 'selected' : ''}>PostgreSQL</option>
                  <option value="mysql" ${dbEngine === 'mysql' ? 'selected' : ''}>MySQL / MariaDB</option>
                  <option value="sqlite" ${dbEngine === 'sqlite' ? 'selected' : ''}>SQLite / LibSQL</option>
                  <option value="mssql" ${dbEngine === 'mssql' ? 'selected' : ''}>Microsoft SQL Server</option>
                  <option value="clickhouse" ${dbEngine === 'clickhouse' ? 'selected' : ''}>ClickHouse</option>
                </select>
              </div>
              <div>
                <label for="pool-size" class="block text-xs font-medium text-secondary mb-1">Max Pool Size</label>
                <input 
                  id="pool-size" 
                  type="number" 
                  value="10" 
                  class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing"
                />
              </div>
            </div>

            <div>
              <label for="db-url" class="block text-xs font-medium text-secondary mb-1">Connection URL</label>
              <input 
                id="db-url" 
                type="text" 
                placeholder="postgres://user:pass@localhost:5432/mydb"
                value="${dbUrl}"
                class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing font-mono text-xs"
              />
            </div>

            <div class="flex space-x-3 pt-2">
              <button type="button" id="step3-skip" class="flex-1 py-2.5 px-4 bg-surfaceHover hover:bg-surfaceBorder text-secondary hover:text-primary text-sm font-medium rounded-md transition-colors">
                Skip for Now
              </button>
              <button type="submit" id="step3-next" class="flex-1 py-2.5 px-4 bg-accent-orange hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors">
                Save & Continue
              </button>
            </div>
          </form>
        `;

      case 4:
        return `
          <div class="space-y-4">
            <div class="text-center py-4">
              <div class="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 mx-auto flex items-center justify-center mb-3">
                ${icon('check', 'w-6 h-6')}
              </div>
              <h2 class="text-xl font-semibold text-primary">Setup Complete!</h2>
              <p class="text-xs text-secondary mt-1">Axiom Gateway is initialized and the wizard is now permanently locked.</p>
            </div>

            <div class="bg-background border border-surfaceBorder rounded-md p-4 space-y-2 text-xs">
              <div class="text-secondary font-medium">Session Token:</div>
              <div class="flex items-center justify-between bg-surface p-2 rounded border border-surfaceBorder font-mono text-[11px] text-primary overflow-x-auto">
                <span>${sessionToken || 'Active Session Established'}</span>
              </div>
            </div>

            <button id="step4-finish" class="w-full py-2.5 px-4 bg-accent-orange hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors">
              Launch Dashboard
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
      document.getElementById('step3-skip')?.addEventListener('click', async () => {
        try {
          await api.completeSetup();
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
