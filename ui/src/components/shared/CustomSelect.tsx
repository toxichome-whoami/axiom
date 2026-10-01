import React, { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export const CustomSelect = <T extends string>({
  value,
  options,
  onChange,
  className = '',
  menuWidth = 'w-full min-w-[140px]',
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (val: T) => void;
  className?: string;
  menuWidth?: string;
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

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full h-9 px-3 rounded-[6px] bg-[#121212] border text-[14px] text-white flex items-center justify-between cursor-pointer transition-colors outline-none font-sans ${
          isOpen
            ? 'border-[#3b82f6] ring-1 ring-[#3b82f6]/20'
            : 'border-[#262626] hover:border-[#383838] focus:border-[#3b82f6]'
        }`}
      >
        <div className="flex items-center gap-2 truncate">
          {currentOption?.icon}
          <span className="truncate">{currentOption?.label || value}</span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#8c8c8c] shrink-0 ml-2 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-white' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute left-0 top-[calc(100%+4px)] rounded-[8px] bg-[#0c0c0c] border border-[#262626] shadow-2xl p-1 z-50 select-none animate-in fade-in duration-100 font-sans max-h-60 overflow-y-auto ${menuWidth}`}
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
                className={`w-full flex items-center justify-between px-3 py-2 rounded-[6px] text-[14px] transition-colors cursor-pointer text-left font-sans ${
                  isSelected
                    ? 'bg-[#161616] text-white font-medium border border-[#333333]'
                    : 'text-[#cccccc] hover:bg-[#141414] hover:text-white border border-transparent'
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
