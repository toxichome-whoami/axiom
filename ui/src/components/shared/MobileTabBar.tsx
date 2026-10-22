/*
 * Thumb-friendly Mobile Bottom Tab Bar for phone viewports (< 768px).
 * Owned by: ui/components/shared
 * Key deps: lucide-react, ../Layout, ../../utils/cn
 * Invariants: Touch targets >= 44px; safe-area bottom inset (pb-safe); zero layout shift.
 */

import React from 'react';
import { LayoutDashboard, Database, Table, HardDrive, Menu } from 'lucide-react';
import { NavPath } from '../Layout';
import { cn } from '../../utils/cn';

interface MobileTabBarProps {
  currentPath: NavPath;
  onNavigate: (path: NavPath) => void;
  onOpenMenu: () => void;
}

export function MobileTabBar({ currentPath, onNavigate, onOpenMenu }: MobileTabBarProps) {
  const tabs = [
    {
      label: 'Overview',
      path: '/system' as NavPath,
      icon: LayoutDashboard,
      isActive: currentPath === '/system',
    },
    {
      label: 'Databases',
      path: '/system/databases' as NavPath,
      icon: Database,
      isActive: currentPath === '/system/databases',
    },
    {
      label: 'Tables',
      path: '/system/tables' as NavPath,
      icon: Table,
      isActive: currentPath === '/system/tables',
    },
    {
      label: 'Storage',
      path: '/system/storage' as NavPath,
      icon: HardDrive,
      isActive: currentPath === '/system/storage',
    },
  ];

  return (
    <nav
      aria-label="Mobile Bottom Navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#000000]/95 backdrop-blur-md border-t border-[#222222] pb-safe select-none"
    >
      <div className="flex items-center justify-around h-[54px] px-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.path}
              type="button"
              onClick={() => onNavigate(tab.path)}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full min-h-[44px] py-1 gap-1 text-[10px] font-medium transition-colors cursor-pointer active:scale-95 touch-manipulation',
                tab.isActive
                  ? 'text-[#3b82f6]'
                  : 'text-[#8c8c8c] hover:text-[#cccccc]'
              )}
            >
              <Icon className={cn('w-4 h-4 shrink-0 transition-transform', tab.isActive && 'scale-110')} />
              <span className="truncate max-w-[64px]">{tab.label}</span>
            </button>
          );
        })}

        {/* More / Menu Drawer Toggle */}
        <button
          type="button"
          onClick={onOpenMenu}
          className="flex flex-col items-center justify-center flex-1 h-full min-h-[44px] py-1 gap-1 text-[10px] font-medium text-[#8c8c8c] hover:text-[#cccccc] transition-colors cursor-pointer active:scale-95 touch-manipulation"
          aria-label="Open full menu"
        >
          <Menu className="w-4 h-4 shrink-0" />
          <span className="truncate max-w-[64px]">More</span>
        </button>
      </div>
    </nav>
  );
}
