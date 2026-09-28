/*
 * Roles and granular RBAC permissions management page built with Shadcn UI primitives.
 * Owned by: ui/pages
 * Key deps: ../components/ui, ../api
 * Invariants: Multi-operation permissions builder, database/table scoping, safe array iteration.
 */

import React, { useState, useEffect } from 'react';
import { api, type RoleRecord, type PermissionRecord, type DatabaseRecord } from '../api';
import {
  Button,
  Badge,
  Input,
  Dialog,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  toast,
  confirmAction,
} from '../components/ui';
import { Shield, Plus, Search, Trash2, AlertCircle } from 'lucide-react';

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

  const safeRoles = Array.isArray(roles) ? roles : [];
  const filtered = safeRoles.filter(
    (r) =>
      (r.name && r.name.toLowerCase().includes(search.toLowerCase())) ||
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
        <Button
          onClick={() => setIsModalOpen(true)}
          className="bg-[#f38020] hover:bg-[#fa8c16] text-black font-semibold border-none self-start sm:self-auto"
          size="sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create Role</span>
        </Button>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-2.5" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search roles..."
            className="pl-8"
          />
        </div>
        <span className="text-xs text-[#666666] ">
          {roles.length} custom role{roles.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Roles DataTable */}
      <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Permissions Matrix</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-[#666666]">
                  Loading roles...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-[#666666]">
                  {search ? `No roles match "${search}".` : 'No roles created yet. Click "Create Role" to define one.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className=" font-medium text-white">
                    <div className="flex items-center gap-2">
                      <Shield className="w-3.5 h-3.5 text-[#f38020]" />
                      <span>{r.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-[#8c8c8c]">
                    {r.description || '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {r.permissions && r.permissions.length > 0 ? (
                        r.permissions.map((p, i) => (
                          <Badge
                            key={i}
                            variant="secondary"
                            className=" text-[10px]"
                          >
                            {p.database}.{p.table_name}: [{p.operations.join(', ')}]
                          </Badge>
                        ))
                      ) : (
                        <span className="text-[#666666]">No rules defined</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className=" text-[#8c8c8c]">
                    {r.created_at ? new Date(r.created_at * 1000).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleDelete(r.name)}
                      className="hover:border-rose-500/40 hover:bg-rose-950/20 hover:text-rose-400"
                      title="Delete role"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create Role Dialog */}
      <Dialog
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create RBAC Role"
        description="Define an identity profile restricting machine queries by database, table, and operation."
        className="max-w-[560px]"
      >
        {formError && (
          <div className="mb-4 p-2.5 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#cccccc] mb-1">
              Role Identifier <span className="text-rose-400">*</span>
            </label>
            <Input
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              placeholder="e.g. analytics_readonly"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#cccccc] mb-1">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe access level or intended service"
            />
          </div>

          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-[#cccccc]">Permission Rules</label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleAddPermissionRule}
                className="text-[#f38020] hover:text-[#fa8c16]"
              >
                <Plus className="w-3 h-3" />
                <span>Add Rule</span>
              </Button>
            </div>

            <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
              {permissions.map((p, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded border border-[#222222] bg-[#080808] space-y-2.5"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="block text-[10px] text-[#666666] mb-1  ">Database</span>
                      <select
                        value={p.database}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPermissions(permissions.map((rule, i) => (i === idx ? { ...rule, database: val } : rule)));
                        }}
                        className="w-full h-8 px-2 rounded bg-[#0c0c0c] border border-[#222222] text-xs text-white"
                      >
                        <option value="*">* (All Databases)</option>
                        {databases.map((d) => (
                          <option key={d.alias} value={d.alias}>
                            {d.alias}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <span className="block text-[10px] text-[#666666] mb-1  ">Table</span>
                      <Input
                        value={p.table_name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPermissions(permissions.map((rule, i) => (i === idx ? { ...rule, table_name: val } : rule)));
                        }}
                        placeholder="* or table_name"
                        className="h-8"
                      />
                    </div>
                  </div>

                  <div>
                    <span className="block text-[10px] text-[#666666] mb-1  ">Operations</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map((op) => {
                        const active = p.operations.includes(op);
                        return (
                          <button
                            key={op}
                            type="button"
                            onClick={() => handleToggleOperation(idx, op)}
                            className={`px-2 py-0.5 rounded text-[11px]  transition-colors border ${
                              active
                                ? 'bg-[#3b82f6]/20 border-[#3b82f6]/40 text-[#60a5fa]'
                                : 'bg-[#141414] border-[#222222] text-[#666666] hover:text-[#cccccc]'
                            }`}
                          >
                            {op}
                          </button>
                        );
                      })}
                      {permissions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemovePermissionRule(idx)}
                          className="ml-auto text-[#666666] hover:text-rose-400 p-1 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1e1e1e]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              isLoading={submitting}
            >
              Save Role
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};
