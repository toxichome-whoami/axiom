/*
 * RBAC Permission Table component for configuring database, table, and CRUD rules.
 * Owned by: ui/components/shared
 * Key deps: lucide-react (Plus, Trash2, Database, Table)
 * Invariants: Operations follow standard Axiom RBAC verbs: SELECT, INSERT, UPDATE, DELETE.
 */

import React from 'react';
import { Plus, Trash2, Database, Table as TableIcon, AlertCircle } from 'lucide-react';

export interface DbPermissionRule {
  database: string;
  table: string;
  operations: ('SELECT' | 'INSERT' | 'UPDATE' | 'DELETE')[];
}

export interface PermissionTableProps {
  value: DbPermissionRule[];
  onChange?: (rules: DbPermissionRule[]) => void;
  readOnly?: boolean;
}

export type AxiomPermissions = DbPermissionRule[];

const ALL_OPS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;

export function PermissionTable({ value, onChange, readOnly = false }: PermissionTableProps) {
  function setRule(idx: number, patch: Partial<DbPermissionRule>) {
    if (!onChange) return;
    onChange(value.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function toggleOp(idx: number, op: typeof ALL_OPS[number]) {
    const rule = value[idx];
    const has = rule.operations.includes(op);
    setRule(idx, {
      operations: has ? rule.operations.filter((o) => o !== op) : [...rule.operations, op],
    });
  }

  function addRule() {
    if (!onChange) return;
    onChange([...value, { database: '*', table: '*', operations: ['SELECT'] }]);
  }

  function removeRule(idx: number) {
    if (!onChange) return;
    onChange(value.filter((_, i) => i !== idx));
  }

  function splitRule(idx: number) {
    if (!onChange) return;
    const rule = value[idx];
    const dbs = rule.database.split(',').map((s) => s.trim()).filter(Boolean);
    const tbls = rule.table.split(',').map((s) => s.trim()).filter(Boolean);
    const dbList = dbs.length > 0 ? dbs : ['*'];
    const tblList = tbls.length > 0 ? tbls : ['*'];

    const newRules: DbPermissionRule[] = [];
    for (const d of dbList) {
      for (const t of tblList) {
        newRules.push({
          database: d,
          table: t,
          operations: [...rule.operations],
        });
      }
    }

    const next = [...value];
    next.splice(idx, 1, ...newRules);
    onChange(next);
  }

  if (value.length === 0) {
    return (
      <div className="space-y-3 font-sans">
        <div className="rounded-[8px] border border-dashed border-[#262626] bg-[#0c0c0c] p-4 text-center text-[13px] text-[#666666]">
          No permission rules configured. Grant database access using the button below.
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={addRule}
            className="flex items-center gap-1.5 h-9 px-4 text-[13px] font-medium text-[#cccccc] hover:text-white border border-dashed border-[#262626] hover:border-[#383838] bg-[#0c0c0c] hover:bg-[#141414] rounded-[8px] transition-colors cursor-pointer w-full justify-center"
          >
            <Plus className="w-3.5 h-3.5" />
            Add rule
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 font-sans">
      {value.map((rule, idx) => {
        const dbHasComma = rule.database.includes(',');
        const tableHasComma = rule.table.includes(',');
        const hasCommaError = dbHasComma || tableHasComma;

        return (
          <div
            key={idx}
            className={`rounded-[8px] border bg-[#121212] p-4 space-y-3.5 transition-colors ${
              hasCommaError ? 'border-[#e5484d]/40' : 'border-[#262626]'
            }`}
          >
            {/* Card Top: Rule Header & Action */}
            <div className="flex items-center justify-between pb-0.5">
              <span className="text-[13px] font-medium text-[#8c8c8c] font-sans">
                Rule {idx + 1}
              </span>

              {!readOnly && (
                <button
                  type="button"
                  onClick={() => removeRule(idx)}
                  className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#777777] hover:text-[#e5484d] hover:bg-[#2a0e0e] border border-transparent hover:border-[#4a1919] transition-colors cursor-pointer"
                  title="Remove access rule"
                  aria-label={`Remove rule ${idx + 1}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Card Middle: Inputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
              <div>
                <label className="flex items-center gap-1.5 text-[13px] font-medium text-[#cccccc] mb-1.5">
                  <Database className="w-3.5 h-3.5 text-[#8c8c8c]" />
                  <span>Database</span>
                </label>
                {readOnly ? (
                  <div className="h-9 rounded-[6px] border border-[#262626] bg-[#0c0c0c] px-3 flex items-center text-[13px] text-white">
                    {rule.database}
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={rule.database}
                      onChange={(e) => setRule(idx, { database: e.target.value })}
                      placeholder="* (all) or database_alias"
                      className={`h-9 w-full rounded-[6px] border bg-[#0c0c0c] px-3 text-[13px] placeholder-[#555555] focus:outline-none transition-colors ${
                        dbHasComma
                          ? 'border-[#e5484d] text-[#e5484d] focus:border-[#e5484d]'
                          : 'border-[#262626] text-white focus:border-[#2f80ed] hover:border-[#383838]'
                      }`}
                    />
                    {dbHasComma && (
                      <div className="mt-1 flex items-center justify-between text-[12px] text-[#e5484d] font-sans">
                        <span className="flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          Multiple databases not supported
                        </span>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => splitRule(idx)}
                            className="text-[11px] font-medium text-[#3b82f6] hover:underline cursor-pointer ml-1 shrink-0"
                            title="Split into separate rules"
                          >
                            Split into rules
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[13px] font-medium text-[#cccccc] mb-1.5">
                  <TableIcon className="w-3.5 h-3.5 text-[#8c8c8c]" />
                  <span>Table</span>
                </label>
                {readOnly ? (
                  <div className="h-9 rounded-[6px] border border-[#262626] bg-[#0c0c0c] px-3 flex items-center text-[13px] text-white">
                    {rule.table}
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={rule.table}
                      onChange={(e) => setRule(idx, { table: e.target.value })}
                      placeholder="* (all) or table_name"
                      className={`h-9 w-full rounded-[6px] border bg-[#0c0c0c] px-3 text-[13px] placeholder-[#555555] focus:outline-none transition-colors ${
                        tableHasComma
                          ? 'border-[#e5484d] text-[#e5484d] focus:border-[#e5484d]'
                          : 'border-[#262626] text-white focus:border-[#2f80ed] hover:border-[#383838]'
                      }`}
                    />
                    {tableHasComma && (
                      <div className="mt-1 flex items-center justify-between text-[12px] text-[#e5484d] font-sans">
                        <span className="flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          Multiple tables not supported
                        </span>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => splitRule(idx)}
                            className="text-[11px] font-medium text-[#3b82f6] hover:underline cursor-pointer ml-1 shrink-0"
                            title="Split into separate rules"
                          >
                            Split into rules
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Edge-to-edge separator */}
            <div className="-mx-4 border-t border-[#222222]" />

            {/* Card Bottom: Allowed Operations Toggles */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-0.5">
              <span className="text-[12px] font-medium text-[#8c8c8c]">
                Allowed Operations
              </span>

            {/* Segmented Pill Switcher without dot */}
            <div className="flex flex-wrap items-center gap-1.5">
              {ALL_OPS.map((op) => {
                const active = rule.operations.includes(op);
                return (
                  <button
                    key={op}
                    type="button"
                    disabled={readOnly}
                    onClick={() => !readOnly && toggleOp(idx, op)}
                    className={`flex items-center justify-center h-7 px-3 rounded-[6px] text-[12px] font-medium transition-all duration-100 cursor-pointer select-none border font-sans ${
                      active
                        ? 'bg-[#2563eb]/15 text-[#3b82f6] border-[#2563eb]/35 hover:bg-[#2563eb]/25 shadow-xs'
                        : 'bg-[#0c0c0c] text-[#777777] border-[#222222] hover:text-[#aaaaaa] hover:border-[#383838]'
                    } ${readOnly ? 'cursor-default' : ''}`}
                    title={active ? `Disable ${op}` : `Enable ${op}`}
                  >
                    <span>{op}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      );
    })}

      {!readOnly && (
        <button
          type="button"
          onClick={addRule}
          className="flex items-center gap-1.5 h-9 px-4 text-[13px] font-medium text-[#cccccc] hover:text-white border border-dashed border-[#262626] hover:border-[#383838] bg-[#0c0c0c] hover:bg-[#141414] rounded-[8px] transition-colors cursor-pointer w-full justify-center"
        >
          <Plus className="w-3.5 h-3.5" />
          Add rule
        </button>
      )}
    </div>
  );
}
