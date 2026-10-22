/*
 * Table Spreadsheet Grid & Rows View subcomponent.
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../types, ./format, ./TableSkeleton
 */

import React from 'react';
import {
  AlertCircle,
  Check,
  Minus,
  Key,
  Link2,
  ChevronDown,
  Plus,
  Maximize2,
  ArrowRight,
  Table as TableIcon,
} from 'lucide-react';
import { ColumnInfoApi, ForeignKeyInfoApi } from '../../types';
import { getColumnTypeBadge, formatColumnType } from './format';
import { TableSkeleton } from './TableSkeleton';

export interface TableGridViewProps {
  selectedTable: string;
  columns: ColumnInfoApi[];
  foreignKeys: ForeignKeyInfoApi[];
  columnWidths?: Record<string, number>;
  getColWidth: (colName: string, type: string) => number;
  rows: Record<string, unknown>[];
  isSchemaLoading: boolean;
  isRowsLoading: boolean;
  rowsError: string | null;
  onRetry: () => void;

  // Row selection
  selectedRowIndex: number | null;
  selectedRowIndices: Set<number>;
  onSelectRow: (idx: number, openPanel: boolean) => void;
  onToggleRowSelect: (e: React.MouseEvent, idx: number) => void;
  onToggleAllRows: (e?: any) => void;

  // Cell selection & inline edit
  selectedCell: { rowIndex: number; colName: string } | null;
  onSelectCell: (cell: { rowIndex: number; colName: string }) => void;
  onStartCellEdit: (rowIndex: number, colName: string, cellEl: HTMLTableCellElement) => void;
  isColReadOnly: (col: ColumnInfoApi) => boolean;
  onCellContextMenu?: (e: React.MouseEvent, rowIndex: number, colName?: string, rawValue?: unknown, isReadOnly?: boolean) => void;

  // Column headers & resizing
  activeColumnMenu: { col: ColumnInfoApi; rect: { top: number; left: number; width: number; height: number } } | null;
  onOpenColumnMenu: (menu: { col: ColumnInfoApi; rect: { top: number; left: number; width: number; height: number } } | null) => void;
  onResizeStart: (e: React.MouseEvent, colName: string, startWidth: number) => void;
  onOpenAddColumn: () => void;

  // Foreign key triggers
  onOpenFkPicker: (target: {
    rowIndex: number;
    column: string;
    fk: ForeignKeyInfoApi;
    currentValue: unknown;
  }) => void;
  onOpenFkPreview: (target: {
    fk: ForeignKeyInfoApi;
    currentValue: unknown;
    rect: { top: number; left: number; width: number; height: number };
  }) => void;

  // View mode switcher
  viewMode?: 'grid' | 'schema' | 'sql';
  setViewMode?: (mode: 'grid' | 'schema' | 'sql') => void;
  onSelectSqlMode?: () => void;
  gridSubTab?: 'data' | 'definition';
  setGridSubTab?: (tab: 'data' | 'definition') => void;
  onOpenInSqlEditor?: (ddl: string) => void;
}

