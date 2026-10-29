/*
 * Context Menu component for Table Editor grid rows and cells.
 * Provides slick, shadcn-styled actions:
 * - Edit Cell / Open Inspector
 * - Copy Cell Value / Copy Row as JSON
 * - Set cell to NULL
 * - Delete Row
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react
 */

import React, { useEffect, useRef } from "react";
import { Copy, Edit3, Eye, Slash, Trash2 } from "lucide-react";

export interface GridContextMenuState {
  x: number;
  y: number;
  rowIndex: number;
  colName?: string;
  rawValue?: unknown;
  isReadOnly?: boolean;
}

export interface GridContextMenuProps {
  menu: GridContextMenuState | null;
  onClose: () => void;
  onEditCell: (rowIndex: number, colName: string) => void;
  onOpenRowDetails: (rowIndex: number) => void;
  onSetCellNull?: (rowIndex: number, colName: string) => void;
  onDeleteRow?: (rowIndex: number) => void;
  rowRecord?: Record<string, unknown>;
}

export function GridContextMenu({
  menu,
  onClose,
  onEditCell,
  onOpenRowDetails,
  onSetCellNull,
  onDeleteRow,
  rowRecord,
}: GridContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handleDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  // Viewport bounds detection
  const menuWidth = 190;
  const menuHeight = 175;
  const posX = Math.min(menu.x, window.innerWidth - menuWidth - 10);
  const posY = Math.min(menu.y, window.innerHeight - menuHeight - 10);

  const handleCopyValue = () => {
    if (menu.rawValue !== undefined) {
      const text =
        menu.rawValue === null
          ? "null"
          : typeof menu.rawValue === "object"
            ? JSON.stringify(menu.rawValue, null, 2)
            : String(menu.rawValue);
      navigator.clipboard.writeText(text);
    }
    onClose();
  };

  const handleCopyRowJson = () => {
    if (rowRecord) {
      navigator.clipboard.writeText(JSON.stringify(rowRecord, null, 2));
    }
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{ top: `${posY}px`, left: `${posX}px` }}
      className="fixed z-50 w-48 rounded-[6px] border border-[#222222] bg-[#111111] shadow-[0_12px_32px_rgba(0,0,0,0.95)] p-1 text-[12.5px] font-sans text-[#cccccc] animate-in fade-in zoom-in-95 duration-75 select-none"
    >
      {menu.colName && !menu.isReadOnly && (
        <button
          type="button"
          onClick={() => {
            onClose();
            onEditCell(menu.rowIndex, menu.colName!);
          }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] hover:bg-[#1c1c1c] hover:text-white transition-colors cursor-pointer"
        >
          <Edit3 className="w-3.5 h-3.5 text-[#888888]" />
          <span>Edit Cell</span>
        </button>
      )}

      {menu.colName && (
        <button
          type="button"
          onClick={handleCopyValue}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] hover:bg-[#1c1c1c] hover:text-white transition-colors cursor-pointer"
        >
          <Copy className="w-3.5 h-3.5 text-[#888888]" />
          <span>Copy Cell Value</span>
        </button>
      )}

      {menu.colName && onSetCellNull && !menu.isReadOnly && (
        <button
          type="button"
          onClick={() => {
            onClose();
            onSetCellNull(menu.rowIndex, menu.colName!);
          }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] hover:bg-[#1c1c1c] hover:text-white transition-colors cursor-pointer"
        >
          <Slash className="w-3.5 h-3.5 text-[#888888]" />
          <span>Set Cell to NULL</span>
        </button>
      )}

      <button
        type="button"
        onClick={handleCopyRowJson}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] hover:bg-[#1c1c1c] hover:text-white transition-colors cursor-pointer"
      >
        <Copy className="w-3.5 h-3.5 text-[#888888]" />
        <span>Copy Row as JSON</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenRowDetails(menu.rowIndex);
        }}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] hover:bg-[#1c1c1c] hover:text-white transition-colors cursor-pointer"
      >
        <Eye className="w-3.5 h-3.5 text-[#888888]" />
        <span>Inspect Row</span>
      </button>

      {onDeleteRow && (
        <>
          <div className="-mx-1 my-1 border-t border-[#222222]" />
          <button
            type="button"
            onClick={() => {
              onClose();
              onDeleteRow(menu.rowIndex);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors cursor-pointer text-left"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" />
            <span>Delete Row</span>
          </button>
        </>
      )}
    </div>
  );
}
