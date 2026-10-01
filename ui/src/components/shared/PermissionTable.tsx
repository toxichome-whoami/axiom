import React from 'react';
import { Plus, X } from 'lucide-react';

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

// Keep AxiomPermissions export so old import sites don't break immediately
// (they'll be cleaned up in TASK 2)
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

  if (readOnly && value.length === 0) {
    return (
      <div className="text-[13px] text-[#8c8c8c] py-2">No permission rules configured.</div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header row */}
      {!readOnly && value.length > 0 && (
        <div className="grid gap-2 text-[11px] font-medium text-[#8c8c8c] uppercase tracking-wide px-1"
          style={{ gridTemplateColumns: '1fr 1fr auto auto auto auto auto' }}>
          <span>Database</span>
          <span>Table</span>
          <span className="text-center">SEL</span>
          <span className="text-center">INS</span>
          <span className="text-center">UPD</span>
          <span className="text-center">DEL</span>
          <span />
        </div>
      )}
      {readOnly && value.length > 0 && (
        <div className="grid gap-2 text-[11px] font-medium text-[#8c8c8c] uppercase tracking-wide px-1"
          style={{ gridTemplateColumns: '1fr 1fr auto auto auto auto' }}>
          <span>Database</span>
          <span>Table</span>
          <span className="text-center">SEL</span>
          <span className="text-center">INS</span>
          <span className="text-center">UPD</span>
          <span className="text-center">DEL</span>
        </div>
      )}

      {value.map((rule, idx) => (
        <div
          key={idx}
          className="grid gap-2 items-center rounded-[6px] bg-[#0c0c0c] border border-[#1e1e1e] px-2 py-2"
          style={{ gridTemplateColumns: readOnly ? '1fr 1fr auto auto auto auto' : '1fr 1fr auto auto auto auto auto' }}
        >
          {/* Database input */}
          {readOnly ? (
            <span className="text-[13px] text-white font-mono">{rule.database}</span>
          ) : (
            <input
              type="text"
              value={rule.database}
              onChange={(e) => setRule(idx, { database: e.target.value })}
              placeholder="* or db_alias"
              className="h-7 w-full rounded-[4px] border border-[#262626] bg-[#121212] px-2 text-[12px] text-white font-mono focus:outline-none focus:border-[#3b82f6]"
            />
          )}

          {/* Table input */}
          {readOnly ? (
            <span className="text-[13px] text-white font-mono">{rule.table}</span>
          ) : (
            <input
              type="text"
              value={rule.table}
              onChange={(e) => setRule(idx, { table: e.target.value })}
              placeholder="* or table_name"
              className="h-7 w-full rounded-[4px] border border-[#262626] bg-[#121212] px-2 text-[12px] text-white font-mono focus:outline-none focus:border-[#3b82f6]"
            />
          )}

          {/* Operation checkboxes */}
          {ALL_OPS.map((op) => (
            <div key={op} className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={rule.operations.includes(op)}
                disabled={readOnly}
                onChange={() => !readOnly && toggleOp(idx, op)}
                className="w-3.5 h-3.5 accent-[#2563eb] cursor-pointer disabled:cursor-default"
              />
            </div>
          ))}

          {/* Delete button */}
          {!readOnly && (
            <button
              type="button"
              onClick={() => removeRule(idx)}
              className="flex items-center justify-center w-6 h-6 rounded text-[#8c8c8c] hover:text-[#e5484d] hover:bg-[#1a0505] transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}

      {!readOnly && (
        <button
          type="button"
          onClick={addRule}
          className="flex items-center gap-1.5 h-7 px-3 text-[12px] font-medium text-[#8c8c8c] hover:text-white border border-dashed border-[#262626] hover:border-[#383838] rounded-[6px] transition-colors cursor-pointer w-full justify-center"
        >
          <Plus className="w-3.5 h-3.5" />
          Add rule
        </button>
      )}
    </div>
  );
}
