/*
 * Custom hook for Table Data Pipeline (sequential Schema -> Rows loading, pagination, filters, sorting, and schema caching).
 * Owned by: ui/pages/table
 * Key deps: react, ../../api/client, ../../types
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { api, DatabaseRecordApi } from "../../api/client";
import { ColumnInfoApi, ForeignKeyInfoApi, TableInfoApi } from "../../types";

export interface UseTableDataProps {
  selectedDb: string;
  setSelectedDb: (db: string) => void;
  viewMode: "grid" | "schema" | "sql";
}

export function useTableData({
  selectedDb,
  setSelectedDb,
  viewMode,
}: UseTableDataProps) {
  const [databases, setDatabases] = useState<DatabaseRecordApi[]>([]);
  const [isDbsLoading, setIsDbsLoading] = useState(true);

  // Table Catalog State
  const [tables, setTables] = useState<TableInfoApi[]>([]);
  const [loadedDb, setLoadedDb] = useState<string>("");
  const [selectedTable, setSelectedTable] = useState<string>(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const v =
        urlParams.get("view") || localStorage.getItem("axiom_view_mode");
      if (v === "schema") {
        // Schema ER visualizer starts with clean view (no table selected/dimmed)
        return "";
      }
      const queryTable = urlParams.get("table");
      if (queryTable) return queryTable;
      const db =
        urlParams.get("db") || localStorage.getItem("axiom_selected_db") || "";
      return (
        (db ? localStorage.getItem(`axiom_selected_table_${db}`) : null) ||
        localStorage.getItem("axiom_selected_table") ||
        ""
      );
    } catch {
      return "";
    }
  });
  const [isTablesLoading, setIsTablesLoading] = useState(false);
  const [tableSearch, setTableSearch] = useState("");

  // Schema Metadata State
  const [columns, setColumns] = useState<ColumnInfoApi[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfoApi[]>([]);
  const [isSchemaLoading, setIsSchemaLoading] = useState(false);
  const [allDbTablesSchema, setAllDbTablesSchema] = useState<
    Record<
      string,
      { columns: ColumnInfoApi[]; foreign_keys?: ForeignKeyInfoApi[] }
    >
  >({});
  const schemaCacheRef = useRef<
    Record<
      string,
      { columns: ColumnInfoApi[]; foreign_keys?: ForeignKeyInfoApi[] }
    >
  >({});
  const activeTargetKeyRef = useRef<string>("");

  // Data Grid Rows & Pagination
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [isRowsLoading, setIsRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [pageSize, setPageSize] = useState(50);

  // Filter & Sort State
  const [filterCol, setFilterCol] = useState("");
  const [filterOp, setFilterOp] = useState<
    "eq" | "neq" | "gt" | "lt" | "like" | "is_null"
  >("eq");
  const [filterVal, setFilterVal] = useState("");
  const [activeFilter, setActiveFilter] = useState<{
    col: string;
    op: string;
    val: unknown;
  } | null>(null);

  const [sortCol, setSortCol] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [activeSort, setActiveSort] = useState<{
    col: string;
    order: "asc" | "desc";
  } | null>(null);

  // 1. Load Connected Database Pools on Mount
  useEffect(() => {
    async function initDatabases() {
      setIsDbsLoading(true);
      try {
        const res = await api.listDatabases();
        const dbs = res.databases || [];
        setDatabases(dbs);

        const urlParams = new URLSearchParams(window.location.search);
        const savedDb = localStorage.getItem("axiom_selected_db");
        const queryDb = urlParams.get("db") || savedDb;
        const defaultDb =
          queryDb && dbs.some((d) => d.alias === queryDb)
            ? queryDb
            : dbs[0]?.alias || "";

        setSelectedDb(defaultDb);
      } catch (err) {
        console.error("Failed to load database pools:", err);
      } finally {
        setIsDbsLoading(false);
      }
    }
    initDatabases();
  }, [setSelectedDb]);

  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  // 2. Load Tables when Database changes
  const fetchTables = useCallback(
    async (db: string): Promise<TableInfoApi[]> => {
      if (!db) return [];
      setIsTablesLoading(true);
      try {
        const res = await api.getDatabaseTables(db, undefined, 500);
        const tableList = res.tables || [];
        setTables(tableList);
        setLoadedDb(db);

        const currentTableNames = new Set(tableList.map((t) => t.name));

        // Clean up deleted/dropped tables from schema cache for this db
        const prunedCache: Record<
          string,
          { columns: ColumnInfoApi[]; foreign_keys?: ForeignKeyInfoApi[] }
        > = {};
        const prefix = `${db}:`;
        for (const [key, entry] of Object.entries(schemaCacheRef.current)) {
          if (key.startsWith(prefix)) {
            const tName = key.slice(prefix.length);
            if (currentTableNames.has(tName)) {
              prunedCache[key] = entry;
            }
          } else {
            // Keep cache for other databases
            prunedCache[key] = entry;
          }
        }
        schemaCacheRef.current = prunedCache;

        // Reset allDbTablesSchema to only contain tables from the currently loaded db
        setAllDbTablesSchema(() => {
          const next: Record<
            string,
            { columns: ColumnInfoApi[]; foreign_keys?: ForeignKeyInfoApi[] }
          > = {};
          for (const tName of currentTableNames) {
            const cached = prunedCache[`${db}:${tName}`];
            if (cached) {
              next[tName] = cached;
            }
          }
          return next;
        });

        const urlParams = new URLSearchParams(window.location.search);
        const queryTable = urlParams.get("table");
        const savedTable =
          localStorage.getItem(`axiom_selected_table_${db}`) ||
          localStorage.getItem("axiom_selected_table");

        // If database has NO tables at all (e.g. user dropped all tables or new database):
        if (tableList.length === 0) {
          setSelectedTable("");
          setColumns([]);
          setForeignKeys([]);
          setRows([]);
          setRowsError(null);
          try {
            localStorage.removeItem(`axiom_selected_table_${db}`);
            localStorage.removeItem("axiom_selected_table");
            const url = new URL(window.location.href);
            if (url.searchParams.has("table")) {
              url.searchParams.delete("table");
              window.history.replaceState(null, "", url.pathname + url.search);
            }
          } catch {
            // Ignore
          }
          return [];
        }

        setSelectedTable((prev) => {
          // In schema view, start clean with all nodes unselected after load or reload
          if (viewModeRef.current === "schema") {
            return "";
          }
          let targetTable = "";
          // 1. If currently selected table exists in the new list, keep it
          if (prev && tableList.some((t: TableInfoApi) => t.name === prev)) {
            targetTable = prev;
          } else if (
            queryTable &&
            tableList.some((t: TableInfoApi) => t.name === queryTable)
          ) {
            // 2. If table from URL query exists in the list, select it
            targetTable = queryTable;
          } else if (
            savedTable &&
            tableList.some((t: TableInfoApi) => t.name === savedTable)
          ) {
            // 3. If table from localStorage exists in the list, select it
            targetTable = savedTable;
          } else {
            // 4. Default to first table
            targetTable = tableList[0]?.name || "";
          }

          if (targetTable !== prev) {
            setRowsError(null);
          }
          return targetTable;
        });

        return tableList;
      } catch (err) {
        console.error(`Failed to load tables for ${db}:`, err);
        setTables([]);
        setLoadedDb(db);
        setSelectedTable("");
        setColumns([]);
        setForeignKeys([]);
        setRows([]);
        setRowsError(null);
        return [];
      } finally {
        setIsTablesLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (selectedDb) {
      setLoadedDb("");
      setColumns([]);
      setForeignKeys([]);
      setRows([]);
      setRowsError(null);
      setAllDbTablesSchema({});
      fetchTables(selectedDb);
      setCursor(null);
      setCursorHistory([]);
      setActiveFilter(null);
      setActiveSort(null);
    }
  }, [selectedDb, fetchTables]);

  // Sync selectedDb and selectedTable to URL search params and localStorage
  useEffect(() => {
    if (!selectedDb) return;
    try {
      localStorage.setItem("axiom_selected_db", selectedDb);
      if (viewMode !== "schema") {
        if (selectedTable) {
          localStorage.setItem(
            `axiom_selected_table_${selectedDb}`,
            selectedTable,
          );
          localStorage.setItem("axiom_selected_table", selectedTable);
        } else {
          localStorage.removeItem(`axiom_selected_table_${selectedDb}`);
          localStorage.removeItem("axiom_selected_table");
        }
      }

      const url = new URL(window.location.href);
      let changed = false;
      if (url.searchParams.get("db") !== selectedDb) {
        url.searchParams.set("db", selectedDb);
        changed = true;
      }
      if (viewMode === "schema") {
        if (url.searchParams.has("table")) {
          url.searchParams.delete("table");
          changed = true;
        }
      } else {
        if (selectedTable && url.searchParams.get("table") !== selectedTable) {
          url.searchParams.set("table", selectedTable);
          changed = true;
        } else if (!selectedTable && url.searchParams.has("table")) {
          url.searchParams.delete("table");
          changed = true;
        }
      }
      if (changed) {
        window.history.replaceState(null, "", url.pathname + url.search);
      }
    } catch {
      // Ignore in restricted environments
    }
  }, [selectedDb, selectedTable, viewMode]);

  // Handle browser back / forward navigation
  useEffect(() => {
    const handlePopState = () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const queryDb = urlParams.get("db");
        const queryTable = urlParams.get("table");
        if (queryDb && queryDb !== selectedDb) {
          setSelectedDb(queryDb);
        }
        if (queryTable && queryTable !== selectedTable) {
          setSelectedTable(queryTable);
        }
      } catch {
        // Ignore
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [selectedDb, selectedTable, setSelectedDb]);

  // 3. Phased Sequential Data Pipeline: Schema -> Rows
  const loadTableData = useCallback(
    async (options?: {
      targetCursor?: string | null;
      reloadSchema?: boolean;
    }) => {
      const targetCursor = options?.targetCursor;

      if (!selectedDb || !selectedTable) {
        setColumns([]);
        setForeignKeys([]);
        setRows([]);
        setRowsError(null);
        setIsSchemaLoading(false);
        setIsRowsLoading(false);
        return;
      }

      const currentKey = `${selectedDb}:${selectedTable}`;
      activeTargetKeyRef.current = currentKey;
      setRowsError(null);

      const cached = schemaCacheRef.current[currentKey];
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
          schemaCacheRef.current = {
            ...schemaCacheRef.current,
            [currentKey]: entry,
          };
          setAllDbTablesSchema((prev) => ({ ...prev, [selectedTable]: entry }));
        } catch (err: unknown) {
          if (activeTargetKeyRef.current !== currentKey) return;
          console.error(
            `Failed to load schema for ${selectedDb}.${selectedTable}:`,
            err,
          );
          setColumns([]);
          setForeignKeys([]);
          setRows([]);
          setIsSchemaLoading(false);
          setIsRowsLoading(false);
          setRowsError(
            err instanceof Error
              ? err.message
              : "Failed to introspect table schema",
          );
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
          const targetCol = cols.find(
            (c) => c.name.toLowerCase() === activeFilter.col.toLowerCase(),
          );
          let finalVal: unknown = activeFilter.val;
          if (targetCol) {
            const isNumeric =
              /int|serial|bigint|smallint|float|double|decimal|numeric|number/i.test(
                targetCol.type,
              );
            const isBoolean = /bool/i.test(targetCol.type);
            if (
              isNumeric &&
              typeof finalVal === "string" &&
              finalVal.trim() !== "" &&
              !isNaN(Number(finalVal))
            ) {
              finalVal = Number(finalVal);
            } else if (isBoolean && typeof finalVal === "string") {
              if (finalVal.trim().toLowerCase() === "true") finalVal = true;
              else if (finalVal.trim().toLowerCase() === "false")
                finalVal = false;
            }
          } else if (
            typeof finalVal === "string" &&
            finalVal.trim() !== "" &&
            !isNaN(Number(finalVal))
          ) {
            finalVal = Number(finalVal);
          }

          filterParam = JSON.stringify({
            [activeFilter.col]: { [activeFilter.op]: finalVal },
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
        const msg =
          err instanceof Error ? err.message : "Failed to query table rows";
        if (
          msg.toLowerCase().includes("no such table") ||
          msg.toLowerCase().includes("does not exist")
        ) {
          try {
            localStorage.removeItem(`axiom_selected_table_${selectedDb}`);
            localStorage.removeItem("axiom_selected_table");
            const url = new URL(window.location.href);
            if (url.searchParams.has("table")) {
              url.searchParams.delete("table");
              window.history.replaceState(null, "", url.pathname + url.search);
            }
          } catch {
            // Ignore
          }
          fetchTables(selectedDb);
        }
        setRowsError(msg);
        setRows([]);
      } finally {
        if (activeTargetKeyRef.current === currentKey) {
          setIsRowsLoading(false);
        }
      }
    },
    [
      selectedDb,
      selectedTable,
      pageSize,
      activeFilter,
      activeSort,
      fetchTables,
    ],
  );

  // Full reload when active table/db/view changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedDb && selectedTable && viewMode === "grid") {
      if (loadedDb !== selectedDb) {
        // Still loading table catalog for this database; wait for fetchTables
        return;
      }
      if (tables.length > 0 && !tables.some((t) => t.name === selectedTable)) {
        // Table not in this database; skip executing invalid query
        return;
      }
      setCursor(null);
      setCursorHistory([]);
      loadTableData({ reloadSchema: false });
    }
  }, [selectedDb, selectedTable, viewMode, loadedDb, tables]);

  // Row-only reload when filter/sort/pageSize changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (
      selectedDb &&
      selectedTable &&
      viewMode === "grid" &&
      columns.length > 0
    ) {
      setCursor(null);
      setCursorHistory([]);
      loadTableData({ reloadSchema: false });
    }
  }, [pageSize, activeFilter, activeSort]);

  // Lazy schema fetch for ER diagram
  useEffect(() => {
    if (viewMode !== "schema" || !selectedDb || tables.length === 0) return;
    const missing = tables.filter(
      (t) => !schemaCacheRef.current[`${selectedDb}:${t.name}`],
    );
    if (missing.length === 0) return;

    let cancelled = false;
    async function loadErSchemas() {
      try {
        const results = await Promise.all(
          missing.map(async (t) => {
            try {
              const res = await api.getTableSchema(selectedDb, t.name);
              return {
                tableName: t.name,
                columns: res.columns || [],
                foreign_keys: res.foreign_keys || [],
              };
            } catch {
              return {
                tableName: t.name,
                columns: [],
                foreign_keys: [],
              };
            }
          }),
        );

        if (cancelled) return;

        const cacheUpdates: Record<
          string,
          { columns: ColumnInfoApi[]; foreign_keys: ForeignKeyInfoApi[] }
        > = {};
        const localUpdates: Record<
          string,
          { columns: ColumnInfoApi[]; foreign_keys: ForeignKeyInfoApi[] }
        > = {};
        for (const item of results) {
          const entry = {
            columns: item.columns,
            foreign_keys: item.foreign_keys,
          };
          cacheUpdates[`${selectedDb}:${item.tableName}`] = entry;
          localUpdates[item.tableName] = entry;
        }

        schemaCacheRef.current = { ...schemaCacheRef.current, ...cacheUpdates };
        setAllDbTablesSchema((prev) => ({ ...prev, ...localUpdates }));
      } catch {
        // Ignore
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
    setAllDbTablesSchema,
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
