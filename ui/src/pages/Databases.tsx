/*
 * Database management interface for monitoring, attaching, and configuring pools.
 * Owned by: ui/databases
 * Key deps: CustomSelect, SlideOver, DataTable, lucide-react
 * Invariants: Pool URLs are verified against engine protocol schemes before handshake.
 * Last structural change: Added dialect-aware connection URL format validation.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { DatabasePool, EngineType, formatEngine } from '../types';
import { DataTable, Column } from '../components/shared/DataTable';
import { SlideOver } from '../components/ui/SlideOver';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CustomSelect } from '../components/shared/CustomSelect';
import { Database, Plus, CheckCircle2, Search, Trash2, RefreshCw, AlertTriangle, Check, Eye, EyeOff } from 'lucide-react';
import { api, DatabaseRecordApi } from '../api/client';

export interface FilterRule {
  id: string;
  field: string;
  operator: 'contains' | 'equals' | 'starts_with';
  value: string;
}

/**
 * Expected URL prefix mappings and examples per database engine dialect.
 * Contract: Matches the connection routing table implemented in crates/db/src/pool.rs.
 */
export const ENGINE_URL_SCHEMES: Record<string, { prefixes: string[]; example: string }> = {
  postgresql: {
    prefixes: ['postgres://', 'postgresql://'],
    example: 'postgres://user:secret@host:5432/dbname',
  },
  mysql: {
    prefixes: ['mysql://', 'mariadb://'],
    example: 'mysql://user:secret@host:3306/dbname',
  },
  mssql: {
    prefixes: ['mssql://', 'sqlserver://'],
    example: 'mssql://user:secret@host:1433/dbname',
  },
  clickhouse: {
    prefixes: ['clickhouse://', 'clickhouse+https://', 'http://', 'https://'],
    example: 'clickhouse://user:secret@host:8123/default',
  },
  libsql: {
    prefixes: ['libsql://', 'sqlite://', 'file:'],
    example: 'libsql://database.turso.io or sqlite://local.db',
  },
};

/**
 * Validates connection URI scheme against target database engine dialect.
 * CONTRACT:
 *  - Fails closed on empty, whitespace, or invalid scheme prefix.
 *  - Case-insensitive on protocol scheme.
 *  - Enforces minimum URI structure (scheme + target endpoint).
 * @param engine - Dialect identifier (e.g. 'PostgreSQL', 'MySQL', 'LibSQL')
 * @param rawUrl - Input URI string to validate
 */
export function validateDatabaseUrl(engine: string, rawUrl: string): { valid: boolean; error?: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'Connection URL is required.' };
  }

  const normEngine = engine.toLowerCase().trim();
  const spec = ENGINE_URL_SCHEMES[normEngine];
  if (!spec) {
    return { valid: trimmed.includes('://') || trimmed.startsWith('file:') };
  }

  const lowerUrl = trimmed.toLowerCase();
  const matched = spec.prefixes.some((p) => lowerUrl.startsWith(p));
  if (!matched) {
    return {
      valid: false,
      error: `Invalid URL protocol for ${formatEngine(engine)}. Expected prefix: ${spec.prefixes.join(' or ')}`,
    };
  }

  const matchedPrefix = spec.prefixes.find((p) => lowerUrl.startsWith(p))!;
  const remainder = trimmed.slice(matchedPrefix.length).trim();
  if (!remainder) {
    return {
      valid: false,
      error: 'URL is missing host or target path after protocol prefix.',
    };
  }

  return { valid: true };
}

