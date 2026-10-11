/*
 * Table Skeleton Loader component.
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../types, ./format
 * Invariants: Preserves exact grid layout and column proportions during loading; eliminates layout shifts (CLS).
 */

import React from 'react';
import { Key, Link2 } from 'lucide-react';
import { ColumnInfoApi, ForeignKeyInfoApi } from '../../types';
import { getColumnTypeBadge, formatColumnType, getDefaultColumnWidth } from './format';

export interface TableSkeletonProps {
  columns: ColumnInfoApi[];
  foreignKeys: ForeignKeyInfoApi[];
  columnWidths?: Record<string, number>;
}

export function TableSkeleton({
  columns,
  foreignKeys,
  columnWidths,
}: TableSkeletonProps) {
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
            className="w-16 px-3 py-2 text-left bg-[#0a0a0a] sticky left-0 z-20 border-r border-[#1a1a1a]"
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
              className="px-3 py-2 text-left border-r border-[#1a1a1a] sticky left-0 bg-[#0a0a0a] z-10"
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
