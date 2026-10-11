/*
 * SQL Query Runner & Results Console subcomponent.
 * Features:
 * - Direct execution for single statements
 * - Chunk-based sequential execution for multi-statement scripts (like Neon / Supabase)
 * - Live statement counter, snippet preview, and animated progress bar
 * - One-click execution abort button
 * - Clean results grid with null/object formatting and execution metrics
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../types, ./useSqlConsole
 */

import React from 'react';
import { Terminal, RefreshCw, Play, AlertCircle, Check, StopCircle, Layers } from 'lucide-react';
import { QueryResultApi } from '../../types';
import { ChunkProgress, BatchSummary } from './useSqlConsole';

export interface SqlConsoleViewProps {
  selectedDb: string;
  selectedTable: string;
  sqlQuery: string;
  setSqlQuery: (query: string) => void;
  isExecutingSql: boolean;
  sqlResult: QueryResultApi | null;
  sqlError: string | null;
  sqlDuration: number | null;
  chunkProgress?: ChunkProgress | null;
  batchSummary?: BatchSummary | null;
  handleExecuteSql: () => void;
  handleCancelSql?: () => void;
}

export function SqlConsoleView({
  selectedDb,
  selectedTable,
  sqlQuery,
  setSqlQuery,
  isExecutingSql,
  sqlResult,
  sqlError,
  sqlDuration,
  chunkProgress,
  batchSummary,
  handleExecuteSql,
  handleCancelSql,
}: SqlConsoleViewProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-4 space-y-3 font-sans">
      {/* Query Editor Box */}
      <div className="rounded-[8px] border border-[#222222] bg-[#0f0f0f] p-3 flex flex-col shadow-xs">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="text-[15px] font-semibold text-white">SQL Query Runner</span>
            <span className="text-[12px] text-[#666666]">
              (<kbd className="px-1 py-0.5 rounded bg-[#1c1c1c] text-[#8c8c8c] font-mono text-[11px]">Ctrl+Enter</kbd> to execute)
            </span>
          </div>

          {/* Preset query buttons */}
          <div className="flex items-center gap-1.5">
            {selectedTable && (
              <button
                type="button"
                onClick={() => setSqlQuery(`SELECT * FROM ${selectedTable} LIMIT 25;`)}
                className="px-2 py-0.5 rounded bg-[#141414] border border-[#242424] text-[12px] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer"
              >
                SELECT *
              </button>
            )}
            {selectedTable && (
              <button
                type="button"
                onClick={() => setSqlQuery(`SELECT count(*) AS total_rows FROM ${selectedTable};`)}
                className="px-2 py-0.5 rounded bg-[#141414] border border-[#242424] text-[12px] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer"
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
          placeholder="Enter SQL statements (e.g. CREATE TABLE, INSERT INTO, SELECT)... Multiple statements will execute in chunks like Neon"
          className="w-full p-3 bg-[#080808] border border-[#202020] rounded-[6px] font-mono text-[13px] text-emerald-300 placeholder-[#444444] outline-none focus:border-emerald-500/60 resize-y transition-colors"
        />

        {/* Live Chunk Progress Bar (Neon Style) */}
        {chunkProgress && (
          <div className="mt-3 p-2.5 rounded-[6px] border border-[#262626] bg-[#141414] flex flex-col gap-2 animate-in fade-in duration-150">
            <div className="flex items-center justify-between text-[12px]">
              <div className="flex items-center gap-2 text-white font-medium">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                <span>
                  Executing chunk {chunkProgress.current} of {chunkProgress.total}
                </span>
                <span className="text-[#8c8c8c] font-mono">({chunkProgress.percent}%)</span>
              </div>
              {handleCancelSql && (
                <button
                  type="button"
                  onClick={handleCancelSql}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#2a1212] hover:bg-[#3a1818] border border-rose-800/50 text-rose-300 text-[11px] font-medium transition-colors cursor-pointer"
                >
                  <StopCircle className="w-3 h-3" />
                  <span>Stop</span>
                </button>
              )}
            </div>

            {/* Progress track */}
            <div className="w-full h-1.5 bg-[#202020] rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-150"
                style={{ width: `${Math.max(5, chunkProgress.percent)}%` }}
              />
            </div>

            <div className="font-mono text-[11.5px] text-[#8c8c8c] truncate">
              <span className="text-[#555555]">Running: </span>
              {chunkProgress.snippet}
            </div>
          </div>
        )}

        {/* Action Toolbar */}
        <div className="flex items-center justify-between mt-2 pt-1">
          <div className="text-[12px] text-[#666666] flex items-center gap-2">
            <span>
              Target database: <span className="font-mono text-[#cccccc]">{selectedDb}</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {isExecutingSql && handleCancelSql && (
              <button
                type="button"
                onClick={handleCancelSql}
                className="flex items-center gap-1.5 h-8 px-3 rounded-[6px] bg-[#221010] hover:bg-[#331818] border border-rose-800/40 text-rose-300 text-[12.5px] font-medium transition-colors cursor-pointer"
              >
                <StopCircle className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
            )}

            <button
              type="button"
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
      </div>

      {/* Results Box */}
      <div className="flex-1 rounded-[8px] border border-[#222222] bg-[#0f0f0f] flex flex-col min-h-0 overflow-hidden shadow-xs">
        {/* Output Header */}
        <div className="h-9 px-4 bg-[#141414] border-b border-[#222222] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-white">Query Output</span>
            {sqlDuration !== null && (
              <span className="text-[11.5px] px-1.5 py-0.5 rounded bg-[#1c1c1c] border border-[#262626] text-[#8c8c8c] font-mono">
                {sqlDuration}ms
              </span>
            )}
            {batchSummary && (
              <span className="flex items-center gap-1 text-[11.5px] px-2 py-0.5 rounded bg-[#064e3b]/30 border border-[#059669]/40 text-[#34d399] font-medium">
                <Layers className="w-3 h-3" />
                <span>{batchSummary.totalStatements} chunks executed</span>
              </span>
            )}
          </div>

          {sqlResult?.rows && sqlResult.rows.length > 0 && (
            <div className="text-[12px] text-[#8c8c8c]">
              {sqlResult.rows.length} rows returned
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-auto p-2">
          {isExecutingSql && !chunkProgress ? (
            <div className="flex items-center justify-center h-40 text-[#8c8c8c] text-[13px] gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
              Executing query...
            </div>
          ) : sqlError ? (
            <div className="p-6 text-center text-rose-400 text-[13px] font-mono whitespace-pre-wrap max-w-2xl mx-auto">
              <AlertCircle className="w-6 h-6 mx-auto mb-2 text-rose-500" />
              <div className="p-3 bg-[#180a0a] border border-rose-900/40 rounded-[6px] text-left">
                {sqlError}
              </div>
            </div>
          ) : !sqlResult ? (
            <div className="flex items-center justify-center h-40 text-[#555555] text-[13px]">
              Run a query above to view results
            </div>
          ) : batchSummary && (!sqlResult.rows || sqlResult.rows.length === 0) ? (
            <div className="p-8 text-center text-emerald-400 text-[14px] flex flex-col items-center justify-center gap-2">
              <div className="w-10 h-10 rounded-full bg-[#064e3b]/30 border border-[#059669]/40 flex items-center justify-center">
                <Check className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="font-semibold text-white text-[15px]">
                Batch Execution Completed Successfully
              </div>
              <div className="text-[13px] text-[#8c8c8c] font-mono">
                {batchSummary.totalStatements} statements executed • {batchSummary.totalAffectedRows} total rows affected • {batchSummary.durationMs}ms
              </div>
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
                      <th key={col} className="px-3 py-2 text-white font-medium">
                        {col}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#181818]">
                {(sqlResult.rows || []).map((r, i) => (
                  <tr key={i} className="hover:bg-[#141414] transition-colors">
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
  );
}
