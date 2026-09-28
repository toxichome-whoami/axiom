/*
 * Shadcn UI Tabs component.
 * Owned by: ui/components/ui
 * Key deps: clsx, tailwind-merge
 * Invariants: Accessible tab switcher with active indicators.
 */

import React from 'react';
import { cn } from '../../utils/cn';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onChange, className }) => {
  return (
    <div className={cn('flex items-center gap-1 border-b border-[#222222]', className)}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
              isActive
                ? 'border-[#3b82f6] text-[#3b82f6] font-semibold'
                : 'border-transparent text-[#8c8c8c] hover:text-[#d1d5db] hover:border-[#333333]'
            )}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={cn(
                  'px-1.5 py-0.2 rounded-full text-[10px] ',
                  isActive ? 'bg-[#3b82f6]/20 text-[#60a5fa]' : 'bg-[#181818] text-[#8c8c8c]'
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
