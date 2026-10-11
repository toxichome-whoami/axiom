/*
 * Custom hook for SQL console state and query execution.
 * Owned by: ui/pages/table
 * Key deps: react, ../../api/client, ../../types
 */

import { useState } from 'react';
import { api } from '../../api/client';
import { QueryResultApi } from '../../types';

export interface UseSqlConsoleProps {
  selectedDb: string;
}

export function useSqlConsole({ selectedDb }: UseSqlConsoleProps) {
  const [sqlQuery, setSqlQuery] = useState('');
  const [isExecutingSql, setIsExecutingSql] = useState(false);
  const [sqlResult, setSqlResult] = useState<QueryResultApi | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlDuration, setSqlDuration] = useState<number | null>(null);

  const handleExecuteSql = async () => {
    if (!selectedDb || !sqlQuery.trim()) return;

    setIsExecutingSql(true);
    setSqlError(null);
    setSqlResult(null);

    const startTime = performance.now();
    try {
      const res = await api.executeSqlQuery(selectedDb, sqlQuery.trim());
      const duration = Math.round(performance.now() - startTime);
      setSqlDuration(duration);
      setSqlResult(res);
    } catch (err) {
      setSqlError(err instanceof Error ? err.message : 'SQL Execution failed');
    } finally {
      setIsExecutingSql(false);
    }
  };

  return {
    sqlQuery,
    setSqlQuery,
    isExecutingSql,
    sqlResult,
    sqlError,
    sqlDuration,
    handleExecuteSql,
  };
}
