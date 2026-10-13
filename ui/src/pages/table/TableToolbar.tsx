/*
 * Table Workspace Top Toolbar subcomponent.
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../types, ../../components/shared/CustomSelect
 */

import React, { useRef, useEffect } from 'react';
import {
  Plus,
  Columns,
  Filter,
  ArrowUpDown,
  RefreshCw,
  Table as TableIcon,
  Layers,
  Terminal,
  ChevronDown,
  Check,
  Trash2,
  Search,
  Sparkles,
  Copy,
  ZoomIn,
  ZoomOut,
  Maximize,
  FileText,
  Download,
} from 'lucide-react';
import { ColumnInfoApi } from '../../types';
import { CustomSelect } from '../../components/shared/CustomSelect';

export interface TableToolbarProps {
  viewMode: 'grid' | 'schema' | 'sql';
  setViewMode: (mode: 'grid' | 'schema' | 'sql') => void;
  gridSubTab?: 'data' | 'definition';
  setGridSubTab?: (tab: 'data' | 'definition') => void;
  selectedTable: string;
  columns: ColumnInfoApi[];

  // Selection batch actions
  selectedCount?: number;
  onDeleteSelected?: () => void;
  onExportSelected?: (format: 'csv' | 'json' | 'sql') => void;

  // Insert actions
  onOpenInsertRow: () => void;
  onOpenAddColumn: () => void;

  // Filter state
  activeFilter: { col: string; op: string; val: unknown } | null;
  setActiveFilter: (filter: { col: string; op: string; val: unknown } | null) => void;
  filterCol: string;
  setFilterCol: (col: string) => void;
  filterOp: 'eq' | 'neq' | 'gt' | 'lt' | 'like' | 'is_null';
  setFilterOp: (op: 'eq' | 'neq' | 'gt' | 'lt' | 'like' | 'is_null') => void;
  filterVal: string;
  setFilterVal: (val: string) => void;

  // Sort state
  activeSort: { col: string; order: 'asc' | 'desc' } | null;
  setActiveSort: (sort: { col: string; order: 'asc' | 'desc' } | null) => void;
  sortCol: string;
  setSortCol: (col: string) => void;
  sortOrder: 'asc' | 'desc';
  setSortOrder: (order: 'asc' | 'desc') => void;

  // Pagination & reload
  pageSize: number;
  setPageSize: (size: number) => void;
  currentPage: number;
  onJumpToPage: (page: number) => boolean | void;
  onPrevPage: () => void;
  onNextPage: () => void;
  hasPrevPage: boolean;
  hasNextPage: boolean;
  onReload: () => void;
  isRowsLoading: boolean;
  isSchemaLoading: boolean;

  // SQL preset helper
  onSelectSqlMode: () => void;

  // Schema view controls
  schemaSearchTerm?: string;
  setSchemaSearchTerm?: (term: string) => void;
  activeSchema?: string;
  onCopySql?: (format: 'postgres' | 'generic') => void;
  onCopyMarkdown?: () => void;
  onDownloadPng?: () => void;
  onDownloadSvg?: () => void;
  copiedKey?: string | null;
  onAutoLayout?: () => void;
  zoomScale?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
}

