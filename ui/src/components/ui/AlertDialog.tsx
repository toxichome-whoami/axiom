/**
 * AlertDialog.tsx
 * Accessible dark-theme modal for displaying database, operational, and system errors
 * replacing native browser window.alert() popups.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export interface AlertDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}

/**
 * Dispatches a global alert event that displays the custom dark modal dialog.
 */
export function showAlertDialog(
  message: string,
  title: string = 'Operation Failed',
  variant: 'danger' | 'warning' | 'info' = 'danger'
) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('axiom:alert', {
        detail: { title, message, variant },
      })
    );
  }
}

/**
 * Custom dark modal dialog adhering to Axiom's design system.
 */
export const AlertDialog: React.FC<AlertDialogProps> = ({
  isOpen,
  onClose,
  title = 'Operation Notice',
  message,
  confirmLabel = 'OK',
  variant = 'danger',
}) => {
  const okButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Auto-focus OK button on open and restore on close
  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const timer = setTimeout(() => {
      okButtonRef.current?.focus();
    }, 50);

    return () => {
      clearTimeout(timer);
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  // Keyboard navigation & trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isWarning = variant === 'warning';
  const isInfo = variant === 'info';

  const stringMsg = typeof message === 'string' ? message : '';
  const isForeignKeyError =
    stringMsg.includes('1451') ||
    stringMsg.toLowerCase().includes('foreign key constraint') ||
    stringMsg.toLowerCase().includes('parent row');
  const isDuplicateKeyError =
    stringMsg.includes('1062') ||
    stringMsg.includes('1061') ||
    stringMsg.toLowerCase().includes('duplicate key') ||
    stringMsg.toLowerCase().includes('duplicate entry');

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 font-sans select-none"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alert-dialog-title"
      ref={dialogRef}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-[460px] rounded-[10px] bg-[#0c0c0c] border border-[#262626] shadow-2xl overflow-hidden font-sans animate-in zoom-in-95 duration-150 z-10 select-text">
        {/* Header & Body */}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                isInfo
                  ? 'bg-[#0e1d33] border border-[#1d3b66] text-[#60a5fa]'
                  : isWarning
                  ? 'bg-[#2a1708] border border-[#59300e] text-[#f5a623]'
                  : 'bg-[#2a0e0e] border border-[#4a1919] text-[#e5484d]'
              }`}
            >
              {isInfo ? (
                <Info className="w-4 h-4" />
              ) : isWarning ? (
                <AlertCircle className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center text-[#888888] hover:text-white rounded-[6px] hover:bg-[#1a1a1a] transition-colors cursor-pointer shrink-0 -mr-1 -mt-1"
              title="Close"
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-3">
            <h3
              id="alert-dialog-title"
              className="text-[15px] font-semibold text-white tracking-tight leading-snug font-sans"
            >
              {isForeignKeyError && title === 'Operation Failed' ? 'Foreign Key Constraint Violated' : title}
            </h3>

            <div className="mt-2.5">
              {typeof message === 'string' ? (
                <div className="p-3 rounded-[6px] bg-[#141414] border border-[#262626] text-[12.5px] font-mono text-rose-300/90 leading-relaxed break-words select-text">
                  {message}
                </div>
              ) : (
                <div className="text-[13px] text-[#8c8c8c] leading-relaxed font-sans">{message}</div>
              )}

              {/* Helpful Hint Callouts */}
              {isForeignKeyError && (
                <div className="mt-2.5 p-2.5 rounded-[6px] bg-amber-950/20 border border-amber-900/30 text-[12px] text-amber-300/90 leading-relaxed flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    This record is referenced by another table. You must delete or reassign referencing child records
                    before deleting this row.
                  </span>
                </div>
              )}

              {isDuplicateKeyError && (
                <div className="mt-2.5 p-2.5 rounded-[6px] bg-amber-950/20 border border-amber-900/30 text-[12px] text-amber-300/90 leading-relaxed flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>A record or index with this unique identifier already exists.</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-[#0e0e0e] border-t border-[#222222] flex items-center justify-end font-sans">
          <button
            type="button"
            ref={okButtonRef}
            onClick={onClose}
            className="inline-flex items-center justify-center h-8 px-4 rounded-[6px] text-[13px] font-medium text-white bg-[#1e1e1e] hover:bg-[#282828] border border-[#333333] transition-colors cursor-pointer font-sans"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Global Alert Dialog Host mounted at root of App.
 * Intercepts both window.alert() and 'axiom:alert' custom events.
 */
export const GlobalAlertDialog: React.FC = () => {
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    variant: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: 'Operation Failed',
    message: '',
    variant: 'danger',
  });

  useEffect(() => {
    // Intercept native browser window.alert so no raw popups ever appear
    const originalAlert = window.alert;
    window.alert = (msg: unknown) => {
      setDialogState({
        isOpen: true,
        title: 'Database Notice',
        message: String(msg ?? ''),
        variant: 'danger',
      });
    };

    const handleCustomAlert = (e: Event) => {
      const customEvent = e as CustomEvent<{
        title?: string;
        message: string;
        variant?: 'danger' | 'warning' | 'info';
      }>;
      if (customEvent.detail) {
        setDialogState({
          isOpen: true,
          title: customEvent.detail.title || 'Operation Failed',
          message: customEvent.detail.message || '',
          variant: customEvent.detail.variant || 'danger',
        });
      }
    };

    window.addEventListener('axiom:alert', handleCustomAlert);

    return () => {
      window.alert = originalAlert;
      window.removeEventListener('axiom:alert', handleCustomAlert);
    };
  }, []);

  return (
    <AlertDialog
      isOpen={dialogState.isOpen}
      onClose={() => setDialogState((prev) => ({ ...prev, isOpen: false }))}
      title={dialogState.title}
      message={dialogState.message}
      variant={dialogState.variant}
    />
  );
};
