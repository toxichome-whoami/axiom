/*
 * API key management interface for Machine Data Access.
 * Discloses plaintext key secret only once upon generation with copyable curl snippet and rotation support.
 */

import { api, ApiKeyRecord, RoleRecord } from '../api';
import { icon } from '../components/Icons';
import { toast, confirmDialog } from '../components/Toast';

export async function renderApiKeys(container: HTMLElement) {
  let roles: RoleRecord[] = [];

  container.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">API Keys</h1>
          <p class="text-xs text-secondary mt-0.5">Manage application credentials, rate limits, and cryptographic rotation.</p>
        </div>
        <button id="open-create-key-modal" class="flex items-center space-x-1.5 px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white rounded-md text-xs font-medium transition-colors shadow-xs">
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
    <div id="create-key-modal" class="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-md w-full p-6 space-y-4 shadow-xl">
        <div class="flex items-center justify-between pb-2 border-b border-surfaceBorder">
          <h2 class="text-sm font-semibold text-primary">Generate API Key</h2>
          <button id="close-create-key-modal" class="text-secondary hover:text-primary p-1">
            ${icon('x', 'w-4 h-4')}
          </button>
        </div>

        <div id="create-key-error" class="hidden p-2 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

        <form id="create-key-form" class="space-y-3.5 text-xs">
          <div>
            <label for="key-name-input" class="block text-secondary mb-1">Key Identifier</label>
            <input 
              id="key-name-input" 
              type="text" 
              required 
              placeholder="e.g. backend-microservice" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" 
            />
          </div>

          <div>
            <label for="key-role-select" class="block text-secondary mb-1">RBAC Role Grant</label>
            <select 
              id="key-role-select" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none"
            >
              <option value="">No Role (Unrestricted Superadmin)</option>
            </select>
          </div>

          <div>
            <label for="key-rate-input" class="block text-secondary mb-1">Rate Limit Override (req/min, 0 = global default)</label>
            <input 
              id="key-rate-input" 
              type="number" 
              value="0" 
              min="0" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" 
            />
          </div>

          <div>
            <label for="key-secret-input" class="block text-secondary mb-1">Custom Secret (optional, auto-generated if blank)</label>
            <input 
              id="key-secret-input" 
              type="password" 
              placeholder="Leave empty for high-entropy BLAKE3 secret" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" 
            />
          </div>

          <div class="flex justify-end space-x-2 pt-3 border-t border-surfaceBorder">
            <button type="button" id="cancel-create-key" class="px-3 py-1.5 bg-surfaceHover hover:bg-surfaceBorder text-secondary hover:text-primary rounded-md transition-colors">
              Cancel
            </button>
            <button type="submit" id="submit-create-key" class="px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white font-medium rounded-md transition-colors">
              Generate Key
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Secret Disclosure Modal -->
    <div id="secret-modal" class="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-lg w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center space-x-2 text-accent-orange">
          ${icon('shield', 'w-5 h-5')}
          <h2 class="text-sm font-semibold text-primary">Save Your API Key Credentials</h2>
        </div>
        <p class="text-xs text-secondary leading-relaxed">
          This is the <span class="text-amber-400 font-semibold">ONLY time</span> the key secret will be displayed. Axiom stores only irreversible BLAKE3 hashes.
        </p>

        <div class="space-y-3">
          <div>
            <label class="block text-[11px] text-secondary font-medium mb-1">X-Axiom-Key Header Value (Base64)</label>
            <div class="flex items-center space-x-2 bg-background border border-surfaceBorder rounded-md p-2">
              <input id="secret-token-display" readonly class="w-full bg-transparent text-primary text-xs font-mono focus:outline-none" />
              <button id="copy-token-btn" class="p-1.5 text-secondary hover:text-primary rounded hover:bg-surfaceHover transition-colors" title="Copy to clipboard">
                ${icon('copy', 'w-4 h-4')}
              </button>
            </div>
          </div>

          <div>
            <label class="block text-[11px] text-secondary font-medium mb-1">Example cURL Query</label>
            <div class="bg-background border border-surfaceBorder rounded-md p-3 font-mono text-[11px] text-secondary overflow-x-auto relative group">
              <pre id="secret-curl-display" class="whitespace-pre-wrap"></pre>
            </div>
          </div>
        </div>

        <button id="close-secret-modal" class="w-full py-2.5 bg-accent-orange hover:bg-orange-600 text-white text-xs font-medium rounded-md transition-colors">
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
      roleSelect.innerHTML = `<option value="">No Role (Unrestricted Superadmin)</option>` +
        roles.map((r) => `<option value="${r.name}">${r.name} (${r.permissions.length} perms)</option>`).join('');
    } catch {}
  }

  function showSecretModal(token: string) {
    (document.getElementById('secret-token-display') as HTMLInputElement).value = token;
    (document.getElementById('secret-curl-display') as HTMLElement).textContent = 
      `curl -X POST http://localhost:4500/api/v1/db/main_db/query \\\n` +
      `  -H "X-Axiom-Key: ${token}" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -d '{"sql": "SELECT 1;"}'`;
    secretModal.classList.remove('hidden');
  }

  async function loadKeys() {
    const tbody = document.getElementById('keys-table-body') as HTMLElement;
    try {
      const keys = await api.getKeys();
      if (keys.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-secondary">No API keys registered yet. Click "Create Key" to generate one.</td></tr>`;
        return;
      }

      tbody.innerHTML = keys.map((k) => `
        <tr class="hover:bg-surfaceHover/40 transition-colors">
          <td class="py-3 px-4 font-semibold text-primary">${k.name}</td>
          <td class="py-3 px-4">
            ${k.role_name 
              ? `<span class="px-2 py-0.5 rounded text-[11px] bg-accent-orange/10 text-accent-orange border border-accent-orange/20">${k.role_name}</span>`
              : `<span class="text-secondary text-[11px]">superadmin</span>`
            }
          </td>
          <td class="py-3 px-4 text-secondary">${k.rate_limit > 0 ? `${k.rate_limit} req/min` : 'global'}</td>
          <td class="py-3 px-4 text-secondary">${k.expires_at ? new Date(k.expires_at * 1000).toLocaleDateString() : 'never'}</td>
          <td class="py-3 px-4 text-secondary">${new Date(k.created_at * 1000).toLocaleDateString()}</td>
          <td class="py-3 px-4 text-right">
            <div class="inline-flex items-center space-x-1">
              <button 
                data-rotate-key="${k.name}" 
                class="px-2 py-1 text-secondary hover:text-accent-orange rounded hover:bg-surfaceHover transition-colors flex items-center space-x-1" 
                title="Rotate secret"
              >
                ${icon('refresh', 'w-3.5 h-3.5')}
                <span class="text-[11px] font-sans">Rotate</span>
              </button>
              <button 
                data-delete-key="${k.name}" 
                class="p-1 text-secondary hover:text-rose-400 rounded hover:bg-surfaceHover transition-colors" 
                title="Revoke key"
              >
                ${icon('trash', 'w-4 h-4')}
              </button>
            </div>
          </td>
        </tr>
      `).join('');

      // Bind Rotate Buttons
      tbody.querySelectorAll('[data-rotate-key]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const name = (e.currentTarget as HTMLElement).getAttribute('data-rotate-key');
          if (!name) return;

          confirmDialog({
            title: `Rotate Secret for '${name}'`,
            message: `Rotating the secret invalidates the existing token immediately. External applications using the current token will receive 401 Unauthorized until updated.`,
            confirmText: 'Rotate Secret',
            danger: true,
            onConfirm: async () => {
              try {
                const res = await api.rotateKey(name);
                toast.success(`Key '${name}' secret rotated successfully`);
                showSecretModal(res.token);
              } catch (err: unknown) {
                toast.error(err instanceof Error ? err.message : 'Rotation failed');
              }
            },
          });
        });
      });

      // Bind Delete Buttons
      tbody.querySelectorAll('[data-delete-key]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const name = (e.currentTarget as HTMLElement).getAttribute('data-delete-key');
          if (!name) return;

          confirmDialog({
            title: `Revoke API Key '${name}'`,
            message: `Revoking this key permanently deletes it. Any clients configured with this key will immediately be rejected.`,
            confirmText: 'Revoke Key',
            danger: true,
            onConfirm: async () => {
              try {
                await api.deleteKey(name);
                toast.success(`API key '${name}' revoked`);
                loadKeys();
              } catch (err: unknown) {
                toast.error(err instanceof Error ? err.message : 'Failed to delete key');
              }
            },
          });
        });
      });
    } catch {
      tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-rose-400">Failed to load API keys.</td></tr>`;
    }
  }

  const closeCreate = () => createModal.classList.add('hidden');
  const openCreate = () => {
    createError.classList.add('hidden');
    createModal.classList.remove('hidden');
    (document.getElementById('key-name-input') as HTMLInputElement)?.focus();
  };

  document.getElementById('open-create-key-modal')?.addEventListener('click', openCreate);
  document.getElementById('close-create-key-modal')?.addEventListener('click', closeCreate);
  document.getElementById('cancel-create-key')?.addEventListener('click', closeCreate);

  createModal.addEventListener('click', (e) => {
    if (e.target === createModal) closeCreate();
  });

  const closeSecret = () => secretModal.classList.add('hidden');
  document.getElementById('close-secret-modal')?.addEventListener('click', closeSecret);
  secretModal.addEventListener('click', (e) => {
    if (e.target === secretModal) closeSecret();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (!createModal.classList.contains('hidden')) closeCreate();
      if (!secretModal.classList.contains('hidden')) closeSecret();
    }
  };
  window.addEventListener('keydown', onKey);

  document.getElementById('copy-token-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('secret-token-display') as HTMLInputElement;
    await navigator.clipboard.writeText(input.value);
    toast.success('Token copied to clipboard');
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
      toast.success(`Key '${name}' generated`);
      closeCreate();
      loadKeys();
      showSecretModal(res.token_header);
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
