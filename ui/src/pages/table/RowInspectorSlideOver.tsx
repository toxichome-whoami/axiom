/*
 * Row Inspector and Insert SlideOver Drawer.
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../types, ../../components/ui/SlideOver, ../../components/shared/CustomSelect, ./FieldEditorWrapper, ./DateTimePickerPopovers
 * Invariants: Single source of draft edit state; strict dirty tracking (disabled Save when pristine or saving); edge-to-edge section dividers.
 */

import React from "react";
import { Key, Trash2, RefreshCw } from "lucide-react";
import { ColumnInfoApi, ForeignKeyInfoApi } from "../../types";
import { SlideOver } from "../../components/ui/SlideOver";
import { CustomSelect } from "../../components/shared/CustomSelect";
import { FieldEditorWrapper } from "./FieldEditorWrapper";
import { DateTimePickerInput } from "./DateTimePickerPopovers";

export interface RowInspectorSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  isInsertMode: boolean;
  activeRow: Record<string, unknown> | null;
  selectedRowIndex: number | null;
  selectedTable: string;
  columns: ColumnInfoApi[];
  foreignKeys: ForeignKeyInfoApi[];
  rowEditValues: Record<string, unknown>;
  setRowEditValues: React.Dispatch<
    React.SetStateAction<Record<string, unknown>>
  >;
  inspectorTab: "details" | "danger";
  setInspectorTab: (tab: "details" | "danger") => void;
  isSavingRow: boolean;
  hasRowChanges: boolean;
  handleSaveRowEdit: () => void;
  handleInsertRowFromPanel: () => void;
  onRequestDeleteRow: (row: Record<string, unknown>) => void;
  onOpenFkPicker: (target: {
    column: string;
    fk: ForeignKeyInfoApi;
    currentValue: unknown;
    onSelect: (val: unknown) => void;
  }) => void;
  isColReadOnly: (col: ColumnInfoApi) => boolean;
  canInsert?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
}

