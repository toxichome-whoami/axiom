/**
 * ConfirmDialog.tsx
 * Accessible technical modal for destructive or irreversible actions.
 * Enforces async in-flight pending guards (Component F3) to prevent double-fire deletions,
 * locks body scroll with ref-counting, traps focus, and wires danger/warning variants.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, AlertCircle, X, Loader2 } from 'lucide-react';

let scrollLockCount = 0;
let originalOverflow = '';

function lockScroll() {
  if (scrollLockCount === 0) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount++;
}

function unlockScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = originalOverflow || '';
  }
}

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
}

/**
 * Technical confirmation modal adhering to the Axiom dark design system.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
}) => {
  const [isPending, setIsPending] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Scroll lock and focus management
  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    lockScroll();

    // Auto focus confirm button on open
    const focusTimer = setTimeout(() => {
      confirmButtonRef.current?.focus();
    }, 50);

    return () => {
      clearTimeout(focusTimer);
      unlockScroll();
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  // Keyboard navigation & trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) {
        onClose();
        return;
      }

      // Focus trap
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isPending, onClose]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (isPending) return;
    setIsPending(true);
    try {
      await onConfirm();
    } finally {
      setIsPending(false);
    }
  };

  const isWarning = variant === 'warning';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 font-sans select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      ref={dialogRef}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
        onClick={isPending ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-[420px] rounded-[10px] bg-[#0c0c0c] border border-[#262626] shadow-2xl overflow-hidden font-sans animate-in zoom-in-95 duration-150 z-10 select-text">
        {/* Header & Body */}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                isWarning
                  ? 'bg-[#2a1708] border border-[#59300e] text-[#f5a623]'
                  : 'bg-[#2a0e0e] border border-[#4a1919] text-[#e5484d]'
              }`}
            >
              {isWarning ? <AlertCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center text-[#888888] hover:text-white rounded-[6px] hover:bg-[#1a1a1a] transition-colors cursor-pointer shrink-0 -mr-1 -mt-1 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Close"
              aria-label="Close dialog"
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
            disabled={isPending}
            onClick={onClose}
            className="inline-flex items-center justify-center h-8 px-3.5 rounded-[8px] text-[13px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmButtonRef}
            disabled={isPending}
            onClick={handleConfirm}
            className={`group relative flex shrink-0 items-center justify-center h-8 px-3.5 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden font-sans text-[13px] disabled:opacity-50 disabled:cursor-not-allowed ${
              isWarning
                ? 'ring-1 ring-[#d97706] bg-[#b45309]'
                : 'ring-1 ring-[#be123c] bg-[#e11d48]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute inset-0 rounded-[inherit] ${
                isWarning
                  ? 'bg-gradient-to-b from-[#f59e0b] to-[#b45309]'
                  : 'bg-gradient-to-b from-[#f43f5e] to-[#e11d48]'
              } shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]`}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
            />
            <span className="relative flex items-center gap-1.5 font-sans">
              {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isPending ? 'Working...' : confirmLabel}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
