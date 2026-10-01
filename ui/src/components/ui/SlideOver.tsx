import React, { useEffect } from 'react';
import { cn } from '../../utils/cn';

interface SlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}

/**
 * SlideOver drawer with "container in container" design:
 * Outer pure black frame (#000000) with rounded corners,
 * and an inset deep slate panel (#0e0e0e) with subtle border (#262626).
 */
export const SlideOver: React.FC<SlideOverProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  width = 'w-[520px] max-w-full',
}) => {
  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Handle Swipe right to dismiss
  useEffect(() => {
    if (!isOpen) return;
    
    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
      isSwiping = true;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isSwiping) return;
      const touchEndX = e.changedTouches[0].screenX;
      const touchEndY = e.changedTouches[0].screenY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = Math.abs(touchEndY - touchStartY);

      if (deltaX > 80 && deltaX > deltaY * 2) {
        isSwiping = false;
        onClose();
      }
    };

    const handleTouchEnd = () => {
      isSwiping = false;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 overflow-hidden select-none font-sans"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-y-0 sm:inset-y-2.5 right-0 flex max-w-full pl-0 sm:pl-10 pointer-events-none font-sans">
        {/* Outer Container (Matching Table outer black frame) */}
        <div
          className={cn(
            'w-screen pointer-events-auto bg-black border-l border-y border-[#222222] rounded-tl-[8px] rounded-bl-[8px] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 ease-out select-text overflow-hidden font-sans',
            width
          )}
        >
          {/* Outer Header Bar (Title & metadata on pure black frame) */}
          <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 bg-black shrink-0 font-sans">
            <div className="min-w-0 pr-3 flex-1">
              <h2
                className="text-[16px] font-semibold text-white tracking-[-0.015em] leading-snug font-sans truncate"
                title={typeof title === 'string' ? title : undefined}
              >
                {title}
              </h2>
              {subtitle && <div className="mt-0.5 text-[13px] text-[#8c8c8c] font-sans">{subtitle}</div>}
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center text-[#888888] hover:text-white rounded-[8px] hover:bg-[#1a1a1a] transition-colors cursor-pointer shrink-0 ml-2"
              title="Close (Esc)"
              aria-label="Close"
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