export function RowInspectorSlideOver({
  isOpen,
  onClose,
  isInsertMode,
  activeRow,
  selectedRowIndex,
  selectedTable,
  columns,
  foreignKeys,
  rowEditValues,
  setRowEditValues,
  inspectorTab,
  setInspectorTab,
  isSavingRow,
  hasRowChanges,
  handleSaveRowEdit,
  handleInsertRowFromPanel,
  onRequestDeleteRow,
  onOpenFkPicker,
  isColReadOnly,
  canInsert = true,
  canUpdate = true,
  canDelete = true,
}: RowInspectorSlideOverProps) {
  const isIdOrPk = (c: ColumnInfoApi) =>
    c.primary_key || c.name.toLowerCase() === "id";
  const requiredCols = [
    ...columns.filter(isIdOrPk),
    ...columns.filter((c) => !isIdOrPk(c) && !c.nullable),
  ];
  const optionalCols = columns.filter((c) => !isIdOrPk(c) && c.nullable);

  const renderColField = (col: ColumnInfoApi, isInsert: boolean) => {
    const val = rowEditValues[col.name];
    const isNull = val === null || val === undefined;
    const normType = col.type.toLowerCase();
    const isAutoPk = col.primary_key && normType.includes("int");
    const isNumber =
      normType.includes("int") ||
      normType.includes("float") ||
      normType.includes("double") ||
      normType.includes("decimal") ||
      normType.includes("numeric") ||
      normType.includes("real") ||
      normType.includes("serial") ||
      normType.includes("money");
    const isBool = normType.includes("bool") || normType === "bit";
    const isDate = normType === "date";
    const isTimestamp = normType.includes("time") || normType.includes("date");
    const disabled = isInsert ? !canInsert : !canUpdate || isColReadOnly(col);

    return (
      <div key={col.name} className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[13.5px] font-medium text-white flex items-center gap-1.5 font-sans">
            <span>{col.name}</span>
            {col.primary_key && (
              <Key className="w-3 h-3 text-amber-400 shrink-0" />
            )}
            {disabled && !col.primary_key && (
              <span className="text-[11px] text-[#777777] font-normal">
                (Read-only)
              </span>
            )}
            {(() => {
              const fk = foreignKeys.find((f) => f.column === col.name);
              if (!fk || disabled) return null;
              return (
                <button
                  type="button"
                  onClick={() => {
                    onOpenFkPicker({
                      column: col.name,
                      fk,
                      currentValue: val,
                      onSelect: (newVal) => {
                        setRowEditValues((prev) => ({
                          ...prev,
                          [col.name]: newVal,
                        }));
                      },
                    });
                  }}
                  title={`Pick record from ${fk.referenced_table}`}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/25 transition-colors cursor-pointer"
                >
                  <span>→ {fk.referenced_table}</span>
                </button>
              );
            })()}
          </label>
          <span className="text-[12px] font-mono text-[#777777]">
            {col.type}
          </span>
        </div>

        <div>
          {isBool ? (
            <CustomSelect
              disabled={disabled}
              value={isNull ? "" : String(val)}
              options={[
                { value: "", label: isInsert ? "NULL (Unset)" : "NULL" },
                { value: "true", label: "TRUE" },
                { value: "false", label: "FALSE" },
              ]}
              onChange={(v) => {
                setRowEditValues((prev) => ({
                  ...prev,
                  [col.name]: v === "" ? null : v === "true",
                }));
              }}
              menuWidth="w-full"
            />
          ) : isNumber ? (
            <FieldEditorWrapper
              label={col.name}
              type="number"
              step={
                normType.includes("float") ||
                normType.includes("double") ||
                normType.includes("numeric") ||
                normType.includes("decimal")
                  ? "any"
                  : "1"
              }
              disabled={disabled}
              placeholder={
                isInsert && isAutoPk
                  ? "Auto-increment"
                  : col.nullable
                    ? "Optional (NULL)"
                    : "Required"
              }
              value={val}
              isNullable={col.nullable}
              onChange={(v) =>
                setRowEditValues((prev) => ({ ...prev, [col.name]: v }))
              }
            />
          ) : isTimestamp ? (
            <DateTimePickerInput
              value={isNull ? null : val}
              disabled={disabled}
              isDateOnly={isDate}
              placeholder={isDate ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm:ss"}
              onChange={(v) =>
                setRowEditValues((prev) => ({ ...prev, [col.name]: v }))
              }
            />
          ) : (
            <FieldEditorWrapper
              label={col.name}
              isMultiline={true}
              disabled={disabled}
              placeholder={col.nullable ? "Optional (NULL)" : "Required"}
              value={val}
              isNullable={col.nullable}
              onChange={(v) =>
                setRowEditValues((prev) => ({ ...prev, [col.name]: v }))
              }
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      width="w-[520px] max-w-full"
      title={
        isInsertMode
          ? "Insert New Row"
          : activeRow
            ? `Row #${selectedRowIndex! + 1}`
            : ""
      }
      subtitle={
        isInsertMode
          ? `Add record to ${selectedTable}`
          : activeRow
            ? `${selectedTable} · ${columns.length} columns`
            : ""
      }
    >
      {/* Tab bar */}
      {!isInsertMode && activeRow && (
        <div className="px-5 py-3 border-b border-[#222222] bg-[#0e0e0e] shrink-0 font-sans">
          <div className="inline-flex items-center p-0.5 rounded-[8px] bg-transparent border border-[#262626]">
            <button
              type="button"
              onClick={() => setInspectorTab("details")}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                inspectorTab === "details"
                  ? "bg-[#161616] text-white border-[#333333]"
                  : "text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent"
              }`}
            >
              <span>Record Values</span>
            </button>
            {canDelete !== false && (
              <button
                type="button"
                onClick={() => setInspectorTab("danger")}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                  inspectorTab === "danger"
                    ? "bg-[#161616] text-white border-[#333333]"
                    : "text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent"
                }`}
              >
                <span>Danger</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Drawer Body Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 font-sans">
        {isInsertMode ? (
          <div className="space-y-4 font-sans">
            <div className="text-[13.5px] text-[#8c8c8c]">
              Specify column values for the new record in{" "}
              <span className="font-mono text-white font-medium">
                {selectedTable}
              </span>
              .
            </div>

            <div className="space-y-4">
              {requiredCols.length > 0 && (
                <div className="space-y-4">
                  {requiredCols.map((col) => renderColField(col, true))}
                </div>
              )}

              {optionalCols.length > 0 && (
                <div className="pt-2 space-y-4">
                  <div className="-mx-4 sm:-mx-5 px-4 sm:px-5 pt-4 border-t border-[#222222]">
                    <h4 className="text-[14px] font-semibold text-white tracking-tight font-sans">
                      Optional Fields
                    </h4>
                    <p className="text-[12.5px] text-[#8c8c8c] mt-0.5 font-sans">
                      These are columns that do not need any value
                    </p>
                  </div>

                  <div className="space-y-4">
                    {optionalCols.map((col) => renderColField(col, true))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : activeRow && inspectorTab === "danger" ? (
          <div className="space-y-4 font-sans">
            <div className="rounded-[8px] border border-[#3a1515] bg-[#0e0404] p-4">
              <h3 className="text-[16px] font-medium text-[#e5484d] mb-1 font-sans">
                Delete Record
              </h3>
              <p className="text-[13px] text-[#8c8c8c] mb-4 font-sans">
                Permanently delete this row from{" "}
                <span className="text-white font-medium text-[13px] font-mono">
                  {selectedTable}
                </span>
                . This action is irreversible and immediately executes against
                the database.
              </p>
              <button
                type="button"
                onClick={() => onRequestDeleteRow(activeRow)}
                className="group relative flex shrink-0 items-center justify-center h-8 px-3.5 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#be123c] bg-[#e11d48] font-sans text-[13px]"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#f43f5e] to-[#e11d48] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
                />
                <span className="relative flex items-center gap-1.5 font-sans">
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Row</span>
                </span>
              </button>
            </div>
          </div>
        ) : activeRow ? (
          <div className="space-y-4 font-sans">
            {requiredCols.length > 0 && (
              <div className="space-y-4">
                {requiredCols.map((col) => renderColField(col, false))}
              </div>
            )}

            {optionalCols.length > 0 && (
              <div className="pt-2 space-y-4">
                <div className="-mx-4 sm:-mx-5 px-4 sm:px-5 pt-4 border-t border-[#222222]">
                  <h4 className="text-[14px] font-semibold text-white tracking-tight font-sans">
                    Optional Fields
                  </h4>
                  <p className="text-[12.5px] text-[#8c8c8c] mt-0.5 font-sans">
                    These are columns that do not need any value
                  </p>
                </div>

                <div className="space-y-4">
                  {optionalCols.map((col) => renderColField(col, false))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Footer */}
      {(isInsertMode || activeRow) && (
        <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
          >
            Close
          </button>
          {inspectorTab === "details" && (
            <button
              type="button"
              onClick={
                isInsertMode ? handleInsertRowFromPanel : handleSaveRowEdit
              }
              disabled={
                isSavingRow ||
                (isInsertMode
                  ? !canInsert || columns.length === 0
                  : !canUpdate || !hasRowChanges)
              }
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative flex items-center gap-1.5 text-[14px] font-sans">
                {isSavingRow ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>{isInsertMode ? "Inserting..." : "Saving..."}</span>
                  </>
                ) : (
                  <span>{isInsertMode ? "Insert Row" : "Save"}</span>
                )}
              </span>
            </button>
          )}
        </div>
      )}
    </SlideOver>
  );
}
