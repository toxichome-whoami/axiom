/*
 * Inline popover cell editors for Table Editor grid cells:
 * - InlineCellEditorPopover: Text/multiline cell editor with keyboard shortcuts (Enter to save, Esc to cancel, Maximize to expand)
 * - InlineBooleanPopover: Fast boolean selection dropdown (true / false / null) with keyboard navigation
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react
 * Invariants: Fast keyboard navigation, auto-dismiss on outside click/scroll, no layout shift.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Maximize2, Check } from 'lucide-react';
import { ColumnInfoApi } from '../../types';

export interface InlineCellEditorPopoverProps {
  editingCell: {
    rowIndex: number;
    colName: string;
    initialValue: unknown;
    currentValue: string;
    rect: { top: number; left: number; width: number; height: number };
  };
  onChange: (val: string) => void;
  onSave: (val?: string) => void;
  onCancel: () => void;
  onExpand: () => void;
}

export function InlineCellEditorPopover({
  editingCell,
  onChange,
  onSave,
  onCancel,
  onExpand,
}: InlineCellEditorPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localValue, setLocalValue] = useState<string>(editingCell.currentValue);

  useEffect(() => {
    setLocalValue(editingCell.currentValue);
  }, [editingCell.currentValue]);

  useEffect(() => {
    if (textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  const handleSaveCurrent = useCallback(
    (val?: string) => {
      const finalVal = val !== undefined ? val : (textareaRef.current ? textareaRef.current.value : localValue);
      onSave(finalVal);
    },
    [localValue, onSave]
  );

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        handleSaveCurrent();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [handleSaveCurrent]);

  useEffect(() => {
    const handleScroll = () => {
      handleSaveCurrent();
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [handleSaveCurrent]);

  const top = Math.max(8, Math.min(window.innerHeight - 260, editingCell.rect.top));
  const left = Math.max(8, Math.min(window.innerWidth - 340, editingCell.rect.left));
  const width = Math.max(editingCell.rect.width, 280);

  return (
    <div
      ref={popoverRef}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${width}px`,
      }}
      className="fixed z-50 rounded-[8px] border border-[#2a2a2a] bg-[#121212] shadow-[0_18px_40px_rgba(0,0,0,0.95)] flex flex-col font-sans overflow-hidden animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Top Textarea area */}
      <div className="p-3 flex-1 flex flex-col min-h-[140px]">
        <textarea
          ref={textareaRef}
          rows={5}
          value={localValue}
          onChange={(e) => {
            const v = e.target.value;
            setLocalValue(v);
            onChange(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              const v = textareaRef.current ? textareaRef.current.value : localValue;
              handleSaveCurrent(v);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
          spellCheck={false}
          className="w-full flex-1 bg-transparent text-[13.5px] font-sans text-white resize-none outline-none leading-relaxed placeholder-[#555555]"
          placeholder="Enter value..."
        />
      </div>

      {/* Footer bar */}
      <div className="p-3 border-t border-[#222222] bg-[#141414] flex items-center justify-between select-none">
        {/* Left shortcuts */}
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => handleSaveCurrent()}
            className="flex items-center gap-2 text-left cursor-pointer group"
          >
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-[4px] bg-[#1e1e1e] border border-[#2e2e2e] text-[#a0a0a0] text-[11px] font-mono group-hover:text-white group-hover:border-[#444444] transition-colors">
              ↵
            </span>
            <span className="text-[12px] text-[#8c8c8c] group-hover:text-white transition-colors">
              Save changes
            </span>
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-2 text-left cursor-pointer group"
          >
            <span className="inline-flex items-center justify-center px-1.5 h-5 rounded-[4px] bg-[#1e1e1e] border border-[#2e2e2e] text-[#a0a0a0] text-[10.5px] font-mono group-hover:text-white group-hover:border-[#444444] transition-colors">
              Esc
            </span>
            <span className="text-[12px] text-[#8c8c8c] group-hover:text-white transition-colors">
              Cancel changes
            </span>
          </button>
        </div>

        {/* Right expand button */}
        <button
          type="button"
          onClick={onExpand}
          title="Expand editor"
          className="w-8 h-8 rounded-[6px] bg-[#1a1a1a] border border-[#2a2a2a] hover:border-[#3a3a3a] text-[#888888] hover:text-white hover:bg-[#222222] flex items-center justify-center transition-colors cursor-pointer"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

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
  const width = Math.max(editingCell.rect.width, 140);

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
      <div className="flex flex-col">
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
              <span className={`font-sans text-[13px] ${
                opt.value === null ? 'italic text-[#666666]' : ''
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
