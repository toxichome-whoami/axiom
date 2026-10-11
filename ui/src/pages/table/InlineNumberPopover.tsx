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

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { ColumnInfoApi } from '../../types';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

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
}

export function InlineNumberPopover({
  editingCell,
  onChange,
  onSave,
  onCancel,
}: InlineNumberPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const normType = editingCell.column?.type?.toLowerCase() || '';
  const isFloat =
    normType.includes('float') ||
    normType.includes('double') ||
    normType.includes('decimal') ||
    normType.includes('numeric') ||
    normType.includes('real');

  const step = isFloat ? 0.1 : 1;
  const isNullable = editingCell.column?.nullable ?? true;

  // Handle initial null or empty value
  const isInitialNull =
    editingCell.initialValue === null ||
    editingCell.initialValue === undefined ||
    editingCell.currentValue === 'null' ||
    editingCell.currentValue === '';

  const [inputVal, setInputVal] = useState<string>(() => {
    if (isInitialNull && editingCell.initialValue === null) return '';
    return editingCell.currentValue;
  });

  const [isNull, setIsNull] = useState<boolean>(
    editingCell.initialValue === null && editingCell.currentValue === ''
  );

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const initialNumStr = isInitialNull ? '' : String(editingCell.initialValue);
  const isDirty = isNull ? !isInitialNull : (isInitialNull || inputVal.trim() !== initialNumStr.trim());
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const handleCommit = useCallback(
    (customVal?: string, forcedNull?: boolean) => {
      if (forcedNull ?? isNull) {
        onSave(null);
        return;
      }
      const raw = customVal !== undefined ? customVal : inputVal;
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed.toLowerCase() === 'null') {
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
    [inputVal, isNull, isNullable, isFloat, onSave]
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

  const stepValue = (direction: 1 | -1) => {
    setIsNull(false);
    const curNum = Number(inputVal);
    const base = isNaN(curNum) ? 0 : curNum;
    const nextNum = isFloat ? Math.round((base + direction * step) * 100) / 100 : base + direction * step;
    const nextStr = String(nextNum);
    setInputVal(nextStr);
    onChange(nextStr);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleCommit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleAttemptClose();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      stepValue(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      stepValue(-1);
    }
  };

  const toggleNull = () => {
    if (!isNullable) return;
    if (!isNull) {
      setIsNull(true);
      setInputVal('');
      onChange('');
    } else {
      setIsNull(false);
      setInputVal('0');
      onChange('0');
    }
  };

  // Safe popover positioning within viewport
  const width = Math.max(editingCell.rect.width + 24, 240);
  const left = Math.max(8, Math.min(window.innerWidth - width - 16, editingCell.rect.left - 4));
  const top = Math.max(8, Math.min(window.innerHeight - 56, editingCell.rect.top - 4));

  return (
    <div
      ref={popoverRef}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${width}px`,
      }}
      className="fixed z-50 rounded-[10px] border border-[#222222] bg-[#111111] shadow-[0_12px_36px_rgba(0,0,0,0.95)] p-2 font-sans animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Recessed Inner Input Area */}
      <div className="flex items-center h-8 rounded-[6px] border border-[#222222] bg-[#181818] overflow-hidden focus-within:border-[#383838] transition-colors">
        {/* Number Input Field */}
        <input
          ref={inputRef}
          type="text"
          inputMode={isFloat ? 'decimal' : 'numeric'}
          disabled={isNull}
          value={isNull ? 'NULL' : inputVal}
          onChange={(e) => {
            setIsNull(false);
            const v = e.target.value;
            setInputVal(v);
            onChange(v);
          }}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          placeholder={isNull ? 'NULL' : '0'}
          className={`h-full flex-1 min-w-0 bg-transparent px-2.5 text-[13px] font-mono text-white outline-none placeholder-[#555555] ${
            isNull ? 'italic text-[#666666] select-none cursor-default' : ''
          }`}
        />

        {/* Steppers (+ / -) */}
        {!isNull && (
          <div className="h-full flex flex-col justify-center border-l border-[#222222] bg-transparent px-0.5 shrink-0">
            <button
              type="button"
              tabIndex={-1}
              onClick={() => stepValue(1)}
              title="Increment (Up Arrow)"
              className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#222222] rounded-[2px] transition-colors cursor-pointer"
            >
              <ChevronUp className="w-2.5 h-2.5" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => stepValue(-1)}
              title="Decrement (Down Arrow)"
              className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#222222] rounded-[2px] transition-colors cursor-pointer"
            >
              <ChevronDown className="w-2.5 h-2.5" />
            </button>
          </div>
        )}

        {/* Quick NULL Button */}
        {isNullable && (
          <button
            type="button"
            tabIndex={-1}
            onClick={toggleNull}
            title={isNull ? 'Enter number' : 'Set to NULL'}
            className={`h-full px-2 text-[11px] font-mono font-medium border-l border-[#222222] transition-colors cursor-pointer shrink-0 ${
              isNull
                ? 'bg-[#222222] text-white hover:bg-[#2a2a2a]'
                : 'bg-transparent text-[#777777] hover:text-white hover:bg-[#1f1f1f]'
            }`}
          >
            NULL
          </button>
        )}
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
