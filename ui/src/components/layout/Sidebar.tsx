import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Database,
  Key,
  Shield,
  Zap,
  Terminal,
  FileText,
  Activity,
  Server,
  Search,
  X,
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

interface NavItem {
  id: string;
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    title: 'DATA PLANE',
    items: [
      { id: 'overview', label: 'Overview', to: '/overview', icon: LayoutDashboard },
      { id: 'databases', label: 'Databases', to: '/databases', icon: Database },
      { id: 'cache', label: 'Cache Engine', to: '/cache', icon: Zap },
    ],
  },
  {
    title: 'ACCESS & SECURITY',
    items: [
      { id: 'keys', label: 'API Keys', to: '/keys', icon: Key },
      { id: 'roles', label: 'Roles & RBAC', to: '/roles', icon: Shield },
      { id: 'audit', label: 'Audit Log', to: '/audit', icon: FileText },
    ],
  },
  {
    title: 'SYSTEM & TELEMETRY',
    items: [
      { id: 'logs', label: 'Live Logs', to: '/logs', icon: Terminal },
      { id: 'metrics', label: 'Metrics', to: '/metrics', icon: Activity },
      { id: 'system', label: 'System Specs', to: '/system', icon: Server },
    ],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/80 backdrop-blur-sm md:hidden"
        />
      )}

      <aside
        className={`fixed md:sticky top-0 left-0 z-40 h-screen w-[260px] bg-[#000000] border-r border-[#222222] flex flex-col shrink-0 transition-transform duration-200 ease-in-out select-none ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="h-[58px] px-5 flex items-center justify-between border-b border-[#222222] shrink-0">
          <div className="flex items-center gap-2.5">
            {/* Axiom Emblem */}
            <div className="w-6 h-6 rounded bg-[#f38020] flex items-center justify-center text-black font-bold text-xs tracking-tighter shadow-sm">
              ▲
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-sm tracking-tight text-white">AXIOM</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#161718] border border-[#26282a] text-[#a1a1a1]">
                v4.0.0
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="md:hidden text-[#8c8c8c] hover:text-white p-1 rounded hover:bg-[#161616]"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Search Button */}
        <div className="px-3 pt-3 pb-1">
          <button
            type="button"
            onClick={() => {
              onClose();
              window.dispatchEvent(new CustomEvent('open-search-palette'));
            }}
            className="w-full flex items-center justify-between h-8 px-2.5 rounded bg-[#101010] hover:bg-[#161616] border border-[#222222] text-[#8c8c8c] hover:text-white transition-colors text-xs"
          >
            <div className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5" />
              <span>Quick search...</span>
            </div>
            <kbd className="px-1.5 py-0.5 rounded bg-[#1c1c1c] border border-[#2c2c2c] text-[10px] font-mono text-[#777777]">
              Ctrl K
            </kbd>
          </button>
        </div>

        {/* Navigation Section Groups */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
          {SECTIONS.map((section) => (
            <div key={section.title} className="space-y-1">
              <div className="px-2.5 text-[10px] font-mono font-medium text-[#555555] tracking-wider uppercase">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.id}
                      to={item.to}
                      onClick={() => onClose()}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors relative ${
                          isActive
                            ? 'bg-[#141414] text-white font-semibold'
                            : 'text-[#8c8c8c] hover:text-white hover:bg-[#101010]'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <span className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-[#f38020] rounded-r" />
                          )}
                          <Icon className={`w-4 h-4 ${isActive ? 'text-[#f38020]' : 'text-[#666666]'}`} />
                          <span>{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer info badge */}
        <div className="p-3 border-t border-[#222222] shrink-0 text-center">
          <div className="text-[11px] font-mono text-[#555555]">
            Axiom High-Performance Gateway
          </div>
        </div>
      </aside>
    </>
  );
};
