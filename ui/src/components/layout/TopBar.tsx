import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { toast } from '../ui/Toast';
import {
  Menu,
  Search,
  RefreshCw,
  LogOut,
  User,
  Shield,
  ExternalLink,
  ChevronDown,
} from 'lucide-react';

interface TopBarProps {
  onToggleSidebar: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onToggleSidebar }) => {
  const navigate = useNavigate();
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const username = localStorage.getItem('axiom_username') || 'Administrator';

  // Live ping probe
  useEffect(() => {
    let mounted = true;
    const probe = async () => {
      const t0 = performance.now();
      try {
        await api.getHealth();
        if (mounted) {
          setLatencyMs(Math.round(performance.now() - t0));
        }
      } catch {
        if (mounted) setLatencyMs(null);
      }
    };

    probe();
    const interval = setInterval(probe, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleReloadSnapshot = async () => {
    try {
      setIsReloading(true);
      const res = await api.reloadMetadata();
      toast.success(res.message || 'Metadata cache snapshot refreshed');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to reload snapshot');
    } finally {
      setIsReloading(false);
    }
  };

  const handleLogout = async () => {
    await api.logout();
    toast.info('Signed out of Axiom Gateway');
    navigate('/login');
  };

  return (
    <header className="h-[58px] bg-[#000000] shrink-0 border-b border-[#222222] flex items-center px-4 z-20 sticky top-0 gap-3 select-none">
      {/* Mobile drawer toggle */}
      <button
        onClick={onToggleSidebar}
        className="p-1.5 -ml-1 text-[#8c8c8c] hover:text-white rounded-md md:hidden hover:bg-[#161616] transition-colors"
        aria-label="Toggle navigation"
        type="button"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Latency Probe Status */}
      <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#0e0e0e] border border-[#222222]">
        <div className="relative flex items-center justify-center">
          <span className={`w-2 h-2 rounded-full ${latencyMs !== null ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span className={`absolute w-3.5 h-3.5 rounded-full animate-ping opacity-30 ${latencyMs !== null ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        </div>
        <span className="text-[11px] font-mono text-[#8c8c8c]">
          {latencyMs !== null ? `${latencyMs}ms` : 'Probing...'}
        </span>
      </div>

      {/* Right controls */}
      <div className="ml-auto flex items-center gap-2">
        {/* Quick Search Shortcut */}
        <button
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
          }}
          className="hidden sm:flex items-center gap-2 h-8 px-2.5 rounded bg-[#101010] hover:bg-[#161616] border border-[#262626] text-xs text-[#8c8c8c] hover:text-white transition-colors"
          type="button"
        >
          <Search className="w-3.5 h-3.5" />
          <span>Search...</span>
          <kbd className="px-1.5 py-0.5 rounded bg-[#1c1c1c] border border-[#2e2e2e] text-[10px] font-mono text-[#777777]">
            Ctrl K
          </kbd>
        </button>

        {/* Reload Snapshot */}
        <button
          onClick={handleReloadSnapshot}
          disabled={isReloading}
          className="h-8 px-2.5 rounded bg-[#101010] hover:bg-[#161616] border border-[#262626] text-xs font-medium text-[#cccccc] hover:text-white transition-colors flex items-center gap-1.5"
          title="Force ArcSwap Metadata Snapshot Refresh"
          type="button"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#f38020] ${isReloading ? 'animate-spin' : ''}`} />
          <span className="hidden md:inline">Sync Snapshot</span>
        </button>

        {/* User Profile Popover */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="flex items-center gap-2 h-8 px-2 rounded hover:bg-[#161616] transition-colors text-left"
            type="button"
          >
            <div className="w-6 h-6 rounded-full bg-[#1c1c1c] border border-[#2a2a2a] flex items-center justify-center text-[#f38020]">
              <User className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-medium text-[#eaeaea] hidden md:inline">{username}</span>
            <ChevronDown className="w-3 h-3 text-[#666666]" />
          </button>

          {isUserMenuOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-lg border border-[#262626] bg-[#0c0c0c] shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-2.5 py-2 border-b border-[#222222] mb-1">
                <div className="text-xs font-semibold text-white">{username}</div>
                <div className="text-[11px] text-[#666666] flex items-center gap-1 mt-0.5">
                  <Shield className="w-3 h-3 text-[#f38020]" />
                  <span>Admin Role</span>
                </div>
              </div>

              <a
                href="https://github.com/toxichome-whoami/axiom"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs text-[#a1a1a1] hover:text-white hover:bg-[#161616] transition-colors"
              >
                <span>Documentation</span>
                <ExternalLink className="w-3 h-3 text-[#666666]" />
              </a>

              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors mt-1"
                type="button"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
