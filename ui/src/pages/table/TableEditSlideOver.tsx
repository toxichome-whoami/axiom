/*
 * Supabase Studio-styled "Update table" SlideOver Panel.
 * Allows editing table name, description, Row Level Security (RLS), Realtime toggle,
 * interactive columns editor with advanced settings, and foreign keys management.
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../types, ../../components/ui/SlideOver, ../../components/ui/Switch
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Link2,
  HelpCircle,
  Settings,
  X,
  Plus,
  Info,
  ExternalLink,
  ChevronDown,
  Trash2,
  Edit2,
  Check,
  ArrowRight,
} from 'lucide-react';
import { ColumnInfoApi, ForeignKeyInfoApi, TableInfoApi } from '../../types';
import { SlideOver } from '../../components/ui/SlideOver';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Switch } from '../../components/ui/Switch';
import { CustomSelect } from '../../components/shared/CustomSelect';
import { api } from '../../api/client';
import { formatColumnType } from './format';

export interface EditableColumnDraft {
  id: string; // unique draft id
  originalName?: string; // present if existing column
  name: string;
  type: string;
  defaultValue: string;
  primaryKey: boolean;
  nullable: boolean;
  unique: boolean;
  check: string;
  isArray: boolean;
  isForeignKey?: boolean;
}

export interface TableEditSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDb: string;
  tableName: string;
  tables: TableInfoApi[];
  columns: ColumnInfoApi[];
  foreignKeys: ForeignKeyInfoApi[];
  onSave: (payload: {
    newName: string;
    description: string;
    columns: EditableColumnDraft[];
    foreignKeys: ForeignKeyInfoApi[];
  }) => Promise<void>;
  onOpenFkModal?: (fk?: ForeignKeyInfoApi) => void;
}

const COMMON_SQL_TYPES = [
  { value: 'int8', label: 'int8', group: 'Numbers' },
  { value: 'int4', label: 'int4', group: 'Numbers' },
  { value: 'int2', label: 'int2', group: 'Numbers' },
  { value: 'numeric', label: 'numeric', group: 'Numbers' },
  { value: 'float8', label: 'float8', group: 'Numbers' },
  { value: 'text', label: 'text', group: 'Text' },
  { value: 'varchar', label: 'varchar', group: 'Text' },
  { value: 'uuid', label: 'uuid', group: 'Identities' },
  { value: 'bool', label: 'bool', group: 'Logical' },
  { value: 'timestamptz', label: 'timestamptz', group: 'Dates' },
  { value: 'timestamp', label: 'timestamp', group: 'Dates' },
  { value: 'date', label: 'date', group: 'Dates' },
  { value: 'jsonb', label: 'jsonb', group: 'JSON' },
  { value: 'json', label: 'json', group: 'JSON' },
];

export function TableEditSlideOver({
  isOpen,
  onClose,
  selectedDb,
  tableName,
  tables,
  columns: initialColumns,
  foreignKeys: initialForeignKeys,
  onSave,
  onOpenFkModal,
}: TableEditSlideOverProps) {
  // Table info state
  const [name, setName] = useState(tableName);
  const [description, setDescription] = useState('');

  // Column drafts
  const [colDrafts, setColDrafts] = useState<EditableColumnDraft[]>([]);
  // Foreign key drafts
  const [fkDrafts, setFkDrafts] = useState<ForeignKeyInfoApi[]>([]);

  // Foreign Key Nested SlideOver State
  const [isFkSlideOverOpen, setIsFkSlideOverOpen] = useState(false);
  const [editingFkIndex, setEditingFkIndex] = useState<number | null>(null);
  const [draftFkTable, setDraftFkTable] = useState('');
  const [draftFkPairs, setDraftFkPairs] = useState<Array<{ sourceCol: string; targetCol: string }>>([
    { sourceCol: '', targetCol: '' },
  ]);
  const [draftFkOnUpdate, setDraftFkOnUpdate] = useState<'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT'>('NO ACTION');
  const [draftFkOnDelete, setDraftFkOnDelete] = useState<'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT'>('NO ACTION');
  const [initialFkState, setInitialFkState] = useState<{
    table: string;
    pairs: Array<{ sourceCol: string; targetCol: string }>;
    onUpdate: string;
    onDelete: string;
  } | null>(null);
  const [isDiscardFkConfirmOpen, setIsDiscardFkConfirmOpen] = useState(false);
  const [schemaCache, setSchemaCache] = useState<Record<string, { columns: ColumnInfoApi[] }>>({});

  // Advanced Column Settings Popover
  const [activeSettingsColId, setActiveSettingsColId] = useState<string | null>(null);
  const settingsPopoverRef = useRef<HTMLDivElement>(null);

  // Type Selector Dropdown State
  const [activeTypeDropdownColId, setActiveTypeDropdownColId] = useState<string | null>(null);
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Confirmation dialog states
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  const [deleteColTarget, setDeleteColTarget] = useState<EditableColumnDraft | null>(null);
  const [deleteFkTarget, setDeleteFkTarget] = useState<ForeignKeyInfoApi | null>(null);

  // Sync state when panel opens or table changes
  useEffect(() => {
    if (!isOpen) return;
    setName(tableName);
    setDescription('');
    setSaveError(null);
    setActiveSettingsColId(null);
    setActiveTypeDropdownColId(null);
    setIsDiscardConfirmOpen(false);
    setDeleteColTarget(null);
    setDeleteFkTarget(null);
    setIsFkSlideOverOpen(false);
    setIsDiscardFkConfirmOpen(false);
    setEditingFkIndex(null);

    const fks = initialForeignKeys || [];
    setFkDrafts(fks);

    if (!tableName && (!initialColumns || initialColumns.length === 0)) {
      setColDrafts([
        {
          id: `col-id-${Math.random().toString(36).slice(2, 7)}`,
          name: 'id',
          type: 'int8',
          defaultValue: '',
          primaryKey: true,
          nullable: false,
          unique: true,
          check: '',
          isArray: false,
          isForeignKey: false,
        },
        {
          id: `col-created_at-${Math.random().toString(36).slice(2, 7)}`,
          name: 'created_at',
          type: 'timestamptz',
          defaultValue: 'now()',
          primaryKey: false,
          nullable: false,
          unique: false,
          check: '',
          isArray: false,
          isForeignKey: false,
        },
      ]);
    } else {
      const mappedCols: EditableColumnDraft[] = (initialColumns || []).map((c) => {
        const isFk = fks.some((f) => f.column === c.name);
        return {
          id: `col-${c.name}-${Math.random().toString(36).slice(2, 7)}`,
          originalName: c.name,
          name: c.name,
          type: formatColumnType(c.type),
          defaultValue: c.default_value ?? 'NULL',
          primaryKey: !!c.primary_key,
          nullable: c.nullable ?? true,
          unique: !!c.unique,
          check: '',
          isArray: false,
          isForeignKey: isFk,
        };
      });

      setColDrafts(mappedCols);
    }
  }, [isOpen, tableName, initialColumns, initialForeignKeys]);

  // Compute if any actual changes have been made
  const hasChanges = useMemo(() => {
    if (!tableName) {
      return name.trim().length > 0;
    }
    if (name.trim() !== tableName) return true;
    if (description.trim() !== '') return true;

    // Check foreign keys count and differences
    const origFks = initialForeignKeys || [];
    if (fkDrafts.length !== origFks.length) return true;
    const origFkCols = new Set(origFks.map((f) => `${f.column}->${f.referenced_table}.${f.referenced_column}`));
    const draftFkCols = new Set(fkDrafts.map((f) => `${f.column}->${f.referenced_table}.${f.referenced_column}`));
    for (const key of origFkCols) {
      if (!draftFkCols.has(key)) return true;
    }

    // Check columns count
    if (colDrafts.length !== initialColumns.length) return true;

    // Check each column
    for (const col of colDrafts) {
      if (!col.originalName) return true; // Newly added column
      const orig = initialColumns.find((c) => c.name === col.originalName);
      if (!orig) return true;
      if (col.name.trim() !== orig.name) return true;
      if (formatColumnType(col.type) !== formatColumnType(orig.type)) return true;
      const origDef = orig.default_value ?? 'NULL';
      if (col.defaultValue.trim() !== origDef.trim()) return true;
      if (col.primaryKey !== !!orig.primary_key) return true;
      if (col.nullable !== (orig.nullable ?? true)) return true;
      if (col.unique || col.check || col.isArray) return true;
    }

    return false;
  }, [name, description, tableName, fkDrafts, initialForeignKeys, colDrafts, initialColumns]);

  // Handle request to close
  const handleRequestClose = () => {
    if (hasChanges) {
      setIsDiscardConfirmOpen(true);
    } else {
      onClose();
    }
  };

  // Handle outside clicks to close popovers
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        settingsPopoverRef.current &&
        !settingsPopoverRef.current.contains(target)
      ) {
        setActiveSettingsColId(null);
      }
      if (
        typeDropdownRef.current &&
        !typeDropdownRef.current.contains(target)
      ) {
        setActiveTypeDropdownColId(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Handle Ctrl+Enter to save
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (hasChanges && !isSaving) {
          handleSave();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasChanges, isSaving, name, description, colDrafts, fkDrafts]);

  const handleAddColumn = () => {
    const newId = `col-new-${Date.now()}`;
    const newDraft: EditableColumnDraft = {
      id: newId,
      name: '',
      type: 'text',
      defaultValue: 'NULL',
      primaryKey: false,
      nullable: true,
      unique: false,
      check: '',
      isArray: false,
    };
    setColDrafts((prev) => [...prev, newDraft]);
  };

  const handleRemoveColumn = (colId: string) => {
    const col = colDrafts.find((c) => c.id === colId);
    if (!col) return;
    // If it's a new empty draft, delete immediately; otherwise prompt confirmation
    if (!col.originalName && !col.name.trim()) {
      setColDrafts((prev) => prev.filter((c) => c.id !== colId));
      if (activeSettingsColId === colId) setActiveSettingsColId(null);
      if (activeTypeDropdownColId === colId) setActiveTypeDropdownColId(null);
    } else {
      setDeleteColTarget(col);
    }
  };

  const confirmDeleteColumn = () => {
    if (!deleteColTarget) return;
    const colId = deleteColTarget.id;
    setColDrafts((prev) => prev.filter((c) => c.id !== colId));
    if (activeSettingsColId === colId) setActiveSettingsColId(null);
    if (activeTypeDropdownColId === colId) setActiveTypeDropdownColId(null);
    setDeleteColTarget(null);
  };

  const handleUpdateColumn = (
    colId: string,
    updates: Partial<EditableColumnDraft>
  ) => {
    setColDrafts((prev) =>
      prev.map((c) => (c.id === colId ? { ...c, ...updates } : c))
    );
  };

  const handleRemoveFk = (fk: ForeignKeyInfoApi) => {
    setDeleteFkTarget(fk);
  };

  const confirmRemoveFk = () => {
    if (!deleteFkTarget) return;
    const fkCol = deleteFkTarget.column;
    setFkDrafts((prev) => prev.filter((f) => f.column !== fkCol));
    setColDrafts((prev) =>
      prev.map((c) => (c.name === fkCol ? { ...c, isForeignKey: false } : c))
    );
    setDeleteFkTarget(null);
  };

  const handleOpenFkModalInternal = async (fk?: ForeignKeyInfoApi, index?: number) => {
    if (fk && typeof index === 'number') {
      const initTable = fk.referenced_table;
      const initPairs = [{ sourceCol: fk.column, targetCol: fk.referenced_column }];
      setEditingFkIndex(index);
      setDraftFkTable(initTable);
      setDraftFkPairs(initPairs);
      setDraftFkOnUpdate('NO ACTION');
      setDraftFkOnDelete('NO ACTION');
      setInitialFkState({
        table: initTable,
        pairs: initPairs,
        onUpdate: 'NO ACTION',
        onDelete: 'NO ACTION',
      });

      // Immediately fetch schema for referenced table if not cached
      if (selectedDb && initTable && !schemaCache[initTable]) {
        try {
          const res = await api.getTableSchema(selectedDb, initTable);
          setSchemaCache((prev) => ({
            ...prev,
            [initTable]: { columns: res.columns || [] },
          }));
        } catch {}
      }
    } else {
      const defaultSource = colDrafts[0]?.name || '';
      const initPairs = [{ sourceCol: defaultSource, targetCol: '' }];
      setEditingFkIndex(null);
      setDraftFkTable('');
      setDraftFkPairs(initPairs);
      setDraftFkOnUpdate('NO ACTION');
      setDraftFkOnDelete('NO ACTION');
      setInitialFkState({
        table: '',
        pairs: initPairs,
        onUpdate: 'NO ACTION',
        onDelete: 'NO ACTION',
      });
    }
    setIsFkSlideOverOpen(true);
  };

  const handleSelectFkTargetTable = async (tbl: string) => {
    setDraftFkTable(tbl);
    if (!selectedDb || !tbl) return;
    try {
      let targetCols = schemaCache[tbl]?.columns;
      if (!targetCols) {
        const res = await api.getTableSchema(selectedDb, tbl);
        targetCols = res.columns || [];
        setSchemaCache((prev) => ({
          ...prev,
          [tbl]: { columns: targetCols || [] },
        }));
      }
      const pk = targetCols?.find((c) => c.primary_key);
      const defaultCol = pk ? pk.name : targetCols?.[0]?.name || 'id';
      setDraftFkPairs((prev) =>
        prev.map((p, idx) => (idx === 0 ? { ...p, targetCol: defaultCol } : p))
      );
    } catch {}
  };

  const hasFkChanges = useMemo(() => {
    if (!initialFkState) return false;
    if (draftFkTable !== initialFkState.table) return true;
    if (draftFkOnUpdate !== initialFkState.onUpdate) return true;
    if (draftFkOnDelete !== initialFkState.onDelete) return true;
    if (draftFkPairs.length !== initialFkState.pairs.length) return true;
    for (let i = 0; i < draftFkPairs.length; i++) {
      if (
        draftFkPairs[i].sourceCol !== initialFkState.pairs[i]?.sourceCol ||
        draftFkPairs[i].targetCol !== initialFkState.pairs[i]?.targetCol
      ) {
        return true;
      }
    }
    return false;
  }, [draftFkTable, draftFkPairs, draftFkOnUpdate, draftFkOnDelete, initialFkState]);

  const handleRequestCloseFkModal = () => {
    if (hasFkChanges) {
      setIsDiscardFkConfirmOpen(true);
    } else {
      setIsFkSlideOverOpen(false);
    }
  };

  const isFkSaveDisabled =
    !draftFkTable ||
    !draftFkPairs[0]?.sourceCol ||
    !draftFkPairs[0]?.targetCol ||
    !hasFkChanges;

  const handleSaveFk = () => {
    if (isFkSaveDisabled) return;
    const pair = draftFkPairs[0];
    const newFk: ForeignKeyInfoApi = {
      column: pair.sourceCol,
      referenced_table: draftFkTable,
      referenced_column: pair.targetCol,
    };

    if (editingFkIndex !== null) {
      setFkDrafts((prev) =>
        prev.map((f, i) => (i === editingFkIndex ? newFk : f))
      );
    } else {
      setFkDrafts((prev) => [...prev, newFk]);
    }

    // Mark corresponding column draft as isForeignKey
    setColDrafts((prev) =>
      prev.map((c) => (c.name === pair.sourceCol ? { ...c, isForeignKey: true } : c))
    );

    setIsFkSlideOverOpen(false);
  };

  const fkTableOptions = useMemo(() => {
    const list = tables.map((t) => ({ value: t.name, label: t.name }));
    if (draftFkTable && !list.some((o) => o.value === draftFkTable)) {
      list.unshift({ value: draftFkTable, label: draftFkTable });
    }
    return list;
  }, [tables, draftFkTable]);

  const sourceColumnOptions = useMemo(() => {
    return colDrafts
      .filter((c) => c.name.trim().length > 0)
      .map((c) => ({ value: c.name, label: c.name }));
  }, [colDrafts]);

  const handleSave = async () => {
    if (!hasChanges) return;
    if (!name.trim()) {
      setSaveError('Table name is required');
      return;
    }
    if (colDrafts.length === 0) {
      setSaveError('Table must contain at least one column');
      return;
    }
    if (colDrafts.some((c) => !c.name.trim())) {
      setSaveError('All columns must have a non-empty name');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave({
        newName: name.trim(),
        description: description.trim(),
        columns: colDrafts,
        foreignKeys: fkDrafts,
      });
      onClose();
    } catch (err: any) {
      setSaveError(err?.message || (tableName ? 'Failed to update table' : 'Failed to create table'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <SlideOver
        isOpen={isOpen}
        onClose={handleRequestClose}
        width="w-[660px] max-w-full"
      title={
        <div className="flex items-center gap-2">
          <span className="text-[16px] font-medium text-white tracking-[-0.015em] font-sans">
            {tableName ? 'Update table' : 'Create a new table'}
          </span>
          {tableName && (
            <span className="px-2 py-0.5 rounded-[4px] bg-[#1a1a1a] border border-[#2a2a2a] text-zinc-300 text-[12.5px] font-mono font-normal">
              {tableName}
            </span>
          )}
        </div>
      }
    >
      <div className="flex-1 flex flex-col min-h-0 bg-[#0e0e0e] overflow-hidden font-sans select-none text-[13px]">
        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 font-sans">
          {saveError && (
            <div className="p-3.5 rounded-[6px] bg-[#2a1113] border border-[#5c1d24] text-[#f87171] text-[12.5px] flex items-center gap-2">
              <span>{saveError}</span>
            </div>
          )}

          {/* Table Name */}
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-[#cccccc] font-sans">Name</label>
            <input
              type="text"
              placeholder="e.g. users, orders..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[13.5px] text-white placeholder-[#555555] focus:outline-none focus:border-[#3b82f6] transition-colors font-sans"
            />
          </div>

          {/* Table Description */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-[13px] font-medium text-[#cccccc] font-sans">Description</label>
              <span className="text-[12px] text-[#777777]">Optional</span>
            </div>
            <input
              type="text"
              placeholder="Describe purpose of table..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[13.5px] text-white placeholder-[#555555] focus:outline-none focus:border-[#3b82f6] transition-colors font-sans"
            />
          </div>

          <div className="-mx-5 border-t border-[#222222]" />

          {/* ─── Columns Section ─── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-white font-medium text-[14px] font-sans">Columns</span>
            </div>

            {/* Column Row Headers */}
            <div className="grid grid-cols-[1fr_135px_1fr_60px_36px_36px] gap-2 items-center text-[11px] font-medium text-[#8c8c8c] px-1 font-sans">
              <div className="flex items-center gap-1">
                <span>Name</span>
                <HelpCircle className="w-3 h-3 text-zinc-500" />
              </div>
              <div>Type</div>
              <div className="flex items-center gap-1">
                <span>Default value</span>
                <HelpCircle className="w-3 h-3 text-zinc-500" />
              </div>
              <div className="text-center">Primary</div>
              <div />
              <div />
            </div>

            {/* Columns List */}
            <div className="space-y-2">
              {colDrafts.map((col) => {
                const activeSettingsCount =
                  (col.nullable ? 1 : 0) +
                  (col.unique ? 1 : 0) +
                  (col.isArray ? 1 : 0) +
                  (col.check && col.check.trim() ? 1 : 0);

                return (
                  <div
                    key={col.id}
                    className="grid grid-cols-[1fr_135px_1fr_60px_36px_36px] gap-2 items-center relative"
                  >
                    {/* Name input with optional FK link icon */}
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={col.name}
                        onChange={(e) => handleUpdateColumn(col.id, { name: e.target.value })}
                        placeholder="column_name"
                        className="w-full h-8 pl-2.5 pr-7 rounded-[6px] bg-[#141414] border border-[#242424] focus:border-[#3b82f6] text-white font-mono text-[12px] outline-none transition-colors"
                      />
                      {col.isForeignKey && (
                        <Link2 className="w-3.5 h-3.5 text-blue-400 absolute right-2 pointer-events-none" />
                      )}
                    </div>

                    {/* Type Selector with dropdown toggle */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setActiveTypeDropdownColId(
                            activeTypeDropdownColId === col.id ? null : col.id
                          )
                        }
                        className={`w-full h-8 px-2.5 rounded-[6px] bg-[#141414] border text-left text-[#cccccc] hover:text-white font-sans text-[12.5px] transition-all cursor-pointer flex items-center justify-between ${
                          activeTypeDropdownColId === col.id
                            ? 'border-[#3b82f6] ring-1 ring-[#3b82f6]/20 bg-[#161616]'
                            : 'border-[#242424] hover:border-[#383838]'
                        }`}
                      >
                        <span className="truncate">{col.type}</span>
                        <ChevronDown className={`w-3.5 h-3.5 text-[#777777] shrink-0 ml-1 transition-transform duration-150 ${activeTypeDropdownColId === col.id ? 'rotate-180 text-white' : ''}`} />
                      </button>

                      {/* Dropdown Menu */}
                      {activeTypeDropdownColId === col.id && (
                        <div
                          ref={typeDropdownRef}
                          className="absolute left-0 top-full mt-1.5 w-44 bg-[#121212] border border-[#262626] rounded-[6px] shadow-2xl p-1 z-50 max-h-60 overflow-y-auto font-sans"
                        >
                          {COMMON_SQL_TYPES.map((t) => {
                            const isSelected = col.type === t.value;
                            return (
                              <button
                                key={t.value}
                                type="button"
                                onClick={() => {
                                  handleUpdateColumn(col.id, { type: t.value });
                                  setActiveTypeDropdownColId(null);
                                }}
                                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[4px] text-left text-[12.5px] font-sans transition-colors cursor-pointer ${
                                  isSelected
                                    ? 'bg-[#1e1e1e] text-white font-medium'
                                    : 'text-[#cccccc] hover:text-white hover:bg-[#181818]'
                                }`}
                              >
                                <span className="truncate">{t.value}</span>
                                {isSelected && (
                                  <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Default value input */}
                    <div>
                      <input
                        type="text"
                        value={col.defaultValue}
                        onChange={(e) =>
                          handleUpdateColumn(col.id, { defaultValue: e.target.value })
                        }
                        placeholder="NULL"
                        className="w-full h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#242424] focus:border-[#3b82f6] text-white font-mono text-[12px] outline-none transition-colors"
                      />
                    </div>

                    {/* Primary Key Checkbox - Matching Table Grid Row Selection */}
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateColumn(col.id, { primaryKey: !col.primaryKey })
                        }
                        aria-checked={col.primaryKey ? 'true' : 'false'}
                        className={`peer h-4 w-4 shrink-0 rounded-[4px] border border-[#383838] shadow-xs transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 cursor-pointer flex items-center justify-center ${
                          col.primaryKey
                            ? 'bg-white border-white text-black'
                            : 'bg-transparent hover:border-[#666666] hover:bg-white/[0.04]'
                        }`}
                      >
                        {col.primaryKey && (
                          <Check className="h-3 w-3 stroke-[3]" />
                        )}
                      </button>
                    </div>

                    {/* Column Advanced Settings Button (Cog) with active settings counter */}
                    <div className="relative flex justify-center">
                      <button
                        type="button"
                        onClick={() =>
                          setActiveSettingsColId(
                            activeSettingsColId === col.id ? null : col.id
                          )
                        }
                        title="Advanced column settings"
                        className={`w-7 h-7 rounded-[5px] flex items-center justify-center transition-colors relative cursor-pointer ${
                          activeSettingsColId === col.id
                            ? 'bg-[#202020] text-white'
                            : 'text-[#888888] hover:text-white hover:bg-[#1a1a1a]'
                        }`}
                      >
                        <Settings className="w-3.5 h-3.5" />
                        {activeSettingsCount > 0 && (
                          <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-blue-600 text-[9px] font-bold text-white flex items-center justify-center leading-none">
                            {activeSettingsCount}
                          </span>
                        )}
                      </button>

                      {/* Settings Popover */}
                      {activeSettingsColId === col.id && (
                        <div
                          ref={settingsPopoverRef}
                          className="absolute right-0 top-full mt-1.5 w-60 bg-[#141414] border border-[#262626] rounded-[8px] shadow-2xl p-3 z-50 space-y-3 font-sans"
                        >
                          <div className="text-[12.5px] font-semibold text-white">
                            Settings: {col.name || 'column'}
                          </div>

                          <div
                            onClick={() => handleUpdateColumn(col.id, { nullable: !col.nullable })}
                            className="flex items-center justify-between text-[12.5px] text-[#cccccc] cursor-pointer hover:text-white transition-colors"
                          >
                            <span>Allow Nullable</span>
                            <div
                              className={`h-4 w-4 shrink-0 rounded-[4px] border border-[#383838] shadow-xs transition-all flex items-center justify-center ${
                                col.nullable
                                  ? 'bg-white border-white text-black'
                                  : 'bg-transparent hover:border-[#666666]'
                              }`}
                            >
                              {col.nullable && <Check className="h-3 w-3 stroke-[3]" />}
                            </div>
                          </div>

                          <div
                            onClick={() => handleUpdateColumn(col.id, { unique: !col.unique })}
                            className="flex items-center justify-between text-[12.5px] text-[#cccccc] cursor-pointer hover:text-white transition-colors"
                          >
                            <span>Unique Constraint</span>
                            <div
                              className={`h-4 w-4 shrink-0 rounded-[4px] border border-[#383838] shadow-xs transition-all flex items-center justify-center ${
                                col.unique
                                  ? 'bg-white border-white text-black'
                                  : 'bg-transparent hover:border-[#666666]'
                              }`}
                            >
                              {col.unique && <Check className="h-3 w-3 stroke-[3]" />}
                            </div>
                          </div>

                          <div
                            onClick={() => handleUpdateColumn(col.id, { isArray: !col.isArray })}
                            className="flex items-center justify-between text-[12.5px] text-[#cccccc] cursor-pointer hover:text-white transition-colors"
                          >
                            <span>Define as Array</span>
                            <div
                              className={`h-4 w-4 shrink-0 rounded-[4px] border border-[#383838] shadow-xs transition-all flex items-center justify-center ${
                                col.isArray
                                  ? 'bg-white border-white text-black'
                                  : 'bg-transparent hover:border-[#666666]'
                              }`}
                            >
                              {col.isArray && <Check className="h-3 w-3 stroke-[3]" />}
                            </div>
                          </div>

                          <div className="space-y-1">
                            <span className="text-[11.5px] text-[#8c8c8c]">Check Expression</span>
                            <input
                              type="text"
                              value={col.check}
                              onChange={(e) =>
                                handleUpdateColumn(col.id, { check: e.target.value })
                              }
                              placeholder="e.g. price > 0"
                              className="w-full h-7 px-2 rounded-[4px] bg-[#121212] border border-[#262626] text-white font-mono text-[11px] outline-none"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Delete Column Button (✕) */}
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveColumn(col.id)}
                        title="Delete column"
                        className="w-7 h-7 rounded-[5px] flex items-center justify-center text-[#777777] hover:text-red-400 hover:bg-[#201515] transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Dashed Add Column Button */}
            <button
              type="button"
              onClick={handleAddColumn}
              className="w-full h-9 rounded-[6px] border border-dashed border-[#262626] hover:border-[#3d3d3d] bg-transparent hover:bg-[#141414] text-[#cccccc] hover:text-white flex items-center justify-center gap-1.5 text-[13px] font-medium transition-colors cursor-pointer mt-2 font-sans"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add column</span>
            </button>
          </div>

          <div className="-mx-5 border-t border-[#222222]" />

          {/* ─── Foreign Keys Section ─── */}
          <div className="space-y-3">
            <span className="text-white font-medium text-[14px] font-sans">Foreign keys</span>

            <div className="space-y-2.5">
              {fkDrafts.length === 0 ? (
                <div className="p-4 rounded-[6px] border border-[#222222] bg-[#121212] text-center text-[#777777] text-[12.5px] font-sans">
                  No foreign key relationships configured
                </div>
              ) : (
                fkDrafts.map((fk, idx) => (
                  <div
                    key={`${fk.column}-${fk.referenced_table}-${idx}`}
                    className="p-3.5 rounded-[6px] bg-[#121212] border border-[#222222] space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="font-mono text-[#e4e4e7] text-[12.5px]">
                          {`${tableName || name || 'table'}_${fk.column}_fkey`}
                        </div>
                        <div className="flex items-center gap-1.5 text-[12.5px] text-[#8c8c8c] font-sans">
                          <span>Foreign key relation to:</span>
                          <span className="px-2 py-0.5 rounded-[4px] bg-[#1a1a1a] border border-[#2a2a2a] font-mono text-white text-[11.5px]">
                            {fk.referenced_table}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenFkModalInternal(fk, idx)}
                          className="px-2.5 py-1 rounded-[5px] bg-[#1a1a1a] hover:bg-[#252525] border border-[#2c2c2c] text-[#cccccc] hover:text-white text-[12px] font-medium transition-colors cursor-pointer font-sans"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveFk(fk)}
                          className="px-2.5 py-1 rounded-[5px] bg-[#1a1a1a] hover:bg-[#251515] border border-[#2c2c2c] hover:border-red-900/60 text-[#8c8c8c] hover:text-red-300 text-[12px] font-medium transition-colors cursor-pointer font-sans"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <div className="font-mono text-[12px] text-[#cccccc] flex items-center gap-2 pt-2.5 mt-2.5 -mx-3.5 px-3.5 border-t border-[#1c1c1c]">
                      <span>{fk.column}</span>
                      <span className="text-[#666666]">→</span>
                      <span className="text-white">
                        {fk.referenced_table}.{fk.referenced_column}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Dashed Add Foreign Key Button */}
            <button
              type="button"
              onClick={() => handleOpenFkModalInternal()}
              className="w-full h-9 rounded-[6px] border border-dashed border-[#262626] hover:border-[#3d3d3d] bg-transparent hover:bg-[#141414] text-[#cccccc] hover:text-white flex items-center justify-center gap-1.5 text-[13px] font-medium transition-colors cursor-pointer font-sans"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add foreign key relation</span>
            </button>
          </div>
        </div>

        {/* ─── Sticky Footer matching Axiom Design System ─── */}
        <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans shrink-0">
          <button
            type="button"
            onClick={handleRequestClose}
            className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className={`group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none transition-all font-sans ${
              !hasChanges || isSaving
                ? 'opacity-40 cursor-not-allowed bg-[#222222] ring-1 ring-[#333333]'
                : 'cursor-pointer ring-1 ring-[#1d4ed8] bg-[#2563eb] overflow-hidden'
            }`}
          >
            {hasChanges && (
              <>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
                />
              </>
            )}
            <span className="relative flex items-center gap-2 text-[14px] font-sans">
              <span>{isSaving ? 'Saving...' : 'Save'}</span>
              <span className="text-[11px] opacity-75 font-normal tracking-wide">Ctrl ↵</span>
            </span>
          </button>
        </div>
      </div>
    </SlideOver>

    {/* ─── Discard Changes Warning Dialog ─── */}
    <ConfirmDialog
      isOpen={isDiscardConfirmOpen}
      title="Discard Changes?"
      description="You have unsaved changes in this table. Are you sure you want to discard them?"
      confirmLabel="Discard"
      cancelLabel="Keep Editing"
      variant="warning"
      onConfirm={() => {
        setIsDiscardConfirmOpen(false);
        onClose();
      }}
      onClose={() => setIsDiscardConfirmOpen(false)}
    />

    {/* ─── Delete Column Confirm Dialog ─── */}
    <ConfirmDialog
      isOpen={!!deleteColTarget}
      title={`Delete column "${deleteColTarget?.name || 'column'}"?`}
      description={
        tableName
          ? `Are you sure you want to remove column "${deleteColTarget?.name || 'this column'}" from table "${tableName}"? This column will be dropped from the database when you save.`
          : `Are you sure you want to remove column "${deleteColTarget?.name || 'this column'}"?`
      }
      confirmLabel="Delete Column"
      cancelLabel="Cancel"
      variant="danger"
      onConfirm={confirmDeleteColumn}
      onClose={() => setDeleteColTarget(null)}
    />

    {/* ─── Remove Foreign Key Confirm Dialog ─── */}
    <ConfirmDialog
      isOpen={!!deleteFkTarget}
      title={`Remove foreign key relation?`}
      description={`Are you sure you want to remove the foreign key reference from "${deleteFkTarget?.column}" to "${deleteFkTarget?.referenced_table}.${deleteFkTarget?.referenced_column}"?`}
      confirmLabel="Remove Relation"
      cancelLabel="Cancel"
      variant="danger"
      onConfirm={confirmRemoveFk}
      onClose={() => setDeleteFkTarget(null)}
    />

    {/* ─── Foreign Key Relationship SlideOver Panel ─── */}
    <SlideOver
      isOpen={isFkSlideOverOpen}
      onClose={handleRequestCloseFkModal}
      width="w-[520px] max-w-full"
      zIndex="z-[60]"
      title={editingFkIndex !== null ? `Edit foreign key relationship in ${tableName || name || 'table'}` : `Add foreign key relationship to ${tableName || name || 'table'}`}
    >
      <div className="flex-1 flex flex-col min-h-0 bg-[#0e0e0e] overflow-hidden font-sans">
        <div className="flex-1 overflow-y-auto p-5 space-y-4 font-sans">
          <div>
            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5 font-sans">
              Select a table to reference to
            </label>
            <CustomSelect
              value={draftFkTable}
              onChange={handleSelectFkTargetTable}
              placeholder="Select a table to reference to"
              options={fkTableOptions}
              menuWidth="w-full"
            />
          </div>

          {draftFkTable && (
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-2 font-sans">
                Select columns from{' '}
                <span className="px-1.5 py-0.5 rounded bg-[#181818] border border-[#262626] font-mono text-white text-[12px]">
                  {draftFkTable}
                </span>{' '}
                to reference to
              </label>

              <div className="flex items-center gap-2 mb-1.5 px-0.5 text-[11.5px] text-[#888888] font-mono">
                <div className="flex-1 truncate">{tableName || name || 'Current table'}</div>
                <div className="w-5 shrink-0" />
                <div className="flex-1 truncate">{draftFkTable}</div>
                {draftFkPairs.length > 1 && <div className="w-8 shrink-0" />}
              </div>

              <div className="space-y-2">
                {draftFkPairs.map((pair, idx) => {
                  const targetCols = schemaCache[draftFkTable]?.columns || [];
                  const targetOptions = targetCols.map((c) => ({
                    value: c.name,
                    label: c.name,
                  }));
                  const effectiveTargetOptions =
                    targetOptions.length > 0
                      ? targetOptions
                      : pair.targetCol
                      ? [{ value: pair.targetCol, label: pair.targetCol }]
                      : [{ value: 'id', label: 'id' }];

                  const effectiveSourceVal = pair.sourceCol || sourceColumnOptions[0]?.value || '';
                  const effectiveTargetVal = pair.targetCol || effectiveTargetOptions[0]?.value || 'id';

                  return (
                    <div key={idx} className="flex items-center gap-2">
                      <div className="flex-1">
                        <CustomSelect
                          value={effectiveSourceVal}
                          onChange={(val) => {
                            setDraftFkPairs((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], sourceCol: val };
                              return next;
                            });
                          }}
                          options={sourceColumnOptions}
                          menuWidth="w-full"
                        />
                      </div>

                      <div className="text-[#666666] shrink-0">
                        <ArrowRight className="w-4 h-4" />
                      </div>

                      <div className="flex-1">
                        <CustomSelect
                          value={effectiveTargetVal}
                          onChange={(val) => {
                            setDraftFkPairs((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], targetCol: val };
                              return next;
                            });
                          }}
                          options={effectiveTargetOptions}
                          menuWidth="w-full"
                        />
                      </div>

                      {draftFkPairs.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setDraftFkPairs((prev) => prev.filter((_, i) => i !== idx));
                          }}
                          className="w-8 h-8 rounded-[6px] border border-[#262626] bg-[#141414] hover:bg-[#1f1f1f] text-[#777777] hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
                          title="Remove mapping"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  setDraftFkPairs((prev) => [...prev, { sourceCol: '', targetCol: '' }]);
                }}
                className="mt-2.5 h-8 px-3 rounded-[6px] text-[12px] font-medium border border-[#262626] bg-[#141414] text-[#cccccc] hover:text-white hover:border-[#383838] transition-colors inline-flex items-center gap-1.5 cursor-pointer font-sans"
              >
                <span>Add another column</span>
              </button>
            </div>
          )}

          {draftFkTable && <div className="-mx-5 border-t border-[#1e1e1e] my-4" />}

          {/* Action on update */}
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-[#cccccc] font-sans">
              Action if referenced row is updated
            </label>
            <CustomSelect
              value={draftFkOnUpdate}
              onChange={(v) => setDraftFkOnUpdate(v as typeof draftFkOnUpdate)}
              options={[
                { value: 'NO ACTION', label: 'No action' },
                { value: 'CASCADE', label: 'Cascade' },
                { value: 'RESTRICT', label: 'Restrict' },
                { value: 'SET NULL', label: 'Set null' },
                { value: 'SET DEFAULT', label: 'Set default' },
              ]}
              menuWidth="w-full"
            />
            <p className="text-[12px] text-[#8c8c8c] leading-relaxed">
              <span className="text-white font-medium">
                {draftFkOnUpdate === 'NO ACTION' ? 'No action: ' : `${draftFkOnUpdate === 'CASCADE' ? 'Cascade' : draftFkOnUpdate === 'RESTRICT' ? 'Restrict' : draftFkOnUpdate === 'SET NULL' ? 'Set null' : 'Set default'}: `}
              </span>
              Updating a record from{' '}
              <span className="px-1.5 py-0.5 rounded bg-[#181818] border border-[#262626] font-mono text-white text-[11px]">
                {draftFkTable || 'referenced table'}
              </span>{' '}
              {draftFkOnUpdate === 'NO ACTION' && (
                <>will <span className="text-amber-400 font-medium">raise an error</span> if there are records existing in this table that reference it</>
              )}
              {draftFkOnUpdate === 'CASCADE' && (
                <>will <span className="text-blue-400 font-medium">cascade and update</span> matching foreign key records in this table</>
              )}
              {draftFkOnUpdate === 'RESTRICT' && (
                <>will <span className="text-amber-400 font-medium">raise an error</span> immediately preventing the update</>
              )}
              {draftFkOnUpdate === 'SET NULL' && (
                <>will <span className="text-amber-400 font-medium">set this column to NULL</span> for matching records in this table</>
              )}
              {draftFkOnUpdate === 'SET DEFAULT' && (
                <>will <span className="text-blue-400 font-medium">set this column to its default value</span> for matching records</>
              )}
            </p>
          </div>

          {/* Action on delete */}
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-[#cccccc] font-sans">
              Action if referenced row is removed
            </label>
            <CustomSelect
              value={draftFkOnDelete}
              onChange={(v) => setDraftFkOnDelete(v as typeof draftFkOnDelete)}
              options={[
                { value: 'NO ACTION', label: 'No action' },
                { value: 'CASCADE', label: 'Cascade' },
                { value: 'RESTRICT', label: 'Restrict' },
                { value: 'SET NULL', label: 'Set null' },
                { value: 'SET DEFAULT', label: 'Set default' },
              ]}
              menuWidth="w-full"
            />
            <p className="text-[12px] text-[#8c8c8c] leading-relaxed">
              <span className="text-white font-medium">
                {draftFkOnDelete === 'NO ACTION' ? 'No action: ' : `${draftFkOnDelete === 'CASCADE' ? 'Cascade' : draftFkOnDelete === 'RESTRICT' ? 'Restrict' : draftFkOnDelete === 'SET NULL' ? 'Set null' : 'Set default'}: `}
              </span>
              Deleting a record from{' '}
              <span className="px-1.5 py-0.5 rounded bg-[#181818] border border-[#262626] font-mono text-white text-[11px]">
                {draftFkTable || 'referenced table'}
              </span>{' '}
              {draftFkOnDelete === 'NO ACTION' && (
                <>will <span className="text-amber-400 font-medium">raise an error</span> if there are records existing in this table that reference it</>
              )}
              {draftFkOnDelete === 'CASCADE' && (
                <>will <span className="text-amber-400 font-medium">cascade and delete</span> matching records in this table</>
              )}
              {draftFkOnDelete === 'RESTRICT' && (
                <>will <span className="text-amber-400 font-medium">raise an error</span> immediately preventing deletion of the parent</>
              )}
              {draftFkOnDelete === 'SET NULL' && (
                <>will <span className="text-amber-400 font-medium">set this column to NULL</span> for matching records in this table</>
              )}
              {draftFkOnDelete === 'SET DEFAULT' && (
                <>will <span className="text-blue-400 font-medium">set this column to its default value</span> for matching records</>
              )}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans shrink-0">
          <button
            type="button"
            onClick={handleRequestCloseFkModal}
            className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isFkSaveDisabled}
            onClick={handleSaveFk}
            className={`group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none transition-all font-sans ${
              isFkSaveDisabled
                ? 'opacity-40 cursor-not-allowed bg-[#222222] ring-1 ring-[#333333]'
                : 'cursor-pointer ring-1 ring-[#1d4ed8] bg-[#2563eb] overflow-hidden'
            }`}
          >
            {!isFkSaveDisabled && (
              <>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
                />
              </>
            )}
            <span className="relative flex items-center gap-1.5 text-[14px] font-sans">
              {editingFkIndex !== null ? 'Update relationship' : 'Save relationship'}
            </span>
          </button>
        </div>
      </div>
    </SlideOver>

    {/* Discard FK Changes Confirm Dialog */}
    <ConfirmDialog
      isOpen={isDiscardFkConfirmOpen}
      title="Discard Foreign Key Changes?"
      description="You have unsaved changes in this foreign key configuration. If you discard, these changes will not be saved."
      confirmLabel="Discard"
      cancelLabel="Keep Editing"
      variant="warning"
      onConfirm={() => {
        setIsDiscardFkConfirmOpen(false);
        setIsFkSlideOverOpen(false);
      }}
      onClose={() => setIsDiscardFkConfirmOpen(false)}
    />
    </>
  );
}
