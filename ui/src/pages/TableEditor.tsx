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
  Maximize2,
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
import { SlideOver } from '../components/ui/SlideOver';
import { CustomSelect } from '../components/shared/CustomSelect';

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

// ─── Format Data Type to Simple Canonical Name (Supabase style) ──────────────
// Translates verbose SQL information_schema types (e.g. 'character varying',
// 'timestamp with time zone', 'integer') into crisp, familiar Supabase tokens.
function formatColumnType(rawType: string): string {
  if (!rawType) return 'text';
  const norm = rawType.toLowerCase().trim();

  // Exact canonical Postgres / SQL mappings
  if (norm === 'character varying' || norm.startsWith('varchar')) return 'varchar';
  if (norm === 'character' || norm === 'char' || norm.startsWith('char(')) return 'char';
  if (norm === 'integer' || norm === 'int' || norm === 'int4') return 'int4';
  if (norm === 'bigint' || norm === 'int8') return 'int8';
  if (norm === 'smallint' || norm === 'int2') return 'int2';
  if (norm === 'tinyint') return 'int2';
  if (norm === 'boolean' || norm === 'bool') return 'bool';
  if (norm === 'timestamp with time zone' || norm === 'timestamptz') return 'timestamptz';
  if (norm === 'timestamp without time zone' || norm === 'timestamp') return 'timestamp';
  if (norm === 'time with time zone' || norm === 'timetz') return 'timetz';
  if (norm === 'time without time zone' || norm === 'time') return 'time';
  if (norm === 'double precision' || norm === 'float8') return 'float8';
  if (norm === 'real' || norm === 'float4') return 'float4';
  if (norm === 'numeric' || norm.startsWith('decimal') || norm.startsWith('numeric(')) return 'numeric';
  if (norm === 'text') return 'text';
  if (norm === 'jsonb') return 'jsonb';
  if (norm === 'json') return 'json';
  if (norm === 'uuid') return 'uuid';
  if (norm === 'bytea' || norm === 'blob') return 'bytea';
  if (norm === 'date') return 'date';
  if (norm.startsWith('serial')) return 'serial';
  if (norm.startsWith('bigserial')) return 'bigserial';

  // Strip parentheses like varchar(255) -> varchar
  const clean = norm.replace(/\(.*\)/, '').trim();
  if (clean === 'character varying' || clean === 'varchar') return 'varchar';
  if (clean === 'int' || clean === 'integer') return 'int4';
  return clean || norm;
}

// ─── Type-Specific Column Width Heuristics (Supabase Studio inspired) ──────
// Calculates natural initial column widths according to SQL data type semantics.
// Optimized for 14px Inter typography matching the Databases and Overview pages.
function getDefaultColumnWidth(typeName: string, colName?: string): number {
  const norm = (typeName || '').toLowerCase().trim();
  const normName = (colName || '').toLowerCase().trim();

  // Boolean flags: compact width (e.g., active, is_admin, verified)
  if (norm.includes('bool') || norm === 'bit') {
    return 95;
  }

  // Row IDs and foreign key pointers: compact
  if (normName === 'id' || normName.endsWith('_id') || normName.endsWith('_fk')) {
    return 120;
  }

  // Quantities & counts
  if (
    normName.includes('qty') ||
    normName.includes('quantity') ||
    normName.includes('count') ||
    normName.includes('age') ||
    norm.includes('int2') ||
    norm.includes('smallint') ||
    norm.includes('tinyint')
  ) {
    return 110;
  }

  // Standard integers
  if (norm.includes('int') || norm.includes('serial') || norm.includes('year')) {
    return 130;
  }

  // Floating point / Decimal / Monetary numbers (e.g., unit_price, subtotal)
  if (
    norm.includes('float') ||
    norm.includes('double') ||
    norm.includes('decimal') ||
    norm.includes('numeric') ||
    norm.includes('money') ||
    norm.includes('real')
  ) {
    return 145;
  }

  // Date, Time, Timestamps
  if (norm.includes('time') || norm.includes('date')) {
    return 185;
  }

  // UUIDs / Hashes
  if (norm.includes('uuid') || norm.includes('guid') || normName.includes('hash')) {
    return 210;
  }

  // JSON, XML, binary documents
  if (norm.includes('json') || norm.includes('xml') || norm.includes('bytea') || norm.includes('blob')) {
    return 240;
  }

  // Email / URLs
  if (normName.includes('email') || normName.includes('url') || normName.includes('avatar')) {
    return 230;
  }

  // Text, Varchar, generic strings
  if (norm.includes('text') || norm.includes('char') || norm.includes('string')) {
    return 195;
  }

  // Fallback default
  return 150;
}

