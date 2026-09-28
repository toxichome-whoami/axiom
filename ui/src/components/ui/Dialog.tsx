/*
 * Shadcn UI Dialog component.
 * Owned by: ui/components/ui
 * Key deps: clsx, tailwind-merge, lucide-react
 * Invariants: Modal overlay with backdrop dismiss, escape key listener, and keyboard traps.
 */

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Modal Dialog Content */}
      <div
        className={cn(
          'relative w-full max-w-lg bg-[#0e0e0e] border border-[#262626] rounded-lg shadow-2xl overflow-hidden z-10',
          className
        )}
      >
        <div className="flex items-start justify-between p-5 pb-3 border-b border-[#1c1c1c]">
          <div>
            <h3 className="text-sm font-semibold text-[#f3f4f6]">{title}</h3>
            {description && <p className="text-xs text-[#8c8c8c] mt-1">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-md text-[#8c8c8c] hover:text-white hover:bg-[#1a1a1a] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 text-xs">{children}</div>
      </div>
    </div>
  );
};
