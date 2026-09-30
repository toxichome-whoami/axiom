import React, { useState, useEffect, useRef } from 'react';

export const CustomSelect = <T extends string>({
  value,
  options,
  onChange,
  className = '',
  menuWidth = 'w-full min-w-[140px]',
}: {
  value: T;
  options: { value: T; label: string }[];
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
        className={`w-full h-9 px-3 rounded-[8px] bg-[#141414] border text-[14px] text-white flex items-center justify-between cursor-pointer transition-colors ${
          isOpen ? 'border-[#2f80ed]' : 'border-[#262626] hover:border-[#383838]'
        }`}
      >
        <span className="truncate">{currentOption?.label || value}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          fill="currentColor"
          viewBox="0 0 256 256"
          className={`text-[#777777] shrink-0 ml-1.5 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-white' : ''
          }`}
        >
          <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
        </svg>
      </button>

      {isOpen && (
        <div
          className={`absolute left-0 top-10 rounded-md bg-[#0c0c0c] border border-[#262626] shadow-2xl p-1 z-50 select-none ${menuWidth}`}
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
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-[14px] transition-colors cursor-pointer text-left ${
                  isSelected
                    ? 'bg-[#181818] text-white font-medium'
                    : 'text-[#cccccc] hover:bg-[#141414] hover:text-white'
                }`}
              >
                <span>{opt.label}</span>
                {isSelected && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    fill="currentColor"
                    viewBox="0 0 256 256"
                    className="text-[#2f80ed] shrink-0"
                  >
                    <path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
