/*
 * SQL Query Runner & Results Console subcomponent.
 * Features:
 * - 50/50 Split grid layout (VSCode SQL Editor on left, Results grid on right)
 * - Layout switcher (Side-by-side, Stacked, Full Editor, Full Output)
 * - VS Code-styled code editor with real-time Syntax Highlighting and IntelliSense
 * - Chunk-based sequential execution for multi-statement scripts (like Neon / Supabase)
 * - Live statement counter, snippet preview, and animated progress bar
 * - Rich results grid with live search/filter, JSON view, CSV export, and execution metrics
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../types, ./useSqlConsole, ./SqlCodeEditor
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  RefreshCw,
  AlertCircle,
  Check,
  StopCircle,
  Search,
  Download,
  Copy,
  Table as TableIcon,
  Code,
  Clock,
} from 'lucide-react';
import { QueryResultApi, ColumnInfoApi, TableInfoApi } from '../../types';
import { ChunkProgress, BatchSummary } from './useSqlConsole';
import { SqlCodeEditor } from './SqlCodeEditor';
import { getDefaultColumnWidth, getColumnTypeBadge, formatColumnType } from './format';

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
  tables?: TableInfoApi[];
  allDbTablesSchema?: Record<string, { columns: ColumnInfoApi[]; foreign_keys?: unknown[] }>;
  layoutMode?: 'side-by-side' | 'stacked' | 'editor-only' | 'results-only';
  setLayoutMode?: (mode: 'side-by-side' | 'stacked' | 'editor-only' | 'results-only') => void;
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
  tables = [],
  allDbTablesSchema = {},
  layoutMode: controlledLayoutMode,
  setLayoutMode: setControlledLayoutMode,
}: SqlConsoleViewProps) {
  // Layout mode: 'side-by-side' (columns), 'stacked' (rows), 'editor-only', 'results-only'
  const [internalLayoutMode, setInternalLayoutMode] = useState<'side-by-side' | 'stacked' | 'editor-only' | 'results-only'>('side-by-side');
  const layoutMode = controlledLayoutMode ?? internalLayoutMode;

  // Output Sub-tab: 'grid' | 'stats'
  const [outputTab, setOutputTab] = useState<'grid' | 'stats'>('grid');

  // Results live search filter
  const [searchFilter, setSearchFilter] = useState('');
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [copiedSnippetIndex, setCopiedSnippetIndex] = useState<number | null>(null);

  const handleCopySnippet = useCallback((snippet: string, index: number) => {
    navigator.clipboard.writeText(snippet);
    setCopiedSnippetIndex(index);
    setTimeout(() => setCopiedSnippetIndex(null), 1500);
  }, []);

  // Filtered rows for Query Output
  const resultRows = useMemo(() => {
    if (!sqlResult?.rows) return [];
    if (!searchFilter.trim()) return sqlResult.rows;
    const q = searchFilter.toLowerCase();
    return sqlResult.rows.filter((row) =>
      Object.values(row).some((val) =>
        String(val ?? '').toLowerCase().includes(q)
      )
    );
  }, [sqlResult, searchFilter]);

  // Dynamic Column List for Query Output
  const resultCols = useMemo(() => {
    if (sqlResult?.columns && sqlResult.columns.length > 0) {
      return sqlResult.columns;
    }
    if (resultRows && resultRows.length > 0) {
      return Object.keys(resultRows[0]);
    }
    return [];
  }, [sqlResult, resultRows]);

  // Infer or retrieve column type
  const getColType = useCallback(
    (colName: string): string => {
      if (selectedTable && allDbTablesSchema[selectedTable]?.columns) {
        const found = allDbTablesSchema[selectedTable].columns.find(
          (c) => c.name.toLowerCase() === colName.toLowerCase()
        );
        if (found?.type) return found.type;
      }
      for (const schema of Object.values(allDbTablesSchema)) {
        if (schema.columns) {
          const found = schema.columns.find(
            (c) => c.name.toLowerCase() === colName.toLowerCase()
          );
          if (found?.type) return found.type;
        }
      }
      if (resultRows && resultRows.length > 0) {
        for (const row of resultRows) {
          const val = row[colName];
          if (val !== null && val !== undefined) {
            if (typeof val === 'boolean') return 'boolean';
            if (typeof val === 'number') {
              return Number.isInteger(val) ? 'integer' : 'numeric';
            }
            if (typeof val === 'object') return 'jsonb';
            if (typeof val === 'string') {
              if (/^\d{4}-\d{2}-\d{2}/.test(val)) return 'timestamp';
              if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) return 'uuid';
              return 'text';
            }
          }
        }
      }
      return 'text';
    },
    [allDbTablesSchema, selectedTable, resultRows]
  );

  // Column width state & resize handler
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const resizingColRef = useRef<{
    colName: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  const getColWidth = useCallback(
    (colName: string): number => {
      if (columnWidths[colName] && columnWidths[colName] >= 80) {
        return columnWidths[colName];
      }
      const type = getColType(colName);
      return getDefaultColumnWidth(type, colName);
    },
    [columnWidths, getColType]
  );

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
        const newWidth = Math.max(80, Math.min(1200, startWidth + delta));

        setColumnWidths((prev) => ({
          ...prev,
          [targetCol]: newWidth,
        }));
      }

      function onMouseUp() {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        resizingColRef.current = null;
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    []
  );

  // Export results to CSV
  const handleExportCsv = () => {
    if (!sqlResult?.rows || sqlResult.rows.length === 0) return;
    const cols = sqlResult.columns || Object.keys(sqlResult.rows[0]);
    const header = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
    const rows = sqlResult.rows.map((r) =>
      cols
        .map((c) => {
          const v = r[c];
          if (v === null || v === undefined) return '""';
          return `"${String(v).replace(/"/g, '""')}"`;
        })
        .join(',')
    );
    const csvContent = [header, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `query_results_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Copy raw JSON
  const handleCopyJson = () => {
    if (!sqlResult) return;
    navigator.clipboard.writeText(JSON.stringify(sqlResult.rows || sqlResult, null, 2));
    setCopiedOutput(true);
    setTimeout(() => setCopiedOutput(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#0c0c0c] font-sans">
      {/* ─── Grid Workspace Layout (Edge-to-Edge Connected) ─── */}
      <div
        className={`flex-1 min-h-0 overflow-hidden ${
          layoutMode === 'side-by-side'
            ? 'grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#222222]'
            : layoutMode === 'stacked'
            ? 'grid grid-rows-2 divide-y divide-[#222222]'
            : 'flex'
        }`}
      >
        {/* ─── PANE 1: VS Code SQL Editor ─── */}
        {(layoutMode === 'side-by-side' || layoutMode === 'stacked' || layoutMode === 'editor-only') && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <SqlCodeEditor
              value={sqlQuery}
              onChange={setSqlQuery}
              onExecute={handleExecuteSql}
              tables={tables}
              allDbTablesSchema={allDbTablesSchema}
              selectedDb={selectedDb}
              selectedTable={selectedTable}
              isExecuting={isExecutingSql}
            />
          </div>
        )}

        {/* ─── PANE 2: Query Output & Results Grid ─── */}
        {(layoutMode === 'side-by-side' || layoutMode === 'stacked' || layoutMode === 'results-only') && (
          <div className="flex-1 flex flex-col min-h-0 bg-[#0c0c0c] overflow-hidden">
            {/* Output Header */}
            <div className="h-[54px] w-full px-3 sm:px-4 bg-[#0c0c0c] border-b border-[#222222] flex items-center justify-between gap-2 sm:gap-3 shrink-0 select-none font-sans overflow-x-auto scrollbar-none">
              {/* Output Sub-tabs (Matching TableToolbar design system tab switcher) */}
              <div className="flex items-center p-1 rounded-[7px] bg-[#141414] border border-[#262626] h-9">
                <button
                  type="button"
                  onClick={() => setOutputTab('grid')}
                  className={`flex items-center justify-center gap-1.5 px-3.5 py-1 min-w-[96px] rounded-[5px] text-[13px] font-medium transition-colors cursor-pointer select-none font-sans outline-none ${
                    outputTab === 'grid'
                      ? 'bg-[#222222] text-white shadow-sm'
                      : 'text-[#8c8c8c] hover:text-white hover:bg-[#1a1a1a]'
                  }`}
                >
                  <TableIcon className="w-3.5 h-3.5 shrink-0" />
                  <span>Results</span>
                  {sqlResult?.rows && (
                    <span className={`text-[11px] px-1.5 py-0.2 rounded-full font-mono transition-colors ${
                      outputTab === 'grid'
                        ? 'bg-[#181818] text-[#cccccc] border border-[#2e2e2e]'
                        : 'bg-[#1e1e1e] text-[#8c8c8c]'
                    }`}>
                      {sqlResult.rows.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setOutputTab('stats')}
                  className={`flex items-center justify-center gap-1.5 px-3.5 py-1 min-w-[96px] rounded-[5px] text-[13px] font-medium transition-colors cursor-pointer select-none font-sans outline-none ${
                    outputTab === 'stats'
                      ? 'bg-[#222222] text-white shadow-sm'
                      : 'text-[#8c8c8c] hover:text-white hover:bg-[#1a1a1a]'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>Stats</span>
                  {sqlDuration !== null && (
                    <span className={`text-[11px] px-1.5 py-0.2 rounded-full font-mono transition-colors ${
                      outputTab === 'stats'
                        ? 'bg-[#181818] text-[#cccccc] border border-[#2e2e2e]'
                        : 'bg-[#1e1e1e] text-[#8c8c8c]'
                    }`}>
                      {sqlDuration}ms
                    </span>
                  )}
                </button>
              </div>

              {/* Output Controls (Search, Copy, CSV) */}
              <div className="flex items-center gap-2">
                {outputTab === 'grid' && sqlResult?.rows && sqlResult.rows.length > 0 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#666666] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Filter rows..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="h-9 w-32 sm:w-48 pl-8 pr-3 bg-[#141414] hover:bg-[#181818] border border-[#262626] focus:border-[#3b82f6] rounded-[7px] text-[13px] text-white placeholder-[#666666] outline-none transition-colors"
                    />
                  </div>
                )}

                {sqlResult?.rows && sqlResult.rows.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleCopyJson}
                      title="Copy results as JSON"
                      className="flex items-center gap-1.5 h-9 px-3 rounded-[7px] bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] hover:border-[#383838] text-[13px] font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer select-none"
                    >
                      {copiedOutput ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-[#888888]" />
                      )}
                      <span className="hidden sm:inline">JSON</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleExportCsv}
                      title="Export results to CSV"
                      className="flex items-center gap-1.5 h-9 px-3 rounded-[7px] bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] hover:border-[#383838] text-[13px] font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer select-none"
                    >
                      <Download className="w-3.5 h-3.5 text-[#888888]" />
                      <span className="hidden sm:inline">CSV</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Live Execution Progress Strip (Linear / Developer Grade) */}
            {chunkProgress && (
              <div className="relative h-10 px-4 bg-[#0e0e0e] border-b border-[#222222] flex items-center justify-between gap-3 text-[13px] font-sans select-none shrink-0 overflow-hidden animate-in fade-in duration-100">
                {/* Hairline Progress Bar */}
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1a1a1a]">
                  <div
                    className="h-full bg-[#2f80ed] transition-all duration-200"
                    style={{ width: `${Math.max(2, chunkProgress.percent)}%` }}
                  />
                </div>

                {/* Left: Indicator, Counter & Live Statement */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#2f80ed] shrink-0" />
                  <div className="flex items-center gap-1.5 shrink-0 text-white font-medium text-[13px]">
                    <span>Executing</span>
                    <span className="font-mono text-[#cccccc] font-normal">
                      {chunkProgress.current}/{chunkProgress.total}
                    </span>
                    <span className="text-[#8c8c8c] font-mono text-[12px]">
                      ({chunkProgress.percent}%)
                    </span>
                  </div>
                  <span className="text-[#444444] shrink-0 font-mono">•</span>
                  <div className="truncate min-w-0 font-mono text-[12px] text-[#8c8c8c]" title={chunkProgress.snippet}>
                    {chunkProgress.snippet}
                  </div>
                </div>

                {/* Right: Clean Cancel Action */}
                {handleCancelSql && (
                  <button
                    type="button"
                    onClick={handleCancelSql}
                    className="flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] hover:border-rose-900/50 text-[#8c8c8c] hover:text-rose-400 text-[12px] font-medium transition-colors cursor-pointer shrink-0"
                  >
                    <StopCircle className="w-3.5 h-3.5 text-[#8c8c8c]" />
                    <span>Cancel</span>
                  </button>
                )}
              </div>
            )}

            {/* Batch execution warning banner when errors were skipped */}
            {batchSummary?.errors && batchSummary.errors.length > 0 && outputTab === 'grid' && (
              <div className="h-10 px-4 bg-[#0e0e0e] border-b border-[#222222] flex items-center justify-between text-[13px] text-[#cccccc] shrink-0 select-none font-sans">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-[#f59e0b] shrink-0" />
                  <span className="truncate text-[#cccccc] font-normal">
                    Batch completed: <span className="text-white font-medium">{batchSummary.successful} statements succeeded</span>
                    <span className="text-[#8c8c8c]"> ({batchSummary.errors.length} skipped with warnings)</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setOutputTab('stats')}
                  className="text-[#8c8c8c] hover:text-white text-[12px] font-medium transition-colors shrink-0 ml-4 cursor-pointer flex items-center gap-1.5 px-2 py-1 rounded-[6px] hover:bg-[#141414]"
                >
                  <span>View in stats</span>
                  <span className="font-mono text-[11px] text-[#666666]">→</span>
                </button>
              </div>
            )}

            {/* Output Body Container */}
            <div className="flex-1 overflow-auto bg-[#0c0c0c] relative">
              {isExecutingSql && !chunkProgress ? (
                <div className="flex flex-col items-center justify-center h-full text-[#8c8c8c] text-[13px] gap-2.5">
                  <RefreshCw className="w-5 h-5 animate-spin text-blue-400" />
                  <span>Executing query against {selectedDb}...</span>
                </div>
              ) : sqlError ? (
                <div className="p-6 max-w-2xl mx-auto h-full flex flex-col justify-center select-text font-sans">
                  <div className="relative overflow-hidden p-5 bg-[#0e0e0e] border border-[#222222] rounded-[8px] text-left space-y-3.5 shadow-2xl">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#ef4444] shrink-0" />
                        <span className="text-white font-medium text-[14px]">Query execution error</span>
                      </div>
                      {selectedDb && (
                        <span className="text-[11px] font-mono text-[#8c8c8c] px-2 py-0.5 rounded-[4px] bg-[#141414] border border-[#262626]">
                          {selectedDb}
                        </span>
                      )}
                    </div>

                    {/* Clean formatted error message */}
                    <div className="text-[12.5px] font-mono text-[#f87171] leading-relaxed break-words whitespace-pre-wrap bg-[#050505] p-3 rounded-[6px] border border-[#1f1f1f] select-text">
                      {sqlError}
                    </div>

                    {/* Contextual Actionable Guidance */}
                    {/depend on it|foreign key|constraint fails|violates foreign key|1451/i.test(sqlError) && (
                      <div className="flex flex-col gap-2 p-3.5 rounded-[6px] bg-[#141414] border border-[#222222] text-[#8c8c8c] text-[12.5px] leading-relaxed">
                        <div className="flex items-center gap-1.5 text-white font-medium text-[13px]">
                          <AlertCircle className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                          <span>Foreign Key Constraint Guidance (Error 1451)</span>
                        </div>
                        <p>
                          In MySQL/MariaDB, tables with foreign keys cannot be dropped or truncated while referenced by child tables, and <code className="px-1.5 py-0.5 rounded-[4px] bg-[#0c0c0c] border border-[#262626] text-[#cccccc] font-mono text-[11.5px]">CASCADE</code> on <code className="px-1.5 py-0.5 rounded-[4px] bg-[#0c0c0c] border border-[#262626] text-[#cccccc] font-mono text-[11.5px]">DROP TABLE</code> is ignored.
                        </p>
                        <p className="text-[#666666]">To safely recreate relational tables in MySQL, disable foreign key checks during drops:</p>
                        <pre className="p-2.5 rounded-[6px] bg-[#050505] border border-[#1f1f1f] text-[#cccccc] font-mono text-[12px] select-all overflow-x-auto">
{`SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS payments, order_items, orders, products, categories, employees, customers, suppliers;
SET FOREIGN_KEY_CHECKS = 1;`}
                        </pre>
                      </div>
                    )}

                    {/duplicate key name|duplicate key|1061/i.test(sqlError) && (
                      <div className="flex flex-col gap-2 p-3.5 rounded-[6px] bg-[#141414] border border-[#222222] text-[#8c8c8c] text-[12.5px] leading-relaxed">
                        <div className="flex items-center gap-1.5 text-white font-medium text-[13px]">
                          <AlertCircle className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                          <span>Duplicate Index Guidance (Error 1061)</span>
                        </div>
                        <p>
                          MySQL does not support <code className="px-1.5 py-0.5 rounded-[4px] bg-[#0c0c0c] border border-[#262626] text-[#cccccc] font-mono text-[11.5px]">CREATE INDEX IF NOT EXISTS</code>. When an index already exists on a table, MySQL returns error 1061.
                        </p>
                        <p>
                          Enable the <strong className="text-white font-medium">Continue on error</strong> toggle in the toolbar to allow multi-statement scripts to run past existing indexes, or drop the index first with <code className="px-1.5 py-0.5 rounded-[4px] bg-[#0c0c0c] border border-[#262626] text-[#cccccc] font-mono text-[11.5px]">DROP INDEX &lt;name&gt; ON &lt;table&gt;;</code>.
                        </p>
                      </div>
                    )}

                    {/expected: end of statement|sql parser error|sql_parse_error/i.test(sqlError) && (
                      <div className="flex flex-col gap-2 p-3.5 rounded-[6px] bg-[#141414] border border-[#222222] text-[#8c8c8c] text-[12.5px] leading-relaxed">
                        <div className="flex items-center gap-1.5 text-white font-medium text-[13px]">
                          <AlertCircle className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                          <span>SQL Syntax / Statement Boundary Tip</span>
                        </div>
                        <p>
                          A statement delimiter is likely missing. Ensure every SQL statement ends with a semicolon (<code className="px-1.5 py-0.5 rounded-[4px] bg-[#0c0c0c] border border-[#262626] text-[#cccccc] font-mono text-[11.5px]">;</code>) before subsequent statements like <code className="px-1.5 py-0.5 rounded-[4px] bg-[#0c0c0c] border border-[#262626] text-[#cccccc] font-mono text-[11.5px]">DROP</code> or <code className="px-1.5 py-0.5 rounded-[4px] bg-[#0c0c0c] border border-[#262626] text-[#cccccc] font-mono text-[11.5px]">CREATE</code>.
                        </p>
                      </div>
                    )}

                    {/lock wait timeout|metadata lock|slow statement/i.test(sqlError) && (
                      <div className="flex flex-col gap-2 p-3.5 rounded-[6px] bg-[#141414] border border-[#222222] text-[#8c8c8c] text-[12.5px] leading-relaxed">
                        <div className="flex items-center gap-1.5 text-white font-medium text-[13px]">
                          <AlertCircle className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                          <span>Lock Wait Timeout</span>
                        </div>
                        <p>
                          Another active transaction or connection was holding a lock on this table. Wait for the transaction to complete, or kill idle uncommitted transactions.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : !sqlResult ? (
                <div className="flex flex-col items-center justify-center h-full text-[#555555] text-[13px] gap-2 p-6 text-center">
                  <Code className="w-8 h-8 text-[#333333]" />
                  <span className="text-[#888888]">Run a query in the editor to inspect results</span>
                  <span className="text-[11.5px] text-[#555555]">
                    Shortcut: <kbd className="px-1.5 py-0.5 rounded bg-[#181818] text-[#888888] font-mono">Ctrl+Enter</kbd>
                  </span>
                </div>
              ) : outputTab === 'stats' ? (
                /* Stats / Execution Summary View */
                <div className="p-6 space-y-6 font-sans max-w-4xl mx-auto">
                  {/* Execution Telemetry Card */}
                  <div className="relative overflow-hidden rounded-[8px] border border-[#222222] bg-[#0e0e0e] p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-white">Execution telemetry</span>
                      </div>
                      {selectedDb && (
                        <span className="text-[11.5px] font-mono text-[#8c8c8c] px-2.5 py-0.5 rounded-[4px] bg-[#141414] border border-[#262626]">
                          {selectedDb}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-sans">
                      <div className="p-4 rounded-[6px] bg-[#141414] border border-[#222222] hover:border-[#383838] transition-colors">
                        <span className="text-[12px] font-normal text-[#8c8c8c] block font-sans">Duration</span>
                        <span className="text-[26px] font-semibold text-white tracking-[-0.02em] font-sans tabular-nums mt-1 block">
                          {sqlDuration !== null ? `${sqlDuration} ms` : '—'}
                        </span>
                      </div>
                      <div className="p-4 rounded-[6px] bg-[#141414] border border-[#222222] hover:border-[#383838] transition-colors">
                        <span className="text-[12px] font-normal text-[#8c8c8c] block font-sans">Rows returned</span>
                        <span className="text-[26px] font-semibold text-white tracking-[-0.02em] font-sans tabular-nums mt-1 block">
                          {sqlResult.rows ? sqlResult.rows.length.toLocaleString() : 0}
                        </span>
                      </div>
                      <div className="p-4 rounded-[6px] bg-[#141414] border border-[#222222] hover:border-[#383838] transition-colors">
                        <span className="text-[12px] font-normal text-[#8c8c8c] block font-sans">Affected rows</span>
                        <span className="text-[26px] font-semibold text-white tracking-[-0.02em] font-sans tabular-nums mt-1 block">
                          {sqlResult.affected_rows !== undefined ? sqlResult.affected_rows.toLocaleString() : '0'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Batch Summary Report Card */}
                  {batchSummary && (
                    <div className="relative overflow-hidden rounded-[8px] border border-[#222222] bg-[#0e0e0e]">
                      {/* Execution Overview Row */}
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-medium text-white">
                                Batch execution completed
                              </span>
                            </div>
                            <p className="text-[12.5px] text-[#8c8c8c] leading-relaxed font-sans">
                              <span className="text-white font-medium">{batchSummary.successful}</span> of {batchSummary.totalStatements} statements completed
                              {batchSummary.errors && batchSummary.errors.length > 0 && (
                                <span className="text-[#f59e0b]"> • {batchSummary.errors.length} skipped</span>
                              )}
                              {' '}• {batchSummary.totalAffectedRows} affected rows
                            </p>
                          </div>
                          <span className="px-2.5 py-0.5 rounded-[4px] bg-[#141414] border border-[#262626] text-[#8c8c8c] font-mono text-[12px] shrink-0">
                            {batchSummary.durationMs}ms
                          </span>
                        </div>
                      </div>

                      {/* Skipped Statements List (Edge to Edge divider) */}
                      {batchSummary.errors && batchSummary.errors.length > 0 && (
                        <div className="border-t border-[#222222] p-5 space-y-3">
                          <div className="flex items-center justify-between text-[13px] text-[#cccccc]">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-white">Skipped statements</span>
                              <span className="px-2 py-0.5 rounded-full bg-[#141414] border border-[#262626] text-[#8c8c8c] font-mono text-[11px]">
                                {batchSummary.errors.length}
                              </span>
                            </div>
                            <span className="text-[12px] text-[#666666] font-normal">
                              Tolerated via continue on error
                            </span>
                          </div>

                          <div className="max-h-96 overflow-y-auto space-y-2.5 pr-1">
                            {batchSummary.errors.map((err) => (
                              <div
                                key={err.index}
                                className="group relative rounded-[6px] border border-[#222222] bg-[#141414] hover:border-[#333333] p-3.5 space-y-2.5 transition-colors"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded-[4px] bg-[#1a1a1a] border border-[#262626] font-mono text-[11.5px] text-[#cccccc]">
                                      Statement #{err.index}
                                    </span>
                                    <span className="text-[13px] font-medium text-white">
                                      {err.isDuplicate ? 'Index or key already exists' : 'Execution notice'}
                                    </span>
                                  </div>
                                  {err.isDuplicate && (
                                    <span className="px-2 py-0.5 rounded-full bg-[#1a1a1a] border border-[#262626] text-[#8c8c8c] text-[11px] font-mono">
                                      Idempotent
                                    </span>
                                  )}
                                </div>

                                <div className="text-[12.5px] font-mono text-[#f87171] break-words leading-relaxed pl-0.5">
                                  {err.error}
                                </div>

                                {/* Sleek Terminal Snippet */}
                                <div className="relative group/snippet rounded-[6px] bg-[#0a0a0a] border border-[#1f1f1f] p-2.5 font-mono text-[12px] text-[#cccccc] select-all overflow-x-auto flex items-center justify-between gap-3">
                                  <code className="truncate text-[#cccccc]">{err.statement}</code>
                                  <button
                                    type="button"
                                    onClick={() => handleCopySnippet(err.statement, err.index)}
                                    title="Copy statement SQL"
                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-[4px] hover:bg-[#1f1f1f] text-[#8c8c8c] hover:text-white cursor-pointer shrink-0"
                                  >
                                    {copiedSnippetIndex === err.index ? (
                                      <Check className="w-4 h-4 text-[#30a46c]" />
                                    ) : (
                                      <Copy className="w-4 h-4" />
                                    )}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : batchSummary && (!sqlResult.rows || sqlResult.rows.length === 0) ? (
                /* Batch Summary Completed (Empty rows output) */
                <div className="p-8 text-center flex flex-col items-center justify-center gap-4 h-full max-w-lg mx-auto font-sans select-none">
                  <div className="relative flex items-center justify-center w-12 h-12 rounded-[8px] bg-[#141414] border border-[#222222]">
                    {batchSummary.errors && batchSummary.errors.length > 0 ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" />
                    ) : (
                      <Check className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="font-medium text-white text-[15px]">
                      Batch execution finished
                    </div>
                    <div className="text-[12.5px] text-[#8c8c8c] font-mono leading-relaxed">
                      {batchSummary.successful} succeeded • {batchSummary.errors ? batchSummary.errors.length : 0} skipped • {batchSummary.totalAffectedRows} affected rows • {batchSummary.durationMs}ms
                    </div>
                  </div>
                  {batchSummary.errors && batchSummary.errors.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setOutputTab('stats')}
                      className="flex items-center gap-2 px-3.5 py-1.5 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] text-[#cccccc] hover:text-white text-[12.5px] font-medium transition-colors cursor-pointer"
                    >
                      <span>Inspect skipped statements</span>
                      <span className="px-2 py-0.5 rounded-full bg-[#1a1a1a] text-[11px] font-mono text-[#8c8c8c]">
                        {batchSummary.errors.length}
                      </span>
                    </button>
                  )}
                </div>
              ) : sqlResult.affected_rows !== undefined && !sqlResult.rows ? (
                /* Non-query execution success (e.g. INSERT / UPDATE / CREATE) */
                <div className="p-8 text-center flex flex-col items-center justify-center gap-3.5 h-full font-sans select-none">
                  <div className="w-11 h-11 rounded-[8px] bg-[#141414] border border-[#222222] flex items-center justify-center">
                    <Check className="w-5 h-5 text-white" />
                  </div>
                  <div className="space-y-1">
                    <div className="font-medium text-white text-[15px] tracking-tight">Statement executed</div>
                    <div className="text-[12px] text-[#8c8c8c] font-mono">
                      {sqlResult.affected_rows} rows affected {sqlDuration !== null && `• ${sqlDuration}ms`}
                    </div>
                  </div>
                </div>
              ) : resultRows.length === 0 ? (
                <div className="flex items-center justify-center h-full text-[#777777] text-[13px]">
                  {searchFilter ? 'No rows match search filter' : 'Zero rows returned'}
                </div>
              ) : (
                /* ─── High Performance Data Results Grid (Matching TableGridView) ─── */
                <table
                  className="border-collapse text-left select-text font-sans text-[14px] table-fixed"
                  style={{ width: 'max-content' }}
                >
                  <thead className="sticky top-0 z-10 bg-[#0a0a0a] border-b border-[#222222]">
                    <tr>
                      {/* Row Index Sticky Column */}
                      <th
                        className="w-14 px-3 py-2 text-left bg-[#0a0a0a] sticky left-0 z-20 border-r border-[#1a1a1a] select-none"
                        style={{ width: '56px', minWidth: '56px', maxWidth: '56px' }}
                      >
                        <span className="text-[#555555] text-[12px] font-mono">#</span>
                      </th>

                      {/* Dynamic Columns with Type-Aware Widths and Interactive Resizers */}
                      {resultCols.map((col) => {
                        const colType = getColType(col);
                        const badge = getColumnTypeBadge(colType, false, false);
                        const width = getColWidth(col);

                        return (
                          <th
                            key={col}
                            className="relative px-3 py-2 text-[14px] font-medium text-[#cccccc] whitespace-nowrap border-r border-[#1a1a1a] select-none group/colheader"
                            style={{ width: `${width}px`, minWidth: `${Math.max(80, width)}px`, maxWidth: `${width}px` }}
                          >
                            <div className="flex items-center justify-between w-full h-full min-w-0 pr-1 overflow-hidden whitespace-nowrap">
                              <div className="flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap truncate">
                                <span className="font-sans text-white text-[14px] font-semibold whitespace-nowrap shrink-0" title={col}>
                                  {col}
                                </span>
                                <span className={`text-[12.5px] font-mono whitespace-nowrap shrink-0 ${badge.color}`}>
                                  {formatColumnType(colType)}
                                </span>
                              </div>
                            </div>

                            {/* Interactive Column Resize Handle */}
                            <div
                              onMouseDown={(e) => handleResizeStart(e, col, width)}
                              title="Drag to resize column"
                              className="absolute -right-1.5 top-0 bottom-0 w-3 cursor-col-resize group/resizer flex items-center justify-center select-none z-20 hover:bg-blue-500/10 active:bg-blue-500/25"
                            >
                              <div className="w-[2px] h-full bg-transparent group-hover/resizer:bg-blue-500 group-active/resizer:bg-blue-500 transition-colors" />
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-[#181818]">
                    {resultRows.map((row, rowIdx) => (
                      <tr
                        key={rowIdx}
                        className="transition-colors hover:bg-[#121212] group cursor-default"
                      >
                        {/* Row Index Sticky Column */}
                        <td
                          className="px-3 py-2 text-left select-none sticky left-0 z-10 border-r border-[#1a1a1a] bg-[#0a0a0a] group-hover:bg-[#121212] text-[#555555] font-mono text-[11.5px]"
                          style={{ width: '56px', minWidth: '56px', maxWidth: '56px' }}
                        >
                          {rowIdx + 1}
                        </td>

                        {/* Dynamic Cells matching Column Widths & TableGridView design */}
                        {resultCols.map((col) => {
                          const width = getColWidth(col);
                          const val = row[col];
                          const isNull = val === null || val === undefined;
                          const isBool = typeof val === 'boolean';
                          const isObj = typeof val === 'object' && val !== null;
                          const strVal = isNull ? 'null' : isObj ? JSON.stringify(val) : String(val);

                          return (
                            <td
                              key={col}
                              className="px-3 py-2 text-[#cccccc] text-[14px] whitespace-nowrap overflow-hidden border-r border-[#151515] relative transition-colors select-text font-sans"
                              style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
                              title={strVal}
                            >
                              {isNull ? (
                                <span className="font-sans text-[#555555] italic text-[13px]">null</span>
                              ) : isBool ? (
                                <span className="font-sans text-[13.5px] text-[#cccccc]">
                                  {String(val)}
                                </span>
                              ) : isObj ? (
                                <span className="font-sans text-[13.5px] text-[#cccccc] truncate block w-full">
                                  {JSON.stringify(val)}
                                </span>
                              ) : (
                                <span className="font-sans text-[13.5px] truncate block w-full">{strVal}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
