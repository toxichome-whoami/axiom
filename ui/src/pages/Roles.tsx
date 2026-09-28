import React, { useState, useEffect } from 'react';
import { api, type RoleRecord, type PermissionRecord, type DatabaseRecord } from '../api';
import { toast } from '../components/ui/Toast';
import { confirmAction } from '../components/ui/ConfirmDialog';
import { Shield, Plus, Search, Trash2, AlertCircle, X } from 'lucide-react';

export const Roles: React.FC = () => {
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [databases, setDatabases] = useState<DatabaseRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Create Role Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [roleName, setRoleName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<PermissionRecord[]>([
    { database: '*', table_name: '*', operations: ['SELECT'] },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      const [r, d] = await Promise.all([api.getRoles(), api.getDatabases()]);
      setRoles(r);
      setDatabases(d);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddPermissionRule = () => {
    setPermissions([
      ...permissions,
      { database: '*', table_name: '*', operations: ['SELECT'] },
    ]);
  };

  const handleRemovePermissionRule = (idx: number) => {
    setPermissions(permissions.filter((_, i) => i !== idx));
  };

  const handleToggleOperation = (idx: number, op: string) => {
    setPermissions(
      permissions.map((p, i) => {
        if (i !== idx) return p;
        const exists = p.operations.includes(op);
        const nextOps = exists ? p.operations.filter((o) => o !== op) : [...p.operations, op];
        return { ...p, operations: nextOps };
      })
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!roleName.trim()) {
      setFormError('Role name is required.');
      return;
    }

    try {
      setSubmitting(true);
      await api.createRole({
        name: roleName.trim(),
        description: description.trim() || undefined,
        permissions,
      });
      toast.success(`Role '${roleName}' created successfully`);
      setIsModalOpen(false);
      setRoleName('');
      setDescription('');
      setPermissions([{ database: '*', table_name: '*', operations: ['SELECT'] }]);
      loadData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create role');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (name: string) => {
    confirmAction({
      title: `Delete Role '${name}'`,
      message: `Are you sure you want to remove role '${name}'? Any API keys currently referencing this role will have their permissions revoked.`,
      confirmText: 'Delete Role',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteRole(name);
          toast.success(`Role '${name}' deleted`);
          loadData();
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : 'Deletion failed');
        }
      },
    });
  };

  const filtered = roles.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.description && r.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#222222] pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Roles & Permissions</h1>
          <p className="text-xs text-[#8c8c8c] mt-1">
            Configure granular table-level and operation-level (SELECT, INSERT, UPDATE, DELETE) access rules.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="h-8 px-3.5 rounded text-xs font-semibold bg-[#f38020] hover:bg-[#fa8c16] text-black transition-colors flex items-center gap-1.5 self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create Role</span>
        </button>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search roles..."
            className="w-full h-8 pl-8 pr-3 rounded bg-[#0e0e0e] border border-[#222222] text-xs text-white placeholder-[#666666] focus:border-[#f38020] focus:outline-none"
          />
        </div>
        <span className="text-xs text-[#666666] font-mono">
          {roles.length} custom role{roles.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Roles DataTable */}
      <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#141414] text-[#8c8c8c] border-b border-[#222222]">
              <tr>
                <th className="px-4 py-3 font-medium">Role Name</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Permissions Matrix</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e1e]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[#666666]">
                    Loading roles...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-[#666666]">
                    {search ? `No roles match "${search}".` : 'No roles created yet. Click "Create Role" to define one.'}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.name} className="hover:bg-[#141414] transition-colors">
                    <td className="px-4 py-3 font-mono font-medium text-white">
                      <div className="flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-[#f38020]" />
                        <span>{r.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#8c8c8c]">
                      {r.description || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {r.permissions && r.permissions.length > 0 ? (
                          r.permissions.map((p, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono bg-[#141414] border border-[#262626] text-[#cccccc]"
                            >
                              {p.database}.{p.table_name}: [{p.operations.join(', ')}]
                            </span>
                          ))
                        ) : (
                          <span className="text-[#666666]">No rules defined</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[#8c8c8c]">
                      {new Date(r.created_at * 1000).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(r.name)}
                        className="h-7 w-7 rounded bg-[#141414] hover:bg-rose-500/20 border border-[#262626] hover:border-rose-500/30 text-[#8c8c8c] hover:text-rose-400 transition-colors inline-flex items-center justify-center"
                        title="Delete role"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Role Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-[560px] rounded-lg border border-[#262626] bg-[#0c0c0c] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#f38020]" />
                <h3 className="text-sm font-semibold text-white">Create RBAC Role</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-[#666666] hover:text-white p-1 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-2.5 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#cccccc] mb-1">
                  Role Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. read_only, customer_service, data_engineer"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-[#141414] border border-[#262626] text-xs text-white placeholder-[#555555] focus:border-[#f38020] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#cccccc] mb-1">
                  Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Allows read access to all public tables"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-[#141414] border border-[#262626] text-xs text-white placeholder-[#555555] focus:border-[#f38020] focus:outline-none"
                />
              </div>

              {/* Permissions List */}
              <div className="space-y-2 pt-2 border-t border-[#222222]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[#cccccc]">Permission Rules</span>
                  <button
                    type="button"
                    onClick={handleAddPermissionRule}
                    className="text-[11px] text-[#f38020] hover:text-[#fa8c16] font-medium flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Rule</span>
                  </button>
                </div>

                <div className="space-y-2.5">
                  {permissions.map((p, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded bg-[#121212] border border-[#262626] space-y-2 relative"
                    >
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-[#777777] mb-0.5">Database</label>
                          <input
                            type="text"
                            value={p.database}
                            onChange={(e) => {
                              const val = e.target.value;
                              setPermissions(
                                permissions.map((item, i) =>
                                  i === idx ? { ...item, database: val } : item
                                )
                              );
                            }}
                            placeholder="* for all"
                            className="w-full h-7 px-2 rounded bg-[#181818] border border-[#2c2c2c] text-xs font-mono text-white focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-[#777777] mb-0.5">Table</label>
                          <input
                            type="text"
                            value={p.table_name}
                            onChange={(e) => {
                              const val = e.target.value;
                              setPermissions(
                                permissions.map((item, i) =>
                                  i === idx ? { ...item, table_name: val } : item
                                )
                              );
                            }}
                            placeholder="* for all"
                            className="w-full h-7 px-2 rounded bg-[#181818] border border-[#2c2c2c] text-xs font-mono text-white focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Operations Checkboxes */}
                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-3">
                          {['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map((op) => {
                            const isChecked = p.operations.includes(op);
                            return (
                              <label
                                key={op}
                                className="flex items-center gap-1.5 text-[11px] font-mono text-[#a1a1a1] cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleToggleOperation(idx, op)}
                                  className="rounded border-[#333333] bg-[#1a1a1a] text-[#f38020] focus:ring-0 cursor-pointer"
                                />
                                <span>{op}</span>
                              </label>
                            );
                          })}
                        </div>
                        {permissions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemovePermissionRule(idx)}
                            className="text-[#666666] hover:text-rose-400 p-0.5"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#222222]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="h-8 px-3.5 rounded text-xs font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-8 px-3.5 rounded text-xs font-semibold bg-[#f38020] hover:bg-[#fa8c16] text-black transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {submitting && <span className="animate-spin w-3 h-3 border-2 border-black border-t-transparent rounded-full" />}
                  <span>Save Role</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
