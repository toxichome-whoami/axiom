/*
 * RBAC Role and permission management interface.
 * Owned by: ui/roles
 * Key deps: DataTable, SlideOver, PermissionTable, ConfirmDialog, CustomSelect, Button, lucide-react
 * Invariants: Roles enforce granular database/table/operation permissions with BLAKE3 snapshot consistency.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { RbacRole } from '../types';
import { DataTable, Column } from '../components/shared/DataTable';
import { PermissionTable, DbPermissionRule } from '../components/shared/PermissionTable';
import { SlideOver } from '../components/ui/SlideOver';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CustomSelect } from '../components/shared/CustomSelect';
import {
  Shield,
  Plus,
  Search,
  Check,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Database,
  Package,
  Sparkles,
} from 'lucide-react';
import { api, RoleRecordApi, PermissionRecordApi } from '../api/client';

export interface FilterRule {
  id: string;
  field: string;
  operator: 'contains' | 'equals' | 'starts_with';
  value: string;
}

const READONLY_RULES: DbPermissionRule[] = [
  { database: '', table: '', operations: ['SELECT'], resourceType: 'database' },
];

const ROLE_PRESETS: {
  label: string;
  name: string;
  description: string;
  rules: DbPermissionRule[];
}[] = [
  {
    label: 'DB Read-Only',
    name: 'db_readonly',
    description: 'Read-only SELECT access across all relational databases',
    rules: [{ database: '*', table: '*', operations: ['SELECT'], resourceType: 'database' }],
  },
  {
    label: 'DB Read-Write',
    name: 'db_readwrite',
    description: 'Full CRUD mutations across all relational databases',
    rules: [
      {
        database: '*',
        table: '*',
        operations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        resourceType: 'database',
      },
    ],
  },
  {
    label: 'Blob Read-Only',
    name: 'blob_viewer',
    description: 'Download, range stream, and view objects across all blob namespaces',
    rules: [{ database: 'blob:*', table: '*', operations: ['READ'], resourceType: 'blob' }],
  },
  {
    label: 'Blob Full Access',
    name: 'blob_manager',
    description: 'Upload, multipart, range stream, and delete blob storage objects',
    rules: [
      {
        database: 'blob:*',
        table: '*',
        operations: ['READ', 'WRITE', 'DELETE'],
        resourceType: 'blob',
      },
    ],
  },
  {
    label: 'Universal Admin',
    name: 'universal_admin',
    description: 'Full administrative access to both SQL databases and native blob storage',
    rules: [
      {
        database: '*',
        table: '*',
        operations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        resourceType: 'database',
      },
      {
        database: 'blob:*',
        table: '*',
        operations: ['READ', 'WRITE', 'DELETE'],
        resourceType: 'blob',
      },
    ],
  },
];

export function Roles() {
  const [roles, setRoles] = useState<RbacRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fetchGenRef = useRef(0);

  // Pagination State (F-06)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Load RBAC roles and permissions from backend with race guard (F-07)
  const loadRoles = async () => {
    const curGen = ++fetchGenRef.current;
    setLoadError(null);
    try {
      const res = await api.listRoles();
      if (curGen !== fetchGenRef.current) return;
      const loaded: RbacRole[] = res.roles.map((r) => ({
        name: r.name,
        description: r.description || '',
        createdAt: new Date(r.created_at * 1000).toISOString().split('T')[0],
        permissions: (r.permissions || []).map((p) => ({
          database: p.database,
          table: p.table_name,
          operations: p.operations,
        })),
      }));
      setRoles(loaded);
    } catch (err: unknown) {
      if (curGen === fetchGenRef.current) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load RBAC roles');
      }
    } finally {
      if (curGen === fetchGenRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  // Toolbar & Filtering State
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const filtersRef = useRef<HTMLDivElement | null>(null);

  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  const displayOptionsRef = useRef<HTMLDivElement | null>(null);

  const [matchMode, setMatchMode] = useState<'all' | 'any'>('all');
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [appliedFilterRules, setAppliedFilterRules] = useState<FilterRule[]>([]);

  // Visible columns map
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({
    name: true,
    description: true,
    rules: true,
    createdAt: true,
  });

  useEffect(() => {
    if (!showFilters && !showDisplayOptions) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showFilters && filtersRef.current && !filtersRef.current.contains(target)) {
        setShowFilters(false);
      }
      if (showDisplayOptions && displayOptionsRef.current && !displayOptionsRef.current.contains(target)) {
        setShowDisplayOptions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilters, showDisplayOptions]);

  // Reset pagination on query or filter changes (F-06)
  useEffect(() => {
    setPage(1);
  }, [searchQuery, appliedFilterRules, matchMode]);

  // Manage panel state
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState<'edit' | 'danger'>('edit');
  const [selectedRole, setSelectedRole] = useState<RbacRole | null>(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [editRoleDesc, setEditRoleDesc] = useState('');
  const [editPerms, setEditPerms] = useState<DbPermissionRule[]>([]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Create panel state
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [newPerms, setNewPerms] = useState<DbPermissionRule[]>([...READONLY_RULES]);

  function openManage(role: RbacRole) {
    setSelectedRole(role);
    setEditRoleName(role.name);
    setEditRoleDesc(role.description);
    setEditPerms(role.permissions.map((p) => ({ ...p, operations: [...p.operations] })));
    setManageTab('edit');
    setManageOpen(true);
  }

  const hasEditPermErrors = useMemo(
    () => editPerms.some((p) => p.database.includes(',') || p.table.includes(',')),
    [editPerms]
  );

  const hasNewPermErrors = useMemo(
    () => newPerms.some((p) => p.database.includes(',') || p.table.includes(',')),
    [newPerms]
  );

  const isModified = Boolean(
    selectedRole &&
      editRoleName.trim() !== '' &&
      (editRoleName.trim() !== selectedRole.name ||
        editRoleDesc !== selectedRole.description ||
        JSON.stringify(editPerms) !== JSON.stringify(selectedRole.permissions))
  );

  async function handleSaveEdit() {
    if (!selectedRole || !editRoleName.trim() || hasEditPermErrors) return;
    try {
      const permPayload: PermissionRecordApi[] = editPerms.map((p) => ({
        database: p.database,
        table_name: p.table,
        operations: p.operations,
      }));
      await api.updateRole(selectedRole.name, {
        description: editRoleDesc,
        permissions: permPayload,
      });
      await loadRoles();
      setManageOpen(false);
    } catch (err) {
      console.error('Failed to update role:', err);
    }
  }

  async function handleCreateRole() {
    if (!newRoleName.trim() || hasNewPermErrors) return;
    try {
      const permPayload: PermissionRecordApi[] = newPerms.map((p) => ({
        database: p.database,
        table_name: p.table,
        operations: p.operations,
      }));
      await api.createRole({
        name: newRoleName.trim(),
        description: newRoleDesc,
        permissions: permPayload,
      });
      await loadRoles();
      setCreateOpen(false);
      setNewRoleName('');
      setNewRoleDesc('');
      setNewPerms([...READONLY_RULES]);
    } catch (err) {
      console.error('Failed to create role:', err);
    }
  }

  function matchesRule(itemVal: string, operator: string, ruleVal: string): boolean {
    const i = (itemVal || '').toLowerCase();
    const r = (ruleVal || '').toLowerCase();
    if (operator === 'equals') return i === r;
    if (operator === 'starts_with') return i.startsWith(r);
    return i.includes(r);
  }

  const filterFieldOptions = [
    { value: 'name', label: 'Role Name' },
    { value: 'description', label: 'Description' },
    { value: 'rules', label: 'Rules Count' },
    { value: 'createdAt', label: 'Created Date' },
  ];

  const displayColumnOptions = [
    { id: 'name', label: 'Role Name' },
    { id: 'description', label: 'Description' },
    { id: 'rules', label: 'Rules Count' },
    { id: 'createdAt', label: 'Created Date' },
  ];

  const handleAddRule = () => {
    const newId = String(Date.now());
    setFilterRules((prev) => [
      ...prev,
      { id: newId, field: filterFieldOptions[0].value, operator: 'contains', value: '' },
    ]);
  };

  const handleRemoveRule = (id: string) => {
    setFilterRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleUpdateRule = (id: string, updates: Partial<FilterRule>) => {
    setFilterRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r))
    );
  };

  const handleApplyFilters = () => {
    setAppliedFilterRules(filterRules.filter((r) => r.value.trim() !== ''));
    setShowFilters(false);
  };

  const handleClearFilters = () => {
    setFilterRules([]);
    setAppliedFilterRules([]);
    setShowFilters(false);
  };

  const toggleColVisibility = (colId: string) => {
    setVisibleCols((prev) => ({ ...prev, [colId]: !prev[colId] }));
  };

  const handleResetColumns = () => {
    setVisibleCols({
      name: true,
      description: true,
      rules: true,
      createdAt: true,
    });
  };

  const filteredRoles = useMemo(() => {
    let list = roles;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          String(r.permissions.length).includes(q) ||
          r.createdAt.includes(q)
      );
    }
    if (appliedFilterRules.length > 0) {
      list = list.filter((r) => {
        const tests = appliedFilterRules.map((rule) => {
          let val = '';
          if (rule.field === 'name') val = r.name;
          else if (rule.field === 'description') val = r.description;
          else if (rule.field === 'rules') val = String(r.permissions.length);
          else if (rule.field === 'createdAt') val = r.createdAt;
          return matchesRule(val, rule.operator, rule.value);
        });
        return matchMode === 'any' ? tests.some(Boolean) : tests.every(Boolean);
      });
    }
    return list;
  }, [roles, searchQuery, appliedFilterRules, matchMode]);

  const columns: Column<RbacRole>[] = [
    {
      id: 'name',
      header: 'Role',
      accessorKey: 'name',
      isSortable: true,
      isResizable: true,
      width: 190,
      minWidth: 130,
      maxWidth: 320,
      className: 'pl-4 pr-3',
      cell: (row) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <Shield className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px] truncate whitespace-nowrap" title={row.name}>
            {row.name}
          </span>
        </div>
      ),
    },
    {
      id: 'description',
      header: 'Description',
      accessorKey: 'description',
      width: 360,
      minWidth: 180,
      maxWidth: 700,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[13px] text-[#8c8c8c] font-normal truncate block" title={row.description}>
          {row.description}
        </span>
      ),
    },
    {
      id: 'rules',
      header: 'Rules',
      width: 180,
      minWidth: 120,
      maxWidth: 260,
      isResizable: true,
      className: 'px-3',
      cell: (row) => {
        const dbCount = row.permissions.filter((p) => !p.database.toLowerCase().startsWith('blob:')).length;
        const blobCount = row.permissions.filter((p) => p.database.toLowerCase().startsWith('blob:')).length;
        return (
          <div className="flex items-center gap-1.5 flex-wrap font-sans">
            {dbCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#1e293b]/60 text-[#38bdf8] border border-[#0284c7]/30">
                <Database className="w-3 h-3 shrink-0" />
                <span>{dbCount} SQL</span>
              </span>
            )}
            {blobCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#18181b] text-[#cccccc] border border-[#27272a]">
                <Package className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                <span>{blobCount} Blob</span>
              </span>
            )}
            {dbCount === 0 && blobCount === 0 && (
              <span className="text-[12px] text-[#737373]">0 rules</span>
            )}
          </div>
        );
      },
    },
    {
      id: 'createdAt',
      header: 'Created Date',
      accessorKey: 'createdAt',
      width: 140,
      minWidth: 110,
      maxWidth: 220,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[13px] text-[#8c8c8c] font-normal">{row.createdAt}</span>
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

  const activeColumns = useMemo(() => {
    const visible = columns.filter((col) => col.id === 'actions' || visibleCols[col.id] !== false);
    const lastDataId = [...visible].reverse().find((c) => c.id !== 'actions')?.id;
    return visible.map((col) => ({
      ...col,
      isResizable: col.id !== 'actions' && col.id !== lastDataId && Boolean(col.isResizable),
    }));
  }, [columns, visibleCols]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-medium text-white tracking-tight">Roles</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsRefreshing(true);
              loadRoles();
            }}
            title="Refresh roles"
            className="flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-white rounded-[8px] bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin opacity-50' : ''}`} />
          </button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setNewRoleName('');
              setNewRoleDesc('');
              setNewPerms([...READONLY_RULES]);
              setCreateOpen(true);
            }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Create Role
          </Button>
        </div>
      </div>

      {/* Table Controls Toolbar (Search, Filters, Display Options) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 select-none font-sans">
        <label
          title="Search roles..."
          className="relative flex items-center h-9 rounded-[8px] bg-transparent border border-[#262626] focus-within:border-[#2f80ed] transition-colors px-3 gap-2 w-full sm:w-[260px] md:w-[300px]"
        >
          <Search className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search roles..."
            className="w-full bg-transparent border-0 text-[14px] text-white placeholder-[#8c8c8c] outline-none font-normal font-sans"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#222222] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer shrink-0 font-sans"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </label>

        <div className="flex flex-wrap items-center gap-2 font-sans">
          {/* Filters dropdown button & popover */}
          <div className="relative" ref={filtersRef}>
            <button
              type="button"
              onClick={() => {
                setShowFilters((prev) => {
                  const next = !prev;
                  if (next) {
                    setShowDisplayOptions(false);
                    if (appliedFilterRules.length > 0) {
                      setFilterRules(appliedFilterRules.map((r) => ({ ...r })));
                    } else if (filterRules.length === 0) {
                      setFilterRules([
                        { id: '1', field: filterFieldOptions[0].value, operator: 'contains', value: '' },
                      ]);
                    }
                  }
                  return next;
                });
              }}
              className={`flex items-center gap-1.5 h-9 px-3 rounded-[8px] bg-transparent border text-[14px] font-medium transition-colors cursor-pointer shrink-0 font-sans ${
                showFilters || appliedFilterRules.length > 0
                  ? 'border-[#444444] text-white bg-[#141414]'
                  : 'border-[#262626] text-white hover:bg-[#141414] hover:border-[#383838]'
              }`}
              title="Filter roles"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                fill="currentColor"
                viewBox="0 0 256 256"
                className="text-[#8c8c8c] shrink-0"
              >
                <path d="M230.6,49.53A15.81,15.81,0,0,0,216,40H40A16,16,0,0,0,28.19,66.76l.08.09L96,139.17V216a16,16,0,0,0,24.87,13.32l32-21.34A16,16,0,0,0,160,194.66V139.17l67.74-72.32.08-.09A15.8,15.8,0,0,0,230.6,49.53ZM40,56h0Zm106.18,74.58A8,8,0,0,0,144,136v58.66L112,216V136a8,8,0,0,0-2.16-5.47L40,56H216Z" />
              </svg>
              <span>Filters</span>
              {appliedFilterRules.length > 0 && (
                <span className="text-[12px] text-[#8c8c8c] font-normal">
                  ({appliedFilterRules.length})
                </span>
              )}
            </button>

            {showFilters && (
              <div className="absolute right-0 top-10 w-[540px] max-w-[calc(100vw-32px)] rounded-[8px] bg-[#0c0c0c] border border-[#262626] shadow-2xl p-4 z-50 select-none animate-in fade-in font-sans">
                {/* Header */}
                <div className="flex items-center justify-between pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-white font-sans">Role Filters</span>
                    {filterRules.length >= 2 && (
                      <button
                        type="button"
                        onClick={() => setMatchMode((prev) => (prev === 'any' ? 'all' : 'any'))}
                        className="px-2.5 py-0.5 rounded text-[13px] text-[#cccccc] hover:text-white bg-[#141414] border border-[#2e2e2e] hover:border-[#444444] transition-colors cursor-pointer font-sans"
                      >
                        Match {matchMode === 'any' ? 'any (OR)' : 'all (AND)'}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowFilters(false)}
                    className="text-[#888888] hover:text-white transition-colors cursor-pointer text-[14px] p-1 leading-none"
                    title="Close filters"
                  >
                    ✕
                  </button>
                </div>

                {/* Rules List */}
                <div className={`space-y-2.5 ${filterRules.length > 3 ? 'max-h-[320px] overflow-y-auto pr-0.5' : ''}`}>
                  {filterRules.map((rule) => (
                    <div key={rule.id} className="flex items-center gap-2">
                      <CustomSelect
                        value={rule.field}
                        options={filterFieldOptions}
                        onChange={(val) => handleUpdateRule(rule.id, { field: val })}
                        className="w-36 shrink-0"
                        menuWidth="w-44"
                      />

                      <CustomSelect
                        value={rule.operator}
                        options={[
                          { value: 'contains', label: 'contains' },
                          { value: 'equals', label: 'equals' },
                          { value: 'starts_with', label: 'starts with' },
                        ]}
                        onChange={(val) => handleUpdateRule(rule.id, { operator: val as 'contains' | 'equals' | 'starts_with' })}
                        className="w-32 sm:w-36 shrink-0"
                        menuWidth="w-44"
                      />

                      <input
                        type="text"
                        value={rule.value}
                        onChange={(e) => handleUpdateRule(rule.id, { value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleApplyFilters();
                        }}
                        placeholder="Filter value..."
                        className="flex-1 min-w-0 h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#2f80ed] text-[14px] text-white placeholder-[#555555] outline-none transition-colors font-sans"
                      />

                      <button
                        type="button"
                        onClick={() => handleRemoveRule(rule.id)}
                        className="w-8 h-8 flex items-center justify-center text-[#777777] hover:text-white cursor-pointer transition-colors shrink-0"
                        title="Delete filter rule"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="currentColor" viewBox="0 0 256 256">
                          <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>

                {/* Footer Controls */}
                <div className="flex items-center justify-between pt-2.5 mt-1 font-sans">
                  <button
                    type="button"
                    onClick={handleAddRule}
                    className="text-[14px] text-white hover:text-[#2f80ed] font-medium flex items-center gap-1.5 transition-colors cursor-pointer font-sans"
                  >
                    <span>+ Add filter</span>
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-[#666666] font-sans">Press Enter to apply</span>
                    {appliedFilterRules.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearFilters}
                        className="text-[14px] text-[#888888] hover:text-white transition-colors cursor-pointer font-sans"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleApplyFilters}
                      className="group relative flex shrink-0 items-center justify-center h-8 px-3.5 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-50 overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans"
                    >
                      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]" />
                      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
                      <span className="relative flex items-center gap-1.5 text-[14px] font-sans">
                        Apply filters
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Display options dropdown */}
          <div className="relative" ref={displayOptionsRef}>
            <button
              type="button"
              onClick={() => {
                setShowDisplayOptions((prev) => !prev);
                setShowFilters(false);
              }}
              className={`flex items-center gap-1.5 h-9 px-3 rounded-[8px] bg-transparent border text-[14px] font-medium transition-colors cursor-pointer shrink-0 font-sans ${
                showDisplayOptions
                  ? 'border-[#444444] text-white bg-[#141414]'
                  : 'border-[#262626] text-white hover:bg-[#141414] hover:border-[#383838]'
              }`}
              title="Toggle visible table columns"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256" className="text-[#8c8c8c] shrink-0">
                <path d="M222.87,74.56,134.87,23.75a16,16,0,0,0-15.74,0L31.13,74.56A16,16,0,0,0,23.26,88.4v101.6a16,16,0,0,0,7.87,13.84l88,50.81a16,16,0,0,0,15.74,0l88-50.81a16,16,0,0,0,7.87-13.84V88.4A16,16,0,0,0,222.87,74.56ZM127,160a32,32,0,1,1,32-32A32,32,0,0,1,127,160Z" />
              </svg>
              <span>Display options</span>
            </button>

            {showDisplayOptions && (
              <div className="absolute right-0 top-[calc(100%+4px)] w-52 rounded-[8px] bg-[#0c0c0c] border border-[#262626] shadow-2xl p-1 z-50 select-none font-sans animate-in fade-in duration-100">
                {displayColumnOptions.map((col) => {
                  const isVisible = visibleCols[col.id] !== false;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => toggleColVisibility(col.id)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-[6px] text-[14px] text-[#cccccc] hover:text-white hover:bg-[#141414] transition-colors cursor-pointer font-sans"
                    >
                      <span className={isVisible ? 'text-white font-medium' : 'text-[#8c8c8c]'}>
                        {col.label}
                      </span>
                      {isVisible && (
                        <Check className="w-3.5 h-3.5 text-[#3b82f6] shrink-0" />
                      )}
                    </button>
                  );
                })}
                <div className="-mx-1 my-1 border-t border-[#222222]" />
                <button
                  type="button"
                  onClick={handleResetColumns}
                  className="w-full text-left px-3 py-2 rounded-[6px] text-[13px] text-[#8c8c8c] hover:text-white hover:bg-[#141414] transition-colors cursor-pointer font-sans"
                >
                  Reset columns
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error Banner (F-09) */}
      {loadError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[#2a1113] border border-[#5c1d24] text-[#f87171] text-[13px]">
          <AlertTriangle className="w-4 h-4 shrink-0 text-[#ef4444]" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Roles Read-Only DataTable */}
      <DataTable
        columns={activeColumns}
        data={filteredRoles}
        isLoading={isLoading}
        ariaLabel="RBAC Roles"
        pagination={{
          page,
          pageSize,
          totalCount: filteredRoles.length,
          onPageChange: setPage,
          onPageSizeChange: (newSize) => {
            setPageSize(newSize);
            setPage(1);
          },
        }}
      />

      {/* Manage Role SlideOver */}
      <SlideOver
        isOpen={manageOpen}
        onClose={() => setManageOpen(false)}
        title={selectedRole?.name ?? ''}
        subtitle={selectedRole?.description ?? ''}
        width="w-[620px] max-w-full"
      >
        {/* Navigation Tabs */}
        <div className="border-b border-[#222222] px-5 py-2.5 bg-[#0e0e0e]">
          <div className="inline-flex items-center p-0.5 rounded-[8px] bg-transparent border border-[#262626]">
            <button
              type="button"
              onClick={() => setManageTab('edit')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                manageTab === 'edit'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <span>Configuration</span>
            </button>
            <button
              type="button"
              onClick={() => setManageTab('danger')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                manageTab === 'danger'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <span>Danger</span>
            </button>
          </div>
        </div>

        {manageTab === 'edit' && (
          <div className="flex-1 p-5 overflow-y-auto space-y-5">
            <div>
              <h3 className="text-[16px] font-medium text-white tracking-tight">Role Configuration</h3>
              <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                Update role identifier, descriptive summary, and database access permissions.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Role Name</label>
                <input
                  type="text"
                  value={editRoleName}
                  onChange={(e) => setEditRoleName(e.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#2f80ed] hover:border-[#383838] transition-colors font-sans"
                />
                <p className="text-[12px] text-[#8c8c8c] mt-1 font-sans">
                  Role identifier referenced by API keys and service tokens.
                </p>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Description</label>
                <textarea
                  rows={2}
                  value={editRoleDesc}
                  onChange={(e) => setEditRoleDesc(e.target.value)}
                  className="w-full rounded-[8px] border border-[#262626] bg-[#121212] p-3 text-[14px] text-white focus:outline-none focus:border-[#2f80ed] hover:border-[#383838] transition-colors resize-none font-sans"
                />
              </div>
            </div>

            {/* Edge-to-edge separator */}
            <div className="-mx-5 border-t border-[#222222]" />

            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <h4 className="text-[16px] font-medium text-white tracking-tight">Access Scope & Rules</h4>
                  <span className="text-[13px] text-[#8c8c8c] bg-[#141414] border border-[#262626] px-2 py-0.5 rounded-full font-sans">
                    {editPerms.length} {editPerms.length === 1 ? 'rule' : 'rules'}
                  </span>
                </div>
                <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                  Granular CRUD permissions for SQL databases and native blob storage. Use <code className="text-[#3b82f6] font-mono">*</code> for wildcards or prefix matching.
                </p>
              </div>

              <PermissionTable
                value={editPerms}
                onChange={setEditPerms}
              />
            </div>
          </div>
        )}

        {manageTab === 'danger' && (
          <div className="flex-1 p-5 overflow-y-auto">
            <div className="rounded-[8px] border border-[#3a1515] bg-[#0e0404] p-4">
              <div className="text-[16px] font-medium text-[#e5484d] tracking-tight mb-1">Delete Role</div>
              <div className="text-[13px] text-[#8c8c8c] leading-relaxed mb-4">
                Permanently delete role <span className="text-white font-medium">{selectedRole?.name}</span>. All API keys and identities assigned to this role will lose database permissions.
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

        {/* Footer for Edit tab */}
        {manageTab === 'edit' && (
          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-between gap-2.5 font-sans">
            {hasEditPermErrors ? (
              <span className="text-[12px] text-[#e5484d] flex items-center gap-1 font-sans">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Resolve rule errors to save
              </span>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setManageOpen(false)}
                className="inline-flex items-center justify-center h-8 px-3.5 rounded-[8px] text-[13px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!isModified || hasEditPermErrors}
                onClick={handleSaveEdit}
                className="group relative flex shrink-0 items-center justify-center h-8 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans text-[13px]"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
                />
                <span className="relative flex items-center gap-1.5 font-sans">
                  Save Changes
                </span>
              </button>
            </div>
          </div>
        )}
      </SlideOver>

      {/* Create Role SlideOver */}
      <SlideOver
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Role"
        subtitle="Define database access rules and operation permissions"
        width="w-[620px] max-w-full"
      >
        <div className="flex-1 p-5 overflow-y-auto space-y-5">
          <div>
            <h3 className="text-[16px] font-medium text-white tracking-tight">Role Details</h3>
            <p className="text-[13px] text-[#8c8c8c] mt-0.5">
              Specify role identifier, description, and permission grant rules.
            </p>
          </div>

          {/* Quick Role Templates */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-[#a3a3a3]">
              <Sparkles className="w-3.5 h-3.5 text-[#8c8c8c]" />
              <span>Quick Role Presets</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ROLE_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => {
                    if (!newRoleName.trim()) setNewRoleName(preset.name);
                    if (!newRoleDesc.trim()) setNewRoleDesc(preset.description);
                    setNewPerms(preset.rules.map((r) => ({ ...r, operations: [...r.operations] })));
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[12px] font-medium bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] text-[#cccccc] hover:text-white transition-colors cursor-pointer touch-manipulation font-sans"
                >
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Role Name</label>
              <input
                type="text"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="e.g. analytics_reader or blob_uploader"
                className="h-9 w-full rounded-[8px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white placeholder-[#666666] focus:outline-none focus:border-[#2f80ed] hover:border-[#383838] transition-colors font-sans"
              />
              <p className="text-[12px] text-[#8c8c8c] mt-1 font-sans">
                Unique identifier for RBAC role assignment.
              </p>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Description</label>
              <textarea
                rows={2}
                value={newRoleDesc}
                onChange={(e) => setNewRoleDesc(e.target.value)}
                placeholder="What services, buckets, or teams use this role..."
                className="w-full rounded-[8px] border border-[#262626] bg-[#121212] p-3 text-[14px] text-white placeholder-[#666666] focus:outline-none focus:border-[#2f80ed] hover:border-[#383838] transition-colors resize-none font-sans"
              />
            </div>
          </div>

          {/* Edge-to-edge separator */}
          <div className="-mx-5 border-t border-[#222222]" />

          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <h4 className="text-[16px] font-medium text-white tracking-tight">Access Scope & Rules</h4>
                <span className="text-[13px] text-[#8c8c8c] bg-[#141414] border border-[#262626] px-2 py-0.5 rounded-full font-sans">
                  {newPerms.length} {newPerms.length === 1 ? 'rule' : 'rules'}
                </span>
              </div>
              <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                Configure database CRUD and native blob storage permissions. Use <code className="text-[#3b82f6] font-mono">*</code> for wildcards or prefix matching.
              </p>
            </div>
            <PermissionTable value={newPerms} onChange={setNewPerms} />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-between gap-2.5 font-sans">
          {hasNewPermErrors ? (
            <span className="text-[12px] text-[#e5484d] flex items-center gap-1 font-sans">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              Resolve rule errors
            </span>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="inline-flex items-center justify-center h-8 px-3.5 rounded-[8px] text-[13px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!newRoleName.trim() || hasNewPermErrors}
              onClick={handleCreateRole}
              className="group relative flex shrink-0 items-center justify-center h-8 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans text-[13px]"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative flex items-center gap-1.5 font-sans">
                Create Role
              </span>
            </button>
          </div>
        </div>
      </SlideOver>

      {/* Delete Role Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={async () => {
          if (selectedRole) {
            try {
              await api.deleteRole(selectedRole.name);
              await loadRoles();
            } catch (err) {
              console.error('Failed to delete role:', err);
            }
          }
          setConfirmDeleteOpen(false);
          setManageOpen(false);
        }}
        title="Delete Role"
        description={
          <>
            Permanently delete role{' '}
            <span className="text-white font-medium">{selectedRole?.name}</span>?
            All API keys and client identities assigned to this role will lose database permissions.
          </>
        }
        confirmLabel="Delete Role"
        cancelLabel="Cancel"
      />
    </div>
  );
}
