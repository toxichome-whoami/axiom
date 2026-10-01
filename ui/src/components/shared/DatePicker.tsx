import React, { useState, useRef, useEffect } from 'react';
import { DayPicker } from '@daypicker/react';
import '@daypicker/react/dist/style.css';
import { Calendar as CalendarIcon, X, ChevronDown } from 'lucide-react';

interface DatePickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Edge-to-edge Coss UI / Shadcn inspired DatePicker using @daypicker/react.
 * Features full-width popover placement, structured presets, clean typography,
 * and seamless alignment with panel input controls.
 */
export const DatePicker: React.FC<DatePickerProps> = ({
  value,
  onChange,
  placeholder = 'No expiry (Never)',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Convert 'YYYY-MM-DD' string to Date object in local timezone
  const selectedDate = value
    ? (() => {
        const [year, month, day] = value.split('-').map(Number);
        return new Date(year, month - 1, day);
      })()
    : undefined;

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = (date: Date | undefined) => {
    if (!date) {
      onChange(null);
    } else {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      onChange(`${year}-${month}-${day}`);
    }
    setIsOpen(false);
  };

  const handlePreset = (days: number | null) => {
    if (days === null) {
      onChange(null);
    } else {
      const d = new Date();
      d.setDate(d.getDate() + days);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      onChange(`${year}-${month}-${day}`);
    }
    setIsOpen(false);
  };

  const formatDisplay = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      const [year, month, day] = dateStr.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className={`relative w-full ${className}`} ref={containerRef}>
      {/* Trigger Button - Perfectly matches input height and style */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
        className={`h-9 w-full rounded-[6px] border bg-[#121212] px-3 text-[14px] flex items-center justify-between cursor-pointer transition-colors outline-none font-sans select-none ${
          isOpen
            ? 'border-[#3b82f6] ring-1 ring-[#3b82f6]/20'
            : 'border-[#262626] hover:border-[#383838] focus:border-[#3b82f6]'
        }`}
      >
        <div className="flex items-center gap-2 truncate">
          <CalendarIcon className={`w-4 h-4 shrink-0 transition-colors ${value ? 'text-[#3b82f6]' : 'text-[#8c8c8c]'}`} />
          {value ? (
            <div className="flex items-center gap-2 truncate">
              <span className="text-white font-medium text-[13px]">{formatDisplay(value)}</span>
              <span className="font-mono text-[12px] text-[#8c8c8c] bg-[#1a1a1a] px-1.5 py-0.5 rounded border border-[#262626]">
                {value}
              </span>
            </div>
          ) : (
            <span className="text-[#8c8c8c] text-[13px]">{placeholder}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {value && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              title="Clear expiry (Set to Never)"
              className="text-[#8c8c8c] hover:text-white p-1 rounded hover:bg-[#222222] transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-[#8c8c8c] transition-transform duration-150 ${
              isOpen ? 'rotate-180 text-white' : ''
            }`}
          />
        </div>
      </div>

      {/* Popover - Compact width */}
      {isOpen && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 w-[280px] max-w-full rounded-[8px] border border-[#262626] bg-[#0c0c0c] shadow-[0_12px_32px_rgba(0,0,0,0.85)] p-3 animate-in fade-in duration-100 font-sans">
          {/* Edge-to-edge Quick Presets Grid */}
          <div className="grid grid-cols-4 gap-1.5 pb-2.5 mb-2.5 border-b border-[#222222]">
            <button
              type="button"
              onClick={() => handlePreset(null)}
              className={`h-6 px-1 text-[11px] font-medium rounded-[4px] border transition-colors cursor-pointer flex items-center justify-center ${
                value === null
                  ? 'bg-[#2563eb]/20 text-[#3b82f6] border-[#2563eb]/50 font-semibold'
                  : 'bg-[#141414] text-[#cccccc] hover:text-white border-[#262626] hover:border-[#383838]'
              }`}
            >
              Never
            </button>
            <button
              type="button"
              onClick={() => handlePreset(30)}
              className="h-6 px-1 text-[11px] font-medium rounded-[4px] bg-[#141414] hover:bg-[#1c1c1c] text-[#cccccc] hover:text-white border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer flex items-center justify-center"
            >
              +30d
            </button>
            <button
              type="button"
              onClick={() => handlePreset(90)}
              className="h-6 px-1 text-[11px] font-medium rounded-[4px] bg-[#141414] hover:bg-[#1c1c1c] text-[#cccccc] hover:text-white border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer flex items-center justify-center"
            >
              +90d
            </button>
            <button
              type="button"
              onClick={() => handlePreset(365)}
              className="h-6 px-1 text-[11px] font-medium rounded-[4px] bg-[#141414] hover:bg-[#1c1c1c] text-[#cccccc] hover:text-white border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer flex items-center justify-center"
            >
              +1y
            </button>
          </div>

          {/* Full-width Calendar Grid */}
          <div className="axiom-datepicker-wrapper w-full">
            <DayPicker
              mode="single"
              selected={selectedDate}
              defaultMonth={selectedDate || new Date()}
              onSelect={handleSelect}
              className="m-0 text-white font-sans text-[12px] w-full"
            />
          </div>

          {/* Bottom Summary Bar */}
          <div className="mt-2.5 pt-2 border-t border-[#222222] flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5 text-[#8c8c8c] truncate">
              {value ? (
                <>
                  <span className="size-1.5 rounded-full bg-[#3b82f6] shrink-0" />
                  <span className="truncate">
                    Expires on <span className="text-white font-medium">{formatDisplay(value)}</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="size-1.5 rounded-full bg-[#30a46c] shrink-0" />
                  <span className="text-[#30a46c] font-medium">Never expires (Permanent)</span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-[#8c8c8c] hover:text-white hover:underline cursor-pointer shrink-0 ml-2 font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
