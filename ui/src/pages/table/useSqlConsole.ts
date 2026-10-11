/*
 * Custom hook for SQL console state, chunk-based multi-statement execution, and progress tracking.
 * Features:
 * - Intelligent SQL statement splitter (handles comments, quotes, dollar quotes)
 * - Sequential chunk execution for large scripts (like Neon / Supabase)
 * - Live progress percentage, statement counter, and current snippet
 * - Interactive abort/cancel control
 * - Aggregated batch execution metrics (statements, affected rows, duration)
 * Owned by: ui/pages/table
 * Key deps: react, ../../api/client, ../../types
 */

import { useState, useRef } from 'react';
import { api } from '../../api/client';
import { QueryResultApi } from '../../types';

export interface ChunkProgress {
  total: number;
  current: number;
  snippet: string;
  completedCount: number;
  totalAffectedRows: number;
  percent: number;
}

export interface BatchSummary {
  totalStatements: number;
  successful: number;
  totalAffectedRows: number;
  durationMs: number;
}

export interface UseSqlConsoleProps {
  selectedDb: string;
}

/**
 * Robust SQL statement splitter that splits queries by semicolon while respecting:
 * - Single-quoted strings ('...') and escape quotes ('')
 * - Double-quoted identifiers ("...")
 * - Single-line comments (-- ...)
 * - Multi-line comments (/* ... * /)
 * - PostgreSQL dollar-quoted blocks ($$...$$ or $tag$...$tag$)
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarQuoteTag: string | null = null;

  const len = sql.length;
  let i = 0;

  while (i < len) {
    const char = sql[i];
    const nextChar = i + 1 < len ? sql[i + 1] : '';

    // Handle line comments
    if (inLineComment) {
      current += char;
      if (char === '\n') {
        inLineComment = false;
      }
      i++;
      continue;
    }

    // Handle block comments
    if (inBlockComment) {
      current += char;
      if (char === '*' && nextChar === '/') {
        current += nextChar;
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // Handle dollar quotes (Postgres functions/triggers: $$ or $tag$)
    if (dollarQuoteTag !== null) {
      current += char;
      if (char === '$' && sql.startsWith(dollarQuoteTag, i)) {
        current += dollarQuoteTag.slice(1);
        i += dollarQuoteTag.length;
        dollarQuoteTag = null;
        continue;
      }
      i++;
      continue;
    }

    // Handle single quote string literal
    if (inSingleQuote) {
      current += char;
      if (char === "'") {
        if (nextChar === "'") {
          current += nextChar;
          i += 2;
          continue;
        } else {
          inSingleQuote = false;
        }
      }
      i++;
      continue;
    }

    // Handle double quote identifier
    if (inDoubleQuote) {
      current += char;
      if (char === '"') {
        inDoubleQuote = false;
      }
      i++;
      continue;
    }

    // Check for comment starts
    if (char === '-' && nextChar === '-') {
      inLineComment = true;
      current += char + nextChar;
      i += 2;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      current += char + nextChar;
      i += 2;
      continue;
    }

    // Check for dollar quote start in Postgres ($tag$ or $$)
    if (char === '$') {
      const match = sql.slice(i).match(/^(\$[a-zA-Z0-9_]*\$)/);
      if (match) {
        dollarQuoteTag = match[1];
        current += dollarQuoteTag;
        i += dollarQuoteTag.length;
        continue;
      }
    }

    // Check for string / identifier quote starts
    if (char === "'") {
      inSingleQuote = true;
      current += char;
      i++;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      current += char;
      i++;
      continue;
    }

    // Semicolon statement boundary
    if (char === ';') {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
      i++;
      continue;
    }

    current += char;
    i++;
  }

  const finalTrimmed = current.trim();
  if (finalTrimmed) {
    statements.push(finalTrimmed);
  }

  // Filter out comments-only blocks and standalone transaction control markers (BEGIN/COMMIT)
  const cleaned: string[] = [];
  for (const stmt of statements) {
    const withoutComments = stripComments(stmt);
    if (!withoutComments) continue;
    const upper = withoutComments.replace(/\s+/g, ' ').toUpperCase();
    if (
      upper === 'BEGIN' ||
      upper === 'BEGIN;' ||
      upper === 'BEGIN TRANSACTION' ||
      upper === 'COMMIT' ||
      upper === 'COMMIT;' ||
      upper === 'END' ||
      upper === 'END;'
    ) {
      continue;
    }
    cleaned.push(withoutComments);
  }
  return cleaned;
}

export function stripComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
}

export function useSqlConsole({ selectedDb }: UseSqlConsoleProps) {
  const [sqlQuery, setSqlQuery] = useState('');
  const [isExecutingSql, setIsExecutingSql] = useState(false);
  const [sqlResult, setSqlResult] = useState<QueryResultApi | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlDuration, setSqlDuration] = useState<number | null>(null);
  const [chunkProgress, setChunkProgress] = useState<ChunkProgress | null>(null);
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);

  const abortControllerRef = useRef<boolean>(false);

  const handleCancelSql = () => {
    abortControllerRef.current = true;
  };

  const handleExecuteSql = async () => {
    if (!selectedDb || !sqlQuery.trim()) return;

    abortControllerRef.current = false;
    setIsExecutingSql(true);
    setSqlError(null);
    setSqlResult(null);
    setChunkProgress(null);
    setBatchSummary(null);

    const startTime = performance.now();
    const rawSql = sqlQuery.trim();
    const statements = splitSqlStatements(rawSql);

    // Case 1: Single statement - execute directly
    if (statements.length <= 1) {
      try {
        const queryToRun = statements[0] || rawSql;
        const res = await api.executeSqlQuery(selectedDb, queryToRun);
        const duration = Math.round(performance.now() - startTime);
        setSqlDuration(duration);
        setSqlResult(res);
      } catch (err) {
        setSqlError(err instanceof Error ? err.message : 'SQL Execution failed');
      } finally {
        setIsExecutingSql(false);
      }
      return;
    }

    // Case 2: Multi-statement batch - chunk execution (Neon / Supabase pattern)
    let totalAffected = 0;
    let lastResult: QueryResultApi | null = null;
    let executedCount = 0;

    for (let idx = 0; idx < statements.length; idx++) {
      if (abortControllerRef.current) {
        setSqlError(`Execution stopped by user after ${executedCount} of ${statements.length} statements.`);
        break;
      }

      const stmt = statements[idx];
      const previewSnippet = stmt.replace(/\s+/g, ' ').slice(0, 60);

      setChunkProgress({
        total: statements.length,
        current: idx + 1,
        snippet: previewSnippet,
        completedCount: executedCount,
        totalAffectedRows: totalAffected,
        percent: Math.round(((idx) / statements.length) * 100),
      });

      try {
        const res = await api.executeSqlQuery(selectedDb, stmt);
        executedCount++;
        if (res?.affected_rows) {
          totalAffected += res.affected_rows;
        }
        lastResult = res;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        setSqlError(
          `Failed at statement ${idx + 1} of ${statements.length}:\n${errMsg}\n\nStatement:\n${stmt.slice(0, 300)}`
        );
        break;
      }
    }

    const duration = Math.round(performance.now() - startTime);
    setSqlDuration(duration);

    if (executedCount === statements.length) {
      setBatchSummary({
        totalStatements: statements.length,
        successful: executedCount,
        totalAffectedRows: totalAffected,
        durationMs: duration,
      });

      // If the last statement returned rows (e.g. a SELECT), present it
      if (lastResult?.rows && lastResult.rows.length > 0) {
        setSqlResult(lastResult);
      } else {
        setSqlResult({
          affected_rows: totalAffected,
          duration_ms: duration,
        });
      }
    }

    setIsExecutingSql(false);
    setChunkProgress(null);
  };

  return {
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
  };
}
