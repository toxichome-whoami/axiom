/*
 * Accessible and keyboard-navigable custom select/dropdown component.
 * Owned by: ui/components/shared
 * Key deps: lucide-react
 * Invariants: Complies with WAI-ARIA Combobox / Listbox pattern; supports keyboard navigation (Up/Down/Enter/Escape).
 * Last structural change: Form controls hardening per UI audit component F6.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export interface CustomSelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (val: T) => void;
  className?: string;
  menuWidth?: string;
  size?: 'sm' | 'md';
  placeholder?: string;
  disabled?: boolean;
  variant?: 'default' | 'neutral';
}

/**
 * Dropdown select component implementing accessible keyboard interactions and WAI-ARIA combobox patterns.
 */
export const CustomSelect = <T extends string>({
  value,
  options = [],
  onChange,
  className = '',
  menuWidth = 'w-full min-w-[140px]',
  size = 'md',
  placeholder = 'Select option...',
  disabled = false,
  direction = 'auto',
  variant = 'default',
}: CustomSelectProps<T> & { direction?: 'down' | 'up' | 'auto' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const calculateDirection = () => {
    if (direction === 'up') {
      setOpenUpward(true);
    } else if (direction === 'down') {
      setOpenUpward(false);
    } else if (dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 250 && rect.top > spaceBelow) {
        setOpenUpward(true);
      } else {
        setOpenUpward(false);
      }
    }
  };

  // Close dropdown on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Keep highlighted index in sync when opening
  useEffect(() => {
    if (isOpen) {
      const idx = options.findIndex((o) => o.value === value);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen, value, options]);

  const currentOption = options.find((o) => o.value === value);
  const heightClass = size === 'sm' ? 'h-8 text-[13px]' : 'h-9 text-[13px]';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || options.length === 0) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        calculateDirection();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 + options.length) % options.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (options[highlightedIndex]) {
        onChange(options[highlightedIndex].value);
        setIsOpen(false);
      }
    }
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            if (!isOpen) calculateDirection();
            setIsOpen((prev) => !prev);
          }
        }}
        className={`w-full ${heightClass} px-3 rounded-[8px] bg-[#141414] border flex items-center justify-between cursor-pointer transition-all outline-none font-sans select-none disabled:opacity-50 disabled:cursor-not-allowed ${
          isOpen
            ? variant === 'neutral'
              ? 'border-[#383838] ring-1 ring-white/10 bg-[#161616] text-white'
              : 'border-[#3b82f6] ring-1 ring-[#3b82f6]/20 bg-[#161616] text-white'
            : variant === 'neutral'
              ? 'border-[#262626] hover:border-[#383838] focus:border-[#383838] text-white'
              : 'border-[#262626] hover:border-[#383838] focus:border-[#3b82f6] text-white'
        }`}
      >
        <div className="flex items-center gap-2 truncate">
          {currentOption?.icon}
          <span className="truncate font-medium">{currentOption?.label || placeholder}</span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#8c8c8c] shrink-0 ml-2 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-white' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className={`absolute left-0 ${
            openUpward ? 'bottom-[calc(100%+4px)]' : 'top-[calc(100%+4px)]'
          } rounded-[8px] bg-[#0e0e0e] border border-[#262626] shadow-2xl p-1 z-50 select-none animate-in fade-in duration-100 font-sans max-h-60 overflow-y-auto ${menuWidth}`}
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[#8c8c8c] text-center font-sans">
              No options available
            </div>
          ) : (
            options.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === highlightedIndex;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors cursor-pointer text-left font-sans ${
                    isSelected
                      ? 'bg-[#1a1a1a] text-white font-medium border border-[#333333]'
                      : isHighlighted
                      ? 'bg-[#161616] text-white border border-transparent'
                      : 'text-[#cccccc] hover:bg-[#161616] hover:text-white border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {opt.icon}
                    <span className="truncate">{opt.label}</span>
                  </div>
                  {isSelected && (
                    <Check
                      className={`w-3.5 h-3.5 shrink-0 ml-2 ${
                        variant === 'neutral' ? 'text-white' : 'text-[#3b82f6]'
                      }`}
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
