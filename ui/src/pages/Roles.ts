/*
 * RBAC Role and Policy management interface.
 * Configures fine-grained database, table, and operation permission matrices.
 */

import { api, RoleRecord, PermissionRecord } from '../api';
import { icon } from '../components/Icons';
import { toast, confirmDialog } from '../components/Toast';

export async function renderRoles(container: HTMLElement) {
  let pendingPermissions: PermissionRecord[] = [];

  container.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Roles & Policies</h1>
          <p class="text-xs text-secondary mt-0.5">Define access control policies and granular SQL operation permissions.</p>
        </div>
        <button id="open-create-role-modal" class="flex items-center space-x-1.5 px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white rounded-md text-xs font-medium transition-colors shadow-xs">
          ${icon('plus', 'w-3.5 h-3.5')}
          <span>Create Role</span>
        </button>
      </div>

      <!-- Roles Table Card -->
      <div class="bg-surface border border-surfaceBorder rounded-lg overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs text-secondary">
            <thead class="bg-background text-[11px] font-semibold uppercase tracking-wider text-secondary border-b border-surfaceBorder">
              <tr>
                <th class="py-3 px-4">Role Name</th>
                <th class="py-3 px-4">Description</th>
                <th class="py-3 px-4">Permission Grants</th>
                <th class="py-3 px-4">Created</th>
                <th class="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="roles-table-body" class="divide-y divide-surfaceBorder">
              <tr>
                <td colspan="5" class="py-8 text-center text-secondary">Loading roles...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Create Role Modal -->
    <div id="create-role-modal" class="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-lg w-full p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-2 border-b border-surfaceBorder">
          <h2 class="text-sm font-semibold text-primary">Create Access Role</h2>
          <button id="close-create-role-modal" class="text-secondary hover:text-primary p-1">
            ${icon('x', 'w-4 h-4')}
          </button>
        </div>

        <div id="create-role-error" class="hidden p-2 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

        <form id="create-role-form" class="space-y-4 text-xs">
          <div>
            <label for="role-name-input" class="block text-secondary mb-1">Role Name</label>
            <input 
              id="role-name-input" 
              type="text" 
              required 
              placeholder="e.g. read_only_analyst" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary font-mono focus:border-focusRing focus:outline-none" 
            />
          </div>

          <div>
            <label for="role-desc-input" class="block text-secondary mb-1">Description</label>
            <input 
              id="role-desc-input" 
              type="text" 
              placeholder="Read-only access to customer analytics" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" 
            />
          </div>

          <!-- Permission Rule Builder -->
          <div class="border border-surfaceBorder rounded-md p-3.5 bg-background space-y-3">
            <div class="font-medium text-primary text-xs flex items-center justify-between">
              <span>Add Permission Rule</span>
              <span class="text-[11px] text-secondary font-mono">Wildcard * supported</span>
            </div>
            
            <div class="grid grid-cols-2 gap-2.5">
              <div>
                <label for="perm-db-input" class="block text-secondary text-[11px] mb-1">Database</label>
                <input id="perm-db-input" type="text" value="*" class="w-full px-2.5 py-1.5 bg-surface border border-surfaceBorder rounded text-primary font-mono text-xs focus:outline-none focus:border-focusRing" />
              </div>
              <div>
                <label for="perm-table-input" class="block text-secondary text-[11px] mb-1">Table</label>
                <input id="perm-table-input" type="text" value="*" class="w-full px-2.5 py-1.5 bg-surface border border-surfaceBorder rounded text-primary font-mono text-xs focus:outline-none focus:border-focusRing" />
              </div>
            </div>

            <div>
              <label class="block text-secondary text-[11px] mb-1.5">Permitted Operations</label>
              <div class="flex items-center space-x-4 font-mono">
                <label class="flex items-center space-x-1.5 cursor-pointer">
                  <input type="checkbox" id="op-select" checked class="rounded border-surfaceBorder text-accent-orange focus:ring-0" />
                  <span class="text-primary text-[11px]">SELECT</span>
                </label>
                <label class="flex items-center space-x-1.5 cursor-pointer">
                  <input type="checkbox" id="op-insert" class="rounded border-surfaceBorder text-accent-orange focus:ring-0" />
                  <span class="text-primary text-[11px]">INSERT</span>
                </label>
                <label class="flex items-center space-x-1.5 cursor-pointer">
                  <input type="checkbox" id="op-update" class="rounded border-surfaceBorder text-accent-orange focus:ring-0" />
                  <span class="text-primary text-[11px]">UPDATE</span>
                </label>
                <label class="flex items-center space-x-1.5 cursor-pointer">
                  <input type="checkbox" id="op-delete" class="rounded border-surfaceBorder text-accent-orange focus:ring-0" />
                  <span class="text-primary text-[11px]">DELETE</span>
                </label>
              </div>
            </div>

            <button type="button" id="add-perm-rule-btn" class="w-full py-1.5 bg-surfaceHover hover:bg-surfaceBorder text-secondary hover:text-primary rounded text-xs transition-colors">
              + Append Rule to Role
            </button>

            <!-- Pending Rules List -->
            <div id="pending-rules-container" class="space-y-1.5 pt-2 border-t border-surfaceBorder">
              <div class="text-[11px] text-secondary">No rules added yet.</div>
            </div>
          </div>

          <div class="flex justify-end space-x-2 pt-2 border-t border-surfaceBorder">
            <button type="button" id="cancel-create-role" class="px-3 py-1.5 bg-surfaceHover hover:bg-surfaceBorder text-secondary hover:text-primary rounded-md transition-colors">
              Cancel
            </button>
            <button type="submit" id="submit-create-role" class="px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white font-medium rounded-md transition-colors">
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
      rulesList.innerHTML = `<div class="text-[11px] text-secondary">No rules appended yet. Minimum 1 rule required.</div>`;
      return;
    }

    rulesList.innerHTML = pendingPermissions.map((p, idx) => `
      <div class="flex items-center justify-between p-2 rounded bg-surface border border-surfaceBorder text-[11px] font-mono">
        <div>
          <span class="text-accent-blue">${p.database}</span>.<span class="text-primary">${p.table_name}</span> &rarr;
          <span class="text-accent-orange font-semibold">[${p.operations.join(', ')}]</span>
        </div>
        <button type="button" data-remove-rule="${idx}" class="text-secondary hover:text-rose-400 p-0.5" title="Remove rule">
          ${icon('x', 'w-3.5 h-3.5')}
        </button>
      </div>
    `).join('');

    rulesList.querySelectorAll('[data-remove-rule]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-remove-rule') || '0', 10);
        pendingPermissions.splice(idx, 1);
        updatePendingRulesList();
      });
    });
  }

  async function loadRoles() {
    const tbody = document.getElementById('roles-table-body') as HTMLElement;
    try {
      const roles = await api.getRoles();
      if (roles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-secondary">No custom roles created yet. Click "Create Role" to establish policies.</td></tr>`;
        return;
      }

      tbody.innerHTML = roles.map((r) => `
        <tr class="hover:bg-surfaceHover/40 transition-colors">
          <td class="py-3 px-4 font-semibold text-primary font-mono">${r.name}</td>
          <td class="py-3 px-4 text-secondary">${r.description || '—'}</td>
          <td class="py-3 px-4">
            <div class="flex flex-wrap gap-1.5 font-mono text-[11px]">
              ${r.permissions.map((p) => `
                <span class="px-2 py-0.5 rounded bg-background border border-surfaceBorder text-primary">
                  <span class="text-accent-blue">${p.database}</span>.<span class="text-primary">${p.table_name}</span>: <span class="text-accent-orange font-medium">${p.operations.join(',')}</span>
                </span>
              `).join('')}
            </div>
          </td>
          <td class="py-3 px-4 text-secondary font-mono">${new Date(r.created_at * 1000).toLocaleDateString()}</td>
          <td class="py-3 px-4 text-right">
            <button data-delete-role="${r.name}" class="p-1 text-secondary hover:text-rose-400 rounded hover:bg-surfaceHover transition-colors" title="Delete role">
              ${icon('trash', 'w-4 h-4')}
            </button>
          </td>
        </tr>
      `).join('');

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
    } catch {
      tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-rose-400">Failed to load roles.</td></tr>`;
    }
  }

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
    const database = (document.getElementById('perm-db-input') as HTMLInputElement).value.trim() || '*';
    const table_name = (document.getElementById('perm-table-input') as HTMLInputElement).value.trim() || '*';
    
    const operations: string[] = [];
    if ((document.getElementById('op-select') as HTMLInputElement).checked) operations.push('SELECT');
    if ((document.getElementById('op-insert') as HTMLInputElement).checked) operations.push('INSERT');
    if ((document.getElementById('op-update') as HTMLInputElement).checked) operations.push('UPDATE');
    if ((document.getElementById('op-delete') as HTMLInputElement).checked) operations.push('DELETE');

    if (operations.length === 0) {
      toast.error('Select at least one permitted operation (SELECT, INSERT, UPDATE, or DELETE)');
      return;
    }

    pendingPermissions.push({ database, table_name, operations });
    updatePendingRulesList();
    toast.info(`Added rule: ${database}.${table_name} [${operations.join(', ')}]`);
  });

  document.getElementById('create-role-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    modalError.classList.add('hidden');

    const name = (document.getElementById('role-name-input') as HTMLInputElement).value.trim();
    const description = (document.getElementById('role-desc-input') as HTMLInputElement).value.trim() || undefined;

    if (pendingPermissions.length === 0) {
      modalError.textContent = 'Add at least one permission rule using the "+ Append Rule to Role" button above.';
      modalError.classList.remove('hidden');
      return;
    }

    const submitBtn = document.getElementById('submit-create-role') as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
      await api.createRole({ name, description, permissions: pendingPermissions });
      toast.success(`Role '${name}' saved successfully`);
      closeModal();
      loadRoles();
    } catch (err: unknown) {
      modalError.textContent = err instanceof Error ? err.message : 'Failed to save role';
      modalError.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Role';
    }
  });

  loadRoles();
}
