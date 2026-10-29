/*
 * Audit Log / Audit Trail administrative page.
 * Owned by: ui/audit
 * Key deps: DataTable, SlideOver, CustomSelect, lucide-react, ../api/client
 * Invariants: Read-only control plane audit logs; adheres to the Axiom design system (Inter font, normal text transforms, sleek modern aesthetic).
 */

import React, {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { DataTable, Column } from "../components/shared/DataTable";
import { SlideOver } from "../components/ui/SlideOver";
import { CustomSelect } from "../components/shared/CustomSelect";
import {
  History,
  Search,
  RefreshCw,
  Download,
  Check,
  Copy,
  AlertTriangle,
  ChevronDown,
  Eye,
} from "lucide-react";
import { api, AuditRecordApi } from "../api/client";
import { FilterRule, matchesRule } from "../utils/filters";

export type { FilterRule };

const FILTER_FIELD_OPTIONS = [
  { value: "action", label: "Action" },
  { value: "actor", label: "Actor" },
  { value: "target", label: "Target" },
  { value: "details", label: "Details" },
];

const DISPLAY_COLUMN_OPTIONS = [
  { id: "id", label: "Event ID" },
  { id: "timestamp", label: "Timestamp" },
  { id: "actor", label: "Actor" },
  { id: "action", label: "Action" },
  { id: "target", label: "Target" },
  { id: "details", label: "Details" },
];

function formatTimestamp(unixSec: number): string {
  if (!unixSec) return "—";
  try {
    const d = new Date(unixSec * 1000);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return String(unixSec);
  }
}

export function AuditLog() {
  const [records, setRecords] = useState<AuditRecordApi[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fetchGenRef = useRef(0);

  // Pagination State (persisted to localStorage)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("axiom_audit_page_size");
      if (saved) {
        const parsed = parseInt(saved, 10);
        if ([10, 25, 50, 100].includes(parsed)) {
          return parsed;
        }
      }
    } catch {
      // Ignore localStorage errors
    }
    return 25;
  });
  const [totalCount, setTotalCount] = useState(0);

  // Toolbar & Filtering State
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search input to avoid redundant requests while typing
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 250);
    return () => clearTimeout(handler);
  }, [searchQuery]);
  const [showFilters, setShowFilters] = useState(false);
  const filtersRef = useRef<HTMLDivElement | null>(null);

  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  const displayOptionsRef = useRef<HTMLDivElement | null>(null);

  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [appliedFilterRules, setAppliedFilterRules] = useState<FilterRule[]>(
    [],
  );

  // Export dropdown state
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);

  // Visible columns map (id hidden by default, others visible)
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({
    id: false,
    timestamp: true,
    actor: true,
    action: true,
    target: true,
    details: true,
  });

  // Selected Record Inspection SlideOver State
  const [selectedRecord, setSelectedRecord] = useState<AuditRecordApi | null>(
    null,
  );
  const [isCopiedJson, setIsCopiedJson] = useState(false);

  // Close popovers on click outside
  useEffect(() => {
    if (!showFilters && !showDisplayOptions && !showExportMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        showFilters &&
        filtersRef.current &&
        !filtersRef.current.contains(target)
      ) {
        setShowFilters(false);
      }
      if (
        showDisplayOptions &&
        displayOptionsRef.current &&
        !displayOptionsRef.current.contains(target)
      ) {
        setShowDisplayOptions(false);
      }
      if (
        showExportMenu &&
        exportRef.current &&
        !exportRef.current.contains(target)
      ) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showFilters, showDisplayOptions, showExportMenu]);

  // Load audit records from backend matching selected pageSize & page
  const loadAuditRecords = useCallback(
    async (
      targetPage = page,
      targetPageSize = pageSize,
      targetSearch = debouncedSearch,
    ) => {
      const curGen = ++fetchGenRef.current;
      setLoadError(null);
      try {
        const offset = (targetPage - 1) * targetPageSize;
        const res = await api.getAuditLog(
          targetPageSize,
          offset,
          undefined,
          targetSearch,
        );
        if (curGen !== fetchGenRef.current) return;
        setRecords(res.records || []);
        setTotalCount(res.total || 0);
      } catch (err: unknown) {
        if (curGen === fetchGenRef.current) {
          setLoadError(
            err instanceof Error
              ? err.message
              : "Failed to retrieve control-plane audit log",
          );
        }
      } finally {
        if (curGen === fetchGenRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [page, pageSize, debouncedSearch],
  );

  useEffect(() => {
    loadAuditRecords(page, pageSize, debouncedSearch);
  }, [page, pageSize, debouncedSearch]);

  // Reset pagination on search query or filter changes
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, appliedFilterRules, matchMode]);

  const handleAddRule = () => {
    const newId = String(Date.now());
    setFilterRules((prev) => [
      ...prev,
      {
        id: newId,
        field: FILTER_FIELD_OPTIONS[0].value,
        operator: "contains",
        value: "",
      },
    ]);
  };

  const handleRemoveRule = (id: string) => {
    setFilterRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleUpdateRule = (id: string, updates: Partial<FilterRule>) => {
    setFilterRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    );
  };

  const handleApplyFilters = () => {
    setAppliedFilterRules(filterRules.filter((r) => r.value.trim() !== ""));
    setShowFilters(false);
  };

  const handleClearFilters = () => {
    setFilterRules([]);
    setAppliedFilterRules([]);
    setShowFilters(false);
  };

  const toggleColVisibility = (colId: string) => {
    setVisibleCols((prev) => ({ ...prev, [colId]: !prev[colId] }));
  };

  const handleResetColumns = () => {
    setVisibleCols({
      id: false,
      timestamp: true,
      actor: true,
      action: true,
      target: true,
      details: true,
    });
  };

  // Filtered dataset
  const filteredRecords = useMemo(() => {
    let list = records;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          r.actor.toLowerCase().includes(q) ||
          r.action.toLowerCase().includes(q) ||
          r.target.toLowerCase().includes(q) ||
          (r.details && r.details.toLowerCase().includes(q)) ||
          String(r.id).includes(q),
      );
    }
    if (appliedFilterRules.length > 0) {
      list = list.filter((r) => {
        const tests = appliedFilterRules.map((rule) => {
          const val = String(
            (r as unknown as Record<string, unknown>)[rule.field] ?? "",
          );
          return matchesRule(val, rule.operator, rule.value);
        });
        return matchMode === "any" ? tests.some(Boolean) : tests.every(Boolean);
      });
    }
    return list;
  }, [records, searchQuery, appliedFilterRules, matchMode]);

  // Export handlers
  const handleExportCsv = () => {
    setShowExportMenu(false);
    if (filteredRecords.length === 0) return;
    const headers = ["id", "timestamp", "actor", "action", "target", "details"];
    const rows = filteredRecords.map((r) => [
      r.id,
      formatTimestamp(r.timestamp),
      `"${r.actor.replace(/"/g, '""')}"`,
      `"${r.action.replace(/"/g, '""')}"`,
      `"${r.target.replace(/"/g, '""')}"`,
      `"${(r.details || "").replace(/"/g, '""')}"`,
    ]);
    const csvContent = [
      headers.join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `axiom_audit_log_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    setShowExportMenu(false);
    if (filteredRecords.length === 0) return;
    const jsonStr = JSON.stringify(filteredRecords, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `axiom_audit_log_${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const copyDetailsJson = () => {
    if (!selectedRecord) return;
    let payload = selectedRecord.details || "{}";
    try {
      const parsed = JSON.parse(selectedRecord.details || "{}");
      payload = JSON.stringify(parsed, null, 2);
    } catch {
      // Keep as string
    }
    navigator.clipboard.writeText(payload);
    setIsCopiedJson(true);
    setTimeout(() => setIsCopiedJson(false), 2000);
  };

  // Columns definition for DataTable (Inter font, normal casing, tabular numbers)
  const columns: Column<AuditRecordApi>[] = [
    {
      id: "id",
      header: "ID",
      accessorKey: "id",
      width: 80,
      isResizable: true,
      className: "pl-4 pr-3",
      cell: (row) => (
        <span className="tabular-nums text-[13px] text-[#8c8c8c] truncate whitespace-nowrap block">
          #{row.id}
        </span>
      ),
    },
    {
      id: "timestamp",
      header: "Timestamp",
      accessorKey: "timestamp",
      isSortable: true,
      width: 180,
      isResizable: true,
      className: "pl-4 pr-3",
      cell: (row) => (
        <span
          className="tabular-nums text-[13px] text-[#8c8c8c] font-normal truncate whitespace-nowrap block"
          title={formatTimestamp(row.timestamp)}
        >
          {formatTimestamp(row.timestamp)}
        </span>
      ),
    },
    {
      id: "actor",
      header: "Actor",
      accessorKey: "actor",
      isSortable: true,
      isResizable: true,
      width: 170,
      className: "px-3",
      cell: (row) => (
        <span
          className="font-medium text-white text-[14px] truncate whitespace-nowrap block"
          title={row.actor}
        >
          {row.actor}
        </span>
      ),
    },
    {
      id: "action",
      header: "Action",
      accessorKey: "action",
      isSortable: true,
      isResizable: true,
      width: 180,
      className: "px-3",
      cell: (row) => (
        <span
          className="text-[14px] text-white font-normal truncate whitespace-nowrap block"
          title={row.action}
        >
          {row.action}
        </span>
      ),
    },
    {
      id: "target",
      header: "Target Resource",
      accessorKey: "target",
      isSortable: true,
      isResizable: true,
      width: 200,
      className: "px-3",
      cell: (row) => (
        <span
          className="text-[14px] text-[#cccccc] font-normal truncate whitespace-nowrap block"
          title={row.target}
        >
          {row.target || "—"}
        </span>
      ),
    },
    {
      id: "details",
      header: "Details",
      accessorKey: "details",
      width: 280,
      isResizable: true,
      className: "px-3",
      cell: (row) => {
        if (!row.details) {
          return (
            <span className="text-[13px] text-[#666666] font-normal italic">
              None
            </span>
          );
        }
        return (
          <div
            onClick={() => setSelectedRecord(row)}
            className="cursor-pointer group"
            title="Click to inspect details"
          >
            <span className="text-[13px] text-[#8c8c8c] group-hover:text-white truncate block max-w-[260px] transition-colors font-normal">
              {row.details}
            </span>
          </div>
        );
      },
    },
    {
      id: "actions",
      header: <span className="sr-only">Inspect</span>,
      isFlex: true,
      headerClassName: "justify-end pr-4 text-right",
      className: "pl-3 pr-4 justify-end",
      cell: (row) => (
        <div className="flex items-center justify-end gap-2 w-full">
          <button
            type="button"
            onClick={() => setSelectedRecord(row)}
            className="inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
            title="Inspect audit event details"
          >
            <Eye className="w-3.5 h-3.5" />
            Inspect
          </button>
        </div>
      ),
    },
  ];

  const activeColumns = useMemo(() => {
    const visible = columns.filter(
      (col) => col.id === "actions" || visibleCols[col.id] !== false,
    );
    const lastDataId = [...visible]
      .reverse()
      .find((c) => c.id !== "actions")?.id;
    return visible.map((col) => ({
      ...col,
      isResizable:
        col.id !== "actions" &&
        col.id !== lastDataId &&
        Boolean(col.isResizable),
    }));
  }, [columns, visibleCols]);

  return (
    <div className="space-y-6">
      {/* Top Header - simple, elegant, matching other pages */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-medium text-white tracking-tight">
            Audit Trail
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => {
              setIsRefreshing(true);
              loadAuditRecords();
            }}
            title="Refresh audit log"
            className="flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-white rounded-[8px] bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin opacity-50" : ""}`}
            />
          </button>

          {/* Export Dropdown */}
          <div className="relative" ref={exportRef}>
            <button
              type="button"
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[13px] font-medium text-[#cccccc] hover:text-white bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
              title="Export audit log"
            >
              <Download className="w-3.5 h-3.5 text-[#8c8c8c]" />
              <span>Export</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#666666]" />
            </button>

            {showExportMenu && (
              <div className="absolute right-0 top-[calc(100%+4px)] w-36 rounded-[8px] bg-[#0c0c0c] border border-[#262626] shadow-2xl p-1 z-50 select-none animate-in fade-in duration-100">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="w-full flex items-center px-3 py-2 rounded-[6px] text-[13px] text-[#cccccc] hover:text-white hover:bg-[#141414] transition-colors cursor-pointer text-left"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="w-full flex items-center px-3 py-2 rounded-[6px] text-[13px] text-[#cccccc] hover:text-white hover:bg-[#141414] transition-colors cursor-pointer text-left"
                >
                  Export JSON
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table Controls Toolbar (Search, Filters, Display Options) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 select-none">
        {/* Search input matching Database page */}
        <label
          title="Search audit log..."
          className="relative flex items-center h-9 rounded-[8px] bg-transparent border border-[#262626] focus-within:border-[#2f80ed] transition-colors px-3 gap-2 w-full sm:w-[260px] md:w-[320px]"
        >
          <Search className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search action, actor, target..."
            className="w-full bg-transparent border-0 text-[14px] text-white placeholder-[#8c8c8c] outline-none font-normal"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#222222] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer shrink-0"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filters dropdown button & popover */}
          <div className="relative" ref={filtersRef}>
            <button
              type="button"
              onClick={() => {
                setShowFilters((prev) => {
                  const next = !prev;
                  if (next) {
                    setShowDisplayOptions(false);
                    if (appliedFilterRules.length > 0) {
                      setFilterRules(appliedFilterRules.map((r) => ({ ...r })));
                    } else if (filterRules.length === 0) {
                      setFilterRules([
                        {
                          id: "1",
                          field: FILTER_FIELD_OPTIONS[0].value,
                          operator: "contains",
                          value: "",
                        },
                      ]);
                    }
                  }
                  return next;
                });
              }}
              className={`flex items-center gap-1.5 h-9 px-3 rounded-[8px] bg-transparent border text-[14px] font-medium transition-colors cursor-pointer shrink-0 font-sans ${
                showFilters || appliedFilterRules.length > 0
                  ? "border-[#444444] text-white bg-[#141414]"
                  : "border-[#262626] text-white hover:bg-[#141414] hover:border-[#383838]"
              }`}
              title="Filter audit records"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                fill="currentColor"
                viewBox="0 0 256 256"
                className="text-[#8c8c8c] shrink-0"
              >
                <path d="M230.6,49.53A15.81,15.81,0,0,0,216,40H40A16,16,0,0,0,28.19,66.76l.08.09L96,139.17V216a16,16,0,0,0,24.87,13.32l32-21.34A16,16,0,0,0,160,194.66V139.17l67.74-72.32.08-.09A15.8,15.8,0,0,0,230.6,49.53ZM40,56h0Zm106.18,74.58A8,8,0,0,0,144,136v58.66L112,216V136a8,8,0,0,0-2.16-5.47L40,56H216Z" />
              </svg>
              <span>Filters</span>
              {appliedFilterRules.length > 0 && (
                <span className="text-[12px] text-[#8c8c8c] font-normal">
                  ({appliedFilterRules.length})
                </span>
              )}
            </button>

            {showFilters && (
              <div className="absolute right-0 top-10 w-[540px] max-w-[calc(100vw-32px)] rounded-[8px] bg-[#0c0c0c] border border-[#262626] shadow-2xl p-4 z-50 select-none animate-in fade-in">
                {/* Header */}
                <div className="flex items-center justify-between pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-white">
                      Audit Filters
                    </span>
                    {filterRules.length >= 2 && (
                      <button
                        type="button"
                        onClick={() =>
                          setMatchMode((prev) =>
                            prev === "any" ? "all" : "any",
                          )
                        }
                        className="px-2.5 py-0.5 rounded text-[13px] text-[#cccccc] hover:text-white bg-[#141414] border border-[#2e2e2e] hover:border-[#444444] transition-colors cursor-pointer"
                      >
                        Match {matchMode === "any" ? "any (OR)" : "all (AND)"}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowFilters(false)}
                    className="text-[#888888] hover:text-white transition-colors cursor-pointer text-[14px] p-1 leading-none"
                    title="Close filters"
                  >
                    ✕
                  </button>
                </div>

                {/* Rules List */}
                <div
                  className={`space-y-2.5 ${filterRules.length > 3 ? "max-h-[320px] overflow-y-auto pr-0.5" : ""}`}
                >
                  {filterRules.map((rule) => (
                    <div key={rule.id} className="flex items-center gap-2">
                      <CustomSelect
                        value={rule.field}
                        options={FILTER_FIELD_OPTIONS}
                        onChange={(val) =>
                          handleUpdateRule(rule.id, { field: val })
                        }
                        className="w-32 sm:w-36 shrink-0"
                        menuWidth="w-40"
                      />

                      <CustomSelect
                        value={rule.operator}
                        options={[
                          { value: "contains", label: "contains" },
                          { value: "equals", label: "equals" },
                          { value: "starts_with", label: "starts with" },
                        ]}
                        onChange={(val) =>
                          handleUpdateRule(rule.id, {
                            operator: val as
                              "contains" | "equals" | "starts_with",
                          })
                        }
                        className="w-32 sm:w-36 shrink-0"
                        menuWidth="w-44"
                      />

                      <input
                        type="text"
                        value={rule.value}
                        onChange={(e) =>
                          handleUpdateRule(rule.id, { value: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleApplyFilters();
                        }}
                        placeholder="Filter value..."
                        className="flex-1 min-w-0 h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#2f80ed] text-[14px] text-white placeholder-[#555555] outline-none transition-colors"
                      />

                      <button
                        type="button"
                        onClick={() => handleRemoveRule(rule.id)}
                        className="w-8 h-8 flex items-center justify-center text-[#777777] hover:text-white cursor-pointer transition-colors shrink-0"
                        title="Delete filter rule"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="15"
                          height="15"
                          fill="currentColor"
                          viewBox="0 0 256 256"
                        >
                          <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>

                {/* Footer Controls */}
                <div className="flex items-center justify-between pt-2.5 mt-1">
                  <button
                    type="button"
                    onClick={handleAddRule}
                    className="text-[14px] text-white hover:text-[#2f80ed] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>+ Add filter</span>
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-[#666666]">
                      Press Enter to apply
                    </span>
                    {appliedFilterRules.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearFilters}
                        className="text-[14px] text-[#888888] hover:text-white transition-colors cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleApplyFilters}
                      className="group relative flex shrink-0 items-center justify-center h-8 px-3.5 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-50 overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb]"
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
                      />
                      <span className="relative flex items-center gap-1.5 text-[14px]">
                        Apply filters
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Display options dropdown matching Database page */}
          <div className="relative" ref={displayOptionsRef}>
            <button
              type="button"
              onClick={() => {
                setShowDisplayOptions((prev) => !prev);
                setShowFilters(false);
              }}
              className={`flex items-center gap-1.5 h-9 px-3 rounded-[8px] bg-transparent border text-[14px] font-medium transition-colors cursor-pointer shrink-0 font-sans ${
                showDisplayOptions
                  ? "border-[#444444] text-white bg-[#141414]"
                  : "border-[#262626] text-white hover:bg-[#141414] hover:border-[#383838]"
              }`}
              title="Toggle visible table columns"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                fill="currentColor"
                viewBox="0 0 256 256"
                className="text-[#8c8c8c] shrink-0"
              >
                <path d="M222.87,74.56,134.87,23.75a16,16,0,0,0-15.74,0L31.13,74.56A16,16,0,0,0,23.26,88.4v101.6a16,16,0,0,0,7.87,13.84l88,50.81a16,16,0,0,0,15.74,0l88-50.81a16,16,0,0,0,7.87-13.84V88.4A16,16,0,0,0,222.87,74.56ZM127,160a32,32,0,1,1,32-32A32,32,0,0,1,127,160Z" />
              </svg>
              <span>Display options</span>
            </button>

            {showDisplayOptions && (
              <div className="absolute right-0 top-[calc(100%+4px)] w-52 rounded-[6px] bg-[#111111] border border-[#222222] shadow-[0_12px_32px_rgba(0,0,0,0.95)] p-1 z-50 select-none font-sans animate-in fade-in zoom-in-95 duration-75">
                {DISPLAY_COLUMN_OPTIONS.map((col) => {
                  const isVisible = visibleCols[col.id] !== false;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => toggleColVisibility(col.id)}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[4px] text-[12.5px] text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer"
                    >
                      <span
                        className={
                          isVisible
                            ? "text-white font-medium"
                            : "text-[#8c8c8c]"
                        }
                      >
                        {col.label}
                      </span>
                      {isVisible && (
                        <Check className="w-3.5 h-3.5 text-[#3b82f6] shrink-0" />
                      )}
                    </button>
                  );
                })}
                <div className="-mx-1 my-1 border-t border-[#222222]" />
                <button
                  type="button"
                  onClick={handleResetColumns}
                  className="w-full text-left px-2.5 py-1.5 rounded-[4px] text-[12.5px] text-[#8c8c8c] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer"
                >
                  Reset columns
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {loadError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[#2a1113] border border-[#5c1d24] text-[#f87171] text-[13px]">
          <AlertTriangle className="w-4 h-4 shrink-0 text-[#ef4444]" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Audit Log DataTable */}
      <DataTable
        columns={activeColumns}
        data={filteredRecords}
        isLoading={isLoading}
        ariaLabel="Control Plane Audit Trail"
        emptyMessage="No audit log records found matching your filters."
        onRowClick={(row) => setSelectedRecord(row)}
        pagination={{
          page,
          pageSize,
          totalCount:
            appliedFilterRules.length > 0 ? filteredRecords.length : totalCount,
          onPageChange: (newPage) => {
            setPage(newPage);
          },
          onPageSizeChange: (newSize) => {
            setPageSize(newSize);
            setPage(1);
            try {
              localStorage.setItem("axiom_audit_page_size", String(newSize));
            } catch {
              // Ignore
            }
          },
          pageSizeOptions: [10, 25, 50, 100],
        }}
      />

      {/* Audit Event Details Inspector SlideOver */}
      <SlideOver
        isOpen={Boolean(selectedRecord)}
        onClose={() => {
          setSelectedRecord(null);
          setIsCopiedJson(false);
        }}
        title="Audit Event Details"
        subtitle={`Event #${selectedRecord?.id || ""} recorded at ${formatTimestamp(selectedRecord?.timestamp || 0)}`}
      >
        {selectedRecord && (
          <div className="flex-1 p-5 overflow-y-auto space-y-5">
            {/* Summary Grid */}
            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-[8px] bg-[#111111] border border-[#222222]">
              <div>
                <span className="text-[12px] font-medium text-[#8c8c8c] block">
                  Event ID
                </span>
                <span className="text-[14px] text-white mt-0.5 block tabular-nums">
                  #{selectedRecord.id}
                </span>
              </div>

              <div>
                <span className="text-[12px] font-medium text-[#8c8c8c] block">
                  Timestamp
                </span>
                <span className="text-[13px] text-white mt-0.5 block tabular-nums">
                  {formatTimestamp(selectedRecord.timestamp)}
                </span>
              </div>

              <div>
                <span className="text-[12px] font-medium text-[#8c8c8c] block">
                  Actor Identity
                </span>
                <span className="text-[14px] font-medium text-white mt-0.5 block">
                  {selectedRecord.actor}
                </span>
              </div>

              <div>
                <span className="text-[12px] font-medium text-[#8c8c8c] block">
                  Target Resource
                </span>
                <span
                  className="text-[13px] text-white mt-0.5 block truncate"
                  title={selectedRecord.target}
                >
                  {selectedRecord.target || "—"}
                </span>
              </div>
            </div>

            {/* Action */}
            <div>
              <span className="text-[12px] font-medium text-[#8c8c8c] mb-1 block">
                Action
              </span>
              <span className="text-[14px] text-white font-normal block">
                {selectedRecord.action}
              </span>
            </div>

            {/* Payload / Details Inspector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[13px] font-medium text-[#cccccc]">
                  Structured Event Payload
                </span>
                <button
                  type="button"
                  onClick={copyDetailsJson}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-[5px] text-[12px] font-medium text-[#8c8c8c] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] transition-colors cursor-pointer"
                  title="Copy JSON details to clipboard"
                >
                  {isCopiedJson ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Payload</span>
                    </>
                  )}
                </button>
              </div>

              <div className="rounded-[8px] bg-[#0c0c0c] border border-[#262626] p-3 overflow-x-auto max-h-[360px] scrollbar-thin scrollbar-thumb-[#222222]">
                <pre className="font-mono text-[12.5px] text-[#e4e4e7] leading-relaxed whitespace-pre-wrap break-all">
                  {(() => {
                    if (!selectedRecord.details)
                      return "// No details payload recorded";
                    try {
                      const parsed = JSON.parse(selectedRecord.details);
                      return JSON.stringify(parsed, null, 2);
                    } catch {
                      return selectedRecord.details;
                    }
                  })()}
                </pre>
              </div>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  );
}

export default AuditLog;
