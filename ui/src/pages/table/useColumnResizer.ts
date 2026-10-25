/*
 * Custom hook for table column width management, resizing, and persistence.
 * Owned by: ui/pages/table
 * Key deps: react, ./format
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { getDefaultColumnWidth } from "./format";

export interface UseColumnResizerProps {
  selectedDb: string;
  selectedTable: string;
}

export function useColumnResizer({
  selectedDb,
  selectedTable,
}: UseColumnResizerProps) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const resizingColRef = useRef<{
    colName: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  // Restore persisted custom column widths for active table
  useEffect(() => {
    if (!selectedDb || !selectedTable) return;
    try {
      const stored = localStorage.getItem(
        `axiom:col_widths:${selectedDb}:${selectedTable}`,
      );
      if (stored) {
        setColumnWidths(JSON.parse(stored));
      } else {
        setColumnWidths({});
      }
    } catch {
      setColumnWidths({});
    }
  }, [selectedDb, selectedTable]);

  // Helper to determine if a column is non-editable / read-only (Primary Key, 'id', generated/serial)
  const isColReadOnly = useCallback(
    (col: { name: string; primary_key?: boolean; type: string }): boolean => {
      if (col.primary_key) return true;
      if (col.name.toLowerCase() === "id") return true;
      const normType = col.type.toLowerCase();
      if (
        normType.includes("serial") ||
        normType.includes("identity") ||
        normType.includes("generated")
      )
        return true;
      return false;
    },
    [],
  );

  // Returns effective width: user preference > type-based semantic default
  const getColWidth = useCallback(
    (colName: string, colType: string): number => {
      if (columnWidths[colName] && columnWidths[colName] >= 80) {
        return columnWidths[colName];
      }
      return getDefaultColumnWidth(colType, colName);
    },
    [columnWidths],
  );

  // Drag-to-resize column width handler
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, colName: string, currentWidth: number) => {
      e.preventDefault();
      e.stopPropagation();

      resizingColRef.current = {
        colName,
        startX: e.clientX,
        startWidth: currentWidth,
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      function onMouseMove(moveEvent: MouseEvent) {
        if (!resizingColRef.current) return;
        const {
          colName: targetCol,
          startX,
          startWidth,
        } = resizingColRef.current;
        const delta = moveEvent.clientX - startX;
        // Clamp column width: collapse limit is 80px, maximum 1200px
        const newWidth = Math.max(80, Math.min(1200, startWidth + delta));

        setColumnWidths((prev) => ({
          ...prev,
          [targetCol]: newWidth,
        }));
      }

      function onMouseUp() {
        if (resizingColRef.current && selectedDb && selectedTable) {
          setColumnWidths((latest) => {
            try {
              localStorage.setItem(
                `axiom:col_widths:${selectedDb}:${selectedTable}`,
                JSON.stringify(latest),
              );
            } catch {
              // Ignore localStorage quota failures
            }
            return latest;
          });
        }
        resizingColRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      }

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [selectedDb, selectedTable],
  );

  const resetColumnWidth = useCallback(
    (colName: string) => {
      setColumnWidths((prev) => {
        const next = { ...prev };
        delete next[colName];
        if (selectedDb && selectedTable) {
          try {
            localStorage.setItem(
              `axiom:col_widths:${selectedDb}:${selectedTable}`,
              JSON.stringify(next),
            );
          } catch {}
        }
        return next;
      });
    },
    [selectedDb, selectedTable],
  );

  return {
    columnWidths,
    setColumnWidths,
    isColReadOnly,
    getColWidth,
    handleResizeStart,
    resetColumnWidth,
  };
}
