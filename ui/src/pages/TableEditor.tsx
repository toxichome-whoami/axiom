/*
 * Supabase Studio and Neon inspired multi-pane Table Editor, Schema Visualizer, and SQL Console.
 * Owned by: ui/pages
 * Key deps: lucide-react, ../api/client, ../types, ../components/ui/ConfirmDialog
 * Invariants: Single source of truth for active database and table; lock-free editing via right panel inspector; zero slop.
 * Last structural change: Complete redesign into 3-pane grid architecture matching StoragePage.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Table as TableIcon,
  Columns,
  Terminal,
  Search,
  RefreshCw,
  Plus,
  Trash2,
  Filter,
  ArrowUpDown,
  Key,
  Link2,
  Hash,
  Type,
  Clock,
  CheckSquare,
  Code2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  AlertCircle,
  Database,
  X,
  Play,
  ArrowRight,
  Info,
  Save,
  FileCode,
  Layers,
  Edit3,
} from 'lucide-react';
import {
  api,
  DatabaseRecordApi,
} from '../api/client';
import {
  TableInfoApi,
  ColumnInfoApi,
  ForeignKeyInfoApi,
  QueryResultApi,
} from '../types';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

// ─── Type Icon Mapping ───────────────────────────────────────────────────────
// Maps SQL column types to compact Supabase-style visual badges.

function getColumnTypeBadge(typeName: string, isPk: boolean, isFk: boolean) {
  const norm = (typeName || '').toLowerCase();

  if (isPk) {
    return {
      icon: Key,
      label: typeName || 'PK',
      color: 'text-[#8c8c8c]',
    };
  }
  if (isFk) {
    return {
      icon: Link2,
      label: typeName || 'FK',
      color: 'text-[#8c8c8c]',
    };
  }

  if (
    norm.includes('int') ||
    norm.includes('float') ||
    norm.includes('double') ||
    norm.includes('decimal') ||
    norm.includes('numeric') ||
    norm.includes('real')
  ) {
    return {
      icon: Hash,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }
  if (norm.includes('char') || norm.includes('text') || norm.includes('string')) {
    return {
      icon: Type,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }
  if (norm.includes('time') || norm.includes('date')) {
    return {
      icon: Clock,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }
  if (norm.includes('bool')) {
    return {
      icon: CheckSquare,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }
  if (norm.includes('json') || norm.includes('array')) {
    return {
      icon: Code2,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }

  return {
    icon: Type,
    label: typeName || 'text',
    color: 'text-[#8c8c8c]',
  };
}

export function TableEditor() {
  // ─── Database Selection State ──────────────────────────────────────────────
  const [databases, setDatabases] = useState<DatabaseRecordApi[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [isDbsLoading, setIsDbsLoading] = useState(true);
  const [isDbDropdownOpen, setIsDbDropdownOpen] = useState(false);
  const dbDropdownRef = useRef<HTMLDivElement>(null);

  // ─── View Modes: 'grid' (Table Editor) | 'schema' (Schema & Relations) | 'sql' (SQL Console) ─
  const [viewMode, setViewMode] = useState<'grid' | 'schema' | 'sql'>('grid');

  // ─── Table Catalog State ───────────────────────────────────────────────────
  const [tables, setTables] = useState<TableInfoApi[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [tableSearch, setTableSearch] = useState('');
  const [isTablesLoading, setIsTablesLoading] = useState(false);

  // ─── Schema Metadata State ─────────────────────────────────────────────────
  const [columns, setColumns] = useState<ColumnInfoApi[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfoApi[]>([]);
  const [isSchemaLoading, setIsSchemaLoading] = useState(false);
  const [allDbTablesSchema, setAllDbTablesSchema] = useState<
    Record<string, { columns: ColumnInfoApi[]; foreign_keys: ForeignKeyInfoApi[] }>
  >({});

  // ─── Data Grid Rows & Pagination ───────────────────────────────────────────
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [isRowsLoading, setIsRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<number>(50);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);

  // Filter & Sort State
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const [filterCol, setFilterCol] = useState('');
  const [filterOp, setFilterOp] = useState<'eq' | 'neq' | 'gt' | 'lt' | 'like' | 'is_null'>('eq');
  const [filterVal, setFilterVal] = useState('');
  const [activeFilter, setActiveFilter] = useState<{ col: string; op: string; val: string } | null>(null);

  const [showSortPopover, setShowSortPopover] = useState(false);
  const [sortCol, setSortCol] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [activeSort, setActiveSort] = useState<{ col: string; order: 'asc' | 'desc' } | null>(null);

  // ─── Pane 3: Right Details / Edit Inspector ────────────────────────────────
  const [isDetailsOpen, setIsDetailsOpen] = useState(true);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [rowEditValues, setRowEditValues] = useState<Record<string, unknown>>({});
  const [isSavingRow, setIsSavingRow] = useState(false);
  const [isInsertModeInPanel, setIsInsertModeInPanel] = useState(false);

  // Delete Row State
  const [deleteRowTarget, setDeleteRowTarget] = useState<Record<string, unknown> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Copy feedback state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // ─── SQL Console State ─────────────────────────────────────────────────────
  const [sqlQuery, setSqlQuery] = useState('');
  const [isExecutingSql, setIsExecutingSql] = useState(false);
  const [sqlResult, setSqlResult] = useState<QueryResultApi | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlDuration, setSqlDuration] = useState<number | null>(null);

  // ER Diagram focused table state
  const [focusedErTable, setFocusedErTable] = useState<string | null>(null);

  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const sortPopoverRef = useRef<HTMLDivElement>(null);

  // ─── 1. Load Connected Database Pools ──────────────────────────────────────
  useEffect(() => {
    async function initDatabases() {
      setIsDbsLoading(true);
      try {
        const res = await api.listDatabases();
        const dbs = res.databases || [];
        setDatabases(dbs);

        // Read query param if jumped from Databases page
        const urlParams = new URLSearchParams(window.location.search);
        const queryDb = urlParams.get('db');
        const defaultDb = queryDb && dbs.some((d) => d.alias === queryDb) ? queryDb : dbs[0]?.alias || '';

        setSelectedDb(defaultDb);
      } catch (err) {
        console.error('Failed to load database pools:', err);
      } finally {
        setIsDbsLoading(false);
      }
    }
    initDatabases();
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dbDropdownRef.current && !dbDropdownRef.current.contains(e.target as Node)) {
        setIsDbDropdownOpen(false);
      }
      if (filterPopoverRef.current && !filterPopoverRef.current.contains(e.target as Node)) {
        setShowFilterPopover(false);
      }
      if (sortPopoverRef.current && !sortPopoverRef.current.contains(e.target as Node)) {
        setShowSortPopover(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ─── 2. Load Tables when Database changes ──────────────────────────────────
  const fetchTables = useCallback(async (db: string) => {
    if (!db) return;
    setIsTablesLoading(true);
    try {
      const res = await api.getDatabaseTables(db, undefined, 500);
      const tableList = res.tables || [];
      setTables(tableList);

      setSelectedTable((prev) => {
        if (prev && tableList.some((t: TableInfoApi) => t.name === prev)) return prev;
        return tableList[0]?.name || '';
      });
    } catch (err) {
      console.error(`Failed to load tables for ${db}:`, err);
      setTables([]);
      setSelectedTable('');
    } finally {
      setIsTablesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedDb) {
      fetchTables(selectedDb);
      setCursor(null);
      setCursorHistory([]);
      setActiveFilter(null);
      setActiveSort(null);
      setSelectedRowIndex(null);
    }
  }, [selectedDb, fetchTables]);

  // ─── 3. Load Schema (Columns & Foreign Keys) for selected table ────────────
  const fetchSchema = useCallback(async (db: string, table: string) => {
    if (!db || !table) {
      setColumns([]);
      setForeignKeys([]);
      return;
    }
    setIsSchemaLoading(true);
    try {
      const res = await api.getTableSchema(db, table);
      setColumns(res.columns || []);
      setForeignKeys(res.foreign_keys || []);

      setAllDbTablesSchema((prev) => ({
        ...prev,
        [table]: {
          columns: res.columns || [],
          foreign_keys: res.foreign_keys || [],
        },
      }));
    } catch (err) {
      console.error(`Failed to load schema for ${db}.${table}:`, err);
      setColumns([]);
      setForeignKeys([]);
    } finally {
      setIsSchemaLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedDb && selectedTable) {
      fetchSchema(selectedDb, selectedTable);
      setCursor(null);
      setCursorHistory([]);
      setSelectedRowIndex(null);
      setIsInsertModeInPanel(false);
    }
  }, [selectedDb, selectedTable, fetchSchema]);

  // Pre-fetch schema for all tables in background for ER diagram
  useEffect(() => {
    if (!selectedDb || tables.length === 0) return;
    tables.forEach((t) => {
      api.getTableSchema(selectedDb, t.name).then((res) => {
        setAllDbTablesSchema((prev) => {
          if (prev[t.name]) return prev;
          return {
            ...prev,
            [t.name]: {
              columns: res.columns || [],
              foreign_keys: res.foreign_keys || [],
            },
          };
        });
      }).catch(() => {});
    });
  }, [selectedDb, tables]);

  // ─── 4. Load Rows for selected table ───────────────────────────────────────
  const fetchRows = useCallback(
    async (targetCursor?: string | null) => {
      if (!selectedDb || !selectedTable) {
        setRows([]);
        return;
      }
      setIsRowsLoading(true);
      setRowsError(null);

      try {
        let filterParam: string | undefined;
        if (activeFilter) {
          filterParam = JSON.stringify({
            [activeFilter.col]: { [activeFilter.op]: activeFilter.val },
          });
        }

        const res = await api.getTableRows(selectedDb, selectedTable, {
          cursor: targetCursor || undefined,
          limit: pageSize,
          sort: activeSort?.col,
          order: activeSort?.order,
          filter: filterParam,
        });

        const rowsData = res.rows || [];
        const pagination = res.pagination;

        setRows(rowsData);
        setHasNextPage(!!pagination?.has_more);
        setCursor(pagination?.next_cursor || null);

        // Keep selected row in bounds
        setSelectedRowIndex((prev) => (prev !== null && prev < rowsData.length ? prev : null));
      } catch (err: unknown) {
        setRowsError(err instanceof Error ? err.message : 'Failed to query table rows');
        setRows([]);
      } finally {
        setIsRowsLoading(false);
      }
    },
    [selectedDb, selectedTable, pageSize, activeFilter, activeSort]
  );

  useEffect(() => {
    if (selectedDb && selectedTable && viewMode === 'grid') {
      fetchRows();
    }
  }, [selectedDb, selectedTable, viewMode, fetchRows]);

  // Select row handler
  const handleSelectRow = (index: number) => {
    setSelectedRowIndex(index);
    setIsInsertModeInPanel(false);
    setIsDetailsOpen(true);
    if (rows[index]) {
      setRowEditValues({ ...rows[index] });
    }
  };

  // ─── Save Row from Right Panel Inspector ───────────────────────────────────
  async function handleSaveRowEdit() {
    if (!selectedDb || !selectedTable || selectedRowIndex === null) return;
    const originalRow = rows[selectedRowIndex];
    if (!originalRow) return;

    setIsSavingRow(true);
    try {
      // Find PK column or use original row as filter
      const pkCol = columns.find((c) => c.primary_key);
      const filter: Record<string, unknown> = {};

      if (pkCol && originalRow[pkCol.name] !== undefined) {
        filter[pkCol.name] = { eq: originalRow[pkCol.name] };
      } else {
        // Fallback: match 2 non-null columns
        let count = 0;
        Object.entries(originalRow).forEach(([k, v]) => {
          if (count < 2 && v !== null && v !== undefined) {
            filter[k] = { eq: v };
            count++;
          }
        });
      }

      // Prepare updated fields
      const updates: Record<string, unknown> = {};
      columns.forEach((col) => {
        const val = rowEditValues[col.name];
        if (val !== originalRow[col.name]) {
          updates[col.name] = val;
        }
      });

      if (Object.keys(updates).length > 0) {
        await api.updateTableRow(selectedDb, selectedTable, filter, updates);
        await fetchRows();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update row');
    } finally {
      setIsSavingRow(false);
    }
  }

  // ─── Insert Row from Right Panel Inspector ─────────────────────────────────
  async function handleInsertRowFromPanel() {
    if (!selectedDb || !selectedTable) return;

    setIsSavingRow(true);
    try {
      const payload: Record<string, unknown> = {};
      columns.forEach((col) => {
        const val = rowEditValues[col.name];
        if (val !== undefined && val !== '') {
          payload[col.name] = val;
        }
      });

      await api.insertTableRow(selectedDb, selectedTable, payload);
      setIsInsertModeInPanel(false);
      await fetchRows();
      setSelectedRowIndex(0);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to insert row');
    } finally {
      setIsSavingRow(false);
    }
  }

  // ─── Delete Row ────────────────────────────────────────────────────────────
  async function handleDeleteRow() {
    if (!selectedDb || !selectedTable || !deleteRowTarget) return;

    setIsDeleting(true);
    try {
      const pkCol = columns.find((c) => c.primary_key);
      const filter: Record<string, unknown> = {};

      if (pkCol && deleteRowTarget[pkCol.name] !== undefined) {
        filter[pkCol.name] = { eq: deleteRowTarget[pkCol.name] };
      } else {
        let count = 0;
        Object.entries(deleteRowTarget).forEach(([k, v]) => {
          if (count < 2 && v !== null && v !== undefined) {
            filter[k] = { eq: v };
            count++;
          }
        });
      }

      await api.deleteTableRow(selectedDb, selectedTable, filter);
      setDeleteRowTarget(null);
      setSelectedRowIndex(null);
      fetchRows();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete row');
    } finally {
      setIsDeleting(false);
    }
  }

  // ─── SQL Console Execution ─────────────────────────────────────────────────
  async function handleExecuteSql() {
    if (!selectedDb || !sqlQuery.trim()) return;

    setIsExecutingSql(true);
    setSqlError(null);
    setSqlResult(null);

    const startTime = performance.now();
    try {
      const res = await api.executeSqlQuery(selectedDb, sqlQuery.trim());
      const duration = Math.round(performance.now() - startTime);
      setSqlDuration(duration);
      setSqlResult(res);
    } catch (err) {
      setSqlError(err instanceof Error ? err.message : 'SQL Execution failed');
    } finally {
      setIsExecutingSql(false);
    }
  }

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const filteredTables = useMemo(() => {
    if (!tableSearch.trim()) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(tableSearch.toLowerCase()));
  }, [tables, tableSearch]);

  const activeRow = selectedRowIndex !== null ? rows[selectedRowIndex] : null;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:flex-row w-full h-full min-h-0 select-none font-sans overflow-hidden bg-[#0c0c0c]">
      {/* ══════════════════════════════════════════════════════════════════════
          PANE 1: LEFT NAVIGATOR (DATABASES & TABLE EXPLORER)
          ══════════════════════════════════════════════════════════════════════ */}
      <aside className="w-full lg:w-64 shrink-0 flex flex-col bg-[#0a0a0a] border-b lg:border-b-0 lg:border-r border-[#222222] overflow-hidden">
        {/* Database Dropdown Selector Header (h-[54px] matching StoragePage) */}
        <div className="h-[54px] shrink-0 px-3 border-b border-[#222222] flex items-center justify-between gap-2 relative">
          <div className="relative flex-1 min-w-0" ref={dbDropdownRef}>
            <button
              type="button"
              onClick={() => setIsDbDropdownOpen(!isDbDropdownOpen)}
              className="w-full h-8 px-2.5 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] flex items-center justify-between gap-2 text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 truncate min-w-0">
                <Database className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="text-[13px] font-medium text-white truncate">
                  {selectedDb || 'Select Database'}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[#777777] shrink-0" />
            </button>

            {/* Dropdown Popup */}
            {isDbDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-60 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans">
                <div className="px-2.5 py-1.5 text-[11px] font-medium text-[#777777] uppercase tracking-wider">
                  Database Connections
                </div>

                <div className="max-h-52 overflow-y-auto space-y-0.5 py-0.5">
                  {databases.length === 0 ? (
                    <div className="px-2.5 py-2 text-[12px] text-[#777777]">No databases found</div>
                  ) : (
                    databases.map((db) => {
                      const isActive = db.alias === selectedDb;
                      return (
                        <button
                          key={db.alias}
                          type="button"
                          onClick={() => {
                            setSelectedDb(db.alias);
                            setIsDbDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors cursor-pointer text-left ${
                            isActive
                              ? 'bg-[#1c1c1c] text-white font-medium'
                              : 'text-[#d4d4d4] hover:text-white hover:bg-[#161616]'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate min-w-0">
                            <Database className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-[#777777]'}`} />
                            <span className="truncate">{db.alias}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-[#777777]">
                            <span className="font-mono">{db.engine}</span>
                            {isActive && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick Reload Tables button */}
          <button
            type="button"
            onClick={() => fetchTables(selectedDb)}
            disabled={isTablesLoading}
            title="Refresh table list"
            className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] transition-colors cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTablesLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Live Search Input */}
        <div className="p-2.5 border-b border-[#222222]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#666666] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search tables..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-2.5 bg-[#141414] border border-[#242424] focus:border-[#383838] rounded-[6px] text-[12px] text-white placeholder-[#666666] outline-none transition-colors"
            />
          </div>
        </div>

        {/* Table Tree Items */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {isTablesLoading && tables.length === 0 ? (
            <div className="flex items-center justify-center p-8 text-zinc-500 text-[12px] gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Loading tables...
            </div>
          ) : filteredTables.length === 0 ? (
            <div className="p-8 text-center text-[#777777] text-[12px]">
              {tables.length === 0 ? 'No tables in schema' : 'No matching tables'}
            </div>
          ) : (
            filteredTables.map((t) => {
              const isSelected = selectedTable === t.name;
              return (
                <button
                  key={t.name}
                  onClick={() => {
                    setSelectedTable(t.name);
                    setSelectedRowIndex(null);
                    setIsInsertModeInPanel(false);
                    if (viewMode === 'sql' && !sqlQuery) {
                      setSqlQuery(`SELECT * FROM ${t.name} LIMIT 25;`);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-left transition-colors cursor-pointer text-[13px] ${
                    isSelected
                      ? 'bg-[#1a1a1a] text-white font-medium'
                      : 'text-[#a1a1aa] hover:text-white hover:bg-[#141414]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <TableIcon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-[#777777]'}`} />
                    <span className="font-mono truncate">{t.name}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Navigator Footer */}
        <div className="h-10 shrink-0 px-3 border-t border-[#222222] flex items-center justify-between text-[11.5px] text-[#777777]">
          <span>{tables.length} tables</span>
          <span className="font-mono text-[#555555]">Axiom v4.0</span>
        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════════════════════
          PANE 2: MAIN WORKSPACE CANVAS (GRID / SCHEMA / SQL)
          ══════════════════════════════════════════════════════════════════════ */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#0c0c0c]">
        {/* Workspace Top Toolbar (h-[54px] matching StoragePage) */}
        <div className="h-[54px] shrink-0 px-4 border-b border-[#222222] bg-[#0c0c0c] flex items-center justify-between gap-3 select-none">
          {/* Action Tools & View Mode Switcher (placed on the left) */}
          <div className="flex items-center gap-2 shrink-0">
            {viewMode === 'grid' && (
              <>
                {/* Insert Row Button */}
                <button
                  onClick={() => {
                    setSelectedRowIndex(null);
                    setRowEditValues({});
                    setIsInsertModeInPanel(true);
                    setIsDetailsOpen(true);
                  }}
                  disabled={!selectedTable}
                  className="flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] disabled:opacity-40 text-[#cccccc] hover:text-white text-[12px] font-medium transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Insert Row</span>
                </button>

                {/* Filter Popover */}
                <div className="relative" ref={filterPopoverRef}>
                  <button
                    onClick={() => setShowFilterPopover(!showFilterPopover)}
                    className={`flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] border text-[12px] font-medium transition-colors cursor-pointer ${
                      activeFilter
                        ? 'bg-blue-950/40 border-blue-600/50 text-blue-400'
                        : 'bg-[#141414] border-[#262626] text-[#cccccc] hover:border-[#383838]'
                    }`}
                  >
                    <Filter className="w-3.5 h-3.5" />
                    <span>Filter</span>
                    {activeFilter && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                  </button>

                  {showFilterPopover && (
                    <div className="absolute left-0 top-full mt-1.5 w-72 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-3 z-50">
                      <div className="text-[12px] font-medium text-white mb-2">Filter Records</div>
                      <div className="space-y-2">
                        <select
                          value={filterCol}
                          onChange={(e) => setFilterCol(e.target.value)}
                          className="w-full h-7 px-2 bg-[#161616] border border-[#2c2c2c] rounded text-[12px] text-white"
                        >
                          <option value="">Select column...</option>
                          {columns.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name} ({c.type})
                            </option>
                          ))}
                        </select>

                        <select
                          value={filterOp}
                          onChange={(e) => setFilterOp(e.target.value as typeof filterOp)}
                          className="w-full h-7 px-2 bg-[#161616] border border-[#2c2c2c] rounded text-[12px] text-white"
                        >
                          <option value="eq">Equals (=)</option>
                          <option value="neq">Not equals (!=)</option>
                          <option value="gt">Greater than (&gt;)</option>
                          <option value="lt">Less than (&lt;)</option>
                          <option value="like">Contains (LIKE)</option>
                          <option value="is_null">Is NULL</option>
                        </select>

                        {filterOp !== 'is_null' && (
                          <input
                            type="text"
                            placeholder="Value..."
                            value={filterVal}
                            onChange={(e) => setFilterVal(e.target.value)}
                            className="w-full h-7 px-2 bg-[#161616] border border-[#2c2c2c] rounded text-[12px] text-white placeholder-[#666666]"
                          />
                        )}

                        <div className="flex items-center justify-between pt-1">
                          <button
                            onClick={() => {
                              setActiveFilter(null);
                              setFilterCol('');
                              setFilterVal('');
                              setShowFilterPopover(false);
                            }}
                            className="text-[11.5px] text-[#8c8c8c] hover:text-white"
                          >
                            Clear
                          </button>
                          <button
                            onClick={() => {
                              if (filterCol) {
                                setActiveFilter({ col: filterCol, op: filterOp, val: filterVal });
                                setShowFilterPopover(false);
                              }
                            }}
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 rounded text-[11.5px] font-medium text-white"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sort Popover */}
                <div className="relative" ref={sortPopoverRef}>
                  <button
                    onClick={() => setShowSortPopover(!showSortPopover)}
                    className={`flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] border text-[12px] font-medium transition-colors cursor-pointer ${
                      activeSort
                        ? 'bg-blue-950/40 border-blue-600/50 text-blue-400'
                        : 'bg-[#141414] border-[#262626] text-[#cccccc] hover:border-[#383838]'
                    }`}
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    <span>Sort</span>
                  </button>

                  {showSortPopover && (
                    <div className="absolute left-0 top-full mt-1.5 w-64 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-3 z-50">
                      <div className="text-[12px] font-medium text-white mb-2">Sort Records</div>
                      <div className="space-y-2">
                        <select
                          value={sortCol}
                          onChange={(e) => setSortCol(e.target.value)}
                          className="w-full h-7 px-2 bg-[#161616] border border-[#2c2c2c] rounded text-[12px] text-white"
                        >
                          <option value="">Select column...</option>
                          {columns.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>

                        <div className="flex gap-2">
                          <button
                            onClick={() => setSortOrder('asc')}
                            className={`flex-1 h-7 rounded text-[11.5px] font-medium border ${
                              sortOrder === 'asc'
                                ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                                : 'bg-[#161616] border-[#2c2c2c] text-[#8c8c8c]'
                            }`}
                          >
                            ASC
                          </button>
                          <button
                            onClick={() => setSortOrder('desc')}
                            className={`flex-1 h-7 rounded text-[11.5px] font-medium border ${
                              sortOrder === 'desc'
                                ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                                : 'bg-[#161616] border-[#2c2c2c] text-[#8c8c8c]'
                            }`}
                          >
                            DESC
                          </button>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <button
                            onClick={() => {
                              setActiveSort(null);
                              setSortCol('');
                              setShowSortPopover(false);
                            }}
                            className="text-[11.5px] text-[#8c8c8c] hover:text-white"
                          >
                            Reset
                          </button>
                          <button
                            onClick={() => {
                              if (sortCol) {
                                setActiveSort({ col: sortCol, order: sortOrder });
                                setShowSortPopover(false);
                              }
                            }}
                            className="px-2.5 py-1 bg-[#222222] hover:bg-[#2a2a2a] border border-[#333333] rounded text-[11.5px] font-medium text-white transition-colors"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Reload Data Button */}
                <button
                  onClick={() => fetchRows()}
                  disabled={isRowsLoading}
                  title="Reload rows"
                  className="w-8 h-8 flex items-center justify-center rounded-[6px] bg-[#141414] border border-[#262626] text-[#8c8c8c] hover:text-white hover:border-[#383838] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRowsLoading ? 'animate-spin' : ''}`} />
                </button>
              </>
            )}

            {/* View Mode Switcher Pills (matching Storage view toggle) */}
            <div className="flex items-center p-0.5 rounded-[6px] bg-[#141414] border border-[#262626]">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                title="Table Grid"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-[12px] font-medium transition-colors cursor-pointer ${
                  viewMode === 'grid' ? 'bg-[#222222] text-white' : 'text-[#8c8c8c] hover:text-white'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Grid</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('schema')}
                title="Schema & Relations"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-[12px] font-medium transition-colors cursor-pointer ${
                  viewMode === 'schema' ? 'bg-[#222222] text-white' : 'text-[#8c8c8c] hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Schema</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('sql');
                  if (!sqlQuery && selectedTable) {
                    setSqlQuery(`SELECT * FROM ${selectedTable} LIMIT 25;`);
                  }
                }}
                title="SQL Console"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-[12px] font-medium transition-colors cursor-pointer ${
                  viewMode === 'sql' ? 'bg-[#222222] text-white' : 'text-[#8c8c8c] hover:text-white'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span className="hidden md:inline">SQL</span>
              </button>
            </div>

            {/* Toggle Inspector / Details Pane */}
            <button
              type="button"
              onClick={() => setIsDetailsOpen(!isDetailsOpen)}
              title={isDetailsOpen ? 'Hide inspector' : 'Show inspector'}
              className={`w-8 h-8 flex items-center justify-center rounded-[6px] border transition-colors cursor-pointer ${
                isDetailsOpen
                  ? 'bg-[#222222] border-[#383838] text-white'
                  : 'bg-[#141414] border-[#262626] text-[#8c8c8c] hover:text-white'
              }`}
            >
              <Info className="w-4 h-4" />
            </button>
          </div>

          {/* Right: Next and Previous Pagination Controls */}
          {viewMode === 'grid' && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => {
                  if (cursorHistory.length > 0) {
                    const newHistory = [...cursorHistory];
                    newHistory.pop();
                    const prevCursor = newHistory[newHistory.length - 1] || null;
                    setCursorHistory(newHistory);
                    fetchRows(prevCursor);
                  }
                }}
                disabled={cursorHistory.length === 0 || isRowsLoading}
                className="flex items-center gap-1 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] disabled:opacity-40 hover:text-white hover:border-[#383838] transition-colors cursor-pointer"
                title="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span className="text-[12px] font-medium">Previous</span>
              </button>

              <button
                onClick={() => {
                  if (hasNextPage && cursor) {
                    setCursorHistory([...cursorHistory, cursor]);
                    fetchRows(cursor);
                  }
                }}
                disabled={!hasNextPage || isRowsLoading}
                className="flex items-center gap-1 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] disabled:opacity-40 hover:text-white hover:border-[#383838] transition-colors cursor-pointer"
                title="Next page"
              >
                <span className="text-[12px] font-medium">Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* ─── Mode 1: Table Grid (Spreadsheet Editor) ─── */}
        {viewMode === 'grid' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
            <div className="flex-1 overflow-auto">
              {isRowsLoading && rows.length === 0 ? (
                <div className="flex items-center justify-center h-64 text-[#8c8c8c] text-[13px] gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                  Loading table data...
                </div>
              ) : rowsError ? (
                <div className="p-8 flex flex-col items-center justify-center text-center">
                  <AlertCircle className="w-8 h-8 text-rose-500 mb-2" />
                  <p className="text-[14px] font-medium text-white mb-1">Failed to query table</p>
                  <p className="text-[12.5px] text-[#8c8c8c] max-w-md font-mono">{rowsError}</p>
                  <button
                    onClick={() => fetchRows()}
                    className="mt-4 px-3 py-1.5 bg-[#141414] border border-[#262626] rounded-[6px] text-[12px] text-white hover:border-[#383838]"
                  >
                    Retry
                  </button>
                </div>
              ) : columns.length === 0 ? (
                <div className="p-12 text-center text-[#777777] text-[13px]">
                  No column schema found for table <span className="font-mono text-white">{selectedTable}</span>
                </div>
              ) : (
                <table className="w-full border-collapse text-left select-text font-mono text-[12.5px]">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-[#0a0a0a] border-b border-[#222222]">
                      {/* Row Index Sticky Column */}
                      <th className="w-12 px-2.5 py-2 text-[11px] font-mono text-[#666666] text-center bg-[#0a0a0a]">
                        #
                      </th>

                      {/* Dynamic Columns with Type Glyphs */}
                      {columns.map((col) => {
                        const isFk = foreignKeys.some((fk) => fk.column === col.name);
                        const badge = getColumnTypeBadge(col.type, col.primary_key, isFk);
                        const IconComp = badge.icon;

                        return (
                          <th
                            key={col.name}
                            className="px-3 py-2 text-[12px] font-medium text-[#cccccc] whitespace-nowrap min-w-[130px]"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-white text-[12.5px]">{col.name}</span>
                                {col.primary_key && (
                                  <span title="Primary Key" className="p-0.5 rounded bg-amber-500/10 text-amber-400">
                                    <Key className="w-3 h-3" />
                                  </span>
                                )}
                                {isFk && (
                                  <span title="Foreign Key" className="p-0.5 rounded bg-blue-500/10 text-blue-400">
                                    <Link2 className="w-3 h-3" />
                                  </span>
                                )}
                              </div>
                              <span
                                className={`inline-flex items-center gap-1 text-[11px] font-mono ${badge.color}`}
                              >
                                <IconComp className="w-3 h-3" />
                                {col.type}
                              </span>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-[#181818]">
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length + 1} className="p-12 text-center text-[#666666]">
                          Table contains 0 rows
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, idx) => {
                        const isSelected = selectedRowIndex === idx;
                        return (
                          <tr
                            key={idx}
                            onClick={() => handleSelectRow(idx)}
                            className={`transition-colors cursor-pointer group ${
                              isSelected
                                ? 'bg-[#121212] ring-1 ring-inset ring-[#222222] text-white'
                                : 'hover:bg-[#121212]'
                            }`}
                          >
                            {/* Row Index */}
                            <td className="px-2.5 py-2 text-center text-[11px] text-[#555555] select-none">
                              {idx + 1}
                            </td>

                            {/* Cells */}
                            {columns.map((col) => {
                              const val = row[col.name];
                              const isNull = val === null || val === undefined;
                              const isBool = typeof val === 'boolean';
                              const isObj = typeof val === 'object' && val !== null;
                              const strVal = isNull ? 'null' : isObj ? JSON.stringify(val) : String(val);

                              return (
                                <td
                                  key={col.name}
                                  className="px-3 py-2 text-[#cccccc] whitespace-nowrap max-w-[280px] truncate"
                                  title={strVal}
                                >
                                  {isNull ? (
                                    <span className="text-[#555555] italic text-[11.5px]">null</span>
                                  ) : isBool ? (
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                                        val ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                                      }`}
                                    >
                                      {val ? 'true' : 'false'}
                                    </span>
                                  ) : isObj ? (
                                    <span className="text-pink-400 flex items-center gap-1 text-[11.5px]">
                                      <Code2 className="w-3 h-3" />
                                      {`{ ... }`}
                                    </span>
                                  ) : (
                                    <span>{strVal}</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination Footer */}
            <div className="h-10 shrink-0 px-4 bg-[#0a0a0a] border-t border-[#222222] flex items-center justify-between text-[12px] text-[#8c8c8c] select-none">
              <div className="flex items-center gap-1.5">
                <span>Page size:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="h-6 px-1.5 bg-[#141414] border border-[#242424] rounded text-[11.5px] text-white"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* ─── Mode 2: Schema & ER (Connected Table Relations) ─── */}
        {viewMode === 'schema' && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <div className="flex items-center justify-between pb-2 border-b border-[#222222]">
              <div>
                <h3 className="text-[14px] font-semibold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-400" />
                  Database Schema & Entity Relationships
                </h3>
                <p className="text-[12px] text-[#8c8c8c] mt-0.5">
                  Connected entity view mapping foreign keys across <span className="font-mono text-white">{selectedDb}</span>.
                </p>
              </div>
            </div>

            {/* Entity Relationship Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
              {tables.map((t) => {
                const tableData = allDbTablesSchema[t.name] || { columns: [], foreign_keys: [] };
                const isSelected = selectedTable === t.name;
                const outgoing = tableData.foreign_keys || [];
                const incoming: { sourceTable: string; sourceCol: string; targetCol: string }[] = [];

                Object.entries(allDbTablesSchema).forEach(([otherTableName, otherData]) => {
                  otherData.foreign_keys?.forEach((fk) => {
                    if (fk.referenced_table === t.name) {
                      incoming.push({
                        sourceTable: otherTableName,
                        sourceCol: fk.column,
                        targetCol: fk.referenced_column,
                      });
                    }
                  });
                });

                return (
                  <div
                    key={t.name}
                    onClick={() => {
                      setSelectedTable(t.name);
                      setSelectedRowIndex(null);
                      setIsDetailsOpen(true);
                    }}
                    className={`rounded-[8px] border p-3.5 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#141414] border-blue-500 ring-1 ring-blue-500/20'
                        : 'bg-[#0f0f0f] border-[#222222] hover:border-[#383838]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-[#222222]">
                      <div className="flex items-center gap-2 truncate min-w-0">
                        <TableIcon className="w-4 h-4 text-blue-400 shrink-0" />
                        <span className="font-mono font-medium text-white text-[13px] truncate">{t.name}</span>
                      </div>
                      <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#181818] text-[#8c8c8c]">
                        {tableData.columns.length} cols
                      </span>
                    </div>

                    {/* Relations tags */}
                    <div className="space-y-1.5 mb-3 text-[11px]">
                      {outgoing.length > 0 && (
                        <div className="text-[#8c8c8c]">
                          <span className="text-blue-400 font-medium">References: </span>
                          {outgoing.map((fk, i) => (
                            <span key={i} className="font-mono text-[#cccccc]">
                              {fk.referenced_table}
                              {i < outgoing.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </div>
                      )}

                      {incoming.length > 0 && (
                        <div className="text-[#8c8c8c]">
                          <span className="text-emerald-400 font-medium">Referenced by: </span>
                          {incoming.map((rel, i) => (
                            <span key={i} className="font-mono text-[#cccccc]">
                              {rel.sourceTable}
                              {i < incoming.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </div>
                      )}

                      {outgoing.length === 0 && incoming.length === 0 && (
                        <div className="text-[#555555] italic">Standalone table (no foreign keys)</div>
                      )}
                    </div>

                    {/* Columns Preview */}
                    <div className="flex flex-wrap gap-1">
                      {tableData.columns.slice(0, 5).map((col) => (
                        <span
                          key={col.name}
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                            col.primary_key
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 font-semibold'
                              : 'bg-[#161616] border-[#222222] text-[#8c8c8c]'
                          }`}
                        >
                          {col.name}
                        </span>
                      ))}
                      {tableData.columns.length > 5 && (
                        <span className="text-[10px] font-mono px-1 py-0.5 text-[#555555]">
                          +{tableData.columns.length - 5}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Selected Table Column Specifications */}
            <div className="rounded-[8px] border border-[#222222] bg-[#0f0f0f] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#222222] flex items-center justify-between">
                <div>
                  <h4 className="text-[13px] font-semibold text-white">
                    Schema Definition: <span className="font-mono text-blue-400">{selectedTable}</span>
                  </h4>
                  <p className="text-[11.5px] text-[#777777] mt-0.5">
                    Field data types, primary keys, and constraint targets.
                  </p>
                </div>

                <button
                  onClick={() => {
                    const ddl = `CREATE TABLE ${selectedTable} (\n  ${columns
                      .map(
                        (c) =>
                          `${c.name} ${c.type}${c.primary_key ? ' PRIMARY KEY' : ''}${
                            c.nullable ? '' : ' NOT NULL'
                          }`
                      )
                      .join(',\n  ')}\n);`;
                    handleCopy(ddl, 'ddl');
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] bg-[#141414] border border-[#242424] text-[12px] text-[#cccccc] hover:text-white"
                >
                  {copiedKey === 'ddl' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>Copy DDL</span>
                </button>
              </div>

              <table className="w-full border-collapse text-left text-[12.5px]">
                <thead>
                  <tr className="bg-[#141414] text-[11.5px] font-medium text-[#777777] border-b border-[#222222]">
                    <th className="px-4 py-2">Column</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Primary Key</th>
                    <th className="px-4 py-2">Nullable</th>
                    <th className="px-4 py-2">Foreign Key Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181818] font-mono">
                  {columns.map((col) => {
                    const fk = foreignKeys.find((f) => f.column === col.name);
                    return (
                      <tr key={col.name} className="hover:bg-[#121212]">
                        <td className="px-4 py-2 text-white flex items-center gap-2">
                          {col.name}
                          {col.primary_key && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
                              PK
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-[#cccccc]">{col.type}</td>
                        <td className="px-4 py-2 text-[#8c8c8c]">{col.primary_key ? 'Yes' : 'No'}</td>
                        <td className="px-4 py-2 text-[#8c8c8c]">{col.nullable ? 'NULL' : 'NOT NULL'}</td>
                        <td className="px-4 py-2 text-blue-400">
                          {fk ? `${fk.referenced_table}.${fk.referenced_column}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── Mode 3: SQL Console ─── */}
        {viewMode === 'sql' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-4 space-y-3">
            {/* Query Editor Box */}
            <div className="rounded-[8px] border border-[#222222] bg-[#0f0f0f] p-3 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  <span className="text-[13px] font-semibold text-white">SQL Query Runner</span>
                  <span className="text-[11px] text-[#666666]">
                    (<kbd className="px-1 py-0.5 rounded bg-[#1c1c1c] text-[#8c8c8c] font-mono">Ctrl+Enter</kbd> to execute)
                  </span>
                </div>

                {/* Preset query buttons */}
                <div className="flex items-center gap-1.5">
                  {selectedTable && (
                    <button
                      onClick={() => setSqlQuery(`SELECT * FROM ${selectedTable} LIMIT 25;`)}
                      className="px-2 py-0.5 rounded bg-[#141414] border border-[#242424] text-[11px] text-[#8c8c8c] hover:text-white"
                    >
                      SELECT *
                    </button>
                  )}
                  {selectedTable && (
                    <button
                      onClick={() => setSqlQuery(`SELECT count(*) AS total_rows FROM ${selectedTable};`)}
                      className="px-2 py-0.5 rounded bg-[#141414] border border-[#242424] text-[11px] text-[#8c8c8c] hover:text-white"
                    >
                      COUNT(*)
                    </button>
                  )}
                </div>
              </div>

              <textarea
                rows={5}
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleExecuteSql();
                  }
                }}
                placeholder="Enter SQL statement..."
                className="w-full p-3 bg-[#080808] border border-[#202020] rounded-[6px] font-mono text-[13px] text-emerald-300 placeholder-[#555555] outline-none focus:border-emerald-500/60 resize-y"
              />

              <div className="flex items-center justify-between mt-2 pt-1">
                <div className="text-[11.5px] text-[#666666]">
                  Target database: <span className="font-mono text-[#cccccc]">{selectedDb}</span>
                </div>

                <button
                  onClick={handleExecuteSql}
                  disabled={isExecutingSql || !sqlQuery.trim()}
                  className="flex items-center gap-2 h-8 px-4 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] disabled:opacity-40 text-[#cccccc] hover:text-white text-[12.5px] font-medium transition-colors cursor-pointer"
                >
                  {isExecutingSql ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  )}
                  <span>Run Query</span>
                </button>
              </div>
            </div>

            {/* Results Grid */}
            <div className="flex-1 rounded-[8px] border border-[#222222] bg-[#0f0f0f] flex flex-col min-h-0 overflow-hidden">
              <div className="h-9 px-4 bg-[#141414] border-b border-[#222222] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-medium text-white">Query Output</span>
                  {sqlDuration !== null && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#1c1c1c] text-[#8c8c8c] font-mono">
                      {sqlDuration}ms
                    </span>
                  )}
                </div>

                {sqlResult?.rows && sqlResult.rows.length > 0 && (
                  <div className="text-[11.5px] text-[#8c8c8c]">
                    {sqlResult.rows.length} rows returned
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-auto p-2">
                {isExecutingSql ? (
                  <div className="flex items-center justify-center h-40 text-[#8c8c8c] text-[13px] gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
                    Executing query...
                  </div>
                ) : sqlError ? (
                  <div className="p-6 text-center text-rose-400 text-[13px] font-mono whitespace-pre-wrap">
                    <AlertCircle className="w-6 h-6 mx-auto mb-2 text-rose-500" />
                    {sqlError}
                  </div>
                ) : !sqlResult ? (
                  <div className="flex items-center justify-center h-40 text-[#555555] text-[13px]">
                    Run a query above to view results
                  </div>
                ) : sqlResult.affected_rows !== undefined && !sqlResult.rows ? (
                  <div className="p-6 text-center text-emerald-400 text-[13.5px]">
                    <Check className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
                    Query executed successfully. Affected rows: {sqlResult.affected_rows}
                  </div>
                ) : (
                  <table className="w-full border-collapse text-left font-mono text-[12px]">
                    <thead>
                      <tr className="bg-[#141414] border-b border-[#222222] text-[#8c8c8c]">
                        {(sqlResult.columns || (sqlResult.rows && sqlResult.rows[0] ? Object.keys(sqlResult.rows[0]) : [])).map(
                          (col) => (
                            <th key={col} className="px-3 py-2 text-white">
                              {col}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#181818]">
                      {(sqlResult.rows || []).map((r, i) => (
                        <tr key={i} className="hover:bg-[#141414]">
                          {Object.values(r).map((v, ci) => (
                            <td key={ci} className="px-3 py-2 text-[#cccccc] truncate max-w-xs">
                              {v === null ? (
                                <span className="text-[#555555] italic">null</span>
                              ) : typeof v === 'object' ? (
                                JSON.stringify(v)
                              ) : (
                                String(v)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ══════════════════════════════════════════════════════════════════════
          PANE 3: RIGHT DETAILS INSPECTOR & INLINE ROW EDITOR (w-80)
          ══════════════════════════════════════════════════════════════════════ */}
      {isDetailsOpen && (
        <aside className="w-full lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-[#222222] bg-[#0a0a0a] flex flex-col overflow-hidden">
          {/* Inspector Header */}
          <div className="h-[54px] shrink-0 px-4 border-b border-[#222222] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-blue-400" />
              <span className="text-[13px] font-semibold text-white">
                {isInsertModeInPanel
                  ? 'New Row'
                  : activeRow
                  ? `Row #${selectedRowIndex! + 1}`
                  : 'Table Inspector'}
              </span>
            </div>

            <button
              onClick={() => setIsDetailsOpen(false)}
              className="w-7 h-7 flex items-center justify-center rounded-[5px] text-[#777777] hover:text-white hover:bg-[#161616]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Inspector Body Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {isInsertModeInPanel ? (
              /* Insert New Row Form */
              <div className="space-y-3">
                <div className="text-[12px] text-[#8c8c8c] mb-2">
                  Add new record to <span className="font-mono text-white">{selectedTable}</span>.
                </div>

                {columns.map((col) => {
                  const isAutoPk = col.primary_key && col.type.toLowerCase().includes('int');
                  return (
                    <div key={col.name}>
                      <label className="block text-[11.5px] font-medium text-[#cccccc] mb-1 flex items-center justify-between">
                        <span className="font-mono">{col.name}</span>
                        <span className="text-[10px] text-[#666666]">{col.type}</span>
                      </label>
                      <input
                        type="text"
                        placeholder={isAutoPk ? 'Auto-increment' : col.nullable ? 'Optional (NULL)' : 'Required'}
                        value={String(rowEditValues[col.name] ?? '')}
                        onChange={(e) =>
                          setRowEditValues({ ...rowEditValues, [col.name]: e.target.value })
                        }
                        className="w-full h-8 px-2.5 bg-[#141414] border border-[#242424] focus:border-[#383838] rounded-[5px] text-[12px] text-white font-mono outline-none"
                      />
                    </div>
                  );
                })}

                <div className="pt-2 flex items-center gap-2">
                  <button
                    onClick={handleInsertRowFromPanel}
                    disabled={isSavingRow}
                    className="flex-1 flex items-center justify-center gap-1.5 h-8 bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] rounded-[6px] text-[12px] font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isSavingRow ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    <span>Save Record</span>
                  </button>
                  <button
                    onClick={() => setIsInsertModeInPanel(false)}
                    className="h-8 px-3 bg-transparent text-[#777777] hover:text-white text-[12px] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : activeRow ? (
              /* Selected Row Editing Fields */
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-1 border-b border-[#222222]">
                  <span className="text-[11.5px] text-[#8c8c8c]">Edit column values</span>
                  <button
                    onClick={() => handleCopy(JSON.stringify(activeRow, null, 2), 'rowJson')}
                    className="flex items-center gap-1 text-[11px] text-blue-400 hover:underline"
                  >
                    {copiedKey === 'rowJson' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>Copy JSON</span>
                  </button>
                </div>

                {columns.map((col) => {
                  const val = rowEditValues[col.name];
                  const isNull = val === null || val === undefined;

                  return (
                    <div key={col.name} className="space-y-1">
                      <div className="flex items-center justify-between text-[11.5px]">
                        <span className="font-mono text-white flex items-center gap-1">
                          {col.name}
                          {col.primary_key && <Key className="w-3 h-3 text-amber-400" />}
                        </span>
                        <span className="text-[10px] text-[#666666]">{col.type}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          disabled={col.primary_key}
                          value={isNull ? '' : String(val)}
                          placeholder={isNull ? 'NULL' : ''}
                          onChange={(e) =>
                            setRowEditValues({ ...rowEditValues, [col.name]: e.target.value })
                          }
                          className={`flex-1 h-8 px-2.5 bg-[#141414] border border-[#242424] focus:border-[#383838] rounded-[5px] text-[12px] text-white font-mono outline-none ${
                            col.primary_key ? 'opacity-60 cursor-not-allowed' : ''
                          }`}
                        />
                        {col.nullable && !col.primary_key && (
                          <button
                            type="button"
                            onClick={() =>
                              setRowEditValues({
                                ...rowEditValues,
                                [col.name]: isNull ? '' : null,
                              })
                            }
                            title={isNull ? 'Set value' : 'Set NULL'}
                            className={`px-1.5 h-8 rounded text-[10px] font-mono border cursor-pointer ${
                              isNull
                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 font-bold'
                                : 'bg-[#141414] border-[#242424] text-[#777777] hover:text-white'
                            }`}
                          >
                            NULL
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Save and Delete Actions */}
                <div className="pt-3 border-t border-[#222222] space-y-2">
                  <button
                    onClick={handleSaveRowEdit}
                    disabled={isSavingRow}
                    className="w-full flex items-center justify-center gap-1.5 h-8 bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] rounded-[6px] text-[12px] font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isSavingRow ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>Save Changes</span>
                  </button>

                  <button
                    onClick={() => setDeleteRowTarget(activeRow)}
                    className="w-full flex items-center justify-center gap-1.5 h-8 bg-transparent hover:bg-rose-500/10 text-rose-500 border border-transparent hover:border-rose-500/20 rounded-[6px] text-[12px] font-medium cursor-pointer transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Row</span>
                  </button>
                </div>
              </div>
            ) : (
              /* No Row Selected State: Show Table Summary */
              <div className="space-y-4">
                <div className="p-3 rounded-[6px] bg-[#141414] border border-[#222222]">
                  <div className="text-[12px] font-medium text-white mb-1">
                    Table: <span className="font-mono text-blue-400">{selectedTable}</span>
                  </div>
                  <div className="text-[11.5px] text-[#8c8c8c] space-y-1">
                    <div>Columns: {columns.length}</div>
                    <div>Foreign Keys: {foreignKeys.length}</div>
                    <div>
                      Row estimate:{' '}
                      {tables.find((t) => t.name === selectedTable)?.row_count_estimate ?? 'Unknown'}
                    </div>
                  </div>
                </div>

                <div className="text-[11.5px] text-[#666666] text-center pt-4">
                  Select any row in the grid to view details or edit values directly.
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ─── Delete Row Confirm Dialog ─── */}
      <ConfirmDialog
        isOpen={!!deleteRowTarget}
        title="Delete Row"
        description="Are you sure you want to permanently delete this row? This action cannot be reversed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteRow}
        onClose={() => setDeleteRowTarget(null)}
      />
    </div>
  );
}
