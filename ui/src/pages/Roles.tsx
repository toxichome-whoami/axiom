import React, { useState } from 'react';
import { RbacRole } from '../types';
import { DataTable, Column } from '../components/shared/DataTable';
import { PermissionTable, DbPermissionRule } from '../components/shared/PermissionTable';
import { SlideOver } from '../components/ui/SlideOver';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Shield, Plus } from 'lucide-react';

const DEFAULT_RULES: DbPermissionRule[] = [
  { database: '*', table: '*', operations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
];

const READONLY_RULES: DbPermissionRule[] = [
  { database: '*', table: '*', operations: ['SELECT'] },
];

export function Roles() {
  const [roles, setRoles] = useState<RbacRole[]>([
    {
      name: 'admin',
      description: 'Full access to all databases and tables.',
      createdAt: '2026-09-27',
      permissions: [{ database: '*', table: '*', operations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] }],
    },
    {
      name: 'readwrite',
      description: 'CRUD access to production databases.',
      createdAt: '2026-09-28',
      permissions: [
        { database: 'prod_pg', table: '*', operations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
        { database: 'local_db', table: '*', operations: ['SELECT', 'INSERT', 'UPDATE'] },
      ],
    },
    {
      name: 'readonly',
      description: 'SELECT-only access across all databases.',
      createdAt: '2026-09-29',
      permissions: [{ database: '*', table: '*', operations: ['SELECT'] }],
    },
  ]);

  // Manage panel
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState<'permissions' | 'danger'>('permissions');
  const [selectedRole, setSelectedRole] = useState<RbacRole | null>(null);
  const [editPerms, setEditPerms] = useState<DbPermissionRule[]>([]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Create panel
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [newPerms, setNewPerms] = useState<DbPermissionRule[]>([...READONLY_RULES]);

  function openManage(role: RbacRole) {
    setSelectedRole(role);
    setEditPerms(role.permissions.map((p) => ({ ...p, operations: [...p.operations] })));
    setManageTab('permissions');
    setManageOpen(true);
  }

  function handleSavePerms() {
    if (!selectedRole) return;
    setRoles(roles.map((r) => r.name === selectedRole.name ? { ...r, permissions: editPerms } : r));
    setManageOpen(false);
  }

  function handleCreateRole() {
    if (!newRoleName.trim()) return;
    const role: RbacRole = {
      name: newRoleName.trim(),
      description: newRoleDesc,
      createdAt: new Date().toISOString().split('T')[0],
      permissions: newPerms,
    };
    setRoles([...roles, role]);
    setCreateOpen(false);
    setNewRoleName('');
    setNewRoleDesc('');
    setNewPerms([...READONLY_RULES]);
  }

  const columns: Column<RbacRole>[] = [
    {
      id: 'name',
      header: 'Role',
      accessorKey: 'name',
      isSortable: true,
      isResizable: true,
      width: 180,
      className: 'pl-4 pr-3',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Shield className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px]">{row.name}</span>
        </div>
      ),
    },
    {
      id: 'description',
      header: 'Description',
      accessorKey: 'description',
      isFlex: true,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#8c8c8c] font-normal truncate block" title={row.description}>
          {row.description}
        </span>
      ),
    },
    {
      id: 'rules',
      header: 'Rules',
      width: 80,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#cccccc] font-normal tabular-nums">
          {row.permissions.length}
        </span>
      ),
    },
    {
      id: 'createdAt',
      header: 'Created',
      accessorKey: 'createdAt',
      width: 130,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">{row.createdAt}</span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      isFlex: true,
      headerClassName: 'justify-end pr-4 text-right',
      className: 'pl-3 pr-4 justify-end',
      cell: (row) => (
        <div className="flex items-center justify-end w-full">
          <button
            type="button"
            onClick={() => openManage(row)}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Manage
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-[16px] font-semibold text-white tracking-tight">Roles</h1>
        <button
          type="button"
          onClick={() => {
            setNewRoleName('');
            setNewRoleDesc('');
            setNewPerms([...READONLY_RULES]);
            setCreateOpen(true);
          }}
          className="group relative inline-flex items-center justify-center h-8 px-3.5 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] text-[13px]"
        >
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
          <span className="relative flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Create Role
          </span>
        </button>
      </div>

      <DataTable
        columns={columns}
        data={roles}
        ariaLabel="RBAC Roles"
        pagination={{
          page: 1,
          pageSize: 10,
          totalCount: roles.length,
          onPageChange: () => {},
          onPageSizeChange: () => {},
        }}
      />

      {/* Manage Role SlideOver */}
      <SlideOver
        isOpen={manageOpen}
        onClose={() => { setManageOpen(false); }}
        title={selectedRole?.name ?? ''}
        subtitle={selectedRole?.description ?? ''}
      >
        <div className="flex items-center gap-0 border-b border-[#222222] px-5">
          {(['permissions', 'danger'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setManageTab(tab)}
              className={`h-10 px-4 text-[13px] font-medium border-b-2 transition-colors cursor-pointer capitalize ${
                manageTab === tab
                  ? 'border-[#2f80ed] text-white'
                  : 'border-transparent text-[#8c8c8c] hover:text-white'
              }`}
            >
              {tab === 'permissions' ? 'Permissions' : 'Danger'}
            </button>
          ))}
        </div>

        {manageTab === 'permissions' && (
          <div className="flex-1 p-5 overflow-y-auto">
            <div className="mb-3 text-[12px] text-[#8c8c8c]">
              Database and table access rules for <span className="text-white font-mono">{selectedRole?.name}</span>. Use <code className="text-[#3b82f6]">*</code> to match all databases or tables.
            </div>
            <PermissionTable
              value={editPerms}
              onChange={setEditPerms}
            />
          </div>
        )}

        {manageTab === 'danger' && (
          <div className="flex-1 p-5 overflow-y-auto">
            <div className="rounded-[8px] border border-[#3a1515] bg-[#0e0404] p-4">
              <div className="text-[13px] font-medium text-[#e5484d] mb-1">Delete Role</div>
              <div className="text-[12px] text-[#8c8c8c] mb-4">
                Permanently delete <span className="text-white font-mono">{selectedRole?.name}</span>. API keys assigned to this role will lose access.
              </div>
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                className="group relative flex shrink-0 items-center justify-center h-8 px-3.5 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#be123c] bg-[#e11d48] font-sans text-[13px]"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#f43f5e] to-[#e11d48] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
                />
                <span className="relative flex items-center gap-1.5 font-sans">
                  Delete Role
                </span>
              </button>
            </div>
          </div>
        )}

        {manageTab === 'permissions' && (
          <div className="p-4 border-t border-[#222222] bg-[#000000] flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setManageOpen(false)}
              className="h-8 px-3 rounded-[6px] text-[13px] font-medium text-[#8c8c8c] hover:text-white border border-[#262626] hover:border-[#383838] bg-transparent hover:bg-[#141414] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSavePerms}
              className="h-8 px-3 rounded-[6px] text-[13px] font-medium text-white bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors cursor-pointer"
            >
              Save
            </button>
          </div>
        )}
      </SlideOver>

      {/* Create Role SlideOver */}
      <SlideOver
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Role"
        subtitle="Define database access rules for this role"
        width="w-[560px] max-w-full"
      >
        <div className="flex-1 p-5 overflow-y-auto space-y-5">
          <div>
            <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Role Name</label>
            <input
              type="text"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="e.g. analytics_reader"
              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6]"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Description</label>
            <textarea
              rows={2}
              value={newRoleDesc}
              onChange={(e) => setNewRoleDesc(e.target.value)}
              placeholder="What services or teams use this role..."
              className="w-full rounded-[6px] border border-[#262626] bg-[#121212] p-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6] resize-none"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#cccccc] mb-2">Database Access Rules</label>
            <PermissionTable value={newPerms} onChange={setNewPerms} />
          </div>
        </div>
        <div className="p-4 border-t border-[#222222] bg-[#000000] flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => setCreateOpen(false)}
            className="h-8 px-3 rounded-[6px] text-[13px] font-medium text-[#8c8c8c] hover:text-white border border-[#262626] hover:border-[#383838] bg-transparent hover:bg-[#141414] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreateRole}
            className="h-8 px-3 rounded-[6px] text-[13px] font-medium text-white bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors cursor-pointer"
          >
            Create Role
          </button>
        </div>
      </SlideOver>

      {/* Delete Role Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          if (selectedRole) {
            setRoles(roles.filter((r) => r.name !== selectedRole.name));
          }
          setConfirmDeleteOpen(false);
          setManageOpen(false);
        }}
        title="Delete Role"
        description={
          <>
            Permanently delete role{' '}
            <span className="font-mono text-white font-medium">{selectedRole?.name}</span>?
            All API keys and client identities assigned to this role will lose database permissions.
          </>
        }
        confirmLabel="Delete Role"
        cancelLabel="Cancel"
      />
    </div>
  );
}
