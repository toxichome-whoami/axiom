/*
 * Column Header Context Dropdown Menu subcomponent.
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../types, ./format
 */

import React, { useEffect, useRef } from "react";
import {
  ArrowUp,
  ArrowDown,
  Check,
  Copy,
  Edit3,
  ArrowUpDown,
  Trash2,
} from "lucide-react";
import { ColumnInfoApi, ForeignKeyInfoApi } from "../../types";
import { mapSqlTypeToFormValue } from "./format";

export interface ColumnContextMenuProps {
  activeColumnMenu: {
    col: ColumnInfoApi;
    rect: { top: number; left: number; width: number; height: number };
  };
  activeSort: { col: string; order: "asc" | "desc" } | null;
  foreignKeys: ForeignKeyInfoApi[];
  copiedKey: string | null;
  selectedDb: string;
  selectedTable: string;
  onClose: () => void;
  onSetSort: (sort: { col: string; order: "asc" | "desc" }) => void;
  onCopyName: (name: string) => void;
  onOpenEditColumn: (col: ColumnInfoApi) => void;
  onResetWidth: (colName: string) => void;
  onRequestDeleteColumn?: (col: ColumnInfoApi) => void;
}

export function ColumnContextMenu({
  activeColumnMenu,
  activeSort,
  foreignKeys,
  copiedKey,
  selectedDb,
  selectedTable,
  onClose,
  onSetSort,
  onCopyName,
  onOpenEditColumn,
  onResetWidth,
  onRequestDeleteColumn,
}: ColumnContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { col, rect } = activeColumnMenu;

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [onClose]);

  const menuWidth = 190;
  const top = Math.min(window.innerHeight - 280, rect.top + rect.height + 4);
  const left = Math.max(
    8,
    Math.min(
      window.innerWidth - menuWidth - 8,
      rect.left - menuWidth + rect.width,
    ),
  );

  const isAsc = activeSort?.col === col.name && activeSort?.order === "asc";
  const isDesc = activeSort?.col === col.name && activeSort?.order === "desc";

  return (
    <div
      ref={menuRef}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${menuWidth}px`,
      }}
      className="fixed z-50 rounded-[6px] border border-[#222222] bg-[#111111] shadow-[0_12px_32px_rgba(0,0,0,0.95)] p-1 flex flex-col font-sans select-none animate-in fade-in zoom-in-95 duration-75"
    >
      {/* 1. Sort Ascending */}
      <button
        type="button"
        onClick={() => {
          onSetSort({ col: col.name, order: "asc" });
          onClose();
        }}
        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[4px] text-[12.5px] font-sans transition-colors cursor-pointer text-left ${
          isAsc
            ? "bg-blue-600/15 text-blue-400 font-medium"
            : "text-[#cccccc] hover:text-white hover:bg-[#1a1a1a]"
        }`}
      >
        <ArrowUp className="w-3.5 h-3.5 shrink-0 opacity-80" />
        <span>Sort Ascending</span>
        {isAsc && <Check className="w-3 h-3 ml-auto text-blue-400" />}
      </button>

      {/* 2. Sort Descending */}
      <button
        type="button"
        onClick={() => {
          onSetSort({ col: col.name, order: "desc" });
          onClose();
        }}
        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[4px] text-[12.5px] font-sans transition-colors cursor-pointer text-left ${
          isDesc
            ? "bg-blue-600/15 text-blue-400 font-medium"
            : "text-[#cccccc] hover:text-white hover:bg-[#1a1a1a]"
        }`}
      >
        <ArrowDown className="w-3.5 h-3.5 shrink-0 opacity-80" />
        <span>Sort Descending</span>
        {isDesc && <Check className="w-3 h-3 ml-auto text-blue-400" />}
      </button>

      {/* Separator */}
      <div className="-mx-1 border-t border-[#222222] my-1" />

      {/* 3. Copy name */}
      <button
        type="button"
        onClick={() => {
          onCopyName(col.name);
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[4px] text-[12.5px] font-sans text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer text-left"
      >
        <Copy className="w-3.5 h-3.5 shrink-0 opacity-80" />
        <span>{copiedKey === col.name ? "Copied!" : "Copy name"}</span>
      </button>

      {/* 4. Edit column */}
      <button
        type="button"
        onClick={() => {
          onOpenEditColumn(col);
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[4px] text-[12.5px] font-sans text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer text-left"
      >
        <Edit3 className="w-3.5 h-3.5 shrink-0 opacity-80" />
        <span>Edit column</span>
      </button>

      {/* 5. Freeze / Reset Width */}
      <button
        type="button"
        onClick={() => {
          onResetWidth(col.name);
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[4px] text-[12.5px] font-sans text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer text-left"
      >
        <ArrowUpDown className="w-3.5 h-3.5 shrink-0 opacity-80" />
        <span>Reset width</span>
      </button>

      {/* 6. Destructive Delete Column (guarded separator) */}
      {onRequestDeleteColumn && (
        <>
          <div className="-mx-1 border-t border-[#222222] my-1" />
          <button
            type="button"
            onClick={() => {
              onRequestDeleteColumn(col);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[4px] text-[12.5px] font-sans text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer text-left"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0 opacity-80" />
            <span>Delete column</span>
          </button>
        </>
      )}
    </div>
  );
}
