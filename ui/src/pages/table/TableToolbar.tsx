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
} from 'lucide-react';
import { ColumnInfoApi } from '../../types';
import { CustomSelect } from '../../components/shared/CustomSelect';

export interface TableToolbarProps {
  viewMode: 'grid' | 'schema' | 'sql';
  setViewMode: (mode: 'grid' | 'schema' | 'sql') => void;
  selectedTable: string;
  columns: ColumnInfoApi[];

  // Insert actions
  onOpenInsertRow: () => void;
  onOpenAddColumn: () => void;

  // Filter state
  activeFilter: { col: string; op: string; val: string } | null;
  setActiveFilter: (filter: { col: string; op: string; val: string } | null) => void;
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
  onJumpToPage: (page: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  hasPrevPage: boolean;
  hasNextPage: boolean;
  onReload: () => void;
  isRowsLoading: boolean;
  isSchemaLoading: boolean;

  // SQL preset helper
  onSelectSqlMode: () => void;
}

export function TableToolbar({
  viewMode,
  setViewMode,
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
}: TableToolbarProps) {
  const [isInsertDropdownOpen, setIsInsertDropdownOpen] = React.useState(false);
  const [showFilterPopover, setShowFilterPopover] = React.useState(false);
  const [showSortPopover, setShowSortPopover] = React.useState(false);
  const [showPageSizePopover, setShowPageSizePopover] = React.useState(false);
  const [pageInputVal, setPageInputVal] = React.useState(String(currentPage));

  useEffect(() => {
    setPageInputVal(String(currentPage));
  }, [currentPage]);

  const insertDropdownRef = useRef<HTMLDivElement>(null);
  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const sortPopoverRef = useRef<HTMLDivElement>(null);
  const pageSizePopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (insertDropdownRef.current && !insertDropdownRef.current.contains(target)) {
        setIsInsertDropdownOpen(false);
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
          </>
        )}

        {/* View Mode Switcher Pills */}
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
            onClick={onSelectSqlMode}
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
          <div className="flex items-center gap-1.5 px-2 h-8 rounded-[6px] bg-[#141414] border border-[#262626] text-[13px] font-sans text-[#8c8c8c]">
            <span className="text-[12px] font-sans text-[#666666] select-none">Page</span>
            <input
              type="text"
              inputMode="numeric"
              value={pageInputVal}
              onChange={(e) => setPageInputVal(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const p = parseInt(pageInputVal, 10);
                  if (!isNaN(p) && p >= 1) {
                    onJumpToPage(p);
                  } else {
                    setPageInputVal(String(currentPage));
                  }
                } else if (e.key === 'Escape') {
                  setPageInputVal(String(currentPage));
                }
              }}
              onBlur={() => {
                const p = parseInt(pageInputVal, 10);
                if (!isNaN(p) && p >= 1 && p !== currentPage) {
                  onJumpToPage(p);
                } else {
                  setPageInputVal(String(currentPage));
                }
              }}
              title="Click or press Enter to jump to page"
              className="w-8 h-5 text-center bg-transparent text-white font-sans text-[13px] font-medium border-b border-transparent focus:border-white focus:outline-none transition-colors"
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
