/*
 * Custom hook for inline cell editing, keyboard navigation, and optimistic persistence.
 * Owned by: ui/pages/table
 * Key deps: react, ../../api/client, ../../types
 */

import { useState, useEffect } from "react";
import { api } from "../../api/client";
import { ColumnInfoApi, ForeignKeyInfoApi } from "../../types";
import { showAlertDialog } from "../../components/ui/AlertDialog";

export interface UseCellEditorProps {
  selectedDb: string;
  selectedTable: string;
  columns: ColumnInfoApi[];
  rows: Record<string, unknown>[];
  setRows: React.Dispatch<React.SetStateAction<Record<string, unknown>[]>>;
  foreignKeys: ForeignKeyInfoApi[];
  selectedRowIndex: number | null;
  setSelectedRowIndex: React.Dispatch<React.SetStateAction<number | null>>;
  setRowEditValues: React.Dispatch<
    React.SetStateAction<Record<string, unknown>>
  >;
  isColReadOnly: (col: ColumnInfoApi) => boolean;
  isDetailsOpen: boolean;
}

export function useCellEditor({
  selectedDb,
  selectedTable,
  columns,
  rows,
  setRows,
  foreignKeys,
  selectedRowIndex,
  setSelectedRowIndex,
  setRowEditValues,
  isColReadOnly,
  isDetailsOpen,
}: UseCellEditorProps) {
  const [selectedCell, setSelectedCell] = useState<{
    rowIndex: number;
    colName: string;
  } | null>(null);
  const [editingCell, setEditingCell] = useState<{
    rowIndex: number;
    colName: string;
    column?: ColumnInfoApi;
    initialValue: unknown;
    currentValue: string;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);
  const [expandedInlineCell, setExpandedInlineCell] = useState<{
    rowIndex: number;
    colName: string;
    value: string;
    initialValue?: string;
  } | null>(null);
  const [fkPickerTarget, setFkPickerTarget] = useState<{
    rowIndex?: number;
    column: string;
    fk: ForeignKeyInfoApi;
    currentValue: unknown;
    onSelect?: (val: unknown) => void;
  } | null>(null);
  const [fkPreviewTarget, setFkPreviewTarget] = useState<{
    fk: ForeignKeyInfoApi;
    currentValue: unknown;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);

  const handleStartCellEdit = (
    rowIndex: number,
    colName: string,
    cellEl: HTMLElement,
  ) => {
    const col = columns.find((c) => c.name === colName);
    if (col && isColReadOnly(col)) return;
    const row = rows[rowIndex];
    if (!row) return;
    const val = row[colName];
    const strVal =
      val === null || val === undefined
        ? ""
        : typeof val === "object"
          ? JSON.stringify(val)
          : String(val);
    const r = cellEl.getBoundingClientRect();
    setEditingCell({
      rowIndex,
      colName,
      column: col,
      initialValue: val,
      currentValue: strVal,
      rect: {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      },
    });
  };

  const handleSaveCellEdit = async (
    rowIndex: number,
    colName: string,
    rawValue: unknown,
  ) => {
    if (!selectedDb || !selectedTable) return;
    const originalRow = rows[rowIndex];
    if (!originalRow) return;

    const col = columns.find((c) => c.name === colName);
    let newValue: unknown = rawValue;

    if (typeof rawValue === "string") {
      if (rawValue === "") {
        newValue = col?.nullable ? null : "";
      } else if (col) {
        const normType = col.type.toLowerCase();
        if (normType.includes("int")) {
          const parsed = parseInt(rawValue, 10);
          if (!isNaN(parsed)) newValue = parsed;
        } else if (
          normType.includes("float") ||
          normType.includes("double") ||
          normType.includes("numeric") ||
          normType.includes("decimal") ||
          normType.includes("real")
        ) {
          const parsed = parseFloat(rawValue);
          if (!isNaN(parsed)) newValue = parsed;
        } else if (normType.includes("bool") || normType === "bit") {
          if (rawValue.toLowerCase() === "true") newValue = true;
          else if (rawValue.toLowerCase() === "false") newValue = false;
        } else if (normType.includes("json")) {
          try {
            newValue = JSON.parse(rawValue);
          } catch {
            // keep as string if not valid JSON
          }
        }
      }
    }

    if (originalRow[colName] === newValue) return;

    // Optimistically update local rows
    const updatedRow = { ...originalRow, [colName]: newValue };
    const newRows = [...rows];
    newRows[rowIndex] = updatedRow;
    setRows(newRows);
    if (selectedRowIndex === rowIndex) {
      setRowEditValues(updatedRow);
    }

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

      await api.updateTableRow(selectedDb, selectedTable, filter, {
        [colName]: newValue,
      });
    } catch (err) {
      // Revert on failure
      const revertedRows = [...rows];
      revertedRows[rowIndex] = originalRow;
      setRows(revertedRows);
      if (selectedRowIndex === rowIndex) {
        setRowEditValues(originalRow);
      }
      showAlertDialog(
        err instanceof Error ? err.message : "Failed to update cell",
        "Failed to Update Cell",
      );
    }
  };

  const handleCommitCellEdit = async (val?: unknown) => {
    if (!editingCell) return;
    const { rowIndex, colName, currentValue } = editingCell;
    const valueToSave = val !== undefined ? val : currentValue;
    setEditingCell(null);
    await handleSaveCellEdit(rowIndex, colName, valueToSave);
  };

  const handleSelectFkRecord = async (newVal: unknown) => {
    if (!fkPickerTarget) return;
    const target = fkPickerTarget;
    setFkPickerTarget(null);

    if (target.onSelect) {
      target.onSelect(newVal);
    } else if (target.rowIndex !== undefined) {
      await handleSaveCellEdit(target.rowIndex, target.column, newVal);
    }
  };

  // Keyboard navigation for selected cells (Arrows, Tab, Enter to edit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        editingCell ||
        expandedInlineCell ||
        isDetailsOpen ||
        fkPickerTarget ||
        fkPreviewTarget
      )
        return;
      if (!selectedCell) return;

      const { rowIndex, colName } = selectedCell;
      const colIdx = columns.findIndex((c) => c.name === colName);
      if (colIdx === -1) return;

      if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        if (colIdx < columns.length - 1) {
          setSelectedCell({ rowIndex, colName: columns[colIdx + 1].name });
        } else if (rowIndex < rows.length - 1) {
          setSelectedCell({ rowIndex: rowIndex + 1, colName: columns[0].name });
          setSelectedRowIndex(rowIndex + 1);
        }
      } else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) {
        e.preventDefault();
        if (colIdx > 0) {
          setSelectedCell({ rowIndex, colName: columns[colIdx - 1].name });
        } else if (rowIndex > 0) {
          setSelectedCell({
            rowIndex: rowIndex - 1,
            colName: columns[columns.length - 1].name,
          });
          setSelectedRowIndex(rowIndex - 1);
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rowIndex < rows.length - 1) {
          setSelectedCell({ rowIndex: rowIndex + 1, colName });
          setSelectedRowIndex(rowIndex + 1);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rowIndex > 0) {
          setSelectedCell({ rowIndex: rowIndex - 1, colName });
          setSelectedRowIndex(rowIndex - 1);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const fk = foreignKeys.find((f) => f.column === colName);
        if (fk) {
          const val = rows[rowIndex]?.[colName];
          setFkPickerTarget({
            rowIndex,
            column: colName,
            fk,
            currentValue: val,
          });
        } else {
          const cellEl = document.querySelector(
            `[data-cell-row="${rowIndex}"][data-cell-col="${colName}"]`,
          ) as HTMLElement;
          if (cellEl) {
            handleStartCellEdit(rowIndex, colName, cellEl);
          }
        }
      } else if (e.key === "Escape") {
        setSelectedCell(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedCell,
    editingCell,
    expandedInlineCell,
    isDetailsOpen,
    fkPickerTarget,
    fkPreviewTarget,
    columns,
    rows,
    foreignKeys,
    setSelectedRowIndex,
  ]);

  // Click outside cell listener to deselect selectedCell
  useEffect(() => {
    if (!selectedCell) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Do not deselect if interacting with cell editor popovers, modals, slide-overs, context menu, or cells
      if (
        target.closest("[data-cell-row]") ||
        target.closest(".fixed") ||
        target.closest('[role="dialog"]')
      ) {
        return;
      }
      setSelectedCell(null);
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [selectedCell]);

  return {
    selectedCell,
    setSelectedCell,
    editingCell,
    setEditingCell,
    expandedInlineCell,
    setExpandedInlineCell,
    fkPickerTarget,
    setFkPickerTarget,
    fkPreviewTarget,
    setFkPreviewTarget,
    handleStartCellEdit,
    handleSaveCellEdit,
    handleCommitCellEdit,
    handleSelectFkRecord,
  };
}
