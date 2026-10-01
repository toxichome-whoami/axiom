/*
 * Confirmation dialog modal for dangerous/destructive actions.
 * Owned by: ui/components
 * Key deps: lucide-react (AlertTriangle, X)
 * Invariants: Traps ESC and backdrop click to cancel; executes onConfirm on explicit confirmation.
 * Last structural change: Initial implementation matching technical-minimalist design system.
 */

import React, { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
}

/**
 * Technical confirmation modal adhering to the Vercel/Linear dark design system.
 * CONTRACT:
 *  - Closes on Escape key or backdrop click.
 *  - Renders explicit danger gradient button with confirmation callback.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 font-sans select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-[420px] rounded-[10px] bg-[#0c0c0c] border border-[#262626] shadow-2xl overflow-hidden font-sans animate-in zoom-in-95 duration-150 z-10 select-text">
        {/* Header & Body */}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="w-9 h-9 rounded-full bg-[#2a0e0e] border border-[#4a1919] flex items-center justify-center text-[#e5484d] shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center text-[#888888] hover:text-white rounded-[6px] hover:bg-[#1a1a1a] transition-colors cursor-pointer shrink-0 -mr-1 -mt-1"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-3">
            <h3
              id="confirm-dialog-title"
              className="text-[16px] font-semibold text-white tracking-tight leading-snug font-sans"
            >
              {title}
            </h3>
            <div className="mt-1.5 text-[13px] text-[#8c8c8c] leading-relaxed font-sans">
              {description}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-[#0e0e0e] border-t border-[#222222] flex items-center justify-end gap-2.5 font-sans">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center h-8 px-3.5 rounded-[8px] text-[13px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
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
              {confirmLabel}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
