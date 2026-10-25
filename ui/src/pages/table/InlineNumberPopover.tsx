/*
 * Inline single-line numeric popover editor for integer, decimal, float, and numeric columns.
 * Features:
 * - Single-line compact editor positioned precisely on the cell
 * - Up/Down keyboard stepping and increment/decrement buttons
 * - Numeric parsing and validation (integers, floats, negative numbers, decimals)
 * - Quick NULL toggle for nullable columns
 * - Enter commits, Esc cancels, outside click commits
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { ChevronUp, ChevronDown, Check, Maximize2 } from "lucide-react";
import { ColumnInfoApi } from "../../types";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";

export interface InlineNumberPopoverProps {
  editingCell: {
    rowIndex: number;
    colName: string;
    column?: ColumnInfoApi;
    initialValue: unknown;
    currentValue: string;
    rect: { top: number; left: number; width: number; height: number };
  };
  onChange: (val: string) => void;
  onSave: (val?: unknown) => void;
  onCancel: () => void;
  onExpand?: () => void;
}

export function InlineNumberPopover({
  editingCell,
  onChange,
  onSave,
  onCancel,
  onExpand,
}: InlineNumberPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const normType = editingCell.column?.type?.toLowerCase() || "";
  const isFloat =
    normType.includes("float") ||
    normType.includes("double") ||
    normType.includes("decimal") ||
    normType.includes("numeric") ||
    normType.includes("real");

  const step = isFloat ? 0.1 : 1;
  const isNullable = editingCell.column?.nullable ?? true;

  // Handle initial null or empty value
  const isInitialNull =
    editingCell.initialValue === null ||
    editingCell.initialValue === undefined ||
    editingCell.currentValue === "null" ||
    editingCell.currentValue === "";

  const [inputVal, setInputVal] = useState<string>(() => {
    if (isInitialNull && editingCell.initialValue === null) return "";
    return editingCell.currentValue;
  });

  const [isNull, setIsNull] = useState<boolean>(
    editingCell.initialValue === null && editingCell.currentValue === "",
  );

  useEffect(() => {
    if (inputRef.current && !isNull) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isNull]);

  // Baseline snapshot at mount to prevent false-positive dirty warnings
  const baselineValRef = useRef<string>(inputVal);
  const baselineNullRef = useRef<boolean>(isNull);
  const isDirty =
    isNull !== baselineNullRef.current ||
    (!isNull && inputVal.trim() !== baselineValRef.current.trim());
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const handleCommit = useCallback(
    (customVal?: string, forcedNull?: boolean) => {
      if (forcedNull ?? isNull) {
        onSave(null);
        return;
      }
      const raw = customVal !== undefined ? customVal : inputVal;
      const trimmed = raw.trim();
      if (trimmed === "" || trimmed.toLowerCase() === "null") {
        if (isNullable) {
          onSave(null);
        } else {
          onSave(isFloat ? 0.0 : 0);
        }
        return;
      }

      // Convert to number if valid, otherwise preserve string
      const parsedNum = Number(trimmed);
      if (!isNaN(parsedNum)) {
        onSave(parsedNum);
      } else {
        onSave(trimmed);
      }
    },
    [inputVal, isNull, isNullable, isFloat, onSave],
  );

  const handleAttemptClose = useCallback(() => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onCancel();
    }
  }, [isDirty, onCancel]);

  // Outside click prompts for discard if dirty, cancels if clean
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (showDiscardConfirm) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest('[role="dialog"]') ||
        target?.closest(".fixed.z-50.ConfirmDialog")
      )
        return;

      if (popoverRef.current && !popoverRef.current.contains(target as Node)) {
        handleAttemptClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [handleAttemptClose, showDiscardConfirm]);

  // Scroll outside prompts for discard if dirty
  useEffect(() => {
    const handleScroll = (e: Event) => {
      if (showDiscardConfirm) return;
      const target = e.target as Node;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        handleAttemptClose();
      }
    };
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [handleAttemptClose, showDiscardConfirm]);

  const stepValue = (direction: 1 | -1) => {
    setIsNull(false);
    const curNum = Number(inputVal);
    const base = isNaN(curNum) ? 0 : curNum;
    const nextNum = isFloat
      ? Math.round((base + direction * step) * 100) / 100
      : base + direction * step;
    const nextStr = String(nextNum);
    setInputVal(nextStr);
    onChange(nextStr);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      handleCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handleAttemptClose();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      stepValue(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      stepValue(-1);
    }
  };

  const toggleNull = () => {
    if (!isNullable) return;
    if (!isNull) {
      setIsNull(true);
      setInputVal("");
      onChange("");
    } else {
      setIsNull(false);
      setInputVal("0");
      onChange("0");
    }
  };

  // Safe popover positioning within viewport
  const popoverWidth = Math.max(
    380,
    Math.min(500, editingCell.rect.width + 120),
  );
  const left = Math.max(
    8,
    Math.min(window.innerWidth - popoverWidth - 16, editingCell.rect.left),
  );
  const top = Math.max(
    8,
    Math.min(window.innerHeight - 150 - 16, editingCell.rect.top),
  );

  return (
    <div
      ref={popoverRef}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${popoverWidth}px`,
      }}
      className="fixed z-50 rounded-[10px] border border-[#222222] bg-[#111111] shadow-[0_20px_50px_rgba(0,0,0,0.95)] px-[6px] py-2 flex flex-col font-sans animate-in fade-in zoom-in-95 duration-100 select-none"
    >
      {/* Top Header Bar */}
      <div className="flex items-center justify-between pb-2 px-1 select-none">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="text-[13.5px] font-sans font-medium text-[#e0e0e0] truncate"
            title={editingCell.colName}
          >
            {editingCell.colName}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[12px] text-[#666666] font-sans">
            {inputVal.length} ch
          </span>
          {isNullable && (
            <button
              type="button"
              onClick={toggleNull}
              className={`px-2 py-0.5 rounded-[4px] text-[12px] font-sans font-medium border transition-colors cursor-pointer ${
                isNull
                  ? "bg-[#1e1e1e] text-white border-[#333333] hover:bg-[#262626]"
                  : "bg-transparent text-[#888888] border-[#222222] hover:text-white hover:bg-[#181818]"
              }`}
            >
              NULL
            </button>
          )}
        </div>
      </div>

      {/* Recessed Inner Single-Line Field */}
      <div className="rounded-[8px] border border-[#222222] bg-[#181818] p-1 flex items-center shadow-inner transition-colors focus-within:border-[#383838]">
        {isNull ? (
          <div className="flex-1 px-2.5 py-1 text-[#666666] italic text-[13.5px] font-sans select-none">
            Cell value is NULL. Click "NULL" to edit.
          </div>
        ) : (
          <input
            ref={inputRef}
            type="text"
            inputMode={isFloat ? "decimal" : "numeric"}
            value={inputVal}
            onChange={(e) => {
              setIsNull(false);
              const v = e.target.value;
              setInputVal(v);
              onChange(v);
            }}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            placeholder="0"
            className="flex-1 min-w-0 bg-transparent px-2.5 py-1 text-[13.5px] font-sans text-white outline-none placeholder-[#555555]"
          />
        )}
      </div>

      {/* Bottom Actions Bar */}
      <div className="pt-2 pb-0.5 px-1 flex items-center justify-end gap-2 select-none">
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            title="Expand editor to drawer"
            className="w-7 h-7 rounded-[5px] border border-[#2a2a2a] bg-[#161616] hover:bg-[#202020] text-[#777777] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => handleCommit()}
          className="h-7 px-3.5 rounded-[5px] text-[12px] font-sans font-medium bg-[#1e1e1e] hover:bg-[#282828] text-white border border-[#2e2e2e] flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Check className="w-3.5 h-3.5 text-white stroke-[2.5]" />
          <span>Save</span>
        </button>
      </div>

      {/* Discard Warning Dialog */}
      <ConfirmDialog
        isOpen={showDiscardConfirm}
        title="Discard Unsaved Changes?"
        description="You have unsaved changes in this numeric field. Are you sure you want to discard them?"
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        variant="warning"
        onConfirm={() => {
          setShowDiscardConfirm(false);
          onCancel();
        }}
        onClose={() => setShowDiscardConfirm(false)}
      />
    </div>
  );
}
