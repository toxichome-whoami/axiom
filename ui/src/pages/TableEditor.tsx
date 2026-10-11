/*
 * Supabase Studio and Neon inspired multi-pane Table Editor, Schema Visualizer, and SQL Console.
 * Owned by: ui/pages
 * Key deps: lucide-react, ../api/client, ../types, ../components/ui/ConfirmDialog
 * Invariants: Single source of truth for active database and table; lock-free editing via right panel inspector; zero slop.
 * Architecture: Decomposed into modular domain hooks and view components matching ui/pages/storage pattern.
 */

import React, { useState, useMemo, useRef } from 'react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SlideOver } from '../components/ui/SlideOver';
import { ColumnInfoApi } from '../types';
import {
  mapSqlTypeToFormValue,
} from './table/format';
import {
  InlineCellEditorPopover,
  InlineBooleanPopover,
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

// Domain Custom Hooks
import { useTableData } from './table/useTableData';
import { useColumnResizer } from './table/useColumnResizer';
import { useCellEditor } from './table/useCellEditor';
import { useColumnOperations } from './table/useColumnOperations';
import { useRowOperations } from './table/useRowOperations';
import { useSqlConsole } from './table/useSqlConsole';

export function TableEditor() {
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'schema' | 'sql'>('grid');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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
    handleSelectRow,
    handleToggleRowSelect,
    handleToggleAllRows,
    handleSaveRowEdit,
    handleInsertRowFromPanel,
    handleDeleteRow,
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
    handleExecuteSql,
  } = useSqlConsole({ selectedDb });

  // Column header dropdown menu state
  const [activeColumnMenu, setActiveColumnMenu] = useState<{
    col: ColumnInfoApi;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleOpenReferencedTable = (targetTable: string) => {
    setFkPreviewTarget(null);
    setSelectedTable(targetTable);
    setSelectedRowIndex(null);
    setSelectedCell(null);
    setViewMode('grid');
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
          selectedTable={selectedTable}
          columns={columns}
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
              setSelectedTable(tableName);
              setSelectedRowIndex(null);
              setIsDetailsOpen(true);
            }}
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
            handleExecuteSql={handleExecuteSql}
          />
        )}
      </main>

      {/* ─── PANE 3: RIGHT OVERFLOW DRAWER PANEL (Row Inspector) ─── */}
      <RowInspectorSlideOver
        isOpen={isDetailsOpen}
        onClose={() => {
          setIsDetailsOpen(false);
          setIsInsertModeInPanel(false);
          setInspectorTab('details');
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

      {/* ─── Inline Cell Popover Editor ─── */}
      {editingCell && (() => {
        const normType = editingCell.column?.type?.toLowerCase() || '';
        const isBool = normType.includes('bool') || normType === 'bit' || typeof editingCell.initialValue === 'boolean';
        const isDate = normType === 'date';
        const isTimeOrTimestamp = normType.includes('time') || normType.includes('timestamp');
        const isDateTime = isDate || isTimeOrTimestamp;

        if (isBool) {
          return (
            <InlineBooleanPopover
              editingCell={editingCell}
              onSave={handleCommitCellEdit}
              onCancel={() => setEditingCell(null)}
            />
          );
        }

        if (isDateTime) {
          return (
            <InlineDateTimePickerPopover
              editingCell={editingCell}
              onSave={handleCommitCellEdit}
              onCancel={() => setEditingCell(null)}
            />
          );
        }

        return (
          <InlineCellEditorPopover
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
        onClose={() => setExpandedInlineCell(null)}
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
              <span className="text-[12px] font-mono text-[#777777]">
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
              className="flex-1 w-full rounded-[6px] border border-[#262626] bg-[#121212] p-3 text-[14px] leading-relaxed text-white font-sans focus:outline-none focus:border-[#3b82f6] resize-none placeholder-[#555555] transition-colors whitespace-pre"
              placeholder="Enter value..."
            />
          </div>

          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans shrink-0">
            <button
              type="button"
              onClick={() => setExpandedInlineCell(null)}
              className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
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
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative flex items-center text-[14px] font-sans">
                Apply
              </span>
            </button>
          </div>
        </div>
      </SlideOver>

      {/* ─── Add / Update Column SlideOver ─── */}
      <ColumnSlideOver
        isOpen={isAddColumnOpen}
        onClose={() => {
          setIsAddColumnOpen(false);
          setEditingColumn(null);
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
