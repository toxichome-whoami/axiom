import React, { useState } from 'react';
import { RbacRole, PermissionOperation } from '../types';
import { DataTable, Column } from '../components/shared/DataTable';
import { PermissionTable, AxiomPermissions } from '../components/shared/PermissionTable';
import { SlideOver } from '../components/ui/SlideOver';
import { Button } from '../components/ui/Button';
import { Shield, Plus, CheckCircle2, Lock, Edit3, Trash2 } from 'lucide-react';

const DEFAULT_ADMIN_PERMISSIONS: AxiomPermissions = {
  db_select: true,
  db_insert: true,
  db_update: true,
  db_delete: true,
  db_execute_raw: true,
  db_schema_describe: true,
  keys_view: true,
  keys_create: true,
  keys_rotate: true,
  keys_delete: true,
  pools_view: true,
  pools_add: true,
  pools_delete: true,
  roles_view: true,
  roles_create: true,
  roles_edit: true,
  roles_delete: true,
  mcp_access: true,
  mcp_tools_invoke: true,
  tester_execute: true,
  logs_view_audit: true,
  metrics_view: true,
  cache_stats_view: true,
  cache_flush: true,
  settings_view: true,
};

const READWRITE_PERMISSIONS: AxiomPermissions = {
  db_select: true,
  db_insert: true,
  db_update: true,
  db_delete: true,
  db_execute_raw: false,
  db_schema_describe: true,
  keys_view: true,
  keys_create: false,
  keys_rotate: false,
  keys_delete: false,
  pools_view: true,
  pools_add: false,
  pools_delete: false,
  roles_view: true,
  roles_create: false,
  roles_edit: false,
  roles_delete: false,
  mcp_access: true,
  mcp_tools_invoke: true,
  tester_execute: true,
  logs_view_audit: false,
  metrics_view: true,
  cache_stats_view: true,
  cache_flush: false,
  settings_view: false,
};

const READONLY_PERMISSIONS: AxiomPermissions = {
  db_select: true,
  db_insert: false,
  db_update: false,
  db_delete: false,
  db_execute_raw: false,
  db_schema_describe: true,
  keys_view: false,
  keys_create: false,
  keys_rotate: false,
  keys_delete: false,
  pools_view: true,
  pools_add: false,
  pools_delete: false,
  roles_view: false,
  roles_create: false,
  roles_edit: false,
  roles_delete: false,
  mcp_access: true,
  mcp_tools_invoke: false,
  tester_execute: false,
  logs_view_audit: false,
  metrics_view: true,
  cache_stats_view: true,
  cache_flush: false,
  settings_view: false,
};

