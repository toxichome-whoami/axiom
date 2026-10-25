/*
 * Custom hook for Row Inspector selection, drawer panel state, and Row CRUD mutations.
 * Owned by: ui/pages/table
 * Key deps: react, ../../api/client, ../../types
 */

import { useState } from "react";
import { api } from "../../api/client";
import { ColumnInfoApi } from "../../types";
import { showAlertDialog } from "../../components/ui/AlertDialog";

export interface UseRowOperationsProps {
  selectedDb: string;
  selectedTable: string;
  columns: ColumnInfoApi[];
  rows: Record<string, unknown>[];
  cursor: string | null;
  loadTableData: (options?: {
    targetCursor?: string | null;
    reloadSchema?: boolean;
  }) => Promise<void>;
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
  const [inspectorTab, setInspectorTab] = useState<"details" | "danger">(
    "details",
  );
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(
    new Set(),
  );
  const [rowEditValues, setRowEditValues] = useState<Record<string, unknown>>(
    {},
  );
  const [isSavingRow, setIsSavingRow] = useState(false);
  const [isInsertModeInPanel, setIsInsertModeInPanel] = useState(false);

  // Delete Row State
  const [deleteRowTarget, setDeleteRowTarget] = useState<Record<
    string,
    unknown
  > | null>(null);
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

  function coerceColumnValue(val: unknown, colType: string): unknown {
    if (val === null || val === undefined) return null;
    const ty = colType.toLowerCase();
    const isInt = ty.includes("int") || ty.includes("serial");
    const isFloat =
      ty.includes("float") ||
      ty.includes("double") ||
      ty.includes("real") ||
      ty.includes("numeric") ||
      ty.includes("decimal");
    const isBool = ty.includes("bool");

    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed === "") return null;
      if (isInt) {
        const num = Number(trimmed);
        if (!isNaN(num) && Number.isInteger(num)) return num;
      } else if (isFloat) {
        const num = Number(trimmed);
        if (!isNaN(num)) return num;
      } else if (isBool) {
        if (trimmed.toLowerCase() === "true") return true;
        if (trimmed.toLowerCase() === "false") return false;
      }
    }
    return val;
  }

  const handleSaveRowEdit = async () => {
    if (!selectedDb || !selectedTable || selectedRowIndex === null) return;
    const originalRow = rows[selectedRowIndex];
    if (!originalRow) return;

    setIsSavingRow(true);
    try {
      const pkCol = columns.find((c) => c.primary_key);
      const filter: Record<string, unknown> = {};

      if (pkCol && originalRow[pkCol.name] !== undefined) {
        filter[pkCol.name] = {
          eq: coerceColumnValue(originalRow[pkCol.name], pkCol.type),
        };
      } else {
        let count = 0;
        Object.entries(originalRow).forEach(([k, v]) => {
          if (count < 2 && v !== null && v !== undefined) {
            const colDef = columns.find((c) => c.name === k);
            filter[k] = { eq: colDef ? coerceColumnValue(v, colDef.type) : v };
            count++;
          }
        });
      }

      const updates: Record<string, unknown> = {};
      columns.forEach((col) => {
        const val = rowEditValues[col.name];
        if (val !== originalRow[col.name]) {
          updates[col.name] = coerceColumnValue(val, col.type);
        }
      });

      if (Object.keys(updates).length > 0) {
        await api.updateTableRow(selectedDb, selectedTable, filter, updates);
        setIsDetailsOpen(false);
        setIsInsertModeInPanel(false);
        setSelectedRowIndex(null);
        setRowEditValues({});
        await loadTableData({ targetCursor: cursor, reloadSchema: false });
      } else {
        setIsDetailsOpen(false);
        setIsInsertModeInPanel(false);
        setSelectedRowIndex(null);
        setRowEditValues({});
      }
    } catch (err) {
      showAlertDialog(
        err instanceof Error ? err.message : "Failed to update row",
        "Failed to Update Row",
      );
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
        if (val !== undefined && val !== "" && val !== null) {
          payload[col.name] = coerceColumnValue(val, col.type);
        }
      });

      await api.insertTableRow(selectedDb, selectedTable, payload);
      setIsInsertModeInPanel(false);
      setIsDetailsOpen(false);
      setSelectedRowIndex(null);
      setRowEditValues({});
      await loadTableData({ reloadSchema: false });
    } catch (err) {
      showAlertDialog(
        err instanceof Error ? err.message : "Failed to insert row",
        "Failed to Insert Row",
      );
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
        filter[pkCol.name] = {
          eq: coerceColumnValue(deleteRowTarget[pkCol.name], pkCol.type),
        };
      } else {
        let count = 0;
        Object.entries(deleteRowTarget).forEach(([k, v]) => {
          if (count < 2 && v !== null && v !== undefined) {
            const colDef = columns.find((c) => c.name === k);
            filter[k] = { eq: colDef ? coerceColumnValue(v, colDef.type) : v };
            count++;
          }
        });
      }

      await api.deleteTableRow(selectedDb, selectedTable, filter);
      setDeleteRowTarget(null);
      setSelectedRowIndex(null);
      setIsDetailsOpen(false);
      setRowEditValues({});
      setInspectorTab("details");
      await loadTableData({ targetCursor: cursor, reloadSchema: false });
    } catch (err) {
      showAlertDialog(
        err instanceof Error ? err.message : "Failed to delete row",
        "Failed to Delete Row",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  // Delete Selected Rows (Batch delete)
  const [isDeleteBatchConfirmOpen, setIsDeleteBatchConfirmOpen] =
    useState(false);
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
      showAlertDialog(
        err instanceof Error ? err.message : "Failed to delete selected rows",
        "Failed to Delete Selected Rows",
      );
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
