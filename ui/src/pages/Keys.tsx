/**
 * Keys.tsx
 * API Key Vault interface for managing machine credentials and token lifecycle.
 * Invariants:
 * - Plaintext secrets are cleared upon modal dismissal and never persisted to localStorage.
 * - Key rotation requires explicit confirmation and sends an Idempotency-Key.
 * - Table rendering is paginated client-side to prevent DOM saturation.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ApiKey, RetiringSecret } from '../types';
import { DataTable, Column } from '../components/shared/DataTable';
import { SlideOver } from '../components/ui/SlideOver';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CustomSelect } from '../components/shared/CustomSelect';
import { DatePicker } from '../components/shared/DatePicker';
import { Key, Plus, RefreshCw, Copy, Check, Clock, X, Search, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { api, ApiKeyRecordApi } from '../api/client';

export interface FilterRule {
  id: string;
  field: string;
  operator: 'contains' | 'equals' | 'starts_with';
  value: string;
}

const DEFAULT_ROLE_OPTIONS = [
  { value: 'admin', label: 'admin (Full Root Privileges)' },
  { value: 'readwrite', label: 'readwrite (CRUD Access)' },
  { value: 'readonly', label: 'readonly (SELECT Queries Only)' },
];

const STATUS_OPTIONS: { value: 'Active' | 'Revoked'; label: string; icon: React.ReactNode }[] = [
  {
    value: 'Active',
    label: 'Active',
    icon: <span className="size-2 rounded-full shrink-0 bg-[#30a46c]" />,
  },
  {
    value: 'Revoked',
    label: 'Revoked',
    icon: <span className="size-2 rounded-full shrink-0 bg-[#e5484d]" />,
  },
];

const GRACE_OPTIONS = [
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '24h', label: '24 hours' },
  { value: '72h', label: '72 hours' },
];

function formatRemainingTime(expiresTimestamp: number): string {
  const diff = expiresTimestamp - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) {
    return `${hours}h ${minutes}m left`;
  }
  return `${minutes}m left`;
}

export function Keys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [roleOptions, setRoleOptions] = useState(DEFAULT_ROLE_OPTIONS);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fetchGenRef = useRef(0);

  // Pagination State (F-06)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Load registered API keys and roles from backend with race guard (F-07)
  const loadKeys = async () => {
    const curGen = ++fetchGenRef.current;
    setLoadError(null);
    try {
      const [keyRes, roleRes] = await Promise.allSettled([
        api.listKeys(),
        api.listRoles(),
      ]);

      if (curGen !== fetchGenRef.current) return;

      if (roleRes.status === 'fulfilled' && roleRes.value.roles.length > 0) {
        setRoleOptions(
          roleRes.value.roles.map((r) => ({
            value: r.name,
            label: `${r.name} (${r.description || 'Custom Role'})`,
          }))
        );
      }

      if (keyRes.status === 'fulfilled') {
        const keyList: ApiKeyRecordApi[] = keyRes.value.keys;
        const formatted: ApiKey[] = keyList.map((k) => {
          const isExpired = k.expires_at ? k.expires_at * 1000 < Date.now() : false;
          return {
            name: k.name,
            role: k.role_name || 'admin',
            rateLimit: k.rate_limit || 0,
            status: isExpired ? 'Expired' : 'Active',
            expiresAt: k.expires_at ? new Date(k.expires_at * 1000).toISOString().split('T')[0] : null,
            createdAt: new Date(k.created_at * 1000).toISOString().split('T')[0],
            currentSecretMasked: 'axk_••••••••••••••••',
            retiringSecret: null,
          };
        });
        setKeys(formatted);
      } else {
        setLoadError(keyRes.reason?.message || 'Failed to load API keys');
      }
    } catch (err: unknown) {
      if (curGen === fetchGenRef.current) {
        setLoadError(err instanceof Error ? err.message : 'Unexpected error loading keys');
      }
    } finally {
      if (curGen === fetchGenRef.current) {
        setIsRefreshing(false);
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadKeys();
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
    status: true,
    name: true,
    role: true,
    rateLimit: true,
    expiresAt: true,
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

  function matchesRule(itemVal: string, operator: string, ruleVal: string): boolean {
    const i = (itemVal || '').toLowerCase();
    const r = (ruleVal || '').toLowerCase();
    if (operator === 'equals') return i === r;
    if (operator === 'starts_with') return i.startsWith(r);
    return i.includes(r);
  }

  const filterFieldOptions = [
    { value: 'name', label: 'Key Identifier' },
    { value: 'role', label: 'Assigned Role' },
    { value: 'status', label: 'Status' },
    { value: 'rateLimit', label: 'Rate Limit' },
  ];

  const displayColumnOptions = [
    { id: 'status', label: 'Status' },
    { id: 'name', label: 'Key Identifier' },
    { id: 'role', label: 'Assigned Role' },
    { id: 'rateLimit', label: 'Rate Limit' },
    { id: 'expiresAt', label: 'Expiry Date' },
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
      status: true,
      name: true,
      role: true,
      rateLimit: true,
      expiresAt: true,
      createdAt: true,
    });
  };

  const filteredKeys = useMemo(() => {
    let list = keys;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (k) =>
          k.name.toLowerCase().includes(q) ||
          k.role.toLowerCase().includes(q) ||
          k.status.toLowerCase().includes(q) ||
          String(k.rateLimit).includes(q)
      );
    }
    if (appliedFilterRules.length > 0) {
      list = list.filter((k) => {
        const tests = appliedFilterRules.map((rule) => {
          let val = '';
          if (rule.field === 'name') val = k.name;
          else if (rule.field === 'role') val = k.role;
          else if (rule.field === 'status') val = k.status;
          else if (rule.field === 'rateLimit') val = String(k.rateLimit);
          return matchesRule(val, rule.operator, rule.value);
        });
        return matchMode === 'any' ? tests.some(Boolean) : tests.every(Boolean);
      });
    }
    return list;
  }, [keys, searchQuery, appliedFilterRules, matchMode]);

  // Reset pagination on query or filter changes (F-06)
  useEffect(() => {
    setPage(1);
  }, [searchQuery, appliedFilterRules, matchMode]);

  // Create Key SlideOver State
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('readwrite');
  const [newRateLimit, setNewRateLimit] = useState(1000);
  const [newExpiresAt, setNewExpiresAt] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [showCreatedSecret, setShowCreatedSecret] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Manage SlideOver State
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState<'edit' | 'rotate' | 'danger'>('edit');
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null);
  const [editStatus, setEditStatus] = useState<'Active' | 'Revoked'>('Active');
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('admin');
  const [editRate, setEditRate] = useState(10000);
  const [editExpiresAt, setEditExpiresAt] = useState<string | null>(null);
  const [gracePeriod, setGracePeriod] = useState('24h');
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState(false);
  const [confirmRevokeRetiringOpen, setConfirmRevokeRetiringOpen] = useState(false);
  const [confirmRotateOpen, setConfirmRotateOpen] = useState(false);
  const [isRotating, setIsRotating] = useState(false);

  // Secret Rotation Dialog State
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
  const [newlyRotatedSecret, setNewlyRotatedSecret] = useState<string | null>(null);
  const [showRotatedSecret, setShowRotatedSecret] = useState(false);
  const [copiedRotatedKey, setCopiedRotatedKey] = useState(false);

  const isModified = Boolean(
    selectedKey &&
      editName.trim() !== '' &&
      (editName.trim() !== selectedKey.name ||
        editStatus !== selectedKey.status ||
        editRole !== selectedKey.role ||
        editRate !== selectedKey.rateLimit ||
        editExpiresAt !== selectedKey.expiresAt)
  );

  function closeCreate() {
    setCreateOpen(false);
    setCreatedSecret(null);
    setShowCreatedSecret(false);
    setNewName('');
    setNewExpiresAt(null);
  }

  function closeRotateDialog() {
    setRotateDialogOpen(false);
    setNewlyRotatedSecret(null);
    setShowRotatedSecret(false);
  }

  async function handleCreateKey() {
    const trimmed = newName.trim();
    if (!trimmed || !/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) return;
    let expiresUnix: number | null = null;
    if (newExpiresAt) {
      const expMs = new Date(newExpiresAt).getTime();
      if (expMs <= Date.now()) return;
      expiresUnix = Math.floor(expMs / 1000);
    }
    try {
      const res = await api.createKey({
        name: trimmed,
        role: newRole,
        rate_limit: Math.max(0, Math.min(1000000, Number(newRateLimit) || 0)),
        expires_at: expiresUnix,
      });
      setCreatedSecret(res.token);
      setShowCreatedSecret(false);
      await loadKeys();
    } catch (err: unknown) {
      console.error('Failed to create key:', err);
    }
  }

  function handleSaveEdit() {
    if (!selectedKey || !editName.trim()) return;
    setManageOpen(false);
  }

  function handleRotateKey() {
    if (!selectedKey || isRotating) return;
    setConfirmRotateOpen(true);
  }

  async function executeRotateKey() {
    if (!selectedKey || isRotating) return;
    setIsRotating(true);
    try {
      const graceSeconds =
        gracePeriod === '1h'
          ? 3600
          : gracePeriod === '6h'
          ? 21600
          : gracePeriod === '72h'
          ? 259200
          : 86400;

      const res = await api.rotateKey(selectedKey.name, {
        grace_period: graceSeconds,
        idempotencyKey: crypto.randomUUID(),
      });
      setNewlyRotatedSecret(res.token);
      setShowRotatedSecret(false);
      setCopiedRotatedKey(false);
      setConfirmRotateOpen(false);
      setRotateDialogOpen(true);
      await loadKeys();
    } catch (err: unknown) {
      console.error('Failed to rotate key:', err);
    } finally {
      setIsRotating(false);
    }
  }

  function handleRevokeRetiringSecret() {
    if (!selectedKey) return;
    const updatedKey: ApiKey = {
      ...selectedKey,
      retiringSecret: null,
    };
    setKeys((prev) => prev.map((k) => (k.name === selectedKey.name ? updatedKey : k)));
    setSelectedKey(updatedKey);
    setConfirmRevokeRetiringOpen(false);
  }

  // 1. Status, 2. Name, 3. Role, 4. Rate Limit, 5. Expiry Date, 6. Created Date
  const columns: Column<ApiKey>[] = [
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      width: 130,
      isResizable: true,
      className: 'pl-4 pr-3',
      cell: (row) => (
        <div className="flex items-center gap-2 text-[13px] text-[#cccccc] font-normal truncate whitespace-nowrap" title={row.status}>
          <span
            className={`size-1.5 rounded-full shrink-0 ${
              row.status === 'Active'
                ? 'bg-[#30a46c]'
                : row.status === 'Expired'
                ? 'bg-[#f59e0b]'
                : 'bg-[#e5484d]'
            }`}
          />
          <span className="truncate whitespace-nowrap">{row.status}</span>
        </div>
      ),
    },
    {
      id: 'name',
      header: 'Key Identifier',
      accessorKey: 'name',
      isSortable: true,
      isResizable: true,
      width: 220,
      className: 'px-3',
      cell: (row) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <Key className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px] truncate whitespace-nowrap" title={row.name}>{row.name}</span>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Assigned Role',
      accessorKey: 'role',
      isResizable: true,
      width: 160,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[13px] text-[#cccccc] font-normal truncate whitespace-nowrap block" title={row.role}>
          {row.role}
        </span>
      ),
    },
    {
      id: 'rateLimit',
      header: 'Rate Limit',
      accessorKey: 'rateLimit',
      isResizable: true,
      width: 160,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[13px] text-[#8c8c8c] font-normal truncate whitespace-nowrap block" title={`${row.rateLimit.toLocaleString()} req/min`}>
          {row.rateLimit.toLocaleString()} req/min
        </span>
      ),
    },
    {
      id: 'expiresAt',
      header: 'Expiry Date',
      accessorKey: 'expiresAt',
      isResizable: true,
      width: 155,
      className: 'px-3',
      cell: (row) => {
        const isExpired = Boolean(
          row.status === 'Expired' ||
          (row.expiresAt && new Date(row.expiresAt + 'T23:59:59') < new Date())
        );
        if (!row.expiresAt) {
          return (
            <span className="tabular-nums text-[13px] text-[#666666] font-normal truncate whitespace-nowrap block" title="Never expires">
              Never
            </span>
          );
        }
        return (
          <div className="flex items-center gap-1.5 truncate whitespace-nowrap" title={isExpired ? `Expired on ${row.expiresAt} at 12:00 AM` : `Expires on ${row.expiresAt} at 12:00 AM`}>
            <span
              className={`tabular-nums text-[13px] font-normal truncate ${
                isExpired ? 'text-[#737373] line-through decoration-[#8c8c8c]/70' : 'text-[#8c8c8c]'
              }`}
            >
              {row.expiresAt}
            </span>
            {isExpired && (
              <span className="text-[11px] font-medium text-[#f59e0b] bg-[#f59e0b]/10 border border-[#f59e0b]/20 px-1 py-0.5 rounded leading-none shrink-0">
                Expired
              </span>
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
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[13px] text-[#8c8c8c] font-normal truncate whitespace-nowrap block" title={row.createdAt}>
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
        <div className="flex items-center justify-end w-full">
          <button
            type="button"
            onClick={() => {
              setSelectedKey(row);
              setEditName(row.name);
              setEditStatus(row.status === 'Revoked' ? 'Revoked' : 'Active');
              setEditRole(row.role);
              setEditRate(row.rateLimit);
              setEditExpiresAt(row.expiresAt);
              setManageTab('edit');
              setManageOpen(true);
            }}
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
          <h1 className="text-[16px] font-medium text-white tracking-tight">API Keys</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsRefreshing(true);
              loadKeys();
            }}
            title="Refresh API keys"
            className="flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-white rounded-[8px] bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin opacity-50' : ''}`} />
          </button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setCreatedSecret(null);
              setNewName('');
              setNewRole('readwrite');
              setNewRateLimit(1000);
              setNewExpiresAt(null);
              setCopiedKey(false);
              setCreateOpen(true);
            }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Generate Key
          </Button>
        </div>
      </div>

      {/* Table Controls Toolbar (Search, Filters, Display Options) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 select-none font-sans">
        <label
          title="Search API keys..."
          className="relative flex items-center h-9 rounded-[8px] bg-transparent border border-[#262626] focus-within:border-[#2f80ed] transition-colors px-3 gap-2 w-full sm:w-[260px] md:w-[300px]"
        >
          <Search className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search keys..."
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
              title="Filter API keys"
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
                    <span className="text-[14px] font-medium text-white font-sans">API Key Filters</span>
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

      {/* Keys Read-Only DataTable */}
      <DataTable
        columns={activeColumns}
        data={filteredKeys}
        isLoading={isLoading}
        ariaLabel="API Keys Table"
        pagination={{
          page,
          pageSize,
          totalCount: filteredKeys.length,
          onPageChange: setPage,
          onPageSizeChange: (newSize) => {
            setPageSize(newSize);
            setPage(1);
          },
        }}
      />

      {/* Create Key SlideOver */}
      <SlideOver
        isOpen={createOpen}
        onClose={closeCreate}
        title="Generate Machine API Key"
        subtitle="Issue an authorized cryptographic credential with attached RBAC role"
      >
        <div className="flex-1 p-5 pb-36 overflow-y-auto space-y-4">
          {createdSecret ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#30a46c]/30 bg-[#30a46c]/10 p-4 space-y-2">
                <span className="text-[13px] font-medium text-[#30a46c] flex items-center gap-1.5">
                  <Check className="w-4 h-4" />
                  Key Generated Successfully
                </span>
                <p className="text-[12px] text-[#cccccc] leading-relaxed">
                  Store this secret securely now. Axiom uses irreversible BLAKE3 hashing and cannot recover this plaintext value later.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type={showCreatedSecret ? "text" : "password"}
                    readOnly
                    value={createdSecret}
                    className="h-9 flex-1 rounded-md border border-[#262626] bg-[#0c0c0c] px-3 font-mono text-[12px] text-[#3b82f6] select-all outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatedSecret((v) => !v)}
                    className="h-9 px-2.5 rounded-md border border-[#262626] bg-[#141414] hover:bg-[#1c1c1c] text-[#8c8c8c] hover:text-white text-[12px] flex items-center justify-center cursor-pointer transition-colors"
                    title={showCreatedSecret ? "Hide secret" : "Show secret"}
                  >
                    {showCreatedSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(createdSecret);
                        setCopiedKey(true);
                        setTimeout(() => setCopiedKey(false), 2000);
                      } catch {
                        // Clipboard write error
                      }
                    }}
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-[#30a46c]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-[#222222] bg-[#121212] p-3 text-[12px] text-[#8c8c8c] space-y-1">
                <span className="font-medium text-white block">Usage Example:</span>
                <p className="text-[11px] text-[#8c8c8c]">
                  Header format: <code className="text-[#cccccc]">X-Axiom-Key: base64(name:secret)</code>
                </p>
                <pre className="p-2 rounded bg-[#0a0a0a] border border-[#1e1e1e] font-mono text-[11px] text-[#3b82f6] overflow-x-auto">
                  {`# Generate base64 token securely in terminal:\n# export AXIOM_TOKEN=$(echo -n "${newName || '$KEY_NAME'}:${createdSecret ? '••••••••' : '$SECRET'}" | base64)\n\ncurl -X POST https://axiom.internal/api/v1/db/local_db/query \\\n  -H "X-Axiom-Key: $AXIOM_TOKEN" \\\n  -d '{"sql": "SELECT 1"}'`}
                </pre>
              </div>

              <div className="pt-2">
                <Button variant="primary" className="w-full" onClick={closeCreate}>
                  Done (Dismiss Plaintext Secret)
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-[16px] font-medium text-white tracking-tight">Key Configuration</h3>
                <p className="text-[13px] text-[#8c8c8c] mt-0.5">Provide key identifier, assigned RBAC permissions, and usage limits.</p>
              </div>

              {/* 1. Name */}
              <div>
                <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Key Identifier Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. payment_service_prod"
                  className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
                />
              </div>

              {/* 2. Role */}
              <div>
                <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Assigned RBAC Role</label>
                <CustomSelect
                  value={newRole}
                  options={roleOptions}
                  onChange={(val) => setNewRole(val)}
                  menuWidth="w-full"
                />
              </div>

              {/* 3. Rate Limit */}
              <div>
                <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Rate Limit Threshold (req/min)</label>
                <input
                  type="number"
                  value={newRateLimit}
                  onChange={(e) => setNewRateLimit(Number(e.target.value))}
                  className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] tabular-nums"
                />
              </div>

              {/* 4. Expiry Date */}
              <div>
                <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Expiry Date</label>
                <DatePicker
                  value={newExpiresAt}
                  onChange={(val) => setNewExpiresAt(val)}
                  placeholder="No expiry (Never)"
                />
                <p className="text-[12px] text-[#8c8c8c] mt-1">
                  Optional. Leave empty or choose Never to keep key valid indefinitely.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans">
          {createdSecret ? (
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans text-[14px]"
            >
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]" />
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
              <span className="relative flex items-center gap-1.5 font-sans">
                Done
              </span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateKey}
                disabled={!newName.trim()}
                className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans text-[14px]"
              >
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
                <span className="relative flex items-center gap-1.5 font-sans">
                  Generate Secret
                </span>
              </button>
            </>
          )}
        </div>
      </SlideOver>

      {/* Manage Key SlideOver */}
      <SlideOver
        isOpen={manageOpen}
        onClose={() => { setManageOpen(false); setManageTab('edit'); }}
        title={selectedKey?.name ?? ''}
        subtitle={selectedKey ? `Role: ${selectedKey.role} · ${selectedKey.status}` : ''}
      >
        {/* Tab bar (Segmented control matching dashboard) */}
        <div className="px-5 py-3 border-b border-[#222222] bg-[#0e0e0e]">
          <div className="inline-flex items-center p-0.5 rounded-[8px] bg-transparent border border-[#262626]">
            <button
              type="button"
              onClick={() => setManageTab('edit')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                manageTab === 'edit'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <span>Settings</span>
            </button>
            <button
              type="button"
              onClick={() => setManageTab('rotate')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                manageTab === 'rotate'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <span>Rotate Secret</span>
            </button>
            <button
              type="button"
              onClick={() => setManageTab('danger')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
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
          <div className="flex-1 p-5 overflow-y-auto space-y-4">
            <div>
              <h3 className="text-[16px] font-medium text-white tracking-tight">Key Settings</h3>
              <p className="text-[13px] text-[#8c8c8c] mt-0.5">Update key lifecycle status, assigned role, rate threshold, and expiry.</p>
            </div>

            {/* 1. Status */}
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Status</label>
              <CustomSelect
                value={editStatus}
                options={STATUS_OPTIONS}
                onChange={(val) => setEditStatus(val)}
                menuWidth="w-full"
              />
            </div>

            {/* 2. Name */}
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Key Identifier Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="e.g. payment_service_prod"
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
              />
            </div>

            {/* 3. Role */}
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Assigned Role</label>
              <CustomSelect
                value={editRole}
                options={roleOptions}
                onChange={(val) => setEditRole(val)}
                menuWidth="w-full"
              />
            </div>

            {/* 4. Rate Limit */}
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Rate Limit Threshold (req/min)</label>
              <input
                type="number"
                value={editRate}
                onChange={(e) => setEditRate(Number(e.target.value))}
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] tabular-nums"
              />
            </div>

            {/* 5. Expiry Date */}
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Expiry Date</label>
              <DatePicker
                value={editExpiresAt}
                onChange={(val) => setEditExpiresAt(val)}
                placeholder="No expiry (Never)"
              />
              <p className="text-[12px] text-[#8c8c8c] mt-1">
                Optional. Leave empty or choose Never to keep key valid indefinitely.
              </p>
            </div>

            {/* 6. Created Date */}
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Created Date</label>
              <div className="h-9 w-full rounded-[6px] border border-[#262626]/60 bg-[#0e0e0e] px-3 flex items-center text-[13px] text-[#8c8c8c] tabular-nums">
                {selectedKey?.createdAt ?? '—'}
              </div>
              <p className="text-[12px] text-[#8c8c8c] mt-1">
                Creation timestamp is immutable.
              </p>
            </div>
          </div>
        )}

        {manageTab === 'rotate' && (
          <div className="flex-1 p-5 overflow-y-auto space-y-5">
            <div>
              <h3 className="text-[16px] font-medium text-white tracking-tight">Rotate Key Secret</h3>
              <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                Generate a new secret with a zero-downtime grace period.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Transition Grace Period</label>
                <CustomSelect
                  value={gracePeriod}
                  options={GRACE_OPTIONS}
                  onChange={(val) => setGracePeriod(val)}
                  menuWidth="w-full"
                />
                <p className="text-[12px] text-[#8c8c8c] mt-1">
                  How long the previous secret remains active.
                </p>
              </div>

              <div>
                <button
                  type="button"
                  onClick={handleRotateKey}
                  className="h-9 px-4 rounded-[6px] text-[13px] font-medium border border-[#262626] bg-[#161616] text-white hover:bg-[#202020] hover:border-[#383838] transition-colors inline-flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#3b82f6]" />
                  <span>Rotate Secret</span>
                </button>
              </div>
            </div>

            {/* Edge-to-edge separator */}
            <div className="-mx-5 border-t border-[#222222]" />

            {/* Active Secrets Section Header */}
            <div>
              <div className="flex items-center justify-between">
                <h4 className="text-[16px] font-medium text-white tracking-tight">Active Secrets</h4>
                <span className="text-[13px] text-[#8c8c8c] bg-[#141414] border border-[#262626] px-2 py-0.5 rounded-full font-sans">
                  {selectedKey?.retiringSecret ? '2 active' : '1 active'}
                </span>
              </div>
              <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                Credentials authorized for this key.
              </p>
            </div>

            <div className="space-y-3">

              {/* Primary Active Secret */}
              <div className="rounded-[8px] border border-[#262626] bg-[#121212] p-3.5 flex items-center justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] text-white font-medium truncate">
                      {selectedKey?.currentSecretMasked || 'axk_live_••••••••••••••••'}
                    </span>
                    <span className="text-[11px] font-medium text-[#30a46c] bg-[#30a46c]/10 border border-[#30a46c]/20 px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0">
                      <span className="size-1.5 rounded-full bg-[#30a46c]" />
                      Primary
                    </span>
                  </div>
                  <p className="text-[12px] text-[#8c8c8c]">
                    Primary credential currently in effect
                  </p>
                </div>
              </div>

              {/* Retiring Secret in Grace Period */}
              {selectedKey?.retiringSecret ? (
                <div className="rounded-[8px] border border-[#f59e0b]/30 bg-[#f59e0b]/5 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[13px] text-[#cccccc] font-medium truncate">
                        {selectedKey.retiringSecret.maskedSecret}
                      </span>
                      <span className="text-[11px] font-medium text-[#f59e0b] bg-[#f59e0b]/10 border border-[#f59e0b]/20 px-1.5 py-0.5 rounded shrink-0">
                        Retiring ({selectedKey.retiringSecret.gracePeriod})
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setConfirmRevokeRetiringOpen(true)}
                      className="text-[12px] font-medium text-[#e5484d] hover:text-white hover:bg-[#e5484d] border border-[#e5484d]/30 px-2 py-1 rounded transition-colors cursor-pointer shrink-0"
                      title="Immediately invalidate the retiring secret"
                    >
                      Revoke Now
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 text-[12px] text-[#f59e0b]">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {formatRemainingTime(selectedKey.retiringSecret.expiresTimestamp)} · Expires {selectedKey.retiringSecret.expiresAt}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-[6px] border border-dashed border-[#262626] bg-[#0c0c0c] p-3 text-center text-[12px] text-[#666666]">
                  No previous secret in transition. Only the primary secret is active.
                </div>
              )}
            </div>
          </div>
        )}

        {manageTab === 'danger' && (
          <div className="flex-1 p-5 overflow-y-auto">
            <div className="rounded-[8px] border border-[#3a1515] bg-[#0e0404] p-4">
              <div className="text-[16px] font-medium text-[#e5484d] tracking-tight mb-1">Revoke API Key</div>
              <div className="text-[13px] text-[#8c8c8c] leading-relaxed mb-4">
                Permanently revoke <span className="text-white font-medium">{selectedKey?.name}</span>. All requests using this key will immediately fail.
              </div>
              <button
                type="button"
                onClick={() => setConfirmRevokeOpen(true)}
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
                  Revoke Key
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        {manageTab === 'edit' && (
          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans">
            <button
              type="button"
              onClick={() => setManageOpen(false)}
              className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!isModified}
              onClick={handleSaveEdit}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans text-[14px]"
            >
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]" />
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
              <span className="relative flex items-center gap-1.5 font-sans">
                Save
              </span>
            </button>
          </div>
        )}
      </SlideOver>

      {/* Revoke API Key Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmRevokeOpen}
        onClose={() => setConfirmRevokeOpen(false)}
        onConfirm={async () => {
          if (selectedKey) {
            try {
              await api.deleteKey(selectedKey.name);
              await loadKeys();
            } catch (err) {
              console.error('Failed to revoke API key:', err);
            }
          }
          setConfirmRevokeOpen(false);
          setManageOpen(false);
        }}
        title="Revoke API Key"
        description={
          <>
            Permanently revoke API key{' '}
            <span className="text-white font-medium">{selectedKey?.name}</span>?
            All client applications and services using this secret will immediately fail authorization.
          </>
        }
        confirmLabel="Revoke Key"
        cancelLabel="Cancel"
      />

      {/* Confirmation Dialog for Revoking Retiring Secret */}
      <ConfirmDialog
        isOpen={confirmRevokeRetiringOpen}
        onClose={() => setConfirmRevokeRetiringOpen(false)}
        onConfirm={handleRevokeRetiringSecret}
        title="Revoke Retiring Secret"
        description={
          <>
            Immediately invalidate the retiring secret for{' '}
            <span className="text-white font-medium">{selectedKey?.name}</span>?
            Any client application using this secret will immediately fail authorization.
          </>
        }
        confirmLabel="Revoke Secret"
        cancelLabel="Cancel"
      />

      {/* Confirmation Dialog for Secret Rotation (F-01) */}
      <ConfirmDialog
        isOpen={confirmRotateOpen}
        onClose={() => setConfirmRotateOpen(false)}
        onConfirm={executeRotateKey}
        title="Rotate API Key Secret"
        description={
          <>
            Rotate the cryptographic secret for key{' '}
            <span className="text-white font-medium">{selectedKey?.name}</span>?
            The previous secret will remain active for{' '}
            <span className="text-white font-medium">{selectedKey?.retiringSecret?.gracePeriod || gracePeriod}</span> before retiring.
          </>
        }
        confirmLabel={isRotating ? "Rotating..." : "Rotate Secret"}
        cancelLabel="Cancel"
      />

      {/* Secret Rotated Modal Dialog */}
      {rotateDialogOpen && newlyRotatedSecret && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 font-sans select-none animate-in fade-in duration-100"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-xs transition-opacity"
            onClick={closeRotateDialog}
            aria-hidden="true"
          />

          <div className="relative w-full max-w-[420px] rounded-[10px] bg-[#0c0c0c] border border-[#262626] shadow-2xl overflow-hidden font-sans animate-in zoom-in-95 duration-150 z-10 select-text">
            {/* Header & Body */}
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-medium text-white tracking-tight leading-snug font-sans">
                  Secret Rotated
                </h3>
                <button
                  type="button"
                  onClick={closeRotateDialog}
                  className="w-7 h-7 flex items-center justify-center text-[#888888] hover:text-white rounded-[6px] hover:bg-[#1a1a1a] transition-colors cursor-pointer shrink-0 -mr-1 -mt-1"
                  title="Close (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-[13px] text-[#8c8c8c] leading-relaxed font-sans">
                Copy your new secret. Old secret remains active for {selectedKey?.retiringSecret?.gracePeriod || gracePeriod}.
              </div>

              <div className="flex items-center gap-2">
                <input
                  type={showRotatedSecret ? "text" : "password"}
                  readOnly
                  value={newlyRotatedSecret}
                  className="h-9 flex-1 rounded-[6px] border border-[#262626] bg-[#050505] px-3 font-mono text-[13px] text-[#3b82f6] select-all outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowRotatedSecret((v) => !v)}
                  className="h-9 px-2.5 rounded-[6px] border border-[#262626] bg-[#141414] hover:bg-[#1c1c1c] text-[#8c8c8c] hover:text-white text-[13px] flex items-center justify-center cursor-pointer transition-colors shrink-0"
                  title={showRotatedSecret ? "Hide secret" : "Show secret"}
                >
                  {showRotatedSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(newlyRotatedSecret);
                      setCopiedRotatedKey(true);
                      setTimeout(() => setCopiedRotatedKey(false), 2000);
                    } catch {
                      // Clipboard copy error
                    }
                  }}
                  className="h-9 px-3 rounded-[6px] border border-[#262626] bg-[#141414] hover:bg-[#1c1c1c] text-[#cccccc] hover:text-white text-[13px] font-medium transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  {copiedRotatedKey ? <Check className="w-3.5 h-3.5 text-[#30a46c]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedRotatedKey ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="px-5 py-3.5 bg-[#0e0e0e] border-t border-[#222222] flex items-center justify-end font-sans">
              <button
                type="button"
                onClick={closeRotateDialog}
                className="group relative flex shrink-0 items-center justify-center h-8 px-4 rounded-[8px] font-medium text-black shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-white/90 bg-white font-sans text-[13px]"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-white to-[#e5e5e5] shadow-[inset_0_1px_0_0_rgba(255,255,255,1)]"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-10 transition-opacity duration-200"
                />
                <span className="relative flex items-center gap-1.5 font-sans font-medium text-black">
                  Done
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

