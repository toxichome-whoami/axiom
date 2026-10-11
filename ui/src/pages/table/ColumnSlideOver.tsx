/*
 * Column SlideOver drawer and Foreign Key configuration panel.
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../types, ../../components/ui/SlideOver, ../../components/ui/Switch, ../../components/shared/CustomSelect, ../../components/ui/ConfirmDialog
 * Invariants: Strict dirty-checking on submit buttons; edge-to-edge section dividers; confirmation dialogs on unsaved FK changes.
 */

import React from 'react';
import {
  AlertCircle,
  Plus,
  Link2,
  RefreshCw,
  ArrowRight,
  X,
} from 'lucide-react';
import { ColumnInfoApi, TableInfoApi } from '../../types';
import { SlideOver } from '../../components/ui/SlideOver';
import { Switch } from '../../components/ui/Switch';
import { CustomSelect } from '../../components/shared/CustomSelect';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

export interface ColumnSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  editingColumn: ColumnInfoApi | null;
  selectedTable: string;
  tables: TableInfoApi[];
  schemaCache: Record<string, { columns: ColumnInfoApi[] }>;
  createColumnError: string | null;

  // Field values
  newColName: string;
  setNewColName: (val: string) => void;
  newColType: string;
  setNewColType: (val: string) => void;
  newColIsArray: boolean;
  setNewColIsArray: (val: boolean) => void;
  newColDescription: string;
  setNewColDescription: (val: string) => void;
  newColDefault: string;
  setNewColDefault: (val: string) => void;
  newColNullable: boolean;
  setNewColNullable: (val: boolean) => void;
  newColIsUnique: boolean;
  setNewColIsUnique: (val: boolean) => void;
  newColIsPk: boolean;
  setNewColIsPk: (val: boolean) => void;
  newColCheck: string;
  setNewColCheck: (val: string) => void;

  // FK state on column
  newColFkSchema: string;
  setNewColFkSchema: (val: string) => void;
  newColFkTable: string;
  setNewColFkTable: (val: string) => void;
  newColFkColumn: string;
  setNewColFkColumn: (val: string) => void;
  newColFkOnUpdate: 'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT';
  setNewColFkOnUpdate: (val: 'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT') => void;
  newColFkOnDelete: 'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT';
  setNewColFkOnDelete: (val: 'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT') => void;

  // FK nested modal state
  isFkModalOpen: boolean;
  setIsFkModalOpen: (val: boolean) => void;
  draftFkSchema: string;
  setDraftFkSchema: (val: string) => void;
  draftFkTable: string;
  setDraftFkTable: (val: string) => void;
  draftFkColumn: string;
  setDraftFkColumn: (val: string) => void;
  draftFkPairs: Array<{ sourceCol: string; targetCol: string }>;
  setDraftFkPairs: React.Dispatch<React.SetStateAction<Array<{ sourceCol: string; targetCol: string }>>>;
  draftFkOnUpdate: 'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT';
  setDraftFkOnUpdate: (val: 'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT') => void;
  draftFkOnDelete: 'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT';
  setDraftFkOnDelete: (val: 'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT') => void;
  isDiscardFkConfirmOpen: boolean;
  setIsDiscardFkConfirmOpen: (val: boolean) => void;
  handleRequestCloseFkModal: () => void;
  handleSelectFkTargetTable: (tableName: string, overrideTargetCol?: string) => void;

  isCreatingColumn: boolean;
  hasColumnChanges: boolean;
  handleSaveColumn: () => void;
}

