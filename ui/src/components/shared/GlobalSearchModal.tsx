import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutDashboard,
  Database,
  Key,
  Shield,
  Zap,
  Terminal,
  FileText,
  Activity,
  Server,
  ArrowRight,
} from 'lucide-react';

interface SearchItem {
  id: string;
  title: string;
  category: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SEARCH_ITEMS: SearchItem[] = [
  { id: 'overview', title: 'System Overview & Telemetry', category: 'Data Plane', to: '/overview', icon: LayoutDashboard },
  { id: 'databases', title: 'Databases & Connection Pools', category: 'Data Plane', to: '/databases', icon: Database },
  { id: 'keys', title: 'API Keys & Token Management', category: 'Access & Security', to: '/keys', icon: Key },
  { id: 'roles', title: 'Roles & RBAC Permissions Matrix', category: 'Access & Security', to: '/roles', icon: Shield },
  { id: 'cache', title: 'Unified L1/L2 Cache Engine', category: 'Data Plane', to: '/cache', icon: Zap },
  { id: 'logs', title: 'System Diagnostic Logs Stream', category: 'System & Telemetry', to: '/logs', icon: Terminal },
  { id: 'audit', title: 'Security Audit Activity Log', category: 'Access & Security', to: '/audit', icon: FileText },
  { id: 'metrics', title: 'Prometheus Telemetry & Metrics', category: 'System & Telemetry', to: '/metrics', icon: Activity },
  { id: 'system', title: 'Host Specs & Runtime Process', category: 'System & Telemetry', to: '/system', icon: Server },
];

export const GlobalSearchModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const filtered = SEARCH_ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.category.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = (to: string) => {
    setIsOpen(false);
    setQuery('');
    navigate(to);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex].to);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-[560px] rounded-lg border border-[#262626] bg-[#0c0c0c] shadow-2xl overflow-hidden flex flex-col">
        {/* Search Input Bar */}
        <div className="flex items-center px-4 border-b border-[#222222] bg-[#101010]">
          <Search className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a command or search routes..."
            className="w-full h-11 bg-transparent px-3 text-xs text-white placeholder-[#666666] focus:outline-none"
          />
          <kbd className="px-1.5 py-0.5 rounded bg-[#1a1a1a] border border-[#2c2c2c] text-[10px] font-mono text-[#8c8c8c]">
            ESC
          </kbd>
        </div>

        {/* Search Results */}
        <div className="max-h-[340px] overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#666666]">
              No routes or commands matching &quot;{query}&quot;
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item.to)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-left transition-colors ${
                    isSelected ? 'bg-[#181818] text-white' : 'text-[#a1a1a1] hover:bg-[#141414] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`p-1 rounded ${isSelected ? 'text-[#f38020]' : 'text-[#666666]'}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-medium">{item.title}</div>
                      <div className="text-[10px] text-[#666666]">{item.category}</div>
                    </div>
                  </div>
                  <ArrowRight className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-transparent'}`} />
                </button>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2 border-t border-[#222222] bg-[#080808] flex items-center justify-between text-[11px] text-[#666666]">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-mono text-[#888888]">↑↓</kbd> Navigate
            </span>
            <span>
              <kbd className="font-mono text-[#888888]">Enter</kbd> Select
            </span>
          </div>
          <span>Axiom Command Palette</span>
        </div>
      </div>
    </div>
  );
};
