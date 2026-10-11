/*
 * Inline popover editor for string and text columns:
 * - Big spacious multiline text editor for TEXT / VARCHAR columns
 * - Real-time line count & character count display
 * - Quick NULL toggle for nullable columns
 * - Expand button to slideover inspector
 * - Enter commits (Shift+Enter for newline), Esc cancels, outside click commits
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Maximize2, Check } from 'lucide-react';
import { ColumnInfoApi } from '../../types';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

export interface InlineTextPopoverProps {
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

export function InlineTextPopover({
  editingCell,
  onChange,
  onSave,
  onCancel,
  onExpand,
}: InlineTextPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isNullable = editingCell.column?.nullable ?? true;
  const colType = editingCell.column?.type?.toUpperCase() || 'TEXT';

  const [isNull, setIsNull] = useState<boolean>(
    editingCell.initialValue === null && editingCell.currentValue === ''
  );

  const [localValue, setLocalValue] = useState<string>(() => {
    if (editingCell.initialValue === null && editingCell.currentValue === '') return '';
    return editingCell.currentValue;
  });

  useEffect(() => {
    if (textareaRef.current && !isNull) {
      const el = textareaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [isNull]);

  const isInitialNull = editingCell.initialValue === null || editingCell.initialValue === undefined;
  const initialText = isInitialNull ? '' : String(editingCell.initialValue);

  // Check if user has modified the value
  const isDirty = isNull ? !isInitialNull : (isInitialNull || localValue !== initialText);

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const handleCommit = useCallback(
    (customVal?: string, forcedNull?: boolean) => {
      if (forcedNull ?? isNull) {
        onSave(null);
        return;
      }
      const finalVal = customVal !== undefined ? customVal : (textareaRef.current ? textareaRef.current.value : localValue);
      onSave(finalVal);
    },
    [isNull, localValue, onSave]
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
        // If clicking inside a confirmation dialog, ignore
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

  const toggleNull = () => {
    if (!isNullable) return;
    if (!isNull) {
      setIsNull(true);
      setLocalValue('');
      onChange('');
    } else {
      setIsNull(false);
      setLocalValue('');
      onChange('');
    }
  };

  // Stats: char count and line count
  const stats = useMemo(() => {
    const charCount = localValue.length;
    const lineCount = localValue === '' ? 1 : localValue.split('\n').length;
    return { charCount, lineCount };
  }, [localValue]);

  // Safe popover positioning within viewport
  const popoverWidth = Math.max(380, Math.min(540, editingCell.rect.width + 140));
  const popoverHeight = 220;
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
      <div className="flex items-center justify-between pb-2 px-1 select-none">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[13.5px] font-sans font-medium text-[#e0e0e0] truncate" title={editingCell.colName}>
            {editingCell.colName}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[12px] text-[#666666] font-sans">
            {stats.charCount} ch {stats.lineCount > 1 ? `• ${stats.lineCount} ln` : ''}
          </span>
          {isNullable && (
            <button
              type="button"
              onClick={toggleNull}
              className={`px-2 py-0.5 rounded-[4px] text-[12px] font-sans font-medium border transition-colors cursor-pointer ${
                isNull
                  ? 'bg-[#1e1e1e] text-white border-[#333333] hover:bg-[#262626]'
                  : 'bg-transparent text-[#888888] border-[#222222] hover:text-white hover:bg-[#181818]'
              }`}
            >
              NULL
            </button>
          )}
        </div>
      </div>

      {/* Recessed Inner Editor Field */}
      <div className="rounded-[8px] border border-[#222222] bg-[#181818] px-[6px] py-2.5 flex flex-col min-h-[140px] shadow-inner transition-colors focus-within:border-[#383838]">
        {isNull ? (
          <div className="flex-1 flex items-center justify-center text-[#666666] italic text-[14px] font-sans select-none">
            Cell value is NULL. Click "NULL" or start typing to edit.
          </div>
        ) : (
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
                handleCommit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                handleAttemptClose();
              }
            }}
            spellCheck={false}
            className="w-full flex-1 bg-transparent text-[14px] font-sans text-white resize-none outline-none leading-relaxed placeholder-[#444444]"
            placeholder="Type text... (Press Enter to save, Shift+Enter for new line)"
          />
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
        description="You have unsaved changes in this cell. Are you sure you want to discard them?"
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
