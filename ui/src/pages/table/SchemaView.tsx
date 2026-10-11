/*
 * Database Schema & Entity Relationships Mode view.
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../types
 */

import React from 'react';
import { Layers, Table as TableIcon, Check, Copy } from 'lucide-react';
import { TableInfoApi, ColumnInfoApi, ForeignKeyInfoApi } from '../../types';

export interface SchemaViewProps {
  selectedDb: string;
  selectedTable: string;
  tables: TableInfoApi[];
  columns: ColumnInfoApi[];
  foreignKeys: ForeignKeyInfoApi[];
  allDbTablesSchema: Record<string, { columns: ColumnInfoApi[]; foreign_keys?: ForeignKeyInfoApi[] }>;
  copiedKey: string | null;
  handleCopy: (text: string, key: string) => void;
  onSelectTable: (tableName: string) => void;
}

export function SchemaView({
  selectedDb,
  selectedTable,
  tables,
  columns,
  foreignKeys,
  allDbTablesSchema,
  copiedKey,
  handleCopy,
  onSelectTable,
}: SchemaViewProps) {
  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6 font-sans">
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
              onClick={() => onSelectTable(t.name)}
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
  );
}
