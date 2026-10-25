/*
 * Field editor with action menu (Set to NULL, Expand editor drawer).
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, ../../components/ui/SlideOver
 * Invariants: Provides consistent editing and drawer expansion across row editing fields.
 */

import React, { useState, useEffect, useRef } from "react";
import { Edit3 } from "lucide-react";
import { SlideOver } from "../../components/ui/SlideOver";

export interface FieldEditorWrapperProps {
  label: string;
  value: unknown;
  onChange: (val: unknown) => void;
  disabled?: boolean;
  isNullable?: boolean;
  isMultiline?: boolean;
  placeholder?: string;
  type?: "text" | "number";
  step?: string;
}

export function FieldEditorWrapper({
  label,
  value,
  onChange,
  disabled = false,
  isNullable = true,
  isMultiline = false,
  placeholder,
  type = "text",
  step,
}: FieldEditorWrapperProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalDraft, setModalDraft] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  const isNull = value === null || value === undefined;
  const strVal = isNull ? "" : String(value);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isMenuOpen]);

  const handleOpenExpand = () => {
    setIsMenuOpen(false);
    setModalDraft(strVal);
    setIsModalOpen(true);
  };

  const handleApplyModal = () => {
    onChange(modalDraft === "" && isNullable ? null : modalDraft);
    setIsModalOpen(false);
  };

  return (
    <>
      <div className="relative group w-full" ref={menuRef}>
        {isMultiline ? (
          <textarea
            rows={3}
            disabled={disabled}
            value={strVal}
            placeholder={placeholder}
            onChange={(e) =>
              onChange(
                e.target.value === "" && isNullable ? null : e.target.value,
              )
            }
            className={`w-full h-[84px] rounded-[6px] border border-[#262626] bg-[#121212] p-2.5 pr-8 text-[14px] text-white font-sans focus:outline-none focus:border-[#3b82f6] transition-colors resize-none placeholder-[#555555] ${
              disabled ? "opacity-60 cursor-not-allowed bg-[#0d0d0d]" : ""
            }`}
          />
        ) : (
          <input
            type={type}
            step={step}
            disabled={disabled}
            value={strVal}
            placeholder={placeholder}
            onChange={(e) => {
              const v = e.target.value;
              onChange(v === "" && isNullable ? null : v);
            }}
            className={`h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-8 text-[14px] text-white font-sans focus:outline-none focus:border-[#3b82f6] transition-colors placeholder-[#555555] ${
              disabled ? "opacity-60 cursor-not-allowed bg-[#0d0d0d]" : ""
            }`}
          />
        )}

        {/* Small rounded Edit icon button */}
        {!disabled && (
          <div
            className={`absolute ${isMultiline ? "right-2.5 top-2.5" : "right-2 top-1/2 -translate-y-1/2"} z-10`}
          >
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              title="Field actions"
              className={`flex items-center justify-center w-5 h-5 rounded-[4px] border border-[#2a2a2a] bg-[#161616]/90 hover:bg-[#222222] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer ${
                isMenuOpen ? "border-[#3b82f6] text-white bg-[#1a1a1a]" : ""
              }`}
            >
              <Edit3 className="w-3 h-3" />
            </button>

            {/* Dropdown Menu */}
            {isMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 rounded-[6px] border border-[#282828] bg-[#141414] shadow-[0_12px_28px_rgba(0,0,0,0.9)] p-1 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans">
                <button
                  type="button"
                  onClick={() => {
                    onChange(null);
                    setIsMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] text-[12px] text-[#cccccc] hover:text-white hover:bg-[#202020] transition-colors text-left cursor-pointer"
                >
                  <span>Set to NULL</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenExpand}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] text-[12px] text-[#cccccc] hover:text-white hover:bg-[#202020] transition-colors text-left cursor-pointer"
                >
                  <span>Expand editor</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expanded Field Editor Drawer Panel */}
      <SlideOver
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        width="w-[520px] max-w-full"
        title={label}
        subtitle="Edit field value"
      >
        <div className="flex-1 flex flex-col min-h-0 bg-[#0e0e0e] overflow-hidden font-sans">
          {/* Main Content Area */}
          <div className="flex-1 p-4 sm:p-5 flex flex-col min-h-0 space-y-2 overflow-hidden">
            <div className="flex items-center justify-between">
              <label className="text-[13.5px] font-medium text-white font-sans">
                Value
              </label>
              <span className="text-[12px] font-mono text-[#777777]">
                {(modalDraft || "").length} chars ·{" "}
                {(modalDraft || "").split("\n").length} lines
              </span>
            </div>
            <textarea
              value={modalDraft}
              onChange={(e) => setModalDraft(e.target.value)}
              autoFocus
              spellCheck={false}
              className="flex-1 w-full rounded-[6px] border border-[#262626] bg-[#121212] p-3 text-[14px] leading-relaxed text-white font-sans focus:outline-none focus:border-[#3b82f6] resize-none placeholder-[#555555] transition-colors whitespace-pre"
              placeholder="Enter value..."
            />
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans shrink-0">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyModal}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative flex items-center text-[14px] font-sans">
                Apply
              </span>
            </button>
          </div>
        </div>
      </SlideOver>
    </>
  );
}
