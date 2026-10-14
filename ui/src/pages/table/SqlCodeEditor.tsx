/*
 * VS Code-styled SQL Editor with real-time Syntax Highlighting,
 * Line Numbers, Gutter Highlights, and Intelligent Autocomplete (IntelliSense).
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../types
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Table as TableIcon, Columns, Hash, Code } from 'lucide-react';
import { ColumnInfoApi, TableInfoApi } from '../../types';

export interface SqlCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
  tables?: TableInfoApi[];
  allDbTablesSchema?: Record<string, { columns: ColumnInfoApi[]; foreign_keys?: unknown[] }>;
  selectedDb?: string;
  selectedTable?: string;
  isExecuting?: boolean;
}

// SQL Keywords for syntax highlighting & autocomplete
export const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'ILIKE',
  'BETWEEN', 'EXISTS', 'AS', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL',
  'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'ASC', 'DESC', 'INSERT INTO',
  'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
  'CREATE INDEX', 'DROP INDEX', 'TRUNCATE TABLE', 'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES',
  'DEFAULT', 'CHECK', 'UNIQUE', 'CONSTRAINT', 'CASCADE', 'RESTRICT', 'UNION', 'UNION ALL',
  'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH', 'RECURSIVE', 'TRUE', 'FALSE',
];

const SQL_FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'CONCAT', 'SUBSTRING',
  'LOWER', 'UPPER', 'TRIM', 'LENGTH', 'NOW', 'CURRENT_TIMESTAMP', 'CURRENT_DATE',
  'CURRENT_TIME', 'DATE', 'ROUND', 'FLOOR', 'CEIL', 'ABS', 'CAST', 'JSON_AGG', 'JSON_BUILD_OBJECT',
];

const SQL_TYPES = [
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'SERIAL', 'BIGSERIAL', 'VARCHAR', 'CHAR',
  'TEXT', 'BOOLEAN', 'BOOL', 'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'NUMERIC',
  'DECIMAL', 'REAL', 'FLOAT', 'DOUBLE', 'JSON', 'JSONB', 'UUID', 'BYTEA', 'BLOB',
];

interface CompletionItem {
  label: string;
  kind: 'keyword' | 'function' | 'table' | 'column' | 'type';
  detail: string;
}

export function SqlCodeEditor({
  value,
  onChange,
  onExecute,
  tables = [],
  allDbTablesSchema = {},
  selectedDb = 'default',
  selectedTable = '',
  isExecuting = false,
}: SqlCodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [activeLine, setActiveLine] = useState(1);

  // IntelliSense Autocomplete State
  const [suggestions, setSuggestions] = useState<CompletionItem[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [completionCoords, setCompletionCoords] = useState({ top: 0, left: 0 });
  const [userHasNavigated, setUserHasNavigated] = useState(false);
  const [activeWordLength, setActiveWordLength] = useState(0);

  // Dismiss suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-scroll selected suggestion into view
  useEffect(() => {
    if (showSuggestions && listRef.current) {
      const selectedEl = listRef.current.children[selectedSuggestionIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedSuggestionIndex, showSuggestions]);

  // Extract all available column names from cached schemas, prioritizing active table
  const allKnownColumns = useMemo(() => {
    const activeCols: CompletionItem[] = [];
    const otherCols = new Map<string, string>();

    // 1. Current selected table columns first
    if (selectedTable && allDbTablesSchema[selectedTable]?.columns) {
      allDbTablesSchema[selectedTable].columns.forEach((c) => {
        activeCols.push({
          label: c.name,
          kind: 'column' as const,
          detail: `${selectedTable}.${c.name} (${c.type})`,
        });
      });
    }

    // 2. All other columns
    Object.entries(allDbTablesSchema).forEach(([tbl, data]) => {
      if (tbl === selectedTable) return;
      (data.columns || []).forEach((c) => {
        if (!otherCols.has(c.name)) {
          otherCols.set(c.name, `${tbl}.${c.name} (${c.type})`);
        }
      });
    });

    const otherList: CompletionItem[] = Array.from(otherCols.entries()).map(([name, detail]) => ({
      label: name,
      kind: 'column' as const,
      detail,
    }));

    return [...activeCols, ...otherList];
  }, [allDbTablesSchema, selectedTable]);

  // All available table suggestions
  const tableSuggestions = useMemo(() => {
    return tables.map((t) => ({
      label: t.name,
      kind: 'table' as const,
      detail: 'Table',
    }));
  }, [tables]);

  // Base suggestions (keywords + functions + types)
  const baseSuggestions = useMemo<CompletionItem[]>(() => {
    return [
      ...SQL_KEYWORDS.map((k) => ({ label: k, kind: 'keyword' as const, detail: 'Keyword' })),
      ...SQL_FUNCTIONS.map((f) => ({ label: f, kind: 'function' as const, detail: 'Function' })),
      ...SQL_TYPES.map((t) => ({ label: t, kind: 'type' as const, detail: 'Type' })),
    ];
  }, []);

  // Update active line for gutter highlighting
  const updateCursorInfo = useCallback((currentVal?: string, currentPos?: number) => {
    if (!textareaRef.current) return;
    const val = currentVal ?? textareaRef.current.value;
    const pos = currentPos ?? textareaRef.current.selectionStart ?? 0;
    const textBefore = val.slice(0, pos);
    const lines = textBefore.split('\n');
    setActiveLine(lines.length);
  }, []);

  // Sync scrolling between textarea, highlight overlay, and line numbers gutter
  const handleScroll = () => {
    if (!textareaRef.current) return;
    const { scrollTop, scrollLeft } = textareaRef.current;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = scrollTop;
      highlightRef.current.scrollLeft = scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop;
    }
    setShowSuggestions(false);
  };

  // Synchronous, robust autocomplete trigger
  const triggerAutocomplete = useCallback(
    (currentVal: string, cursorPos: number, forceOpen = false) => {
      if (!textareaRef.current) return;
      const textBefore = currentVal.slice(0, cursorPos);

      // Don't trigger inside comments (-- ...) or strings ('...')
      const lastLine = textBefore.split('\n').pop() || '';
      if (lastLine.includes('--')) {
        setShowSuggestions(false);
        return;
      }
      const quoteCount = (textBefore.match(/'/g) || []).length;
      if (quoteCount % 2 === 1) {
        setShowSuggestions(false);
        return;
      }

      // 1. Check for dot completion: "tableName.col"
      const dotMatch = textBefore.match(/([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]*)$/);
      let query = '';
      let candidates: CompletionItem[] = [];

      if (dotMatch) {
        const tblName = dotMatch[1].toLowerCase();
        const colPrefix = dotMatch[2].toLowerCase();
        query = colPrefix;
        setActiveWordLength(colPrefix.length);

        // Find table columns in schema
        const targetTable = Object.entries(allDbTablesSchema).find(
          ([t]) => t.toLowerCase() === tblName
        );
        if (targetTable && targetTable[1].columns) {
          candidates = targetTable[1].columns.map((c) => ({
            label: c.name,
            kind: 'column' as const,
            detail: `${c.type}${c.primary_key ? ' • PK' : ''}`,
          }));
        }
      } else {
        // 2. Standard word completion
        const wordMatch = textBefore.match(/([a-zA-Z0-9_]+)$/);
        if (!wordMatch) {
          setShowSuggestions(false);
          return;
        }

        const word = wordMatch[1];
        query = word.toLowerCase();
        setActiveWordLength(word.length);

        // Don't auto-open on 1 character unless forced with Ctrl+Space
        if (word.length < 2 && !forceOpen) {
          setShowSuggestions(false);
          return;
        }

        candidates = [
          ...tableSuggestions,
          ...allKnownColumns,
          ...baseSuggestions,
        ];
      }

      // Filter and deduplicate candidates
      const seen = new Set<string>();
      const filtered: CompletionItem[] = [];

      for (const item of candidates) {
        const itemLower = item.label.toLowerCase();
        if (itemLower.startsWith(query) && !seen.has(itemLower)) {
          seen.add(itemLower);
          filtered.push(item);
          if (filtered.length >= 10) break;
        }
      }

      if (filtered.length > 0) {
        setSuggestions(filtered);
        setSelectedSuggestionIndex(0);
        setUserHasNavigated(false);

        // Calculate bounded cursor coordinates
        const textLines = textBefore.split('\n');
        const lineIdx = textLines.length - 1;
        const colIdx = (textLines[lineIdx] || '').length;

        const lineHeight = 20;
        const charWidth = 7.8;
        const scrollTop = textareaRef.current.scrollTop || 0;
        const scrollLeft = textareaRef.current.scrollLeft || 0;

        const cursorTop = 12 + lineIdx * lineHeight - scrollTop;
        const cursorLeft = 14 + colIdx * charWidth - scrollLeft;

        const containerRect = textareaRef.current.getBoundingClientRect();
        const containerHeight = containerRect.height || 400;
        const containerWidth = containerRect.width || 600;

        const popupHeight = 220;
        const popupWidth = 280;

        let top = cursorTop + lineHeight + 4;
        if (top + popupHeight > containerHeight && cursorTop > popupHeight) {
          top = Math.max(8, cursorTop - popupHeight - 4);
        }

        const left = Math.max(8, Math.min(cursorLeft, containerWidth - popupWidth - 12));

        setCompletionCoords({ top, left });
        setShowSuggestions(true);
      } else {
        setShowSuggestions(false);
      }
    },
    [allDbTablesSchema, tableSuggestions, allKnownColumns, baseSuggestions]
  );

  // Bulletproof suggestion application: replaces exact prefix in DOM value
  const applySuggestion = (suggestion: CompletionItem) => {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    const pos = el.selectionStart || 0;
    const currentVal = el.value;
    const textBefore = currentVal.slice(0, pos);
    const textAfter = currentVal.slice(pos);

    // Check if replacing after dot
    const dotMatch = textBefore.match(/([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]*)$/);
    let replacedBefore = '';

    if (dotMatch && suggestion.kind === 'column') {
      const colPrefix = dotMatch[2];
      replacedBefore = textBefore.slice(0, textBefore.length - colPrefix.length) + suggestion.label;
    } else {
      const wordMatch = textBefore.match(/([a-zA-Z0-9_]+)$/);
      const prefix = wordMatch ? wordMatch[1] : '';
      replacedBefore = textBefore.slice(0, textBefore.length - prefix.length) + suggestion.label;
    }

    // Strip any trailing word characters right after cursor so word isn't duplicated
    const matchAfter = textAfter.match(/^[a-zA-Z0-9_]+/);
    const remainderAfter = matchAfter ? textAfter.slice(matchAfter[0].length) : textAfter;

    const newVal = replacedBefore + remainderAfter;
    onChange(newVal);
    setShowSuggestions(false);

    // Position cursor immediately after inserted word
    const nextCursorPos = replacedBefore.length;
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(nextCursorPos, nextCursorPos);
        updateCursorInfo(newVal, nextCursorPos);
      }
    });
  };

  // Keyboard controls: Autocomplete navigation, indentation, execution
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 0. Ctrl+Enter or Cmd+Enter to execute query (always highest priority)
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      setShowSuggestions(false);
      onExecute();
      return;
    }

    // 1. Manual autocomplete trigger: Ctrl+Space or Cmd+Space
    if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
      e.preventDefault();
      if (textareaRef.current) {
        triggerAutocomplete(textareaRef.current.value, textareaRef.current.selectionStart, true);
      }
      return;
    }

    // 2. If suggestions open, navigate or accept
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex((prev) => (prev + 1) % suggestions.length);
        setUserHasNavigated(true);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        setUserHasNavigated(true);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestions[selectedSuggestionIndex]);
        return;
      }
      if (e.key === 'Enter') {
        // Accept on Enter ONLY if user actively navigated candidates
        if (userHasNavigated) {
          e.preventDefault();
          applySuggestion(suggestions[selectedSuggestionIndex]);
          return;
        } else {
          // Allow normal line break without hijacking
          setShowSuggestions(false);
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
    }

    // 3. Tab key indents with 2 spaces (when suggestions closed)
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!textareaRef.current) return;
      const start = textareaRef.current.selectionStart;
      const end = textareaRef.current.selectionEnd;

      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      onChange(newValue);

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
          updateCursorInfo(newValue, start + 2);
        }
      }, 0);
      return;
    }

    // 4. Ctrl+/ to toggle comment
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      if (!textareaRef.current) return;
      const pos = textareaRef.current.selectionStart;
      const lines = value.split('\n');
      let count = 0;
      let targetIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        count += lines[i].length + 1;
        if (count > pos) {
          targetIdx = i;
          break;
        }
      }

      if (lines[targetIdx].trimStart().startsWith('--')) {
        lines[targetIdx] = lines[targetIdx].replace(/^(\s*)--\s?/, '$1');
      } else {
        lines[targetIdx] = '-- ' + lines[targetIdx];
      }
      const updated = lines.join('\n');
      onChange(updated);
      return;
    }
  };

  // Syntax Highlighting Tokenizer
  const highlightedCode = useMemo(() => {
    if (!value) return '';

    // Regex tokens
    const tokenRegex = /(--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|\b\d+(?:\.\d+)?\b|\b[a-zA-Z_][a-zA-Z0-9_]*\b|[^\s\w])/g;

    const knownTableSet = new Set(tables.map((t) => t.name.toLowerCase()));
    const knownColSet = new Set(allKnownColumns.map((c) => c.label.toLowerCase()));
    const kwSet = new Set(SQL_KEYWORDS.map((k) => k.toLowerCase()));
    const fnSet = new Set(SQL_FUNCTIONS.map((f) => f.toLowerCase()));
    const typeSet = new Set(SQL_TYPES.map((t) => t.toLowerCase()));

    const escapeHtml = (str: string) =>
      str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return value.replace(tokenRegex, (match) => {
      // 1. Comments (text-[#888888] italic like definition tab)
      if (match.startsWith('--') || match.startsWith('/*')) {
        return `<span style="color: #888888; font-style: italic;">${escapeHtml(match)}</span>`;
      }
      // 2. String literals (text-amber-300 like definition values)
      if (match.startsWith("'")) {
        return `<span style="color: #fcd34d;">${escapeHtml(match)}</span>`;
      }
      // 3. Numbers (text-amber-300 like definition values)
      if (/^\d+(\.\d+)?$/.test(match)) {
        return `<span style="color: #fcd34d;">${match}</span>`;
      }

      const lower = match.toLowerCase();
      // 4. SQL Keywords (text-blue-400 like constraint, foreign key, references in definition tab)
      if (kwSet.has(lower)) {
        return `<span style="color: #60a5fa; font-weight: 500;">${escapeHtml(match)}</span>`;
      }
      // 5. Functions (text-sky-400 / cyan)
      if (fnSet.has(lower)) {
        return `<span style="color: #38bdf8;">${escapeHtml(match)}</span>`;
      }
      // 6. Types (text-[#a371f7] purple like col.type in definition tab)
      if (typeSet.has(lower)) {
        return `<span style="color: #a371f7;">${escapeHtml(match)}</span>`;
      }
      // 7. Table names (text-white like table name in definition tab)
      if (knownTableSet.has(lower)) {
        return `<span style="color: #ffffff; font-weight: 500;">${escapeHtml(match)}</span>`;
      }
      // 8. Column names (text-white like col.name in definition tab)
      if (knownColSet.has(lower)) {
        return `<span style="color: #ffffff;">${escapeHtml(match)}</span>`;
      }

      // 9. Delimiters, punctuation, brackets (text-[#888888])
      if (/^[(),;.*=<>!+\-*/]+$/.test(match)) {
        return `<span style="color: #888888;">${escapeHtml(match)}</span>`;
      }

      return escapeHtml(match);
    });
  }, [value, tables, allKnownColumns]);

  const totalLines = useMemo(() => {
    return Math.max(1, value.split('\n').length);
  }, [value]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0c0c0c] overflow-hidden font-sans relative">
      {/* ─── Editor Canvas (Gutter + Highlighted Code + Input Textarea) ─── */}
      <div className="flex-1 relative flex overflow-hidden min-h-0 bg-[#0c0c0c]">
        {/* Left Gutter: Line Numbers */}
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="w-[52px] shrink-0 bg-[#0c0c0c] border-r border-[#222222] select-none overflow-hidden text-right py-3 pr-3 text-[13px] font-mono text-[#555555] leading-[20px]"
        >
          {Array.from({ length: totalLines }).map((_, i) => {
            const lineNum = i + 1;
            const isCurrent = lineNum === activeLine;
            return (
              <div
                key={lineNum}
                className={`transition-colors ${
                  isCurrent ? 'text-white font-medium' : 'text-[#555555]'
                }`}
              >
                {lineNum}
              </div>
            );
          })}
        </div>

        {/* Editor Body Wrapper */}
        <div className="flex-1 relative overflow-hidden h-full">
          {/* Syntax Highlighted Mirror (Behind textarea) */}
          <pre
            ref={highlightRef}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: highlightedCode + '\n' }}
            className="absolute inset-0 m-0 py-3 px-3.5 bg-transparent font-mono text-[13px] leading-[20px] text-white pointer-events-none whitespace-pre overflow-hidden select-none"
            style={{
              tabSize: 2,
              fontFamily: 'Consolas, Menlo, Monaco, "Courier New", monospace',
            }}
          />

          {/* Transparent Input Textarea (Foreground) */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              const newVal = e.target.value;
              const newPos = e.target.selectionStart;
              onChange(newVal);
              triggerAutocomplete(newVal, newPos);
              updateCursorInfo(newVal, newPos);
            }}
            onScroll={handleScroll}
            onClick={(e) => {
              setShowSuggestions(false);
              updateCursorInfo(e.currentTarget.value, e.currentTarget.selectionStart);
            }}
            onKeyUp={(e) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                setShowSuggestions(false);
              }
              updateCursorInfo(e.currentTarget.value, e.currentTarget.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
            placeholder="-- Write SQL queries here (e.g. SELECT * FROM users;)...&#10;-- Press Ctrl+Enter to execute"
            className="absolute inset-0 m-0 py-3 px-3.5 w-full h-full bg-transparent text-transparent caret-white outline-none resize-none font-mono text-[13px] leading-[20px] whitespace-pre overflow-auto z-10 selection:bg-blue-600/30 selection:text-transparent"
            style={{
              tabSize: 2,
              fontFamily: 'Consolas, Menlo, Monaco, "Courier New", monospace',
            }}
          />

          {/* VS Code IntelliSense Floating Autocomplete Box */}
          {showSuggestions && suggestions.length > 0 && (
            <div
              style={{
                top: `${completionCoords.top}px`,
                left: `${completionCoords.left}px`,
              }}
              className="absolute z-50 min-w-[240px] max-w-[340px] bg-[#141414] border border-[#262626] rounded-[6px] shadow-2xl p-0.5 text-[12.5px] font-mono select-none animate-in fade-in duration-75 overflow-hidden font-sans"
            >
              <div ref={listRef} className="max-h-52 overflow-y-auto space-y-0.5 py-0.5">
                {suggestions.map((item, idx) => {
                  const isSelected = idx === selectedSuggestionIndex;
                  return (
                    <div
                      key={`${item.kind}-${item.label}-${idx}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applySuggestion(item);
                      }}
                      className={`flex items-center justify-between px-2.5 py-1 rounded-[4px] cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[#222222] text-white'
                          : 'text-[#cccccc] hover:bg-[#1a1a1a]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                        {item.kind === 'table' ? (
                          <TableIcon className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
                        ) : item.kind === 'column' ? (
                          <Columns className="w-3.5 h-3.5 text-white shrink-0" />
                        ) : item.kind === 'function' ? (
                          <Hash className="w-3.5 h-3.5 text-[#fcd34d] shrink-0" />
                        ) : item.kind === 'type' ? (
                          <Code className="w-3.5 h-3.5 text-[#a371f7] shrink-0" />
                        ) : (
                          <Code className="w-3.5 h-3.5 text-[#60a5fa] shrink-0" />
                        )}
                        <span className="truncate">{item.label}</span>
                      </div>
                      <span className="text-[10.5px] text-[#777777] shrink-0 font-mono">{item.detail}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
