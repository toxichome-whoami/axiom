/*
 * Dedicated inline JSON popover editor for JSON / JSONB columns:
 * - Syntax validation indicator (Valid JSON vs Syntax Error)
 * - Auto-format / Prettify action (2-space indentation)
 * - Preset templates: `{}` (empty object), `[]` (empty array), `null`
 * - Tab key support (inserts 2 spaces)
 * - Shortcuts: Ctrl+Enter / Enter to save, Esc to cancel, Maximize to expand
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Maximize2, Check } from 'lucide-react';
import { ColumnInfoApi } from '../../types';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

export interface InlineJsonPopoverProps {
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

export function InlineJsonPopover({
  editingCell,
  onChange,
  onSave,
  onCancel,
  onExpand,
}: InlineJsonPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isNullable = editingCell.column?.nullable ?? true;

  const [isNull, setIsNull] = useState<boolean>(() => {
    return (
      (editingCell.initialValue === null || editingCell.initialValue === undefined) &&
      (editingCell.currentValue === '' || editingCell.currentValue === 'null')
    );
  });

  const [localValue, setLocalValue] = useState<string>(() => {
    if (editingCell.initialValue === null && (editingCell.currentValue === '' || editingCell.currentValue === 'null')) {
      return '';
    }
    const raw = editingCell.currentValue;
    // Attempt pretty-print on initial load if valid JSON
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return raw;
    }
  });

  // JSON Validation status
  const validation = useMemo<{ isValid: boolean; error?: string }>(() => {
    if (isNull) return { isValid: true };
    const trimmed = localValue.trim();
    if (trimmed === '') {
      return { isValid: isNullable, error: isNullable ? undefined : 'JSON cannot be empty' };
    }
    try {
      JSON.parse(trimmed);
      return { isValid: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid JSON syntax';
      return { isValid: false, error: msg };
    }
  }, [localValue, isNull, isNullable]);

  useEffect(() => {
    if (textareaRef.current && !isNull) {
      const el = textareaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [isNull]);

  const isInitialNull = editingCell.initialValue === null || editingCell.initialValue === undefined;
  const initialText = useMemo(() => {
    if (isInitialNull) return '';
    try {
      const parsed = typeof editingCell.initialValue === 'object' ? editingCell.initialValue : JSON.parse(editingCell.currentValue);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return editingCell.currentValue;
    }
  }, [editingCell.initialValue, editingCell.currentValue, isInitialNull]);

  // Check if modified
  const isDirty = isNull ? !isInitialNull : (isInitialNull || localValue.trim() !== initialText.trim());

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const handleCommit = useCallback(
    (customVal?: string, forcedNull?: boolean) => {
      if (forcedNull ?? isNull) {
        onSave(null);
        return;
      }
      const raw = customVal !== undefined ? customVal : (textareaRef.current ? textareaRef.current.value : localValue);
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed.toLowerCase() === 'null') {
        if (isNullable) {
          onSave(null);
        } else {
          onSave('{}');
        }
        return;
      }

      // Compact valid JSON or preserve input
      try {
        const parsed = JSON.parse(trimmed);
        onSave(parsed);
      } catch {
        onSave(trimmed);
      }
    },
    [isNull, localValue, isNullable, onSave]
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
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement | null;
        if (target?.closest('[role="dialog"]') || target?.closest('.fixed.z-50')) return;

        handleAttemptClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [handleAttemptClose, showDiscardConfirm]);

  // Scroll outside prompts for discard if dirty
  useEffect(() => {
    const handleScroll = (e: Event) => {
      if (showDiscardConfirm) return;
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        handleAttemptClose();
      }
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [handleAttemptClose, showDiscardConfirm]);

  // Prettify / Format JSON action
  const handleFormat = () => {
    if (isNull) return;
    try {
      const parsed = JSON.parse(localValue);
      const formatted = JSON.stringify(parsed, null, 2);
      setLocalValue(formatted);
      onChange(formatted);
    } catch {
      // cannot format invalid JSON
    }
  };

  // Keyboard navigation & indentation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const val = el.value;
      const newVal = val.substring(0, start) + '  ' + val.substring(end);
      setLocalValue(newVal);
      onChange(newVal);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2;
      });
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      handleCommit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleAttemptClose();
    }
  };

  // Safe popover positioning within viewport
  const popoverWidth = Math.max(380, Math.min(540, editingCell.rect.width + 140));
  const popoverHeight = 270;
  const left = Math.max(8, Math.min(window.innerWidth - popoverWidth - 16, editingCell.rect.left));
  const top = Math.max(8, Math.min(window.innerHeight - popoverHeight - 16, editingCell.rect.top));

  return (
    <div
      ref={popoverRef}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${popoverWidth}px`,
      }}
      className="fixed z-50 rounded-[10px] border border-[#222222] bg-[#111111] shadow-[0_20px_50px_rgba(0,0,0,0.95)] px-[6px] py-2 flex flex-col font-sans animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Top Header Bar */}
      <div className="flex items-center justify-between pb-1.5 px-1 select-none">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[12.5px] font-sans font-medium text-[#cccccc] truncate" title={editingCell.colName}>
            {editingCell.colName}
          </span>
        </div>

        {/* Action controls - Only Format */}
        <div className="flex items-center gap-1.5 shrink-0">
          {!isNull && (
            <button
              type="button"
              onClick={handleFormat}
              disabled={!validation.isValid}
              title="Format JSON (2 spaces)"
              className="px-2.5 py-0.5 rounded-[4px] text-[11.5px] font-sans font-medium text-[#888888] hover:text-white border border-[#222222] hover:border-[#2e2e2e] hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              Format
            </button>
          )}
        </div>
      </div>

      {/* Recessed Inner Editor Field */}
      <div className="rounded-[8px] border border-[#222222] bg-[#181818] px-[6px] py-2.5 flex-1 flex flex-col min-h-[160px] shadow-inner transition-colors focus-within:border-[#383838]">
        {isNull ? (
          <div className="flex-1 flex items-center justify-center text-[#555555] italic text-[13px] select-none">
            Cell value is NULL. Click "NULL" or presets to insert JSON.
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            <textarea
              ref={textareaRef}
              rows={7}
              value={localValue}
              onChange={(e) => {
                const v = e.target.value;
                setLocalValue(v);
                onChange(v);
              }}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              className={`w-full flex-1 bg-transparent text-[12.5px] font-mono text-[#e5e5e5] resize-none outline-none leading-relaxed placeholder-[#444444] transition-all pl-1 ${
                !validation.isValid ? 'border-l-2 border-rose-900/60' : 'border-l-2 border-transparent'
              }`}
              placeholder="{\n  &quot;key&quot;: &quot;value&quot;\n}"
            />
            {!validation.isValid && validation.error && (
              <div className="text-[10.5px] text-[#666666] font-mono pt-1 truncate select-none">
                {validation.error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Actions Bar */}
      <div className="pt-2 pb-0.5 px-1 flex items-center justify-end gap-2 select-none">
        <button
          type="button"
          onClick={onExpand}
          title="Expand editor to drawer"
          className="w-7 h-7 rounded-[5px] border border-[#2a2a2a] bg-[#161616] hover:bg-[#202020] text-[#777777] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
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
        description="You have unsaved changes in this JSON cell. Are you sure you want to discard them?"
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
