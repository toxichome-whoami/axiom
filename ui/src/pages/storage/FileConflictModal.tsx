/*
 * Modal for resolving file upload collisions (Replace / Keep Both / Skip).
 * Owned by: ui/pages/storage
 * Design reference: Google Drive / macOS Finder collision resolver
 */

import React, { useState } from "react";
import { AlertCircle, FileWarning, ArrowRight, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { formatBytes } from "./format";
import { getFileIcon } from "./fileIcon";

export interface ConflictingFile {
  entry: any; // incoming upload file entry
  name: string;
  incomingSize: number;
  existingSize?: number;
  existingModified?: string | number;
}

export type ConflictResolution = "replace" | "keep_both" | "skip";

export interface FileConflictModalProps {
  isOpen: boolean;
  conflicts: ConflictingFile[];
  onResolve: (resolutions: Map<string, ConflictResolution>) => void;
  onCancel: () => void;
}

export function FileConflictModal({
  isOpen,
  conflicts,
  onResolve,
  onCancel,
}: FileConflictModalProps) {
  const [applyToAll, setApplyToAll] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<Map<string, ConflictResolution>>(
    new Map(),
  );

  if (!isOpen || conflicts.length === 0) return null;

  const currentConflict = conflicts[currentIndex] || conflicts[0];

  const handleChoice = (choice: ConflictResolution) => {
    if (applyToAll || conflicts.length === 1) {
      // Apply choice to current and all remaining conflicts
      const finalMap = new Map(decisions);
      for (let i = currentIndex; i < conflicts.length; i++) {
        finalMap.set(conflicts[i].name, choice);
      }
      onResolve(finalMap);
    } else {
      const nextMap = new Map(decisions);
      nextMap.set(currentConflict.name, choice);
      setDecisions(nextMap);

      if (currentIndex + 1 < conflicts.length) {
        setCurrentIndex(currentIndex + 1);
      } else {
        onResolve(nextMap);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[500px] rounded-[8px] bg-[#0c0c0c] border border-[#262626] shadow-2xl overflow-hidden font-sans flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1f1f]">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#f5a623]" />
            <h3 className="text-[15px] font-sans font-medium text-white tracking-tight">
              File Already Exists{" "}
              {conflicts.length > 1 &&
                `(${currentIndex + 1} of ${conflicts.length})`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-[#8c8c8c] hover:text-white transition-colors cursor-pointer p-1 rounded-[6px] hover:bg-[#1a1a1a]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <p className="text-[13px] font-sans text-[#cccccc] leading-relaxed">
            A file named{" "}
            <span className="font-mono text-white font-medium">
              {currentConflict.name}
            </span>{" "}
            already exists in this folder. What would you like to do?
          </p>

          {/* Comparison Card */}
          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-[8px] bg-[#111111] border border-[#222222] font-sans">
            {/* Existing file */}
            <div className="space-y-1.5 p-2 rounded-[6px] bg-[#161616] border border-[#262626]">
              <span className="text-[12px] font-sans font-medium text-[#8c8c8c] block">
                Existing File
              </span>
              <div className="flex items-center gap-2">
                {getFileIcon(currentConflict.name, "w-4 h-4 shrink-0")}
                <span className="text-[13px] font-sans text-[#cccccc] truncate font-medium">
                  {currentConflict.name}
                </span>
              </div>
              <div className="text-[12px] font-sans text-[#8c8c8c]">
                Size:{" "}
                {currentConflict.existingSize !== undefined
                  ? formatBytes(currentConflict.existingSize)
                  : "Unknown"}
              </div>
            </div>

            {/* Incoming file */}
            <div className="space-y-1.5 p-2 rounded-[6px] bg-[#161616] border border-[#262626]">
              <span className="text-[12px] font-sans font-medium text-blue-400 block">
                Incoming File
              </span>
              <div className="flex items-center gap-2">
                {getFileIcon(
                  currentConflict.name,
                  "w-4 h-4 shrink-0 text-blue-400",
                )}
                <span className="text-[13px] font-sans text-white truncate font-medium">
                  {currentConflict.name}
                </span>
              </div>
              <div className="text-[12px] font-sans text-[#8c8c8c]">
                Size: {formatBytes(currentConflict.incomingSize)}
              </div>
            </div>
          </div>

          {/* Apply to all checkbox if multiple */}
          {conflicts.length > 1 && (
            <label className="flex items-center gap-2 cursor-pointer select-none text-[13px] text-[#8c8c8c] hover:text-white transition-colors">
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={(e) => setApplyToAll(e.target.checked)}
                className="w-4 h-4 rounded-[4px] bg-[#1a1a1a] border border-[#333333] accent-blue-600 cursor-pointer"
              />
              <span>
                Apply to all remaining conflicts (
                {conflicts.length - currentIndex})
              </span>
            </label>
          )}

          {/* Action Choices */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1a1a1a]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleChoice("skip")}
              className="h-8 px-3"
            >
              Skip
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleChoice("keep_both")}
              className="h-8 px-3"
            >
              Keep Both (Rename)
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => handleChoice("replace")}
              className="h-8 px-3.5 bg-red-600 hover:bg-red-500 text-white"
            >
              Replace
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