// ─── Table Skeleton Loader (Supabase Studio inspired) ───────────────────────────
// Preserves exact grid layout and column proportions during schema or row loading.
// Eliminates cumulative layout shifts (CLS) and avoids jarring "0 rows" flickers on reload.
function TableSkeleton({
  columns,
  foreignKeys,
  columnWidths,
}: {
  columns: ColumnInfoApi[];
  foreignKeys: ForeignKeyInfoApi[];
  columnWidths?: Record<string, number>;
}) {
  const skeletonColCount = columns.length > 0 ? columns.length : 6;
  const skeletonRowCount = 12;

  return (
    <table
      className="border-collapse text-left select-none font-sans text-[14px] table-fixed"
      style={{ width: 'max-content' }}
    >
      <thead>
        <tr className="sticky top-0 z-10 bg-[#0a0a0a] border-b border-[#222222]">
          {/* Row Checkbox & Action Sticky Column */}
          <th
            className="w-16 px-3 py-2 text-left bg-[#0a0a0a] border-r border-[#1a1a1a]"
            style={{ width: '64px', minWidth: '64px', maxWidth: '64px' }}
          >
            <div className="flex items-center justify-start gap-1.5">
              <div className="w-3.5 h-3.5 rounded border border-[#262626] bg-[#141414]" />
              <div className="w-3.5 h-3.5 rounded border border-[#222222] bg-[#121212]" />
            </div>
          </th>

          {/* Column Header Skeletons or Introspected Columns */}
          {columns.length > 0 ? (
            columns.map((col) => {
              const isFk = foreignKeys.some((fk) => fk.column === col.name);
              const badge = getColumnTypeBadge(col.type, col.primary_key, isFk);
              const width = columnWidths?.[col.name] || getDefaultColumnWidth(col.type, col.name);

              return (
                <th
                  key={col.name}
                  className="px-3 py-2 text-[14px] font-medium text-[#cccccc] whitespace-nowrap border-r border-[#1a1a1a]"
                  style={{ width: `${width}px`, minWidth: `${Math.max(80, width)}px`, maxWidth: `${width}px` }}
                >
                  <div className="flex items-center gap-1.5 min-w-0 pr-2.5 overflow-hidden whitespace-nowrap">
                    <span className="font-sans text-white text-[14px] whitespace-nowrap shrink-0">{col.name}</span>
                    {col.primary_key && (
                      <span title="Primary Key" className="shrink-0 p-0.5 rounded bg-amber-500/10 text-amber-400">
                        <Key className="w-3 h-3" />
                      </span>
                    )}
                    {isFk && (
                      <span title="Foreign Key" className="shrink-0 p-0.5 rounded bg-blue-500/10 text-blue-400">
                        <Link2 className="w-3 h-3" />
                      </span>
                    )}
                    <span className={`text-[12.5px] font-mono whitespace-nowrap shrink-0 ${badge.color}`}>
                      {formatColumnType(col.type)}
                    </span>
                  </div>
                </th>
              );
            })
          ) : (
            Array.from({ length: skeletonColCount }).map((_, i) => (
              <th
                key={i}
                className="px-3 py-2 border-r border-[#1a1a1a]"
                style={{ width: '160px', minWidth: '160px', maxWidth: '160px' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="h-4 w-16 bg-[#1a1a1a] rounded animate-pulse" />
                  <div className="h-3 w-10 bg-[#141414] rounded animate-pulse" />
                </div>
              </th>
            ))
          )}
        </tr>
      </thead>

      <tbody className="divide-y divide-[#181818]">
        {Array.from({ length: skeletonRowCount }).map((_, rIdx) => (
          <tr key={rIdx} className="h-9 hover:bg-[#101010]/50 transition-colors">
            <td
              className="px-3 py-2 text-left border-r border-[#1a1a1a]"
              style={{ width: '64px', minWidth: '64px', maxWidth: '64px' }}
            >
              <div className="flex items-center justify-start gap-1.5 opacity-40">
                <div className="w-3.5 h-3.5 rounded border border-[#262626] bg-[#141414]" />
                <div className="w-3.5 h-3.5 rounded border border-[#222222] bg-[#121212]" />
              </div>
            </td>
            {columns.length > 0 ? (
              columns.map((col, cIdx) => {
                const width = columnWidths?.[col.name] || getDefaultColumnWidth(col.type, col.name);
                const seed = (rIdx * 7 + cIdx * 13) % 60;
                const barWidth = Math.min(width - 24, Math.max(40, 50 + seed * 2));
                return (
                  <td
                    key={col.name}
                    className="px-3 py-2 border-r border-[#151515]"
                    style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
                  >
                    <div
                      className="h-3.5 bg-[#161616] rounded animate-pulse"
                      style={{ width: `${barWidth}px` }}
                    />
                  </td>
                );
              })
            ) : (
              Array.from({ length: skeletonColCount }).map((_, cIdx) => {
                const seed = (rIdx * 11 + cIdx * 17) % 70;
                const barWidth = Math.min(130, Math.max(45, 55 + seed * 2));
                return (
                  <td
                    key={cIdx}
                    className="px-3 py-2 border-r border-[#151515]"
                    style={{ width: '160px', minWidth: '160px', maxWidth: '160px' }}
                  >
                    <div
                      className="h-3.5 bg-[#161616] rounded animate-pulse"
                      style={{ width: `${barWidth}px` }}
                    />
                  </td>
                );
              })
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
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
  // Stable ref mirror of allDbTablesSchema — read inside useCallback without it being a dep.
  // WHY: allDbTablesSchema in useCallback deps causes loadTableData to be recreated on every schema
  // cache write, re-triggering the table-change useEffect in an infinite loop that drops all rows.
  const schemaCacheRef = useRef<Record<string, { columns: ColumnInfoApi[]; foreign_keys: ForeignKeyInfoApi[] }>>({});
  useEffect(() => {
    schemaCacheRef.current = allDbTablesSchema;
  }, [allDbTablesSchema]);

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
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'details' | 'danger'>('details');
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
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
  // Target key (`db:table`) ref used to discard in-flight responses if the user navigates to another table.
  const activeTargetKeyRef = useRef<string>('');

  // ─── Column Width & Interactive Resizing State ─────────────────────────────
  // Tracks user-resized column pixel widths: { [colName]: widthInPx }
  // Persisted in localStorage per database + table so user customization is retained.
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const resizingColRef = useRef<{
    colName: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  // Restore persisted custom column widths for active table
  useEffect(() => {
    if (!selectedDb || !selectedTable) return;
    try {
      const stored = localStorage.getItem(`axiom:col_widths:${selectedDb}:${selectedTable}`);
      if (stored) {
        setColumnWidths(JSON.parse(stored));
      } else {
        setColumnWidths({});
      }
    } catch {
      setColumnWidths({});
    }
  }, [selectedDb, selectedTable]);

  // Returns effective width: user preference > type-based semantic default
  const getColWidth = useCallback(
    (colName: string, colType: string): number => {
      if (columnWidths[colName] && columnWidths[colName] >= 80) {
        return columnWidths[colName];
      }
      return getDefaultColumnWidth(colType, colName);
    },
    [columnWidths]
  );

  // Drag-to-resize column width handler
  // WHY: Provides spreadsheet/Airtable-grade interactive column resizing with mouse drag.
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, colName: string, currentWidth: number) => {
      e.preventDefault();
      e.stopPropagation();

      resizingColRef.current = {
        colName,
        startX: e.clientX,
        startWidth: currentWidth,
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMouseMove(moveEvent: MouseEvent) {
        if (!resizingColRef.current) return;
        const { colName: targetCol, startX, startWidth } = resizingColRef.current;
        const delta = moveEvent.clientX - startX;
        // Clamp column width: collapse limit is 80px, maximum 1200px
        const newWidth = Math.max(80, Math.min(1200, startWidth + delta));

        setColumnWidths((prev) => ({
          ...prev,
          [targetCol]: newWidth,
        }));
      }

      function onMouseUp() {
        if (resizingColRef.current && selectedDb && selectedTable) {
          setColumnWidths((latest) => {
            try {
              localStorage.setItem(
                `axiom:col_widths:${selectedDb}:${selectedTable}`,
                JSON.stringify(latest)
              );
            } catch {
              // Ignore localStorage quota failures
            }
            return latest;
          });
        }
        resizingColRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [selectedDb, selectedTable]
  );

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

  // ─── 3. Phased Sequential Data Pipeline: Schema -> Rows (Supabase Studio lifecycle) ───
  // Uses client-side schema caching and semantic navigation guards to ensure rows are always fetched
  // without race-condition aborts, multiple redundant information_schema queries, or 0-data drops.
  const loadTableData = useCallback(
    async (options?: { targetCursor?: string | null; reloadSchema?: boolean }) => {
      const targetCursor = options?.targetCursor;

      if (!selectedDb || !selectedTable) {
        setColumns([]);
        setForeignKeys([]);
        setRows([]);
        setIsSchemaLoading(false);
        setIsRowsLoading(false);
        return;
      }

      const currentKey = `${selectedDb}:${selectedTable}`;
      activeTargetKeyRef.current = currentKey;
      setRowsError(null);

      // Read from ref — NOT from allDbTablesSchema state — to avoid allDbTablesSchema being in
      // the useCallback deps, which would recreate the fn on every schema write and re-trigger the
      // table-change useEffect causing an infinite loop that drops all row data.
      const cached = schemaCacheRef.current[selectedTable];
      let cols = cached?.columns || [];
      let fks = cached?.foreign_keys || [];

      const needsSchema = options?.reloadSchema || cols.length === 0;

      if (needsSchema) {
        setIsSchemaLoading(true);
        setIsRowsLoading(true);
        try {
          const schemaRes = await api.getTableSchema(selectedDb, selectedTable);
          // If user switched to another table while waiting for schema, discard
          if (activeTargetKeyRef.current !== currentKey) return;

          cols = schemaRes.columns || [];
          fks = schemaRes.foreign_keys || [];
          setColumns(cols);
          setForeignKeys(fks);

          // Write to schemaCacheRef immediately (synchronous, for next loadTableData reads)
          // then also to state so the ER diagram can re-render when it's visible
          const entry = { columns: cols, foreign_keys: fks };
          schemaCacheRef.current = { ...schemaCacheRef.current, [selectedTable]: entry };
          setAllDbTablesSchema((prev) => ({ ...prev, [selectedTable]: entry }));
        } catch (err: unknown) {
          if (activeTargetKeyRef.current !== currentKey) return;
          console.error(`Failed to load schema for ${selectedDb}.${selectedTable}:`, err);
          setColumns([]);
          setForeignKeys([]);
          setRows([]);
          setIsSchemaLoading(false);
          setIsRowsLoading(false);
          setRowsError(err instanceof Error ? err.message : 'Failed to introspect table schema');
          return;
        } finally {
          if (activeTargetKeyRef.current === currentKey) {
            setIsSchemaLoading(false);
          }
        }
      } else {
        setColumns(cols);
        setForeignKeys(fks);
        setIsSchemaLoading(false);
        setIsRowsLoading(true);
      }

      // Phase 2: Fetch Table Row Data
      try {
        let filterParam: string | undefined;
        if (activeFilter) {
          filterParam = JSON.stringify({
            [activeFilter.col]: { [activeFilter.op]: activeFilter.val },
          });
        }

        const rowsRes = await api.getTableRows(selectedDb, selectedTable, {
          cursor: targetCursor || undefined,
          limit: pageSize,
          sort: activeSort?.col,
          order: activeSort?.order,
          filter: filterParam,
        });

        if (activeTargetKeyRef.current !== currentKey) return;

        const rowsData = rowsRes.rows || [];
        const pagination = rowsRes.pagination;

        setRows(rowsData);
        setHasNextPage(!!pagination?.has_more);
        setCursor(pagination?.next_cursor || null);
        setSelectedRowIndex((prev) => (prev !== null && prev < rowsData.length ? prev : null));
      } catch (err: unknown) {
        if (activeTargetKeyRef.current !== currentKey) return;
        setRowsError(err instanceof Error ? err.message : 'Failed to query table rows');
        setRows([]);
      } finally {
        if (activeTargetKeyRef.current === currentKey) {
          setIsRowsLoading(false);
        }
      }
    },
    // No allDbTablesSchema — read via schemaCacheRef instead to prevent infinite re-trigger loop
    [selectedDb, selectedTable, pageSize, activeFilter, activeSort]
  );

  // Trigger full data load (schema + rows) when active table/db/view changes.
  // loadTableData is intentionally omitted from deps: it is now stable (no state in its closure).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedDb && selectedTable && viewMode === 'grid') {
      setCursor(null);
      setCursorHistory([]);
      setSelectedRowIndex(null);
      setIsInsertModeInPanel(false);
      loadTableData({ reloadSchema: false });
    }
  }, [selectedDb, selectedTable, viewMode]);

  // Trigger row-only reload when filter/sort/pageSize changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedDb && selectedTable && viewMode === 'grid' && columns.length > 0) {
      setCursor(null);
      setCursorHistory([]);
      setSelectedRowIndex(null);
      loadTableData({ reloadSchema: false });
    }
  }, [pageSize, activeFilter, activeSort]);

  // Lazy fetch schema for ER diagram only when user actively switches to Schema view.
  // WHY: Avoids flooding the DB pool with concurrent INFORMATION_SCHEMA requests on initial boot.
  // Batches schema mutations into a single state update so this effect does not thrash in a loop.
  useEffect(() => {
    if (viewMode !== 'schema' || !selectedDb || tables.length === 0) return;
    const missing = tables.filter((t) => !schemaCacheRef.current[t.name]);
    if (missing.length === 0) return;

    let cancelled = false;
    async function loadErSchemas() {
      const updates: Record<string, { columns: ColumnInfoApi[]; foreign_keys: ForeignKeyInfoApi[] }> = {};
      for (const t of missing) {
        if (cancelled) break;
        try {
          const res = await api.getTableSchema(selectedDb, t.name);
          updates[t.name] = {
            columns: res.columns || [],
            foreign_keys: res.foreign_keys || [],
          };
        } catch {
          // Schema introspect failure on background ER table is non-fatal
        }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        schemaCacheRef.current = { ...schemaCacheRef.current, ...updates };
        setAllDbTablesSchema((prev) => ({ ...prev, ...updates }));
      }
    }
    loadErSchemas();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedDb, tables]);

  // Select row handler
  const handleSelectRow = (index: number) => {
    setSelectedRowIndex(index);
    setIsInsertModeInPanel(false);
    setIsDetailsOpen(true);
    if (rows[index]) {
      setRowEditValues({ ...rows[index] });
    }
  };

  // Toggle single row tickmark checkbox selection
  const handleToggleRowSelect = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setSelectedRowIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Toggle select all rows tickmark checkbox
  const handleToggleAllRows = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedRowIndices.size === rows.length && rows.length > 0) {
      setSelectedRowIndices(new Set());
    } else {
      setSelectedRowIndices(new Set(rows.map((_, i) => i)));
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
        await loadTableData({ targetCursor: cursor, reloadSchema: false });
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
      await loadTableData({ reloadSchema: false });
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
      loadTableData({ targetCursor: cursor, reloadSchema: false });
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
              className="w-full h-8 pl-8 pr-2.5 bg-[#141414] border border-[#242424] focus:border-[#383838] rounded-[6px] text-[13px] text-white placeholder-[#666666] outline-none transition-colors"
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
                  className="flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] disabled:opacity-40 text-[#cccccc] hover:text-white text-[13px] font-medium transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Insert Row</span>
                </button>

                {/* Filter Popover */}
                <div className="relative" ref={filterPopoverRef}>
                  <button
                    onClick={() => setShowFilterPopover(!showFilterPopover)}
                    className={`flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] border text-[13px] font-medium transition-colors cursor-pointer ${
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
                      <div className="text-[13px] font-semibold text-white mb-2">Filter Records</div>
                      <div className="space-y-2">
                        <select
                          value={filterCol}
                          onChange={(e) => setFilterCol(e.target.value)}
                          className="w-full h-8 px-2 bg-[#161616] border border-[#2c2c2c] rounded text-[13px] text-white"
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
                          className="w-full h-8 px-2 bg-[#161616] border border-[#2c2c2c] rounded text-[13px] text-white"
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
                            className="w-full h-8 px-2 bg-[#161616] border border-[#2c2c2c] rounded text-[13px] text-white placeholder-[#666666]"
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
                    className={`flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] border text-[13px] font-medium transition-colors cursor-pointer ${
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
                      <div className="text-[13px] font-semibold text-white mb-2">Sort Records</div>
                      <div className="space-y-2">
                        <select
                          value={sortCol}
                          onChange={(e) => setSortCol(e.target.value)}
                          className="w-full h-8 px-2 bg-[#161616] border border-[#2c2c2c] rounded text-[13px] text-white"
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
                            className={`flex-1 h-7 rounded text-[12px] font-medium border ${
                              sortOrder === 'asc'
                                ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                                : 'bg-[#161616] border-[#2c2c2c] text-[#8c8c8c]'
                            }`}
                          >
                            ASC
                          </button>
                          <button
                            onClick={() => setSortOrder('desc')}
                            className={`flex-1 h-7 rounded text-[12px] font-medium border ${
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
                            className="text-[12px] text-[#8c8c8c] hover:text-white"
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
                            className="px-2.5 py-1 bg-[#222222] hover:bg-[#2a2a2a] border border-[#333333] rounded text-[12px] font-medium text-white transition-colors"
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
                  onClick={() => loadTableData({ reloadSchema: true })}
                  disabled={isRowsLoading || isSchemaLoading}
                  title="Reload rows"
                  className="w-8 h-8 flex items-center justify-center rounded-[6px] bg-[#141414] border border-[#262626] text-[#8c8c8c] hover:text-white hover:border-[#383838] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRowsLoading || isSchemaLoading ? 'animate-spin' : ''}`} />
                </button>
              </>
            )}

            {/* View Mode Switcher Pills (matching Storage view toggle) */}
            <div className="flex items-center p-0.5 rounded-[6px] bg-[#141414] border border-[#262626]">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                title="Table Grid"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-[13px] font-medium transition-colors cursor-pointer ${
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
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-[13px] font-medium transition-colors cursor-pointer ${
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
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-[13px] font-medium transition-colors cursor-pointer ${
                  viewMode === 'sql' ? 'bg-[#222222] text-white' : 'text-[#8c8c8c] hover:text-white'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span className="hidden md:inline">SQL</span>
              </button>
            </div>
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
                    loadTableData({ targetCursor: prevCursor, reloadSchema: false });
                  }
                }}
                disabled={cursorHistory.length === 0 || isRowsLoading}
                className="flex items-center gap-1 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] disabled:opacity-40 hover:text-white hover:border-[#383838] transition-colors cursor-pointer"
                title="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span className="text-[13px] font-medium">Previous</span>
              </button>

              <button
                onClick={() => {
                  if (hasNextPage && cursor) {
                    setCursorHistory([...cursorHistory, cursor]);
                    loadTableData({ targetCursor: cursor, reloadSchema: false });
                  }
                }}
                disabled={!hasNextPage || isRowsLoading}
                className="flex items-center gap-1 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] disabled:opacity-40 hover:text-white hover:border-[#383838] transition-colors cursor-pointer"
                title="Next page"
              >
                <span className="text-[13px] font-medium">Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* ─── Mode 1: Table Grid (Spreadsheet Editor) ─── */}
        {viewMode === 'grid' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
            <div className="flex-1 overflow-auto">
              {isSchemaLoading || (isRowsLoading && rows.length === 0 && !rowsError) ? (
                <TableSkeleton columns={columns} foreignKeys={foreignKeys} columnWidths={columnWidths} />
              ) : rowsError ? (
                <div className="p-8 flex flex-col items-center justify-center text-center">
                  <AlertCircle className="w-8 h-8 text-rose-500 mb-2" />
                  <p className="text-[14px] font-medium text-white mb-1">Failed to query table</p>
                  <p className="text-[12.5px] text-[#8c8c8c] max-w-md font-mono">{rowsError}</p>
                  <button
                    onClick={() => loadTableData({ reloadSchema: true })}
                    className="mt-4 px-3 py-1.5 bg-[#141414] border border-[#262626] rounded-[6px] text-[12px] text-white hover:border-[#383838]"
                  >
                    Retry
                  </button>
                </div>
              ) : columns.length === 0 ? (
                <div className="p-12 text-center text-[#777777] text-[14px]">
                  No column schema found for table <span className="font-sans font-medium text-white">{selectedTable}</span>
                </div>
              ) : (
                <table
                  className="border-collapse text-left select-text font-sans text-[14px] table-fixed"
                  style={{ width: 'max-content' }}
                >
                  <thead>
                    <tr className="sticky top-0 z-10 bg-[#0a0a0a] border-b border-[#222222]">
                      {/* Row Checkbox & Action Sticky Column */}
                      <th
                        className="w-16 px-3 py-2 text-left bg-[#0a0a0a] sticky left-0 z-20 border-r border-[#1a1a1a] select-none"
                        style={{ width: '64px', minWidth: '64px', maxWidth: '64px' }}
                      >
                        <div className="flex items-center justify-start gap-1.5">
                          <button
                            type="button"
                            onClick={handleToggleAllRows}
                            title={selectedRowIndices.size === rows.length && rows.length > 0 ? 'Deselect all' : 'Select all'}
                            className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-colors cursor-pointer ${
                              selectedRowIndices.size > 0 && selectedRowIndices.size === rows.length
                                ? 'bg-blue-600 border-blue-500 text-white'
                                : selectedRowIndices.size > 0
                                ? 'bg-blue-600/30 border-blue-500 text-blue-400'
                                : 'bg-[#141414] border-[#2c2c2c] hover:border-[#444444] text-transparent'
                            }`}
                          >
                            <Check className="w-3 h-3 stroke-[2.5]" />
                          </button>
                        </div>
                      </th>

                      {/* Dynamic Columns with Type-Aware Widths and Interactive Resizers */}
                      {columns.map((col) => {
                        const isFk = foreignKeys.some((fk) => fk.column === col.name);
                        const badge = getColumnTypeBadge(col.type, col.primary_key, isFk);
                        const width = getColWidth(col.name, col.type);

                        return (
                          <th
                            key={col.name}
                            className="relative px-3 py-2 text-[14px] font-medium text-[#cccccc] whitespace-nowrap border-r border-[#1a1a1a] select-none group/colheader"
                            style={{ width: `${width}px`, minWidth: `${Math.max(80, width)}px`, maxWidth: `${width}px` }}
                          >
                            <div className="flex items-center gap-1.5 min-w-0 pr-2.5 overflow-hidden whitespace-nowrap">
                              <span className="font-sans text-white text-[14px] whitespace-nowrap shrink-0" title={col.name}>
                                {col.name}
                              </span>
                              {col.primary_key && (
                                <span title="Primary Key" className="shrink-0 p-0.5 rounded bg-amber-500/10 text-amber-400">
                                  <Key className="w-3 h-3" />
                                </span>
                              )}
                              {isFk && (
                                <span title="Foreign Key" className="shrink-0 p-0.5 rounded bg-blue-500/10 text-blue-400">
                                  <Link2 className="w-3 h-3" />
                                </span>
                              )}
                              <span className={`text-[12.5px] font-mono whitespace-nowrap shrink-0 ${badge.color}`}>
                                {formatColumnType(col.type)}
                              </span>
                            </div>

                            {/* Interactive Column Resize Handle */}
                            <div
                              onMouseDown={(e) => handleResizeStart(e, col.name, width)}
                              title="Drag to resize column"
                              className="absolute right-0 top-0 bottom-0 w-2.5 cursor-col-resize group/resizer flex items-center justify-center select-none z-10 hover:bg-blue-500/20 active:bg-blue-500/40"
                            >
                              <div className="w-[1.5px] h-full bg-transparent group-hover/resizer:bg-blue-500 transition-colors" />
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody className={`divide-y divide-[#181818] ${isRowsLoading ? 'opacity-60 transition-opacity' : ''}`}>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length + 1} className="p-12 text-center text-[#666666] text-[14px]">
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
                            {/* Row Tickmark Checkbox & Expand Button */}
                            <td
                              className="px-3 py-2 text-left select-none sticky left-0 bg-[#0a0a0a] group-hover:bg-[#121212] z-10 border-r border-[#1a1a1a]"
                              style={{ width: '64px', minWidth: '64px', maxWidth: '64px' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-start gap-1.5">
                                {/* Tickmark Checkbox */}
                                <button
                                  type="button"
                                  onClick={(e) => handleToggleRowSelect(e, idx)}
                                  title={selectedRowIndices.has(idx) ? 'Deselect row' : 'Select row'}
                                  className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-colors cursor-pointer ${
                                    selectedRowIndices.has(idx)
                                      ? 'bg-blue-600 border-blue-500 text-white'
                                      : 'bg-[#141414] border-[#2c2c2c] hover:border-[#444444] text-transparent hover:text-[#555555]'
                                  }`}
                                >
                                  <Check className="w-3 h-3 stroke-[2.5]" />
                                </button>

                                {/* Expand Row Button */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelectRow(idx);
                                    setIsDetailsOpen(true);
                                  }}
                                  title="Edit row details"
                                  className="w-4 h-4 rounded-[4px] flex items-center justify-center text-[#666666] hover:text-white hover:bg-[#1c1c1c] transition-colors cursor-pointer"
                                >
                                  <Maximize2 className="w-3 h-3" />
                                </button>
                              </div>
                            </td>

                            {/* Cells with Matching Fixed Widths */}
                            {columns.map((col) => {
                              const width = getColWidth(col.name, col.type);
                              const val = row[col.name];
                              const isNull = val === null || val === undefined;
                              const isBool = typeof val === 'boolean';
                              const isObj = typeof val === 'object' && val !== null;
                              const strVal = isNull ? 'null' : isObj ? JSON.stringify(val) : String(val);

                              return (
                                <td
                                  key={col.name}
                                  className="px-3 py-2 text-[#cccccc] text-[14px] whitespace-nowrap overflow-hidden border-r border-[#151515]"
                                  style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
                                  title={strVal}
                                >
                                  {isNull ? (
                                    <span className="text-[#555555] italic text-[12.5px]">null</span>
                                  ) : isBool ? (
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[12.5px] font-medium ${
                                        val ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                                      }`}
                                    >
                                      {val ? 'true' : 'false'}
                                    </span>
                                  ) : isObj ? (
                                    <span className="text-pink-400 flex items-center gap-1 text-[12.5px]">
                                      <Code2 className="w-3.5 h-3.5" />
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
            <div className="h-10 shrink-0 px-4 bg-[#0a0a0a] border-t border-[#222222] flex items-center justify-between text-[13px] text-[#8c8c8c] select-none">
              <div className="flex items-center gap-1.5">
                <span>Page size:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="h-6 px-1.5 bg-[#141414] border border-[#242424] rounded text-[12px] text-white"
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
                <h3 className="text-[16px] font-semibold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-400" />
                  Database Schema & Entity Relationships
                </h3>
                <p className="text-[13px] text-[#8c8c8c] mt-0.5">
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
                        <span className="font-mono font-medium text-white text-[14px] truncate">{t.name}</span>
                      </div>
                      <span className="text-[12px] font-mono px-1.5 py-0.5 rounded bg-[#181818] text-[#8c8c8c]">
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
                  <span className="text-[16px] font-semibold text-white">SQL Query Runner</span>
                  <span className="text-[12px] text-[#666666]">
                    (<kbd className="px-1 py-0.5 rounded bg-[#1c1c1c] text-[#8c8c8c] font-mono">Ctrl+Enter</kbd> to execute)
                  </span>
                </div>

                {/* Preset query buttons */}
                <div className="flex items-center gap-1.5">
                  {selectedTable && (
                    <button
                      onClick={() => setSqlQuery(`SELECT * FROM ${selectedTable} LIMIT 25;`)}
                      className="px-2 py-0.5 rounded bg-[#141414] border border-[#242424] text-[12px] text-[#8c8c8c] hover:text-white"
                    >
                      SELECT *
                    </button>
                  )}
                  {selectedTable && (
                    <button
                      onClick={() => setSqlQuery(`SELECT count(*) AS total_rows FROM ${selectedTable};`)}
                      className="px-2 py-0.5 rounded bg-[#141414] border border-[#242424] text-[12px] text-[#8c8c8c] hover:text-white"
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
                <div className="text-[12px] text-[#666666]">
                  Target database: <span className="font-mono text-[#cccccc]">{selectedDb}</span>
                </div>

                <button
                  onClick={handleExecuteSql}
                  disabled={isExecutingSql || !sqlQuery.trim()}
                  className="flex items-center gap-2 h-8 px-4 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] disabled:opacity-40 text-[#cccccc] hover:text-white text-[13px] font-medium transition-colors cursor-pointer"
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
                  <span className="text-[13px] font-medium text-white">Query Output</span>
                  {sqlDuration !== null && (
                    <span className="text-[12px] px-1.5 py-0.5 rounded bg-[#1c1c1c] text-[#8c8c8c] font-mono">
                      {sqlDuration}ms
                    </span>
                  )}
                </div>

                {sqlResult?.rows && sqlResult.rows.length > 0 && (
                  <div className="text-[12px] text-[#8c8c8c]">
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
                  <div className="p-6 text-center text-emerald-400 text-[14px]">
                    <Check className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
                    Query executed successfully. Affected rows: {sqlResult.affected_rows}
                  </div>
                ) : (
                  <table className="w-full border-collapse text-left font-mono text-[13px]">
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
                                <span className="text-[#555555] italic text-[12px]">null</span>
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
          SLIDEOVER: RIGHT OVERFLOW DRAWER PANEL (matching Database page)
          ══════════════════════════════════════════════════════════════════════ */}
      {/* ══════════════════════════════════════════════════════════════════════
          SLIDEOVER: RIGHT OVERFLOW DRAWER PANEL (matching Database page)
          ══════════════════════════════════════════════════════════════════════ */}
      <SlideOver
        isOpen={isDetailsOpen}
        onClose={() => {
          setIsDetailsOpen(false);
          setIsInsertModeInPanel(false);
          setInspectorTab('details');
        }}
        width="w-[520px] max-w-full"
        title={
          isInsertModeInPanel
            ? 'Insert New Row'
            : activeRow
            ? `Row #${selectedRowIndex! + 1}`
            : ''
        }
        subtitle={
          isInsertModeInPanel
            ? `Add record to ${selectedTable}`
            : activeRow
            ? `${selectedTable} · ${columns.length} columns`
            : ''
        }
      >
        {/* Tab bar (Segmented control matching Databases page) */}
        {!isInsertModeInPanel && activeRow && (
          <div className="px-5 py-3 border-b border-[#222222] bg-[#0e0e0e] shrink-0 font-sans">
            <div className="inline-flex items-center p-0.5 rounded-[8px] bg-transparent border border-[#262626]">
              <button
                type="button"
                onClick={() => setInspectorTab('details')}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                  inspectorTab === 'details'
                    ? 'bg-[#161616] text-white border-[#333333]'
                    : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
                }`}
              >
                <span>Record Values</span>
              </button>
              <button
                type="button"
                onClick={() => setInspectorTab('danger')}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                  inspectorTab === 'danger'
                    ? 'bg-[#161616] text-white border-[#333333]'
                    : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
                }`}
              >
                <span>Danger</span>
              </button>
            </div>
          </div>
        )}

        {/* Drawer Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 font-sans">
          {isInsertModeInPanel ? (
            /* Insert New Row Form */
            <div className="space-y-4 font-sans">
              <div className="text-[13.5px] text-[#8c8c8c]">
                Specify column values for the new record in <span className="font-mono text-white font-medium">{selectedTable}</span>.
              </div>

              <div className="space-y-4">
                {columns.map((col) => {
                  const val = rowEditValues[col.name];
                  const normType = col.type.toLowerCase();
                  const isAutoPk = col.primary_key && normType.includes('int');
                  const isNumber =
                    normType.includes('int') ||
                    normType.includes('float') ||
                    normType.includes('double') ||
                    normType.includes('decimal') ||
                    normType.includes('numeric') ||
                    normType.includes('real') ||
                    normType.includes('serial') ||
                    normType.includes('money');
                  const isBool = normType.includes('bool') || normType === 'bit';

                  return (
                    <div key={col.name} className="space-y-1.5">
                      {/* Title & Type Header Above Input */}
                      <div className="flex items-center justify-between">
                        <label className="text-[13.5px] font-medium text-white flex items-center gap-1.5 font-sans">
                          <span>{col.name}</span>
                          {col.primary_key && <Key className="w-3 h-3 text-amber-400 shrink-0" />}
                        </label>
                        <span className="text-[12px] font-mono text-[#777777]">
                          {col.type}
                        </span>
                      </div>

                      {/* Input placed directly under title */}
                      <div>
                        {isBool ? (
                          <CustomSelect
                            value={val === null || val === undefined ? '' : String(val)}
                            options={[
                              { value: '', label: 'NULL (Unset)' },
                              { value: 'true', label: 'TRUE' },
                              { value: 'false', label: 'FALSE' },
                            ]}
                            onChange={(v) => {
                              setRowEditValues({
                                ...rowEditValues,
                                [col.name]: v === '' ? null : v === 'true',
                              });
                            }}
                            menuWidth="w-full"
                          />
                        ) : isNumber ? (
                          <input
                            type="number"
                            step={normType.includes('float') || normType.includes('double') || normType.includes('numeric') || normType.includes('decimal') ? 'any' : '1'}
                            placeholder={isAutoPk ? 'Auto-increment' : col.nullable ? 'Optional (NULL)' : 'Required'}
                            value={val === null || val === undefined ? '' : String(val)}
                            onChange={(e) =>
                              setRowEditValues({ ...rowEditValues, [col.name]: e.target.value })
                            }
                            className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white font-sans focus:outline-none focus:border-[#3b82f6] transition-colors placeholder-[#555555]"
                          />
                        ) : (
                          <textarea
                            rows={3}
                            placeholder={col.nullable ? 'Optional (NULL)' : 'Required'}
                            value={val === null || val === undefined ? '' : String(val)}
                            onChange={(e) =>
                              setRowEditValues({ ...rowEditValues, [col.name]: e.target.value })
                            }
                            className="w-full min-h-[72px] rounded-[6px] border border-[#262626] bg-[#121212] p-2.5 text-[14px] text-white font-sans focus:outline-none focus:border-[#3b82f6] transition-colors resize-y placeholder-[#555555]"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : activeRow && inspectorTab === 'danger' ? (
            /* Danger Tab matching Databases page */
            <div className="space-y-4 font-sans">
              <div className="rounded-[8px] border border-[#3a1515] bg-[#0e0404] p-4">
                <h3 className="text-[16px] font-medium text-[#e5484d] mb-1 font-sans">Delete Record</h3>
                <p className="text-[13px] text-[#8c8c8c] mb-4 font-sans">
                  Permanently delete this row from <span className="text-white font-medium text-[13px] font-mono">{selectedTable}</span>. This action is irreversible and immediately executes against the database.
                </p>
                <button
                  type="button"
                  onClick={() => setDeleteRowTarget(activeRow)}
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
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Row</span>
                  </span>
                </button>
              </div>
            </div>
          ) : activeRow ? (
            /* Selected Row Editing Fields (Details Tab) with Input Area Under Title */
            <div className="space-y-4 font-sans">
              {columns.map((col) => {
                const val = rowEditValues[col.name];
                const isNull = val === null || val === undefined;
                const normType = col.type.toLowerCase();
                const isNumber =
                  normType.includes('int') ||
                  normType.includes('float') ||
                  normType.includes('double') ||
                  normType.includes('decimal') ||
                  normType.includes('numeric') ||
                  normType.includes('real') ||
                  normType.includes('serial') ||
                  normType.includes('money');
                const isBool = normType.includes('bool') || normType === 'bit';

                return (
                  <div key={col.name} className="space-y-1.5">
                    {/* Title & Type Header Above Input */}
                    <div className="flex items-center justify-between">
                      <label className="text-[13.5px] font-medium text-white flex items-center gap-1.5 font-sans">
                        <span>{col.name}</span>
                        {col.primary_key && <Key className="w-3 h-3 text-amber-400 shrink-0" />}
                      </label>
                      <span className="text-[12px] font-mono text-[#777777]">
                        {col.type}
                      </span>
                    </div>

                    {/* Input Area Placed Directly Under Title */}
                    <div>
                      {isBool ? (
                        <CustomSelect
                          disabled={col.primary_key}
                          value={isNull ? '' : String(val)}
                          options={[
                            { value: '', label: 'NULL' },
                            { value: 'true', label: 'TRUE' },
                            { value: 'false', label: 'FALSE' },
                          ]}
                          onChange={(v) => {
                            setRowEditValues({
                              ...rowEditValues,
                              [col.name]: v === '' ? null : v === 'true',
                            });
                          }}
                          menuWidth="w-full"
                        />
                      ) : isNumber ? (
                        <input
                          type="number"
                          step={normType.includes('float') || normType.includes('double') || normType.includes('numeric') || normType.includes('decimal') ? 'any' : '1'}
                          disabled={col.primary_key}
                          value={isNull ? '' : String(val)}
                          placeholder={col.nullable ? 'Optional (NULL)' : 'Required'}
                          onChange={(e) =>
                            setRowEditValues({ ...rowEditValues, [col.name]: e.target.value })
                          }
                          className={`h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white font-sans focus:outline-none focus:border-[#3b82f6] transition-colors placeholder-[#555555] ${
                            col.primary_key ? 'opacity-60 cursor-not-allowed bg-[#0d0d0d]' : ''
                          }`}
                        />
                      ) : (
                        <textarea
                          rows={3}
                          disabled={col.primary_key}
                          value={isNull ? '' : String(val)}
                          placeholder={col.nullable ? 'Optional (NULL)' : 'Required'}
                          onChange={(e) =>
                            setRowEditValues({ ...rowEditValues, [col.name]: e.target.value })
                          }
                          className={`w-full min-h-[72px] rounded-[6px] border border-[#262626] bg-[#121212] p-2.5 text-[14px] text-white font-sans focus:outline-none focus:border-[#3b82f6] transition-colors resize-y placeholder-[#555555] ${
                            col.primary_key ? 'opacity-60 cursor-not-allowed bg-[#0d0d0d]' : ''
                          }`}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        {/* Footer (Pinned to bottom matching Databases page) */}
        {(isInsertModeInPanel || (activeRow && inspectorTab === 'details')) && (
          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans shrink-0">
            <button
              type="button"
              onClick={() => {
                if (isInsertModeInPanel) {
                  setIsInsertModeInPanel(false);
                } else {
                  setIsDetailsOpen(false);
                }
              }}
              className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
            >
              Close
            </button>
            <button
              type="button"
              onClick={isInsertModeInPanel ? handleInsertRowFromPanel : handleSaveRowEdit}
              disabled={isSavingRow}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative flex items-center gap-1.5 text-[14px] font-sans">
                {isSavingRow ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>{isInsertModeInPanel ? 'Save Record' : 'Save'}</span>
                )}
              </span>
            </button>
          </div>
        )}
      </SlideOver>

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
