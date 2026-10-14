/*
 * RBAC permission rule builder for defining database, table, and blob storage scopes.
 * Owned by: ui/components/shared
 * Key deps: lucide-react, react
 * Invariants: Deny-by-default; mandatory non-empty operations; max 100 rules ceiling;
 *             supports both Relational Databases and Native Blob Storage targets.
 * Last structural change: Integrated native Blob Storage permissions with Cloudflare-style adaptive design.
 */

import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  Database,
  Table as TableIcon,
  Package,
  FileCode,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';

export interface DbPermissionRule {
  database: string;
  table: string;
  operations: string[];
  resourceType?: 'database' | 'blob';
}

export interface PermissionTableProps {
  value: DbPermissionRule[];
  onChange?: (rules: DbPermissionRule[]) => void;
  readOnly?: boolean;
}

export type AxiomPermissions = DbPermissionRule[];

const DB_OPS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
const BLOB_OPS = ['READ', 'WRITE', 'DELETE'] as const;
const MAX_RULES = 100;
const MAX_SPLIT = 50;

/**
 * Checks whether a permission rule targets Blob Storage rather than a SQL Database.
 * CONTRACT:
 *  - Checks explicit `resourceType`, `blob:` prefix in `database`, or blob-specific operations.
 *  - Returns boolean.
 *  - Idempotent: Yes.
 */
export function isBlobRule(rule: DbPermissionRule): boolean {
  if (rule.resourceType === 'blob') return true;
  if (rule.database.toLowerCase().startsWith('blob:')) return true;
  return rule.operations.some((op) =>
    ['READ', 'WRITE', 'BLOB_READ', 'BLOB_WRITE', 'BLOB_DELETE'].includes(op.toUpperCase())
  );
}

/**
 * Extracts a user-friendly display name for the blob namespace from `blob:<ns>`.
 */
function getDisplayNamespace(rawDb: string): string {
  if (rawDb.toLowerCase().startsWith('blob:')) {
    return rawDb.slice(5);
  }
  return rawDb;
}

