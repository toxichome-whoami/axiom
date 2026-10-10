/*
 * Supabase Studio and Neon inspired multi-pane Table Editor, Schema Visualizer, and SQL Console.
 * Owned by: ui/pages
 * Key deps: lucide-react, ../api/client, ../types, ../components/ui/ConfirmDialog
 * Invariants: Single source of truth for active database and table; lock-free editing via right panel inspector; zero slop.
 * Last structural change: Complete redesign into 3-pane grid architecture matching StoragePage.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Table as TableIcon,
  Columns,
  Terminal,
  Search,
  RefreshCw,
  Plus,
  Trash2,
  Filter,
  ArrowUpDown,
  Key,
  Link2,
  Hash,
  Type,
  Clock,
  CheckSquare,
  Code2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  AlertCircle,
  Database,
  X,
  Play,
  ArrowRight,
  Info,
  Save,
  FileCode,
  Layers,
  Edit3,
  Maximize2,
  Calendar,
} from 'lucide-react';
import {
  api,
  DatabaseRecordApi,
} from '../api/client';
import {
  TableInfoApi,
  ColumnInfoApi,
  ForeignKeyInfoApi,
  QueryResultApi,
} from '../types';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SlideOver } from '../components/ui/SlideOver';
import { CustomSelect } from '../components/shared/CustomSelect';
import { DayPicker } from '@daypicker/react';
import '@daypicker/react/dist/style.css';

// ─── Type Icon Mapping ───────────────────────────────────────────────────────
// Maps SQL column types to compact Supabase-style visual badges.

function getColumnTypeBadge(typeName: string, isPk: boolean, isFk: boolean) {
  const norm = (typeName || '').toLowerCase();

  if (isPk) {
    return {
      icon: Key,
      label: typeName || 'PK',
      color: 'text-[#8c8c8c]',
    };
  }
  if (isFk) {
    return {
      icon: Link2,
      label: typeName || 'FK',
      color: 'text-[#8c8c8c]',
    };
  }

  if (
    norm.includes('int') ||
    norm.includes('float') ||
    norm.includes('double') ||
    norm.includes('decimal') ||
    norm.includes('numeric') ||
    norm.includes('real')
  ) {
    return {
      icon: Hash,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }
  if (norm.includes('char') || norm.includes('text') || norm.includes('string')) {
    return {
      icon: Type,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }
  if (norm.includes('time') || norm.includes('date')) {
    return {
      icon: Clock,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }
  if (norm.includes('bool')) {
    return {
      icon: CheckSquare,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }
  if (norm.includes('json') || norm.includes('array')) {
    return {
      icon: Code2,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }

  return {
    icon: Type,
    label: typeName || 'text',
    color: 'text-[#8c8c8c]',
  };
}

// ─── Format Data Type to Simple Canonical Name (Supabase style) ──────────────
// Translates verbose SQL information_schema types (e.g. 'character varying',
// 'timestamp with time zone', 'integer') into crisp, familiar Supabase tokens.
function formatColumnType(rawType: string): string {
  if (!rawType) return 'text';
  const norm = rawType.toLowerCase().trim();

  // Exact canonical Postgres / SQL mappings
  if (norm === 'character varying' || norm.startsWith('varchar')) return 'varchar';
  if (norm === 'character' || norm === 'char' || norm.startsWith('char(')) return 'char';
  if (norm === 'integer' || norm === 'int' || norm === 'int4') return 'int4';
  if (norm === 'bigint' || norm === 'int8') return 'int8';
  if (norm === 'smallint' || norm === 'int2') return 'int2';
  if (norm === 'tinyint') return 'int2';
  if (norm === 'boolean' || norm === 'bool') return 'bool';
  if (norm === 'timestamp with time zone' || norm === 'timestamptz') return 'timestamptz';
  if (norm === 'timestamp without time zone' || norm === 'timestamp') return 'timestamp';
  if (norm === 'time with time zone' || norm === 'timetz') return 'timetz';
  if (norm === 'time without time zone' || norm === 'time') return 'time';
  if (norm === 'double precision' || norm === 'float8') return 'float8';
  if (norm === 'real' || norm === 'float4') return 'float4';
  if (norm === 'numeric' || norm.startsWith('decimal') || norm.startsWith('numeric(')) return 'numeric';
  if (norm === 'text') return 'text';
  if (norm === 'jsonb') return 'jsonb';
  if (norm === 'json') return 'json';
  if (norm === 'uuid') return 'uuid';
  if (norm === 'bytea' || norm === 'blob') return 'bytea';
  if (norm === 'date') return 'date';
  if (norm.startsWith('serial')) return 'serial';
  if (norm.startsWith('bigserial')) return 'bigserial';

  // Strip parentheses like varchar(255) -> varchar
  const clean = norm.replace(/\(.*\)/, '').trim();
  if (clean === 'character varying' || clean === 'varchar') return 'varchar';
  if (clean === 'int' || clean === 'integer') return 'int4';
  return clean || norm;
}

// ─── Type-Specific Column Width Heuristics (Supabase Studio inspired) ──────
// Calculates natural initial column widths according to SQL data type semantics.
// Optimized for 14px Inter typography matching the Databases and Overview pages.
function getDefaultColumnWidth(typeName: string, colName?: string): number {
  const norm = (typeName || '').toLowerCase().trim();
  const normName = (colName || '').toLowerCase().trim();

  // Boolean flags: compact width (e.g., active, is_admin, verified)
  if (norm.includes('bool') || norm === 'bit') {
    return 95;
  }

  // Row IDs and foreign key pointers: compact
  if (normName === 'id' || normName.endsWith('_id') || normName.endsWith('_fk')) {
    return 120;
  }

  // Quantities & counts
  if (
    normName.includes('qty') ||
    normName.includes('quantity') ||
    normName.includes('count') ||
    normName.includes('age') ||
    norm.includes('int2') ||
    norm.includes('smallint') ||
    norm.includes('tinyint')
  ) {
    return 110;
  }

  // Standard integers
  if (norm.includes('int') || norm.includes('serial') || norm.includes('year')) {
    return 130;
  }

  // Floating point / Decimal / Monetary numbers (e.g., unit_price, subtotal)
  if (
    norm.includes('float') ||
    norm.includes('double') ||
    norm.includes('decimal') ||
    norm.includes('numeric') ||
    norm.includes('money') ||
    norm.includes('real')
  ) {
    return 145;
  }

  // Date, Time, Timestamps
  if (norm.includes('time') || norm.includes('date')) {
    return 185;
  }

  // UUIDs / Hashes
  if (norm.includes('uuid') || norm.includes('guid') || normName.includes('hash')) {
    return 210;
  }

  // JSON, XML, binary documents
  if (norm.includes('json') || norm.includes('xml') || norm.includes('bytea') || norm.includes('blob')) {
    return 240;
  }

  // Email / URLs
  if (normName.includes('email') || normName.includes('url') || normName.includes('avatar')) {
    return 230;
  }

  // Text, Varchar, generic strings
  if (norm.includes('text') || norm.includes('char') || norm.includes('string')) {
    return 195;
  }

  // Fallback default
  return 150;
}

// ─── Reusable Field Editor with Edit/Action Menu (Set to NULL & Expand Editor) ────
interface FieldEditorWrapperProps {
  label: string;
  value: unknown;
  onChange: (val: unknown) => void;
  disabled?: boolean;
  isNullable?: boolean;
  isMultiline?: boolean;
  placeholder?: string;
  type?: 'text' | 'number';
  step?: string;
}

function FieldEditorWrapper({
  label,
  value,
  onChange,
  disabled = false,
  isNullable = true,
  isMultiline = false,
  placeholder,
  type = 'text',
  step,
}: FieldEditorWrapperProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalDraft, setModalDraft] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  const isNull = value === null || value === undefined;
  const strVal = isNull ? '' : String(value);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  const handleOpenExpand = () => {
    setIsMenuOpen(false);
    setModalDraft(strVal);
    setIsModalOpen(true);
  };

  const handleApplyModal = () => {
    onChange(modalDraft === '' && isNullable ? null : modalDraft);
    setIsModalOpen(false);
  };

  return (
    <>
      <div className="relative group w-full" ref={menuRef}>
        {isMultiline ? (
          <textarea
            rows={3}
            disabled={disabled}
            value={strVal}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value === '' && isNullable ? null : e.target.value)}
            className={`w-full h-[84px] rounded-[6px] border border-[#262626] bg-[#121212] p-2.5 pr-8 text-[14px] text-white font-sans focus:outline-none focus:border-[#3b82f6] transition-colors resize-none placeholder-[#555555] ${
              disabled ? 'opacity-60 cursor-not-allowed bg-[#0d0d0d]' : ''
            }`}
          />
        ) : (
          <input
            type={type}
            step={step}
            disabled={disabled}
            value={strVal}
            placeholder={placeholder}
            onChange={(e) => {
              const v = e.target.value;
              onChange(v === '' && isNullable ? null : v);
            }}
            className={`h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-8 text-[14px] text-white font-sans focus:outline-none focus:border-[#3b82f6] transition-colors placeholder-[#555555] ${
              disabled ? 'opacity-60 cursor-not-allowed bg-[#0d0d0d]' : ''
            }`}
          />
        )}

        {/* Small rounded Edit icon button placed safely away from bottom-right resize handle */}
        {!disabled && (
          <div className={`absolute ${isMultiline ? 'right-2.5 top-2.5' : 'right-2 top-1/2 -translate-y-1/2'} z-10`}>
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              title="Field actions"
              className={`flex items-center justify-center w-5 h-5 rounded-[4px] border border-[#2a2a2a] bg-[#161616]/90 hover:bg-[#222222] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer ${
                isMenuOpen ? 'border-[#3b82f6] text-white bg-[#1a1a1a]' : ''
              }`}
            >
              <Edit3 className="w-3 h-3" />
            </button>

            {/* Dropdown Menu matching user screenshot */}
            {isMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 rounded-[6px] border border-[#282828] bg-[#141414] shadow-[0_12px_28px_rgba(0,0,0,0.9)] p-1 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans">
                <button
                  type="button"
                  onClick={() => {
                    onChange(null);
                    setIsMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] text-[12px] text-[#cccccc] hover:text-white hover:bg-[#202020] transition-colors text-left cursor-pointer"
                >
                  <span>Set to NULL</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenExpand}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] text-[12px] text-[#cccccc] hover:text-white hover:bg-[#202020] transition-colors text-left cursor-pointer"
                >
                  <span>Expand editor</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expanded Field Editor Drawer Panel (Matches current edit panel design) */}
      <SlideOver
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        width="w-[520px] max-w-full"
        title={label}
        subtitle="Edit field value"
      >
        <div className="flex-1 flex flex-col min-h-0 bg-[#0e0e0e] overflow-hidden font-sans">
          {/* Main Content Area */}
          <div className="flex-1 p-4 sm:p-5 flex flex-col min-h-0 space-y-2 overflow-hidden">
            <div className="flex items-center justify-between">
              <label className="text-[13.5px] font-medium text-white font-sans">
                Value
              </label>
              <span className="text-[12px] font-mono text-[#777777]">
                {(modalDraft || '').length} chars · {(modalDraft || '').split('\n').length} lines
              </span>
            </div>
            <textarea
              value={modalDraft}
              onChange={(e) => setModalDraft(e.target.value)}
              autoFocus
              spellCheck={false}
              className="flex-1 w-full rounded-[6px] border border-[#262626] bg-[#121212] p-3 text-[14px] leading-relaxed text-white font-sans focus:outline-none focus:border-[#3b82f6] resize-none placeholder-[#555555] transition-colors whitespace-pre"
              placeholder="Enter value..."
            />
          </div>

          {/* Footer (Pinned to bottom matching edit panel) */}
          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans shrink-0">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyModal}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative flex items-center text-[14px] font-sans">
                Apply
              </span>
            </button>
          </div>
        </div>
      </SlideOver>
    </>
  );
}


// ─── Inline Cell Popover Editor matching Supabase Studio ─────────────────────
interface InlineCellEditorPopoverProps {
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

function InlineCellEditorPopover({
  editingCell,
  onChange,
  onSave,
  onCancel,
  onExpand,
}: InlineCellEditorPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onSave(editingCell.currentValue);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [editingCell.currentValue, onSave]);

  useEffect(() => {
    const handleScroll = (e: Event) => {
      if (popoverRef.current && popoverRef.current.contains(e.target as Node)) {
        return;
      }
      onSave(editingCell.currentValue);
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [editingCell.currentValue, onSave]);

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
          value={editingCell.currentValue}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSave(editingCell.currentValue);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          spellCheck={false}
          className="w-full flex-1 bg-transparent text-[13.5px] font-sans text-white resize-none outline-none leading-relaxed placeholder-[#555555]"
          placeholder="Enter value..."
        />
      </div>

      {/* Footer bar matching reference screenshot */}
      <div className="p-3 border-t border-[#222222] bg-[#141414] flex items-center justify-between select-none">
        {/* Left shortcuts */}
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => onSave(editingCell.currentValue)}
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

// ─── Inline Boolean Popover (Dropdown) ───────────────────────────────────────
interface InlineBooleanPopoverProps {
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

function InlineBooleanPopover({
  editingCell,
  onSave,
  onCancel,
}: InlineBooleanPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const isNullable = editingCell.column?.nullable ?? true;

  const options: Array<{ label: string; value: boolean | null; color: string; desc: string }> = [
    { label: 'TRUE', value: true, color: 'text-[#10b981]', desc: 'Boolean true' },
    { label: 'FALSE', value: false, color: 'text-[#ef4444]', desc: 'Boolean false' },
  ];
  if (isNullable) {
    options.push({ label: 'NULL', value: null, color: 'text-[#8c8c8c]', desc: 'Empty / unset value' });
  }

  // Derive initial selected index from initialValue or currentValue
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

  const top = Math.max(8, Math.min(window.innerHeight - 200, editingCell.rect.top));
  const left = Math.max(8, Math.min(window.innerWidth - 220, editingCell.rect.left));
  const width = Math.max(editingCell.rect.width, 180);

  return (
    <div
      ref={popoverRef}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        minWidth: `${width}px`,
      }}
      className="fixed z-50 rounded-[8px] border border-[#2a2a2a] bg-[#121212] shadow-[0_18px_40px_rgba(0,0,0,0.95)] flex flex-col font-sans p-1 animate-in fade-in zoom-in-95 duration-100 select-none"
    >
      <div className="px-2 py-1.5 border-b border-[#202020] mb-1 flex items-center justify-between text-[11px] text-[#8c8c8c]">
        <span className="font-mono uppercase tracking-wider text-[10px] text-[#777777]">
          {editingCell.colName} (bool)
        </span>
        <span className="font-mono text-[10px] text-[#555555]">↵ Select</span>
      </div>

      <div className="flex flex-col gap-0.5">
        {options.map((opt, idx) => {
          const isSelected =
            opt.value === null
              ? editingCell.initialValue === null || editingCell.initialValue === undefined
              : editingCell.initialValue === opt.value;
          const isFocused = idx === focusedIndex;

          return (
            <button
              key={opt.label}
              type="button"
              onMouseEnter={() => setFocusedIndex(idx)}
              onClick={() => onSave(opt.value)}
              className={`flex items-center justify-between px-2.5 py-1.5 rounded-[5px] text-[13px] text-left transition-colors cursor-pointer ${
                isFocused ? 'bg-[#1f1f1f] text-white' : 'text-[#cccccc] hover:bg-[#1a1a1a]'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  opt.value === true
                    ? 'bg-[#10b981]'
                    : opt.value === false
                    ? 'bg-[#ef4444]'
                    : 'bg-[#666666]'
                }`} />
                <span className={`font-mono font-medium text-[12.5px] ${opt.color}`}>
                  {opt.label}
                </span>
              </div>
              {isSelected && (
                <Check className="w-3.5 h-3.5 text-[#3b82f6] shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-1 pt-1 border-t border-[#1e1e1e] px-2 py-1 flex items-center justify-between text-[10.5px] text-[#666666]">
        <span>↑↓ Navigate</span>
        <span>Esc Cancel</span>
      </div>
    </div>
  );
}

// ─── Inline Date / Time Popover matching Inspector Panel ─────────────────────
interface InlineDateTimePickerPopoverProps {
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

function InlineDateTimePickerPopover({
  editingCell,
  onSave,
  onCancel,
}: InlineDateTimePickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const normType = editingCell.column?.type?.toLowerCase() || '';
  const isDateOnly = normType === 'date';

  const strVal = editingCell.currentValue === null || editingCell.currentValue === undefined ? '' : String(editingCell.currentValue);

  // Parse date, time, and timezone portions from string value
  const parseVal = useCallback(() => {
    if (!strVal.trim()) {
      return { date: undefined, hours: '12', minutes: '00', seconds: '00', tz: '' };
    }
    const parts = strVal.trim().split(/[T ]/);
    const dateStr = parts[0] || '';
    const timeFull = parts[1] || '';

    let d: Date | undefined;
    const dateParts = dateStr.split('-').map(Number);
    if (dateParts.length === 3 && dateParts.every((n) => !isNaN(n))) {
      const parsedDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
      if (!isNaN(parsedDate.getTime())) {
        d = parsedDate;
      }
    }

    let hours = '12';
    let minutes = '00';
    let seconds = '00';
    let tz = '';

    if (timeFull) {
      const tzMatch = timeFull.match(/([+-]\d{2}(?::?\d{2})?|Z|[A-Z]{2,4})$/i);
      if (tzMatch) {
        tz = tzMatch[0];
      }
      const timeWithoutTz = tz ? timeFull.slice(0, -tz.length) : timeFull;
      const tParts = timeWithoutTz.split(':');
      if (tParts[0] !== undefined) hours = tParts[0].padStart(2, '0');
      if (tParts[1] !== undefined) minutes = tParts[1].padStart(2, '0');
      if (tParts[2] !== undefined) seconds = tParts[2].split('.')[0].padStart(2, '0');
    }

    return { date: d, hours, minutes, seconds, tz };
  }, [strVal]);

  const parsed = parseVal();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(parsed.date);
  const [month, setMonth] = useState<Date>(() => parsed.date || new Date());
  const [timeState, setTimeState] = useState({
    hours: parsed.hours,
    minutes: parsed.minutes,
    seconds: parsed.seconds,
    tz: parsed.tz,
  });

  const [currentDraft, setCurrentDraft] = useState<string | null>(strVal || null);

  const formatOutput = useCallback((
    dateObj: Date | undefined,
    timeObj: { hours: string; minutes: string; seconds: string; tz: string }
  ): string | null => {
    if (!dateObj) return null;
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    const datePart = `${y}-${m}-${d}`;

    if (isDateOnly) {
      return datePart;
    }
    const h = String(timeObj.hours).padStart(2, '0');
    const min = String(timeObj.minutes).padStart(2, '0');
    const s = String(timeObj.seconds).padStart(2, '0');
    const tzSuffix = timeObj.tz ? ` ${timeObj.tz}` : '';
    return `${datePart} ${h}:${min}:${s}${tzSuffix}`;
  }, [isDateOnly]);

  const handleSelectDate = (date: Date | undefined) => {
    setSelectedDate(date);
    const formatted = formatOutput(date, timeState);
    setCurrentDraft(formatted);
  };

  const handleSetNow = () => {
    const now = new Date();
    setSelectedDate(now);
    const newTime = {
      hours: String(now.getHours()).padStart(2, '0'),
      minutes: String(now.getMinutes()).padStart(2, '0'),
      seconds: String(now.getSeconds()).padStart(2, '0'),
      tz: timeState.tz,
    };
    setTimeState(newTime);
    setCurrentDraft(formatOutput(now, newTime));
  };

  const handleSetNull = () => {
    setSelectedDate(undefined);
    setCurrentDraft(null);
  };

  const localTz = useMemo(() => {
    try {
      const d = new Date();
      const match = d.toTimeString().match(/\((.+)\)$/);
      if (match) return match[1];
      const offset = -d.getTimezoneOffset() / 60;
      return offset >= 0 ? `UTC+${offset}` : `UTC${offset}`;
    } catch {
      return 'UTC';
    }
  }, []);

  const activeTz = timeState.tz || localTz;

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onSave(currentDraft);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [currentDraft, onSave]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onSave(currentDraft);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentDraft, onSave, onCancel]);

  // Position popover intelligently near cell
  const popoverHeight = isDateOnly ? 360 : 450;
  const popoverWidth = 340;
  const top = Math.max(8, Math.min(window.innerHeight - popoverHeight - 16, editingCell.rect.top));
  const left = Math.max(8, Math.min(window.innerWidth - popoverWidth - 16, editingCell.rect.left));

  return (
    <div
      ref={popoverRef}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${popoverWidth}px`,
      }}
      className="fixed z-50 rounded-[8px] border border-[#262626] bg-[#0c0c0c] shadow-[0_16px_40px_rgba(0,0,0,0.95)] p-3.5 font-sans animate-in fade-in zoom-in-95 duration-100 select-none"
    >
      {/* Header Bar */}
      <div className="pb-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-white flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[#8c8c8c]" />
            <span>{isDateOnly ? 'Select Date' : 'Select Date & Time'}</span>
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleSetNow}
              className="px-2 py-0.5 rounded-[4px] text-[11.5px] font-medium bg-[#161616] hover:bg-[#222222] text-[#cccccc] hover:text-white border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer"
            >
              Now
            </button>
            <button
              type="button"
              onClick={handleSetNull}
              className="px-2 py-0.5 rounded-[4px] text-[11.5px] font-medium bg-[#161616] hover:bg-[#222222] text-[#8c8c8c] hover:text-white border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer"
            >
              NULL
            </button>
          </div>
        </div>
      </div>

      {/* Edge-to-edge separator above calendar */}
      <div className="-mx-3.5 border-t border-[#222222] mb-2" />

      {/* Calendar Grid */}
      <div className="axiom-datepicker-wrapper w-full py-1">
        <DayPicker
          mode="single"
          selected={selectedDate}
          month={month}
          onMonthChange={setMonth}
          onSelect={handleSelectDate}
          className="m-0 text-white font-sans text-[12px] w-full"
        />
      </div>

      {/* Detailed Time Selector (for timestamp / time types) */}
      {!isDateOnly && (
        <>
          <div className="-mx-3.5 border-t border-[#222222] my-2" />

          <div className="pt-0.5">
            <div className="flex items-center justify-between text-[12px] text-[#8c8c8c] mb-2">
              <span className="font-medium text-[#cccccc]">Time of Day</span>
              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                <span className="text-[#cccccc] bg-[#141414] px-1.5 py-0.5 rounded border border-[#262626] font-medium">
                  {activeTz}
                </span>
                <span className="text-[#777777] bg-[#141414] px-1.5 py-0.5 rounded border border-[#222222]">
                  24h
                </span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono">
              {/* Hours */}
              <div className="flex flex-col">
                <div className="relative flex items-center rounded-[6px] border border-[#262626] bg-[#121212] overflow-hidden focus-within:border-[#444444] transition-colors">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={timeState.hours}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                      const num = Math.min(23, Number(val) || 0);
                      const h = val === '' ? '' : String(num).padStart(2, '0');
                      const newT = { ...timeState, hours: h || '00' };
                      setTimeState(newT);
                      setCurrentDraft(formatOutput(selectedDate || new Date(), newT));
                    }}
                    onBlur={() => {
                      const h = String(Math.max(0, Math.min(23, Number(timeState.hours) || 0))).padStart(2, '0');
                      const newT = { ...timeState, hours: h };
                      setTimeState(newT);
                      setCurrentDraft(formatOutput(selectedDate || new Date(), newT));
                    }}
                    className="h-8 w-full bg-transparent pl-2.5 pr-5 text-center text-[13px] text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <div className="absolute right-0.5 top-0.5 bottom-0.5 flex flex-col justify-center border-l border-[#222222] pl-0.5">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        const cur = Number(timeState.hours) || 0;
                        const next = cur >= 23 ? 0 : cur + 1;
                        const h = String(next).padStart(2, '0');
                        const newT = { ...timeState, hours: h };
                        setTimeState(newT);
                        setCurrentDraft(formatOutput(selectedDate || new Date(), newT));
                      }}
                      className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                    >
                      <ChevronUp className="w-2.5 h-2.5" />
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        const cur = Number(timeState.hours) || 0;
                        const next = cur <= 0 ? 23 : cur - 1;
                        const h = String(next).padStart(2, '0');
                        const newT = { ...timeState, hours: h };
                        setTimeState(newT);
                        setCurrentDraft(formatOutput(selectedDate || new Date(), newT));
                      }}
                      className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                    >
                      <ChevronDown className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
                <span className="text-[10px] text-center text-[#777777] mt-1 font-sans">Hours (0-23)</span>
              </div>

              {/* Minutes */}
              <div className="flex flex-col">
                <div className="relative flex items-center rounded-[6px] border border-[#262626] bg-[#121212] overflow-hidden focus-within:border-[#444444] transition-colors">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={timeState.minutes}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                      const num = Math.min(59, Number(val) || 0);
                      const m = val === '' ? '' : String(num).padStart(2, '0');
                      const newT = { ...timeState, minutes: m || '00' };
                      setTimeState(newT);
                      setCurrentDraft(formatOutput(selectedDate || new Date(), newT));
                    }}
                    onBlur={() => {
                      const m = String(Math.max(0, Math.min(59, Number(timeState.minutes) || 0))).padStart(2, '0');
                      const newT = { ...timeState, minutes: m };
                      setTimeState(newT);
                      setCurrentDraft(formatOutput(selectedDate || new Date(), newT));
                    }}
                    className="h-8 w-full bg-transparent pl-2.5 pr-5 text-center text-[13px] text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <div className="absolute right-0.5 top-0.5 bottom-0.5 flex flex-col justify-center border-l border-[#222222] pl-0.5">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        const cur = Number(timeState.minutes) || 0;
                        const next = cur >= 59 ? 0 : cur + 1;
                        const m = String(next).padStart(2, '0');
                        const newT = { ...timeState, minutes: m };
                        setTimeState(newT);
                        setCurrentDraft(formatOutput(selectedDate || new Date(), newT));
                      }}
                      className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                    >
                      <ChevronUp className="w-2.5 h-2.5" />
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        const cur = Number(timeState.minutes) || 0;
                        const next = cur <= 0 ? 59 : cur - 1;
                        const m = String(next).padStart(2, '0');
                        const newT = { ...timeState, minutes: m };
                        setTimeState(newT);
                        setCurrentDraft(formatOutput(selectedDate || new Date(), newT));
                      }}
                      className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                    >
                      <ChevronDown className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
                <span className="text-[10px] text-center text-[#777777] mt-1 font-sans">Min (0-59)</span>
              </div>

              {/* Seconds */}
              <div className="flex flex-col">
                <div className="relative flex items-center rounded-[6px] border border-[#262626] bg-[#121212] overflow-hidden focus-within:border-[#444444] transition-colors">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={timeState.seconds}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                      const num = Math.min(59, Number(val) || 0);
                      const s = val === '' ? '' : String(num).padStart(2, '0');
                      const newT = { ...timeState, seconds: s || '00' };
                      setTimeState(newT);
                      setCurrentDraft(formatOutput(selectedDate || new Date(), newT));
                    }}
                    onBlur={() => {
                      const s = String(Math.max(0, Math.min(59, Number(timeState.seconds) || 0))).padStart(2, '0');
                      const newT = { ...timeState, seconds: s };
                      setTimeState(newT);
                      setCurrentDraft(formatOutput(selectedDate || new Date(), newT));
                    }}
                    className="h-8 w-full bg-transparent pl-2.5 pr-5 text-center text-[13px] text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <div className="absolute right-0.5 top-0.5 bottom-0.5 flex flex-col justify-center border-l border-[#222222] pl-0.5">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        const cur = Number(timeState.seconds) || 0;
                        const next = cur >= 59 ? 0 : cur + 1;
                        const s = String(next).padStart(2, '0');
                        const newT = { ...timeState, seconds: s };
                        setTimeState(newT);
                        setCurrentDraft(formatOutput(selectedDate || new Date(), newT));
                      }}
                      className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                    >
                      <ChevronUp className="w-2.5 h-2.5" />
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        const cur = Number(timeState.seconds) || 0;
                        const next = cur <= 0 ? 59 : cur - 1;
                        const s = String(next).padStart(2, '0');
                        const newT = { ...timeState, seconds: s };
                        setTimeState(newT);
                        setCurrentDraft(formatOutput(selectedDate || new Date(), newT));
                      }}
                      className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                    >
                      <ChevronDown className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
                <span className="text-[10px] text-center text-[#777777] mt-1 font-sans">Sec (0-59)</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Edge-to-edge separator above footer */}
      <div className="-mx-3.5 border-t border-[#222222] my-2.5" />

      {/* Confirmation footer with formatted token preview and save/cancel */}
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-[12px] text-[#8c8c8c] font-mono truncate max-w-[170px]" title={currentDraft || 'NULL'}>
          {currentDraft || 'NULL'}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="px-2.5 py-1 rounded-[6px] text-[12px] font-sans text-[#8c8c8c] hover:text-white bg-[#141414] hover:bg-[#202020] border border-[#262626] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(currentDraft)}
            className="group relative flex shrink-0 items-center justify-center h-7 px-3.5 rounded-[6px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] text-[12.5px] font-sans"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25)]"
            />
            <span className="relative">Apply</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Foreign Key Record Preview Popover (Matching Reference Screenshot) ──────
interface ForeignKeyRecordPreviewPopoverProps {
  db: string;
  fk: ForeignKeyInfoApi;
  currentValue: unknown;
  anchorRect: { top: number; left: number; width: number; height: number };
  onClose: () => void;
  onOpenTable: (table: string) => void;
}

function ForeignKeyRecordPreviewPopover({
  db,
  fk,
  currentValue,
  anchorRect,
  onClose,
  onOpenTable,
}: ForeignKeyRecordPreviewPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<ColumnInfoApi[]>([]);
  const [row, setRow] = useState<Record<string, unknown>>({});
  const [hasRecord, setHasRecord] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const schemaRes = await api.getTableSchema(db, fk.referenced_table);
        if (!isMounted) return;
        const cols = schemaRes.columns || [];
        setColumns(cols);

        if (currentValue === null || currentValue === undefined || currentValue === '') {
          setHasRecord(false);
          setRow({});
          return;
        }

        const filter = JSON.stringify({
          [fk.referenced_column]: { eq: currentValue },
        });

        const rowsRes = await api.getTableRows(db, fk.referenced_table, {
          limit: 1,
          filter,
        });
        if (!isMounted) return;

        if (rowsRes.rows && rowsRes.rows.length > 0) {
          setRow(rowsRes.rows[0]);
          setHasRecord(true);
        } else {
          setHasRecord(false);
          setRow({});
        }
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load referenced record');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, [db, fk.referenced_table, fk.referenced_column, currentValue]);

  // Dismiss on outside click and Escape
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Position popover relative to clicked arrow button
  const popoverWidth = 440;
  const anchorBottom = anchorRect.top + anchorRect.height;
  const spaceBelow = window.innerHeight - anchorBottom;
  const openUpward = spaceBelow < 220 && anchorRect.top > 220;
  const top = openUpward ? anchorRect.top - 185 : anchorBottom + 6;
  let left = anchorRect.left - 20;
  if (left + popoverWidth > window.innerWidth - 16) {
    left = window.innerWidth - popoverWidth - 16;
  }
  if (left < 16) left = 16;

  return (
    <div
      ref={popoverRef}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${popoverWidth}px`,
      }}
      className="fixed z-50 rounded-[8px] border border-[#262626] bg-[#121212] shadow-[0_20px_50px_rgba(0,0,0,0.95)] p-3.5 flex flex-col font-sans overflow-hidden animate-in fade-in zoom-in-95 duration-100 select-text"
    >
      {/* Header title matching reference screenshot */}
      <div className="text-[13px] text-[#9c9c9c] font-sans flex items-center gap-1">
        <span>Referencing record from</span>
        <span className="font-semibold text-white">{fk.referenced_table}:</span>
      </div>

      {/* Mini Table Box */}
      <div className="border border-[#262626] rounded-[6px] overflow-hidden bg-[#0c0c0c] mt-2.5">
        {isLoading ? (
          <div className="p-6 flex items-center justify-center gap-2 text-center text-[#888888] text-[12.5px]">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
            <span>Loading reference...</span>
          </div>
        ) : error ? (
          <div className="p-4 text-center text-rose-400 text-[12px]">{error}</div>
        ) : (
          <div className="overflow-x-auto max-w-full">
            <table className="table-auto min-w-full border-collapse text-left font-sans text-[13px]">
              <thead>
                <tr className="bg-[#141414] border-b border-[#262626] text-[#8c8c8c]">
                  {columns.map((col) => (
                    <th
                      key={col.name}
                      className="px-3.5 py-2 font-medium whitespace-nowrap border-r border-[#262626] last:border-r-0"
                    >
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        {col.primary_key && <Key className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                        <span className="text-white font-medium text-[13px]">{col.name}</span>
                        <span className="text-[11.5px] font-mono text-[#777777]">{col.type}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hasRecord ? (
                  <tr className="bg-[#0e0e0e]">
                    {columns.map((col) => {
                      const cellVal = row[col.name];
                      const isNull = cellVal === null || cellVal === undefined;
                      const strVal = isNull ? 'null' : String(cellVal);
                      return (
                        <td
                          key={col.name}
                          className="px-3.5 py-2 whitespace-nowrap border-r border-[#262626] last:border-r-0 text-[13px] text-white"
                        >
                          {isNull ? (
                            <span className="text-[#555555] italic text-[12px]">null</span>
                          ) : (
                            <span>{strVal}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ) : (
                  <tr>
                    <td
                      colSpan={columns.length || 1}
                      className="p-4 text-center text-[#777777] text-[12.5px]"
                    >
                      {currentValue === null || currentValue === undefined || currentValue === ''
                        ? 'No record referenced (value is null)'
                        : `No record found with ${fk.referenced_column} = "${String(currentValue)}"`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer toolbar matching reference screenshot */}
      <div className="mt-3 flex items-center justify-end">
        <button
          type="button"
          onClick={() => onOpenTable(fk.referenced_table)}
          className="h-7 px-3 rounded-[6px] border border-[#2e2e2e] bg-[#1a1a1a] hover:bg-[#252525] hover:border-[#3a3a3a] text-white text-[12.5px] font-medium font-sans transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
        >
          <span>Open table</span>
        </button>
      </div>
    </div>
  );
}

// ─── Foreign Key Reference Record Picker Modal (Matching Image 1 & 2) ────────
interface ForeignKeyPickerModalProps {
  db: string;
  fk: ForeignKeyInfoApi;
  currentValue: unknown;
  onSelect: (val: unknown) => void;
  onClose: () => void;
}

function ForeignKeyPickerModal({
  db,
  fk,
  currentValue,
  onSelect,
  onClose,
}: ForeignKeyPickerModalProps) {
  const [refColumns, setRefColumns] = useState<ColumnInfoApi[]>([]);
  const [refRows, setRefRows] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState<number>(25);
  const [showPageSizePopover, setShowPageSizePopover] = useState(false);
  const pageSizePopoverRef = useRef<HTMLDivElement>(null);
  const [showSortPopover, setShowSortPopover] = useState(false);
  const sortPopoverRef = useRef<HTMLDivElement>(null);
  const [selectedRecordVal, setSelectedRecordVal] = useState<unknown>(currentValue);

  // Close popovers on outside click
  useEffect(() => {
    if (!showSortPopover && !showPageSizePopover) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (sortPopoverRef.current && !sortPopoverRef.current.contains(e.target as Node)) {
        setShowSortPopover(false);
      }
      if (pageSizePopoverRef.current && !pageSizePopoverRef.current.contains(e.target as Node)) {
        setShowPageSizePopover(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [showSortPopover, showPageSizePopover]);

  const loadData = useCallback(async (targetCursor?: string | null, sizeOverride?: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const schemaRes = await api.getTableSchema(db, fk.referenced_table);
      setRefColumns(schemaRes.columns || []);

      const effectiveLimit = sizeOverride || pageSize;
      const rowsRes = await api.getTableRows(db, fk.referenced_table, {
        limit: effectiveLimit,
        cursor: targetCursor || undefined,
        sort: sortCol || undefined,
        order: sortOrder,
      });
      setRefRows(rowsRes.rows || []);
      setHasNextPage(!!rowsRes.pagination?.has_more);
      setCursor(rowsRes.pagination?.next_cursor || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load referenced table');
    } finally {
      setIsLoading(false);
    }
  }, [db, fk.referenced_table, sortCol, sortOrder, pageSize]);

  useEffect(() => {
    loadData(null);
  }, [loadData]);

  const handleNext = () => {
    if (!cursor) return;
    setCursorHistory((prev) => [...prev, cursor]);
    loadData(cursor);
  };

  const handlePrev = () => {
    if (cursorHistory.length === 0) return;
    const newHistory = [...cursorHistory];
    newHistory.pop();
    const prevCursor = newHistory[newHistory.length - 1] || null;
    setCursorHistory(newHistory);
    loadData(prevCursor);
  };

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return refRows;
    const q = searchTerm.toLowerCase();
    return refRows.filter((r) =>
      Object.values(r).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [refRows, searchTerm]);

  return (
    <SlideOver
      isOpen={true}
      onClose={onClose}
      zIndex="z-[60]"
      width="w-[840px] xl:w-[940px] max-w-full"
      title={
        <div className="flex items-center gap-2 truncate">
          <span className="text-[16px] font-medium text-white font-sans">
            Select record to reference
          </span>
          <code className="px-2 py-0.5 rounded-[5px] bg-[#161616] border border-[#2a2a2a] text-[13px] font-mono text-[#e0e0e0]">
            {fk.referenced_table}
          </code>
        </div>
      }
      subtitle={
        <span className="text-[13px] text-[#8c8c8c] font-sans">
          Referencing <code className="text-[#cccccc] font-mono">{fk.referenced_column}</code> for column <code className="text-[#cccccc] font-mono">{fk.column}</code>
        </span>
      }
    >
      <div className="flex-1 flex flex-col min-h-0 bg-[#0e0e0e] overflow-hidden font-sans">
        {/* Main Table Styled Toolbar */}
        <div className="px-4 sm:px-5 py-2.5 flex items-center justify-between border-b border-[#222222] bg-[#0a0a0a] select-none shrink-0 gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#666666]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search rows..."
                className="h-8 pl-8 pr-7 w-48 sm:w-56 rounded-[6px] bg-[#121212] border border-[#262626] focus:border-[#3b82f6] text-[13px] text-white placeholder-[#555555] outline-none transition-colors"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#666666] hover:text-white cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Sort Popover Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSortPopover(!showSortPopover)}
                className={`flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] border text-[13px] font-medium transition-colors cursor-pointer ${
                  sortCol
                    ? 'bg-blue-600/10 border-blue-500/30 text-blue-400 hover:bg-blue-600/20'
                    : 'bg-[#141414] border-[#262626] text-[#cccccc] hover:text-white hover:border-[#383838]'
                }`}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span>{sortCol ? `Sort: ${sortCol}` : 'Sort'}</span>
              </button>

              {showSortPopover && (
                <div
                  ref={sortPopoverRef}
                  className="absolute left-0 top-full mt-1.5 w-64 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-3 z-50 font-sans"
                >
                  <div className="text-[13px] font-semibold text-white mb-2">Sort Records</div>
                  <div className="space-y-2">
                    <select
                      value={sortCol || ''}
                      onChange={(e) => setSortCol(e.target.value || null)}
                      className="w-full h-8 px-2 bg-[#161616] border border-[#2c2c2c] rounded text-[13px] text-white outline-none cursor-pointer"
                    >
                      <option value="">Select column...</option>
                      {refColumns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSortOrder('asc')}
                        className={`flex-1 h-7 rounded text-[12px] font-medium border cursor-pointer ${
                          sortOrder === 'asc'
                            ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                            : 'bg-[#161616] border-[#2c2c2c] text-[#8c8c8c]'
                        }`}
                      >
                        ASC
                      </button>
                      <button
                        type="button"
                        onClick={() => setSortOrder('desc')}
                        className={`flex-1 h-7 rounded text-[12px] font-medium border cursor-pointer ${
                          sortOrder === 'desc'
                            ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                            : 'bg-[#161616] border-[#2c2c2c] text-[#8c8c8c]'
                        }`}
                      >
                        DESC
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSortCol(null);
                          setShowSortPopover(false);
                        }}
                        className="text-[12px] text-[#8c8c8c] hover:text-white cursor-pointer"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSortPopover(false);
                          loadData(null);
                        }}
                        className="px-2.5 py-1 bg-[#222222] hover:bg-[#2a2a2a] border border-[#333333] rounded text-[12px] font-medium text-white transition-colors cursor-pointer"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={() => loadData(null)}
              disabled={isLoading}
              title="Refresh rows"
              className="w-8 h-8 flex items-center justify-center rounded-[6px] bg-[#141414] border border-[#262626] text-[#8c8c8c] hover:text-white hover:border-[#383838] transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Pagination Controls & Page Size */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Custom Page Size Dropdown */}
            <div className="relative" ref={pageSizePopoverRef}>
              <button
                type="button"
                onClick={() => setShowPageSizePopover(!showPageSizePopover)}
                className="flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] hover:text-white hover:border-[#383838] text-[13px] font-medium transition-colors cursor-pointer"
                title="Page size"
              >
                <span>{pageSize}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-[#777777] transition-transform duration-150 ${
                    showPageSizePopover ? 'rotate-180 text-white' : ''
                  }`}
                />
              </button>

              {showPageSizePopover && (
                <div className="absolute right-0 top-full mt-1.5 w-24 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-1 z-50 font-sans animate-in fade-in duration-100">
                  {[25, 50, 100, 250, 500].map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => {
                        setPageSize(sz);
                        setCursorHistory([]);
                        loadData(null, sz);
                        setShowPageSizePopover(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors cursor-pointer font-sans ${
                        pageSize === sz
                          ? 'bg-blue-600/15 text-blue-400 font-medium'
                          : 'text-[#cccccc] hover:bg-[#1a1a1a] hover:text-white'
                      }`}
                    >
                      <span>{sz}</span>
                      {pageSize === sz && <Check className="w-3.5 h-3.5 text-blue-400" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handlePrev}
              disabled={cursorHistory.length === 0 || isLoading}
              className="flex items-center gap-1 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] disabled:opacity-40 hover:text-white hover:border-[#383838] transition-colors cursor-pointer"
              title="Previous page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span className="text-[13px] font-medium">Previous</span>
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!hasNextPage || isLoading}
              className="flex items-center gap-1 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] disabled:opacity-40 hover:text-white hover:border-[#383838] transition-colors cursor-pointer"
              title="Next page"
            >
              <span className="text-[13px] font-medium">Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Main Table Styled Grid */}
        <div className="flex-1 overflow-auto bg-[#0a0a0a]">
          {isLoading && refRows.length === 0 ? (
            <div className="p-4 space-y-2 animate-pulse">
              <div className="h-9 bg-[#161616] rounded-[6px]" />
              <div className="h-9 bg-[#141414] rounded-[6px]" />
              <div className="h-9 bg-[#161616] rounded-[6px]" />
              <div className="h-9 bg-[#141414] rounded-[6px]" />
              <div className="h-9 bg-[#161616] rounded-[6px]" />
            </div>
          ) : error ? (
            <div className="p-8 flex flex-col items-center justify-center text-center">
              <AlertCircle className="w-8 h-8 text-rose-500 mb-2" />
              <p className="text-[14px] font-medium text-white mb-1">Failed to query table</p>
              <p className="text-[12.5px] text-[#8c8c8c] max-w-md font-mono">{error}</p>
              <button
                type="button"
                onClick={() => loadData(null)}
                className="mt-4 px-3 py-1.5 bg-[#141414] border border-[#262626] rounded-[6px] text-[12px] text-white hover:border-[#383838] cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="p-12 text-center text-[#777777] text-[14px]">
              No records found in table <span className="font-sans font-medium text-white">{fk.referenced_table}</span>
            </div>
          ) : (
            <table
              className="border-collapse text-left select-text font-sans text-[14px] table-fixed"
              style={{ width: 'max-content', minWidth: '100%' }}
            >
              <thead>
                <tr className="sticky top-0 z-10 bg-[#0a0a0a] border-b border-[#222222]">
                  {/* Sticky selection column */}
                  <th
                    className="w-12 px-3 py-2 text-center bg-[#0a0a0a] sticky left-0 z-20 border-r border-[#1a1a1a] select-none text-[12px] font-mono text-[#666666]"
                    style={{ width: '48px', minWidth: '48px', maxWidth: '48px' }}
                  >
                    #
                  </th>

                  {/* Header Columns */}
                  {refColumns.map((col) => {
                    const width = getDefaultColumnWidth(col.type, col.name);
                    return (
                      <th
                        key={col.name}
                        className="relative px-3 py-2 text-[14px] font-medium text-[#cccccc] whitespace-nowrap border-r border-[#1a1a1a] select-none"
                        style={{ width: `${width}px`, minWidth: `${Math.max(80, width)}px`, maxWidth: `${width}px` }}
                      >
                        <div className="flex items-center gap-1.5 min-w-0 pr-2.5 overflow-hidden whitespace-nowrap">
                          <span className="font-sans text-white text-[14px] whitespace-nowrap shrink-0" title={col.name}>
                            {col.name}
                          </span>
                          {col.primary_key && (
                            <span title="Primary Key" className="shrink-0 p-0.5 rounded bg-emerald-500/10 text-emerald-400">
                              <Key className="w-3 h-3" />
                            </span>
                          )}
                          {col.name === fk.referenced_column && !col.primary_key && (
                            <span title="Referenced Column" className="shrink-0 p-0.5 rounded bg-blue-500/10 text-blue-400">
                              <Link2 className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody className="divide-y divide-[#181818]">
                {filteredRows.map((r, ri) => {
                  const refVal = r[fk.referenced_column];
                  const isSelected = selectedRecordVal !== undefined && String(refVal) === String(selectedRecordVal);

                  return (
                    <tr
                      key={ri}
                      onClick={() => setSelectedRecordVal(refVal)}
                      onDoubleClick={() => onSelect(refVal)}
                      className={`transition-colors cursor-pointer group ${
                        isSelected
                          ? 'bg-[#131b2e] ring-1 ring-inset ring-blue-500/40 text-white'
                          : 'hover:bg-[#121212]'
                      }`}
                    >
                      {/* Sticky Radio Indicator Column */}
                      <td
                        className={`px-3 py-2 text-center select-none sticky left-0 z-10 border-r border-[#1a1a1a] transition-colors ${
                          isSelected ? 'bg-[#131b2e]' : 'bg-[#0a0a0a] group-hover:bg-[#121212]'
                        }`}
                        style={{ width: '48px', minWidth: '48px', maxWidth: '48px' }}
                      >
                        <div className="flex items-center justify-center">
                          <div
                            className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                              isSelected
                                ? 'bg-blue-600 border-blue-500 text-white shadow-xs'
                                : 'border-[#333333] bg-[#141414] group-hover:border-[#555555]'
                            }`}
                          >
                            {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                          </div>
                        </div>
                      </td>

                      {/* Data Cells matching main table cell styling */}
                      {refColumns.map((col) => {
                        const width = getDefaultColumnWidth(col.type, col.name);
                        const cellVal = r[col.name];
                        const isNull = cellVal === null || cellVal === undefined;
                        const isBool = typeof cellVal === 'boolean';
                        const isObj = typeof cellVal === 'object' && cellVal !== null;
                        const strVal = isNull ? 'null' : isObj ? JSON.stringify(cellVal) : String(cellVal);

                        return (
                          <td
                            key={col.name}
                            className="px-3 py-2 text-[#cccccc] text-[14px] whitespace-nowrap overflow-hidden border-r border-[#151515] relative transition-colors select-none"
                            style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
                            title={strVal}
                          >
                            {isNull ? (
                              <span className="text-[#555555] italic text-[12.5px]">null</span>
                            ) : isBool ? (
                              <span
                                className={`px-1.5 py-0.5 rounded text-[12.5px] font-medium ${
                                  cellVal ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                                }`}
                              >
                                {cellVal ? 'true' : 'false'}
                              </span>
                            ) : isObj ? (
                              <span className="text-pink-400 flex items-center gap-1 text-[12.5px]">
                                <Code2 className="w-3.5 h-3.5" />
                                {`{ ... }`}
                              </span>
                            ) : (
                              <span
                                className={`truncate ${
                                  col.name === fk.referenced_column && isSelected
                                    ? 'font-medium text-blue-400'
                                    : ''
                                }`}
                              >
                                {strVal}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Toolbar with Apply Button */}
        <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-between font-sans shrink-0">
          <div className="flex items-center gap-2 text-[13px] text-[#888888]">
            <span>
              Selected <span className="text-[#cccccc]">{fk.referenced_column}</span>:{' '}
              <code className="text-white font-mono bg-[#161616] px-1.5 py-0.5 rounded border border-[#262626]">
                {selectedRecordVal !== undefined && selectedRecordVal !== null ? String(selectedRecordVal) : 'None'}
              </code>
            </span>
            <span className="text-[#444444]">·</span>
            <span>{filteredRows.length} records</span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedRecordVal === undefined}
              onClick={() => {
                if (selectedRecordVal !== undefined) {
                  onSelect(selectedRecordVal);
                }
              }}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] disabled:opacity-40 disabled:cursor-not-allowed font-sans"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative flex items-center text-[14px] font-sans">
                Select Record
              </span>
            </button>
          </div>
        </div>
      </div>
    </SlideOver>
  );
}

// ─── Single-Line Date/Time/Timestamp Input with Calendar Picker Popover ────────
interface DateTimePickerInputProps {
  value: unknown;
  onChange: (val: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  isDateOnly?: boolean;
}

function DateTimePickerInput({
  value,
  onChange,
  placeholder = 'YYYY-MM-DD HH:mm:ss',
  disabled = false,
  isDateOnly = false,
}: DateTimePickerInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const calculateDirection = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      // Calendar popover is around 420px height with time controls
      if (spaceBelow < 440 && rect.top > spaceBelow) {
        setOpenUpward(true);
      } else {
        setOpenUpward(false);
      }
    }
  };

  const strVal = value === null || value === undefined ? '' : String(value);

  // Parse date, time, and timezone portions from string value
  const parseVal = () => {
    if (!strVal.trim()) {
      return { date: undefined, hours: '12', minutes: '00', seconds: '00', tz: '' };
    }
    const parts = strVal.trim().split(/[T ]/);
    const dateStr = parts[0] || '';
    const timeFull = parts[1] || '';

    let d: Date | undefined;
    const dateParts = dateStr.split('-').map(Number);
    if (dateParts.length === 3 && dateParts.every((n) => !isNaN(n))) {
      const parsedDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
      if (!isNaN(parsedDate.getTime())) {
        d = parsedDate;
      }
    }

    let hours = '12';
    let minutes = '00';
    let seconds = '00';
    let tz = '';

    if (timeFull) {
      // Check for timezone offset (+00:00, -05, Z, UTC)
      const tzMatch = timeFull.match(/([+-]\d{2}(?::?\d{2})?|Z|[A-Z]{2,4})$/i);
      if (tzMatch) {
        tz = tzMatch[0];
      }
      const timeWithoutTz = tz ? timeFull.slice(0, -tz.length) : timeFull;
      const tParts = timeWithoutTz.split(':');
      if (tParts[0] !== undefined) hours = tParts[0].padStart(2, '0');
      if (tParts[1] !== undefined) minutes = tParts[1].padStart(2, '0');
      if (tParts[2] !== undefined) seconds = tParts[2].split('.')[0].padStart(2, '0');
    }

    return { date: d, hours, minutes, seconds, tz };
  };

  const parsed = parseVal();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(parsed.date);
  const [month, setMonth] = useState<Date>(() => parsed.date || new Date());
  const [timeState, setTimeState] = useState({
    hours: parsed.hours,
    minutes: parsed.minutes,
    seconds: parsed.seconds,
    tz: parsed.tz,
  });

  useEffect(() => {
    if (isOpen) {
      const p = parseVal();
      setSelectedDate(p.date);
      setMonth(p.date || new Date());
      setTimeState({ hours: p.hours, minutes: p.minutes, seconds: p.seconds, tz: p.tz });
    }
  }, [isOpen, strVal]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const commitValue = (
    dateObj: Date | undefined,
    timeObj: { hours: string; minutes: string; seconds: string; tz: string }
  ) => {
    if (!dateObj) {
      onChange(null);
      return;
    }
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    const datePart = `${y}-${m}-${d}`;

    if (isDateOnly) {
      onChange(datePart);
    } else {
      const h = String(timeObj.hours).padStart(2, '0');
      const min = String(timeObj.minutes).padStart(2, '0');
      const s = String(timeObj.seconds).padStart(2, '0');
      const tzSuffix = timeObj.tz ? ` ${timeObj.tz}` : '';
      onChange(`${datePart} ${h}:${min}:${s}${tzSuffix}`);
    }
  };

  const handleSelectDate = (date: Date | undefined) => {
    setSelectedDate(date);
    commitValue(date, timeState);
  };

  const handleSetNow = () => {
    const now = new Date();
    setSelectedDate(now);
    const newTime = {
      hours: String(now.getHours()).padStart(2, '0'),
      minutes: String(now.getMinutes()).padStart(2, '0'),
      seconds: String(now.getSeconds()).padStart(2, '0'),
      tz: timeState.tz,
    };
    setTimeState(newTime);
    commitValue(now, newTime);
  };

  // Detect timezone name (e.g. "GMT+6", "UTC", "PST")
  const localTz = useMemo(() => {
    try {
      const d = new Date();
      const match = d.toTimeString().match(/\((.+)\)$/);
      if (match) return match[1];
      const offset = -d.getTimezoneOffset() / 60;
      return offset >= 0 ? `UTC+${offset}` : `UTC${offset}`;
    } catch {
      return 'UTC';
    }
  }, []);

  const activeTz = timeState.tz || localTz;

  return (
    <div className="relative w-full" ref={containerRef}>
      <div className="relative flex items-center">
        <input
          type="text"
          disabled={disabled}
          value={strVal}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          className={`h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-10 text-[14px] text-white font-sans focus:outline-none focus:border-[#3b82f6] transition-colors placeholder-[#555555] ${
            disabled ? 'opacity-60 cursor-not-allowed bg-[#0d0d0d]' : ''
          }`}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!isOpen) calculateDirection();
            setIsOpen((prev) => !prev);
          }}
          title="Open calendar picker"
          className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-[5px] text-[#8c8c8c] hover:text-white hover:bg-[#1f1f1f] transition-colors cursor-pointer ${
            isOpen ? 'text-[#3b82f6] bg-[#1a1a1a]' : ''
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Calendar className="w-4 h-4 shrink-0" />
        </button>
      </div>

      {isOpen && (
        <div
          className={`absolute right-0 ${
            openUpward ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
          } z-50 w-[340px] max-w-[calc(100vw-32px)] rounded-[8px] border border-[#262626] bg-[#0c0c0c] shadow-[0_16px_40px_rgba(0,0,0,0.95)] p-3.5 animate-in fade-in duration-100 font-sans`}
        >
          {/* Header Bar without top duplicate preview */}
          <div className="pb-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-white flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#8c8c8c]" />
                <span>{isDateOnly ? 'Select Date' : 'Select Date & Time'}</span>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleSetNow}
                  className="px-2 py-0.5 rounded-[4px] text-[11.5px] font-medium bg-[#161616] hover:bg-[#222222] text-[#cccccc] hover:text-white border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer"
                >
                  Now
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange(null);
                    setSelectedDate(undefined);
                    setIsOpen(false);
                  }}
                  className="px-2 py-0.5 rounded-[4px] text-[11.5px] font-medium bg-[#161616] hover:bg-[#222222] text-[#8c8c8c] hover:text-white border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer"
                >
                  NULL
                </button>
              </div>
            </div>
          </div>

          {/* Edge-to-edge separator above calendar */}
          <div className="-mx-3 border-t border-[#222222] mb-2" />

          {/* Calendar Grid */}
          <div className="axiom-datepicker-wrapper w-full py-1">
            <DayPicker
              mode="single"
              selected={selectedDate}
              month={month}
              onMonthChange={setMonth}
              onSelect={handleSelectDate}
              className="m-0 text-white font-sans text-[12px] w-full"
            />
          </div>

          {/* Detailed Time Selector (for timestamp / time types) */}
          {!isDateOnly && (
            <>
              {/* Edge-to-edge separator above time controls */}
              <div className="-mx-3 border-t border-[#222222] my-2" />

              <div className="pt-0.5">
                <div className="flex items-center justify-between text-[12px] text-[#8c8c8c] mb-2">
                  <span className="font-medium text-[#cccccc]">
                    Time of Day
                  </span>
                  <div className="flex items-center gap-1.5 font-mono text-[11px]">
                    <span className="text-[#cccccc] bg-[#141414] px-1.5 py-0.5 rounded border border-[#262626] font-medium">
                      {activeTz}
                    </span>
                    <span className="text-[#777777] bg-[#141414] px-1.5 py-0.5 rounded border border-[#222222]">
                      24h
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 font-mono">
                  {/* Hours */}
                  <div className="flex flex-col">
                    <div className="relative flex items-center rounded-[6px] border border-[#262626] bg-[#121212] overflow-hidden focus-within:border-[#444444] transition-colors">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={timeState.hours}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                          const num = Math.min(23, Number(val) || 0);
                          const h = val === '' ? '' : String(num).padStart(2, '0');
                          const newT = { ...timeState, hours: h || '00' };
                          setTimeState(newT);
                          commitValue(selectedDate || new Date(), newT);
                        }}
                        onBlur={() => {
                          const h = String(Math.max(0, Math.min(23, Number(timeState.hours) || 0))).padStart(2, '0');
                          const newT = { ...timeState, hours: h };
                          setTimeState(newT);
                          commitValue(selectedDate || new Date(), newT);
                        }}
                        className="h-8 w-full bg-transparent pl-2.5 pr-5 text-center text-[13px] text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <div className="absolute right-0.5 top-0.5 bottom-0.5 flex flex-col justify-center border-l border-[#222222] pl-0.5">
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.hours) || 0;
                            const next = cur >= 23 ? 0 : cur + 1;
                            const h = String(next).padStart(2, '0');
                            const newT = { ...timeState, hours: h };
                            setTimeState(newT);
                            commitValue(selectedDate || new Date(), newT);
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.hours) || 0;
                            const next = cur <= 0 ? 23 : cur - 1;
                            const h = String(next).padStart(2, '0');
                            const newT = { ...timeState, hours: h };
                            setTimeState(newT);
                            commitValue(selectedDate || new Date(), newT);
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                    <span className="text-[10px] text-center text-[#777777] mt-1 font-sans">Hours (0-23)</span>
                  </div>

                  {/* Minutes */}
                  <div className="flex flex-col">
                    <div className="relative flex items-center rounded-[6px] border border-[#262626] bg-[#121212] overflow-hidden focus-within:border-[#444444] transition-colors">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={timeState.minutes}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                          const num = Math.min(59, Number(val) || 0);
                          const m = val === '' ? '' : String(num).padStart(2, '0');
                          const newT = { ...timeState, minutes: m || '00' };
                          setTimeState(newT);
                          commitValue(selectedDate || new Date(), newT);
                        }}
                        onBlur={() => {
                          const m = String(Math.max(0, Math.min(59, Number(timeState.minutes) || 0))).padStart(2, '0');
                          const newT = { ...timeState, minutes: m };
                          setTimeState(newT);
                          commitValue(selectedDate || new Date(), newT);
                        }}
                        className="h-8 w-full bg-transparent pl-2.5 pr-5 text-center text-[13px] text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <div className="absolute right-0.5 top-0.5 bottom-0.5 flex flex-col justify-center border-l border-[#222222] pl-0.5">
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.minutes) || 0;
                            const next = cur >= 59 ? 0 : cur + 1;
                            const m = String(next).padStart(2, '0');
                            const newT = { ...timeState, minutes: m };
                            setTimeState(newT);
                            commitValue(selectedDate || new Date(), newT);
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.minutes) || 0;
                            const next = cur <= 0 ? 59 : cur - 1;
                            const m = String(next).padStart(2, '0');
                            const newT = { ...timeState, minutes: m };
                            setTimeState(newT);
                            commitValue(selectedDate || new Date(), newT);
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                    <span className="text-[10px] text-center text-[#777777] mt-1 font-sans">Min (0-59)</span>
                  </div>

                  {/* Seconds */}
                  <div className="flex flex-col">
                    <div className="relative flex items-center rounded-[6px] border border-[#262626] bg-[#121212] overflow-hidden focus-within:border-[#444444] transition-colors">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={timeState.seconds}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                          const num = Math.min(59, Number(val) || 0);
                          const s = val === '' ? '' : String(num).padStart(2, '0');
                          const newT = { ...timeState, seconds: s || '00' };
                          setTimeState(newT);
                          commitValue(selectedDate || new Date(), newT);
                        }}
                        onBlur={() => {
                          const s = String(Math.max(0, Math.min(59, Number(timeState.seconds) || 0))).padStart(2, '0');
                          const newT = { ...timeState, seconds: s };
                          setTimeState(newT);
                          commitValue(selectedDate || new Date(), newT);
                        }}
                        className="h-8 w-full bg-transparent pl-2.5 pr-5 text-center text-[13px] text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <div className="absolute right-0.5 top-0.5 bottom-0.5 flex flex-col justify-center border-l border-[#222222] pl-0.5">
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.seconds) || 0;
                            const next = cur >= 59 ? 0 : cur + 1;
                            const s = String(next).padStart(2, '0');
                            const newT = { ...timeState, seconds: s };
                            setTimeState(newT);
                            commitValue(selectedDate || new Date(), newT);
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.seconds) || 0;
                            const next = cur <= 0 ? 59 : cur - 1;
                            const s = String(next).padStart(2, '0');
                            const newT = { ...timeState, seconds: s };
                            setTimeState(newT);
                            commitValue(selectedDate || new Date(), newT);
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                    <span className="text-[10px] text-center text-[#777777] mt-1 font-sans">Sec (0-59)</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Edge-to-edge separator above footer */}
          <div className="-mx-3 border-t border-[#222222] my-2.5" />

          {/* Confirmation footer with formatted token preview and done button */}
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-[12px] text-[#8c8c8c] font-mono truncate max-w-[190px]">
              {strVal || 'NULL'}
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="group relative flex shrink-0 items-center justify-center h-7 px-3.5 rounded-[6px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] text-[12.5px] font-sans"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative">Done</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Table Skeleton Loader (Supabase Studio inspired) ───────────────────────────
// Preserves exact grid layout and column proportions during schema or row loading.
// Eliminates cumulative layout shifts (CLS) and avoids jarring "0 rows" flickers on reload.
function TableSkeleton({
  columns,
  foreignKeys,
  columnWidths,
}: {
  columns: ColumnInfoApi[];
  foreignKeys: ForeignKeyInfoApi[];
  columnWidths?: Record<string, number>;
}) {
  const skeletonColCount = columns.length > 0 ? columns.length : 6;
  const skeletonRowCount = 12;

  return (
    <table
      className="border-collapse text-left select-none font-sans text-[14px] table-fixed"
      style={{ width: 'max-content' }}
    >
      <thead>
        <tr className="sticky top-0 z-10 bg-[#0a0a0a] border-b border-[#222222]">
          {/* Row Checkbox & Action Sticky Column */}
          <th
            className="w-16 px-3 py-2 text-left bg-[#0a0a0a] border-r border-[#1a1a1a]"
            style={{ width: '64px', minWidth: '64px', maxWidth: '64px' }}
          >
            <div className="flex items-center justify-start gap-1.5">
              <div className="w-3.5 h-3.5 rounded border border-[#262626] bg-[#141414]" />
              <div className="w-3.5 h-3.5 rounded border border-[#222222] bg-[#121212]" />
            </div>
          </th>

          {/* Column Header Skeletons or Introspected Columns */}
          {columns.length > 0 ? (
            columns.map((col) => {
              const isFk = foreignKeys.some((fk) => fk.column === col.name);
              const badge = getColumnTypeBadge(col.type, col.primary_key, isFk);
              const width = columnWidths?.[col.name] || getDefaultColumnWidth(col.type, col.name);

              return (
                <th
                  key={col.name}
                  className="px-3 py-2 text-[14px] font-medium text-[#cccccc] whitespace-nowrap border-r border-[#1a1a1a]"
                  style={{ width: `${width}px`, minWidth: `${Math.max(80, width)}px`, maxWidth: `${width}px` }}
                >
                  <div className="flex items-center gap-1.5 min-w-0 pr-2.5 overflow-hidden whitespace-nowrap">
                    <span className="font-sans text-white text-[14px] whitespace-nowrap shrink-0">{col.name}</span>
                    {col.primary_key && (
                      <span title="Primary Key" className="shrink-0 p-0.5 rounded bg-amber-500/10 text-amber-400">
                        <Key className="w-3 h-3" />
                      </span>
                    )}
                    {isFk && (
                      <span title="Foreign Key" className="shrink-0 p-0.5 rounded bg-blue-500/10 text-blue-400">
                        <Link2 className="w-3 h-3" />
                      </span>
                    )}
                    <span className={`text-[12.5px] font-mono whitespace-nowrap shrink-0 ${badge.color}`}>
                      {formatColumnType(col.type)}
                    </span>
                  </div>
                </th>
              );
            })
          ) : (
            Array.from({ length: skeletonColCount }).map((_, i) => (
              <th
                key={i}
                className="px-3 py-2 border-r border-[#1a1a1a]"
                style={{ width: '160px', minWidth: '160px', maxWidth: '160px' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="h-4 w-16 bg-[#1a1a1a] rounded animate-pulse" />
                  <div className="h-3 w-10 bg-[#141414] rounded animate-pulse" />
                </div>
              </th>
            ))
          )}
        </tr>
      </thead>

      <tbody className="divide-y divide-[#181818]">
        {Array.from({ length: skeletonRowCount }).map((_, rIdx) => (
          <tr key={rIdx} className="h-9 hover:bg-[#101010]/50 transition-colors">
            <td
              className="px-3 py-2 text-left border-r border-[#1a1a1a]"
              style={{ width: '64px', minWidth: '64px', maxWidth: '64px' }}
            >
              <div className="flex items-center justify-start gap-1.5 opacity-40">
                <div className="w-3.5 h-3.5 rounded border border-[#262626] bg-[#141414]" />
                <div className="w-3.5 h-3.5 rounded border border-[#222222] bg-[#121212]" />
              </div>
            </td>
            {columns.length > 0 ? (
              columns.map((col, cIdx) => {
                const width = columnWidths?.[col.name] || getDefaultColumnWidth(col.type, col.name);
                const seed = (rIdx * 7 + cIdx * 13) % 60;
                const barWidth = Math.min(width - 24, Math.max(40, 50 + seed * 2));
                return (
                  <td
                    key={col.name}
                    className="px-3 py-2 border-r border-[#151515]"
                    style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
                  >
                    <div
                      className="h-3.5 bg-[#161616] rounded animate-pulse"
                      style={{ width: `${barWidth}px` }}
                    />
                  </td>
                );
              })
            ) : (
              Array.from({ length: skeletonColCount }).map((_, cIdx) => {
                const seed = (rIdx * 11 + cIdx * 17) % 70;
                const barWidth = Math.min(130, Math.max(45, 55 + seed * 2));
                return (
                  <td
                    key={cIdx}
                    className="px-3 py-2 border-r border-[#151515]"
                    style={{ width: '160px', minWidth: '160px', maxWidth: '160px' }}
                  >
                    <div
                      className="h-3.5 bg-[#161616] rounded animate-pulse"
                      style={{ width: `${barWidth}px` }}
                    />
                  </td>
                );
              })
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TableEditor() {
  // ─── Database Selection State ──────────────────────────────────────────────
  const [databases, setDatabases] = useState<DatabaseRecordApi[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [isDbsLoading, setIsDbsLoading] = useState(true);
  const [isDbDropdownOpen, setIsDbDropdownOpen] = useState(false);
  const dbDropdownRef = useRef<HTMLDivElement>(null);

  // ─── View Modes: 'grid' (Table Editor) | 'schema' (Schema & Relations) | 'sql' (SQL Console) ─
  const [viewMode, setViewMode] = useState<'grid' | 'schema' | 'sql'>('grid');

  // ─── Table Catalog State ───────────────────────────────────────────────────
  const [tables, setTables] = useState<TableInfoApi[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [tableSearch, setTableSearch] = useState('');
  const [isTablesLoading, setIsTablesLoading] = useState(false);

  // ─── Schema Metadata State ─────────────────────────────────────────────────
  const [columns, setColumns] = useState<ColumnInfoApi[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfoApi[]>([]);
  const [isSchemaLoading, setIsSchemaLoading] = useState(false);
  const [allDbTablesSchema, setAllDbTablesSchema] = useState<
    Record<string, { columns: ColumnInfoApi[]; foreign_keys: ForeignKeyInfoApi[] }>
  >({});
  // Stable ref mirror of allDbTablesSchema — read inside useCallback without it being a dep.
  // WHY: allDbTablesSchema in useCallback deps causes loadTableData to be recreated on every schema
  // cache write, re-triggering the table-change useEffect in an infinite loop that drops all rows.
  const schemaCacheRef = useRef<Record<string, { columns: ColumnInfoApi[]; foreign_keys: ForeignKeyInfoApi[] }>>({});
  useEffect(() => {
    schemaCacheRef.current = allDbTablesSchema;
  }, [allDbTablesSchema]);

  // ─── Data Grid Rows & Pagination ───────────────────────────────────────────
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [isRowsLoading, setIsRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<number>(50);
  const [showMainPageSizePopover, setShowMainPageSizePopover] = useState(false);
  const mainPageSizePopoverRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);

  // Filter & Sort State
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const [filterCol, setFilterCol] = useState('');
  const [filterOp, setFilterOp] = useState<'eq' | 'neq' | 'gt' | 'lt' | 'like' | 'is_null'>('eq');
  const [filterVal, setFilterVal] = useState('');
  const [activeFilter, setActiveFilter] = useState<{ col: string; op: string; val: string } | null>(null);

  const [showSortPopover, setShowSortPopover] = useState(false);
  const [sortCol, setSortCol] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [activeSort, setActiveSort] = useState<{ col: string; order: 'asc' | 'desc' } | null>(null);

  // ─── Pane 3: Right Details / Edit Inspector ────────────────────────────────
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'details' | 'danger'>('details');
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
  const [rowEditValues, setRowEditValues] = useState<Record<string, unknown>>({});
  const [isSavingRow, setIsSavingRow] = useState(false);
  const [isInsertModeInPanel, setIsInsertModeInPanel] = useState(false);

  // Delete Row State
  const [deleteRowTarget, setDeleteRowTarget] = useState<Record<string, unknown> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Copy feedback state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // ─── Inline Cell Editor & Selection State ─────────────────────────────────
  const [selectedCell, setSelectedCell] = useState<{ rowIndex: number; colName: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{
    rowIndex: number;
    colName: string;
    column?: ColumnInfoApi;
    initialValue: unknown;
    currentValue: string;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);
  const [expandedInlineCell, setExpandedInlineCell] = useState<{
    rowIndex: number;
    colName: string;
    value: string;
  } | null>(null);

  // ─── Foreign Key Reference Record Picker State (Image 1 & 2) ────────────────
  const [fkPickerTarget, setFkPickerTarget] = useState<{
    rowIndex?: number;
    column: string;
    fk: ForeignKeyInfoApi;
    currentValue: unknown;
    onSelect?: (val: unknown) => void;
  } | null>(null);

  // ─── Foreign Key Record Preview Popover State (Image 3) ───────────────────
  const [fkPreviewTarget, setFkPreviewTarget] = useState<{
    fk: ForeignKeyInfoApi;
    currentValue: unknown;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);

  // ─── SQL Console State ─────────────────────────────────────────────────────
  const [sqlQuery, setSqlQuery] = useState('');
  const [isExecutingSql, setIsExecutingSql] = useState(false);
  const [sqlResult, setSqlResult] = useState<QueryResultApi | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlDuration, setSqlDuration] = useState<number | null>(null);

  // ER Diagram focused table state
  const [focusedErTable, setFocusedErTable] = useState<string | null>(null);

  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const sortPopoverRef = useRef<HTMLDivElement>(null);
  // Target key (`db:table`) ref used to discard in-flight responses if the user navigates to another table.
  const activeTargetKeyRef = useRef<string>('');

  // ─── Column Width & Interactive Resizing State ─────────────────────────────
  // Tracks user-resized column pixel widths: { [colName]: widthInPx }
  // Persisted in localStorage per database + table so user customization is retained.
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const resizingColRef = useRef<{
    colName: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  // Restore persisted custom column widths for active table
  useEffect(() => {
    if (!selectedDb || !selectedTable) return;
    try {
      const stored = localStorage.getItem(`axiom:col_widths:${selectedDb}:${selectedTable}`);
      if (stored) {
        setColumnWidths(JSON.parse(stored));
      } else {
        setColumnWidths({});
      }
    } catch {
      setColumnWidths({});
    }
  }, [selectedDb, selectedTable]);

  // Helper to determine if a column is non-editable / read-only (Primary Key, 'id', generated/serial)
  const isColReadOnly = useCallback((col: { name: string; primary_key?: boolean; type: string }): boolean => {
    if (col.primary_key) return true;
    if (col.name.toLowerCase() === 'id') return true;
    const normType = col.type.toLowerCase();
    if (normType.includes('serial') || normType.includes('identity') || normType.includes('generated')) return true;
    return false;
  }, []);

  // Returns effective width: user preference > type-based semantic default
  const getColWidth = useCallback(
    (colName: string, colType: string): number => {
      if (columnWidths[colName] && columnWidths[colName] >= 80) {
        return columnWidths[colName];
      }
      return getDefaultColumnWidth(colType, colName);
    },
    [columnWidths]
  );

  // Drag-to-resize column width handler
  // WHY: Provides spreadsheet/Airtable-grade interactive column resizing with mouse drag.
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, colName: string, currentWidth: number) => {
      e.preventDefault();
      e.stopPropagation();

      resizingColRef.current = {
        colName,
        startX: e.clientX,
        startWidth: currentWidth,
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMouseMove(moveEvent: MouseEvent) {
        if (!resizingColRef.current) return;
        const { colName: targetCol, startX, startWidth } = resizingColRef.current;
        const delta = moveEvent.clientX - startX;
        // Clamp column width: collapse limit is 80px, maximum 1200px
        const newWidth = Math.max(80, Math.min(1200, startWidth + delta));

        setColumnWidths((prev) => ({
          ...prev,
          [targetCol]: newWidth,
        }));
      }

      function onMouseUp() {
        if (resizingColRef.current && selectedDb && selectedTable) {
          setColumnWidths((latest) => {
            try {
              localStorage.setItem(
                `axiom:col_widths:${selectedDb}:${selectedTable}`,
                JSON.stringify(latest)
              );
            } catch {
              // Ignore localStorage quota failures
            }
            return latest;
          });
        }
        resizingColRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [selectedDb, selectedTable]
  );

  // ─── 1. Load Connected Database Pools ──────────────────────────────────────
  useEffect(() => {
    async function initDatabases() {
      setIsDbsLoading(true);
      try {
        const res = await api.listDatabases();
        const dbs = res.databases || [];
        setDatabases(dbs);

        // Read query param if jumped from Databases page
        const urlParams = new URLSearchParams(window.location.search);
        const queryDb = urlParams.get('db');
        const defaultDb = queryDb && dbs.some((d) => d.alias === queryDb) ? queryDb : dbs[0]?.alias || '';

        setSelectedDb(defaultDb);
      } catch (err) {
        console.error('Failed to load database pools:', err);
      } finally {
        setIsDbsLoading(false);
      }
    }
    initDatabases();
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dbDropdownRef.current && !dbDropdownRef.current.contains(e.target as Node)) {
        setIsDbDropdownOpen(false);
      }
      if (filterPopoverRef.current && !filterPopoverRef.current.contains(e.target as Node)) {
        setShowFilterPopover(false);
      }
      if (sortPopoverRef.current && !sortPopoverRef.current.contains(e.target as Node)) {
        setShowSortPopover(false);
      }
      if (mainPageSizePopoverRef.current && !mainPageSizePopoverRef.current.contains(e.target as Node)) {
        setShowMainPageSizePopover(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ─── 2. Load Tables when Database changes ──────────────────────────────────
  const fetchTables = useCallback(async (db: string) => {
    if (!db) return;
    setIsTablesLoading(true);
    try {
      const res = await api.getDatabaseTables(db, undefined, 500);
      const tableList = res.tables || [];
      setTables(tableList);

      setSelectedTable((prev) => {
        if (prev && tableList.some((t: TableInfoApi) => t.name === prev)) return prev;
        return tableList[0]?.name || '';
      });
    } catch (err) {
      console.error(`Failed to load tables for ${db}:`, err);
      setTables([]);
      setSelectedTable('');
    } finally {
      setIsTablesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedDb) {
      fetchTables(selectedDb);
      setCursor(null);
      setCursorHistory([]);
      setActiveFilter(null);
      setActiveSort(null);
      setSelectedRowIndex(null);
    }
  }, [selectedDb, fetchTables]);

  // ─── 3. Phased Sequential Data Pipeline: Schema -> Rows (Supabase Studio lifecycle) ───
  // Uses client-side schema caching and semantic navigation guards to ensure rows are always fetched
  // without race-condition aborts, multiple redundant information_schema queries, or 0-data drops.
  const loadTableData = useCallback(
    async (options?: { targetCursor?: string | null; reloadSchema?: boolean }) => {
      const targetCursor = options?.targetCursor;

      if (!selectedDb || !selectedTable) {
        setColumns([]);
        setForeignKeys([]);
        setRows([]);
        setIsSchemaLoading(false);
        setIsRowsLoading(false);
        return;
      }

      const currentKey = `${selectedDb}:${selectedTable}`;
      activeTargetKeyRef.current = currentKey;
      setRowsError(null);

      // Read from ref — NOT from allDbTablesSchema state — to avoid allDbTablesSchema being in
      // the useCallback deps, which would recreate the fn on every schema write and re-trigger the
      // table-change useEffect causing an infinite loop that drops all row data.
      const cached = schemaCacheRef.current[selectedTable];
      let cols = cached?.columns || [];
      let fks = cached?.foreign_keys || [];

      const needsSchema = options?.reloadSchema || cols.length === 0;

      if (needsSchema) {
        setIsSchemaLoading(true);
        setIsRowsLoading(true);
        try {
          const schemaRes = await api.getTableSchema(selectedDb, selectedTable);
          // If user switched to another table while waiting for schema, discard
          if (activeTargetKeyRef.current !== currentKey) return;

          cols = schemaRes.columns || [];
          fks = schemaRes.foreign_keys || [];
          setColumns(cols);
          setForeignKeys(fks);

          // Write to schemaCacheRef immediately (synchronous, for next loadTableData reads)
          // then also to state so the ER diagram can re-render when it's visible
          const entry = { columns: cols, foreign_keys: fks };
          schemaCacheRef.current = { ...schemaCacheRef.current, [selectedTable]: entry };
          setAllDbTablesSchema((prev) => ({ ...prev, [selectedTable]: entry }));
        } catch (err: unknown) {
          if (activeTargetKeyRef.current !== currentKey) return;
          console.error(`Failed to load schema for ${selectedDb}.${selectedTable}:`, err);
          setColumns([]);
          setForeignKeys([]);
          setRows([]);
          setIsSchemaLoading(false);
          setIsRowsLoading(false);
          setRowsError(err instanceof Error ? err.message : 'Failed to introspect table schema');
          return;
        } finally {
          if (activeTargetKeyRef.current === currentKey) {
            setIsSchemaLoading(false);
          }
        }
      } else {
        setColumns(cols);
        setForeignKeys(fks);
        setIsSchemaLoading(false);
        setIsRowsLoading(true);
      }

      // Phase 2: Fetch Table Row Data
      try {
        let filterParam: string | undefined;
        if (activeFilter) {
          filterParam = JSON.stringify({
            [activeFilter.col]: { [activeFilter.op]: activeFilter.val },
          });
        }

        const rowsRes = await api.getTableRows(selectedDb, selectedTable, {
          cursor: targetCursor || undefined,
          limit: pageSize,
          sort: activeSort?.col,
          order: activeSort?.order,
          filter: filterParam,
        });

        if (activeTargetKeyRef.current !== currentKey) return;

        const rowsData = rowsRes.rows || [];
        const pagination = rowsRes.pagination;

        setRows(rowsData);
        setHasNextPage(!!pagination?.has_more);
        setCursor(pagination?.next_cursor || null);
        setSelectedRowIndex((prev) => (prev !== null && prev < rowsData.length ? prev : null));
      } catch (err: unknown) {
        if (activeTargetKeyRef.current !== currentKey) return;
        setRowsError(err instanceof Error ? err.message : 'Failed to query table rows');
        setRows([]);
      } finally {
        if (activeTargetKeyRef.current === currentKey) {
          setIsRowsLoading(false);
        }
      }
    },
    // No allDbTablesSchema — read via schemaCacheRef instead to prevent infinite re-trigger loop
    [selectedDb, selectedTable, pageSize, activeFilter, activeSort]
  );

  // Trigger full data load (schema + rows) when active table/db/view changes.
  // loadTableData is intentionally omitted from deps: it is now stable (no state in its closure).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedDb && selectedTable && viewMode === 'grid') {
      setCursor(null);
      setCursorHistory([]);
      setSelectedRowIndex(null);
      setIsInsertModeInPanel(false);
      loadTableData({ reloadSchema: false });
    }
  }, [selectedDb, selectedTable, viewMode]);

  // Trigger row-only reload when filter/sort/pageSize changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedDb && selectedTable && viewMode === 'grid' && columns.length > 0) {
      setCursor(null);
      setCursorHistory([]);
      setSelectedRowIndex(null);
      loadTableData({ reloadSchema: false });
    }
  }, [pageSize, activeFilter, activeSort]);

  // Lazy fetch schema for ER diagram only when user actively switches to Schema view.
  // WHY: Avoids flooding the DB pool with concurrent INFORMATION_SCHEMA requests on initial boot.
  // Batches schema mutations into a single state update so this effect does not thrash in a loop.
  useEffect(() => {
    if (viewMode !== 'schema' || !selectedDb || tables.length === 0) return;
    const missing = tables.filter((t) => !schemaCacheRef.current[t.name]);
    if (missing.length === 0) return;

    let cancelled = false;
    async function loadErSchemas() {
      const updates: Record<string, { columns: ColumnInfoApi[]; foreign_keys: ForeignKeyInfoApi[] }> = {};
      for (const t of missing) {
        if (cancelled) break;
        try {
          const res = await api.getTableSchema(selectedDb, t.name);
          updates[t.name] = {
            columns: res.columns || [],
            foreign_keys: res.foreign_keys || [],
          };
        } catch {
          // Schema introspect failure on background ER table is non-fatal
        }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        schemaCacheRef.current = { ...schemaCacheRef.current, ...updates };
        setAllDbTablesSchema((prev) => ({ ...prev, ...updates }));
      }
    }
    loadErSchemas();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedDb, tables]);

  // Select row handler - only opens drawer when openDrawer is explicitly true
  const handleSelectRow = (index: number, openDrawer = false) => {
    setSelectedRowIndex(index);
    setIsInsertModeInPanel(false);
    if (openDrawer) {
      setIsDetailsOpen(true);
    }
    if (rows[index]) {
      setRowEditValues({ ...rows[index] });
    }
  };

  // Toggle single row tickmark checkbox selection
  const handleToggleRowSelect = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setSelectedRowIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Toggle select all rows tickmark checkbox
  const handleToggleAllRows = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedRowIndices.size === rows.length && rows.length > 0) {
      setSelectedRowIndices(new Set());
    } else {
      setSelectedRowIndices(new Set(rows.map((_, i) => i)));
    }
  };

  // ─── Save Row from Right Panel Inspector ───────────────────────────────────
  async function handleSaveRowEdit() {
    if (!selectedDb || !selectedTable || selectedRowIndex === null) return;
    const originalRow = rows[selectedRowIndex];
    if (!originalRow) return;

    setIsSavingRow(true);
    try {
      // Find PK column or use original row as filter
      const pkCol = columns.find((c) => c.primary_key);
      const filter: Record<string, unknown> = {};

      if (pkCol && originalRow[pkCol.name] !== undefined) {
        filter[pkCol.name] = { eq: originalRow[pkCol.name] };
      } else {
        // Fallback: match 2 non-null columns
        let count = 0;
        Object.entries(originalRow).forEach(([k, v]) => {
          if (count < 2 && v !== null && v !== undefined) {
            filter[k] = { eq: v };
            count++;
          }
        });
      }

      // Prepare updated fields
      const updates: Record<string, unknown> = {};
      columns.forEach((col) => {
        const val = rowEditValues[col.name];
        if (val !== originalRow[col.name]) {
          updates[col.name] = val;
        }
      });

      if (Object.keys(updates).length > 0) {
        await api.updateTableRow(selectedDb, selectedTable, filter, updates);
        await loadTableData({ targetCursor: cursor, reloadSchema: false });
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update row');
    } finally {
      setIsSavingRow(false);
    }
  }

  // ─── Inline Cell Edit Handlers & Table Keyboard Navigation ──────────────────
  const handleStartCellEdit = (rowIndex: number, colName: string, cellEl: HTMLElement) => {
    const col = columns.find((c) => c.name === colName);
    if (col && isColReadOnly(col)) return;
    const row = rows[rowIndex];
    if (!row) return;
    const val = row[colName];
    const strVal = val === null || val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
    const r = cellEl.getBoundingClientRect();
    setEditingCell({
      rowIndex,
      colName,
      column: col,
      initialValue: val,
      currentValue: strVal,
      rect: {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      },
    });
  };

  const handleSaveCellEdit = async (rowIndex: number, colName: string, rawValue: unknown) => {
    if (!selectedDb || !selectedTable) return;
    const originalRow = rows[rowIndex];
    if (!originalRow) return;

    const col = columns.find((c) => c.name === colName);
    let newValue: unknown = rawValue;

    if (typeof rawValue === 'string') {
      if (rawValue === '') {
        newValue = col?.nullable ? null : '';
      } else if (col) {
        const normType = col.type.toLowerCase();
        if (normType.includes('int')) {
          const parsed = parseInt(rawValue, 10);
          if (!isNaN(parsed)) newValue = parsed;
        } else if (
          normType.includes('float') ||
          normType.includes('double') ||
          normType.includes('numeric') ||
          normType.includes('decimal') ||
          normType.includes('real')
        ) {
          const parsed = parseFloat(rawValue);
          if (!isNaN(parsed)) newValue = parsed;
        } else if (normType.includes('bool') || normType === 'bit') {
          if (rawValue.toLowerCase() === 'true') newValue = true;
          else if (rawValue.toLowerCase() === 'false') newValue = false;
        }
      }
    }

    if (originalRow[colName] === newValue) return;

    // Optimistically update local rows
    const updatedRow = { ...originalRow, [colName]: newValue };
    const newRows = [...rows];
    newRows[rowIndex] = updatedRow;
    setRows(newRows);
    if (selectedRowIndex === rowIndex) {
      setRowEditValues(updatedRow);
    }

    try {
      const pkCol = columns.find((c) => c.primary_key);
      const filter: Record<string, unknown> = {};

      if (pkCol && originalRow[pkCol.name] !== undefined) {
        filter[pkCol.name] = { eq: originalRow[pkCol.name] };
      } else {
        let count = 0;
        Object.entries(originalRow).forEach(([k, v]) => {
          if (count < 2 && v !== null && v !== undefined) {
            filter[k] = { eq: v };
            count++;
          }
        });
      }

      await api.updateTableRow(selectedDb, selectedTable, filter, { [colName]: newValue });
    } catch (err) {
      // Revert on failure
      const revertedRows = [...rows];
      revertedRows[rowIndex] = originalRow;
      setRows(revertedRows);
      if (selectedRowIndex === rowIndex) {
        setRowEditValues(originalRow);
      }
      alert(err instanceof Error ? err.message : 'Failed to update cell');
    }
  };

  const handleCommitCellEdit = async (val?: unknown) => {
    if (!editingCell) return;
    const { rowIndex, colName, currentValue } = editingCell;
    const valueToSave = val !== undefined ? val : currentValue;
    setEditingCell(null);
    await handleSaveCellEdit(rowIndex, colName, valueToSave);
  };

  const handleSelectFkRecord = async (newVal: unknown) => {
    if (!fkPickerTarget) return;
    const target = fkPickerTarget;
    setFkPickerTarget(null);

    if (target.onSelect) {
      target.onSelect(newVal);
    } else if (target.rowIndex !== undefined) {
      await handleSaveCellEdit(target.rowIndex, target.column, newVal);
    }
  };

  const handleOpenReferencedTable = (targetTable: string) => {
    setFkPreviewTarget(null);
    setSelectedTable(targetTable);
    setSelectedRowIndex(null);
    setSelectedCell(null);
    setViewMode('grid');
  };

  // Keyboard navigation for selected cells (Arrows, Tab, Enter to edit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingCell || expandedInlineCell || isDetailsOpen || fkPickerTarget || fkPreviewTarget) return;
      if (!selectedCell) return;

      const { rowIndex, colName } = selectedCell;
      const colIdx = columns.findIndex((c) => c.name === colName);
      if (colIdx === -1) return;

      if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        if (colIdx < columns.length - 1) {
          setSelectedCell({ rowIndex, colName: columns[colIdx + 1].name });
        } else if (rowIndex < rows.length - 1) {
          setSelectedCell({ rowIndex: rowIndex + 1, colName: columns[0].name });
          setSelectedRowIndex(rowIndex + 1);
        }
      } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        if (colIdx > 0) {
          setSelectedCell({ rowIndex, colName: columns[colIdx - 1].name });
        } else if (rowIndex > 0) {
          setSelectedCell({ rowIndex: rowIndex - 1, colName: columns[columns.length - 1].name });
          setSelectedRowIndex(rowIndex - 1);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (rowIndex < rows.length - 1) {
          setSelectedCell({ rowIndex: rowIndex + 1, colName });
          setSelectedRowIndex(rowIndex + 1);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (rowIndex > 0) {
          setSelectedCell({ rowIndex: rowIndex - 1, colName });
          setSelectedRowIndex(rowIndex - 1);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const fk = foreignKeys.find((f) => f.column === colName);
        if (fk) {
          const val = rows[rowIndex]?.[colName];
          setFkPickerTarget({
            rowIndex,
            column: colName,
            fk,
            currentValue: val,
          });
        } else {
          const cellEl = document.querySelector(
            `[data-cell-row="${rowIndex}"][data-cell-col="${colName}"]`
          ) as HTMLElement;
          if (cellEl) {
            handleStartCellEdit(rowIndex, colName, cellEl);
          }
        }
      } else if (e.key === 'Escape') {
        setSelectedCell(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCell, editingCell, expandedInlineCell, isDetailsOpen, fkPickerTarget, fkPreviewTarget, columns, rows, foreignKeys]);

  // ─── Insert Row from Right Panel Inspector ─────────────────────────────────
  async function handleInsertRowFromPanel() {
    if (!selectedDb || !selectedTable) return;

    setIsSavingRow(true);
    try {
      const payload: Record<string, unknown> = {};
      columns.forEach((col) => {
        const val = rowEditValues[col.name];
        if (val !== undefined && val !== '') {
          payload[col.name] = val;
        }
      });

      await api.insertTableRow(selectedDb, selectedTable, payload);
      setIsInsertModeInPanel(false);
      await loadTableData({ reloadSchema: false });
      setSelectedRowIndex(0);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to insert row');
    } finally {
      setIsSavingRow(false);
    }
  }

  // ─── Delete Row ────────────────────────────────────────────────────────────
  async function handleDeleteRow() {
    if (!selectedDb || !selectedTable || !deleteRowTarget) return;

    setIsDeleting(true);
    try {
      const pkCol = columns.find((c) => c.primary_key);
      const filter: Record<string, unknown> = {};

      if (pkCol && deleteRowTarget[pkCol.name] !== undefined) {
        filter[pkCol.name] = { eq: deleteRowTarget[pkCol.name] };
      } else {
        let count = 0;
        Object.entries(deleteRowTarget).forEach(([k, v]) => {
          if (count < 2 && v !== null && v !== undefined) {
            filter[k] = { eq: v };
            count++;
          }
        });
      }

      await api.deleteTableRow(selectedDb, selectedTable, filter);
      setDeleteRowTarget(null);
      setSelectedRowIndex(null);
      loadTableData({ targetCursor: cursor, reloadSchema: false });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete row');
    } finally {
      setIsDeleting(false);
    }
  }

  // ─── SQL Console Execution ─────────────────────────────────────────────────
  async function handleExecuteSql() {
    if (!selectedDb || !sqlQuery.trim()) return;

    setIsExecutingSql(true);
    setSqlError(null);
    setSqlResult(null);

    const startTime = performance.now();
    try {
      const res = await api.executeSqlQuery(selectedDb, sqlQuery.trim());
      const duration = Math.round(performance.now() - startTime);
      setSqlDuration(duration);
      setSqlResult(res);
    } catch (err) {
      setSqlError(err instanceof Error ? err.message : 'SQL Execution failed');
    } finally {
      setIsExecutingSql(false);
    }
  }

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const filteredTables = useMemo(() => {
    if (!tableSearch.trim()) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(tableSearch.toLowerCase()));
  }, [tables, tableSearch]);

  const activeRow = selectedRowIndex !== null ? rows[selectedRowIndex] : null;

  // Track if user has modified anything or entered values (for disabling/enabling the Save button)
  const hasRowChanges = useMemo(() => {
    if (isInsertModeInPanel) {
      // In insert mode: enabled if at least one field has non-empty/non-undefined value
      return Object.values(rowEditValues).some((v) => v !== undefined && v !== '' && v !== null);
    }
    if (!activeRow) return false;
    // In edit mode: enabled if any column value differs from the original row value
    return columns.some((col) => {
      const current = rowEditValues[col.name];
      const original = activeRow[col.name];
      // Normalize undefined and null for comparison
      const normCur = current === undefined ? null : current;
      const normOrig = original === undefined ? null : original;
      return normCur !== normOrig;
    });
  }, [isInsertModeInPanel, activeRow, rowEditValues, columns]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:flex-row w-full h-full min-h-0 select-none font-sans overflow-hidden bg-[#0c0c0c]">
      {/* ══════════════════════════════════════════════════════════════════════
          PANE 1: LEFT NAVIGATOR (DATABASES & TABLE EXPLORER)
          ══════════════════════════════════════════════════════════════════════ */}
      <aside className="w-full lg:w-64 shrink-0 flex flex-col bg-[#0a0a0a] border-b lg:border-b-0 lg:border-r border-[#222222] overflow-hidden">
        {/* Database Dropdown Selector Header (h-[54px] matching StoragePage) */}
        <div className="h-[54px] shrink-0 px-3 border-b border-[#222222] flex items-center justify-between gap-2 relative">
          <div className="relative flex-1 min-w-0" ref={dbDropdownRef}>
            <button
              type="button"
              onClick={() => setIsDbDropdownOpen(!isDbDropdownOpen)}
              className="w-full h-8 px-2.5 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] flex items-center justify-between gap-2 text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 truncate min-w-0">
                <Database className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="text-[13px] font-medium text-white truncate">
                  {selectedDb || 'Select Database'}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[#777777] shrink-0" />
            </button>

            {/* Dropdown Popup */}
            {isDbDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-60 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans">
                <div className="px-2.5 py-1.5 text-[11px] font-medium text-[#777777] uppercase tracking-wider">
                  Database Connections
                </div>

                <div className="max-h-52 overflow-y-auto space-y-0.5 py-0.5">
                  {databases.length === 0 ? (
                    <div className="px-2.5 py-2 text-[12px] text-[#777777]">No databases found</div>
                  ) : (
                    databases.map((db) => {
                      const isActive = db.alias === selectedDb;
                      return (
                        <button
                          key={db.alias}
                          type="button"
                          onClick={() => {
                            setSelectedDb(db.alias);
                            setIsDbDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors cursor-pointer text-left ${
                            isActive
                              ? 'bg-[#1c1c1c] text-white font-medium'
                              : 'text-[#d4d4d4] hover:text-white hover:bg-[#161616]'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate min-w-0">
                            <Database className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-[#777777]'}`} />
                            <span className="truncate">{db.alias}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-[#777777]">
                            <span className="font-mono">{db.engine}</span>
                            {isActive && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick Reload Tables button */}
          <button
            type="button"
            onClick={() => fetchTables(selectedDb)}
            disabled={isTablesLoading}
            title="Refresh table list"
            className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] transition-colors cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTablesLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Live Search Input */}
        <div className="p-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#666666] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search tables..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-2.5 bg-[#141414] border border-[#242424] focus:border-[#383838] rounded-[6px] text-[13px] text-white placeholder-[#666666] outline-none transition-colors"
            />
          </div>
        </div>

        {/* Table Tree Items */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {isTablesLoading && tables.length === 0 ? (
            <div className="flex items-center justify-center p-8 text-zinc-500 text-[12px] gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Loading tables...
            </div>
          ) : filteredTables.length === 0 ? (
            <div className="p-8 text-center text-[#777777] text-[12px]">
              {tables.length === 0 ? 'No tables in schema' : 'No matching tables'}
            </div>
          ) : (
            filteredTables.map((t) => {
              const isSelected = selectedTable === t.name;
              return (
                <button
                  key={t.name}
                  onClick={() => {
                    setSelectedTable(t.name);
                    setSelectedRowIndex(null);
                    setIsInsertModeInPanel(false);
                    if (viewMode === 'sql' && !sqlQuery) {
                      setSqlQuery(`SELECT * FROM ${t.name} LIMIT 25;`);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-left transition-colors cursor-pointer text-[14px] font-sans ${
                    isSelected
                      ? 'bg-[#1a1a1a] text-white font-medium'
                      : 'text-[#a1a1aa] hover:text-white hover:bg-[#141414]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <TableIcon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-[#777777]'}`} />
                    <span className="font-sans text-[14px] truncate">{t.name}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Navigator Footer */}
        <div className="h-12 shrink-0 px-3.5 border-t border-[#222222] flex items-center justify-between text-[12px] text-[#8c8c8c] select-none font-sans">
          <span>{tables.length} tables</span>
        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════════════════════
          PANE 2: MAIN WORKSPACE CANVAS (GRID / SCHEMA / SQL)
          ══════════════════════════════════════════════════════════════════════ */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#0c0c0c]">
        {/* Workspace Top Toolbar (h-[54px] matching StoragePage) */}
        <div className="h-[54px] shrink-0 px-4 border-b border-[#222222] bg-[#0c0c0c] flex items-center justify-between gap-3 select-none">
          {/* Action Tools & View Mode Switcher (placed on the left) */}
          <div className="flex items-center gap-2 shrink-0">
            {viewMode === 'grid' && (
              <>
                {/* Insert Row Button */}
                <button
                  onClick={() => {
                    setSelectedRowIndex(null);
                    setRowEditValues({});
                    setIsInsertModeInPanel(true);
                    setIsDetailsOpen(true);
                  }}
                  disabled={!selectedTable}
                  className="flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] disabled:opacity-40 text-[#cccccc] hover:text-white text-[13px] font-medium transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Insert Row</span>
                </button>

                {/* Filter Popover */}
                <div className="relative" ref={filterPopoverRef}>
                  <button
                    onClick={() => setShowFilterPopover(!showFilterPopover)}
                    className={`flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] border text-[13px] font-medium transition-colors cursor-pointer ${
                      activeFilter
                        ? 'bg-blue-950/40 border-blue-600/50 text-blue-400'
                        : 'bg-[#141414] border-[#262626] text-[#cccccc] hover:border-[#383838]'
                    }`}
                  >
                    <Filter className="w-3.5 h-3.5" />
                    <span>Filter</span>
                    {activeFilter && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                  </button>

                  {showFilterPopover && (
                    <div className="absolute left-0 top-full mt-1.5 w-72 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-3 z-50">
                      <div className="text-[13px] font-semibold text-white mb-3">Filter Records</div>
                      <div className="space-y-2.5">
                        <CustomSelect
                          size="sm"
                          value={filterCol}
                          onChange={setFilterCol}
                          options={[
                            { value: '', label: 'Select column...' },
                            ...columns.map(c => ({ value: c.name, label: `${c.name} (${c.type})` }))
                          ]}
                        />

                        <CustomSelect
                          size="sm"
                          value={filterOp}
                          onChange={(v) => setFilterOp(v as any)}
                          options={[
                            { value: 'eq', label: 'Equals (=)' },
                            { value: 'neq', label: 'Not equals (!=)' },
                            { value: 'gt', label: 'Greater than (>)' },
                            { value: 'lt', label: 'Less than (<)' },
                            { value: 'like', label: 'Contains (LIKE)' },
                            { value: 'is_null', label: 'Is NULL' },
                          ]}
                        />

                        {filterOp !== 'is_null' && (
                          <input
                            type="text"
                            placeholder="Value..."
                            value={filterVal}
                            onChange={(e) => setFilterVal(e.target.value)}
                            className="w-full h-8 px-2.5 bg-[#141414] border border-[#2c2c2c] rounded-[8px] text-[13px] text-white placeholder-[#666666] focus:outline-none focus:border-[#3b82f6] transition-colors"
                          />
                        )}

                        <div className="flex items-center justify-between pt-1.5">
                          <button
                            onClick={() => {
                              setActiveFilter(null);
                              setFilterCol('');
                              setFilterVal('');
                              setShowFilterPopover(false);
                            }}
                            className="text-[12px] font-medium text-[#8c8c8c] hover:text-white transition-colors cursor-pointer"
                          >
                            Clear
                          </button>
                          <button
                            onClick={() => {
                              if (filterCol) {
                                setActiveFilter({ col: filterCol, op: filterOp, val: filterVal });
                                setShowFilterPopover(false);
                              }
                            }}
                            className="px-3 py-1.5 bg-[#2563eb] hover:bg-[#3b82f6] rounded-[6px] text-[12.5px] font-medium text-white transition-colors cursor-pointer shadow-sm"
                          >
                            Apply Filter
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sort Popover */}
                <div className="relative" ref={sortPopoverRef}>
                  <button
                    onClick={() => setShowSortPopover(!showSortPopover)}
                    className={`flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] border text-[13px] font-medium transition-colors cursor-pointer ${
                      activeSort
                        ? 'bg-blue-950/40 border-blue-600/50 text-blue-400'
                        : 'bg-[#141414] border-[#262626] text-[#cccccc] hover:border-[#383838]'
                    }`}
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    <span>Sort</span>
                  </button>

                  {showSortPopover && (
                    <div className="absolute left-0 top-full mt-1.5 w-64 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-3 z-50">
                      <div className="text-[13px] font-semibold text-white mb-3">Sort Records</div>
                      <div className="space-y-2.5">
                        <CustomSelect
                          size="sm"
                          value={sortCol}
                          onChange={setSortCol}
                          options={[
                            { value: '', label: 'Select column...' },
                            ...columns.map(c => ({ value: c.name, label: c.name }))
                          ]}
                        />

                        <div className="flex gap-2">
                          <button
                            onClick={() => setSortOrder('asc')}
                            className={`flex-1 h-8 rounded-[6px] text-[12px] font-medium border transition-colors cursor-pointer ${
                              sortOrder === 'asc'
                                ? 'bg-[#1d4ed8]/20 border-[#3b82f6]/50 text-[#60a5fa]'
                                : 'bg-[#141414] border-[#2c2c2c] text-[#8c8c8c] hover:border-[#383838] hover:text-white'
                            }`}
                          >
                            ASC
                          </button>
                          <button
                            onClick={() => setSortOrder('desc')}
                            className={`flex-1 h-8 rounded-[6px] text-[12px] font-medium border transition-colors cursor-pointer ${
                              sortOrder === 'desc'
                                ? 'bg-[#1d4ed8]/20 border-[#3b82f6]/50 text-[#60a5fa]'
                                : 'bg-[#141414] border-[#2c2c2c] text-[#8c8c8c] hover:border-[#383838] hover:text-white'
                            }`}
                          >
                            DESC
                          </button>
                        </div>

                        <div className="flex items-center justify-between pt-1.5">
                          <button
                            onClick={() => {
                              setActiveSort(null);
                              setSortCol('');
                              setShowSortPopover(false);
                            }}
                            className="text-[12px] font-medium text-[#8c8c8c] hover:text-white transition-colors cursor-pointer"

                          >
                            Reset
                          </button>
                          <button
                            onClick={() => {
                              if (sortCol) {
                                setActiveSort({ col: sortCol, order: sortOrder });
                                setShowSortPopover(false);
                              }
                            }}
                            className="px-2.5 py-1 bg-[#222222] hover:bg-[#2a2a2a] border border-[#333333] rounded text-[12px] font-medium text-white transition-colors"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Reload Data Button */}
                <button
                  onClick={() => loadTableData({ reloadSchema: true })}
                  disabled={isRowsLoading || isSchemaLoading}
                  title="Reload rows"
                  className="w-8 h-8 flex items-center justify-center rounded-[6px] bg-[#141414] border border-[#262626] text-[#8c8c8c] hover:text-white hover:border-[#383838] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRowsLoading || isSchemaLoading ? 'animate-spin' : ''}`} />
                </button>
              </>
            )}

            {/* View Mode Switcher Pills (matching Storage view toggle) */}
            <div className="flex items-center p-0.5 rounded-[6px] bg-[#141414] border border-[#262626]">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                title="Table Grid"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-[13px] font-medium transition-colors cursor-pointer ${
                  viewMode === 'grid' ? 'bg-[#222222] text-white' : 'text-[#8c8c8c] hover:text-white'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Grid</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('schema')}
                title="Schema & Relations"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-[13px] font-medium transition-colors cursor-pointer ${
                  viewMode === 'schema' ? 'bg-[#222222] text-white' : 'text-[#8c8c8c] hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Schema</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('sql');
                  if (!sqlQuery && selectedTable) {
                    setSqlQuery(`SELECT * FROM ${selectedTable} LIMIT 25;`);
                  }
                }}
                title="SQL Console"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-[13px] font-medium transition-colors cursor-pointer ${
                  viewMode === 'sql' ? 'bg-[#222222] text-white' : 'text-[#8c8c8c] hover:text-white'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span className="hidden md:inline">SQL</span>
              </button>
            </div>
          </div>

          {/* Right: Next and Previous Pagination Controls */}
          {viewMode === 'grid' && (
            <div className="flex items-center gap-2 shrink-0">
              {/* Custom Page Size Dropdown */}
              <div className="relative" ref={mainPageSizePopoverRef}>
                <button
                  type="button"
                  onClick={() => setShowMainPageSizePopover(!showMainPageSizePopover)}
                  className="flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] hover:text-white hover:border-[#383838] text-[13px] font-medium transition-colors cursor-pointer"
                  title="Page size"
                >
                  <span>{pageSize}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-[#777777] transition-transform duration-150 ${
                      showMainPageSizePopover ? 'rotate-180 text-white' : ''
                    }`}
                  />
                </button>

                {showMainPageSizePopover && (
                  <div className="absolute right-0 top-full mt-1.5 w-24 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-1 z-50 font-sans animate-in fade-in duration-100">
                    {[25, 50, 100, 250, 500].map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => {
                          setPageSize(sz);
                          setCursor(null);
                          setCursorHistory([]);
                          setShowMainPageSizePopover(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors cursor-pointer font-sans ${
                          pageSize === sz
                            ? 'bg-blue-600/15 text-blue-400 font-medium'
                            : 'text-[#cccccc] hover:bg-[#1a1a1a] hover:text-white'
                        }`}
                      >
                        <span>{sz}</span>
                        {pageSize === sz && <Check className="w-3.5 h-3.5 text-blue-400" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  if (cursorHistory.length > 0) {
                    const newHistory = [...cursorHistory];
                    newHistory.pop();
                    const prevCursor = newHistory[newHistory.length - 1] || null;
                    setCursorHistory(newHistory);
                    loadTableData({ targetCursor: prevCursor, reloadSchema: false });
                  }
                }}
                disabled={cursorHistory.length === 0 || isRowsLoading}
                className="flex items-center gap-1 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] disabled:opacity-40 hover:text-white hover:border-[#383838] transition-colors cursor-pointer"
                title="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span className="text-[13px] font-medium">Previous</span>
              </button>

              <button
                onClick={() => {
                  if (hasNextPage && cursor) {
                    setCursorHistory([...cursorHistory, cursor]);
                    loadTableData({ targetCursor: cursor, reloadSchema: false });
                  }
                }}
                disabled={!hasNextPage || isRowsLoading}
                className="flex items-center gap-1 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] text-[#cccccc] disabled:opacity-40 hover:text-white hover:border-[#383838] transition-colors cursor-pointer"
                title="Next page"
              >
                <span className="text-[13px] font-medium">Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* ─── Mode 1: Table Grid (Spreadsheet Editor) ─── */}
        {viewMode === 'grid' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
            <div className="flex-1 overflow-auto">
              {isSchemaLoading || (isRowsLoading && rows.length === 0 && !rowsError) ? (
                <TableSkeleton columns={columns} foreignKeys={foreignKeys} columnWidths={columnWidths} />
              ) : rowsError ? (
                <div className="p-8 flex flex-col items-center justify-center text-center">
                  <AlertCircle className="w-8 h-8 text-rose-500 mb-2" />
                  <p className="text-[14px] font-medium text-white mb-1">Failed to query table</p>
                  <p className="text-[12.5px] text-[#8c8c8c] max-w-md font-mono">{rowsError}</p>
                  <button
                    onClick={() => loadTableData({ reloadSchema: true })}
                    className="mt-4 px-3 py-1.5 bg-[#141414] border border-[#262626] rounded-[6px] text-[12px] text-white hover:border-[#383838]"
                  >
                    Retry
                  </button>
                </div>
              ) : columns.length === 0 ? (
                <div className="p-12 text-center text-[#777777] text-[14px]">
                  No column schema found for table <span className="font-sans font-medium text-white">{selectedTable}</span>
                </div>
              ) : (
                <table
                  className="border-collapse text-left select-text font-sans text-[14px] table-fixed"
                  style={{ width: 'max-content' }}
                >
                  <thead>
                    <tr className="sticky top-0 z-10 bg-[#0a0a0a] border-b border-[#222222]">
                      {/* Row Checkbox & Action Sticky Column */}
                      <th
                        className="w-16 px-3 py-2 text-left bg-[#0a0a0a] sticky left-0 z-20 border-r border-[#1a1a1a] select-none"
                        style={{ width: '64px', minWidth: '64px', maxWidth: '64px' }}
                      >
                        <div className="flex items-center justify-start gap-1.5">
                          <button
                            type="button"
                            onClick={handleToggleAllRows}
                            title={selectedRowIndices.size === rows.length && rows.length > 0 ? 'Deselect all' : 'Select all'}
                            className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-colors cursor-pointer ${
                              selectedRowIndices.size > 0 && selectedRowIndices.size === rows.length
                                ? 'bg-blue-600 border-blue-500 text-white'
                                : selectedRowIndices.size > 0
                                ? 'bg-blue-600/30 border-blue-500 text-blue-400'
                                : 'bg-[#141414] border-[#2c2c2c] hover:border-[#444444] text-transparent'
                            }`}
                          >
                            <Check className="w-3 h-3 stroke-[2.5]" />
                          </button>
                        </div>
                      </th>

                      {/* Dynamic Columns with Type-Aware Widths and Interactive Resizers */}
                      {columns.map((col) => {
                        const isFk = foreignKeys.some((fk) => fk.column === col.name);
                        const badge = getColumnTypeBadge(col.type, col.primary_key, isFk);
                        const width = getColWidth(col.name, col.type);

                        return (
                          <th
                            key={col.name}
                            className="relative px-3 py-2 text-[14px] font-medium text-[#cccccc] whitespace-nowrap border-r border-[#1a1a1a] select-none group/colheader"
                            style={{ width: `${width}px`, minWidth: `${Math.max(80, width)}px`, maxWidth: `${width}px` }}
                          >
                            <div className="flex items-center gap-1.5 min-w-0 pr-2.5 overflow-hidden whitespace-nowrap">
                              <span className="font-sans text-white text-[14px] whitespace-nowrap shrink-0" title={col.name}>
                                {col.name}
                              </span>
                              {col.primary_key && (
                                <span title="Primary Key" className="shrink-0 p-0.5 rounded bg-amber-500/10 text-amber-400">
                                  <Key className="w-3 h-3" />
                                </span>
                              )}
                              {isFk && (
                                <span title="Foreign Key" className="shrink-0 p-0.5 rounded bg-blue-500/10 text-blue-400">
                                  <Link2 className="w-3 h-3" />
                                </span>
                              )}
                              <span className={`text-[12.5px] font-mono whitespace-nowrap shrink-0 ${badge.color}`}>
                                {formatColumnType(col.type)}
                              </span>
                            </div>

                            {/* Interactive Column Resize Handle */}
                            <div
                              onMouseDown={(e) => handleResizeStart(e, col.name, width)}
                              title="Drag to resize column"
                              className="absolute right-0 top-0 bottom-0 w-2.5 cursor-col-resize group/resizer flex items-center justify-center select-none z-10 hover:bg-blue-500/20 active:bg-blue-500/40"
                            >
                              <div className="w-[1.5px] h-full bg-transparent group-hover/resizer:bg-blue-500 transition-colors" />
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody className={`divide-y divide-[#181818] ${isRowsLoading ? 'opacity-60 transition-opacity' : ''}`}>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length + 1} className="p-12 text-center text-[#666666] text-[14px]">
                          Table contains 0 rows
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, idx) => {
                        const isSelected = selectedRowIndex === idx;
                        return (
                          <tr
                            key={idx}
                            onClick={() => handleSelectRow(idx, false)}
                            className={`transition-colors cursor-pointer group ${
                              isSelected
                                ? 'bg-[#121212] ring-1 ring-inset ring-[#222222] text-white'
                                : 'hover:bg-[#121212]'
                            }`}
                          >
                            {/* Row Tickmark Checkbox & Expand Button */}
                            <td
                              className="px-3 py-2 text-left select-none sticky left-0 bg-[#0a0a0a] group-hover:bg-[#121212] z-10 border-r border-[#1a1a1a]"
                              style={{ width: '64px', minWidth: '64px', maxWidth: '64px' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-start gap-1.5">
                                {/* Tickmark Checkbox */}
                                <button
                                  type="button"
                                  onClick={(e) => handleToggleRowSelect(e, idx)}
                                  title={selectedRowIndices.has(idx) ? 'Deselect row' : 'Select row'}
                                  className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-colors cursor-pointer ${
                                    selectedRowIndices.has(idx)
                                      ? 'bg-blue-600 border-blue-500 text-white'
                                      : 'bg-[#141414] border-[#2c2c2c] hover:border-[#444444] text-transparent hover:text-[#555555]'
                                  }`}
                                >
                                  <Check className="w-3 h-3 stroke-[2.5]" />
                                </button>

                                {/* Expand Row Button - appears on row hover */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelectRow(idx, true);
                                  }}
                                  title="Edit row details"
                                  className={`w-4 h-4 rounded-[4px] flex items-center justify-center text-[#666666] hover:text-white hover:bg-[#1c1c1c] transition-all cursor-pointer ${
                                    selectedRowIndex === idx
                                      ? 'opacity-100'
                                      : 'opacity-0 group-hover:opacity-100'
                                  }`}
                                >
                                  <Maximize2 className="w-3 h-3" />
                                </button>
                              </div>
                            </td>

                            {/* Cells with Matching Fixed Widths */}
                            {columns.map((col) => {
                              const width = getColWidth(col.name, col.type);
                              const val = row[col.name];
                              const isNull = val === null || val === undefined;
                              const isBool = typeof val === 'boolean';
                              const isObj = typeof val === 'object' && val !== null;
                              const strVal = isNull ? 'null' : isObj ? JSON.stringify(val) : String(val);
                              const isCellSelected = selectedCell?.rowIndex === idx && selectedCell?.colName === col.name;
                              const isReadOnly = isColReadOnly(col);
                              const fk = foreignKeys.find((f) => f.column === col.name);

                              return (
                                <td
                                  key={col.name}
                                  data-cell-row={idx}
                                  data-cell-col={col.name}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedCell({ rowIndex: idx, colName: col.name });
                                    handleSelectRow(idx, false);
                                  }}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedCell({ rowIndex: idx, colName: col.name });
                                    handleSelectRow(idx, false);
                                    if (fk) {
                                      setFkPickerTarget({
                                        rowIndex: idx,
                                        column: col.name,
                                        fk,
                                        currentValue: val,
                                      });
                                    } else if (!isReadOnly) {
                                      handleStartCellEdit(idx, col.name, e.currentTarget);
                                    }
                                  }}
                                  className={`px-3 py-2 text-[#cccccc] text-[14px] whitespace-nowrap overflow-hidden border-r border-[#151515] relative transition-colors select-none ${
                                    isReadOnly ? 'cursor-default' : 'cursor-cell'
                                  } ${
                                    isCellSelected
                                      ? 'shadow-[inset_0_0_0_1.5px_#22d3ee] bg-cyan-950/20 text-white z-10'
                                      : ''
                                  }`}
                                  style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
                                  title={isReadOnly ? `${col.name} (Read-only / cannot be edited): ${strVal}` : strVal}
                                >
                                  {fk ? (
                                    <div className="flex items-center justify-between w-full h-full gap-1.5">
                                      <div className="truncate flex-1 min-w-0">
                                        {isNull ? (
                                          <span className="text-[#555555] italic text-[12.5px]">null</span>
                                        ) : isBool ? (
                                          <span
                                            className={`px-1.5 py-0.5 rounded text-[12.5px] font-medium ${
                                              val ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                                            }`}
                                          >
                                            {val ? 'true' : 'false'}
                                          </span>
                                        ) : isObj ? (
                                          <span className="text-pink-400 flex items-center gap-1 text-[12.5px]">
                                            <Code2 className="w-3.5 h-3.5" />
                                            {`{ ... }`}
                                          </span>
                                        ) : (
                                          <span>{strVal}</span>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const btnRect = e.currentTarget.getBoundingClientRect();
                                          setFkPreviewTarget({
                                            fk,
                                            currentValue: val,
                                            rect: {
                                              top: btnRect.top,
                                              left: btnRect.left,
                                              width: btnRect.width,
                                              height: btnRect.height,
                                            },
                                          });
                                        }}
                                        title={`View referenced record from ${fk.referenced_table}`}
                                        className="w-6 h-6 rounded-[5px] bg-[#181818] hover:bg-[#262626] border border-[#2c2c2c] hover:border-[#3e3e3e] text-[#888888] hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0 shadow-xs"
                                      >
                                        <ArrowRight className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ) : isNull ? (
                                    <span className="text-[#555555] italic text-[12.5px]">null</span>
                                  ) : isBool ? (
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[12.5px] font-medium ${
                                        val ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                                      }`}
                                    >
                                      {val ? 'true' : 'false'}
                                    </span>
                                  ) : isObj ? (
                                    <span className="text-pink-400 flex items-center gap-1 text-[12.5px]">
                                      <Code2 className="w-3.5 h-3.5" />
                                      {`{ ... }`}
                                    </span>
                                  ) : (
                                    <span>{strVal}</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination Footer (h-12 matching Sidebar and Navigator footers) */}
            <div className="h-12 shrink-0 px-4 bg-[#0a0a0a] border-t border-[#222222] flex items-center text-[13px] text-[#8c8c8c] select-none font-sans">
              <span>
                Showing <span className="text-white font-medium">{rows.length}</span> rows
                {selectedTable && (
                  <> in <span className="text-white font-mono">{selectedTable}</span></>
                )}
              </span>
            </div>
          </div>
        )}

        {/* ─── Mode 2: Schema & ER (Connected Table Relations) ─── */}
        {viewMode === 'schema' && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <div className="flex items-center justify-between pb-2 border-b border-[#222222]">
              <div>
                <h3 className="text-[16px] font-semibold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-400" />
                  Database Schema & Entity Relationships
                </h3>
                <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                  Connected entity view mapping foreign keys across <span className="font-mono text-white">{selectedDb}</span>.
                </p>
              </div>
            </div>

            {/* Entity Relationship Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
              {tables.map((t) => {
                const tableData = allDbTablesSchema[t.name] || { columns: [], foreign_keys: [] };
                const isSelected = selectedTable === t.name;
                const outgoing = tableData.foreign_keys || [];
                const incoming: { sourceTable: string; sourceCol: string; targetCol: string }[] = [];

                Object.entries(allDbTablesSchema).forEach(([otherTableName, otherData]) => {
                  otherData.foreign_keys?.forEach((fk) => {
                    if (fk.referenced_table === t.name) {
                      incoming.push({
                        sourceTable: otherTableName,
                        sourceCol: fk.column,
                        targetCol: fk.referenced_column,
                      });
                    }
                  });
                });

                return (
                  <div
                    key={t.name}
                    onClick={() => {
                      setSelectedTable(t.name);
                      setSelectedRowIndex(null);
                      setIsDetailsOpen(true);
                    }}
                    className={`rounded-[8px] border p-3.5 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#141414] border-blue-500 ring-1 ring-blue-500/20'
                        : 'bg-[#0f0f0f] border-[#222222] hover:border-[#383838]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-[#222222]">
                      <div className="flex items-center gap-2 truncate min-w-0">
                        <TableIcon className="w-4 h-4 text-blue-400 shrink-0" />
                        <span className="font-mono font-medium text-white text-[14px] truncate">{t.name}</span>
                      </div>
                      <span className="text-[12px] font-mono px-1.5 py-0.5 rounded bg-[#181818] text-[#8c8c8c]">
                        {tableData.columns.length} cols
                      </span>
                    </div>

                    {/* Relations tags */}
                    <div className="space-y-1.5 mb-3 text-[11px]">
                      {outgoing.length > 0 && (
                        <div className="text-[#8c8c8c]">
                          <span className="text-blue-400 font-medium">References: </span>
                          {outgoing.map((fk, i) => (
                            <span key={i} className="font-mono text-[#cccccc]">
                              {fk.referenced_table}
                              {i < outgoing.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </div>
                      )}

                      {incoming.length > 0 && (
                        <div className="text-[#8c8c8c]">
                          <span className="text-emerald-400 font-medium">Referenced by: </span>
                          {incoming.map((rel, i) => (
                            <span key={i} className="font-mono text-[#cccccc]">
                              {rel.sourceTable}
                              {i < incoming.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </div>
                      )}

                      {outgoing.length === 0 && incoming.length === 0 && (
                        <div className="text-[#555555] italic">Standalone table (no foreign keys)</div>
                      )}
                    </div>

                    {/* Columns Preview */}
                    <div className="flex flex-wrap gap-1">
                      {tableData.columns.slice(0, 5).map((col) => (
                        <span
                          key={col.name}
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                            col.primary_key
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 font-semibold'
                              : 'bg-[#161616] border-[#222222] text-[#8c8c8c]'
                          }`}
                        >
                          {col.name}
                        </span>
                      ))}
                      {tableData.columns.length > 5 && (
                        <span className="text-[10px] font-mono px-1 py-0.5 text-[#555555]">
                          +{tableData.columns.length - 5}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Selected Table Column Specifications */}
            <div className="rounded-[8px] border border-[#222222] bg-[#0f0f0f] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#222222] flex items-center justify-between">
                <div>
                  <h4 className="text-[13px] font-semibold text-white">
                    Schema Definition: <span className="font-mono text-blue-400">{selectedTable}</span>
                  </h4>
                  <p className="text-[11.5px] text-[#777777] mt-0.5">
                    Field data types, primary keys, and constraint targets.
                  </p>
                </div>

                <button
                  onClick={() => {
                    const ddl = `CREATE TABLE ${selectedTable} (\n  ${columns
                      .map(
                        (c) =>
                          `${c.name} ${c.type}${c.primary_key ? ' PRIMARY KEY' : ''}${
                            c.nullable ? '' : ' NOT NULL'
                          }`
                      )
                      .join(',\n  ')}\n);`;
                    handleCopy(ddl, 'ddl');
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] bg-[#141414] border border-[#242424] text-[12px] text-[#cccccc] hover:text-white"
                >
                  {copiedKey === 'ddl' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>Copy DDL</span>
                </button>
              </div>

              <table className="w-full border-collapse text-left text-[12.5px]">
                <thead>
                  <tr className="bg-[#141414] text-[11.5px] font-medium text-[#777777] border-b border-[#222222]">
                    <th className="px-4 py-2">Column</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Primary Key</th>
                    <th className="px-4 py-2">Nullable</th>
                    <th className="px-4 py-2">Foreign Key Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181818] font-mono">
                  {columns.map((col) => {
                    const fk = foreignKeys.find((f) => f.column === col.name);
                    return (
                      <tr key={col.name} className="hover:bg-[#121212]">
                        <td className="px-4 py-2 text-white flex items-center gap-2">
                          {col.name}
                          {col.primary_key && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
                              PK
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-[#cccccc]">{col.type}</td>
                        <td className="px-4 py-2 text-[#8c8c8c]">{col.primary_key ? 'Yes' : 'No'}</td>
                        <td className="px-4 py-2 text-[#8c8c8c]">{col.nullable ? 'NULL' : 'NOT NULL'}</td>
                        <td className="px-4 py-2 text-blue-400">
                          {fk ? `${fk.referenced_table}.${fk.referenced_column}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── Mode 3: SQL Console ─── */}
        {viewMode === 'sql' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-4 space-y-3">
            {/* Query Editor Box */}
            <div className="rounded-[8px] border border-[#222222] bg-[#0f0f0f] p-3 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  <span className="text-[16px] font-semibold text-white">SQL Query Runner</span>
                  <span className="text-[12px] text-[#666666]">
                    (<kbd className="px-1 py-0.5 rounded bg-[#1c1c1c] text-[#8c8c8c] font-mono">Ctrl+Enter</kbd> to execute)
                  </span>
                </div>

                {/* Preset query buttons */}
                <div className="flex items-center gap-1.5">
                  {selectedTable && (
                    <button
                      onClick={() => setSqlQuery(`SELECT * FROM ${selectedTable} LIMIT 25;`)}
                      className="px-2 py-0.5 rounded bg-[#141414] border border-[#242424] text-[12px] text-[#8c8c8c] hover:text-white"
                    >
                      SELECT *
                    </button>
                  )}
                  {selectedTable && (
                    <button
                      onClick={() => setSqlQuery(`SELECT count(*) AS total_rows FROM ${selectedTable};`)}
                      className="px-2 py-0.5 rounded bg-[#141414] border border-[#242424] text-[12px] text-[#8c8c8c] hover:text-white"
                    >
                      COUNT(*)
                    </button>
                  )}
                </div>
              </div>

              <textarea
                rows={5}
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleExecuteSql();
                  }
                }}
                placeholder="Enter SQL statement..."
                className="w-full p-3 bg-[#080808] border border-[#202020] rounded-[6px] font-mono text-[13px] text-emerald-300 placeholder-[#555555] outline-none focus:border-emerald-500/60 resize-y"
              />

              <div className="flex items-center justify-between mt-2 pt-1">
                <div className="text-[12px] text-[#666666]">
                  Target database: <span className="font-mono text-[#cccccc]">{selectedDb}</span>
                </div>

                <button
                  onClick={handleExecuteSql}
                  disabled={isExecutingSql || !sqlQuery.trim()}
                  className="flex items-center gap-2 h-8 px-4 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] disabled:opacity-40 text-[#cccccc] hover:text-white text-[13px] font-medium transition-colors cursor-pointer"
                >
                  {isExecutingSql ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  )}
                  <span>Run Query</span>
                </button>
              </div>
            </div>

            {/* Results Grid */}
            <div className="flex-1 rounded-[8px] border border-[#222222] bg-[#0f0f0f] flex flex-col min-h-0 overflow-hidden">
              <div className="h-9 px-4 bg-[#141414] border-b border-[#222222] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-white">Query Output</span>
                  {sqlDuration !== null && (
                    <span className="text-[12px] px-1.5 py-0.5 rounded bg-[#1c1c1c] text-[#8c8c8c] font-mono">
                      {sqlDuration}ms
                    </span>
                  )}
                </div>

                {sqlResult?.rows && sqlResult.rows.length > 0 && (
                  <div className="text-[12px] text-[#8c8c8c]">
                    {sqlResult.rows.length} rows returned
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-auto p-2">
                {isExecutingSql ? (
                  <div className="flex items-center justify-center h-40 text-[#8c8c8c] text-[13px] gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
                    Executing query...
                  </div>
                ) : sqlError ? (
                  <div className="p-6 text-center text-rose-400 text-[13px] font-mono whitespace-pre-wrap">
                    <AlertCircle className="w-6 h-6 mx-auto mb-2 text-rose-500" />
                    {sqlError}
                  </div>
                ) : !sqlResult ? (
                  <div className="flex items-center justify-center h-40 text-[#555555] text-[13px]">
                    Run a query above to view results
                  </div>
                ) : sqlResult.affected_rows !== undefined && !sqlResult.rows ? (
                  <div className="p-6 text-center text-emerald-400 text-[14px]">
                    <Check className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
                    Query executed successfully. Affected rows: {sqlResult.affected_rows}
                  </div>
                ) : (
                  <table className="w-full border-collapse text-left font-mono text-[13px]">
                    <thead>
                      <tr className="bg-[#141414] border-b border-[#222222] text-[#8c8c8c]">
                        {(sqlResult.columns || (sqlResult.rows && sqlResult.rows[0] ? Object.keys(sqlResult.rows[0]) : [])).map(
                          (col) => (
                            <th key={col} className="px-3 py-2 text-white">
                              {col}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#181818]">
                      {(sqlResult.rows || []).map((r, i) => (
                        <tr key={i} className="hover:bg-[#141414]">
                          {Object.values(r).map((v, ci) => (
                            <td key={ci} className="px-3 py-2 text-[#cccccc] truncate max-w-xs">
                              {v === null ? (
                                <span className="text-[#555555] italic text-[12px]">null</span>
                              ) : typeof v === 'object' ? (
                                JSON.stringify(v)
                              ) : (
                                String(v)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ══════════════════════════════════════════════════════════════════════
          SLIDEOVER: RIGHT OVERFLOW DRAWER PANEL (matching Database page)
          ══════════════════════════════════════════════════════════════════════ */}
      {/* ══════════════════════════════════════════════════════════════════════
          SLIDEOVER: RIGHT OVERFLOW DRAWER PANEL (matching Database page)
          ══════════════════════════════════════════════════════════════════════ */}
      <SlideOver
        isOpen={isDetailsOpen}
        onClose={() => {
          setIsDetailsOpen(false);
          setIsInsertModeInPanel(false);
          setInspectorTab('details');
        }}
        width="w-[520px] max-w-full"
        title={
          isInsertModeInPanel
            ? 'Insert New Row'
            : activeRow
            ? `Row #${selectedRowIndex! + 1}`
            : ''
        }
        subtitle={
          isInsertModeInPanel
            ? `Add record to ${selectedTable}`
            : activeRow
            ? `${selectedTable} · ${columns.length} columns`
            : ''
        }
      >
        {/* Tab bar (Segmented control matching Databases page) */}
        {!isInsertModeInPanel && activeRow && (
          <div className="px-5 py-3 border-b border-[#222222] bg-[#0e0e0e] shrink-0 font-sans">
            <div className="inline-flex items-center p-0.5 rounded-[8px] bg-transparent border border-[#262626]">
              <button
                type="button"
                onClick={() => setInspectorTab('details')}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                  inspectorTab === 'details'
                    ? 'bg-[#161616] text-white border-[#333333]'
                    : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
                }`}
              >
                <span>Record Values</span>
              </button>
              <button
                type="button"
                onClick={() => setInspectorTab('danger')}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                  inspectorTab === 'danger'
                    ? 'bg-[#161616] text-white border-[#333333]'
                    : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
                }`}
              >
                <span>Danger</span>
              </button>
            </div>
          </div>
        )}

        {/* Drawer Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 font-sans">
          {isInsertModeInPanel ? (
            /* Insert New Row Form */
            <div className="space-y-4 font-sans">
              <div className="text-[13.5px] text-[#8c8c8c]">
                Specify column values for the new record in <span className="font-mono text-white font-medium">{selectedTable}</span>.
              </div>

              {(() => {
                const isIdOrPk = (c: typeof columns[0]) => c.primary_key || c.name.toLowerCase() === 'id';
                const requiredCols = [
                  ...columns.filter(isIdOrPk),
                  ...columns.filter((c) => !isIdOrPk(c) && !c.nullable),
                ];
                const optionalCols = columns.filter((c) => !isIdOrPk(c) && c.nullable);

                const renderColField = (col: typeof columns[0]) => {
                  const val = rowEditValues[col.name];
                  const normType = col.type.toLowerCase();
                  const isAutoPk = col.primary_key && normType.includes('int');
                  const isNumber =
                    normType.includes('int') ||
                    normType.includes('float') ||
                    normType.includes('double') ||
                    normType.includes('decimal') ||
                    normType.includes('numeric') ||
                    normType.includes('real') ||
                    normType.includes('serial') ||
                    normType.includes('money');
                  const isBool = normType.includes('bool') || normType === 'bit';
                  const isDate = normType === 'date';
                  const isTimestamp =
                    normType.includes('time') ||
                    normType.includes('date');

                  return (
                    <div key={col.name} className="space-y-1.5">
                      {/* Title & Type Header Above Input */}
                      <div className="flex items-center justify-between">
                        <label className="text-[13.5px] font-medium text-white flex items-center gap-1.5 font-sans">
                          <span>{col.name}</span>
                          {col.primary_key && <Key className="w-3 h-3 text-amber-400 shrink-0" />}
                          {(() => {
                            const fk = foreignKeys.find((f) => f.column === col.name);
                            if (!fk) return null;
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  setFkPickerTarget({
                                    column: col.name,
                                    fk,
                                    currentValue: val,
                                    onSelect: (newVal) => {
                                      setRowEditValues((prev) => ({ ...prev, [col.name]: newVal }));
                                    },
                                  });
                                }}
                                title={`Pick record from ${fk.referenced_table}`}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/25 transition-colors cursor-pointer"
                              >
                                <span>→ {fk.referenced_table}</span>
                              </button>
                            );
                          })()}
                        </label>
                        <span className="text-[12px] font-mono text-[#777777]">
                          {col.type}
                        </span>
                      </div>

                      {/* Input placed directly under title */}
                      <div>
                        {isBool ? (
                          <CustomSelect
                            value={val === null || val === undefined ? '' : String(val)}
                            options={[
                              { value: '', label: 'NULL (Unset)' },
                              { value: 'true', label: 'TRUE' },
                              { value: 'false', label: 'FALSE' },
                            ]}
                            onChange={(v) => {
                              setRowEditValues({
                                ...rowEditValues,
                                [col.name]: v === '' ? null : v === 'true',
                              });
                            }}
                            menuWidth="w-full"
                          />
                        ) : isNumber ? (
                          <FieldEditorWrapper
                            label={col.name}
                            type="number"
                            step={normType.includes('float') || normType.includes('double') || normType.includes('numeric') || normType.includes('decimal') ? 'any' : '1'}
                            placeholder={isAutoPk ? 'Auto-increment' : col.nullable ? 'Optional (NULL)' : 'Required'}
                            value={val}
                            isNullable={col.nullable}
                            onChange={(v) =>
                              setRowEditValues({ ...rowEditValues, [col.name]: v })
                            }
                          />
                        ) : isTimestamp ? (
                          <DateTimePickerInput
                            value={val}
                            isDateOnly={isDate}
                            placeholder={isDate ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm:ss'}
                            onChange={(v) =>
                              setRowEditValues({ ...rowEditValues, [col.name]: v })
                            }
                          />
                        ) : (
                          <FieldEditorWrapper
                            label={col.name}
                            isMultiline={true}
                            placeholder={col.nullable ? 'Optional (NULL)' : 'Required'}
                            value={val}
                            isNullable={col.nullable}
                            onChange={(v) =>
                              setRowEditValues({ ...rowEditValues, [col.name]: v })
                            }
                          />
                        )}
                      </div>
                    </div>
                  );
                };

                return (
                  <div className="space-y-4">
                    {/* Required / Primary Columns */}
                    {requiredCols.length > 0 && (
                      <div className="space-y-4">
                        {requiredCols.map(renderColField)}
                      </div>
                    )}

                    {/* Optional Fields Section with Edge-to-Edge Divider Line */}
                    {optionalCols.length > 0 && (
                      <div className="pt-2 space-y-4">
                        <div className="-mx-4 sm:-mx-5 px-4 sm:px-5 pt-4 border-t border-[#222222]">
                          <h4 className="text-[14px] font-semibold text-white tracking-tight font-sans">
                            Optional Fields
                          </h4>
                          <p className="text-[12.5px] text-[#8c8c8c] mt-0.5 font-sans">
                            These are columns that do not need any value
                          </p>
                        </div>

                        <div className="space-y-4">
                          {optionalCols.map(renderColField)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : activeRow && inspectorTab === 'danger' ? (
            /* Danger Tab matching Databases page */
            <div className="space-y-4 font-sans">
              <div className="rounded-[8px] border border-[#3a1515] bg-[#0e0404] p-4">
                <h3 className="text-[16px] font-medium text-[#e5484d] mb-1 font-sans">Delete Record</h3>
                <p className="text-[13px] text-[#8c8c8c] mb-4 font-sans">
                  Permanently delete this row from <span className="text-white font-medium text-[13px] font-mono">{selectedTable}</span>. This action is irreversible and immediately executes against the database.
                </p>
                <button
                  type="button"
                  onClick={() => setDeleteRowTarget(activeRow)}
                  className="group relative flex shrink-0 items-center justify-center h-8 px-3.5 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#be123c] bg-[#e11d48] font-sans text-[13px]"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#f43f5e] to-[#e11d48] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
                  />
                  <span className="relative flex items-center gap-1.5 font-sans">
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Row</span>
                  </span>
                </button>
              </div>
            </div>
          ) : activeRow ? (
            /* Selected Row Editing Fields (Details Tab) with Input Area Under Title */
            <div className="space-y-4 font-sans">
              {(() => {
                const isIdOrPk = (c: typeof columns[0]) => c.primary_key || c.name.toLowerCase() === 'id';
                const requiredCols = [
                  ...columns.filter(isIdOrPk),
                  ...columns.filter((c) => !isIdOrPk(c) && !c.nullable),
                ];
                const optionalCols = columns.filter((c) => !isIdOrPk(c) && c.nullable);

                const renderColField = (col: typeof columns[0]) => {
                  const val = rowEditValues[col.name];
                  const isNull = val === null || val === undefined;
                  const normType = col.type.toLowerCase();
                  const isNumber =
                    normType.includes('int') ||
                    normType.includes('float') ||
                    normType.includes('double') ||
                    normType.includes('decimal') ||
                    normType.includes('numeric') ||
                    normType.includes('real') ||
                    normType.includes('serial') ||
                    normType.includes('money');
                  const isBool = normType.includes('bool') || normType === 'bit';
                  const isDate = normType === 'date';
                  const isTimestamp =
                    normType.includes('time') ||
                    normType.includes('date');

                  return (
                    <div key={col.name} className="space-y-1.5">
                      {/* Title & Type Header Above Input */}
                      <div className="flex items-center justify-between">
                        <label className="text-[13.5px] font-medium text-white flex items-center gap-1.5 font-sans">
                          <span>{col.name}</span>
                          {col.primary_key && <Key className="w-3 h-3 text-amber-400 shrink-0" />}
                          {isColReadOnly(col) && !col.primary_key && (
                            <span className="text-[11px] text-[#777777] font-normal">(Read-only)</span>
                          )}
                          {(() => {
                            const fk = foreignKeys.find((f) => f.column === col.name);
                            if (!fk || isColReadOnly(col)) return null;
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  setFkPickerTarget({
                                    column: col.name,
                                    fk,
                                    currentValue: val,
                                    onSelect: (newVal) => {
                                      setRowEditValues((prev) => ({ ...prev, [col.name]: newVal }));
                                    },
                                  });
                                }}
                                title={`Pick record from ${fk.referenced_table}`}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/25 transition-colors cursor-pointer"
                              >
                                <span>→ {fk.referenced_table}</span>
                              </button>
                            );
                          })()}
                        </label>
                        <span className="text-[12px] font-mono text-[#777777]">
                          {col.type}
                        </span>
                      </div>

                      {/* Input Area Placed Directly Under Title */}
                      <div>
                        {isBool ? (
                          <CustomSelect
                            disabled={isColReadOnly(col)}
                            value={isNull ? '' : String(val)}
                            options={[
                              { value: '', label: 'NULL' },
                              { value: 'true', label: 'TRUE' },
                              { value: 'false', label: 'FALSE' },
                            ]}
                            onChange={(v) => {
                              setRowEditValues({
                                ...rowEditValues,
                                [col.name]: v === '' ? null : v === 'true',
                              });
                            }}
                            menuWidth="w-full"
                          />
                        ) : isNumber ? (
                          <FieldEditorWrapper
                            label={col.name}
                            type="number"
                            step={normType.includes('float') || normType.includes('double') || normType.includes('numeric') || normType.includes('decimal') ? 'any' : '1'}
                            disabled={isColReadOnly(col)}
                            value={val}
                            isNullable={col.nullable}
                            placeholder={col.nullable ? 'Optional (NULL)' : 'Required'}
                            onChange={(v) =>
                              setRowEditValues({ ...rowEditValues, [col.name]: v })
                            }
                          />
                        ) : isTimestamp ? (
                          <DateTimePickerInput
                            value={isNull ? null : val}
                            disabled={isColReadOnly(col)}
                            isDateOnly={isDate}
                            placeholder={isDate ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm:ss'}
                            onChange={(v) =>
                              setRowEditValues({ ...rowEditValues, [col.name]: v })
                            }
                          />
                        ) : (
                          <FieldEditorWrapper
                            label={col.name}
                            isMultiline={true}
                            disabled={isColReadOnly(col)}
                            value={val}
                            isNullable={col.nullable}
                            placeholder={col.nullable ? 'Optional (NULL)' : 'Required'}
                            onChange={(v) =>
                              setRowEditValues({ ...rowEditValues, [col.name]: v })
                            }
                          />
                        )}
                      </div>
                    </div>
                  );
                };

                return (
                  <div className="space-y-4">
                    {/* Required / Non-nullable Columns */}
                    {requiredCols.length > 0 && (
                      <div className="space-y-4">
                        {requiredCols.map(renderColField)}
                      </div>
                    )}

                    {/* Optional Fields Section with Edge-to-Edge Divider Line */}
                    {optionalCols.length > 0 && (
                      <div className="pt-2 space-y-4">
                        <div className="-mx-4 sm:-mx-5 px-4 sm:px-5 pt-4 border-t border-[#222222]">
                          <h4 className="text-[14px] font-semibold text-white tracking-tight font-sans">
                            Optional Fields
                          </h4>
                          <p className="text-[12.5px] text-[#8c8c8c] mt-0.5 font-sans">
                            These are columns that do not need any value
                          </p>
                        </div>

                        <div className="space-y-4">
                          {optionalCols.map(renderColField)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : null}
        </div>

        {/* Footer (Pinned to bottom matching Databases page) */}
        {(isInsertModeInPanel || (activeRow && inspectorTab === 'details')) && (
          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans shrink-0">
            <button
              type="button"
              onClick={() => {
                if (isInsertModeInPanel) {
                  setIsInsertModeInPanel(false);
                } else {
                  setIsDetailsOpen(false);
                }
              }}
              className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
            >
              Close
            </button>
            <button
              type="button"
              onClick={isInsertModeInPanel ? handleInsertRowFromPanel : handleSaveRowEdit}
              disabled={isSavingRow || !hasRowChanges}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative flex items-center gap-1.5 text-[14px] font-sans">
                {isSavingRow ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>{isInsertModeInPanel ? 'Save Record' : 'Save'}</span>
                )}
              </span>
            </button>
          </div>
        )}
      </SlideOver>

      {/* ─── Delete Row Confirm Dialog ─── */}
      <ConfirmDialog
        isOpen={!!deleteRowTarget}
        title="Delete Row"
        description="Are you sure you want to permanently delete this row? This action cannot be reversed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteRow}
        onClose={() => setDeleteRowTarget(null)}
      />

      {/* ─── Inline Cell Popover Editor ─── */}
      {editingCell && (() => {
        const normType = editingCell.column?.type?.toLowerCase() || '';
        const isBool = normType.includes('bool') || normType === 'bit' || typeof editingCell.initialValue === 'boolean';
        const isDate = normType === 'date';
        const isTimeOrTimestamp = normType.includes('time') || normType.includes('timestamp');
        const isDateTime = isDate || isTimeOrTimestamp;

        if (isBool) {
          return (
            <InlineBooleanPopover
              editingCell={editingCell}
              onSave={handleCommitCellEdit}
              onCancel={() => setEditingCell(null)}
            />
          );
        }

        if (isDateTime) {
          return (
            <InlineDateTimePickerPopover
              editingCell={editingCell}
              onSave={handleCommitCellEdit}
              onCancel={() => setEditingCell(null)}
            />
          );
        }

        return (
          <InlineCellEditorPopover
            editingCell={editingCell}
            onChange={(val) =>
              setEditingCell((prev) => (prev ? { ...prev, currentValue: val } : null))
            }
            onSave={handleCommitCellEdit}
            onCancel={() => setEditingCell(null)}
            onExpand={() => {
              const current = editingCell;
              setEditingCell(null);
              setExpandedInlineCell({
                rowIndex: current.rowIndex,
                colName: current.colName,
                value: current.currentValue,
              });
            }}
          />
        );
      })()}

      {/* ─── Expanded Inline Cell SlideOver Panel ─── */}
      <SlideOver
        isOpen={!!expandedInlineCell}
        onClose={() => setExpandedInlineCell(null)}
        width="w-[520px] max-w-full"
        title={expandedInlineCell?.colName || 'Field'}
        subtitle="Edit field value"
      >
        <div className="flex-1 flex flex-col min-h-0 bg-[#0e0e0e] overflow-hidden font-sans">
          <div className="flex-1 p-4 sm:p-5 flex flex-col min-h-0 space-y-2 overflow-hidden">
            <div className="flex items-center justify-between">
              <label className="text-[13.5px] font-medium text-white font-sans">
                Value
              </label>
              <span className="text-[12px] font-mono text-[#777777]">
                {(expandedInlineCell?.value || '').length} chars · {(expandedInlineCell?.value || '').split('\n').length} lines
              </span>
            </div>
            <textarea
              value={expandedInlineCell?.value || ''}
              onChange={(e) =>
                setExpandedInlineCell((prev) =>
                  prev ? { ...prev, value: e.target.value } : null
                )
              }
              autoFocus
              spellCheck={false}
              className="flex-1 w-full rounded-[6px] border border-[#262626] bg-[#121212] p-3 text-[14px] leading-relaxed text-white font-sans focus:outline-none focus:border-[#3b82f6] resize-none placeholder-[#555555] transition-colors whitespace-pre"
              placeholder="Enter value..."
            />
          </div>

          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans shrink-0">
            <button
              type="button"
              onClick={() => setExpandedInlineCell(null)}
              className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!expandedInlineCell) return;
                const { rowIndex, colName, value } = expandedInlineCell;
                setExpandedInlineCell(null);
                await handleSaveCellEdit(rowIndex, colName, value);
              }}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative flex items-center text-[14px] font-sans">
                Apply
              </span>
            </button>
          </div>
        </div>
      </SlideOver>

      {/* ─── Foreign Key Reference Record Picker Modal (Image 1 & 2) ─── */}
      {fkPickerTarget && selectedDb && (
        <ForeignKeyPickerModal
          db={selectedDb}
          fk={fkPickerTarget.fk}
          currentValue={fkPickerTarget.currentValue}
          onSelect={handleSelectFkRecord}
          onClose={() => setFkPickerTarget(null)}
        />
      )}

      {/* ─── Foreign Key Record Preview Popover (Image 3) ─── */}
      {fkPreviewTarget && selectedDb && (
        <ForeignKeyRecordPreviewPopover
          db={selectedDb}
          fk={fkPreviewTarget.fk}
          currentValue={fkPreviewTarget.currentValue}
          anchorRect={fkPreviewTarget.rect}
          onClose={() => setFkPreviewTarget(null)}
          onOpenTable={handleOpenReferencedTable}
        />
      )}
    </div>
  );
}
