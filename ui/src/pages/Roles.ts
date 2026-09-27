/*
 * RBAC Role and Policy management interface.
 * Ported from binary_alive DataTable & PermissionTable architecture.
 * Configures fine-grained database, table, and operation permission matrices.
 */

import { api, RoleRecord, PermissionRecord } from '../api';
import { icon } from '../components/Icons';
import { toast, confirmDialog } from '../components/Toast';

export async function renderRoles(container: HTMLElement) {
  let pendingPermissions: PermissionRecord[] = [];
  let allRoles: RoleRecord[] = [];
  let searchQuery = '';

  container.innerHTML = `
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Header & Action Controls -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-xl font-semibold text-white tracking-tight">Roles & RBAC</h1>
            <span id="roles-count-badge" class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#141414] border border-[#262626] text-[#8c8c8c]">0 roles</span>
          </div>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Define access control policies and granular SQL operation permissions.</p>
        </div>

        <div class="flex items-center gap-2.5">
          <!-- Search input -->
          <div class="relative w-48 sm:w-64">
            <span class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#8c8c8c]">
              ${icon('search', 'w-3.5 h-3.5 opacity-60')}
            </span>
            <input
              id="roles-search-input"
              type="text"
              placeholder="Filter roles..."
              class="w-full h-8 pl-8 pr-3 rounded-lg bg-[#0c0c0c] border border-[#262626] text-xs text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
            />
          </div>

          <button 
            id="open-create-role-modal" 
            type="button"
            class="flex items-center gap-1.5 px-3 h-8 bg-[#f38020] hover:bg-[#e07018] text-white rounded-lg text-xs font-medium transition-colors shadow-xs cursor-pointer shrink-0"
          >
            ${icon('plus', 'w-3.5 h-3.5')}
            <span>Create Role</span>
          </button>
        </div>
      </div>

      <!-- Roles Table Container in Cloudflare DataTable Pattern -->
      <div class="border border-[#262626] rounded-lg overflow-hidden bg-[#0e0e0e] flex flex-col text-[14px]">
        <div class="overflow-x-auto w-full">
          <table class="w-full text-left border-collapse min-w-[700px]">
            <thead class="sticky top-0 z-10">
              <tr class="border-b border-[#222222] bg-[#141414] h-[40px] text-[13px] font-medium text-white">
                <th class="px-4">Role Identifier</th>
                <th class="px-4">Description</th>
                <th class="px-4">Permission Rules</th>
                <th class="px-4">Created Date</th>
                <th class="px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="roles-table-body" class="divide-y divide-[#1e1e1e] text-[13px] text-[#cccccc]">
              <tr>
                <td colspan="5" class="px-4 py-12 text-center text-xs text-[#666666]">
                  <div class="h-4 w-1/3 mx-auto rounded bg-[#1a1a1a] animate-pulse"></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Table Footer -->
        <div class="flex items-center justify-between px-4 py-2.5 border-t border-[#222222] bg-[#0e0e0e] text-[12px] text-[#8c8c8c]">
          <span id="roles-footer-status">Showing roles</span>
          <span class="font-mono text-[11px] text-[#666666]">ArcSwap Policy Engine</span>
        </div>
      </div>
    </div>

    <!-- Create Role Modal -->
    <div id="create-role-modal" class="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden select-none animate-in fade-in">
      <div class="bg-[#0e0e0e] border border-[#262626] rounded-lg max-w-lg w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-3 border-b border-[#222222]">
          <div class="flex items-center gap-2">
            <span class="p-1.5 rounded-md bg-[#f38020]/10 text-[#f38020]">
              ${icon('shield', 'w-4 h-4')}
            </span>
            <h2 class="text-sm font-semibold text-white">Create Access Role</h2>
          </div>
          <button id="close-create-role-modal" class="text-[#8c8c8c] hover:text-white p-1 cursor-pointer">
            ${icon('x', 'w-4 h-4')}
          </button>
        </div>

        <div id="create-role-error" class="hidden p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

        <form id="create-role-form" class="space-y-4 text-xs">
          <div>
            <label for="role-name-input" class="block text-[#8c8c8c] mb-1 font-medium">Role Identifier</label>
            <input 
              id="role-name-input" 
              type="text" 
              required 
              placeholder="e.g. read_only_analyst" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white font-mono text-xs focus:border-[#3b82f6] outline-none transition-colors" 
            />
          </div>

          <div>
            <label for="role-desc-input" class="block text-[#8c8c8c] mb-1 font-medium">Description</label>
            <input 
              id="role-desc-input" 
              type="text" 
              placeholder="e.g. Read-only access to customer analytics" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white text-xs focus:border-[#3b82f6] outline-none transition-colors" 
            />
          </div>

          <!-- Permission Rule Builder matching binary_alive PermissionTable -->
          <div class="border border-[#262626] rounded-lg p-4 bg-[#141414] space-y-3.5">
            <div class="font-medium text-white text-xs flex items-center justify-between">
              <span>Rule Builder</span>
              <span class="text-[11px] text-[#8c8c8c] font-mono">Wildcard * supported</span>
            </div>
            
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="perm-db-input" class="block text-[#8c8c8c] text-[11px] mb-1 font-medium">Database Target</label>
                <input id="perm-db-input" type="text" value="*" class="w-full h-8 px-2.5 bg-[#0e0e0e] border border-[#262626] rounded text-white font-mono text-xs focus:outline-none focus:border-[#3b82f6]" />
              </div>
              <div>
                <label for="perm-table-input" class="block text-[#8c8c8c] text-[11px] mb-1 font-medium">Table Target</label>
                <input id="perm-table-input" type="text" value="*" class="w-full h-8 px-2.5 bg-[#0e0e0e] border border-[#262626] rounded text-white font-mono text-xs focus:outline-none focus:border-[#3b82f6]" />
              </div>
            </div>

            <div>
              <label class="block text-[#8c8c8c] text-[11px] mb-2 font-medium">Permitted Operations</label>
              <div class="flex items-center gap-4 font-mono">
                <label class="flex items-center gap-1.5 cursor-pointer text-[#cccccc] hover:text-white">
                  <input type="checkbox" id="op-select" checked class="rounded border-[#262626] bg-[#0e0e0e] text-[#f38020] focus:ring-0" />
                  <span class="text-[11px]">SELECT</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer text-[#cccccc] hover:text-white">
                  <input type="checkbox" id="op-insert" class="rounded border-[#262626] bg-[#0e0e0e] text-[#f38020] focus:ring-0" />
                  <span class="text-[11px]">INSERT</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer text-[#cccccc] hover:text-white">
                  <input type="checkbox" id="op-update" class="rounded border-[#262626] bg-[#0e0e0e] text-[#f38020] focus:ring-0" />
                  <span class="text-[11px]">UPDATE</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer text-[#cccccc] hover:text-white">
                  <input type="checkbox" id="op-delete" class="rounded border-[#262626] bg-[#0e0e0e] text-[#f38020] focus:ring-0" />
                  <span class="text-[11px]">DELETE</span>
                </label>
              </div>
            </div>

            <button type="button" id="add-perm-rule-btn" class="w-full h-8 bg-[#1f1f1f] hover:bg-[#282828] text-white border border-[#262626] rounded-lg text-xs font-medium transition-colors cursor-pointer">
              + Append Rule to Role
            </button>

            <!-- Pending Rules List -->
            <div id="pending-rules-container" class="space-y-1.5 pt-2 border-t border-[#222222]">
              <div class="text-[11px] text-[#8c8c8c]">No rules appended yet. Minimum 1 rule required.</div>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-3 border-t border-[#222222]">
            <button type="button" id="cancel-create-role" class="h-8 px-3 rounded-lg bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-[#cccccc] hover:text-white font-medium transition-colors cursor-pointer">
              Cancel
            </button>
            <button type="submit" id="submit-create-role" class="h-8 px-3.5 rounded-lg bg-[#f38020] hover:bg-[#e07018] text-white font-medium transition-colors shadow-xs cursor-pointer">
              Save Role
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  const modal = document.getElementById('create-role-modal') as HTMLElement;
  const modalError = document.getElementById('create-role-error') as HTMLElement;

  function updatePendingRulesList() {
    const rulesList = document.getElementById('pending-rules-container') as HTMLElement;
    if (pendingPermissions.length === 0) {
      rulesList.innerHTML = `<div class="text-[11px] text-[#8c8c8c]">No rules appended yet. Minimum 1 rule required.</div>`;
      return;
    }

    rulesList.innerHTML = pendingPermissions
      .map(
        (p, idx) => `
      <div class="flex items-center justify-between p-2 rounded bg-[#0e0e0e] border border-[#262626] text-[11px] font-mono">
        <div>
          <span class="text-[#3b82f6]">${p.database}</span>.<span class="text-white">${p.table_name}</span> &rarr;
          <span class="text-[#f38020] font-semibold">[${p.operations.join(', ')}]</span>
        </div>
        <button type="button" data-remove-rule="${idx}" class="text-[#8c8c8c] hover:text-rose-400 p-0.5 cursor-pointer" title="Remove rule">
          ${icon('x', 'w-3.5 h-3.5')}
        </button>
      </div>
    `
      )
      .join('');

    rulesList.querySelectorAll('[data-remove-rule]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-remove-rule') || '0', 10);
        pendingPermissions.splice(idx, 1);
        updatePendingRulesList();
      });
    });
  }

  function renderTableRows(roles: RoleRecord[]) {
    const tbody = document.getElementById('roles-table-body') as HTMLElement;
    const countBadge = document.getElementById('roles-count-badge') as HTMLElement;
    const footerStatus = document.getElementById('roles-footer-status') as HTMLElement;

    if (countBadge) countBadge.textContent = `${allRoles.length} role${allRoles.length === 1 ? '' : 's'}`;

    if (roles.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="px-4 py-12 text-center text-xs text-[#666666]">
            ${searchQuery ? `No roles match "${searchQuery}".` : 'No custom roles created yet. Click "Create Role" to establish policies.'}
          </td>
        </tr>
      `;
      if (footerStatus) footerStatus.textContent = 'Showing 0 roles';
      return;
    }

    if (footerStatus) footerStatus.textContent = `Showing ${roles.length} of ${allRoles.length} role${allRoles.length === 1 ? '' : 's'}`;

    tbody.innerHTML = roles
      .map(
        (r) => `
      <tr class="h-[44px] hover:bg-[#161616] transition-colors">
        <td class="px-4 py-2 font-mono font-medium text-white text-xs">
          <div class="flex items-center gap-2">
            ${icon('shield', 'w-3.5 h-3.5 text-[#f38020]')}
            <span>${r.name}</span>
          </div>
        </td>
        <td class="px-4 py-2 text-xs text-[#8c8c8c]">${r.description || '—'}</td>
        <td class="px-4 py-2">
          <div class="flex flex-wrap gap-1 font-mono text-[11px]">
            ${r.permissions
              .map(
                (p) => `
              <span class="inline-flex items-center px-1.5 py-0.5 rounded bg-[#141414] border border-[#262626] text-white">
                <span class="text-[#3b82f6]">${p.database}</span>.<span class="text-white">${p.table_name}</span>: <span class="text-[#f38020] font-medium ml-1">${p.operations.join(',')}</span>
              </span>
            `
              )
              .join('')}
          </div>
        </td>
        <td class="px-4 py-2 text-xs text-[#8c8c8c] font-mono">
          ${new Date(r.created_at * 1000).toLocaleDateString()}
        </td>
        <td class="px-4 py-2 text-right">
          <button 
            data-delete-role="${r.name}" 
            class="size-7 rounded bg-[#141414] hover:bg-rose-500/20 border border-[#262626] hover:border-rose-500/30 text-[#8c8c8c] hover:text-rose-400 transition-colors inline-flex items-center justify-center cursor-pointer" 
            title="Delete role"
          >
            ${icon('trash', 'w-3.5 h-3.5')}
          </button>
        </td>
      </tr>
    `
      )
      .join('');

    tbody.querySelectorAll('[data-delete-role]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const name = (e.currentTarget as HTMLElement).getAttribute('data-delete-role');
        if (!name) return;

        confirmDialog({
          title: `Delete Role '${name}'`,
          message: `Deleting role '${name}' will remove associated permission rules. API keys assigned to this role will lose their scoped capabilities.`,
          confirmText: 'Delete Role',
          danger: true,
          onConfirm: async () => {
            try {
              await api.deleteRole(name);
              toast.success(`Role '${name}' deleted`);
              loadRoles();
            } catch (err: unknown) {
              toast.error(err instanceof Error ? err.message : 'Failed to delete role');
            }
          },
        });
      });
    });
  }

  async function loadRoles() {
    try {
      allRoles = await api.getRoles();
      applyFilter();
    } catch {
      const tbody = document.getElementById('roles-table-body') as HTMLElement;
      tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-rose-400 text-xs">Failed to load roles.</td></tr>`;
    }
  }

  function applyFilter() {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q ? allRoles.filter((r) => r.name.toLowerCase().includes(q) || (r.description && r.description.toLowerCase().includes(q))) : allRoles;
    renderTableRows(filtered);
  }

  document.getElementById('roles-search-input')?.addEventListener('input', (e) => {
    searchQuery = (e.target as HTMLInputElement).value;
    applyFilter();
  });

  const closeModal = () => modal.classList.add('hidden');
  const openModal = () => {
    pendingPermissions = [];
    updatePendingRulesList();
    modalError.classList.add('hidden');
    modal.classList.remove('hidden');
    (document.getElementById('role-name-input') as HTMLInputElement)?.focus();
  };

  document.getElementById('open-create-role-modal')?.addEventListener('click', openModal);
  document.getElementById('close-create-role-modal')?.addEventListener('click', closeModal);
  document.getElementById('cancel-create-role')?.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  };
  window.addEventListener('keydown', onKey);

  document.getElementById('add-perm-rule-btn')?.addEventListener('click', () => {
    const db = (document.getElementById('perm-db-input') as HTMLInputElement).value.trim() || '*';
    const table = (document.getElementById('perm-table-input') as HTMLInputElement).value.trim() || '*';

    const ops: string[] = [];
    if ((document.getElementById('op-select') as HTMLInputElement).checked) ops.push('SELECT');
    if ((document.getElementById('op-insert') as HTMLInputElement).checked) ops.push('INSERT');
    if ((document.getElementById('op-update') as HTMLInputElement).checked) ops.push('UPDATE');
    if ((document.getElementById('op-delete') as HTMLInputElement).checked) ops.push('DELETE');

    if (ops.length === 0) {
      toast.error('Select at least one SQL operation for this rule');
      return;
    }

    pendingPermissions.push({ database: db, table_name: table, operations: ops });
    updatePendingRulesList();
  });

  document.getElementById('create-role-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    modalError.classList.add('hidden');

    const name = (document.getElementById('role-name-input') as HTMLInputElement).value.trim();
    const description = (document.getElementById('role-desc-input') as HTMLInputElement).value.trim();

    if (pendingPermissions.length === 0) {
      modalError.textContent = 'Please append at least one permission rule to this role';
      modalError.classList.remove('hidden');
      return;
    }

    const submitBtn = document.getElementById('submit-create-role') as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
      await api.createRole({ name, description, permissions: pendingPermissions });
      toast.success(`Role '${name}' created successfully`);
      closeModal();
      loadRoles();
    } catch (err: unknown) {
      modalError.textContent = err instanceof Error ? err.message : 'Failed to create role';
      modalError.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Role';
    }
  });

  loadRoles();
}
