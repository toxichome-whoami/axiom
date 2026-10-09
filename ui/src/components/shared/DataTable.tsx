/**
 * DataTable.tsx
 * High-performance data table component with bounded DOM rendering and column resizing.
 * Enforces client row slicing and a 500-row cap on unpaginated data (F-06 / F1) to prevent tab freezes.
 * Throttles column drag-resizing via requestAnimationFrame and satisfies WCAG table semantics.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, AlertTriangle } from 'lucide-react';

export interface Column<T> {
  id: string;
  header: React.ReactNode;
  accessorKey?: keyof T;
  cell?: (row: T, index: number) => React.ReactNode;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  isResizable?: boolean;
  resizerPosition?: 'before' | 'after' | 'left' | 'right';
  isSortable?: boolean;
  sortField?: string;
  isFlex?: boolean;
  className?: string;
  headerClassName?: string;
}

export interface DataTablePagination {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor?: (item: T, index: number) => string | number;
  isLoading?: boolean;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (field: string) => void;
  onRowClick?: (row: T, index: number) => void;
  emptyMessage?: React.ReactNode;
  pagination?: DataTablePagination;
  minTableWidth?: string;
  className?: string;
  ariaLabel?: string;
  allowRowExpansion?: boolean;
}

export const CaretUpDownIcon: React.FC<{ active: boolean; direction: 'asc' | 'desc' }> = ({
  active,
  direction,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    fill="currentColor"
    viewBox="0 0 256 256"
    className={`transition-colors shrink-0 ${active ? 'text-white' : 'text-[#666666] group-hover:text-white'}`}
  >
    {active && direction === 'asc' ? (
      <path d="M213.66,165.66a8,8,0,0,1-11.32,0L128,91.31,53.66,165.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,165.66Z" />
    ) : active && direction === 'desc' ? (
      <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
    ) : (
      <path d="M181.66,170.34a8,8,0,0,1,0,11.32l-48,48a8,8,0,0,1-11.32,0l-48-48a8,8,0,0,1,11.32-11.32L128,212.69l42.34-42.35A8,8,0,0,1,181.66,170.34Zm-96-84.68a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,0l48,48a8,8,0,0,1-11.32,11.32L128,43.31,85.66,85.66A8,8,0,0,1,85.66,85.66Z" />
    )}
  </svg>
);

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export const PageSizeDropdown: React.FC<{
  pageSize: number;
  onChange: (size: number) => void;
  options?: number[];
}> = ({ pageSize, onChange, options = DEFAULT_PAGE_SIZE_OPTIONS }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`h-7 px-2.5 rounded-md bg-[#141414] border text-[13px] font-normal text-[#cccccc] hover:text-white inline-flex items-center gap-1.5 cursor-pointer transition-colors select-none ${
          isOpen ? 'border-[#3b82f6] text-white bg-[#1a1a1a]' : 'border-[#262626] hover:border-[#383838]'
        }`}
        aria-label="Rows per page"
        aria-expanded={isOpen}
      >
        <span className="tabular-nums">{pageSize}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#777777] transition-transform duration-150 shrink-0 ${isOpen ? 'rotate-180 text-white' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 bottom-full mb-1.5 w-20 rounded-md bg-[#0c0c0c] border border-[#262626] shadow-2xl p-1 z-50 select-none">
          {options.map((size) => {
            const isSelected = size === pageSize;
            return (
              <button
                key={size}
                type="button"
                onClick={() => {
                  onChange(size);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1 rounded text-[13px] transition-colors cursor-pointer text-left ${
                  isSelected
                    ? 'text-white bg-[#1a1a1a] font-medium'
                    : 'text-[#8c8c8c] hover:text-white hover:bg-[#161616]'
                }`}
              >
                <span className="tabular-nums">{size}</span>
                {isSelected && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="10"
                    height="10"
                    viewBox="0 0 256 256"
                    fill="currentColor"
                    className="text-white shrink-0 ml-1.5"
                  >
                    <path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  sortField,
  sortDirection = 'desc',
  onSort,
  onRowClick,
  emptyMessage = 'No records found matching current criteria.',
  pagination,
  minTableWidth = 'min-w-[800px]',
  className = '',
  ariaLabel = 'Data table',
  allowRowExpansion = false,
}: DataTableProps<T>) {
  // Initialize column widths map
  const [columnWidths, setColumnWidths] = useState<{ [key: string]: number }>(() => {
    const initial: { [key: string]: number } = {};
    columns.forEach((col) => {
      if (col.width) {
        initial[col.id] = col.width;
      }
    });
    return initial;
  });

  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Clean up any pending animation frame on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  const handleResizeStart = (colId: string, e: React.MouseEvent, isBefore = false) => {
    e.preventDefault();
    e.stopPropagation();

    const columnConfig = columns.find((c) => c.id === colId);
    const startX = e.clientX;
    const defaultW = columnConfig?.width || 160;
    const startWidth = columnWidths[colId] || defaultW;
    const minW = columnConfig?.minWidth || 80;
    const maxW = columnConfig?.maxWidth || 600;

    let hasMoved = false;

    setResizingCol(colId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      if (Math.abs(delta) > 2) {
        hasMoved = true;
      }
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      rafIdRef.current = requestAnimationFrame(() => {
        const effectiveDelta = isBefore ? -delta : delta;
        const newWidth = Math.max(minW, Math.min(maxW, startWidth + effectiveDelta));
        setColumnWidths((prev) => ({ ...prev, [colId]: newWidth }));
      });
    };

    const onMouseUp = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      setResizingCol(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (hasMoved) {
        const preventClickCapture = (clickEvent: MouseEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          clickEvent.stopImmediatePropagation();
          window.removeEventListener('click', preventClickCapture, true);
        };
        window.addEventListener('click', preventClickCapture, true);
        setTimeout(() => {
          window.removeEventListener('click', preventClickCapture, true);
        }, 100);
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  // Safe pagination math clamped against negative or non-finite inputs
  const safePageSize = pagination ? Math.max(1, Math.min(pagination.pageSize || 10, 500)) : 50;
  const totalCount = pagination ? Math.max(0, pagination.totalCount) : data.length;
  const totalPages = pagination ? Math.max(1, Math.ceil(totalCount / safePageSize)) : 1;
  const safePage = pagination ? Math.max(1, Math.min(pagination.page, totalPages)) : 1;

  // Bounded row calculation (F-06 / F1)
  const visibleData = useMemo(() => {
    if (pagination) {
      // If dataset contains more items than pageSize, caller passed an unpaginated array
      if (data.length > safePageSize) {
        const startIndex = (safePage - 1) * safePageSize;
        return data.slice(startIndex, startIndex + safePageSize);
      }
      return data;
    }
    // Hard ceiling on unpaginated tables to prevent DOM memory/render exhaustion
    return data.slice(0, 500);
  }, [data, pagination, safePage, safePageSize]);

  const startItem = pagination && totalCount > 0 ? (safePage - 1) * safePageSize + 1 : 0;
  const endItem = pagination ? Math.min(safePage * safePageSize, totalCount) : visibleData.length;

  return (
    <div className={`border border-[#262626] rounded-lg overflow-hidden bg-[#0e0e0e] flex flex-col text-[14px] ${className}`}>
      {data.length > 500 && !pagination && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#2a1708] border-b border-[#59300e] text-[#f5a623] text-[12px]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Large dataset detected. Rendering capped at 500 rows for browser stability.</span>
        </div>
      )}

      <div className="overflow-x-auto w-full">
        <table role="table" aria-label={ariaLabel} className={`w-full max-md:min-w-0 ${minTableWidth} text-left border-collapse`}>
          {/* Table Header */}
          <thead className="sticky top-0 z-10 max-md:hidden">
            <tr
              role="row"
              className="flex w-full items-center border-b border-[#222222] bg-[#141414] h-[40px] min-h-[40px] max-h-[40px]"
            >
              {columns.map((col, idx) => {
                const isFirst = idx === 0;
                const widthStyle = col.isFlex
                  ? undefined
                  : { width: `${columnWidths[col.id] || col.width || 160}px` };

                const sortTarget = col.sortField || col.id;
                const isSortActive = Boolean(col.isSortable && onSort && sortField === sortTarget);
                const isBeforeResizer =
                  col.resizerPosition === 'before' ||
                  col.resizerPosition === 'left' ||
                  (idx === columns.length - 1 && !col.isFlex && columns.some((c) => c.isFlex));

                return (
                  <th
                    key={col.id}
                    role="columnheader"
                    aria-sort={
                      col.isSortable
                        ? isSortActive
                          ? sortDirection === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                        : undefined
                    }
                    style={widthStyle}
                    className={`group relative flex items-center shrink-0 h-[40px] min-w-0 ${
                      col.isFlex ? 'flex-1' : ''
                    } ${isFirst ? 'rounded-tl-lg' : ''} ${col.headerClassName || col.className || 'px-3'}`}
                  >
                    {col.isSortable && onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(sortTarget)}
                        className={`inline-flex items-center gap-1.5 text-[14px] font-medium text-white leading-none min-w-0 max-w-full overflow-hidden text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[#2f80ed] rounded cursor-pointer select-none ${
                          (col.headerClassName || col.className)?.includes('justify-end')
                            ? 'justify-end w-full'
                            : ''
                        }`}
                      >
                        <span
                          className="truncate whitespace-nowrap block min-w-0"
                          title={typeof col.header === 'string' ? col.header : undefined}
                        >
                          {col.header}
                        </span>
                        <CaretUpDownIcon active={isSortActive} direction={sortDirection} />
                      </button>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1.5 text-[14px] font-medium text-white leading-none min-w-0 max-w-full overflow-hidden ${
                          (col.headerClassName || col.className)?.includes('justify-end')
                            ? 'justify-end w-full'
                            : ''
                        }`}
                      >
                        <span
                          className="truncate whitespace-nowrap block min-w-0"
                          title={typeof col.header === 'string' ? col.header : undefined}
                        >
                          {col.header}
                        </span>
                      </span>
                    )}

                    {/* Resizable handle */}
                    {col.isResizable && !col.isFlex && (
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${col.id} column`}
                        onMouseDown={(e) => handleResizeStart(col.id, e, isBeforeResizer)}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (col.width) {
                            setColumnWidths((prev) => ({ ...prev, [col.id]: col.width! }));
                          }
                        }}
                        className={`absolute ${
                          isBeforeResizer ? '-left-1.5' : '-right-1.5'
                        } top-0 bottom-0 w-3 flex items-center justify-center cursor-col-resize z-20 group/resizer`}
                        title="Drag to resize column (double-click to reset)"
                      >
                        <span
                          className={`w-px h-4 transition-colors ${
                            resizingCol === col.id
                              ? 'bg-[#2f80ed] h-full'
                              : 'bg-[#262626] group-hover/resizer:bg-[#2f80ed]'
                          }`}
                        />
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Table Body */}
          <tbody>
            {isLoading ? (
              // Loading Skeleton Shimmer
              Array.from({ length: 5 }).map((_, i) => (
                <tr
                  key={`skeleton-${i}`}
                  role="row"
                  className="flex max-md:flex-col max-md:p-4 max-md:gap-3 w-full md:items-center h-auto md:h-[40px] border-b border-[#1e1e1e] bg-[#0e0e0e]"
                >
                  {columns.map((col) => {
                    const widthStyle = col.isFlex
                      ? undefined
                      : { width: `${columnWidths[col.id] || col.width || 160}px` };

                    return (
                      <td
                        key={col.id}
                        role="cell"
                        style={widthStyle}
                        className={`flex max-md:w-full max-md:h-auto max-md:py-1 max-md:justify-between items-center shrink-0 md:h-[40px] ${col.isFlex ? 'md:flex-1' : ''} ${
                          col.className || 'px-3'
                        }`}
                      >
                        <span className="md:hidden text-[12px] text-[#888888] font-medium mr-4 select-none shrink-0 truncate">
                          {col.header}
                        </span>
                        <div className="h-3.5 max-md:flex-1 md:w-3/4 rounded-[4px] bg-[#16171d]/80 border border-[#1e2025]/40 animate-pulse" />
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : visibleData.length === 0 ? (
              // Empty State
              <tr role="row">
                <td role="cell" colSpan={columns.length} className="px-4 py-12 text-center bg-[#0e0e0e]">
                  <p className="text-[14px] leading-relaxed text-[#6b6b6b] font-normal">
                    {emptyMessage}
                  </p>
                </td>
              </tr>
            ) : (
              // Rows rendered from visibleData
              visibleData.map((row, rowIdx) => {
                const key = keyExtractor ? keyExtractor(row, rowIdx) : (row as { id?: string | number; name?: string }).id ?? (row as { name?: string }).name ?? rowIdx;
                return (
                  <tr
                    key={key}
                    role="row"
                    onClick={() => onRowClick && onRowClick(row, rowIdx)}
                    className={`group/row flex max-md:flex-col max-md:p-3.5 max-md:gap-2.5 w-full ${allowRowExpansion ? 'md:items-start h-auto min-h-[40px] max-h-none' : 'md:items-center h-auto md:h-[40px] md:min-h-[40px] md:max-h-[40px]'} border-b border-[#1e1e1e] bg-[#0e0e0e] hover:bg-[#161616] transition-colors duration-75 ${
                      onRowClick ? 'cursor-pointer' : ''
                    }`}
                  >
                    {columns.map((col) => {
                      const widthStyle = col.isFlex
                        ? undefined
                        : { width: `${columnWidths[col.id] || col.width || 160}px` };

                      return (
                        <td
                          key={col.id}
                          role="cell"
                          style={widthStyle}
                          className={`flex max-md:w-full max-md:h-auto max-md:py-1.5 ${
                            col.isFlex ? 'max-md:flex-col max-md:items-start max-md:gap-1' : 'max-md:justify-between max-md:items-center'
                          } shrink-0 md:items-center ${allowRowExpansion ? 'h-auto min-h-[40px]' : 'md:h-[40px]'} overflow-hidden min-w-0 ${
                            col.isFlex ? 'md:flex-1' : ''
                          } ${col.className || 'px-3'}`}
                        >
                          <span className="md:hidden text-[12px] text-[#888888] font-medium mr-4 select-none shrink-0 truncate">
                            {col.header}
                          </span>
                          <div className={`flex min-w-0 max-w-full overflow-hidden whitespace-nowrap ${col.isFlex ? 'w-full max-md:justify-start' : 'items-center max-md:justify-end'}`}>
                            {col.cell
                              ? col.cell(row, rowIdx)
                              : col.accessorKey
                              ? (
                                <span className="truncate whitespace-nowrap block min-w-0">
                                  {String(row[col.accessorKey] ?? '')}
                                </span>
                              )
                              : null}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {pagination && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[#222222] bg-[#0e0e0e] rounded-b-lg">
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[#8c8c8c] font-normal select-none">
              Showing{' '}
              <span className="text-[#cccccc] font-medium tabular-nums">
                {startItem}–{endItem}
              </span>{' '}
              of <span className="text-[#cccccc] font-medium tabular-nums">{totalCount}</span>
            </span>
            <div className="flex items-center gap-2 text-[12px] text-[#8c8c8c] select-none ml-2">
              <span>Rows:</span>
              <PageSizeDropdown
                pageSize={safePageSize}
                onChange={pagination.onPageSizeChange}
                options={pagination.pageSizeOptions}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 select-none">
            <button
              type="button"
              disabled={safePage <= 1 || isLoading}
              onClick={() => pagination.onPageChange(safePage - 1)}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-normal text-[#8c8c8c] hover:text-white hover:bg-[#161616] border border-[#262626] hover:border-[#383838] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:border-[#262626] disabled:hover:text-[#8c8c8c] disabled:cursor-not-allowed transition-all cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#2f80ed]"
            >
              <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
              <span>Previous</span>
            </button>

            <span className="text-[12px] text-[#8c8c8c] font-normal px-2">
              Page <span className="text-[#cccccc] font-medium tabular-nums">{safePage}</span> of <span className="text-[#cccccc] font-medium tabular-nums">{totalPages}</span>
            </span>

            <button
              type="button"
              disabled={safePage >= totalPages || isLoading}
              onClick={() => pagination.onPageChange(safePage + 1)}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-normal text-[#8c8c8c] hover:text-white hover:bg-[#161616] border border-[#262626] hover:border-[#383838] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:border-[#262626] disabled:hover:text-[#8c8c8c] disabled:cursor-not-allowed transition-all cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#2f80ed]"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

