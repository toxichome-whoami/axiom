/*
 * Custom hook for Row Inspector selection, drawer panel state, and Row CRUD mutations.
 * Owned by: ui/pages/table
 * Key deps: react, ../../api/client, ../../types
 */

import { useState } from 'react';
import { api } from '../../api/client';
import { ColumnInfoApi } from '../../types';

export interface UseRowOperationsProps {
  selectedDb: string;
  selectedTable: string;
  columns: ColumnInfoApi[];
  rows: Record<string, unknown>[];
  cursor: string | null;
  loadTableData: (options?: { targetCursor?: string | null; reloadSchema?: boolean }) => Promise<void>;
}

export function useRowOperations({
  selectedDb,
  selectedTable,
  columns,
  rows,
  cursor,
  loadTableData,
}: UseRowOperationsProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'details' | 'danger'>('details');
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
  const [rowEditValues, setRowEditValues] = useState<Record<string, unknown>>({});
  const [isSavingRow, setIsSavingRow] = useState(false);
  const [isInsertModeInPanel, setIsInsertModeInPanel] = useState(false);

  // Delete Row State
  const [deleteRowTarget, setDeleteRowTarget] = useState<Record<string, unknown> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSelectRow = (index: number, openDrawer = false) => {
    setSelectedRowIndex(index);
    setIsInsertModeInPanel(false);
    if (openDrawer) {
      setIsDetailsOpen(true);
    }
    if (rows[index]) {
      setRowEditValues({ ...rows[index] });
    }
  };

  const handleToggleRowSelect = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setSelectedRowIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleToggleAllRows = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (selectedRowIndices.size === rows.length && rows.length > 0) {
      setSelectedRowIndices(new Set());
    } else {
      setSelectedRowIndices(new Set(rows.map((_, i) => i)));
    }
  };

  const handleSaveRowEdit = async () => {
    if (!selectedDb || !selectedTable || selectedRowIndex === null) return;
    const originalRow = rows[selectedRowIndex];
    if (!originalRow) return;

    setIsSavingRow(true);
    try {
      const pkCol = columns.find((c) => c.primary_key);
      const filter: Record<string, unknown> = {};

      if (pkCol && originalRow[pkCol.name] !== undefined) {
        filter[pkCol.name] = { eq: originalRow[pkCol.name] };
      } else {
        let count = 0;
        Object.entries(originalRow).forEach(([k, v]) => {
          if (count < 2 && v !== null && v !== undefined) {
            filter[k] = { eq: v };
            count++;
          }
        });
      }

      const updates: Record<string, unknown> = {};
      columns.forEach((col) => {
        const val = rowEditValues[col.name];
        if (val !== originalRow[col.name]) {
          updates[col.name] = val;
        }
      });

      if (Object.keys(updates).length > 0) {
        await api.updateTableRow(selectedDb, selectedTable, filter, updates);
        await loadTableData({ targetCursor: cursor, reloadSchema: false });
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update row');
    } finally {
      setIsSavingRow(false);
    }
  };

  const handleInsertRowFromPanel = async () => {
    if (!selectedDb || !selectedTable) return;

    setIsSavingRow(true);
    try {
      const payload: Record<string, unknown> = {};
      columns.forEach((col) => {
        const val = rowEditValues[col.name];
        if (val !== undefined && val !== '') {
          payload[col.name] = val;
        }
      });

      await api.insertTableRow(selectedDb, selectedTable, payload);
      setIsInsertModeInPanel(false);
      await loadTableData({ reloadSchema: false });
      setSelectedRowIndex(0);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to insert row');
    } finally {
      setIsSavingRow(false);
    }
  };

  const handleDeleteRow = async () => {
    if (!selectedDb || !selectedTable || !deleteRowTarget) return;

    setIsDeleting(true);
    try {
      const pkCol = columns.find((c) => c.primary_key);
      const filter: Record<string, unknown> = {};

      if (pkCol && deleteRowTarget[pkCol.name] !== undefined) {
        filter[pkCol.name] = { eq: deleteRowTarget[pkCol.name] };
      } else {
        let count = 0;
        Object.entries(deleteRowTarget).forEach(([k, v]) => {
          if (count < 2 && v !== null && v !== undefined) {
            filter[k] = { eq: v };
            count++;
          }
        });
      }

      await api.deleteTableRow(selectedDb, selectedTable, filter);
      setDeleteRowTarget(null);
      setSelectedRowIndex(null);
      loadTableData({ targetCursor: cursor, reloadSchema: false });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete row');
    } finally {
      setIsDeleting(false);
    }
  };

  // Delete Selected Rows (Batch delete)
  const [isDeleteBatchConfirmOpen, setIsDeleteBatchConfirmOpen] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  const handleDeleteSelectedRows = async () => {
    if (!selectedDb || !selectedTable || selectedRowIndices.size === 0) return;

    setIsBatchDeleting(true);
    try {
      const pkCol = columns.find((c) => c.primary_key);
      const selectedRows = Array.from(selectedRowIndices)
        .map((idx) => rows[idx])
        .filter(Boolean);

      if (pkCol) {
        const pkValues = selectedRows
          .map((r) => r[pkCol.name])
          .filter((v) => v !== undefined && v !== null);

        if (pkValues.length > 0) {
          await api.deleteTableRow(selectedDb, selectedTable, {
            [pkCol.name]: { in: pkValues },
          });
        }
      } else {
        // Fallback: delete rows sequentially when no primary key is defined
        for (const row of selectedRows) {
          const filter: Record<string, unknown> = {};
          let count = 0;
          Object.entries(row).forEach(([k, v]) => {
            if (count < 2 && v !== null && v !== undefined) {
              filter[k] = { eq: v };
              count++;
            }
          });
          if (Object.keys(filter).length > 0) {
            await api.deleteTableRow(selectedDb, selectedTable, filter);
          }
        }
      }

      setIsDeleteBatchConfirmOpen(false);
      setSelectedRowIndices(new Set());
      setSelectedRowIndex(null);
      await loadTableData({ targetCursor: cursor, reloadSchema: false });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete selected rows');
    } finally {
      setIsBatchDeleting(false);
    }
  };

  return {
    isDetailsOpen,
    setIsDetailsOpen,
    inspectorTab,
    setInspectorTab,
    selectedRowIndex,
    setSelectedRowIndex,
    selectedRowIndices,
    setSelectedRowIndices,
    rowEditValues,
    setRowEditValues,
    isSavingRow,
    isInsertModeInPanel,
    setIsInsertModeInPanel,
    deleteRowTarget,
    setDeleteRowTarget,
    isDeleting,
    isDeleteBatchConfirmOpen,
    setIsDeleteBatchConfirmOpen,
    isBatchDeleting,
    handleSelectRow,
    handleToggleRowSelect,
    handleToggleAllRows,
    handleSaveRowEdit,
    handleInsertRowFromPanel,
    handleDeleteRow,
    handleDeleteSelectedRows,
  };
}