export function TableToolbar({
  viewMode,
  setViewMode,
  gridSubTab = 'data',
  setGridSubTab,
  selectedTable,
  columns,
  onOpenInsertRow,
  onOpenAddColumn,
  activeFilter,
  setActiveFilter,
  filterCol,
  setFilterCol,
  filterOp,
  setFilterOp,
  filterVal,
  setFilterVal,
  activeSort,
  setActiveSort,
  sortCol,
  setSortCol,
  sortOrder,
  setSortOrder,
  pageSize,
  setPageSize,
  currentPage,
  onJumpToPage,
  onPrevPage,
  onNextPage,
  hasPrevPage,
  hasNextPage,
  onReload,
  isRowsLoading,
  isSchemaLoading,
  onSelectSqlMode,
  selectedCount = 0,
  onDeleteSelected,
  onExportSelected,
  schemaSearchTerm = '',
  setSchemaSearchTerm,
  activeSchema = 'public',
  onCopySql,
  onCopyMarkdown,
  onDownloadPng,
  onDownloadSvg,
  copiedKey,
  onAutoLayout,
  zoomScale = 0.95,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: TableToolbarProps) {
  const [isInsertDropdownOpen, setIsInsertDropdownOpen] = React.useState(false);
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false);
  const [isCopySqlOpen, setIsCopySqlOpen] = React.useState(false);
  const [showFilterPopover, setShowFilterPopover] = React.useState(false);
  const [showSortPopover, setShowSortPopover] = React.useState(false);
  const [showPageSizePopover, setShowPageSizePopover] = React.useState(false);
  const [pageInputVal, setPageInputVal] = React.useState(String(currentPage));

  useEffect(() => {
    setPageInputVal(String(currentPage));
  }, [currentPage]);

  const insertDropdownRef = useRef<HTMLDivElement>(null);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const copySqlRef = useRef<HTMLDivElement>(null);
  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const sortPopoverRef = useRef<HTMLDivElement>(null);
  const pageSizePopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (insertDropdownRef.current && !insertDropdownRef.current.contains(target)) {
        setIsInsertDropdownOpen(false);
      }
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(target)) {
        setIsExportDropdownOpen(false);
      }
      if (copySqlRef.current && !copySqlRef.current.contains(target)) {
        setIsCopySqlOpen(false);
      }
      if (filterPopoverRef.current && !filterPopoverRef.current.contains(target)) {
        setShowFilterPopover(false);
      }
      if (sortPopoverRef.current && !sortPopoverRef.current.contains(target)) {
        setShowSortPopover(false);
      }
      if (pageSizePopoverRef.current && !pageSizePopoverRef.current.contains(target)) {
        setShowPageSizePopover(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  return (
    <div className="h-[54px] shrink-0 px-4 border-b border-[#222222] bg-[#0c0c0c] flex items-center justify-between gap-3 select-none font-sans">
      {/* Action Tools & View Mode Switcher (placed on the left) */}
      <div className="flex items-center gap-2 shrink-0">
        {/* View Mode Switcher Pills */}
        <div className="flex items-center p-1 rounded-[7px] bg-[#141414] border border-[#262626] h-9">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            title="Table Grid"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[13px] font-medium transition-colors cursor-pointer ${
              viewMode === 'grid' ? 'bg-[#222222] text-white shadow-sm' : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Grid</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('schema')}
            title="Schema & Relations"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[13px] font-medium transition-colors cursor-pointer ${
              viewMode === 'schema' ? 'bg-[#222222] text-white shadow-sm' : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Schema</span>
          </button>
          <button
            type="button"
            onClick={onSelectSqlMode}
            title="SQL Console"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[13px] font-medium transition-colors cursor-pointer ${
              viewMode === 'sql' ? 'bg-[#222222] text-white shadow-sm' : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="hidden md:inline">SQL</span>
          </button>
        </div>

        {viewMode === 'grid' && (
          <>
            {/* Insert Dropdown Menu */}
            <div className="relative" ref={insertDropdownRef}>
              <button
                type="button"
                onClick={() => setIsInsertDropdownOpen(!isInsertDropdownOpen)}
                disabled={!selectedTable}
                className="flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] disabled:opacity-40 text-[#cccccc] hover:text-white text-[13px] font-medium transition-colors cursor-pointer"
              >
                <span>Insert</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#777777]" />
              </button>

              {isInsertDropdownOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-44 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans">
                  <button
                    type="button"
                    onClick={() => {
                      setIsInsertDropdownOpen(false);
                      onOpenInsertRow();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer text-left"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#888888]" />
                    <span>Insert row</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsInsertDropdownOpen(false);
                      onOpenAddColumn();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer text-left"
                  >
                    <Columns className="w-3.5 h-3.5 text-[#888888]" />
                    <span>Insert column</span>
                  </button>
                </div>
              )}
            </div>

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
                <div className="absolute left-0 top-full mt-1.5 w-72 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-3 z-50 font-sans">
                  <div className="text-[13px] font-semibold text-white mb-3">Filter Records</div>
                  <div className="space-y-2.5">
                    <CustomSelect
                      size="sm"
                      value={filterCol}
                      onChange={setFilterCol}
                      options={[
                        { value: '', label: 'Select column...' },
                        ...columns.map((c) => ({ value: c.name, label: `${c.name} (${c.type})` })),
                      ]}
                    />

                    <CustomSelect
                      size="sm"
                      value={filterOp}
                      onChange={(v) => setFilterOp(v as any)}
                      options={[
                        { value: 'eq', label: 'Equals (=)' },
                        { value: 'neq', label: 'Not equals (!=)' },
                        { value: 'gt', label: 'Greater than (>)' },
                        { value: 'lt', label: 'Less than (<)' },
                        { value: 'like', label: 'Contains (LIKE)' },
                        { value: 'is_null', label: 'Is NULL' },
                      ]}
                    />

                    {filterOp !== 'is_null' && (
                      <input
                        type="text"
                        placeholder="Value..."
                        value={filterVal}
                        onChange={(e) => setFilterVal(e.target.value)}
                        className="w-full h-8 px-2.5 bg-[#141414] border border-[#2c2c2c] rounded-[8px] text-[13px] text-white placeholder-[#666666] focus:outline-none focus:border-[#3b82f6] transition-colors"
                      />
                    )}

                    <div className="flex items-center justify-between pt-1.5">
                      <button
                        onClick={() => {
                          setActiveFilter(null);
                          setFilterCol('');
                          setFilterVal('');
                          setShowFilterPopover(false);
                        }}
                        className="text-[12px] font-medium text-[#8c8c8c] hover:text-white transition-colors cursor-pointer"
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
                        className="px-3 py-1.5 bg-[#2563eb] hover:bg-[#3b82f6] rounded-[6px] text-[12.5px] font-medium text-white transition-colors cursor-pointer shadow-sm"
                      >
                        Apply Filter
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
                <div className="absolute left-0 top-full mt-1.5 w-64 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-3 z-50 font-sans">
                  <div className="text-[13px] font-semibold text-white mb-3">Sort Records</div>
                  <div className="space-y-2.5">
                    <CustomSelect
                      size="sm"
                      value={sortCol}
                      onChange={setSortCol}
                      options={[
                        { value: '', label: 'Select column...' },
                        ...columns.map((c) => ({ value: c.name, label: c.name })),
                      ]}
                    />

                    <div className="flex gap-2">
                      <button
                        onClick={() => setSortOrder('asc')}
                        className={`flex-1 h-8 rounded-[6px] text-[12px] font-medium border transition-colors cursor-pointer ${
                          sortOrder === 'asc'
                            ? 'bg-[#1d4ed8]/20 border-[#3b82f6]/50 text-[#60a5fa]'
                            : 'bg-[#141414] border-[#2c2c2c] text-[#8c8c8c] hover:border-[#383838] hover:text-white'
                        }`}
                      >
                        ASC
                      </button>
                      <button
                        onClick={() => setSortOrder('desc')}
                        className={`flex-1 h-8 rounded-[6px] text-[12px] font-medium border transition-colors cursor-pointer ${
                          sortOrder === 'desc'
                            ? 'bg-[#1d4ed8]/20 border-[#3b82f6]/50 text-[#60a5fa]'
                            : 'bg-[#141414] border-[#2c2c2c] text-[#8c8c8c] hover:border-[#383838] hover:text-white'
                        }`}
                      >
                        DESC
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-1.5">
                      <button
                        onClick={() => {
                          setActiveSort(null);
                          setSortCol('');
                          setShowSortPopover(false);
                        }}
                        className="text-[12px] font-medium text-[#8c8c8c] hover:text-white transition-colors cursor-pointer"
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
              onClick={onReload}
              disabled={isRowsLoading || isSchemaLoading}
              title="Reload rows"
              className="w-8 h-8 flex items-center justify-center rounded-[6px] bg-[#141414] border border-[#262626] text-[#8c8c8c] hover:text-white hover:border-[#383838] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRowsLoading || isSchemaLoading ? 'animate-spin' : ''}`} />
            </button>

            {/* Selection Batch Action Buttons (Visible when 1 or more rows selected) */}
            {selectedCount > 0 && (
              <div className="flex items-center gap-1.5 pl-1 animate-in fade-in zoom-in-95 duration-100">
                {/* Delete Selected Rows Button */}
                {onDeleteSelected && (
                  <button
                    type="button"
                    onClick={onDeleteSelected}
                    title={`Delete ${selectedCount} selected row${selectedCount > 1 ? 's' : ''}`}
                    className="flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] bg-red-950/30 hover:bg-red-950/50 border border-red-800/40 hover:border-red-600/60 text-red-400 hover:text-red-300 text-[13px] font-medium transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                )}

                {/* Export Dropdown Menu */}
                {onExportSelected && (
                  <div className="relative" ref={exportDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
                      className="flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] text-[#cccccc] hover:text-white text-[13px] font-medium transition-colors cursor-pointer"
                    >
                      <span>Export</span>
                      <ChevronDown className="w-3.5 h-3.5 text-[#777777]" />
                    </button>

                    {isExportDropdownOpen && (
                      <div className="absolute left-0 top-full mt-1.5 w-36 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans">
                        <button
                          type="button"
                          onClick={() => {
                            setIsExportDropdownOpen(false);
                            onExportSelected('csv');
                          }}
                          className="w-full flex items-center px-2.5 py-1.5 rounded-[6px] text-[13px] text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer text-left"
                        >
                          CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsExportDropdownOpen(false);
                            onExportSelected('json');
                          }}
                          className="w-full flex items-center px-2.5 py-1.5 rounded-[6px] text-[13px] text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer text-left"
                        >
                          JSON
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsExportDropdownOpen(false);
                            onExportSelected('sql');
                          }}
                          className="w-full flex items-center px-2.5 py-1.5 rounded-[6px] text-[13px] text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer text-left"
                        >
                          SQL
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Schema Mode Controls: Find table... search */}
        {viewMode === 'schema' && (
          <div className="flex items-center pl-1 animate-in fade-in duration-100">
            {/* Find table... Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-[#71717a] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Find table..."
                value={schemaSearchTerm}
                onChange={(e) => setSchemaSearchTerm?.(e.target.value)}
                className="h-9 pl-9 pr-3 w-48 rounded-[7px] bg-[#141414] border border-[#262626] text-[13px] text-white placeholder-[#71717a] focus:outline-none focus:border-[#3a3a3a] transition-colors font-sans"
              />
            </div>
          </div>
        )}
      </div>

      {/* Right: Schema Controls (Copy as SQL, Auto layout, Zoom) */}
      {viewMode === 'schema' && (
        <div className="flex items-center gap-2 shrink-0 animate-in fade-in duration-100">
          {/* Copy as SQL dropdown */}
          <div className="relative" ref={copySqlRef}>
            <button
              type="button"
              onClick={() => setIsCopySqlOpen(!isCopySqlOpen)}
              className="flex items-center gap-2 h-9 px-3 rounded-[7px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#3a3a3a] text-[13px] font-medium text-white transition-colors cursor-pointer"
            >
              {copiedKey === 'schema_sql' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-[#a1a1aa]" />
              )}
              <span>Copy as SQL</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#71717a]" />
            </button>

            {isCopySqlOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-48 bg-[#18181b] border border-[#27272a] rounded-[8px] shadow-2xl p-1 z-50 animate-in fade-in duration-100 font-sans">
                <button
                  type="button"
                  onClick={() => {
                    onCopySql?.('postgres');
                    setIsCopySqlOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-[5px] text-[13px] text-[#d4d4d8] hover:text-white hover:bg-[#27272a] transition-colors cursor-pointer text-left"
                >
                  <span>Copy as SQL</span>
                  {copiedKey === 'schema_sql' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onCopyMarkdown?.();
                    setIsCopySqlOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-[5px] text-[13px] text-[#d4d4d8] hover:text-white hover:bg-[#27272a] transition-colors cursor-pointer text-left"
                >
                  <span>Copy as Markdown</span>
                  {copiedKey === 'schema_markdown' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDownloadPng?.();
                    setIsCopySqlOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-[5px] text-[13px] text-[#d4d4d8] hover:text-white hover:bg-[#27272a] transition-colors cursor-pointer text-left"
                >
                  <span>Download as PNG</span>
                  {copiedKey === 'schema_png' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDownloadSvg?.();
                    setIsCopySqlOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-[5px] text-[13px] text-[#d4d4d8] hover:text-white hover:bg-[#27272a] transition-colors cursor-pointer text-left"
                >
                  <span>Download as SVG</span>
                  {copiedKey === 'schema_svg' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                </button>
              </div>
            )}
          </div>

          {/* Auto layout button */}
          <button
            type="button"
            onClick={onAutoLayout}
            title="Auto layout entity nodes"
            className="flex items-center h-9 px-3 rounded-[7px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#3a3a3a] text-[13px] font-medium text-white transition-colors cursor-pointer"
          >
            <span>Auto layout</span>
          </button>

          {/* Zoom controls & Fit-to-screen reset pill */}
          <div className="flex items-center p-0.5 rounded-[7px] bg-[#141414] border border-[#262626] h-9 shadow-xs">
            <button
              type="button"
              onClick={onZoomOut}
              disabled={zoomScale <= 0.3}
              title="Zoom Out (-15%)"
              className="w-7 h-7 flex items-center justify-center rounded-[5px] text-[#a1a1aa] hover:text-white hover:bg-[#1f1f23] disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[#a1a1aa] transition-colors cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span
              className="text-[12px] font-mono text-[#8a8a92] px-1.5 min-w-[44px] text-center select-none"
              title="Current Zoom"
            >
              {Math.round(zoomScale * 100)}%
            </span>
            <button
              type="button"
              onClick={onZoomIn}
              disabled={zoomScale >= 2.2}
              title="Zoom In (+15%)"
              className="w-7 h-7 flex items-center justify-center rounded-[5px] text-[#a1a1aa] hover:text-white hover:bg-[#1f1f23] disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[#a1a1aa] transition-colors cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <div className="h-4 w-px bg-[#262626] mx-0.5" />
            <button
              type="button"
              onClick={onResetZoom}
              title="Fit to Screen / Center"
              className="w-7 h-7 flex items-center justify-center rounded-[5px] text-[#a1a1aa] hover:text-white hover:bg-[#1f1f23] transition-colors cursor-pointer"
            >
              <Maximize className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Right: Next and Previous Pagination Controls (Only visible in Data grid mode, hidden in Definition view) */}
      {viewMode === 'grid' && gridSubTab === 'data' && (
        <div className="flex items-center gap-2 shrink-0">
          {/* Custom Page Size Dropdown */}
          <div className="relative" ref={pageSizePopoverRef}>
            <button
              type="button"
              onClick={() => setShowPageSizePopover(!showPageSizePopover)}
              className="flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] hover:text-white hover:border-[#383838] text-[13px] font-medium transition-colors cursor-pointer"
              title="Page size"
            >
              <span>{pageSize}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-[#777777] transition-transform duration-150 ${
                  showPageSizePopover ? 'rotate-180 text-white' : ''
                }`}
              />
            </button>

            {showPageSizePopover && (
              <div className="absolute right-0 top-full mt-1.5 w-24 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-1 z-50 font-sans animate-in fade-in duration-100">
                {[25, 50, 100, 250, 500].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => {
                      setPageSize(sz);
                      setShowPageSizePopover(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors cursor-pointer font-sans ${
                      pageSize === sz
                        ? 'bg-blue-600/15 text-blue-400 font-medium'
                        : 'text-[#cccccc] hover:bg-[#1a1a1a] hover:text-white'
                    }`}
                  >
                    <span>{sz}</span>
                    {pageSize === sz && <Check className="w-3.5 h-3.5 text-blue-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={onPrevPage}
            disabled={!hasPrevPage || isRowsLoading}
            className="flex items-center justify-center h-8 px-3 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] disabled:opacity-40 hover:text-white hover:border-[#383838] transition-colors cursor-pointer"
            title="Previous page"
          >
            <span className="text-[13px] font-sans font-medium">Previous</span>
          </button>

          {/* Editable Page Number */}
          <div className="flex items-center justify-center px-1.5 h-8 rounded-[6px] bg-[#141414] border border-[#262626] text-[13px] font-sans text-[#8c8c8c] focus-within:border-[#383838]">
            <input
              type="text"
              inputMode="numeric"
              value={pageInputVal}
              onChange={(e) => setPageInputVal(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const p = parseInt(pageInputVal, 10);
                  if (!isNaN(p) && p >= 1) {
                    const valid = onJumpToPage(p);
                    if (!valid) {
                      setPageInputVal('1');
                    }
                  } else {
                    onJumpToPage(1);
                    setPageInputVal('1');
                  }
                } else if (e.key === 'Escape') {
                  setPageInputVal(String(currentPage));
                }
              }}
              onBlur={() => {
                const p = parseInt(pageInputVal, 10);
                if (!isNaN(p) && p >= 1) {
                  if (p !== currentPage) {
                    const valid = onJumpToPage(p);
                    if (!valid) {
                      setPageInputVal('1');
                    }
                  }
                } else {
                  onJumpToPage(1);
                  setPageInputVal('1');
                }
              }}
              title="Click or press Enter to jump to page"
              className="w-7 h-5 text-center bg-transparent text-white font-sans text-[13px] font-medium outline-none focus:outline-none select-all"
            />
          </div>

          <button
            onClick={onNextPage}
            disabled={!hasNextPage || isRowsLoading}
            className="flex items-center justify-center h-8 px-3 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] disabled:opacity-40 hover:text-white hover:border-[#383838] transition-colors cursor-pointer"
            title="Next page"
          >
            <span className="text-[13px] font-sans font-medium">Next</span>
          </button>
        </div>
      )}
    </div>
  );
}
