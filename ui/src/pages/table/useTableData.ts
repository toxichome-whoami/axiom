/*
 * Custom hook for Table Data Pipeline (sequential Schema -> Rows loading, pagination, filters, sorting, and schema caching).
 * Owned by: ui/pages/table
 * Key deps: react, ../../api/client, ../../types
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { api, DatabaseRecordApi } from '../../api/client';
import { ColumnInfoApi, ForeignKeyInfoApi, TableInfoApi } from '../../types';

export interface UseTableDataProps {
  selectedDb: string;
  setSelectedDb: (db: string) => void;
  viewMode: 'grid' | 'schema' | 'sql';
}

export function useTableData({ selectedDb, setSelectedDb, viewMode }: UseTableDataProps) {
  const [databases, setDatabases] = useState<DatabaseRecordApi[]>([]);
  const [isDbsLoading, setIsDbsLoading] = useState(true);

  // Table Catalog State
  const [tables, setTables] = useState<TableInfoApi[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [isTablesLoading, setIsTablesLoading] = useState(false);
  const [tableSearch, setTableSearch] = useState('');

  // Schema Metadata State
  const [columns, setColumns] = useState<ColumnInfoApi[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfoApi[]>([]);
  const [isSchemaLoading, setIsSchemaLoading] = useState(false);
  const [allDbTablesSchema, setAllDbTablesSchema] = useState<
    Record<string, { columns: ColumnInfoApi[]; foreign_keys?: ForeignKeyInfoApi[] }>
  >({});
  const schemaCacheRef = useRef<
    Record<string, { columns: ColumnInfoApi[]; foreign_keys?: ForeignKeyInfoApi[] }>
  >({});
  const activeTargetKeyRef = useRef<string>('');

  // Data Grid Rows & Pagination
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [isRowsLoading, setIsRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [pageSize, setPageSize] = useState(50);

  // Filter & Sort State
  const [filterCol, setFilterCol] = useState('');
  const [filterOp, setFilterOp] = useState<'eq' | 'neq' | 'gt' | 'lt' | 'like' | 'is_null'>('eq');
  const [filterVal, setFilterVal] = useState('');
  const [activeFilter, setActiveFilter] = useState<{ col: string; op: string; val: string } | null>(null);

  const [sortCol, setSortCol] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [activeSort, setActiveSort] = useState<{ col: string; order: 'asc' | 'desc' } | null>(null);

  // 1. Load Connected Database Pools on Mount
  useEffect(() => {
    async function initDatabases() {
      setIsDbsLoading(true);
      try {
        const res = await api.listDatabases();
        const dbs = res.databases || [];
        setDatabases(dbs);

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
  }, [setSelectedDb]);

  // 2. Load Tables when Database changes
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
    }
  }, [selectedDb, fetchTables]);

  // 3. Phased Sequential Data Pipeline: Schema -> Rows
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

      const cached = schemaCacheRef.current[selectedTable];
      let cols = cached?.columns || [];
      let fks = cached?.foreign_keys || [];

      const needsSchema = options?.reloadSchema || cols.length === 0;

      if (needsSchema) {
        setIsSchemaLoading(true);
        setIsRowsLoading(true);
        try {
          const schemaRes = await api.getTableSchema(selectedDb, selectedTable);
          if (activeTargetKeyRef.current !== currentKey) return;

          cols = schemaRes.columns || [];
          fks = schemaRes.foreign_keys || [];
          setColumns(cols);
          setForeignKeys(fks);

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

      // Phase 2: Fetch Rows
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
    [selectedDb, selectedTable, pageSize, activeFilter, activeSort]
  );

  // Full reload when active table/db/view changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedDb && selectedTable && viewMode === 'grid') {
      setCursor(null);
      setCursorHistory([]);
      loadTableData({ reloadSchema: false });
    }
  }, [selectedDb, selectedTable, viewMode]);

  // Row-only reload when filter/sort/pageSize changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedDb && selectedTable && viewMode === 'grid' && columns.length > 0) {
      setCursor(null);
      setCursorHistory([]);
      loadTableData({ reloadSchema: false });
    }
  }, [pageSize, activeFilter, activeSort]);

  // Lazy schema fetch for ER diagram
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
        } catch {}
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

  return {
    databases,
    isDbsLoading,
    tables,
    selectedTable,
    setSelectedTable,
    isTablesLoading,
    tableSearch,
    setTableSearch,
    fetchTables,
    columns,
    foreignKeys,
    isSchemaLoading,
    allDbTablesSchema,
    schemaCacheRef,
    rows,
    setRows,
    isRowsLoading,
    rowsError,
    cursor,
    setCursor,
    cursorHistory,
    setCursorHistory,
    hasNextPage,
    pageSize,
    setPageSize,
    filterCol,
    setFilterCol,
    filterOp,
    setFilterOp,
    filterVal,
    setFilterVal,
    activeFilter,
    setActiveFilter,
    sortCol,
    setSortCol,
    sortOrder,
    setSortOrder,
    activeSort,
    setActiveSort,
    loadTableData,
  };
}
