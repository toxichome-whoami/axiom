import React, { useState, useEffect } from "react";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Switch } from "../../components/ui/Switch";

export interface DeleteTableDialogProps {
  isOpen: boolean;
  targetTable: string | null;
  database: string;
  isDeleting: boolean;
  onConfirm: (cascade: boolean) => Promise<void>;
  onClose: () => void;
}

export const DeleteTableDialog: React.FC<DeleteTableDialogProps> = React.memo(
  ({ isOpen, targetTable, database, isDeleting, onConfirm, onClose }) => {
    const [cascade, setCascade] = useState(false);

    useEffect(() => {
      if (isOpen) {
        setCascade(false);
      }
    }, [isOpen]);

    if (!isOpen || !targetTable) return null;

    return (
      <ConfirmDialog
        isOpen={isOpen}
        title={`Delete table "${targetTable}"?`}
        description={
          <div className="space-y-3.5 font-sans">
            <p className="text-[13px] text-[#8c8c8c] leading-relaxed">
              Are you sure you want to delete table{" "}
              <code className="px-1.5 py-0.5 rounded-[4px] bg-[#181818] border border-[#282828] text-white font-mono text-[12px]">
                {targetTable}
              </code>{" "}
              from database{" "}
              <code className="px-1.5 py-0.5 rounded-[4px] bg-[#181818] border border-[#282828] text-[#cccccc] font-mono text-[12px]">
                {database}
              </code>
              ? All records, constraints, and schemas in this table will be permanently deleted. This action cannot be undone.
            </p>

            <div
              role="button"
              tabIndex={0}
              onClick={() => setCascade((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  setCascade((v) => !v);
                }
              }}
              className={`p-3 rounded-[8px] border transition-colors cursor-pointer select-none flex items-center justify-between gap-3.5 outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50 ${
                cascade
                  ? "bg-[#181113] border-[#521b25] shadow-[0_0_12px_rgba(225,29,72,0.12)]"
                  : "bg-[#121212] border-[#222222] hover:border-[#2e2e2e] hover:bg-[#161616]"
              }`}
            >
              <div className="flex flex-col min-w-0 pr-1 pointer-events-none">
                <span className="text-[13px] font-medium text-[#f0f0f0]">
                  Drop table with cascade?
                </span>
                <span className="text-[12px] text-[#888888] leading-relaxed mt-0.5">
                  Deletes the table and its dependent objects
                </span>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <Switch
                  checked={cascade}
                  onCheckedChange={setCascade}
                  className={
                    cascade
                      ? "!bg-[#e11d48] !shadow-[0_0_10px_rgba(225,29,72,0.4)]"
                      : ""
                  }
                />
              </div>
            </div>
          </div>
        }
        confirmLabel={isDeleting ? "Deleting..." : "Delete table"}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => onConfirm(cascade)}
        onClose={onClose}
      />
    );
  },
);

DeleteTableDialog.displayName = "DeleteTableDialog";