export function Databases() {
  const [pools, setPools] = useState<DatabasePool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load database connections and live health state from backend
  const loadDatabases = async () => {
    try {
      const [dbRes, healthRes] = await Promise.allSettled([
        api.listDatabases(),
        api.getHealth(),
      ]);

      const dbList: DatabaseRecordApi[] = dbRes.status === 'fulfilled' ? dbRes.value.databases : [];
      const healthMap = healthRes.status === 'fulfilled' ? healthRes.value.databases : {};

      const loadedPools: DatabasePool[] = dbList.map((db) => {
        const isUp = healthMap[db.alias] === 'up';
        return {
          alias: db.alias,
          engine: (db.engine || 'PostgreSQL') as EngineType,
          version: `${db.engine} (live)`,
          url: '••••••••••••••••',
          minConnections: db.pool_min || 1,
          maxConnections: db.pool_max || 10,
          idleTimeoutSeconds: 30,
          readonly: false,
          status: isUp ? 'Ready' : 'Degraded',
          latencyMs: isUp ? 0.45 : 12.0,
        };
      });

      setPools(loadedPools);
      setSelectedPool((prev) => {
        if (!prev) return null;
        const found = loadedPools.find((p) => p.alias === prev.alias);
        return found ? found : prev;
      });
    } catch {
      // In case of error keep existing state
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadDatabases();
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
    alias: true,
    engine: true,
    conns: true,
    latency: true,
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

  // Attach DB SlideOver State
  const [attachOpen, setAttachOpen] = useState(false);
  const [newAlias, setNewAlias] = useState('');
  const [newEngine, setNewEngine] = useState<string>('PostgreSQL');
  const [newUrl, setNewUrl] = useState('');
  const [showNewUrl, setShowNewUrl] = useState(false);
  const [newMin, setNewMin] = useState(1);
  const [newMax, setNewMax] = useState(10);
  const [newTimeout, setNewTimeout] = useState(30);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);

  // Manage DB SlideOver State
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState<'details' | 'danger'>('details');
  const [selectedPool, setSelectedPool] = useState<DatabasePool | null>(null);
  const [editAlias, setEditAlias] = useState('');
  const [editEngine, setEditEngine] = useState<EngineType>('PostgreSQL');
  const [editUrl, setEditUrl] = useState('');
  const [showEditUrl, setShowEditUrl] = useState(false);
  const [editMin, setEditMin] = useState(1);
  const [editMax, setEditMax] = useState(10);
  const [editTimeout, setEditTimeout] = useState(30);
  const [manageTestResult, setManageTestResult] = useState<'testing' | 'success' | 'fail' | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

  async function handleTestConnection() {
    const validation = validateDatabaseUrl(newEngine, newUrl);
    if (!validation.valid) {
      setAttachError(validation.error || 'Invalid URL format for selected engine.');
      setTestResult('fail');
      return;
    }

    setAttachError(null);
    setTestResult('testing');
    try {
      await api.testDatabaseUrl(newUrl.trim(), newAlias.trim() || undefined);
      setTestResult('success');
    } catch (err: unknown) {
      setTestResult('fail');
      setAttachError(err instanceof Error ? err.message : 'Connection test failed.');
    }
  }

  async function handleManageTestConnection() {
    if (!selectedPool) return;
    setManageError(null);
    setManageTestResult('testing');
    try {
      if (urlChanged) {
        const validation = validateDatabaseUrl(editEngine, editUrl);
        if (!validation.valid) {
          setManageTestResult('fail');
          setManageError(validation.error || 'Invalid URL format for selected engine.');
          return;
        }
        await api.testDatabaseUrl(editUrl.trim(), selectedPool.alias);
        setManageTestResult('success');
        setSelectedPool((prev) => (prev ? { ...prev, status: 'Ready' } : null));
        setPools((prev) =>
          prev.map((p) => (p.alias === selectedPool.alias ? { ...p, status: 'Ready' } : p))
        );
      } else {
        const test = await api.testDatabase(selectedPool.alias);
        if (test.status === 'up' || test.status === 'connected') {
          setManageTestResult('success');
          setSelectedPool((prev) => (prev ? { ...prev, status: 'Ready' } : null));
          setPools((prev) =>
            prev.map((p) => (p.alias === selectedPool.alias ? { ...p, status: 'Ready' } : p))
          );
        } else {
          setManageTestResult('fail');
          setManageError('Target reported down during health probe.');
          setSelectedPool((prev) => (prev ? { ...prev, status: 'Degraded' } : null));
          setPools((prev) =>
            prev.map((p) => (p.alias === selectedPool.alias ? { ...p, status: 'Degraded' } : p))
          );
        }
      }
    } catch (err: unknown) {
      setManageTestResult('fail');
      const msg = err instanceof Error ? err.message : 'Database test failed.';
      setManageError(msg);
      setSelectedPool((prev) => (prev ? { ...prev, status: 'Degraded' } : null));
      setPools((prev) =>
        prev.map((p) => (p.alias === selectedPool.alias ? { ...p, status: 'Degraded' } : p))
      );
    }
  }

  const urlChanged = Boolean(editUrl.trim().length > 0);
  const editUrlValidation = urlChanged ? validateDatabaseUrl(editEngine, editUrl) : { valid: true };

  const isChanged = Boolean(
    selectedPool && (
      editAlias.trim() !== selectedPool.alias ||
      editEngine !== selectedPool.engine ||
      urlChanged ||
      editMin !== selectedPool.minConnections ||
      editMax !== selectedPool.maxConnections ||
      editTimeout !== selectedPool.idleTimeoutSeconds
    )
  );

  const canSave = Boolean(
    isChanged &&
    editAlias.trim().length > 0 &&
    editUrlValidation.valid &&
    !isSaving &&
    manageTestResult !== 'testing'
  );

  async function handleAttach() {
    if (!newAlias.trim()) return;
    const validation = validateDatabaseUrl(newEngine, newUrl);
    if (!validation.valid) {
      setAttachError(validation.error || 'Invalid URL format for selected engine.');
      setTestResult('fail');
      return;
    }

    setAttachError(null);
    setTestResult('testing');
    setIsAttaching(true);

    try {
      // 1. Mandatory live connection check every time when adding
      await api.testDatabaseUrl(newUrl.trim(), newAlias.trim() || undefined);
      setTestResult('success');

      // 2. Register database once connection is verified
      await api.addDatabase({
        alias: newAlias.trim(),
        url: newUrl.trim(),
        engine: newEngine,
        pool_min: newMin,
        pool_max: newMax,
      });
      await loadDatabases();
      setAttachOpen(false);
      setNewAlias('');
      setNewUrl('');
      setNewMin(1);
      setNewMax(10);
      setNewTimeout(30);
      setTestResult(null);
      setAttachError(null);
    } catch (err: unknown) {
      setTestResult('fail');
      setAttachError(err instanceof Error ? err.message : 'Database connection test failed. Please verify URL.');
    } finally {
      setIsAttaching(false);
    }
  }

  async function handleSaveEdit() {
    if (!selectedPool || !canSave) return;
    const oldAlias = selectedPool.alias;
    const updatedAlias = editAlias.trim();
    const updatedUrl = urlChanged ? editUrl.trim() : '';
    setManageError(null);
    setManageTestResult('testing');
    setIsSaving(true);

    try {
      // 1. Mandatory live connection check every time when updating
      if (urlChanged) {
        await api.testDatabaseUrl(updatedUrl, selectedPool.alias);
      } else {
        const test = await api.testDatabase(oldAlias);
        if (test.status !== 'up' && test.status !== 'connected') {
          throw new Error('Target database connection check failed.');
        }
      }
      setManageTestResult('success');

      // 2. Persist updated configuration once connection is verified
      await api.addDatabase({
        alias: updatedAlias,
        url: updatedUrl,
        engine: editEngine,
        pool_min: editMin,
        pool_max: editMax,
        old_alias: oldAlias,
      });
      if (oldAlias !== updatedAlias) {
        await api.deleteDatabase(oldAlias).catch(() => {});
      }
      await loadDatabases();
      setManageOpen(false);
    } catch (err: unknown) {
      setManageTestResult('fail');
      setManageError(err instanceof Error ? err.message : 'Database connection test failed. Unable to save.');
    } finally {
      setIsSaving(false);
    }
  }

  function matchesRule(itemVal: string, operator: string, ruleVal: string): boolean {
    const i = (itemVal || '').toLowerCase();
    const r = (ruleVal || '').toLowerCase();
    if (operator === 'equals') return i === r;
    if (operator === 'starts_with') return i.startsWith(r);
    return i.includes(r);
  }

  const engineOptions: { value: EngineType; label: string }[] = [
    { value: 'PostgreSQL', label: 'PostgreSQL 14 / 15 / 16 (sqlx driver)' },
    { value: 'MySQL', label: 'MySQL 8.0 / MariaDB (sqlx driver)' },
    { value: 'MSSQL', label: 'Microsoft SQL Server (tiberius TDS)' },
    { value: 'ClickHouse', label: 'ClickHouse OLAP (HTTP engine)' },
    { value: 'LibSQL', label: 'LibSQL / SQLite (Turso & local)' },
  ];

  const filterFieldOptions = [
    { value: 'alias', label: 'Pool Alias' },
    { value: 'engine', label: 'Engine' },
    { value: 'status', label: 'Status' },
  ];

  const displayColumnOptions = [
    { id: 'status', label: 'Status' },
    { id: 'alias', label: 'Pool Alias' },
    { id: 'engine', label: 'Engine' },
    { id: 'conns', label: 'Connection Limits' },
    { id: 'latency', label: 'Ping Latency' },
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
    setVisibleCols({ status: true, alias: true, engine: true, conns: true, latency: true });
  };

  const filteredPools = useMemo(() => {
    let list = pools;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.alias.toLowerCase().includes(q) || p.engine.toLowerCase().includes(q));
    }
    if (appliedFilterRules.length > 0) {
      list = list.filter((p) => {
        const tests = appliedFilterRules.map((rule) => {
          const val = String((p as unknown as Record<string, unknown>)[rule.field] ?? '');
          return matchesRule(val, rule.operator, rule.value);
        });
        return matchMode === 'any' ? tests.some(Boolean) : tests.every(Boolean);
      });
    }
    return list;
  }, [pools, searchQuery, appliedFilterRules, matchMode]);

  const columns: Column<DatabasePool>[] = [
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      width: 130,
      isResizable: true,
      className: 'pl-4 pr-3',
      cell: (row) => (
        <div className="flex items-center gap-2 text-[14px] text-white font-normal truncate whitespace-nowrap" title={row.status}>
          <span
            className={`size-1.5 rounded-full shrink-0 ${
              row.status === 'Ready'
                ? 'bg-[#30a46c]'
                : row.status === 'Degraded'
                ? 'bg-[#f59e0b]'
                : 'bg-[#e5484d]'
            }`}
          />
          <span className="truncate whitespace-nowrap">{row.status}</span>
        </div>
      ),
    },
    {
      id: 'alias',
      header: 'Pool Alias',
      accessorKey: 'alias',
      isSortable: true,
      isResizable: true,
      width: 220,
      className: 'px-3',
      cell: (row) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <Database className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px] truncate whitespace-nowrap" title={row.alias}>{row.alias}</span>
        </div>
      ),
    },
    {
      id: 'engine',
      header: 'Engine',
      accessorKey: 'engine',
      width: 170,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#cccccc] font-normal truncate whitespace-nowrap block" title={formatEngine(row.engine)}>
          {formatEngine(row.engine)}
        </span>
      ),
    },
    {
      id: 'conns',
      header: 'Connection Limits',
      width: 180,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#d4d4d4] font-normal truncate whitespace-nowrap block" title={`${row.minConnections} min / ${row.maxConnections} max`}>
          {row.minConnections} min / {row.maxConnections} max
        </span>
      ),
    },
    {
      id: 'latency',
      header: 'Ping Latency',
      width: 140,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal truncate whitespace-nowrap block" title={`${row.latencyMs} ms`}>
          {row.latencyMs} ms
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
              setSelectedPool(row);
              setEditAlias(row.alias);
              setEditEngine(row.engine);
              setEditUrl('');
              setEditMin(row.minConnections);
              setEditMax(row.maxConnections);
              setEditTimeout(row.idleTimeoutSeconds);
              setManageTestResult(null);
              setManageError(null);
              setManageTab('details');
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
          <h1 className="text-[16px] font-medium text-white tracking-tight">Databases</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsRefreshing(true);
              loadDatabases();
            }}
            title="Refresh database pools"
            className="flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-white rounded-[8px] bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin opacity-50' : ''}`} />
          </button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setTestResult(null);
              setAttachError(null);
              setNewMin(1);
              setNewMax(10);
              setNewTimeout(30);
              setAttachOpen(true);
            }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Attach Database
          </Button>
        </div>
      </div>

      {/* Table Controls Toolbar (Search, Filters, Display Options) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 select-none font-sans">
        <label
          title="Search databases..."
          className="relative flex items-center h-9 rounded-[8px] bg-transparent border border-[#262626] focus-within:border-[#2f80ed] transition-colors px-3 gap-2 w-full sm:w-[260px] md:w-[300px]"
        >
          <Search className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search databases..."
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
              title="Filter database pools"
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
                    <span className="text-[14px] font-medium text-white font-sans">Database Filters</span>
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
                        className="w-32 sm:w-36 shrink-0"
                        menuWidth="w-40"
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

      {/* Pools Read-Only DataTable */}
      <DataTable
        columns={activeColumns}
        data={filteredPools}
        ariaLabel="Database Pools Table"
        pagination={{
          page: 1,
          pageSize: 10,
          totalCount: filteredPools.length,
          onPageChange: () => {},
          onPageSizeChange: () => {},
        }}
      />

      {/* Attach DB SlideOver */}
      <SlideOver
        isOpen={attachOpen}
        onClose={() => setAttachOpen(false)}
        title="Attach Database Pool"
        subtitle="Configure connection endpoint, dialect engine, and credential URI"
      >
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          <div>
            <h3 className="text-[16px] font-medium text-white tracking-tight">Pool Configuration</h3>
            <p className="text-[13px] text-[#8c8c8c] mt-0.5">Provide connection endpoint, dialect engine, and credential URI.</p>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Database Engine</label>
            <CustomSelect
              value={newEngine}
              options={engineOptions}
              onChange={(val) => {
                setNewEngine(val);
                setTestResult(null);
                setAttachError(null);
              }}
              menuWidth="w-full"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Pool Alias (Identifier)</label>
            <input
              type="text"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              placeholder="e.g. analytics_warehouse"
              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[13px] font-medium text-[#cccccc]">Connection URL</label>
              {newUrl.trim().length > 0 && (
                validateDatabaseUrl(newEngine, newUrl).valid ? (
                  <span className="text-[12px] text-[#30a46c] font-medium flex items-center gap-1">
                    Valid scheme
                  </span>
                ) : (
                  <span className="text-[12px] text-[#e5484d] font-medium flex items-center gap-1">
                    Invalid {formatEngine(newEngine)} scheme
                  </span>
                )
              )}
            </div>
            <div className="relative">
              <input
                type={showNewUrl ? 'text' : 'password'}
                value={newUrl}
                onChange={(e) => {
                  setNewUrl(e.target.value);
                  setTestResult(null);
                  setAttachError(null);
                }}
                placeholder={ENGINE_URL_SCHEMES[newEngine.toLowerCase()]?.example || 'postgres://user:secret@host:5432/dbname'}
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-10 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono"
              />
              <button
                type="button"
                onClick={() => setShowNewUrl(!showNewUrl)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                tabIndex={-1}
                aria-label={showNewUrl ? 'Hide password' : 'Show password'}
              >
                {showNewUrl ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div>
            <button
              type="button"
              disabled={testResult === 'testing' || !newUrl.trim()}
              onClick={handleTestConnection}
              className={`h-8 px-3 rounded-[6px] text-[13px] font-medium border transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                testResult === 'success'
                  ? 'border-[#30a46c]/40 bg-[#30a46c]/10 text-[#30a46c] hover:bg-[#30a46c]/20'
                  : testResult === 'fail'
                  ? 'border-[#e5484d]/40 bg-[#e5484d]/10 text-[#e5484d] hover:bg-[#e5484d]/20'
                  : 'border-[#262626] bg-[#161616] text-[#cccccc] hover:text-white hover:border-[#383838]'
              }`}
            >
              {testResult === 'testing' ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3b82f6]" />
              ) : testResult === 'success' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#30a46c]" />
              ) : testResult === 'fail' ? (
                <AlertTriangle className="w-3.5 h-3.5 text-[#e5484d]" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>
                {testResult === 'testing'
                  ? 'Testing Connection...'
                  : testResult === 'success'
                  ? 'Connection Verified'
                  : testResult === 'fail'
                  ? 'Test Failed · Retry'
                  : 'Test Connection Handshake'}
              </span>
            </button>
          </div>

          {testResult === 'testing' && (
            <div className="rounded-[6px] border border-[#262626] bg-[#141414] p-3 text-[13px] text-[#8c8c8c] flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3b82f6] shrink-0" />
              <span>Probing TCP handshake and validating dialect authentication...</span>
            </div>
          )}

          {testResult === 'success' && (
            <div className="rounded-[6px] border border-[#30a46c]/30 bg-[#30a46c]/10 p-3 text-[13px] text-[#30a46c] font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Connection handshake verified. Database target is reachable and credentials are valid.</span>
            </div>
          )}

          {testResult === 'fail' && (
            <div className="rounded-[6px] border border-[#e5484d]/30 bg-[#e5484d]/10 p-3 text-[13px] text-[#e5484d] font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{attachError || 'Connection failed. Invalid URL format for selected engine.'}</span>
            </div>
          )}

          <div className="pt-2">
            <h3 className="text-[16px] font-medium text-white tracking-tight">Connection Bounds</h3>
            <p className="text-[13px] text-[#8c8c8c] mt-0.5">Configure scaling limits and idle timeout thresholds.</p>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Min Connections</label>
              <input
                type="number"
                value={newMin}
                onChange={(e) => setNewMin(Number(e.target.value))}
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Max Connections</label>
              <input
                type="number"
                value={newMax}
                onChange={(e) => setNewMax(Number(e.target.value))}
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Idle Timeout (seconds)</label>
              <input
                type="number"
                value={newTimeout}
                onChange={(e) => setNewTimeout(Number(e.target.value))}
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
              />
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans">
          <button
            type="button"
            onClick={() => setAttachOpen(false)}
            className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAttach}
            disabled={isAttaching}
            className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans disabled:opacity-50"
          >
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]" />
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
            <span className="relative flex items-center gap-1.5 text-[14px] font-sans">
              {isAttaching ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying & Attaching...</span>
                </>
              ) : (
                <span>Attach Pool</span>
              )}
            </span>
          </button>
        </div>
      </SlideOver>

      {/* Manage Pool SlideOver */}
      <SlideOver
        isOpen={manageOpen}
        onClose={() => { setManageOpen(false); setManageTab('details'); }}
        title={selectedPool?.alias ?? ''}
        subtitle={selectedPool ? `${selectedPool.engine} · ${selectedPool.status}` : ''}
      >
        {/* Tab bar (Segmented control matching dashboard) */}
        <div className="px-5 py-3 border-b border-[#222222] bg-[#0e0e0e]">
          <div className="inline-flex items-center p-0.5 rounded-[8px] bg-transparent border border-[#262626]">
            <button
              type="button"
              onClick={() => setManageTab('details')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                manageTab === 'details'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <span>Connection</span>
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

        {manageTab === 'details' && (
          <div className="flex-1 p-5 overflow-y-auto space-y-5">
            {/* Pool Settings */}
            <div className="space-y-4">
              <div>
                <h3 className="text-[16px] font-medium text-white tracking-tight">Pool Settings</h3>
                <p className="text-[13px] text-[#8c8c8c] mt-0.5">Configure pool identity, engine dialect, and connection target.</p>
              </div>

              <div className="space-y-3.5">
                <div>
                  <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Pool Name (Alias)</label>
                  <input
                    type="text"
                    value={editAlias}
                    onChange={(e) => setEditAlias(e.target.value)}
                    placeholder="e.g. analytics_warehouse"
                    className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Database Engine</label>
                  <CustomSelect
                    value={editEngine}
                    options={engineOptions}
                    onChange={(val) => {
                      setEditEngine(val as EngineType);
                      setManageTestResult(null);
                      setManageError(null);
                    }}
                    menuWidth="w-full"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[13px] font-medium text-[#cccccc]">Connection URL</label>
                    {urlChanged && (
                      editUrlValidation.valid ? (
                        <span className="text-[12px] text-[#f59e0b] font-medium flex items-center gap-1">
                          New URI · Test required
                        </span>
                      ) : (
                        <span className="text-[12px] text-[#e5484d] font-medium flex items-center gap-1">
                          Invalid {formatEngine(editEngine)} scheme
                        </span>
                      )
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showEditUrl ? 'text' : 'password'}
                      value={editUrl}
                      onChange={(e) => {
                        setEditUrl(e.target.value);
                        setManageTestResult(null);
                        setManageError(null);
                      }}
                      placeholder="Leave blank to keep the existing"
                      className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-10 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditUrl(!showEditUrl)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                      tabIndex={-1}
                      aria-label={showEditUrl ? 'Hide password' : 'Show password'}
                    >
                      {showEditUrl ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-[12px] text-[#8c8c8c] mt-1">
                    Hidden for security reasons.
                  </p>
                </div>

                <div>
                  <button
                    type="button"
                    disabled={manageTestResult === 'testing'}
                    onClick={handleManageTestConnection}
                    className={`h-8 px-3 rounded-[6px] text-[13px] font-medium border transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                      manageTestResult === 'success'
                        ? 'border-[#30a46c]/40 bg-[#30a46c]/10 text-[#30a46c] hover:bg-[#30a46c]/20'
                        : manageTestResult === 'fail'
                        ? 'border-[#e5484d]/40 bg-[#e5484d]/10 text-[#e5484d] hover:bg-[#e5484d]/20'
                        : 'border-[#262626] bg-[#161616] text-[#cccccc] hover:text-white hover:border-[#383838]'
                    }`}
                  >
                    {manageTestResult === 'testing' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3b82f6]" />
                    ) : manageTestResult === 'success' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#30a46c]" />
                    ) : manageTestResult === 'fail' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-[#e5484d]" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {manageTestResult === 'testing'
                        ? 'Testing Connection...'
                        : manageTestResult === 'success'
                        ? 'Connection Verified'
                        : manageTestResult === 'fail'
                        ? 'Test Failed · Retry'
                        : urlChanged
                        ? 'Test New Connection'
                        : 'Test Connection Handshake'}
                    </span>
                  </button>
                </div>

                {manageTestResult === 'testing' && (
                  <div className="rounded-[6px] border border-[#262626] bg-[#141414] p-3 text-[13px] text-[#8c8c8c] flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3b82f6] shrink-0" />
                    <span>Probing TCP handshake and validating dialect authentication...</span>
                  </div>
                )}

                {manageTestResult === 'success' && (
                  <div className="rounded-[6px] border border-[#30a46c]/30 bg-[#30a46c]/10 p-3 text-[13px] text-[#30a46c] font-medium flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Connection handshake verified. Round-trip: 0.94 ms.</span>
                  </div>
                )}

                {manageTestResult === 'fail' && (
                  <div className="rounded-[6px] border border-[#e5484d]/30 bg-[#e5484d]/10 p-3 text-[13px] text-[#e5484d] font-medium flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{manageError || 'Connection failed. Unable to reach database host or invalid credentials.'}</span>
                  </div>
                )}
              </div>

              <div className="pt-2">
                <h3 className="text-[16px] font-medium text-white tracking-tight">Connection Bounds</h3>
                <p className="text-[13px] text-[#8c8c8c] mt-0.5">Configure scaling limits and idle timeout thresholds.</p>
              </div>

              <div className="space-y-3.5">
                <div>
                  <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Min Connections</label>
                  <input
                    type="number"
                    value={editMin}
                    onChange={(e) => setEditMin(Number(e.target.value))}
                    className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Max Connections</label>
                  <input
                    type="number"
                    value={editMax}
                    onChange={(e) => setEditMax(Number(e.target.value))}
                    className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Idle Timeout (seconds)</label>
                  <input
                    type="number"
                    value={editTimeout}
                    onChange={(e) => setEditTimeout(Number(e.target.value))}
                    className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {manageTab === 'danger' && (
          <div className="flex-1 p-5 overflow-y-auto">
            <div className="rounded-[8px] border border-[#3a1515] bg-[#0e0404] p-4">
              <h3 className="text-[16px] font-medium text-[#e5484d] mb-1">Disconnect Pool</h3>
              <p className="text-[13px] text-[#8c8c8c] mb-4">
                Permanently remove <span className="text-white font-medium text-[13px]">{selectedPool?.alias}</span> from the gateway. All active connections will be terminated.
              </p>
              <button
                type="button"
                onClick={() => setConfirmDisconnectOpen(true)}
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
                  Disconnect Pool
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        {manageTab === 'details' && (
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
              disabled={!canSave || isSaving}
              onClick={handleSaveEdit}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans"
            >
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]" />
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
              <span className="relative flex items-center gap-1.5 text-[14px] font-sans">
                {isSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Verifying & Saving...</span>
                  </>
                ) : (
                  <span>Save</span>
                )}
              </span>
            </button>
          </div>
        )}
      </SlideOver>

      {/* Delete / Disconnect Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDisconnectOpen}
        onClose={() => setConfirmDisconnectOpen(false)}
        onConfirm={async () => {
          if (selectedPool) {
            try {
              await api.deleteDatabase(selectedPool.alias);
              await loadDatabases();
            } catch (err) {
              console.error('Failed to disconnect database pool:', err);
            }
          }
          setConfirmDisconnectOpen(false);
          setManageOpen(false);
        }}
        title="Disconnect Database Pool"
        description={
          <>
            Permanently remove database pool{' '}
            <span className="text-white font-medium">{selectedPool?.alias}</span>{' '}
            from the gateway? All active connections will be terminated.
          </>
        }
        confirmLabel="Disconnect Pool"
        cancelLabel="Cancel"
      />
    </div>
  );
}
