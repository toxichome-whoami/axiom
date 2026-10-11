/*
 * SQL Query Runner & Results Console subcomponent.
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../types
 */

import React from 'react';
import { Terminal, RefreshCw, Play, AlertCircle, Check } from 'lucide-react';
import { QueryResultApi } from '../../types';

export interface SqlConsoleViewProps {
  selectedDb: string;
  selectedTable: string;
  sqlQuery: string;
  setSqlQuery: (query: string) => void;
  isExecutingSql: boolean;
  sqlResult: QueryResultApi | null;
  sqlError: string | null;
  sqlDuration: number | null;
  handleExecuteSql: () => void;
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
  handleExecuteSql,
}: SqlConsoleViewProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-4 space-y-3 font-sans">
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
  );
}