export function TableGridView({
  selectedTable,
  columns,
  foreignKeys,
  columnWidths,
  getColWidth,
  rows,
  isSchemaLoading,
  isRowsLoading,
  rowsError,
  onRetry,
  selectedRowIndex,
  selectedRowIndices,
  onSelectRow,
  onToggleRowSelect,
  onToggleAllRows,
  selectedCell,
  onSelectCell,
  onStartCellEdit,
  isColReadOnly,
  onCellContextMenu,
  activeColumnMenu,
  onOpenColumnMenu,
  onResizeStart,
  onOpenAddColumn,
  onOpenFkPicker,
  onOpenFkPreview,
  onOpenInSqlEditor,
  gridSubTab: externalTab,
  setGridSubTab: setExternalTab,
}: TableGridViewProps) {
  const [internalTab, setInternalTab] = React.useState<'data' | 'definition'>('data');
  const activeTab = externalTab ?? internalTab;
  const setActiveTab = setExternalTab ?? setInternalTab;

  // Generate realistic formatted SQL DDL for Definition tab
  const { ddl, lines } = React.useMemo(() => {
    const tableName = selectedTable || 'table_name';
    const linesList: { tokens: { text: string; color: string }[] }[] = [];

    // Line 1: create table public.<tableName> (
    linesList.push({
      tokens: [
        { text: 'create table ', color: 'text-blue-400' },
        { text: `public.${tableName}`, color: 'text-white' },
        { text: ' (', color: 'text-[#888888]' },
      ],
    });

    const primaryKeys = columns.filter((c) => c.primary_key);

    columns.forEach((col, idx) => {
      const isLastCol = idx === columns.length - 1 && primaryKeys.length === 0 && foreignKeys.length === 0;
      const tokens: { text: string; color: string }[] = [
        { text: '  ' + col.name + ' ', color: 'text-white' },
      ];

      const lowerType = (col.type || 'text').toLowerCase();
      tokens.push({ text: lowerType, color: 'text-[#a371f7]' });

      if (col.default_value) {
        tokens.push({ text: ' default ', color: 'text-blue-400' });
        tokens.push({ text: col.default_value, color: 'text-amber-300' });
      }

      if (!col.nullable) {
        tokens.push({ text: ' not null', color: 'text-blue-400' });
      } else {
        tokens.push({ text: ' null', color: 'text-[#888888]' });
      }

      tokens.push({ text: isLastCol ? '' : ',', color: 'text-[#888888]' });
      linesList.push({ tokens });
    });

    if (primaryKeys.length > 0) {
      const pkNames = primaryKeys.map((p) => p.name).join(', ');
      const hasMoreConstraints = foreignKeys.length > 0;
      linesList.push({
        tokens: [
          { text: '  constraint ', color: 'text-blue-400' },
          { text: `${tableName}_pkey `, color: 'text-white' },
          { text: 'primary key ', color: 'text-blue-400' },
          { text: `(${pkNames})`, color: 'text-[#888888]' },
          { text: hasMoreConstraints ? ',' : '', color: 'text-[#888888]' },
        ],
      });
    }

    foreignKeys.forEach((fk, idx) => {
      const isLast = idx === foreignKeys.length - 1;
      linesList.push({
        tokens: [
          { text: '  constraint ', color: 'text-blue-400' },
          { text: `${tableName}_${fk.column}_fkey `, color: 'text-white' },
          { text: 'foreign key ', color: 'text-blue-400' },
          { text: `(${fk.column}) `, color: 'text-[#888888]' },
          { text: 'references ', color: 'text-blue-400' },
          { text: `${fk.referenced_table} (${fk.referenced_column})`, color: 'text-white' },
          { text: ' on delete set null', color: 'text-[#888888]' },
          { text: isLast ? '' : ',', color: 'text-[#888888]' },
        ],
      });
    });

    linesList.push({
      tokens: [
        { text: ') ', color: 'text-[#888888]' },
        { text: 'TABLESPACE ', color: 'text-blue-400' },
        { text: 'pg_default;', color: 'text-[#888888]' },
      ],
    });

    const rawDdl = linesList
      .map((line) => line.tokens.map((t) => t.text).join(''))
      .join('\n');

    return { ddl: rawDdl, lines: linesList };
  }, [selectedTable, columns, foreignKeys]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative font-sans">
      {/* Tab 1: Data View (Spreadsheet Grid) */}
      {activeTab === 'data' && (
        <div className="flex-1 overflow-auto">
          {isSchemaLoading || (isRowsLoading && rows.length === 0 && !rowsError) ? (
            <TableSkeleton columns={columns} foreignKeys={foreignKeys} columnWidths={columnWidths} />
          ) : !selectedTable ? (
            <div className="p-16 flex flex-col items-center justify-center text-center font-sans gap-2.5">
              <TableIcon className="w-8 h-8 text-[#444444]" />
              <p className="text-[14px] font-medium text-white">No table selected</p>
              <p className="text-[12.5px] text-[#888888] max-w-sm">
                Select a table from the sidebar or run a query in the SQL editor to begin inspecting data.
              </p>
            </div>
          ) : rowsError ? (
            <div className="p-8 flex flex-col items-center justify-center text-center font-sans">
              <AlertCircle className="w-8 h-8 text-rose-500 mb-2" />
              <p className="text-[14px] font-medium text-white mb-1">Failed to query table</p>
              <p className="text-[12.5px] text-[#8c8c8c] max-w-md font-sans">{rowsError}</p>
              <button
                onClick={onRetry}
                className="mt-4 px-3 py-1.5 bg-[#141414] border border-[#262626] rounded-[6px] text-[12px] text-white hover:border-[#383838] transition-colors font-sans cursor-pointer"
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
                    {/* Checkbox: Select All */}
                    <button
                      type="button"
                      onClick={onToggleAllRows}
                      title={selectedRowIndices.size === rows.length && rows.length > 0 ? 'Deselect all' : 'Select all'}
                      aria-label={selectedRowIndices.size === rows.length && rows.length > 0 ? 'Deselect all rows' : 'Select all rows'}
                      aria-checked={selectedRowIndices.size === rows.length && rows.length > 0 ? 'true' : selectedRowIndices.size > 0 ? 'mixed' : 'false'}
                      className={`peer h-4 w-4 shrink-0 rounded-[4px] border border-[#383838] shadow-xs transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 cursor-pointer flex items-center justify-center ${
                        selectedRowIndices.size === rows.length && rows.length > 0
                          ? 'bg-white border-white text-black'
                          : selectedRowIndices.size > 0
                          ? 'bg-white border-white text-black'
                          : 'bg-transparent hover:border-[#666666] hover:bg-white/[0.04]'
                      }`}
                    >
                      {selectedRowIndices.size === rows.length && rows.length > 0 ? (
                        <Check className="h-3 w-3 stroke-[3]" />
                      ) : selectedRowIndices.size > 0 ? (
                        <Minus className="h-3 w-3 stroke-[3]" />
                      ) : null}
                    </button>
                  </div>
                </th>

                {/* Dynamic Columns with Type-Aware Widths, Interactive Resizers, and Action Menu */}
                {columns.map((col) => {
                  const isFk = foreignKeys.some((fk) => fk.column === col.name);
                  const badge = getColumnTypeBadge(col.type, col.primary_key, isFk);
                  const width = getColWidth(col.name, col.type);
                  const isMenuOpen = activeColumnMenu?.col.name === col.name;

                  return (
                    <th
                      key={col.name}
                      className="relative px-3 py-2 text-[14px] font-medium text-[#cccccc] whitespace-nowrap border-r border-[#1a1a1a] select-none group/colheader"
                      style={{ width: `${width}px`, minWidth: `${Math.max(80, width)}px`, maxWidth: `${width}px` }}
                    >
                      <div className="flex items-center justify-between w-full h-full min-w-0 pr-1 overflow-hidden whitespace-nowrap">
                        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap truncate">
                          <span className="font-sans text-white text-[14px] font-semibold whitespace-nowrap shrink-0" title={col.name}>
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

                        {/* Column Action Dropdown Trigger */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isMenuOpen) {
                              onOpenColumnMenu(null);
                            } else {
                              const r = e.currentTarget.getBoundingClientRect();
                              onOpenColumnMenu({
                                col,
                                rect: { top: r.top, left: r.left, width: r.width, height: r.height } as DOMRect,
                              });
                            }
                          }}
                          title={`${col.name} options`}
                          className={`w-5 h-5 ml-1 rounded-[4px] flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                            isMenuOpen
                              ? 'bg-[#222222] text-white opacity-100'
                              : 'text-[#666666] hover:text-white hover:bg-[#1a1a1a] opacity-0 group-hover/colheader:opacity-100 focus:opacity-100'
                          }`}
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Interactive Column Resize Handle (Centered over column border) */}
                      <div
                        onMouseDown={(e) => onResizeStart(e, col.name, width)}
                        title="Drag to resize column"
                        className="absolute -right-1.5 top-0 bottom-0 w-3 cursor-col-resize group/resizer flex items-center justify-center select-none z-20 hover:bg-blue-500/10 active:bg-blue-500/25"
                      >
                        <div className="w-[2px] h-full bg-transparent group-hover/resizer:bg-blue-500 group-active/resizer:bg-blue-500 transition-colors" />
                      </div>
                    </th>
                  );
                })}

                {/* Add Column Button Column */}
                <th
                  className="w-12 px-2 py-2 text-center bg-[#0a0a0a] border-r border-[#1a1a1a] select-none"
                  style={{ width: '48px', minWidth: '48px', maxWidth: '48px' }}
                >
                  <button
                    type="button"
                    onClick={onOpenAddColumn}
                    title="Add new column"
                    className="w-7 h-7 mx-auto rounded-[5px] bg-[#141414] hover:bg-[#202020] border border-[#262626] hover:border-[#383838] text-[#8c8c8c] hover:text-white flex items-center justify-center transition-colors cursor-pointer group"
                  >
                    <Plus className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                  </button>
                </th>
              </tr>
            </thead>

            <tbody className={`divide-y divide-[#181818] ${isRowsLoading ? 'opacity-60 transition-opacity' : ''}`}>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 2} className="p-12 text-center text-[#666666] text-[14px]">
                    Table contains 0 rows
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const isSelected = selectedRowIndex === idx;
                  return (
                    <tr
                      key={idx}
                      onClick={() => onSelectRow(idx, false)}
                      onContextMenu={(e) => {
                        if (onCellContextMenu) {
                          e.preventDefault();
                          onSelectRow(idx, false);
                          onCellContextMenu(e, idx);
                        }
                      }}
                      className={`transition-colors cursor-pointer group ${
                        isSelected
                          ? 'bg-[#121212] ring-1 ring-inset ring-[#222222] text-white'
                          : 'hover:bg-[#121212]'
                      }`}
                    >
                      {/* Row Checkbox & Expand Button */}
                      <td
                        className={`px-3 py-2 text-left select-none sticky left-0 z-10 border-r border-[#1a1a1a] ${
                          isSelected ? 'bg-[#121212]' : 'bg-[#0a0a0a] group-hover:bg-[#121212]'
                        }`}
                        style={{ width: '64px', minWidth: '64px', maxWidth: '64px' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-start gap-1.5">
                          {/* Checkbox: Single Row */}
                          <button
                            type="button"
                            onClick={(e) => onToggleRowSelect(e, idx)}
                            title={selectedRowIndices.has(idx) ? 'Deselect row' : 'Select row'}
                            aria-label={selectedRowIndices.has(idx) ? `Deselect row ${idx + 1}` : `Select row ${idx + 1}`}
                            aria-checked={selectedRowIndices.has(idx) ? 'true' : 'false'}
                            className={`peer h-4 w-4 shrink-0 rounded-[4px] border border-[#383838] shadow-xs transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 cursor-pointer flex items-center justify-center ${
                              selectedRowIndices.has(idx)
                                ? 'bg-white border-white text-black'
                                : 'bg-transparent hover:border-[#666666] hover:bg-white/[0.04]'
                            }`}
                          >
                            {selectedRowIndices.has(idx) && (
                              <Check className="h-3 w-3 stroke-[3]" />
                            )}
                          </button>

                          {/* Expand Row Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectRow(idx, true);
                            }}
                            title="Edit row details"
                            className={`w-4 h-4 rounded-[4px] flex items-center justify-center text-[#666666] hover:text-white hover:bg-[#1c1c1c] transition-all cursor-pointer ${
                              selectedRowIndex === idx
                                ? 'opacity-100'
                                : 'opacity-70 sm:opacity-0 sm:group-hover:opacity-100'
                            }`}
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
                        const isCellSelected = selectedCell?.rowIndex === idx && selectedCell?.colName === col.name;
                        const isReadOnly = isColReadOnly(col);
                        const fk = foreignKeys.find((f) => f.column === col.name);

                        return (
                          <td
                            key={col.name}
                            data-cell-row={idx}
                            data-cell-col={col.name}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell({ rowIndex: idx, colName: col.name });
                              onSelectRow(idx, false);
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              onSelectCell({ rowIndex: idx, colName: col.name });
                              onSelectRow(idx, false);
                              if (fk) {
                                onOpenFkPicker({
                                  rowIndex: idx,
                                  column: col.name,
                                  fk,
                                  currentValue: val,
                                });
                              } else if (!isReadOnly) {
                                onStartCellEdit(idx, col.name, e.currentTarget);
                              }
                            }}
                            onContextMenu={(e) => {
                              if (onCellContextMenu) {
                                e.preventDefault();
                                e.stopPropagation();
                                onSelectCell({ rowIndex: idx, colName: col.name });
                                onSelectRow(idx, false);
                                onCellContextMenu(e, idx, col.name, val, isReadOnly);
                              }
                            }}
                            className={`px-3 py-2 text-[#cccccc] text-[14px] whitespace-nowrap overflow-hidden border-r border-[#151515] relative transition-colors select-none ${
                              isReadOnly ? 'cursor-default' : 'cursor-cell'
                            } ${
                              isCellSelected
                                ? 'shadow-[inset_0_0_0_1.5px_#22d3ee] bg-cyan-950/20 text-white z-10'
                                : ''
                            }`}
                            style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
                            title={isReadOnly ? `${col.name} (Read-only / cannot be edited): ${strVal}` : strVal}
                          >
                            {fk ? (
                              <div className="flex items-center justify-between w-full h-5 gap-1.5 leading-none">
                                <div className="truncate flex-1 min-w-0 font-sans text-[13.5px]">
                                  {isNull ? (
                                    <span className="text-[#555555] italic text-[13px]">null</span>
                                  ) : isBool ? (
                                    <span className="text-[#cccccc]">
                                      {String(val)}
                                    </span>
                                  ) : isObj ? (
                                    <span className="text-[#cccccc]">
                                      {JSON.stringify(val)}
                                    </span>
                                  ) : (
                                    <span>{strVal}</span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const btnRect = e.currentTarget.getBoundingClientRect();
                                    onOpenFkPreview({
                                      fk,
                                      currentValue: val,
                                      rect: {
                                        top: btnRect.top,
                                        left: btnRect.left,
                                        width: btnRect.width,
                                        height: btnRect.height,
                                      },
                                    });
                                  }}
                                  title={`View referenced record from ${fk.referenced_table}`}
                                  className="w-5 h-5 rounded-[4px] bg-[#181818] hover:bg-[#262626] border border-[#2c2c2c] hover:border-[#3e3e3e] text-[#a1a1a1] hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0 shadow-xs"
                                >
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : isNull ? (
                              <span className="font-sans text-[#555555] italic text-[13px]">null</span>
                            ) : isBool ? (
                              <span className="font-sans text-[13.5px] text-[#cccccc]">
                                {String(val)}
                              </span>
                            ) : isObj ? (
                              <span className="font-sans text-[13.5px] text-[#cccccc] truncate block w-full">
                                {JSON.stringify(val)}
                              </span>
                            ) : (
                              <span className="font-sans text-[13.5px] truncate block w-full">{strVal}</span>
                            )}
                          </td>
                        );
                      })}

                      {/* Empty cell for Add Column column */}
                      <td
                        className="border-r border-[#151515] bg-transparent"
                        style={{ width: '48px', minWidth: '48px', maxWidth: '48px' }}
                      />
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    )}

      {/* Tab 2: Definition View (SQL DDL Editor) */}
      {activeTab === 'definition' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#0a0a0a]">
          {!selectedTable ? (
            <div className="flex-1 flex flex-col items-center justify-center p-16 text-[#777777] text-[14px] gap-2.5">
              <TableIcon className="w-8 h-8 text-[#444444]" />
              <p className="text-[14px] font-medium text-white">No table selected</p>
              <p className="text-[12.5px] text-[#888888] max-w-sm text-center">
                Select a table from the sidebar to inspect its SQL DDL definition schema.
              </p>
            </div>
          ) : (
            <>
              {/* Header bar */}
              <div className="h-[46px] shrink-0 px-5 border-b border-[#222222] bg-[#0c0c0c] flex items-center justify-between gap-3 select-none">
                <h3 className="text-[14px] font-sans text-[#eaeaea]">
                  SQL Definition of <span className="font-semibold text-white">{selectedTable}</span>{' '}
                  <span className="text-[#666666] font-normal text-[13px]">(Read only)</span>
                </h3>

                {onOpenInSqlEditor && (
                  <button
                    type="button"
                    onClick={() => onOpenInSqlEditor(ddl)}
                    className="px-3.5 py-1.5 rounded-[6px] bg-[#1a1a1a] hover:bg-[#252525] border border-[#2d2d2d] hover:border-[#3d3d3d] text-[13px] font-medium text-white transition-colors cursor-pointer"
                  >
                    Open in SQL Editor
                  </button>
                )}
              </div>

              {/* Line numbered SQL viewer */}
          <div className="flex-1 overflow-auto p-4 font-mono text-[13px] leading-[22px] bg-[#0c0c0c]">
            <table className="border-collapse w-full select-text">
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} className="hover:bg-[#141414]/50">
                    <td className="w-10 pr-6 text-right text-[#555555] select-none align-top font-mono text-[12.5px]">
                      {idx + 1}
                    </td>
                    <td className="align-top whitespace-pre font-mono">
                      {line.tokens.map((token, tIdx) => (
                        <span key={tIdx} className={token.color}>
                          {token.text}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )}

      {/* Pagination & Status Footer */}
      <div className={`h-12 shrink-0 px-4 bg-[#0a0a0a] border-t border-[#222222] flex items-center gap-3 text-[13px] text-[#8c8c8c] select-none font-sans ${
        activeTab === 'data' ? 'justify-between' : 'justify-end'
      }`}>
        {activeTab === 'data' && (
          <span>
            Showing <span className="text-white font-medium">{rows.length}</span> rows
            {selectedTable && (
              <> in <span className="text-white font-mono">{selectedTable}</span></>
            )}
          </span>
        )}

        {/* Bottom Right Mode Switcher Tabs */}
        <div className="flex items-center p-0.5 rounded-[6px] bg-[#141414] border border-[#262626]">
          <button
            type="button"
            onClick={() => setActiveTab('data')}
            title="Table Data Grid"
            className={`flex items-center px-3 py-1 rounded-[4px] text-[13px] font-medium transition-colors cursor-pointer ${
              activeTab === 'data' ? 'bg-[#222222] text-white shadow-xs' : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            <span>Data</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('definition')}
            title="SQL Definition & DDL"
            className={`flex items-center px-3 py-1 rounded-[4px] text-[13px] font-medium transition-colors cursor-pointer ${
              activeTab === 'definition' ? 'bg-[#222222] text-white shadow-xs' : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            <span>Definition</span>
          </button>
        </div>
      </div>
    </div>
  );
}