export function ColumnSlideOver({
  isOpen,
  onClose,
  editingColumn,
  selectedTable,
  tables,
  schemaCache,
  createColumnError,
  newColName,
  setNewColName,
  newColType,
  setNewColType,
  newColIsArray,
  setNewColIsArray,
  newColDescription,
  setNewColDescription,
  newColDefault,
  setNewColDefault,
  newColNullable,
  setNewColNullable,
  newColIsUnique,
  setNewColIsUnique,
  newColIsPk,
  setNewColIsPk,
  newColCheck,
  setNewColCheck,
  newColFkSchema,
  setNewColFkSchema,
  newColFkTable,
  setNewColFkTable,
  newColFkColumn,
  setNewColFkColumn,
  newColFkOnUpdate,
  setNewColFkOnUpdate,
  newColFkOnDelete,
  setNewColFkOnDelete,
  isFkModalOpen,
  setIsFkModalOpen,
  draftFkSchema,
  setDraftFkSchema,
  draftFkTable,
  setDraftFkTable,
  draftFkColumn,
  setDraftFkColumn,
  draftFkPairs,
  setDraftFkPairs,
  draftFkOnUpdate,
  setDraftFkOnUpdate,
  draftFkOnDelete,
  setDraftFkOnDelete,
  isDiscardFkConfirmOpen,
  setIsDiscardFkConfirmOpen,
  handleRequestCloseFkModal,
  handleSelectFkTargetTable,
  isCreatingColumn,
  hasColumnChanges,
  handleSaveColumn,
}: ColumnSlideOverProps) {
  return (
    <>
      <SlideOver
        isOpen={isOpen}
        onClose={onClose}
        width="w-[520px] max-w-full"
        title={editingColumn ? `Update Column "${editingColumn.name}"` : 'Add Column'}
        subtitle={editingColumn ? `Modify schema for column ${editingColumn.name} in ${selectedTable}` : `Add a new column to ${selectedTable}`}
      >
        <div className="flex-1 flex flex-col min-h-0 bg-[#0e0e0e] overflow-hidden font-sans">
          <div className="flex-1 overflow-y-auto p-5 space-y-5 font-sans">
            {createColumnError && (
              <div className="p-3.5 rounded-[8px] bg-[#2a1113] border border-[#5c1d24] text-[#f87171] text-[13px] flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-[#ef4444] mt-0.5" />
                <div className="flex-1 font-mono text-[12px]">{createColumnError}</div>
              </div>
            )}

            {/* Section 1: Column Definition */}
            <div className="space-y-4">
              <div>
                <h3 className="text-[16px] font-medium text-white tracking-tight">Column Definition</h3>
                <p className="text-[13px] text-[#8c8c8c] mt-0.5">Specify column name, description, and target data type.</p>
              </div>

              <div className="space-y-3.5">
                <div>
                  <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5 font-sans">
                    Column Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={newColName}
                    onChange={(e) => setNewColName(e.target.value)}
                    placeholder="e.g. status, bio, order_total"
                    className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] transition-colors placeholder-[#555555]"
                  />
                  <p className="text-[12px] text-[#8c8c8c] mt-1 font-sans">
                    Recommended to use lowercase with underscores.
                  </p>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5 font-sans">
                    Data Type <span className="text-red-400">*</span>
                  </label>
                  <CustomSelect
                    value={newColType}
                    onChange={setNewColType}
                    options={[
                      { value: 'text', label: 'text (Unlimited character string)' },
                      { value: 'varchar(255)', label: 'varchar (Variable length string)' },
                      { value: 'integer', label: 'int4 / integer (Signed 4-byte integer)' },
                      { value: 'bigint', label: 'int8 / bigint (Signed 8-byte integer)' },
                      { value: 'smallint', label: 'int2 / smallint (Signed 2-byte integer)' },
                      { value: 'boolean', label: 'bool / boolean (Logical true/false)' },
                      { value: 'timestamp with time zone', label: 'timestamptz (Date and time with timezone)' },
                      { value: 'timestamp without time zone', label: 'timestamp (Date and time without timezone)' },
                      { value: 'date', label: 'date (Calendar date)' },
                      { value: 'time', label: 'time (Time of day)' },
                      { value: 'numeric', label: 'numeric / decimal (Exact numeric, monetary)' },
                      { value: 'double precision', label: 'float8 / double precision (Floating point)' },
                      { value: 'real', label: 'float4 / real (Single precision float)' },
                      { value: 'jsonb', label: 'jsonb (Binary formatted JSON)' },
                      { value: 'json', label: 'json (Text JSON data)' },
                      { value: 'uuid', label: 'uuid (Universally unique identifier)' },
                      { value: 'bytea', label: 'bytea (Binary data)' },
                    ]}
                    menuWidth="w-full"
                  />
                </div>

                <div className="flex items-center justify-between py-1">
                  <div>
                    <span className="text-[13px] text-[#cccccc] font-medium block">Define as array</span>
                    <span className="text-[12px] text-[#777777] block">Stores a variable-length list (e.g. text[])</span>
                  </div>
                  <Switch
                    checked={newColIsArray}
                    onCheckedChange={setNewColIsArray}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[13px] font-medium text-[#cccccc] font-sans">
                      Description / Comment
                    </label>
                    <span className="text-[12px] text-[#777777]">Optional</span>
                  </div>
                  <input
                    type="text"
                    value={newColDescription}
                    onChange={(e) => setNewColDescription(e.target.value)}
                    placeholder="Describe purpose of column..."
                    className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] transition-colors placeholder-[#555555]"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Default Value & Constraints */}
            <div className="space-y-4 pt-2">
              <div>
                <h3 className="text-[16px] font-medium text-white tracking-tight">Constraints & Defaults</h3>
                <p className="text-[13px] text-[#8c8c8c] mt-0.5">Configure nullability, uniqueness, default values, and foreign keys.</p>
              </div>

              <div className="space-y-3.5">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[13px] font-medium text-[#cccccc] font-sans">
                      Default Value
                    </label>
                    <span className="text-[12px] text-[#777777]">Optional</span>
                  </div>
                  <input
                    type="text"
                    value={newColDefault}
                    onChange={(e) => setNewColDefault(e.target.value)}
                    placeholder="NULL or 'active' or 0"
                    className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white font-mono focus:outline-none focus:border-[#3b82f6] transition-colors placeholder-[#555555]"
                  />
                </div>

                {/* Constraint Toggles */}
                <div className="rounded-[8px] border border-[#222222] bg-[#121212] p-3.5 space-y-3.5">
                  {/* Allow Nullable */}
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[13px] font-medium text-white block">Allow Nullable (NULL)</span>
                      <span className="text-[12px] text-[#777777] block">Allow rows without a value for this column</span>
                    </div>
                    <Switch
                      checked={newColNullable}
                      disabled={newColIsPk}
                      onCheckedChange={setNewColNullable}
                    />
                  </div>

                  <div className="border-t border-[#1e1e1e]" />

                  {/* Is Unique */}
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[13px] font-medium text-white block">Unique Constraint</span>
                      <span className="text-[12px] text-[#777777] block">Enforce column values to be unique across all rows</span>
                    </div>
                    <Switch
                      checked={newColIsUnique}
                      onCheckedChange={setNewColIsUnique}
                    />
                  </div>

                  <div className="border-t border-[#1e1e1e]" />

                  {/* Is Primary Key */}
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[13px] font-medium text-white block">Primary Key</span>
                      <span className="text-[12px] text-[#777777] block">Mark as unique row identifier</span>
                    </div>
                    <Switch
                      checked={newColIsPk}
                      onCheckedChange={(checked) => {
                        setNewColIsPk(checked);
                        if (checked) setNewColNullable(false);
                      }}
                    />
                  </div>
                </div>

                {/* Foreign Key Relation Selector */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[13px] font-medium text-[#cccccc] font-sans">
                      Foreign Key Relation
                    </label>
                    <span className="text-[12px] text-[#777777]">Optional</span>
                  </div>

                  {newColFkTable ? (
                    <div className="p-3 rounded-[6px] bg-[#141414] border border-[#262626] flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[13px] text-[#cccccc]">
                        <Link2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span>References</span>
                        <span className="font-mono text-white font-medium">{newColFkTable}.{newColFkColumn || 'id'}</span>
                        {(newColFkOnDelete !== 'NO ACTION' || newColFkOnUpdate !== 'NO ACTION') && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#1c1c1c] text-[#888888] font-mono">
                            {newColFkOnDelete !== 'NO ACTION' ? `DEL: ${newColFkOnDelete}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setDraftFkSchema(newColFkSchema);
                            setDraftFkTable(newColFkTable);
                            setDraftFkColumn(newColFkColumn);
                            setDraftFkPairs([{
                              sourceCol: newColName || '',
                              targetCol: newColFkColumn || 'id',
                            }]);
                            setDraftFkOnUpdate(newColFkOnUpdate);
                            setDraftFkOnDelete(newColFkOnDelete);
                            if (newColFkTable) {
                              handleSelectFkTargetTable(newColFkTable, newColFkColumn);
                            }
                            setIsFkModalOpen(true);
                          }}
                          className="text-[12px] text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
                        >
                          Edit
                        </button>
                        <span className="text-[#333333]">·</span>
                        <button
                          type="button"
                          onClick={() => {
                            setNewColFkTable('');
                            setNewColFkColumn('');
                            setNewColFkOnUpdate('NO ACTION');
                            setNewColFkOnDelete('NO ACTION');
                          }}
                          className="text-[12px] text-red-400 hover:text-red-300 cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftFkSchema('');
                        setDraftFkTable('');
                        setDraftFkColumn('');
                        setDraftFkPairs([{
                          sourceCol: newColName || '',
                          targetCol: '',
                        }]);
                        setDraftFkOnUpdate('NO ACTION');
                        setDraftFkOnDelete('NO ACTION');
                        setIsFkModalOpen(true);
                      }}
                      className="h-8 px-3 rounded-[6px] text-[13px] font-medium border border-[#262626] bg-[#141414] text-[#cccccc] hover:text-white hover:border-[#383838] transition-colors inline-flex items-center gap-1.5 cursor-pointer font-sans"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add foreign key</span>
                    </button>
                  )}
                </div>

                {/* Optional Check constraint */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[13px] font-medium text-[#cccccc] font-sans">
                      CHECK Expression
                    </label>
                    <span className="text-[12px] text-[#777777]">Optional</span>
                  </div>
                  <input
                    type="text"
                    value={newColCheck}
                    onChange={(e) => setNewColCheck(e.target.value)}
                    placeholder="e.g. length(column_name) < 500"
                    className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white font-mono focus:outline-none focus:border-[#3b82f6] transition-colors placeholder-[#555555]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isCreatingColumn || !newColName.trim() || !hasColumnChanges}
              onClick={handleSaveColumn}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans"
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
                {isCreatingColumn ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>{editingColumn ? 'Updating Column...' : 'Adding Column...'}</span>
                  </>
                ) : (
                  <span>{editingColumn ? 'Update Column' : 'Add Column'}</span>
                )}
              </span>
            </button>
          </div>
        </div>
      </SlideOver>

      {/* ─── Foreign Key Relationship SlideOver Panel ─── */}
      <SlideOver
        isOpen={isFkModalOpen}
        onClose={handleRequestCloseFkModal}
        width="w-[520px] max-w-full"
        zIndex="z-[60]"
        title={newColFkTable ? `Edit foreign key relationship in ${selectedTable}` : `Add foreign key relationship to ${selectedTable}`}
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
                options={(() => {
                  const opts = tables.map((t) => ({
                    value: t.name,
                    label: t.name,
                  }));
                  if (draftFkTable && !opts.some((o) => o.value === draftFkTable)) {
                    opts.unshift({ value: draftFkTable, label: draftFkTable });
                  }
                  return opts;
                })()}
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
                  <div className="flex-1 truncate">
                    {selectedTable}
                  </div>
                  <div className="w-5 shrink-0" />
                  <div className="flex-1 truncate">
                    {draftFkTable}
                  </div>
                  {draftFkPairs.length > 1 && <div className="w-8 shrink-0" />}
                </div>

                <div className="space-y-2">
                  {draftFkPairs.map((pair, idx) => {
                    const currentCols = schemaCache[selectedTable]?.columns || [];
                    const sourceOptions: Array<{ value: string; label: string }> = [];
                    if (newColName && newColName.trim()) {
                      sourceOptions.push({ value: newColName.trim(), label: newColName.trim() });
                    }
                    currentCols.forEach((c) => {
                      if (c.name !== newColName?.trim()) {
                        sourceOptions.push({ value: c.name, label: c.name });
                      }
                    });
                    if (sourceOptions.length === 0) {
                      sourceOptions.push({ value: pair.sourceCol || 'column', label: pair.sourceCol || 'column' });
                    }

                    const targetCols = schemaCache[draftFkTable]?.columns || [];
                    const targetOptions = targetCols.length > 0
                      ? targetCols.map((c) => ({ value: c.name, label: c.name }))
                      : (pair.targetCol || draftFkColumn
                          ? [{ value: pair.targetCol || draftFkColumn, label: pair.targetCol || draftFkColumn }]
                          : [{ value: 'id', label: 'id' }]);

                    return (
                      <div key={idx} className="flex items-center gap-2">
                        <div className="flex-1">
                          <CustomSelect
                            value={pair.sourceCol || (newColName ? newColName.trim() : (sourceOptions[0]?.value || ''))}
                            onChange={(val) => {
                              setDraftFkPairs((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], sourceCol: val };
                                return next;
                              });
                            }}
                            options={sourceOptions}
                            menuWidth="w-full"
                          />
                        </div>

                        <div className="text-[#666666] shrink-0">
                          <ArrowRight className="w-4 h-4" />
                        </div>

                        <div className="flex-1">
                          <CustomSelect
                            value={pair.targetCol || draftFkColumn || 'id'}
                            onChange={(val) => {
                              if (idx === 0) setDraftFkColumn(val);
                              setDraftFkPairs((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], targetCol: val };
                                return next;
                              });
                            }}
                            options={targetOptions}
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
            {(() => {
              const finalTargetCol = draftFkPairs[0]?.targetCol || draftFkColumn || 'id';
              const isTargetEmpty = !draftFkTable || (!draftFkColumn && !draftFkPairs[0]?.targetCol);
              const hasFkChanged =
                draftFkSchema !== newColFkSchema ||
                draftFkTable !== newColFkTable ||
                finalTargetCol !== newColFkColumn ||
                draftFkOnUpdate !== newColFkOnUpdate ||
                draftFkOnDelete !== newColFkOnDelete;

              const isSaveDisabled = isTargetEmpty || !hasFkChanged;

              return (
                <button
                  type="button"
                  disabled={isSaveDisabled}
                  onClick={() => {
                    setNewColFkSchema(draftFkSchema);
                    setNewColFkTable(draftFkTable);
                    setNewColFkColumn(finalTargetCol);
                    setNewColFkOnUpdate(draftFkOnUpdate);
                    setNewColFkOnDelete(draftFkOnDelete);
                    setIsFkModalOpen(false);
                  }}
                  className={`group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none transition-all font-sans ${
                    isSaveDisabled
                      ? 'opacity-40 cursor-not-allowed bg-[#222222] ring-1 ring-[#333333]'
                      : 'cursor-pointer ring-1 ring-[#1d4ed8] bg-[#2563eb] overflow-hidden'
                  }`}
                >
                  {!isSaveDisabled && (
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
                    {newColFkTable ? 'Update relationship' : 'Save relationship'}
                  </span>
                </button>
              );
            })()}
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
          setIsFkModalOpen(false);
        }}
        onClose={() => setIsDiscardFkConfirmOpen(false)}
      />
    </>
  );
}
