/*
 * API key management interface for Machine Data Access.
 * Discloses plaintext key secret only once upon generation with copyable curl snippet.
 */

import { api, ApiKeyRecord, RoleRecord } from '../api';
import { icon } from '../components/Icons';

export async function renderApiKeys(container: HTMLElement) {
  let roles: RoleRecord[] = [];

  container.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">API Keys</h1>
          <p class="text-xs text-secondary mt-0.5">Manage application credentials and granular role assignments.</p>
        </div>
        <button id="open-create-key-modal" class="flex items-center space-x-1.5 px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white rounded-md text-xs font-medium transition-colors">
          ${icon('plus', 'w-3.5 h-3.5')}
          <span>Create Key</span>
        </button>
      </div>

      <!-- Keys Table -->
      <div class="bg-surface border border-surfaceBorder rounded-lg overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs text-secondary">
            <thead class="bg-background text-[11px] font-semibold uppercase tracking-wider text-secondary border-b border-surfaceBorder">
              <tr>
                <th class="py-3 px-4">Key Identifier</th>
                <th class="py-3 px-4">Assigned Role</th>
                <th class="py-3 px-4">Rate Limit</th>
                <th class="py-3 px-4">Expires</th>
                <th class="py-3 px-4">Created</th>
                <th class="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="keys-table-body" class="divide-y divide-surfaceBorder font-mono">
              <tr>
                <td colspan="6" class="py-8 text-center text-secondary">Loading API keys...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Create Key Modal -->
    <div id="create-key-modal" class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-md w-full p-6 space-y-4 shadow-lg">
        <div class="flex items-center justify-between pb-2 border-b border-surfaceBorder">
          <h2 class="text-sm font-semibold text-primary">Generate API Key</h2>
          <button id="close-create-key-modal" class="text-secondary hover:text-primary">
            ${icon('x', 'w-4 h-4')}
          </button>
        </div>

        <div id="create-key-error" class="hidden p-2 rounded bg-accent-danger/10 border border-accent-danger/30 text-xs text-red-400"></div>

        <form id="create-key-form" class="space-y-3 text-xs">
          <div>
            <label class="block text-secondary mb-1">Key Name / Identifier</label>
            <input id="key-name-input" type="text" required placeholder="e.g. backend-microservice" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" />
          </div>

          <div>
            <label class="block text-secondary mb-1">RBAC Role</label>
            <select id="key-role-select" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none">
              <option value="">No Role (Unrestricted or Legacy)</option>
            </select>
          </div>

          <div>
            <label class="block text-secondary mb-1">Rate Limit Override (req/min, 0 = global default)</label>
            <input id="key-rate-input" type="number" value="0" min="0" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" />
          </div>

          <div>
            <label class="block text-secondary mb-1">Custom Secret (optional, auto-generated if blank)</label>
            <input id="key-secret-input" type="password" placeholder="Leave empty for secure random UUID" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" />
          </div>

          <div class="flex justify-end space-x-2 pt-3">
            <button type="button" id="cancel-create-key" class="px-3 py-1.5 bg-surfaceHover hover:bg-surfaceBorder text-secondary rounded-md">Cancel</button>
            <button type="submit" id="submit-create-key" class="px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white font-medium rounded-md">Generate Key</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Secret Disclosure Modal -->
    <div id="secret-modal" class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-lg w-full p-6 space-y-4 shadow-lg">
        <div class="flex items-center space-x-2 text-accent-orange">
          ${icon('shield', 'w-5 h-5')}
          <h2 class="text-sm font-semibold text-primary">Save Your API Key Credentials</h2>
        </div>
        <p class="text-xs text-secondary">
          This is the ONLY time the key secret will ever be displayed. Axiom stores only irreversible BLAKE3 hashes.
        </p>

        <div class="space-y-3">
          <div>
            <label class="block text-[11px] text-secondary font-medium mb-1">Token Header Value (Base64)</label>
            <div class="flex items-center space-x-2 bg-background border border-surfaceBorder rounded-md p-2">
              <input id="secret-token-display" readonly class="w-full bg-transparent text-primary text-xs font-mono focus:outline-none" />
              <button id="copy-token-btn" class="p-1 text-secondary hover:text-primary rounded hover:bg-surfaceHover">
                ${icon('copy', 'w-4 h-4')}
              </button>
            </div>
          </div>

          <div>
            <label class="block text-[11px] text-secondary font-medium mb-1">Example cURL Query</label>
            <div class="bg-background border border-surfaceBorder rounded-md p-2.5 font-mono text-[11px] text-secondary overflow-x-auto relative group">
              <pre id="secret-curl-display" class="whitespace-pre-wrap"></pre>
            </div>
          </div>
        </div>

        <button id="close-secret-modal" class="w-full py-2 bg-accent-orange hover:bg-orange-600 text-white text-xs font-medium rounded-md">
          I Have Saved This Key
        </button>
      </div>
    </div>
  `;

  const createModal = document.getElementById('create-key-modal') as HTMLElement;
  const secretModal = document.getElementById('secret-modal') as HTMLElement;
  const createError = document.getElementById('create-key-error') as HTMLElement;

  async function loadRoles() {
    try {
      roles = await api.getRoles();
      const roleSelect = document.getElementById('key-role-select') as HTMLSelectElement;
      roleSelect.innerHTML = `<option value="">No Role (Unrestricted / Superadmin)</option>` +
        roles.map((r) => `<option value="${r.name}">${r.name} (${r.permissions.length} perms)</option>`).join('');
    } catch {}
  }

  async function loadKeys() {
    const tbody = document.getElementById('keys-table-body') as HTMLElement;
    try {
      const keys = await api.getKeys();
      if (keys.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-secondary">No API keys registered yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = keys.map((k) => `
        <tr class="hover:bg-surfaceHover/50 transition-colors">
          <td class="py-3 px-4 font-semibold text-primary">${k.name}</td>
          <td class="py-3 px-4">
            ${k.role_name 
              ? `<span class="px-2 py-0.5 rounded text-[11px] bg-accent-orange/10 text-accent-orange border border-accent-orange/20">${k.role_name}</span>`
              : `<span class="text-secondary text-[11px]">none</span>`
            }
          </td>
          <td class="py-3 px-4 text-secondary">${k.rate_limit > 0 ? `${k.rate_limit} req/min` : 'global'}</td>
          <td class="py-3 px-4 text-secondary">${k.expires_at ? new Date(k.expires_at * 1000).toLocaleDateString() : 'never'}</td>
          <td class="py-3 px-4 text-secondary">${new Date(k.created_at * 1000).toLocaleDateString()}</td>
          <td class="py-3 px-4 text-right">
            <button data-delete-key="${k.name}" class="p-1 text-secondary hover:text-red-400 rounded hover:bg-surfaceHover transition-colors" title="Revoke API key">
              ${icon('trash', 'w-4 h-4')}
            </button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('[data-delete-key]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const name = (e.currentTarget as HTMLElement).getAttribute('data-delete-key');
          if (name && confirm(`Revoke API key '${name}' immediately?`)) {
            try {
              await api.deleteKey(name);
              loadKeys();
            } catch (err: unknown) {
              alert(err instanceof Error ? err.message : 'Failed to delete');
            }
          }
        });
      });
    } catch {
      tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-red-400">Failed to load API keys.</td></tr>`;
    }
  }

  document.getElementById('open-create-key-modal')?.addEventListener('click', () => {
    createError.classList.add('hidden');
    createModal.classList.remove('hidden');
  });

  const closeCreate = () => createModal.classList.add('hidden');
  document.getElementById('close-create-key-modal')?.addEventListener('click', closeCreate);
  document.getElementById('cancel-create-key')?.addEventListener('click', closeCreate);

  document.getElementById('close-secret-modal')?.addEventListener('click', () => {
    secretModal.classList.add('hidden');
  });

  document.getElementById('copy-token-btn')?.addEventListener('click', () => {
    const input = document.getElementById('secret-token-display') as HTMLInputElement;
    navigator.clipboard.writeText(input.value);
    alert('Token copied to clipboard!');
  });

  document.getElementById('create-key-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    createError.classList.add('hidden');

    const name = (document.getElementById('key-name-input') as HTMLInputElement).value.trim();
    const roleVal = (document.getElementById('key-role-select') as HTMLSelectElement).value;
    const rate_limit = parseInt((document.getElementById('key-rate-input') as HTMLInputElement).value, 10) || 0;
    const secret = (document.getElementById('key-secret-input') as HTMLInputElement).value.trim() || undefined;

    const submitBtn = document.getElementById('submit-create-key') as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Generating...';

    try {
      const res = await api.createKey({ name, role: roleVal || undefined, rate_limit, secret });
      closeCreate();
      loadKeys();

      // Show secret modal
      (document.getElementById('secret-token-display') as HTMLInputElement).value = res.token_header;
      (document.getElementById('secret-curl-display') as HTMLElement).textContent = 
        `curl -X POST http://localhost:4500/api/v1/db/main_db/query \\\n` +
        `  -H "X-Axiom-Key: ${res.token_header}" \\\n` +
        `  -H "Content-Type: application/json" \\\n` +
        `  -d '{"sql": "SELECT 1;"}'`;

      secretModal.classList.remove('hidden');
    } catch (err: unknown) {
      createError.textContent = err instanceof Error ? err.message : 'Failed to create key';
      createError.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Generate Key';
    }
  });

  await loadRoles();
  loadKeys();
}