export function PermissionTable({ value, onChange, readOnly = false }: PermissionTableProps) {
  const [splitError, setSplitError] = useState<string | null>(null);

  function setRule(idx: number, patch: Partial<DbPermissionRule>) {
    if (!onChange) return;
    onChange(value.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function toggleOp(idx: number, op: string) {
    const rule = value[idx];
    const has = rule.operations.includes(op);
    // Forbid completely empty operations array (enforce explicit least privilege)
    if (has && rule.operations.length === 1) {
      return;
    }
    setRule(idx, {
      operations: has ? rule.operations.filter((o) => o !== op) : [...rule.operations, op],
    });
  }

  function switchResourceType(idx: number, targetType: 'database' | 'blob') {
    const rule = value[idx];
    const currentIsBlob = isBlobRule(rule);
    if ((targetType === 'blob' && currentIsBlob) || (targetType === 'database' && !currentIsBlob)) {
      return;
    }

    if (targetType === 'blob') {
      const cleanDb = rule.database.replace(/^blob:/i, '').trim();
      const newDb = cleanDb ? (cleanDb === '*' ? 'blob:*' : `blob:${cleanDb}`) : 'blob:';
      const hasRead = rule.operations.includes('SELECT') || rule.operations.includes('READ');
      const hasWrite =
        rule.operations.includes('INSERT') ||
        rule.operations.includes('UPDATE') ||
        rule.operations.includes('WRITE');
      const ops: string[] = [];
      if (hasRead) ops.push('READ');
      if (hasWrite) ops.push('WRITE');
      if (rule.operations.includes('DELETE')) ops.push('DELETE');

      setRule(idx, {
        resourceType: 'blob',
        database: newDb,
        operations: ops.length > 0 ? ops : ['READ'],
      });
    } else {
      const cleanDb = rule.database.replace(/^blob:/i, '').trim();
      const hasRead = rule.operations.includes('READ') || rule.operations.includes('SELECT');
      const hasWrite = rule.operations.includes('WRITE');
      const ops: string[] = [];
      if (hasRead) ops.push('SELECT');
      if (hasWrite) {
        ops.push('INSERT');
        ops.push('UPDATE');
      }
      if (rule.operations.includes('DELETE')) ops.push('DELETE');

      setRule(idx, {
        resourceType: 'database',
        database: cleanDb,
        operations: ops.length > 0 ? ops : ['SELECT'],
      });
    }
  }

  function addRule(type: 'database' | 'blob' = 'database') {
    if (!onChange || value.length >= MAX_RULES) return;
    if (type === 'blob') {
      onChange([
        ...value,
        {
          resourceType: 'blob',
          database: 'blob:',
          table: '*',
          operations: ['READ'],
        },
      ]);
    } else {
      onChange([
        ...value,
        {
          resourceType: 'database',
          database: '',
          table: '',
          operations: ['SELECT'],
        },
      ]);
    }
  }

  function removeRule(idx: number) {
    if (!onChange) return;
    onChange(value.filter((_, i) => i !== idx));
  }

  function splitRule(idx: number) {
    if (!onChange) return;
    setSplitError(null);
    const rule = value[idx];
    const isBlob = isBlobRule(rule);
    const rawDb = isBlob ? getDisplayNamespace(rule.database) : rule.database;
    const dbs = rawDb.split(',').map((s) => s.trim().slice(0, 64)).filter(Boolean);
    const tbls = rule.table.split(',').map((s) => s.trim().slice(0, 64)).filter(Boolean);
    const dbList = dbs.length > 0 ? dbs : ['*'];
    const tblList = tbls.length > 0 ? tbls : ['*'];

    const totalNew = dbList.length * tblList.length;
    if (totalNew > MAX_SPLIT) {
      setSplitError(`Cannot split rule: combination results in ${totalNew} rules (limit is ${MAX_SPLIT}).`);
      return;
    }

    if (value.length - 1 + totalNew > MAX_RULES) {
      setSplitError(`Cannot split rule: exceeds maximum limit of ${MAX_RULES} rules.`);
      return;
    }

    const newRules: DbPermissionRule[] = [];
    for (const d of dbList) {
      for (const t of tblList) {
        newRules.push({
          resourceType: isBlob ? 'blob' : 'database',
          database: isBlob ? (d === '*' ? 'blob:*' : `blob:${d}`) : d,
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
        <div className="rounded-[8px] border border-dashed border-[#262626] bg-[#0c0c0c] p-5 text-center text-[13px] text-[#737373]">
          No permission rules configured. Grant database or blob storage access below.
        </div>
        {!readOnly && (
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              type="button"
              onClick={() => addRule('database')}
              className="flex-1 flex items-center justify-center gap-2 h-11 px-4 text-[13px] font-medium text-[#d4d4d4] hover:text-white border border-[#262626] hover:border-[#383838] bg-[#121212] hover:bg-[#18181b] rounded-[8px] transition-colors cursor-pointer touch-manipulation"
            >
              <Database className="w-4 h-4 text-[#3b82f6]" />
              <span>Add Database Rule</span>
            </button>
            <button
              type="button"
              onClick={() => addRule('blob')}
              className="flex-1 flex items-center justify-center gap-2 h-11 px-4 text-[13px] font-medium text-[#d4d4d4] hover:text-white border border-[#262626] hover:border-[#383838] bg-[#121212] hover:bg-[#18181b] rounded-[8px] transition-colors cursor-pointer touch-manipulation"
            >
              <Package className="w-4 h-4 text-[#8c8c8c]" />
              <span>Add Blob Storage Rule</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3.5 font-sans">
      {splitError && (
        <div
          className="flex items-center gap-2 p-3 rounded-lg bg-[#2a1113] border border-[#5c1d24] text-[#f87171] text-[12px]"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{splitError}</span>
        </div>
      )}

      {value.map((rule, idx) => {
        const isBlob = isBlobRule(rule);
        const displayDb = isBlob ? getDisplayNamespace(rule.database) : rule.database;
        const dbHasComma = displayDb.includes(',');
        const tableHasComma = rule.table.includes(',');
        const hasCommaError = dbHasComma || tableHasComma;
        const isWildcard =
          (rule.database.trim() === '*' || rule.database.trim() === 'blob:*') &&
          rule.table.trim() === '*';

        return (
          <div
            key={idx}
            className={`rounded-[8px] border bg-[#111111] p-4 space-y-3.5 transition-colors ${
              hasCommaError
                ? 'border-[#e5484d]/50 shadow-xs'
                : isWildcard
                ? 'border-[#383838]'
                : 'border-[#262626] hover:border-[#383838]'
            }`}
          >
            {/* Card Header: Resource Switcher & Rule Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] font-medium text-[#737373] uppercase tracking-wider font-mono">
                  Rule {idx + 1}
                </span>

                {/* Segmented Resource Selector */}
                {!readOnly ? (
                  <div className="inline-flex items-center p-0.5 rounded-[6px] bg-[#0a0a0a] border border-[#222222]">
                    <button
                      type="button"
                      onClick={() => switchResourceType(idx, 'database')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[11px] font-medium transition-colors cursor-pointer touch-manipulation ${
                        !isBlob
                          ? 'bg-[#18181b] text-white border border-[#27272a] shadow-xs'
                          : 'text-[#737373] hover:text-[#d4d4d4]'
                      }`}
                    >
                      <Database className="w-3 h-3 text-[#8c8c8c]" />
                      <span>Database</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => switchResourceType(idx, 'blob')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[11px] font-medium transition-colors cursor-pointer touch-manipulation ${
                        isBlob
                          ? 'bg-[#18181b] text-white border border-[#27272a] shadow-xs'
                          : 'text-[#737373] hover:text-[#d4d4d4]'
                      }`}
                    >
                      <Package className="w-3 h-3 text-[#8c8c8c]" />
                      <span>Blob Storage</span>
                    </button>
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] text-[11px] font-medium border bg-[#18181b] text-[#cccccc] border-[#27272a]">
                    {isBlob ? (
                      <>
                        <Package className="w-3 h-3 text-[#8c8c8c]" /> Blob Storage
                      </>
                    ) : (
                      <>
                        <Database className="w-3 h-3 text-[#8c8c8c]" /> Database
                      </>
                    )}
                  </span>
                )}

                {isWildcard && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#18181b] text-[#cccccc] border border-[#27272a]">
                    <AlertTriangle className="w-3 h-3 text-[#8c8c8c]" />
                    Global Wildcard
                  </span>
                )}
              </div>

              {!readOnly && (
                <button
                  type="button"
                  onClick={() => removeRule(idx)}
                  className="self-end sm:self-auto min-w-[36px] min-h-[36px] flex items-center justify-center rounded-[6px] text-[#737373] hover:text-[#e5484d] hover:bg-[#2a0e0e] border border-transparent hover:border-[#4a1919] transition-colors cursor-pointer touch-manipulation"
                  title="Remove access rule"
                  aria-label={`Remove rule ${idx + 1}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Inputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
              {/* Field 1: Database or Blob Namespace */}
              <div>
                <label className="flex items-center gap-1.5 text-[12px] font-medium text-[#a3a3a3] mb-1.5">
                  {isBlob ? (
                    <>
                      <Package className="w-3.5 h-3.5 text-[#8c8c8c]" />
                      <span>Namespace Scope</span>
                    </>
                  ) : (
                    <>
                      <Database className="w-3.5 h-3.5 text-[#8c8c8c]" />
                      <span>Database Scope</span>
                    </>
                  )}
                </label>
                {readOnly ? (
                  <div className="min-h-[40px] rounded-[6px] border border-[#262626] bg-[#0c0c0c] px-3 flex items-center text-[13px] text-white font-mono">
                    {displayDb || '*'}
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={displayDb}
                      onChange={(e) => {
                        const val = e.target.value;
                        const finalVal = isBlob
                          ? val.trim() === '*'
                            ? 'blob:*'
                            : `blob:${val}`
                          : val;
                        setRule(idx, { database: finalVal });
                      }}
                      placeholder={isBlob ? '* (all) or namespace_name' : '* (all) or database_alias'}
                      className={`min-h-[42px] w-full rounded-[6px] border bg-[#0c0c0c] px-3 text-[13px] font-mono placeholder-[#525252] focus:outline-none transition-colors ${
                        dbHasComma
                          ? 'border-[#e5484d] text-[#e5484d] focus:border-[#e5484d]'
                          : 'border-[#262626] text-white focus:border-[#2f80ed] hover:border-[#383838]'
                      }`}
                    />
                    {dbHasComma && (
                      <div className="mt-1 flex items-center justify-between text-[11px] text-[#e5484d] font-sans">
                        <span className="flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          Multiple targets not supported in single rule
                        </span>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => splitRule(idx)}
                            className="text-[11px] font-medium text-[#3b82f6] hover:underline cursor-pointer ml-1 shrink-0"
                            title="Split into separate rules"
                          >
                            Split
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Field 2: Table or Object Key Pattern */}
              <div>
                <label className="flex items-center gap-1.5 text-[12px] font-medium text-[#a3a3a3] mb-1.5">
                  {isBlob ? (
                    <>
                      <FileCode className="w-3.5 h-3.5 text-[#8c8c8c]" />
                      <span>Key Pattern (supports wildcards)</span>
                    </>
                  ) : (
                    <>
                      <TableIcon className="w-3.5 h-3.5 text-[#8c8c8c]" />
                      <span>Table Scope</span>
                    </>
                  )}
                </label>
                {readOnly ? (
                  <div className="min-h-[40px] rounded-[6px] border border-[#262626] bg-[#0c0c0c] px-3 flex items-center text-[13px] text-white font-mono">
                    {rule.table || '*'}
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={rule.table}
                      onChange={(e) => setRule(idx, { table: e.target.value })}
                      placeholder={isBlob ? '* (all) or uploads/* or doc.pdf' : '* (all) or table_name'}
                      className={`min-h-[42px] w-full rounded-[6px] border bg-[#0c0c0c] px-3 text-[13px] font-mono placeholder-[#525252] focus:outline-none transition-colors ${
                        tableHasComma
                          ? 'border-[#e5484d] text-[#e5484d] focus:border-[#e5484d]'
                          : 'border-[#262626] text-white focus:border-[#2f80ed] hover:border-[#383838]'
                      }`}
                    />
                    {tableHasComma && (
                      <div className="mt-1 flex items-center justify-between text-[11px] text-[#e5484d] font-sans">
                        <span className="flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          Multiple targets not supported in single rule
                        </span>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => splitRule(idx)}
                            className="text-[11px] font-medium text-[#3b82f6] hover:underline cursor-pointer ml-1 shrink-0"
                            title="Split into separate rules"
                          >
                            Split
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Edge-to-edge subtle divider */}
            <div className="-mx-4 border-t border-[#1f1f1f]" />

            {/* Card Bottom: Operation Switchers */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-0.5">
              <span className="text-[12px] font-medium text-[#737373]">
                Granted Operations:
              </span>

              {/* Segmented Operation Pill Buttons (44px min touch target compliant) */}
              <div className="flex flex-wrap items-center gap-2">
                {(isBlob ? BLOB_OPS : DB_OPS).map((op) => {
                  const active =
                    rule.operations.includes(op) ||
                    rule.operations.includes('*') ||
                    (op === 'READ' && rule.operations.includes('SELECT')) ||
                    (op === 'WRITE' &&
                      (rule.operations.includes('INSERT') || rule.operations.includes('UPDATE')));

                  return (
                    <button
                      key={op}
                      type="button"
                      disabled={readOnly}
                      onClick={() => !readOnly && toggleOp(idx, op)}
                      className={`flex items-center justify-center min-h-[38px] px-3.5 rounded-[6px] text-[12px] font-medium transition-all duration-100 cursor-pointer select-none border font-mono touch-manipulation ${
                        active
                          ? 'bg-[#2563eb]/15 text-[#3b82f6] border-[#2563eb]/35 hover:bg-[#2563eb]/25'
                          : 'bg-[#0c0c0c] text-[#737373] border-[#222222] hover:text-[#d4d4d4] hover:border-[#383838]'
                      } ${readOnly ? 'cursor-default' : ''}`}
                      title={active ? `Revoke ${op}` : `Grant ${op}`}
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
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <button
            type="button"
            onClick={() => addRule('database')}
            className="flex-1 flex items-center justify-center gap-1.5 min-h-[42px] px-4 text-[13px] font-medium text-[#cccccc] hover:text-white border border-dashed border-[#262626] hover:border-[#383838] bg-[#0c0c0c] hover:bg-[#121212] rounded-[8px] transition-colors cursor-pointer touch-manipulation"
          >
            <Plus className="w-3.5 h-3.5 text-[#8c8c8c]" />
            <span>Add Database Rule</span>
          </button>
          <button
            type="button"
            onClick={() => addRule('blob')}
            className="flex-1 flex items-center justify-center gap-1.5 min-h-[42px] px-4 text-[13px] font-medium text-[#cccccc] hover:text-white border border-dashed border-[#262626] hover:border-[#383838] bg-[#0c0c0c] hover:bg-[#121212] rounded-[8px] transition-colors cursor-pointer touch-manipulation"
          >
            <Plus className="w-3.5 h-3.5 text-[#8c8c8c]" />
            <span>Add Blob Rule</span>
          </button>
        </div>
      )}
    </div>
  );
}
