/*
 * TopBar navigation header built with Shadcn UI primitives.
 * Owned by: ui/components/layout
 * Key deps: ../ui, react-router-dom, lucide-react, ../../api
 * Invariants: Hosts SidebarTrigger, live probe latency ping, search palette trigger, and snapshot reload.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { Button, Badge, SidebarTrigger, toast } from '../ui';
import {
  Search,
  RefreshCw,
  LogOut,
  User,
  Shield,
  ExternalLink,
  ChevronDown,
} from 'lucide-react';

export const TopBar: React.FC = () => {
  const navigate = useNavigate();
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const username = localStorage.getItem('axiom_username') || 'admin';

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
      {/* Sidebar toggle button (collapses desktop, opens mobile) */}
      <SidebarTrigger />

      {/* Latency Probe Status */}
      <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#0e0e0e] border border-[#222222]">
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
            window.dispatchEvent(new CustomEvent('open-search-palette'));
          }}
          className="hidden sm:flex items-center gap-2 h-8 px-2.5 rounded-md bg-[#0c0c0c] hover:bg-[#141414] border border-[#222222] text-xs text-[#8c8c8c] hover:text-white transition-colors"
          type="button"
        >
          <Search className="w-3.5 h-3.5" />
          <span>Search...</span>
          <kbd className="px-1.5 py-0.5 rounded bg-[#181818] border border-[#262626] text-[10px] font-mono text-[#777777]">
            Ctrl K
          </kbd>
        </button>

        {/* Reload Snapshot */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleReloadSnapshot}
          disabled={isReloading}
          className="h-8 gap-1.5"
          title="Force ArcSwap Metadata Snapshot Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#f38020] ${isReloading ? 'animate-spin' : ''}`} />
          <span className="hidden md:inline">Sync Snapshot</span>
        </Button>

        {/* User profile dropdown */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="flex items-center gap-2 h-8 px-2 rounded-md hover:bg-[#141414] border border-transparent hover:border-[#222222] transition-colors"
            type="button"
          >
            <div className="w-6 h-6 rounded-full bg-[#181818] border border-[#282828] flex items-center justify-center text-[#cccccc] text-xs">
              <User className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-medium text-white hidden sm:inline">
              {username}
            </span>
            <ChevronDown className="w-3 h-3 text-[#8c8c8c]" />
          </button>

          {isUserMenuOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-48 rounded-md border border-[#262626] bg-[#0c0c0c] p-1 shadow-2xl z-50 text-xs">
              <div className="px-2.5 py-1.5 border-b border-[#1e1e1e] mb-1">
                <span className="block font-medium text-white truncate">{username}</span>
                <span className="block text-[10px] font-mono text-[#666666]">Operator Session</span>
              </div>
              <button
                onClick={() => {
                  setIsUserMenuOpen(false);
                  navigate('/system');
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[#161616] text-[#cccccc] hover:text-white transition-colors"
              >
                <Shield className="w-3.5 h-3.5 text-[#f38020]" />
                <span>System Specs</span>
              </button>
              <a
                href="/health"
                target="_blank"
                rel="noreferrer"
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[#161616] text-[#cccccc] hover:text-white transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[#3b82f6]" />
                <span>Health Probe</span>
              </a>
              <div className="border-t border-[#1e1e1e] my-1" />
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-rose-500/20 text-[#8c8c8c] hover:text-rose-400 transition-colors"
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
