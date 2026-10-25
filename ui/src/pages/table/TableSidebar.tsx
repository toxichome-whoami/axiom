/*
 * Table Navigator / Database Sidebar subcomponent.
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../types, ../../api/client
 */

import React, { useRef, useEffect, useState } from "react";
import {
  Database,
  ChevronDown,
  Check,
  RefreshCw,
  Search,
  Table as TableIcon,
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { DatabaseRecordApi } from "../../api/client";
import { TableInfoApi } from "../../types";

export interface TableSidebarProps {
  databases: DatabaseRecordApi[];
  selectedDb: string;
  onSelectDb: (alias: string) => void;
  tables: TableInfoApi[];
  selectedTable: string;
  onSelectTable: (tableName: string) => void;
  tableSearch: string;
  setTableSearch: (search: string) => void;
  isTablesLoading: boolean;
  onRefreshTables: () => void;
  onCreateTable?: () => void;
  onEditTable?: (tableName: string) => void;
  onDeleteTable?: (tableName: string) => void;
}

export function TableSidebar({
  databases,
  selectedDb,
  onSelectDb,
  tables,
  selectedTable,
  onSelectTable,
  tableSearch,
  setTableSearch,
  isTablesLoading,
  onRefreshTables,
  onCreateTable,
  onEditTable,
  onDeleteTable,
}: TableSidebarProps) {
  const [isDbDropdownOpen, setIsDbDropdownOpen] = React.useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const dbDropdownRef = useRef<HTMLDivElement>(null);

  const [tableMenuState, setTableMenuState] = useState<{
    tableName: string;
    rect: DOMRect;
  } | null>(null);
  const tableMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (
        dbDropdownRef.current &&
        !dbDropdownRef.current.contains(e.target as Node)
      ) {
        setIsDbDropdownOpen(false);
      }
    };
    const handleClose = () => setIsDbDropdownOpen(false);
    document.addEventListener("mousedown", handleOutside);
    window.addEventListener("resize", handleClose);
    window.addEventListener("scroll", handleClose, true);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("resize", handleClose);
      window.removeEventListener("scroll", handleClose, true);
    };
  }, []);

  useEffect(() => {
    if (!tableMenuState) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        tableMenuRef.current &&
        !tableMenuRef.current.contains(e.target as Node)
      ) {
        setTableMenuState(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTableMenuState(null);
    };
    document.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [tableMenuState]);

  const filteredTables = tables.filter((t) =>
    t.name.toLowerCase().includes(tableSearch.toLowerCase()),
  );

  return (
    <aside
      className={`w-full lg:w-64 shrink-0 flex flex-col bg-[#0a0a0a] border-b lg:border-b-0 lg:border-r border-[#222222] font-sans relative ${isDbDropdownOpen ? "z-50" : "z-30"}`}
    >
      {/* Database Dropdown Selector Header (h-[54px] matching StoragePage) */}
      <div
        className={`h-[54px] shrink-0 px-3 border-b border-[#222222] flex items-center justify-between gap-2 relative ${isDbDropdownOpen ? "z-50" : "z-30"}`}
      >
        <div className="relative flex-1 min-w-0" ref={dbDropdownRef}>
          <button
            type="button"
            onClick={() => setIsDbDropdownOpen(!isDbDropdownOpen)}
            className="w-full h-8 px-2.5 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] flex items-center justify-between gap-2 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 truncate min-w-0">
              <Database className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="text-[13px] font-medium text-white truncate">
                {selectedDb || "Select Database"}
              </span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-[#777777] shrink-0" />
          </button>

          {/* Dropdown Popup */}
          {isDbDropdownOpen &&
            (() => {
              const rect = dbDropdownRef.current?.getBoundingClientRect();
              const top = (rect?.bottom ?? 0) + 6;
              const popoverWidth = Math.min(240, window.innerWidth - 32);
              const left = Math.max(
                16,
                Math.min(
                  window.innerWidth - popoverWidth - 16,
                  rect?.left ?? 16,
                ),
              );
              return (
                <div
                  style={{
                    top: `${top}px`,
                    left: `${left}px`,
                    width: `${popoverWidth}px`,
                  }}
                  className="fixed bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans"
                >
                  <div className="px-2.5 py-1.5 text-[12px] font-medium text-[#888888] select-none">
                    Database Connections
                  </div>

                  <div className="max-h-52 overflow-y-auto space-y-0.5 py-0.5">
                    {databases.length === 0 ? (
                      <div className="px-2.5 py-2 text-[12px] text-[#777777]">
                        No databases found
                      </div>
                    ) : (
                      databases.map((db) => {
                        const isActive = db.alias === selectedDb;
                        return (
                          <button
                            key={db.alias}
                            type="button"
                            onClick={() => {
                              onSelectDb(db.alias);
                              setIsDbDropdownOpen(false);
                            }}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors cursor-pointer text-left ${
                              isActive
                                ? "bg-[#1c1c1c] text-white font-medium"
                                : "text-[#d4d4d4] hover:text-white hover:bg-[#161616]"
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate min-w-0">
                              <Database
                                className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-blue-400" : "text-[#777777]"}`}
                              />
                              <span className="truncate">{db.alias}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-[#777777]">
                              <span className="font-mono">{db.engine}</span>
                              {isActive && (
                                <Check className="w-3.5 h-3.5 text-white shrink-0" />
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })()}
        </div>

        {/* Quick Reload Tables button */}
        <button
          type="button"
          onClick={onRefreshTables}
          disabled={isTablesLoading}
          title="Refresh table list"
          className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] transition-colors cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isTablesLoading ? "animate-spin" : ""}`}
          />
        </button>

        {/* Mobile expand/collapse toggle for tables list */}
        <button
          type="button"
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          title={isMobileOpen ? "Collapse Tables" : "Expand Tables"}
          aria-label={isMobileOpen ? "Collapse Tables" : "Expand Tables"}
          className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] lg:hidden transition-colors cursor-pointer shrink-0"
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${isMobileOpen ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {/* Live Search Input & Create Table button (collapsible on mobile) */}
      <div
        className={`p-2.5 items-center gap-1.5 ${isMobileOpen ? "flex" : "hidden lg:flex"}`}
      >
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 text-[#666666] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search tables..."
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            className="w-full h-8 pl-8 pr-2.5 bg-[#141414] border border-[#242424] focus:border-[#383838] rounded-[6px] text-[13px] text-white placeholder-[#666666] outline-none transition-colors"
          />
        </div>
        {onCreateTable && (
          <button
            type="button"
            onClick={onCreateTable}
            disabled={!selectedDb}
            title={
              selectedDb
                ? "Create table"
                : "Select a database first to create table"
            }
            className="w-8 h-8 flex items-center justify-center rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed group"
          >
            <Plus className="w-4 h-4 text-[#8c8c8c] group-hover:text-white transition-colors" />
          </button>
        )}
      </div>

      {/* Table Tree Items (collapsible on mobile) */}
      <div
        className={`flex-1 overflow-y-auto p-1.5 space-y-0.5 max-h-[45vh] lg:max-h-none ${isMobileOpen ? "block" : "hidden lg:block"}`}
      >
        {isTablesLoading && tables.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-zinc-500 text-[12px] gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Loading tables...
          </div>
        ) : filteredTables.length === 0 ? (
          <div className="p-8 text-center text-[#777777] text-[12px]">
            {tables.length === 0 ? "No tables in schema" : "No matching tables"}
          </div>
        ) : (
          filteredTables.map((t) => {
            const isSelected = selectedTable === t.name;
            const isMenuOpen = tableMenuState?.tableName === t.name;
            return (
              <div
                key={t.name}
                onClick={() => {
                  onSelectTable(t.name);
                  setIsMobileOpen(false);
                }}
                className={`group relative w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-left transition-colors cursor-pointer text-[14px] font-sans ${
                  isSelected
                    ? "bg-[#1a1a1a] text-white font-medium"
                    : "text-[#a1a1aa] hover:text-white hover:bg-[#141414]"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1 pr-1">
                  <TableIcon
                    className={`w-3.5 h-3.5 shrink-0 ${isSelected ? "text-white" : "text-[#777777] group-hover:text-[#a1a1aa]"}`}
                  />
                  <span className="font-sans text-[14px] truncate">
                    {t.name}
                  </span>
                </div>

                <button
                  type="button"
                  data-table-menu-trigger={t.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = (
                      e.currentTarget as HTMLElement
                    ).getBoundingClientRect();
                    setTableMenuState(
                      isMenuOpen ? null : { tableName: t.name, rect },
                    );
                  }}
                  title="Table options"
                  className={`w-6 h-6 flex items-center justify-center rounded-[4px] text-[#888888] hover:text-white hover:bg-[#262626] transition-opacity transition-colors cursor-pointer shrink-0 ${
                    isMenuOpen || isSelected
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Navigator Footer */}
      <div
        className={`h-12 shrink-0 px-3.5 border-t border-[#222222] items-center justify-between text-[12px] text-[#8c8c8c] select-none font-sans ${isMobileOpen ? "flex" : "hidden lg:flex"}`}
      >
        <span>{tables.length} tables</span>
      </div>

      {/* 3-dot Table Context Menu */}
      {tableMenuState && (
        <div
          ref={tableMenuRef}
          style={{
            top: `${Math.min(window.innerHeight - 100, tableMenuState.rect.bottom + 4)}px`,
            left: `${Math.min(window.innerWidth - 170, Math.max(8, tableMenuState.rect.right - 160))}px`,
            width: "160px",
          }}
          className="fixed z-50 bg-[#141414] border border-[#262626] rounded-[6px] shadow-2xl p-1 text-[13px] text-[#cccccc] animate-in fade-in zoom-in-95 duration-100 select-none font-sans"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              const target = tableMenuState.tableName;
              setTableMenuState(null);
              onEditTable?.(target);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] hover:bg-[#1f1f1f] hover:text-white transition-colors cursor-pointer text-left"
          >
            <Pencil className="w-3.5 h-3.5 text-[#888888]" />
            <span>Edit Table</span>
          </button>

          <div className="my-1 -mx-1 border-t border-[#222222]" />

          <button
            type="button"
            onClick={() => {
              const target = tableMenuState.tableName;
              setTableMenuState(null);
              onDeleteTable?.(target);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] text-rose-400 hover:bg-rose-950/30 hover:text-rose-300 transition-colors cursor-pointer text-left"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Table</span>
          </button>
        </div>
      )}
    </aside>
  );
}
