/*
 * Supabase Studio and Neon inspired multi-pane Table Editor, Schema Visualizer, and SQL Console.
 * Owned by: ui/pages
 * Key deps: lucide-react, ../api/client, ../types, ../components/ui/ConfirmDialog
 * Invariants: Single source of truth for active database and table; lock-free editing via right panel inspector; zero slop.
 * Architecture: Decomposed into modular domain hooks and view components matching ui/pages/storage pattern.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SlideOver } from '../components/ui/SlideOver';
import { ColumnInfoApi } from '../types';
import {
  mapSqlTypeToFormValue,
  exportTableData,
} from './table/format';
import {
  InlineCellEditorPopover,
  InlineBooleanPopover,
  InlineNumberPopover,
  InlineJsonPopover,
  InlineTextPopover,
} from './table/InlineCellEditorPopover';
import {
  InlineDateTimePickerPopover,
} from './table/DateTimePickerPopovers';
import {
  ForeignKeyRecordPreviewPopover,
  ForeignKeyPickerModal,
} from './table/ForeignKeyModals';
import { RowInspectorSlideOver } from './table/RowInspectorSlideOver';
import { ColumnSlideOver } from './table/ColumnSlideOver';
import { TableSidebar } from './table/TableSidebar';
import { TableToolbar } from './table/TableToolbar';
import { TableGridView } from './table/TableGridView';
import { SchemaView } from './table/SchemaView';
import { SqlConsoleView } from './table/SqlConsoleView';
import { ColumnContextMenu } from './table/ColumnContextMenu';
import { GridContextMenu, GridContextMenuState } from './table/GridContextMenu';

// Domain Custom Hooks
import { useTableData } from './table/useTableData';
import { useColumnResizer } from './table/useColumnResizer';
import { useCellEditor } from './table/useCellEditor';
import { useColumnOperations } from './table/useColumnOperations';
import { useRowOperations } from './table/useRowOperations';
import { useSqlConsole } from './table/useSqlConsole';

export function TableEditor() {
  const [selectedDb, setSelectedDb] = useState<string>(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('db') || localStorage.getItem('axiom_selected_db') || '';
    } catch {
      return '';
    }
  });
  const [viewMode, setViewMode] = useState<'grid' | 'schema' | 'sql'>(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const v = urlParams.get('view');
      if (v === 'grid' || v === 'schema' || v === 'sql') return v;
      const saved = localStorage.getItem('axiom_view_mode');
      if (saved === 'grid' || saved === 'schema' || saved === 'sql') return saved;
    } catch {
      // Ignore
    }
    return 'grid';
  });
  const [gridSubTab, setGridSubTab] = useState<'data' | 'definition'>(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const tab = urlParams.get('subtab');
      if (tab === 'data' || tab === 'definition') return tab;
      const saved = localStorage.getItem('axiom_grid_subtab');
      if (saved === 'data' || saved === 'definition') return saved;
    } catch {
      // Ignore
    }
    return 'data';
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Sync viewMode and gridSubTab to URL search params and localStorage
  useEffect(() => {
    try {
      localStorage.setItem('axiom_view_mode', viewMode);
      localStorage.setItem('axiom_grid_subtab', gridSubTab);

      const url = new URL(window.location.href);
      let changed = false;
      if (url.searchParams.get('view') !== viewMode) {
        url.searchParams.set('view', viewMode);
        changed = true;
      }
      if (viewMode === 'grid') {
        if (url.searchParams.get('subtab') !== gridSubTab) {
          url.searchParams.set('subtab', gridSubTab);
          changed = true;
        }
      } else {
        if (url.searchParams.has('subtab')) {
          url.searchParams.delete('subtab');
          changed = true;
        }
      }

      if (changed) {
        window.history.replaceState(null, '', url.pathname + url.search);
      }
    } catch {
      // Ignore
    }
  }, [viewMode, gridSubTab]);

  // Handle popstate for viewMode and gridSubTab
  useEffect(() => {
    const handlePopState = () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const v = urlParams.get('view');
        if (v === 'grid' || v === 'schema' || v === 'sql') {
          setViewMode(v);
        }
        const tab = urlParams.get('subtab');
        if (tab === 'data' || tab === 'definition') {
          setGridSubTab(tab);
        }
      } catch {
        // Ignore
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 1. Core Table & Schema Data Pipeline Hook
  const {
    databases,
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
  } = useTableData({ selectedDb, setSelectedDb, viewMode });

  // 2. Column Resizer & Interactive Width Hook
  const {
    columnWidths,
    setColumnWidths,
    isColReadOnly,
    getColWidth,
    handleResizeStart,
  } = useColumnResizer({ selectedDb, selectedTable });

  // 3. Row Selection & CRUD Drawer Hook
  const {
    isDetailsOpen,
    setIsDetailsOpen,
    inspectorTab,
    setInspectorTab,
    selectedRowIndex,
    setSelectedRowIndex,
    selectedRowIndices,
    rowEditValues,
    setRowEditValues,
    isSavingRow,
    isInsertModeInPanel,
    setIsInsertModeInPanel,
    deleteRowTarget,
    setDeleteRowTarget,
    isDeleteBatchConfirmOpen,
    setIsDeleteBatchConfirmOpen,
    isBatchDeleting,
    handleSelectRow,
    handleToggleRowSelect,
    handleToggleAllRows,
    handleSaveRowEdit,
    handleInsertRowFromPanel,
    handleDeleteRow,
    handleDeleteSelectedRows,
  } = useRowOperations({
    selectedDb,
    selectedTable,
    columns,
    rows,
    cursor,
    loadTableData,
  });

  // 4. Inline Cell Editor & Keyboard Navigation Hook
  const {
    selectedCell,
    setSelectedCell,
    editingCell,
    setEditingCell,
    expandedInlineCell,
    setExpandedInlineCell,
    fkPickerTarget,
    setFkPickerTarget,
    fkPreviewTarget,
    setFkPreviewTarget,
    handleStartCellEdit,
    handleSaveCellEdit,
    handleCommitCellEdit,
    handleSelectFkRecord,
  } = useCellEditor({
    selectedDb,
    selectedTable,
    columns,
    rows,
    setRows,
    foreignKeys,
    selectedRowIndex,
    setSelectedRowIndex,
    setRowEditValues,
    isColReadOnly,
    isDetailsOpen,
  });

  // 5. Column DDL Operations Hook (Add, Edit, Alter, Drop)
  const {
    isAddColumnOpen,
    setIsAddColumnOpen,
    editingColumn,
    setEditingColumn,
    isCreatingColumn,
    createColumnError,
    setCreateColumnError,
    newColName,
    setNewColName,
    newColType,
    setNewColType,
    newColIsArray,
    setNewColIsArray,
    newColDescription,
    setNewColDescription,
    newColDefault,
    setNewColDefault,
    newColNullable,
    setNewColNullable,
    newColIsUnique,
    setNewColIsUnique,
    newColIsPk,
    setNewColIsPk,
    newColCheck,
    setNewColCheck,
    newColFkSchema,
    setNewColFkSchema,
    newColFkTable,
    setNewColFkTable,
    newColFkColumn,
    setNewColFkColumn,
    newColFkOnUpdate,
    setNewColFkOnUpdate,
    newColFkOnDelete,
    setNewColFkOnDelete,
    isFkModalOpen,
    setIsFkModalOpen,
    draftFkSchema,
    setDraftFkSchema,
    draftFkTable,
    setDraftFkTable,
    draftFkColumn,
    setDraftFkColumn,
    draftFkPairs,
    setDraftFkPairs,
    draftFkOnUpdate,
    setDraftFkOnUpdate,
    draftFkOnDelete,
    setDraftFkOnDelete,
    isDiscardFkConfirmOpen,
    setIsDiscardFkConfirmOpen,
    handleSelectFkTargetTable,
    handleRequestCloseFkModal,
    deleteColumnTarget,
    setDeleteColumnTarget,
    isDeletingColumn,
    handleSaveColumn,
    handleDeleteColumn,
    resetColumnForm,
  } = useColumnOperations({
    selectedDb,
    selectedTable,
    databases,
    schemaCacheRef,
    loadTableData,
  });

  // 6. SQL Console Runner Hook
  const {
    sqlQuery,
    setSqlQuery,
    isExecutingSql,
    sqlResult,
    sqlError,
    sqlDuration,
    chunkProgress,
    batchSummary,
    handleExecuteSql,
    handleCancelSql,
  } = useSqlConsole({ selectedDb });

  // Column header dropdown menu state
  const [activeColumnMenu, setActiveColumnMenu] = useState<{
    col: ColumnInfoApi;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);

  // Discard changes confirmation dialog states for Row Inspector, Column Editor, and Expand Cell Editor
  const [isDiscardRowConfirmOpen, setIsDiscardRowConfirmOpen] = useState(false);
  const [isDiscardColumnConfirmOpen, setIsDiscardColumnConfirmOpen] = useState(false);
  const [isDiscardExpandedCellConfirmOpen, setIsDiscardExpandedCellConfirmOpen] = useState(false);

  // Row and Cell Right-Click Context Menu state
  const [gridContextMenu, setGridContextMenu] = useState<GridContextMenuState | null>(null);

  // Schema view states & controls
  const [schemaSearchTerm, setSchemaSearchTerm] = useState('');
  const [schemaTransform, setSchemaTransform] = useState({ x: 60, y: 60, scale: 0.95 });
  const [schemaAutoLayoutTrigger, setSchemaAutoLayoutTrigger] = useState(0);

  // Full SQL DDL generator for Schema view Copy as SQL
  const fullSqlDdl = useMemo(() => {
    let ddl = '';
    tables.forEach((t) => {
      const tData = allDbTablesSchema[t.name] || { columns: [], foreign_keys: [] };
      ddl += `CREATE TABLE ${t.name} (\n`;
      const colLines = tData.columns.map((c) => {
        let line = `  ${c.name} ${c.type}`;
        if (c.primary_key) line += ' PRIMARY KEY';
        if (!c.nullable) line += ' NOT NULL';
        return line;
      });
      if (tData.foreign_keys && tData.foreign_keys.length > 0) {
        tData.foreign_keys.forEach((fk) => {
          colLines.push(`  CONSTRAINT fk_${fk.column} FOREIGN KEY (${fk.column}) REFERENCES ${fk.referenced_table} (${fk.referenced_column})`);
        });
      }
      ddl += colLines.join(',\n') + '\n);\n\n';
    });
    return ddl.trim();
  }, [tables, allDbTablesSchema]);

  // Full Markdown Schema generator for Schema view Copy as Markdown
  const fullMarkdownSchema = useMemo(() => {
    let md = `# Database Schema: ${selectedDb || 'public'}\n\n`;
    tables.forEach((t) => {
      const tData = allDbTablesSchema[t.name] || { columns: [], foreign_keys: [] };
      md += `## Table \`${t.name}\`\n\n`;
      md += `| Column | Type | Nullable | Primary Key | Default |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- |\n`;
      tData.columns.forEach((c) => {
        md += `| \`${c.name}\` | \`${c.type}\` | ${c.nullable ? 'Yes' : 'No'} | ${c.primary_key ? 'Yes' : 'No'} | ${c.default_value ?? '-'} |\n`;
      });
      if (tData.foreign_keys && tData.foreign_keys.length > 0) {
        md += `\n**Foreign Keys:**\n\n`;
        tData.foreign_keys.forEach((fk) => {
          md += `- \`${fk.column}\` -> \`${fk.referenced_table}(${fk.referenced_column})\`\n`;
        });
      }
      md += `\n---\n\n`;
    });
    return md.trim();
  }, [selectedDb, tables, allDbTablesSchema]);

  const handleDownloadSvg = () => {
    try {
      const svgEl = document.querySelector('#axiom-schema-canvas svg') || document.querySelector('svg');
      // Create a clean standalone SVG of the schema diagrams
      const schemaPlane = document.querySelector('.origin-top-left') as HTMLElement | null;
      if (!schemaPlane) return;

      const serializer = new XMLSerializer();
      const svgElements = schemaPlane.querySelectorAll('svg');
      let combinedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" style="background:#09090b;font-family:Inter,sans-serif;">`;
      combinedSvg += `<style>text { font-family: Inter, sans-serif; fill: #ffffff; }</style>`;
      svgElements.forEach((s) => {
        combinedSvg += serializer.serializeToString(s);
      });
      combinedSvg += `</svg>`;

      const blob = new Blob([combinedSvg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedDb || 'schema'}-diagram.svg`;
      a.click();
      URL.revokeObjectURL(url);
      setCopiedKey('schema_svg');
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (err) {
      console.error('Failed to export SVG:', err);
    }
  };

  const handleDownloadPng = () => {
    try {
      const schemaPlane = document.querySelector('.origin-top-left') as HTMLElement | null;
      if (!schemaPlane) return;

      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Dark background
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Serialize SVG
      const serializer = new XMLSerializer();
      const svgElements = schemaPlane.querySelectorAll('svg');
      let combinedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" style="background:#09090b;font-family:Inter,sans-serif;">`;
      combinedSvg += `<style>text { font-family: Inter, sans-serif; fill: #ffffff; }</style>`;
      svgElements.forEach((s) => {
        combinedSvg += serializer.serializeToString(s);
      });
      combinedSvg += `</svg>`;

      const img = new Image();
      const svgBlob = new Blob([combinedSvg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((pngBlob) => {
          if (!pngBlob) return;
          const pngUrl = URL.createObjectURL(pngBlob);
          const a = document.createElement('a');
          a.href = pngUrl;
          a.download = `${selectedDb || 'schema'}-diagram.png`;
          a.click();
          URL.revokeObjectURL(pngUrl);
          setCopiedKey('schema_png');
          setTimeout(() => setCopiedKey(null), 2000);
        });
      };
      img.src = url;
    } catch (err) {
      console.error('Failed to export PNG:', err);
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleOpenReferencedTable = (targetTable: string, column?: string, value?: unknown) => {
    setFkPreviewTarget(null);
    setSelectedTable(targetTable);
    setSelectedRowIndex(0);
    setSelectedCell(null);
    setViewMode('grid');

    if (column && value !== undefined && value !== null && value !== '') {
      const parsedNum = typeof value === 'number' ? value : (!isNaN(Number(value)) && String(value).trim() !== '' ? Number(value) : null);
      const valToUse = parsedNum !== null ? parsedNum : value;
      setFilterCol(column);
      setFilterOp('eq');
      setFilterVal(String(value));
      setActiveFilter({ col: column, op: 'eq', val: valToUse });
    } else {
      setActiveFilter(null);
      setFilterCol('');
      setFilterVal('');
    }
  };

  const activeRow = selectedRowIndex !== null ? rows[selectedRowIndex] : null;

  // Track if user has modified anything in Row Inspector (for disabling Save when untouched)
  const hasRowChanges = useMemo(() => {
    if (isInsertModeInPanel) {
      return Object.values(rowEditValues).some((v) => v !== undefined && v !== '' && v !== null);
    }
    if (!activeRow) return false;
    return columns.some((col) => {
      const current = rowEditValues[col.name];
      const original = activeRow[col.name];
      const normCur = current === undefined ? null : current;
      const normOrig = original === undefined ? null : original;
      return normCur !== normOrig;
    });
  }, [isInsertModeInPanel, activeRow, rowEditValues, columns]);

  // Track if any changes have been made in Update Column panel
  const hasColumnChanges = useMemo(() => {
    if (!editingColumn) {
      return newColName.trim().length > 0;
    }
    const nameChanged = newColName.trim() !== editingColumn.name;
    const typeChanged = newColType !== mapSqlTypeToFormValue(editingColumn.type);
    const nullableChanged = newColNullable !== (editingColumn.nullable ?? true);
    const defaultChanged = newColDefault.trim().length > 0;
    const descriptionChanged = newColDescription.trim().length > 0;
    const arrayChanged = newColIsArray;
    const checkChanged = newColCheck.trim().length > 0;

    const existingFk = foreignKeys.find((f) => f.column === editingColumn.name);
    const fkChanged =
      (newColFkTable || '') !== (existingFk?.referenced_table || '') ||
      (newColFkColumn || '') !== (existingFk?.referenced_column || '');

    return (
      nameChanged ||
      typeChanged ||
      nullableChanged ||
      defaultChanged ||
      descriptionChanged ||
      arrayChanged ||
      checkChanged ||
      fkChanged
    );
  }, [
    editingColumn,
    newColName,
    newColType,
    newColNullable,
    newColDefault,
    newColDescription,
    newColIsArray,
    newColCheck,
    newColFkTable,
    newColFkColumn,
    foreignKeys,
  ]);

  // Track if user has modified anything in the Expanded Cell Editor
  const hasExpandedCellChanges = useMemo(() => {
    if (!expandedInlineCell) return false;
    const originalRow = rows[expandedInlineCell.rowIndex];
    if (!originalRow) return false;
    const originalVal = originalRow[expandedInlineCell.colName];
    const originalStr =
      originalVal === null || originalVal === undefined
        ? ''
        : typeof originalVal === 'object'
        ? JSON.stringify(originalVal)
        : String(originalVal);
    return expandedInlineCell.value !== originalStr;
  }, [expandedInlineCell, rows]);

  return (
    <div className="flex flex-col lg:flex-row w-full h-full min-h-0 select-none font-sans overflow-hidden bg-[#0c0c0c]">
      {/* ─── PANE 1: LEFT NAVIGATOR ─── */}
      <TableSidebar
        databases={databases}
        selectedDb={selectedDb}
        onSelectDb={(alias) => setSelectedDb(alias)}
        tables={tables}
        selectedTable={selectedTable}
        onSelectTable={(tableName) => {
          setSelectedTable(tableName);
          setSelectedRowIndex(null);
          setIsInsertModeInPanel(false);
          if (viewMode === 'sql' && !sqlQuery) {
            setSqlQuery(`SELECT * FROM ${tableName} LIMIT 25;`);
          }
        }}
        tableSearch={tableSearch}
        setTableSearch={setTableSearch}
        isTablesLoading={isTablesLoading}
        onRefreshTables={() => fetchTables(selectedDb)}
      />

      {/* ─── PANE 2: MAIN WORKSPACE CANVAS ─── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#0c0c0c]">
        {/* Workspace Top Toolbar */}
        <TableToolbar
          viewMode={viewMode}
          setViewMode={setViewMode}
          gridSubTab={gridSubTab}
          setGridSubTab={setGridSubTab}
          selectedTable={selectedTable}
          columns={columns}
          selectedCount={selectedRowIndices.size}
          onDeleteSelected={() => setIsDeleteBatchConfirmOpen(true)}
          onExportSelected={(format) => {
            const rowsToExport =
              selectedRowIndices.size > 0
                ? Array.from(selectedRowIndices).map((idx) => rows[idx]).filter(Boolean)
                : rows;
            exportTableData(format, selectedTable, rowsToExport, columns);
          }}
          onOpenInsertRow={() => {
            setSelectedRowIndex(null);
            setRowEditValues({});
            setIsInsertModeInPanel(true);
            setIsDetailsOpen(true);
          }}
          onOpenAddColumn={() => {
            setEditingColumn(null);
            setNewColName('');
            setNewColType('varchar(255)');
            setNewColNullable(true);
            setNewColDefault('');
            setNewColFkSchema('');
            setNewColFkTable('');
            setNewColFkColumn('');
            setDraftFkSchema('');
            setDraftFkTable('');
            setDraftFkColumn('');
            setDraftFkPairs([{ sourceCol: '', targetCol: '' }]);
            setDraftFkOnUpdate('NO ACTION');
            setDraftFkOnDelete('NO ACTION');
            setCreateColumnError(null);
            setIsAddColumnOpen(true);
          }}
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
          filterCol={filterCol}
          setFilterCol={setFilterCol}
          filterOp={filterOp}
          setFilterOp={setFilterOp}
          filterVal={filterVal}
          setFilterVal={setFilterVal}
          activeSort={activeSort}
          setActiveSort={setActiveSort}
          sortCol={sortCol}
          setSortCol={setSortCol}
          sortOrder={sortOrder}
          setSortOrder={setSortOrder}
          pageSize={pageSize}
          setPageSize={(sz) => {
            setPageSize(sz);
            setCursor(null);
            setCursorHistory([]);
          }}
          currentPage={cursorHistory.length + 1}
          onJumpToPage={(targetPage) => {
            const currentPageNum = cursorHistory.length + 1;
            if (targetPage === 1) {
              if (currentPageNum !== 1) {
                setCursor(null);
                setCursorHistory([]);
                loadTableData({ targetCursor: null, reloadSchema: false });
              }
              return true;
            }
            if (targetPage === currentPageNum) {
              return true;
            }
            if (targetPage < currentPageNum && targetPage >= 1) {
              const targetIndex = targetPage - 1;
              const newHistory = cursorHistory.slice(0, targetIndex);
              const targetCursor = newHistory[newHistory.length - 1] || null;
              setCursorHistory(newHistory);
              loadTableData({ targetCursor, reloadSchema: false });
              return true;
            }
            if (targetPage === currentPageNum + 1 && hasNextPage && cursor) {
              setCursorHistory([...cursorHistory, cursor]);
              loadTableData({ targetCursor: cursor, reloadSchema: false });
              return true;
            }

            // Target page does not exist (e.g. user typed 100 and table does not have this page)
            // Reset back to page 1
            if (currentPageNum !== 1) {
              setCursor(null);
              setCursorHistory([]);
              loadTableData({ targetCursor: null, reloadSchema: false });
            }
            return false;
          }}
          onPrevPage={() => {
            if (cursorHistory.length > 0) {
              const newHistory = [...cursorHistory];
              newHistory.pop();
              const prevCursor = newHistory[newHistory.length - 1] || null;
              setCursorHistory(newHistory);
              loadTableData({ targetCursor: prevCursor, reloadSchema: false });
            }
          }}
          onNextPage={() => {
            if (hasNextPage && cursor) {
              setCursorHistory([...cursorHistory, cursor]);
              loadTableData({ targetCursor: cursor, reloadSchema: false });
            }
          }}
          hasPrevPage={cursorHistory.length > 0}
          hasNextPage={hasNextPage}
          onReload={() => loadTableData({ reloadSchema: true })}
          isRowsLoading={isRowsLoading}
          isSchemaLoading={isSchemaLoading}
          onSelectSqlMode={() => {
            setViewMode('sql');
            if (!sqlQuery && selectedTable) {
              setSqlQuery(`SELECT * FROM ${selectedTable} LIMIT 25;`);
            }
          }}
          schemaSearchTerm={schemaSearchTerm}
          setSchemaSearchTerm={setSchemaSearchTerm}
          activeSchema="public"
          onCopySql={(_format) => handleCopy(fullSqlDdl, 'schema_sql')}
          onCopyMarkdown={() => handleCopy(fullMarkdownSchema, 'schema_markdown')}
          onDownloadPng={handleDownloadPng}
          onDownloadSvg={handleDownloadSvg}
          copiedKey={copiedKey}
          onAutoLayout={() => setSchemaAutoLayoutTrigger((prev) => prev + 1)}
          zoomScale={schemaTransform.scale}
          onZoomIn={() =>
            setSchemaTransform((prev) => ({
              ...prev,
              scale: Math.min(Number((prev.scale + 0.15).toFixed(3)), 2.2),
            }))
          }
          onZoomOut={() =>
            setSchemaTransform((prev) => ({
              ...prev,
              scale: Math.max(Number((prev.scale - 0.15).toFixed(3)), 0.3),
            }))
          }
          onResetZoom={() => setSchemaTransform({ x: 60, y: 60, scale: 0.95 })}
        />

        {/* Mode 1: Table Grid (Spreadsheet Editor) */}
        {viewMode === 'grid' && (
          <TableGridView
            selectedTable={selectedTable}
            columns={columns}
            foreignKeys={foreignKeys}
            columnWidths={columnWidths}
            getColWidth={getColWidth}
            rows={rows}
            isSchemaLoading={isSchemaLoading}
            isRowsLoading={isRowsLoading}
            rowsError={rowsError}
            onRetry={() => loadTableData({ reloadSchema: true })}
            selectedRowIndex={selectedRowIndex}
            selectedRowIndices={selectedRowIndices}
            onSelectRow={(idx, openPanel) => handleSelectRow(idx, openPanel)}
            onToggleRowSelect={(e, idx) => handleToggleRowSelect(e, idx)}
            onToggleAllRows={handleToggleAllRows}
            selectedCell={selectedCell}
            onSelectCell={(cell) => setSelectedCell(cell)}
            onStartCellEdit={(rowIndex, colName, cellEl) => handleStartCellEdit(rowIndex, colName, cellEl)}
            isColReadOnly={(col) => isColReadOnly(col)}
            onCellContextMenu={(e, rowIndex, colName, rawValue, isReadOnly) => {
              setGridContextMenu({
                x: e.clientX,
                y: e.clientY,
                rowIndex,
                colName,
                rawValue,
                isReadOnly,
              });
            }}
            activeColumnMenu={activeColumnMenu}
            onOpenColumnMenu={(menu) => setActiveColumnMenu(menu)}
            onResizeStart={(e, colName, width) => handleResizeStart(e, colName, width)}
            onOpenAddColumn={() => {
              setEditingColumn(null);
              setNewColName('');
              setNewColType('varchar(255)');
              setNewColNullable(true);
              setNewColDefault('');
              setNewColFkSchema('');
              setNewColFkTable('');
              setNewColFkColumn('');
              setDraftFkPairs([{ sourceCol: '', targetCol: '' }]);
              setNewColFkOnUpdate('NO ACTION');
              setNewColFkOnDelete('NO ACTION');
              setCreateColumnError(null);
              setIsAddColumnOpen(true);
            }}
            onOpenFkPicker={(target) => setFkPickerTarget(target)}
            onOpenFkPreview={(target) => setFkPreviewTarget(target)}
            viewMode={viewMode}
            setViewMode={setViewMode}
            gridSubTab={gridSubTab}
            setGridSubTab={setGridSubTab}
            onOpenInSqlEditor={(ddl: string) => {
              setSqlQuery(ddl);
              setViewMode('sql');
            }}
          />
        )}

        {/* Mode 2: Schema & ER (Connected Table Relations) */}
        {viewMode === 'schema' && (
          <SchemaView
            selectedDb={selectedDb}
            selectedTable={selectedTable}
            tables={tables}
            columns={columns}
            foreignKeys={foreignKeys}
            allDbTablesSchema={allDbTablesSchema}
            copiedKey={copiedKey}
            handleCopy={handleCopy}
            onSelectTable={(tableName) => {
              if (selectedTable === tableName) {
                setSelectedTable('');
              } else {
                setSelectedTable(tableName);
              }
              setSelectedRowIndex(null);
            }}
            searchTerm={schemaSearchTerm}
            transform={schemaTransform}
            setTransform={setSchemaTransform}
            autoLayoutTrigger={schemaAutoLayoutTrigger}
          />
        )}

        {/* Mode 3: SQL Console */}
        {viewMode === 'sql' && (
          <SqlConsoleView
            selectedDb={selectedDb}
            selectedTable={selectedTable}
            sqlQuery={sqlQuery}
            setSqlQuery={setSqlQuery}
            isExecutingSql={isExecutingSql}
            sqlResult={sqlResult}
            sqlError={sqlError}
            sqlDuration={sqlDuration}
            chunkProgress={chunkProgress}
            batchSummary={batchSummary}
            handleExecuteSql={handleExecuteSql}
            handleCancelSql={handleCancelSql}
          />
        )}
      </main>

      {/* ─── PANE 3: RIGHT OVERFLOW DRAWER PANEL (Row Inspector) ─── */}
      <RowInspectorSlideOver
        isOpen={isDetailsOpen && viewMode === 'grid'}
        onClose={() => {
          if (hasRowChanges) {
            setIsDiscardRowConfirmOpen(true);
          } else {
            setIsDetailsOpen(false);
            setIsInsertModeInPanel(false);
            setInspectorTab('details');
          }
        }}
        isInsertMode={isInsertModeInPanel}
        activeRow={activeRow}
        selectedRowIndex={selectedRowIndex}
        selectedTable={selectedTable}
        columns={columns}
        foreignKeys={foreignKeys}
        rowEditValues={rowEditValues}
        setRowEditValues={setRowEditValues}
        inspectorTab={inspectorTab}
        setInspectorTab={setInspectorTab}
        isSavingRow={isSavingRow}
        hasRowChanges={hasRowChanges}
        handleSaveRowEdit={handleSaveRowEdit}
        handleInsertRowFromPanel={handleInsertRowFromPanel}
        onRequestDeleteRow={(row) => setDeleteRowTarget(row)}
        onOpenFkPicker={(target) => setFkPickerTarget(target)}
        isColReadOnly={(col) => isColReadOnly(col)}
      />

      {/* ─── Discard Row Changes Confirm Dialog ─── */}
      <ConfirmDialog
        isOpen={isDiscardRowConfirmOpen}
        title={isInsertModeInPanel ? "Discard New Row?" : "Discard Changes?"}
        description={
          isInsertModeInPanel
            ? "You have unsaved values for this new record. If you leave now, the row will not be created."
            : "You have unsaved edits in this row. Are you sure you want to discard your changes?"
        }
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        variant="warning"
        onConfirm={() => {
          setIsDiscardRowConfirmOpen(false);
          setIsDetailsOpen(false);
          setIsInsertModeInPanel(false);
          setInspectorTab('details');
          if (activeRow) {
            setRowEditValues({ ...activeRow });
          } else {
            setRowEditValues({});
          }
        }}
        onClose={() => setIsDiscardRowConfirmOpen(false)}
      />

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

      {/* ─── Delete Selected Rows (Batch Delete) Confirm Dialog ─── */}
      <ConfirmDialog
        isOpen={isDeleteBatchConfirmOpen}
        title={`Delete ${selectedRowIndices.size} Selected Row${selectedRowIndices.size > 1 ? 's' : ''}`}
        description={`Are you sure you want to permanently delete ${selectedRowIndices.size} selected row${selectedRowIndices.size > 1 ? 's' : ''}? This action cannot be reversed.`}
        confirmLabel={isBatchDeleting ? "Deleting..." : "Delete Selected"}
        variant="danger"
        onConfirm={handleDeleteSelectedRows}
        onClose={() => setIsDeleteBatchConfirmOpen(false)}
      />

      {/* ─── Inline Cell Popover Editor ─── */}
      {editingCell && (() => {
        const normType = editingCell.column?.type?.toLowerCase() || '';
        const isBool = normType.includes('bool') || normType === 'bit' || typeof editingCell.initialValue === 'boolean';
        const isDate = normType === 'date';
        const isTimeOrTimestamp = normType.includes('time') || normType.includes('timestamp');
        const isDateTime = isDate || isTimeOrTimestamp;
        const isJson = normType.includes('json');
        const isNumeric =
          normType.includes('int') ||
          normType.includes('float') ||
          normType.includes('double') ||
          normType.includes('decimal') ||
          normType.includes('numeric') ||
          normType.includes('real') ||
          normType.includes('serial') ||
          typeof editingCell.initialValue === 'number';

        if (isBool) {
          return (
            <InlineBooleanPopover
              editingCell={editingCell}
              onSave={handleCommitCellEdit}
              onCancel={() => setEditingCell(null)}
            />
          );
        }

        if (isNumeric) {
          return (
            <InlineNumberPopover
              editingCell={editingCell}
              onChange={(val) =>
                setEditingCell((prev) => (prev ? { ...prev, currentValue: val } : null))
              }
              onSave={handleCommitCellEdit}
              onCancel={() => setEditingCell(null)}
              onExpand={() => {
                const current = editingCell;
                setEditingCell(null);
                setExpandedInlineCell({
                  rowIndex: current.rowIndex,
                  colName: current.colName,
                  value: current.currentValue,
                });
              }}
            />
          );
        }

        if (isJson) {
          return (
            <InlineJsonPopover
              editingCell={editingCell}
              onChange={(val) =>
                setEditingCell((prev) => (prev ? { ...prev, currentValue: val } : null))
              }
              onSave={handleCommitCellEdit}
              onCancel={() => setEditingCell(null)}
              onExpand={() => {
                const current = editingCell;
                setEditingCell(null);
                setExpandedInlineCell({
                  rowIndex: current.rowIndex,
                  colName: current.colName,
                  value: current.currentValue,
                });
              }}
            />
          );
        }

        if (isDateTime) {
          return (
            <InlineDateTimePickerPopover
              editingCell={editingCell}
              onChange={(val) =>
                setEditingCell((prev) => (prev ? { ...prev, currentValue: val } : null))
              }
              onSave={handleCommitCellEdit}
              onCancel={() => setEditingCell(null)}
              onExpand={() => {
                const current = editingCell;
                setEditingCell(null);
                setExpandedInlineCell({
                  rowIndex: current.rowIndex,
                  colName: current.colName,
                  value: current.currentValue,
                });
              }}
            />
          );
        }

        return (
          <InlineTextPopover
            editingCell={editingCell}
            onChange={(val) =>
              setEditingCell((prev) => (prev ? { ...prev, currentValue: val } : null))
            }
            onSave={handleCommitCellEdit}
            onCancel={() => setEditingCell(null)}
            onExpand={() => {
              const current = editingCell;
              setEditingCell(null);
              setExpandedInlineCell({
                rowIndex: current.rowIndex,
                colName: current.colName,
                value: current.currentValue,
              });
            }}
          />
        );
      })()}

      {/* ─── Expanded Inline Cell SlideOver Panel ─── */}
      <SlideOver
        isOpen={!!expandedInlineCell}
        onClose={() => {
          if (hasExpandedCellChanges) {
            setIsDiscardExpandedCellConfirmOpen(true);
          } else {
            setExpandedInlineCell(null);
          }
        }}
        width="w-[520px] max-w-full"
        title={expandedInlineCell?.colName || 'Field'}
        subtitle="Edit field value"
      >
        <div className="flex-1 flex flex-col min-h-0 bg-[#0e0e0e] overflow-hidden font-sans">
          <div className="flex-1 p-4 sm:p-5 flex flex-col min-h-0 space-y-2 overflow-hidden">
            <div className="flex items-center justify-between">
              <label className="text-[13.5px] font-medium text-white font-sans">
                Value
              </label>
              <span className="text-[12px] font-sans text-[#777777]">
                {(expandedInlineCell?.value || '').length} chars · {(expandedInlineCell?.value || '').split('\n').length} lines
              </span>
            </div>
            <textarea
              value={expandedInlineCell?.value || ''}
              onChange={(e) =>
                setExpandedInlineCell((prev) =>
                  prev ? { ...prev, value: e.target.value } : null
                )
              }
              autoFocus
              spellCheck={false}
              className="flex-1 w-full rounded-[6px] border border-[#262626] bg-[#121212] p-3 text-[14px] leading-relaxed text-white font-sans focus:outline-none focus:border-[#383838] focus:ring-1 focus:ring-[#383838] resize-none placeholder-[#555555] transition-colors whitespace-pre"
              placeholder="Enter value..."
            />
          </div>

          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans shrink-0">
            <button
              type="button"
              onClick={() => {
                if (hasExpandedCellChanges) {
                  setIsDiscardExpandedCellConfirmOpen(true);
                } else {
                  setExpandedInlineCell(null);
                }
              }}
              className="inline-flex items-center justify-center h-9 px-4 rounded-[6px] text-[13.5px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!expandedInlineCell) return;
                const { rowIndex, colName, value } = expandedInlineCell;
                setExpandedInlineCell(null);
                await handleSaveCellEdit(rowIndex, colName, value);
              }}
              className="flex items-center justify-center h-9 px-4 rounded-[6px] font-medium text-white bg-[#1a1a1a] hover:bg-[#252525] border border-[#2e2e2e] hover:border-[#404040] transition-colors cursor-pointer text-[13.5px] font-sans shadow-xs"
            >
              Apply
            </button>
          </div>
        </div>
      </SlideOver>

      {/* ─── Discard Expanded Cell Confirm Dialog ─── */}
      <ConfirmDialog
        isOpen={isDiscardExpandedCellConfirmOpen}
        title="Discard Cell Edits?"
        description={`You have unsaved changes in "${expandedInlineCell?.colName || 'field'}". Are you sure you want to discard your edits?`}
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        variant="warning"
        onConfirm={() => {
          setIsDiscardExpandedCellConfirmOpen(false);
          setExpandedInlineCell(null);
        }}
        onClose={() => setIsDiscardExpandedCellConfirmOpen(false)}
      />

      {/* ─── Add / Update Column SlideOver ─── */}
      <ColumnSlideOver
        isOpen={isAddColumnOpen}
        onClose={() => {
          if (hasColumnChanges) {
            setIsDiscardColumnConfirmOpen(true);
          } else {
            setIsAddColumnOpen(false);
            setEditingColumn(null);
            resetColumnForm();
          }
        }}
        editingColumn={editingColumn}
        selectedTable={selectedTable}
        tables={tables}
        schemaCache={schemaCacheRef.current}
        createColumnError={createColumnError}
        newColName={newColName}
        setNewColName={setNewColName}
        newColType={newColType}
        setNewColType={setNewColType}
        newColIsArray={newColIsArray}
        setNewColIsArray={setNewColIsArray}
        newColDescription={newColDescription}
        setNewColDescription={setNewColDescription}
        newColDefault={newColDefault}
        setNewColDefault={setNewColDefault}
        newColNullable={newColNullable}
        setNewColNullable={setNewColNullable}
        newColIsUnique={newColIsUnique}
        setNewColIsUnique={setNewColIsUnique}
        newColIsPk={newColIsPk}
        setNewColIsPk={setNewColIsPk}
        newColCheck={newColCheck}
        setNewColCheck={setNewColCheck}
        newColFkSchema={newColFkSchema}
        setNewColFkSchema={setNewColFkSchema}
        newColFkTable={newColFkTable}
        setNewColFkTable={setNewColFkTable}
        newColFkColumn={newColFkColumn}
        setNewColFkColumn={setNewColFkColumn}
        newColFkOnUpdate={newColFkOnUpdate}
        setNewColFkOnUpdate={setNewColFkOnUpdate}
        newColFkOnDelete={newColFkOnDelete}
        setNewColFkOnDelete={setNewColFkOnDelete}
        isFkModalOpen={isFkModalOpen}
        setIsFkModalOpen={setIsFkModalOpen}
        draftFkSchema={draftFkSchema}
        setDraftFkSchema={setDraftFkSchema}
        draftFkTable={draftFkTable}
        setDraftFkTable={setDraftFkTable}
        draftFkColumn={draftFkColumn}
        setDraftFkColumn={setDraftFkColumn}
        draftFkPairs={draftFkPairs}
        setDraftFkPairs={setDraftFkPairs}
        draftFkOnUpdate={draftFkOnUpdate}
        setDraftFkOnUpdate={setDraftFkOnUpdate}
        draftFkOnDelete={draftFkOnDelete}
        setDraftFkOnDelete={setDraftFkOnDelete}
        isDiscardFkConfirmOpen={isDiscardFkConfirmOpen}
        setIsDiscardFkConfirmOpen={setIsDiscardFkConfirmOpen}
        handleRequestCloseFkModal={handleRequestCloseFkModal}
        handleSelectFkTargetTable={handleSelectFkTargetTable}
        isCreatingColumn={isCreatingColumn}
        hasColumnChanges={hasColumnChanges}
        handleSaveColumn={handleSaveColumn}
      />

      {/* ─── Discard Column Changes Confirm Dialog ─── */}
      <ConfirmDialog
        isOpen={isDiscardColumnConfirmOpen}
        title={editingColumn ? "Discard Column Changes?" : "Discard New Column?"}
        description={
          editingColumn
            ? `You have unsaved changes for column "${editingColumn.name}". If you discard, these changes will not be applied.`
            : "You have entered values for a new column. If you discard, the column will not be created."
        }
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        variant="warning"
        onConfirm={() => {
          setIsDiscardColumnConfirmOpen(false);
          setIsAddColumnOpen(false);
          setEditingColumn(null);
          resetColumnForm();
        }}
        onClose={() => setIsDiscardColumnConfirmOpen(false)}
      />

      {/* ─── Foreign Key Reference Record Picker Modal ─── */}
      {fkPickerTarget && selectedDb && (
        <ForeignKeyPickerModal
          db={selectedDb}
          fk={fkPickerTarget.fk}
          currentValue={fkPickerTarget.currentValue}
          onSelect={handleSelectFkRecord}
          onClose={() => setFkPickerTarget(null)}
        />
      )}

      {/* ─── Foreign Key Record Preview Popover ─── */}
      {fkPreviewTarget && selectedDb && (
        <ForeignKeyRecordPreviewPopover
          db={selectedDb}
          fk={fkPreviewTarget.fk}
          currentValue={fkPreviewTarget.currentValue}
          anchorRect={fkPreviewTarget.rect}
          onClose={() => setFkPreviewTarget(null)}
          onOpenTable={handleOpenReferencedTable}
        />
      )}

      {/* ─── Column Header Action Dropdown Menu ─── */}
      {activeColumnMenu && (
        <ColumnContextMenu
          activeColumnMenu={activeColumnMenu}
          activeSort={activeSort}
          foreignKeys={foreignKeys}
          copiedKey={copiedKey}
          selectedDb={selectedDb}
          selectedTable={selectedTable}
          onClose={() => setActiveColumnMenu(null)}
          onSetSort={(sort) => setActiveSort(sort)}
          onCopyName={(name) => {
            navigator.clipboard.writeText(name);
            setCopiedKey(name);
            setTimeout(() => setCopiedKey(null), 2000);
          }}
          onOpenEditColumn={(col) => {
            setEditingColumn(col);
            setNewColName(col.name);
            setNewColType(mapSqlTypeToFormValue(col.type));
            setNewColNullable(col.nullable ?? true);
            setNewColDefault('');
            setNewColIsPk(!!col.primary_key);
            setNewColIsUnique(false);
            const fk = foreignKeys.find((f) => f.column === col.name);
            if (fk) {
              setNewColFkTable(fk.referenced_table);
              setNewColFkColumn(fk.referenced_column);
            } else {
              setNewColFkTable('');
              setNewColFkColumn('');
            }
            setCreateColumnError(null);
            setIsAddColumnOpen(true);
          }}
          onResetWidth={(colName) => {
            setColumnWidths((prev) => {
              const next = { ...prev };
              delete next[colName];
              if (selectedDb && selectedTable) {
                try {
                  localStorage.setItem('axiom:col_widths:' + selectedDb + ':' + selectedTable, JSON.stringify(next));
                } catch {}
              }
              return next;
            });
          }}
          onRequestDeleteColumn={(col) => setDeleteColumnTarget(col)}
        />
      )}

      {/* ─── Row & Cell Context Menu ─── */}
      {gridContextMenu && (
        <GridContextMenu
          menu={gridContextMenu}
          rowRecord={rows[gridContextMenu.rowIndex]}
          onClose={() => setGridContextMenu(null)}
          onEditCell={(rowIndex, colName) => {
            const cellEl = document.querySelector(
              `[data-cell-row="${rowIndex}"][data-cell-col="${colName}"]`
            ) as HTMLElement;
            if (cellEl) {
              handleStartCellEdit(rowIndex, colName, cellEl);
            }
          }}
          onOpenRowDetails={(rowIndex) => {
            handleSelectRow(rowIndex, true);
          }}
          onSetCellNull={(rowIndex, colName) => {
            handleSaveCellEdit(rowIndex, colName, null);
          }}
          onDeleteRow={(rowIndex) => {
            const targetRow = rows[rowIndex];
            if (targetRow) {
              setDeleteRowTarget(targetRow);
            }
          }}
        />
      )}

      {/* ─── Delete Column Confirm Dialog ─── */}
      <ConfirmDialog
        isOpen={!!deleteColumnTarget}
        title={`Delete column "${deleteColumnTarget?.name}"?`}
        description={`Are you sure you want to delete the column "${deleteColumnTarget?.name}" from table "${selectedTable}"? All data in this column will be permanently deleted. This action cannot be undone.`}
        confirmLabel={isDeletingColumn ? 'Deleting...' : 'Delete column'}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDeleteColumn}
        onClose={() => setDeleteColumnTarget(null)}
      />
    </div>
  );
}
