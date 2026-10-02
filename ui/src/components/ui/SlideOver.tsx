/**
 * SlideOver.tsx
 * Drawer modal adhering to Axiom's container-in-container dark theme.
 * Enforces panel-scoped touch gestures (Component F4) to prevent hijacking scroll in tables,
 * ref-counts body scroll locks, restores focus on close, and wires proper ARIA attributes.
 */

import React, { useEffect, useRef } from 'react';
import { cn } from '../../utils/cn';

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

interface SlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}

export const SlideOver: React.FC<SlideOverProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  width = 'w-[520px] max-w-full',
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Scroll lock and focus restoration
  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    lockScroll();

    return () => {
      unlockScroll();
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Panel-scoped touch gestures: only trigger dismiss from left-edge drag
  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let isEdgeSwipe = false;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      const panelRect = panel.getBoundingClientRect();
      const relativeX = touch.clientX - panelRect.left;

      // Only initiate gesture if touch starts within 40px of left edge of drawer
      if (relativeX >= 0 && relativeX <= 40) {
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        isEdgeSwipe = true;
      } else {
        isEdgeSwipe = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isEdgeSwipe) return;
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = Math.abs(touch.clientY - touchStartY);

      // Require significant rightward motion with horizontal dominance
      if (deltaX > 80 && deltaX > deltaY * 2) {
        isEdgeSwipe = false;
        onClose();
      }
    };

    const handleTouchEnd = () => {
      isEdgeSwipe = false;
    };

    panel.addEventListener('touchstart', handleTouchStart, { passive: true });
    panel.addEventListener('touchmove', handleTouchMove, { passive: true });
    panel.addEventListener('touchend', handleTouchEnd);

    return () => {
      panel.removeEventListener('touchstart', handleTouchStart);
      panel.removeEventListener('touchmove', handleTouchMove);
      panel.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden select-none font-sans"
      role="dialog"
      aria-modal="true"
      aria-labelledby="slideover-title"
    >
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-y-0 sm:inset-y-2.5 right-0 flex max-w-full pl-0 sm:pl-10 pointer-events-none font-sans">
        {/* Outer Container (Matching Table outer black frame) */}
        <div
          ref={panelRef}
          className={cn(
            'w-screen pointer-events-auto bg-black border-l border-y border-[#222222] rounded-tl-[8px] rounded-bl-[8px] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 ease-out select-text overflow-hidden font-sans',
            width
          )}
        >
          {/* Outer Header Bar (Title & metadata on pure black frame) */}
          <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 bg-black shrink-0 font-sans">
            <div className="min-w-0 pr-3 flex-1">
              <h2
                id="slideover-title"
                className="text-[16px] font-medium text-white tracking-[-0.015em] leading-snug font-sans truncate"
                title={typeof title === 'string' ? title : undefined}
              >
                {title}
              </h2>
              {subtitle && <div className="mt-0.5 text-[13px] text-[#8c8c8c] font-sans">{subtitle}</div>}
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center text-[#888888] hover:text-white rounded-[8px] hover:bg-[#1a1a1a] transition-colors cursor-pointer shrink-0 ml-2"
              title="Close"
              aria-label="Close drawer"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 256 256"
                fill="currentColor"
              >
                <path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" />
              </svg>
            </button>
          </div>

          {/* Inset Container ("container in container" design) */}
          <div className="mx-[6px] mb-[6px] flex-1 flex flex-col border border-[#262626] rounded-[8px] bg-[#0e0e0e] overflow-hidden min-h-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
