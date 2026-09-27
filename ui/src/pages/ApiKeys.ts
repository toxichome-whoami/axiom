/*
 * API key management interface for Machine Data Access.
 * Ported from binary_alive ApiKeys page & Cloudflare DataTable pattern.
 * Discloses plaintext key secret only once upon generation with copyable curl snippet and rotation support.
 */

import { api, ApiKeyRecord, RoleRecord } from '../api';
import { icon } from '../components/Icons';
import { toast, confirmDialog } from '../components/Toast';

export async function renderApiKeys(container: HTMLElement) {
  let allKeys: ApiKeyRecord[] = [];
  let roles: RoleRecord[] = [];
  let searchQuery = '';

  container.innerHTML = `
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Header & Actions -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-xl font-semibold text-white tracking-tight">API Keys</h1>
            <span id="keys-count-badge" class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#141414] border border-[#262626] text-[#8c8c8c]">0 keys</span>
          </div>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Manage application credentials, rate limits, and cryptographic rotation.</p>
        </div>

        <div class="flex items-center gap-2.5">
          <!-- Search input -->
          <div class="relative w-48 sm:w-64">
            <span class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#8c8c8c]">
              ${icon('search', 'w-3.5 h-3.5 opacity-60')}
            </span>
            <input
              id="keys-search-input"
              type="text"
              placeholder="Filter keys..."
              class="w-full h-8 pl-8 pr-3 rounded-lg bg-[#0c0c0c] border border-[#262626] text-xs text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
            />
          </div>

          <button 
            id="open-create-key-modal" 
            type="button"
            class="flex items-center gap-1.5 px-3 h-8 bg-[#f38020] hover:bg-[#e07018] text-white rounded-lg text-xs font-medium transition-colors shadow-xs cursor-pointer shrink-0"
          >
            ${icon('plus', 'w-3.5 h-3.5')}
            <span>Create Key</span>
          </button>
        </div>
      </div>

      <!-- Keys Table Container in Cloudflare DataTable Pattern -->
      <div class="border border-[#262626] rounded-lg overflow-hidden bg-[#0e0e0e] flex flex-col text-[14px]">
        <div class="overflow-x-auto w-full">
          <table class="w-full text-left border-collapse min-w-[700px]">
            <thead class="sticky top-0 z-10">
              <tr class="border-b border-[#222222] bg-[#141414] h-[40px] text-[13px] font-medium text-white">
                <th class="px-4">Key Identifier</th>
                <th class="px-4">Assigned Role</th>
                <th class="px-4">Rate Limit</th>
                <th class="px-4">Expiration</th>
                <th class="px-4">Created</th>
                <th class="px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="keys-table-body" class="divide-y divide-[#1e1e1e] text-[13px] text-[#cccccc]">
              <tr>
                <td colspan="6" class="px-4 py-12 text-center text-xs text-[#666666]">
                  <div class="h-4 w-1/3 mx-auto rounded bg-[#1a1a1a] animate-pulse"></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Table Footer -->
        <div class="flex items-center justify-between px-4 py-2.5 border-t border-[#222222] bg-[#0e0e0e] text-[12px] text-[#8c8c8c]">
          <span id="keys-footer-status">Showing API keys</span>
          <span class="font-mono text-[11px] text-[#666666]">BLAKE3 Hashed</span>
        </div>
      </div>
    </div>

    <!-- Create Key Modal -->
    <div id="create-key-modal" class="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden select-none animate-in fade-in">
      <div class="bg-[#0e0e0e] border border-[#262626] rounded-lg max-w-md w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between pb-3 border-b border-[#222222]">
          <div class="flex items-center gap-2">
            <span class="p-1.5 rounded-md bg-[#f38020]/10 text-[#f38020]">
              ${icon('key', 'w-4 h-4')}
            </span>
            <h2 class="text-sm font-semibold text-white">Generate Client API Key</h2>
          </div>
          <button id="close-create-key-modal" class="text-[#8c8c8c] hover:text-white p-1 cursor-pointer">
            ${icon('x', 'w-4 h-4')}
          </button>
        </div>

        <div id="create-key-error" class="hidden p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

        <form id="create-key-form" class="space-y-4 text-xs">
          <div>
            <label for="key-name-input" class="block text-[#8c8c8c] mb-1 font-medium">Key Identifier</label>
            <input 
              id="key-name-input" 
              type="text" 
              required 
              placeholder="e.g. backend-microservice" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] font-mono text-xs focus:border-[#3b82f6] outline-none transition-colors" 
            />
          </div>

          <div>
            <label for="key-role-select" class="block text-[#8c8c8c] mb-1 font-medium">RBAC Role Grant</label>
            <select 
              id="key-role-select" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white focus:border-[#3b82f6] outline-none text-xs transition-colors"
            >
              <option value="">No Role (Unrestricted Superadmin)</option>
            </select>
          </div>

          <div>
            <label for="key-rate-input" class="block text-[#8c8c8c] mb-1 font-medium">Rate Limit Override (req/min, 0 = global default)</label>
            <input 
              id="key-rate-input" 
              type="number" 
              value="0" 
              min="0" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white font-mono text-xs focus:border-[#3b82f6] outline-none transition-colors" 
            />
          </div>

          <div>
            <label for="key-secret-input" class="block text-[#8c8c8c] mb-1 font-medium">Custom Secret (optional, auto-generated if blank)</label>
            <input 
              id="key-secret-input" 
              type="password" 
              placeholder="Leave empty for high-entropy BLAKE3 secret" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] font-mono text-xs focus:border-[#3b82f6] outline-none transition-colors" 
            />
          </div>

          <div class="flex justify-end gap-2 pt-3 border-t border-[#222222]">
            <button type="button" id="cancel-create-key" class="h-8 px-3 rounded-lg bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-[#cccccc] hover:text-white font-medium transition-colors cursor-pointer">
              Cancel
            </button>
            <button type="submit" id="submit-create-key" class="h-8 px-3.5 rounded-lg bg-[#f38020] hover:bg-[#e07018] text-white font-medium transition-colors shadow-xs cursor-pointer">
              Generate Key
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Secret Disclosure Modal -->
    <div id="secret-modal" class="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden select-none animate-in fade-in">
      <div class="bg-[#0e0e0e] border border-[#262626] rounded-lg max-w-lg w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center gap-2.5 text-[#f38020] pb-2 border-b border-[#222222]">
          ${icon('shield', 'w-5 h-5')}
          <h2 class="text-sm font-semibold text-white">Save API Key Credentials</h2>
        </div>
        <p class="text-xs text-[#8c8c8c] leading-relaxed">
          This is the <span class="text-amber-400 font-semibold">ONLY time</span> the key secret will be displayed. Axiom stores only irreversible BLAKE3 hashes.
        </p>

        <div class="space-y-3.5">
          <div>
            <label class="block text-[11px] text-[#8c8c8c] font-medium mb-1">X-Axiom-Key Header Value (Base64)</label>
            <div class="flex items-center gap-2 bg-[#141414] border border-[#262626] rounded-lg p-2">
              <input id="secret-token-display" readonly class="w-full bg-transparent text-white text-xs font-mono focus:outline-none" />
              <button id="copy-token-btn" class="h-7 px-2.5 rounded bg-[#1f1f1f] hover:bg-[#282828] text-xs text-[#cccccc] hover:text-white transition-colors flex items-center gap-1 cursor-pointer" title="Copy to clipboard">
                ${icon('copy', 'w-3.5 h-3.5')}
                <span id="copy-btn-text">Copy</span>
              </button>
            </div>
          </div>

          <div>
            <label class="block text-[11px] text-[#8c8c8c] font-medium mb-1">Example cURL Query</label>
            <div class="bg-[#0a0a0b] border border-[#222222] rounded-lg p-3 font-mono text-xs text-[#cccccc] overflow-x-auto">
              <pre id="secret-curl-display" class="whitespace-pre-wrap"></pre>
            </div>
          </div>
        </div>

        <button id="close-secret-modal" class="w-full h-9 bg-[#f38020] hover:bg-[#e07018] text-white text-xs font-medium rounded-lg transition-colors cursor-pointer shadow-xs">
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
      if (roleSelect) {
        roleSelect.innerHTML =
          `<option value="">No Role (Unrestricted Superadmin)</option>` +
          roles.map((r) => `<option value="${r.name}">${r.name} (${r.permissions.length} perms)</option>`).join('');
      }
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

  function renderTableRows(keys: ApiKeyRecord[]) {
    const tbody = document.getElementById('keys-table-body') as HTMLElement;
    const countBadge = document.getElementById('keys-count-badge') as HTMLElement;
    const footerStatus = document.getElementById('keys-footer-status') as HTMLElement;

    if (countBadge) countBadge.textContent = `${allKeys.length} key${allKeys.length === 1 ? '' : 's'}`;

    if (keys.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="px-4 py-12 text-center text-xs text-[#666666]">
            ${searchQuery ? `No keys match "${searchQuery}".` : 'No API keys registered yet. Click "Create Key" to generate one.'}
          </td>
        </tr>
      `;
      if (footerStatus) footerStatus.textContent = 'Showing 0 keys';
      return;
    }

    if (footerStatus) footerStatus.textContent = `Showing ${keys.length} of ${allKeys.length} key${allKeys.length === 1 ? '' : 's'}`;

    tbody.innerHTML = keys
      .map(
        (k) => `
      <tr class="h-[44px] hover:bg-[#161616] transition-colors">
        <td class="px-4 py-2 font-mono font-medium text-white text-xs">
          <div class="flex items-center gap-2">
            ${icon('key', 'w-3.5 h-3.5 text-[#f38020]')}
            <span>${k.name}</span>
          </div>
        </td>
        <td class="px-4 py-2">
          ${
            k.role_name
              ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#141414] text-[#f38020] border border-[#262626]">${k.role_name}</span>`
              : `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#141414] text-[#8c8c8c] border border-[#262626]">superadmin</span>`
          }
        </td>
        <td class="px-4 py-2 font-mono text-xs text-[#8c8c8c]">
          ${k.rate_limit > 0 ? `${k.rate_limit} req/min` : '<span class="text-[#666666]">global</span>'}
        </td>
        <td class="px-4 py-2 font-mono text-xs text-[#8c8c8c]">
          ${k.expires_at ? new Date(k.expires_at * 1000).toLocaleDateString() : '<span class="text-[#666666]">never</span>'}
        </td>
        <td class="px-4 py-2 font-mono text-xs text-[#8c8c8c]">
          ${new Date(k.created_at * 1000).toLocaleDateString()}
        </td>
        <td class="px-4 py-2 text-right">
          <div class="inline-flex items-center gap-1.5 justify-end">
            <button 
              data-rotate-key="${k.name}" 
              class="h-7 px-2.5 rounded bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] text-xs font-medium text-[#cccccc] hover:text-white transition-colors flex items-center gap-1 cursor-pointer" 
              title="Rotate secret"
            >
              ${icon('refresh', 'w-3 h-3 text-[#f38020]')}
              <span>Rotate</span>
            </button>
            <button 
              data-delete-key="${k.name}" 
              class="size-7 rounded bg-[#141414] hover:bg-rose-500/20 border border-[#262626] hover:border-rose-500/30 text-[#8c8c8c] hover:text-rose-400 transition-colors flex items-center justify-center cursor-pointer" 
              title="Revoke key"
            >
              ${icon('trash', 'w-3.5 h-3.5')}
            </button>
          </div>
        </td>
      </tr>
    `
      )
      .join('');

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
          message: `Are you sure you want to permanently revoke API key '${name}'? This cannot be undone.`,
          confirmText: 'Revoke Key',
          danger: true,
          onConfirm: async () => {
            try {
              await api.deleteKey(name);
              toast.success(`API key '${name}' revoked`);
              loadKeys();
            } catch (err: unknown) {
              toast.error(err instanceof Error ? err.message : 'Failed to revoke key');
            }
          },
        });
      });
    });
  }

  async function loadKeys() {
    try {
      allKeys = await api.getKeys();
      applyFilter();
    } catch {
      const tbody = document.getElementById('keys-table-body') as HTMLElement;
      tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-rose-400 text-xs">Failed to load API keys.</td></tr>`;
    }
  }

  function applyFilter() {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q ? allKeys.filter((k) => k.name.toLowerCase().includes(q)) : allKeys;
    renderTableRows(filtered);
  }

  document.getElementById('keys-search-input')?.addEventListener('input', (e) => {
    searchQuery = (e.target as HTMLInputElement).value;
    applyFilter();
  });

  const openCreateModal = () => {
    createError.classList.add('hidden');
    createModal.classList.remove('hidden');
    (document.getElementById('key-name-input') as HTMLInputElement)?.focus();
  };

  const closeCreateModal = () => createModal.classList.add('hidden');
  const closeSecret = () => secretModal.classList.add('hidden');

  document.getElementById('open-create-key-modal')?.addEventListener('click', openCreateModal);
  document.getElementById('close-create-key-modal')?.addEventListener('click', closeCreateModal);
  document.getElementById('cancel-create-key')?.addEventListener('click', closeCreateModal);
  document.getElementById('close-secret-modal')?.addEventListener('click', closeSecret);

  createModal.addEventListener('click', (e) => {
    if (e.target === createModal) closeCreateModal();
  });

  secretModal.addEventListener('click', (e) => {
    if (e.target === secretModal) closeSecret();
  });

  document.getElementById('copy-token-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('secret-token-display') as HTMLInputElement;
    const copyText = document.getElementById('copy-btn-text') as HTMLElement;
    try {
      await navigator.clipboard.writeText(input.value);
      toast.success('API key copied to clipboard');
      if (copyText) copyText.textContent = 'Copied!';
      setTimeout(() => {
        if (copyText) copyText.textContent = 'Copy';
      }, 2000);
    } catch {
      input.select();
      document.execCommand('copy');
      toast.info('Copied via fallback');
    }
  });

  document.getElementById('create-key-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    createError.classList.add('hidden');
    const name = (document.getElementById('key-name-input') as HTMLInputElement).value.trim();
    const role_name = (document.getElementById('key-role-select') as HTMLSelectElement).value || null;
    const rate_limit = parseInt((document.getElementById('key-rate-input') as HTMLInputElement).value, 10) || 0;
    const secret = (document.getElementById('key-secret-input') as HTMLInputElement).value || undefined;

    const submitBtn = document.getElementById('submit-create-key') as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Generating...';

    try {
      const res = await api.createKey({ name, role: role_name || undefined, rate_limit, secret });
      toast.success(`Key '${name}' created`);
      closeCreateModal();
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
  await loadKeys();
}