export function Roles() {
  const [roles, setRoles] = useState<RbacRole[]>([
    {
      name: 'admin',
      description: 'Superuser policy granting full access to all databases, management routes, and schemas.',
      createdAt: '2026-09-27',
      permissions: [
        {
          database: '*',
          table: '*',
          operations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        },
      ],
    },
    {
      name: 'readwrite',
      description: 'Operational service access allowing CRUD data manipulation across application tables.',
      createdAt: '2026-09-28',
      permissions: [
        {
          database: 'prod_pg',
          table: '*',
          operations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        },
        {
          database: 'local_db',
          table: '*',
          operations: ['SELECT', 'INSERT', 'UPDATE'],
        },
      ],
    },
    {
      name: 'readonly',
      description: 'Inspection and analytics access restricted strictly to SELECT operations.',
      createdAt: '2026-09-29',
      permissions: [
        {
          database: '*',
          table: '*',
          operations: ['SELECT'],
        },
      ],
    },
  ]);

  // Matrix Viewer / Editor State
  const [activeMatrixRole, setActiveMatrixRole] = useState<'admin' | 'readwrite' | 'readonly'>('admin');
  const [matrixValues, setMatrixValues] = useState<Record<string, AxiomPermissions>>({
    admin: DEFAULT_ADMIN_PERMISSIONS,
    readwrite: READWRITE_PERMISSIONS,
    readonly: READONLY_PERMISSIONS,
  });

  // Create Role SlideOver
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [newPerms, setNewPerms] = useState<AxiomPermissions>({ ...READWRITE_PERMISSIONS });

  // Edit Role SlideOver
  const [editOpen, setEditOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RbacRole | null>(null);
  const [editDesc, setEditDesc] = useState('');

  function handleCreateRole() {
    if (!newRoleName.trim()) return;
    const role: RbacRole = {
      name: newRoleName.trim(),
      description: newRoleDesc,
      createdAt: new Date().toISOString().split('T')[0],
      permissions: [
        {
          database: '*',
          table: '*',
          operations: ['SELECT', 'INSERT', 'UPDATE'],
        },
      ],
    };
    setRoles([...roles, role]);
    setMatrixValues((prev) => ({ ...prev, [role.name]: newPerms }));
    setCreateOpen(false);
    setNewRoleName('');
    setNewRoleDesc('');
  }

  function handleSaveEdit() {
    if (!selectedRole) return;
    setRoles(
      roles.map((r) => (r.name === selectedRole.name ? { ...r, description: editDesc } : r))
    );
    setEditOpen(false);
  }

  const columns: Column<RbacRole>[] = [
    {
      id: 'name',
      header: 'Role Name',
      accessorKey: 'name',
      isSortable: true,
      width: 200,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Shield className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px]">{row.name}</span>
        </div>
      ),
    },
    {
      id: 'description',
      header: 'Scope Description',
      accessorKey: 'description',
      isFlex: true,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#8c8c8c] font-normal truncate block" title={row.description}>
          {row.description}
        </span>
      ),
    },
    {
      id: 'rules',
      header: 'Rule Sets',
      width: 130,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#cccccc] font-normal">
          {row.permissions.length} rule{row.permissions.length > 1 ? 's' : ''}
        </span>
      ),
    },
    {
      id: 'createdAt',
      header: 'Created Date',
      accessorKey: 'createdAt',
      width: 140,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">
          {row.createdAt}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      isFlex: true,
      headerClassName: 'justify-end pr-4 text-right',
      className: 'pl-3 pr-4 justify-end',
      cell: (row) => (
        <div className="flex items-center justify-end gap-2 w-full">
          <button
            type="button"
            onClick={() => {
              setActiveMatrixRole(row.name as any);
              const element = document.getElementById('permission-matrix-section');
              element?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-white hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Inspect Matrix
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedRole(row);
              setEditDesc(row.description);
              setEditOpen(true);
            }}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Edit
          </button>
          {row.name !== 'admin' && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete role "${row.name}"?`)) {
                  setRoles(roles.filter((r) => r.name !== row.name));
                }
              }}
              className="inline-flex items-center justify-center h-7 px-2.5 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-[#e5484d] bg-transparent hover:bg-[#161616] border border-transparent hover:border-[#262626] transition-colors cursor-pointer shrink-0"
            >
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-semibold text-white tracking-tight">Roles</h1>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Create Role
        </Button>
      </div>

      {/* Roles Read-Only Table */}
      <DataTable
        columns={columns}
        data={roles}
        ariaLabel="Configured RBAC Roles Table"
        pagination={{
          page: 1,
          pageSize: 10,
          totalCount: roles.length,
          onPageChange: () => {},
          onPageSizeChange: () => {},
        }}
      />

      {/* Interactive Permission Matrix Section */}
      <div id="permission-matrix-section" className="space-y-3 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-white tracking-tight flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#3b82f6]" />
              Role Permission Matrix
            </h2>
            <p className="text-[12px] text-[#8c8c8c]">
              Interactive permission toggles with parent-child enforcement for role: <span className="text-[#3b82f6] font-mono font-medium">{activeMatrixRole}</span>
            </p>
          </div>

          {/* Role Selector Tabs */}
          <div className="flex items-center gap-1.5 p-0.5 rounded-lg bg-[#0c0c0c] border border-[#222222]">
            {roles.map((r) => (
              <button
                key={r.name}
                type="button"
                onClick={() => setActiveMatrixRole(r.name as any)}
                className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors cursor-pointer ${
                  activeMatrixRole === r.name
                    ? 'bg-[#1a1a1a] text-white shadow-xs'
                    : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414]'
                }`}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>

        {/* PermissionTable Component Instance */}
        <PermissionTable
          value={matrixValues[activeMatrixRole] || READONLY_PERMISSIONS}
          readOnly={activeMatrixRole === 'admin'}
          onChange={(newVal) => {
            setMatrixValues((prev) => ({
              ...prev,
              [activeMatrixRole]: newVal,
            }));
          }}
        />
      </div>

      {/* Create Role SlideOver */}
      <SlideOver
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create New RBAC Policy"
        subtitle="Define a custom role and assign initial permissions matrix"
        width="w-[560px] max-w-full"
      >
        <div className="flex-1 p-5 overflow-y-auto space-y-5">
          <div>
            <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Role Name</label>
            <input
              type="text"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="e.g. data_analyst"
              className="h-9 w-full rounded-md border border-[#262626] bg-[#121212] px-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6]"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Description</label>
            <textarea
              rows={2}
              value={newRoleDesc}
              onChange={(e) => setNewRoleDesc(e.target.value)}
              placeholder="Summary of services or applications assigned to this role..."
              className="w-full rounded-md border border-[#262626] bg-[#121212] p-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6]"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#cccccc] mb-2">Configure Role Permissions</label>
            <PermissionTable
              value={newPerms}
              onChange={setNewPerms}
            />
          </div>
        </div>

        <div className="p-4 border-t border-[#222222] bg-[#000000] flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleCreateRole}>
            Create Role
          </Button>
        </div>
      </SlideOver>

      {/* Edit Role Description SlideOver */}
      <SlideOver
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit Role: ${selectedRole?.name}`}
        subtitle="Update scope summary and policy annotations"
      >
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Description</label>
            <textarea
              rows={4}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              className="w-full rounded-md border border-[#262626] bg-[#121212] p-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6]"
            />
          </div>
        </div>

        <div className="p-4 border-t border-[#222222] bg-[#000000] flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSaveEdit}>
            Save Changes
          </Button>
        </div>
      </SlideOver>
    </div>
  );
}
