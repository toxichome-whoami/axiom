import React, { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export const CustomSelect = <T extends string>({
  value,
  options,
  onChange,
  className = '',
  menuWidth = 'w-full min-w-[140px]',
  size = 'md',
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (val: T) => void;
  className?: string;
  menuWidth?: string;
  size?: 'sm' | 'md';
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const currentOption = options.find((o) => o.value === value) || options[0];

  const heightClass = size === 'sm' ? 'h-8 text-[13px]' : 'h-9 text-[13px]';

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full ${heightClass} px-3 rounded-[8px] bg-[#141414] border flex items-center justify-between cursor-pointer transition-all outline-none font-sans select-none ${
          isOpen
            ? 'border-[#3b82f6] ring-1 ring-[#3b82f6]/20 bg-[#161616] text-white'
            : 'border-[#262626] hover:border-[#383838] focus:border-[#3b82f6] text-white'
        }`}
      >
        <div className="flex items-center gap-2 truncate">
          {currentOption?.icon}
          <span className="truncate font-medium">{currentOption?.label || value}</span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#8c8c8c] shrink-0 ml-2 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-white' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute left-0 top-[calc(100%+4px)] rounded-[8px] bg-[#0e0e0e] border border-[#262626] shadow-2xl p-1 z-50 select-none animate-in fade-in duration-100 font-sans max-h-60 overflow-y-auto ${menuWidth}`}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors cursor-pointer text-left font-sans ${
                  isSelected
                    ? 'bg-[#1a1a1a] text-white font-medium border border-[#333333]'
                    : 'text-[#cccccc] hover:bg-[#161616] hover:text-white border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  {opt.icon}
                  <span className="truncate">{opt.label}</span>
                </div>
                {isSelected && (
                  <Check className="w-3.5 h-3.5 text-[#3b82f6] shrink-0 ml-2" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
