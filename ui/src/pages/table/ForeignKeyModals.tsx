/*
 * Foreign key popover preview and picker modals:
 * - ForeignKeyRecordPreviewPopover: Popover displaying foreign row preview when clicking FK arrow badge
 * - ForeignKeyPickerModal: SlideOver modal allowing search, pagination, and single selection of referenced rows
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../api/client, ../../types, ../../components/ui/SlideOver, ./format
 * Invariants: Single selected value, keyboard dismiss, strict bounds checking.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  RefreshCw,
  Search,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  AlertCircle,
  Key,
  Link2,
  Code2,
} from "lucide-react";
import { api } from "../../api/client";
import { ColumnInfoApi, ForeignKeyInfoApi } from "../../types";
import { SlideOver } from "../../components/ui/SlideOver";
import { CustomSelect } from "../../components/shared/CustomSelect";
import { getDefaultColumnWidth } from "./format";

export interface ForeignKeyRecordPreviewPopoverProps {
  db: string;
  fk: ForeignKeyInfoApi;
  currentValue: unknown;
  anchorRect: { top: number; left: number; width: number; height: number };
  onClose: () => void;
  onOpenTable: (table: string, column?: string, value?: unknown) => void;
}

export function ForeignKeyRecordPreviewPopover({
  db,
  fk,
  currentValue,
  anchorRect,
  onClose,
  onOpenTable,
}: ForeignKeyRecordPreviewPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<ColumnInfoApi[]>([]);
  const [row, setRow] = useState<Record<string, unknown>>({});
  const [hasRecord, setHasRecord] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const schemaRes = await api.getTableSchema(db, fk.referenced_table);
        if (!isMounted) return;
        const cols = schemaRes.columns || [];
        setColumns(cols);

        if (
          currentValue === null ||
          currentValue === undefined ||
          currentValue === ""
        ) {
          setHasRecord(false);
          setRow({});
          return;
        }

        const filter = JSON.stringify({
          [fk.referenced_column]: { eq: currentValue },
        });

        const rowsRes = await api.getTableRows(db, fk.referenced_table, {
          limit: 1,
          filter,
        });
        if (!isMounted) return;

        if (rowsRes.rows && rowsRes.rows.length > 0) {
          setRow(rowsRes.rows[0]);
          setHasRecord(true);
        } else {
          setHasRecord(false);
          setRow({});
        }
      } catch (err) {
        if (!isMounted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load referenced record",
        );
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, [db, fk.referenced_table, fk.referenced_column, currentValue]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const popoverWidth = Math.min(
    440,
    typeof window !== "undefined" ? window.innerWidth - 32 : 440,
  );
  const anchorBottom = anchorRect.top + anchorRect.height;
  const spaceBelow = window.innerHeight - anchorBottom;
  const openUpward = spaceBelow < 220 && anchorRect.top > 220;
  const top = openUpward ? anchorRect.top - 185 : anchorBottom + 6;
  let left = anchorRect.left - 20;
  if (left + popoverWidth > window.innerWidth - 16) {
    left = window.innerWidth - popoverWidth - 16;
  }
  if (left < 16) left = 16;

  return (
    <div
      ref={popoverRef}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${popoverWidth}px`,
      }}
      className="fixed z-50 rounded-[10px] border border-[#222222] bg-[#111111] shadow-[0_20px_50px_rgba(0,0,0,0.95)] px-[6px] py-3.5 flex flex-col font-sans overflow-hidden animate-in fade-in zoom-in-95 duration-100 select-text max-w-[calc(100vw-32px)]"
    >
      <div className="text-[13px] text-[#a1a1a1] font-sans flex items-center gap-1.5 pb-1">
        <span>Referencing record from</span>
        <span className="font-semibold text-white tracking-tight">
          {fk.referenced_table}:
        </span>
      </div>

      <div className="border border-[#222222] rounded-[8px] overflow-hidden bg-[#181818] mt-2 shadow-inner">
        {isLoading ? (
          <div className="p-6 flex items-center justify-center gap-2 text-center text-[#888888] text-[13px] font-sans">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#888888]" />
            <span>Loading reference...</span>
          </div>
        ) : error ? (
          <div className="p-4 text-center text-rose-400 text-[12.5px] font-sans">
            {error}
          </div>
        ) : (
          <div className="overflow-x-auto max-w-full">
            <table className="table-auto min-w-full border-collapse text-left font-sans text-[13.5px]">
              <thead>
                <tr className="bg-[#141414] border-b border-[#222222] text-[#888888]">
                  {columns.map((col) => (
                    <th
                      key={col.name}
                      className="px-3.5 py-2 font-medium whitespace-nowrap border-r border-[#222222] last:border-r-0 text-[12.5px]"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[#999999]">{col.name}</span>
                        {col.primary_key && (
                          <Key className="w-3 h-3 text-amber-400" />
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hasRecord ? (
                  <tr className="hover:bg-[#1c1c1c] transition-colors">
                    {columns.map((col) => {
                      const val = row[col.name];
                      const isNull = val === null || val === undefined;
                      const str = isNull ? "null" : String(val);
                      return (
                        <td
                          key={col.name}
                          className="px-3.5 py-2 whitespace-nowrap font-sans text-[13.5px] border-r border-[#222222] last:border-r-0 text-white font-medium"
                        >
                          {isNull ? (
                            <span className="text-[#555555] italic font-normal">
                              null
                            </span>
                          ) : (
                            str
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ) : (
                  <tr>
                    <td
                      colSpan={Math.max(1, columns.length)}
                      className="p-5 text-center text-[#777777] text-[13px] font-sans"
                    >
                      No referenced record found for this value.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between select-none">
        <button
          type="button"
          onClick={onClose}
          className="text-[12.5px] text-[#888888] hover:text-white transition-colors cursor-pointer font-sans px-1 py-1"
        >
          Close
        </button>
        <button
          type="button"
          onClick={() =>
            onOpenTable(fk.referenced_table, fk.referenced_column, currentValue)
          }
          className="h-7 px-3.5 rounded-[5px] border border-[#2e2e2e] bg-[#1e1e1e] hover:bg-[#282828] text-white text-[12px] font-medium font-sans transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
        >
          <span>Open table</span>
        </button>
      </div>
    </div>
  );
}

export interface ForeignKeyPickerModalProps {
  db: string;
  fk: ForeignKeyInfoApi;
  currentValue: unknown;
  onSelect: (val: unknown) => void;
  onClose: () => void;
}

export function ForeignKeyPickerModal({
  db,
  fk,
  currentValue,
  onSelect,
  onClose,
}: ForeignKeyPickerModalProps) {
  const [refColumns, setRefColumns] = useState<ColumnInfoApi[]>([]);
  const [refRows, setRefRows] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [pageSize, setPageSize] = useState<number>(25);
  const [showPageSizePopover, setShowPageSizePopover] = useState(false);
  const pageSizePopoverRef = useRef<HTMLDivElement>(null);
  const [showSortPopover, setShowSortPopover] = useState(false);
  const sortPopoverRef = useRef<HTMLDivElement>(null);
  const [selectedRecordVal, setSelectedRecordVal] =
    useState<unknown>(currentValue);

  useEffect(() => {
    if (!showSortPopover && !showPageSizePopover) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        sortPopoverRef.current &&
        !sortPopoverRef.current.contains(e.target as Node)
      ) {
        setShowSortPopover(false);
      }
      if (
        pageSizePopoverRef.current &&
        !pageSizePopoverRef.current.contains(e.target as Node)
      ) {
        setShowPageSizePopover(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [showSortPopover, showPageSizePopover]);

  const loadData = useCallback(
    async (targetCursor?: string | null, sizeOverride?: number) => {
      setIsLoading(true);
      setError(null);
      try {
        const schemaRes = await api.getTableSchema(db, fk.referenced_table);
        setRefColumns(schemaRes.columns || []);

        const effectiveLimit = sizeOverride || pageSize;
        const rowsRes = await api.getTableRows(db, fk.referenced_table, {
          limit: effectiveLimit,
          cursor: targetCursor || undefined,
          sort: sortCol || undefined,
          order: sortOrder,
        });
        setRefRows(rowsRes.rows || []);
        setHasNextPage(!!rowsRes.pagination?.has_more);
        setCursor(rowsRes.pagination?.next_cursor || null);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load referenced table",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [db, fk.referenced_table, sortCol, sortOrder, pageSize],
  );

  useEffect(() => {
    loadData(null);
  }, [loadData]);

  const handleNext = () => {
    if (!cursor) return;
    setCursorHistory((prev) => [...prev, cursor]);
    loadData(cursor);
  };

  const handlePrev = () => {
    if (cursorHistory.length === 0) return;
    const newHistory = [...cursorHistory];
    newHistory.pop();
    const prevCursor = newHistory[newHistory.length - 1] || null;
    setCursorHistory(newHistory);
    loadData(prevCursor);
  };

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return refRows;
    const q = searchTerm.toLowerCase();
    return refRows.filter((r) =>
      Object.values(r).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [refRows, searchTerm]);

  return (
    <SlideOver
      isOpen={true}
      onClose={onClose}
      zIndex="z-[60]"
      width="w-[840px] xl:w-[940px] max-w-full"
      title={
        <div className="flex items-center gap-2 truncate">
          <span className="text-[16px] font-medium text-white font-sans">
            Select record to reference
          </span>
          <code className="px-2 py-0.5 rounded-[5px] bg-[#161616] border border-[#2a2a2a] text-[13px] font-mono text-[#e0e0e0]">
            {fk.referenced_table}
          </code>
        </div>
      }
      subtitle={
        <span className="text-[13px] text-[#8c8c8c] font-sans">
          Referencing{" "}
          <code className="text-[#cccccc] font-mono">
            {fk.referenced_column}
          </code>{" "}
          for column{" "}
          <code className="text-[#cccccc] font-mono">{fk.column}</code>
        </span>
      }
    >
      <div className="flex-1 flex flex-col min-h-0 bg-[#0e0e0e] overflow-hidden font-sans">
        {/* Main Table Styled Toolbar */}
        <div className="px-4 sm:px-5 py-2.5 flex items-center justify-between border-b border-[#222222] bg-[#0a0a0a] select-none shrink-0 gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#666666]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search rows..."
                className="h-8 pl-8 pr-7 w-48 sm:w-56 rounded-[6px] bg-[#121212] border border-[#262626] focus:border-[#3b82f6] text-[13px] text-white placeholder-[#555555] outline-none transition-colors"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#666666] hover:text-white cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Sort Popover Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSortPopover(!showSortPopover)}
                className={`flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] border text-[13px] font-medium transition-colors cursor-pointer ${
                  sortCol
                    ? "bg-blue-600/10 border-blue-500/30 text-blue-400 hover:bg-blue-600/20"
                    : "bg-[#141414] border-[#262626] text-[#cccccc] hover:text-white hover:border-[#383838]"
                }`}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span>{sortCol ? `Sort: ${sortCol}` : "Sort"}</span>
              </button>

              {showSortPopover && (
                <div
                  ref={sortPopoverRef}
                  className="absolute left-0 top-full mt-1.5 w-64 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-3 z-50 font-sans"
                >
                  <div className="text-[13px] font-semibold text-white mb-2.5">
                    Sort Records
                  </div>
                  <div className="space-y-2.5">
                    <CustomSelect
                      size="sm"
                      value={sortCol || ""}
                      onChange={(val) => setSortCol(val || null)}
                      placeholder="Select column..."
                      options={[
                        { value: "", label: "Select column..." },
                        ...refColumns.map((c) => ({
                          value: c.name,
                          label: c.name,
                        })),
                      ]}
                      menuWidth="w-full"
                    />

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSortOrder("asc")}
                        className={`flex-1 h-8 rounded-[6px] text-[12px] font-medium border transition-colors cursor-pointer ${
                          sortOrder === "asc"
                            ? "bg-[#1d4ed8]/20 border-[#3b82f6]/50 text-[#60a5fa]"
                            : "bg-[#141414] border-[#2c2c2c] text-[#8c8c8c] hover:border-[#383838] hover:text-white"
                        }`}
                      >
                        ASC
                      </button>
                      <button
                        type="button"
                        onClick={() => setSortOrder("desc")}
                        className={`flex-1 h-8 rounded-[6px] text-[12px] font-medium border transition-colors cursor-pointer ${
                          sortOrder === "desc"
                            ? "bg-[#1d4ed8]/20 border-[#3b82f6]/50 text-[#60a5fa]"
                            : "bg-[#141414] border-[#2c2c2c] text-[#8c8c8c] hover:border-[#383838] hover:text-white"
                        }`}
                      >
                        DESC
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setSortCol(null);
                          setShowSortPopover(false);
                          loadData(null);
                        }}
                        className="text-[12px] font-medium text-[#8c8c8c] hover:text-white transition-colors cursor-pointer"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSortPopover(false);
                          loadData(null);
                        }}
                        className="px-2.5 py-1 bg-[#222222] hover:bg-[#2a2a2a] border border-[#333333] rounded-[6px] text-[12px] font-medium text-white transition-colors cursor-pointer"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => loadData(null)}
              disabled={isLoading}
              title="Refresh rows"
              className="w-8 h-8 flex items-center justify-center rounded-[6px] bg-[#141414] border border-[#262626] text-[#8c8c8c] hover:text-white hover:border-[#383838] transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
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
                    showPageSizePopover ? "rotate-180 text-white" : ""
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
                        setCursorHistory([]);
                        loadData(null, sz);
                        setShowPageSizePopover(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors cursor-pointer font-sans ${
                        pageSize === sz
                          ? "bg-blue-600/15 text-blue-400 font-medium"
                          : "text-[#cccccc] hover:bg-[#1a1a1a] hover:text-white"
                      }`}
                    >
                      <span>{sz}</span>
                      {pageSize === sz && (
                        <Check className="w-3.5 h-3.5 text-blue-400" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handlePrev}
              disabled={cursorHistory.length === 0 || isLoading}
              className="flex items-center gap-1 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] disabled:opacity-40 hover:text-white hover:border-[#383838] transition-colors cursor-pointer"
              title="Previous page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span className="text-[13px] font-medium">Previous</span>
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!hasNextPage || isLoading}
              className="flex items-center gap-1 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] disabled:opacity-40 hover:text-white hover:border-[#383838] transition-colors cursor-pointer"
              title="Next page"
            >
              <span className="text-[13px] font-medium">Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Main Table Styled Grid */}
        <div className="flex-1 overflow-auto bg-[#0a0a0a]">
          {isLoading && refRows.length === 0 ? (
            <div className="p-4 space-y-2 animate-pulse">
              <div className="h-9 bg-[#161616] rounded-[6px]" />
              <div className="h-9 bg-[#141414] rounded-[6px]" />
              <div className="h-9 bg-[#161616] rounded-[6px]" />
              <div className="h-9 bg-[#141414] rounded-[6px]" />
              <div className="h-9 bg-[#161616] rounded-[6px]" />
            </div>
          ) : error ? (
            <div className="p-8 flex flex-col items-center justify-center text-center">
              <AlertCircle className="w-8 h-8 text-rose-500 mb-2" />
              <p className="text-[14px] font-medium text-white mb-1">
                Failed to query table
              </p>
              <p className="text-[12.5px] text-[#8c8c8c] max-w-md font-mono">
                {error}
              </p>
              <button
                type="button"
                onClick={() => loadData(null)}
                className="mt-4 px-3 py-1.5 bg-[#141414] border border-[#262626] rounded-[6px] text-[12px] text-white hover:border-[#383838] cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="p-12 text-center text-[#777777] text-[14px]">
              No records found in table{" "}
              <span className="font-sans font-medium text-white">
                {fk.referenced_table}
              </span>
            </div>
          ) : (
            <table
              className="border-collapse text-left select-text font-sans text-[14px] table-fixed"
              style={{ width: "max-content", minWidth: "100%" }}
            >
              <thead>
                <tr className="sticky top-0 z-10 bg-[#0a0a0a] border-b border-[#222222]">
                  <th
                    className="w-12 px-3 py-2 text-center bg-[#0a0a0a] sticky left-0 z-20 border-r border-[#1a1a1a] select-none text-[12px] font-mono text-[#666666]"
                    style={{
                      width: "48px",
                      minWidth: "48px",
                      maxWidth: "48px",
                    }}
                  >
                    #
                  </th>

                  {refColumns.map((col) => {
                    const width = getDefaultColumnWidth(col.type, col.name);
                    return (
                      <th
                        key={col.name}
                        className="relative px-3 py-2 text-[14px] font-medium text-[#cccccc] whitespace-nowrap border-r border-[#1a1a1a] select-none"
                        style={{
                          width: `${width}px`,
                          minWidth: `${Math.max(80, width)}px`,
                          maxWidth: `${width}px`,
                        }}
                      >
                        <div className="flex items-center gap-1.5 min-w-0 pr-2.5 overflow-hidden whitespace-nowrap">
                          <span
                            className="font-sans text-white text-[14px] whitespace-nowrap shrink-0"
                            title={col.name}
                          >
                            {col.name}
                          </span>
                          {col.primary_key && (
                            <span
                              title="Primary Key"
                              className="shrink-0 p-0.5 rounded bg-emerald-500/10 text-emerald-400"
                            >
                              <Key className="w-3 h-3" />
                            </span>
                          )}
                          {col.name === fk.referenced_column &&
                            !col.primary_key && (
                              <span
                                title="Referenced Column"
                                className="shrink-0 p-0.5 rounded bg-blue-500/10 text-blue-400"
                              >
                                <Link2 className="w-3 h-3" />
                              </span>
                            )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody className="divide-y divide-[#181818]">
                {filteredRows.map((r, ri) => {
                  const refVal = r[fk.referenced_column];
                  const isSelected =
                    selectedRecordVal !== undefined &&
                    String(refVal) === String(selectedRecordVal);

                  return (
                    <tr
                      key={ri}
                      onClick={() => setSelectedRecordVal(refVal)}
                      onDoubleClick={() => onSelect(refVal)}
                      className={`transition-colors cursor-pointer group ${
                        isSelected
                          ? "bg-[#131b2e] ring-1 ring-inset ring-blue-500/40 text-white"
                          : "hover:bg-[#121212]"
                      }`}
                    >
                      <td
                        className={`px-3 py-2 text-center select-none sticky left-0 z-10 border-r border-[#1a1a1a] transition-colors ${
                          isSelected
                            ? "bg-[#131b2e]"
                            : "bg-[#0a0a0a] group-hover:bg-[#121212]"
                        }`}
                        style={{
                          width: "48px",
                          minWidth: "48px",
                          maxWidth: "48px",
                        }}
                      >
                        <div className="flex items-center justify-center">
                          <div
                            className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                              isSelected
                                ? "bg-blue-600 border-blue-500 text-white shadow-xs"
                                : "border-[#333333] bg-[#141414] group-hover:border-[#555555]"
                            }`}
                          >
                            {isSelected && (
                              <div className="w-1.5 h-1.5 rounded-full bg-white" />
                            )}
                          </div>
                        </div>
                      </td>

                      {refColumns.map((col) => {
                        const width = getDefaultColumnWidth(col.type, col.name);
                        const cellVal = r[col.name];
                        const isNull =
                          cellVal === null || cellVal === undefined;
                        const isBool = typeof cellVal === "boolean";
                        const isObj =
                          typeof cellVal === "object" && cellVal !== null;
                        const strVal = isNull
                          ? "null"
                          : isObj
                            ? JSON.stringify(cellVal)
                            : String(cellVal);

                        return (
                          <td
                            key={col.name}
                            className="px-3 py-2 text-[#cccccc] text-[14px] whitespace-nowrap overflow-hidden border-r border-[#151515] relative transition-colors select-none"
                            style={{
                              width: `${width}px`,
                              minWidth: `${width}px`,
                              maxWidth: `${width}px`,
                            }}
                            title={strVal}
                          >
                            {isNull ? (
                              <span className="text-[#555555] italic text-[12.5px]">
                                null
                              </span>
                            ) : isBool ? (
                              <span className="font-sans text-[13px] text-[#cccccc]">
                                {String(cellVal)}
                              </span>
                            ) : isObj ? (
                              <span className="text-pink-400 flex items-center gap-1 text-[12.5px]">
                                <Code2 className="w-3.5 h-3.5" />
                                {`{ ... }`}
                              </span>
                            ) : (
                              <span
                                className={`truncate ${
                                  col.name === fk.referenced_column &&
                                  isSelected
                                    ? "font-medium text-blue-400"
                                    : ""
                                }`}
                              >
                                {strVal}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Toolbar with Apply Button */}
        <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-between font-sans shrink-0">
          <div className="flex items-center gap-2 text-[13px] text-[#888888]">
            <span>
              Selected{" "}
              <span className="text-[#cccccc]">{fk.referenced_column}</span>:{" "}
              <code className="text-white font-mono bg-[#161616] px-1.5 py-0.5 rounded border border-[#262626]">
                {selectedRecordVal !== undefined && selectedRecordVal !== null
                  ? String(selectedRecordVal)
                  : "None"}
              </code>
            </span>
            <span className="text-[#444444]">·</span>
            <span>{filteredRows.length} records</span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedRecordVal === undefined}
              onClick={() => {
                if (selectedRecordVal !== undefined) {
                  onSelect(selectedRecordVal);
                }
              }}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] disabled:opacity-40 disabled:cursor-not-allowed font-sans"
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
                Select Record
              </span>
            </button>
          </div>
        </div>
      </div>
    </SlideOver>
  );
}
