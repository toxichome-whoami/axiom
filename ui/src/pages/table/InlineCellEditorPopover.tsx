/*
 * Inline popover cell editors for Table Editor grid cells:
 * - InlineNumberPopover: Single-line numeric popover editor with steppers and NULL support
 * - InlineTextPopover: Spacious multiline text editor with stats and keyboard shortcuts
 * - InlineJsonPopover: Dedicated JSON editor with syntax validation and auto-format
 * - InlineBooleanPopover: Fast boolean selection dropdown (true / false / null) with keyboard navigation
 * - InlineCellEditorPopover: Backwards-compatible text editor wrapper
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Check } from 'lucide-react';
import { ColumnInfoApi } from '../../types';

export { InlineNumberPopover, type InlineNumberPopoverProps } from './InlineNumberPopover';
export { InlineTextPopover, type InlineTextPopoverProps } from './InlineTextPopover';
export { InlineJsonPopover, type InlineJsonPopoverProps } from './InlineJsonPopover';

export interface InlineCellEditorPopoverProps {
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
  onExpand: () => void;
}

// Re-export text popover as the standard InlineCellEditorPopover for backwards compatibility
export { InlineTextPopover as InlineCellEditorPopover } from './InlineTextPopover';

export interface InlineBooleanPopoverProps {
  editingCell: {
    rowIndex: number;
    colName: string;
    column?: ColumnInfoApi;
    initialValue: unknown;
    currentValue: string;
    rect: { top: number; left: number; width: number; height: number };
  };
  onSave: (val: unknown) => void;
  onCancel: () => void;
}

export function InlineBooleanPopover({
  editingCell,
  onSave,
  onCancel,
}: InlineBooleanPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const isNullable = editingCell.column?.nullable ?? true;

  const options: Array<{ label: string; value: boolean | null; desc?: string }> = [
    { label: 'true', value: true },
    { label: 'false', value: false },
  ];
  if (isNullable) {
    options.push({ label: 'null', value: null });
  }

  const initialIndex = useMemo(() => {
    const raw = editingCell.initialValue;
    if (raw === true || editingCell.currentValue.toLowerCase() === 'true') return 0;
    if (raw === false || editingCell.currentValue.toLowerCase() === 'false') return 1;
    return isNullable ? 2 : 0;
  }, [editingCell.initialValue, editingCell.currentValue, isNullable]);

  const [focusedIndex, setFocusedIndex] = useState(initialIndex);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onCancel]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % options.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + options.length) % options.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = options[focusedIndex];
        if (selected) onSave(selected.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedIndex, options, onSave, onCancel]);

  const top = Math.max(8, Math.min(window.innerHeight - 180, editingCell.rect.top));
  const left = Math.max(8, Math.min(window.innerWidth - 180, editingCell.rect.left));
  const width = Math.max(editingCell.rect.width, 150);

  return (
    <div
      ref={popoverRef}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        minWidth: `${width}px`,
      }}
      className="fixed z-50 rounded-[6px] border border-[#262626] bg-[#0c0c0c] shadow-[0_12px_32px_rgba(0,0,0,0.95)] flex flex-col font-sans p-1 animate-in fade-in zoom-in-95 duration-100 select-none"
    >
      <div className="flex flex-col gap-0.5">
        {options.map((opt, idx) => {
          const isSelected =
            opt.value === null
              ? editingCell.initialValue === null || editingCell.initialValue === undefined
                ? editingCell.currentValue === '' || editingCell.currentValue === 'null'
                : false
              : typeof editingCell.initialValue === 'boolean'
              ? editingCell.initialValue === opt.value
              : editingCell.currentValue.toLowerCase() === String(opt.value);

          const isFocused = idx === focusedIndex;

          return (
            <button
              key={opt.label}
              type="button"
              onMouseEnter={() => setFocusedIndex(idx)}
              onClick={() => onSave(opt.value)}
              className={`flex items-center justify-between px-2.5 py-1.5 rounded-[4px] text-[13px] text-left transition-colors cursor-pointer ${
                isFocused ? 'bg-[#181818] text-white' : 'text-[#a1a1a1] hover:text-white'
              }`}
            >
              <span className={`font-mono text-[12.5px] ${
                opt.value === null ? 'italic text-[#666666]' : 'text-[#e5e5e5]'
              }`}>
                {opt.label}
              </span>
              {isSelected && (
                <Check className="w-3.5 h-3.5 text-white shrink-0 ml-3" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
