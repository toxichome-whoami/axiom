/*
 * Primary administrative layout shell and navigation chrome.
 * Owned by: ui/components
 * Key deps: lucide-react, ../api/session, ../api/client
 * Invariants: Keeps authenticated session identity synchronized; provides responsive navigation drawer and keyboard shortcuts.
 * Last structural change: Layout audit hardening per UI audit component F5.
 */

import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../utils/cn';
import { api } from '../api/client';
import { getOperatorUser, clearSession } from '../api/session';
import {
  LayoutDashboard,
  Database,
  Key,
  Shield,
  Bot,
  Terminal,
  Settings,
  LogOut,
  Search,
  Menu,
  X,
} from 'lucide-react';

export type NavPath =
  | '/system'
  | '/system/databases'
  | '/system/keys'
  | '/system/roles'
  | '/system/mcp'
  | '/system/tester'
  | '/system/settings';

interface LayoutProps {
  currentPath: NavPath;
  onNavigate: (path: NavPath) => void;
  title: string;
  children: React.ReactNode;
  onLogout?: () => void;
}

/**
 * Main application shell wrapping content with top-level navigation, sidebar, and profile actions.
 */
export function Layout({ currentPath, onNavigate, title, children, onLogout }: LayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSelectedIndex, setSearchSelectedIndex] = useState(0);

  const userRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Synchronize document title with active page view
  useEffect(() => {
    document.title = title ? `${title} — Axiom Gateway` : 'Axiom Gateway';
  }, [title]);

  const searchItems = [
    { label: 'Overview', path: '/system' as NavPath, icon: LayoutDashboard, category: 'Data & Access' },
    { label: 'Database Pools', path: '/system/databases' as NavPath, icon: Database, category: 'Data & Access' },
    { label: 'API Keys', path: '/system/keys' as NavPath, icon: Key, category: 'Data & Access' },
    { label: 'Roles', path: '/system/roles' as NavPath, icon: Shield, category: 'Data & Access' },
    { label: 'MCP Protocol', path: '/system/mcp' as NavPath, icon: Bot, category: 'Protocols & Tools' },
    { label: 'API Explorer', path: '/system/tester' as NavPath, icon: Terminal, category: 'Protocols & Tools' },
    { label: 'Settings', path: '/system/settings' as NavPath, icon: Settings, category: 'Configuration' },
  ];

  const filteredSearchItems = searchItems.filter(
    (item) =>
      item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userRef.current && !userRef.current.contains(event.target as Node)) {
        setUserOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchModalOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (searchModalOpen) {
      setSearchQuery('');
      setSearchSelectedIndex(0);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [searchModalOpen]);

  useEffect(() => {
    setSearchSelectedIndex(0);
  }, [searchQuery]);

  const handleSearchSelect = (path: NavPath) => {
    setSearchModalOpen(false);
    onNavigate(path);
  };

  const handleModalKeyDown = (e: React.KeyboardEvent) => {
    if (filteredSearchItems.length === 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
      e.preventDefault();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setSearchModalOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchSelectedIndex((prev) => (prev + 1) % filteredSearchItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchSelectedIndex((prev) => (prev - 1 + filteredSearchItems.length) % filteredSearchItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredSearchItems[searchSelectedIndex]) {
        handleSearchSelect(filteredSearchItems[searchSelectedIndex].path);
      }
    }
  };

  const navSections = [
    {
      title: 'Data & Access',
      items: [
        {
          path: '/system' as NavPath,
          label: 'Overview',
          icon: LayoutDashboard,
        },
        {
          path: '/system/databases' as NavPath,
          label: 'Database Pools',
          icon: Database,
        },
        {
          path: '/system/keys' as NavPath,
          label: 'API Keys',
          icon: Key,
        },
        {
          path: '/system/roles' as NavPath,
          label: 'Roles',
          icon: Shield,
        },
      ],
    },
    {
      title: 'Protocols & Tools',
      items: [
        {
          path: '/system/mcp' as NavPath,
          label: 'MCP Protocol',
          icon: Bot,
        },
        {
          path: '/system/tester' as NavPath,
          label: 'API Explorer',
          icon: Terminal,
        },
      ],
    },
    {
      title: 'Configuration',
      items: [
        {
          path: '/system/settings' as NavPath,
          label: 'Settings',
          icon: Settings,
        },
      ],
    },
  ];

  return (
    <div className="flex min-h-screen w-full bg-[#000000] text-[#f3f4f6] font-sans antialiased">
      {/* Mobile Drawer Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-xs md:hidden animate-in fade-in duration-200"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Cloudflare/Vercel Left Sidebar (matched exactly to binary_alive) */}
      <aside
        data-sidebar="sidebar"
        className={cn(
          'flex min-h-screen shrink-0 flex-col bg-[#000000] border-r border-[#222222] transition-[width,transform] duration-200 select-none z-40',
          isCollapsed ? 'w-[58px]' : 'w-[260px]',
          'fixed md:sticky top-0 h-screen',
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        {/* Top Header: Brand Name and Version */}
        <div
          data-sidebar="header"
          className={cn(
            'flex h-[58px] shrink-0 items-center justify-center border-b border-[#222222] transition-[padding] duration-200 select-none relative z-30',
            isCollapsed ? 'px-2' : 'px-4'
          )}
        >
          <button
            onClick={() => onNavigate('/system')}
            aria-label="Axiom Gateway"
            className="flex items-center justify-center gap-2 bg-transparent border-0 p-0 text-center cursor-pointer min-w-0 group"
          >
            {isCollapsed ? (
              <span className="font-['Montserrat',sans-serif] font-semibold text-[13px] text-[#F2F3F3] tracking-widest uppercase">
                AX
              </span>
            ) : (
              <div className="flex items-center justify-center gap-2 min-w-0">
                <span className="font-['Montserrat',sans-serif] text-[17px] text-[#F2F3F3] font-semibold tracking-[0.1em] truncate">
                  Axiom Gateway
                </span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] bg-[#161718] border border-[#26282A] text-[12px] text-[#A1A1A1] tracking-normal font-mono">
                  v4.0
                </span>
              </div>
            )}
          </button>

          {/* Mobile close button positioned absolute right */}
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="p-1 text-[#8c8c8c] hover:text-white md:hidden absolute right-3 shrink-0 cursor-pointer"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Viewport & Scroll Area */}
        <nav
          data-sidebar="content"
          className="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden px-[11px] py-3 scrollbar-thin scrollbar-thumb-[#222222]"
        >
          {/* Quick Search Shortcut Bar (#root > div > aside > nav > div > div > button) */}
          <div className="w-full shrink-0 px-0.5 pt-[0.5px] mb-3">
            {isCollapsed ? (
              <button
                type="button"
                onClick={() => setSearchModalOpen(true)}
                title="Quick search (Ctrl K)"
                className="flex w-[34px] h-[34px] items-center justify-center rounded-[8px] bg-[#0c0c0c] ring-1 ring-[#262626] text-[#8c8c8c] hover:bg-[#161616] hover:text-white mx-auto transition-colors cursor-pointer"
              >
                <Search className="w-4 h-4 opacity-60" />
              </button>
            ) : (
              <div className="relative flex items-center group">
                <button
                  type="button"
                  onClick={() => setSearchModalOpen(true)}
                  className="group items-center select-none border-0 rounded-[8px] bg-[#0c0c0c] text-[#d4d4d4] ring-1 ring-[#262626] hover:ring-[#3b82f6] flex h-8 text-sm font-normal shrink-0 w-full overflow-hidden px-3 gap-2.5 transition-all cursor-pointer text-left"
                >
                  <Search className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0 opacity-60" />
                  <span className="w-full text-xs text-[#8c8c8c] font-normal flex-1">Quick search...</span>
                  <kbd className="ml-auto font-sans text-xs font-semibold text-[#d4d4d4] whitespace-nowrap select-none pointer-events-none shrink-0">
                    <span className="text-[#8c8c8c] font-medium">Ctrl</span>&nbsp;K
                  </kbd>
                </button>
              </div>
            )}
          </div>

          {/* Navigation Menu Tree */}
          <ul data-sidebar="menu" className="m-0 flex min-w-0 list-none flex-col items-stretch gap-y-px p-0">
            {navSections.map((section, idx) => (
              <div key={idx} data-sidebar="group" className="flex min-w-0 flex-col gap-y-px">
                {/* Section Group Label (Cloudflare title-case) */}
                {!isCollapsed && section.title && (
                  <div data-sidebar="group-label" className="grid overflow-hidden">
                    <div className="mt-4 mb-2 truncate px-3 text-sm font-medium text-[#8c8c8c]">
                      {section.title}
                    </div>
                  </div>
                )}

                {/* Section Items */}
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentPath === item.path;

                  return (
                    <li key={item.path} data-sidebar="menu-item" className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          onNavigate(item.path);
                          setIsSidebarOpen(false);
                        }}
                        title={item.label}
                        className={cn(
                          'group/menu-button relative flex w-full min-w-0 cursor-pointer items-center rounded-[8px] outline-none min-h-[34px] py-0 text-sm font-medium transition-colors duration-200',
                          isCollapsed ? 'justify-center px-0' : 'gap-2.5 px-3',
                          isActive
                            ? 'bg-[#111111] text-white'
                            : 'bg-transparent text-[#d4d4d4] hover:bg-[#161616] hover:text-white'
                        )}
                      >
                        <div className={cn('flex min-w-0 flex-1 items-center', isCollapsed ? 'justify-center' : 'gap-3')}>
                          <Icon
                            className={cn(
                              'w-4 h-4 shrink-0 transition duration-200',
                              isActive
                                ? 'opacity-100 text-[#3b82f6]'
                                : 'opacity-50 group-hover/menu-button:opacity-80'
                            )}
                          />
                          {!isCollapsed && (
                            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left">
                              <span className="truncate">{item.label}</span>
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </div>
            ))}
          </ul>
        </nav>

        {/* Sidebar Footer: Toggle Collapse */}
        <div
          data-sidebar="footer"
          className={cn(
            'flex h-12 min-h-[48px] shrink-0 items-center border-t border-[#222222] whitespace-nowrap bg-[#000000] sticky bottom-0 z-20 transition-all',
            isCollapsed ? 'px-2 justify-center' : 'px-4'
          )}
        >
          <button
            type="button"
            data-sidebar="trigger"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex w-[34px] h-[34px] shrink-0 items-center justify-center rounded-[8px] text-[#8c8c8c] hover:bg-[#161616] hover:text-neutral-200 cursor-pointer transition-colors"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="shrink-0"
            >
              <path d="M21.25 6.72v10.56a2.97 2.97 0 0 1-2.97 2.97H5.72a2.97 2.97 0 0 1-2.97-2.97V6.72a2.97 2.97 0 0 1 2.97-2.97h12.56a2.97 2.97 0 0 1 2.97 2.97" />
              <path
                d="M6.25 7.25v9.5"
                className={cn(
                  'transition-transform duration-200',
                  isCollapsed ? 'translate-x-1' : 'translate-x-px'
                )}
              />
            </svg>
          </button>
        </div>
      </aside>

      {/* Main Workspace Frame */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen bg-[#000000]">
        {/* Top Header Bar (matched to Cloudflare TopBar in binary_alive) */}
        <header className="h-[58px] bg-[#000000] shrink-0 border-b border-[#222222] flex items-center px-4 sm:px-6 z-20 sticky top-0 gap-2 select-none justify-between">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-1.5 -ml-1 text-[#8c8c8c] hover:text-white rounded-lg md:hidden hover:bg-[#161616] transition-colors cursor-pointer"
            aria-label="Toggle navigation"
            type="button"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 sm:gap-3 ml-auto">
            {/* Cluster Status Pill */}
            <div className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[#222222] bg-[#0c0c0c] px-2.5 py-1 text-[11px] font-medium text-[#8c8c8c]">
              <span className="size-1.5 rounded-full bg-[#30a46c]"></span>
              <span>Online :4500</span>
            </div>

            {/* Operator Profile Dropdown (matched to Cloudflare Kumo button) */}
            <div ref={userRef} className="relative">
              <button
                type="button"
                onClick={() => setUserOpen(!userOpen)}
                className={cn(
                  'group flex shrink-0 font-medium select-none border-0 focus:outline-none cursor-pointer gap-1.5 rounded-lg text-sm items-center justify-center p-0 shadow-none size-8 transition-colors',
                  userOpen
                    ? 'text-white bg-[#1a1a1a]'
                    : 'text-[#8c8c8c] hover:text-white hover:bg-[#161616]'
                )}
                aria-label="User menu"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  fill="currentColor"
                  viewBox="0 0 256 256"
                  className="w-4 h-4 text-[#8c8c8c] group-hover:text-white transition-colors"
                >
                  <path d="M230.93,220a8,8,0,0,1-6.93,4H32a8,8,0,0,1-6.92-12c15.23-26.33,38.7-45.21,66.09-54.16a72,72,0,1,1,73.66,0c27.39,8.95,50.86,27.83,66.09,54.16A8,8,0,0,1,230.93,220Z" />
                </svg>
              </button>

              {userOpen && (
                <div className="absolute right-0 top-full mt-2 w-[260px] bg-[#0e0e0e] border border-[#262626] rounded-[8px] shadow-2xl p-1.5 z-50 select-none animate-in fade-in zoom-in-95 font-sans">
                  {/* Account info header */}
                  <div className="p-2.5 rounded-lg bg-[#141414] border border-[#1f1f1f] mb-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[14px] font-medium text-white truncate leading-tight font-mono">
                        {getOperatorUser()}
                      </span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium text-[#8c8c8c] bg-[#1a1a1a] border border-[#262626] capitalize shrink-0">
                        Operator
                      </span>
                    </div>
                    <p className="text-[13px] text-[#8c8c8c] truncate leading-tight mt-1 font-mono">
                      {getOperatorUser()}@axiom.local
                    </p>
                  </div>

                  {/* Navigation Items */}
                  <div className="space-y-0.5 py-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        onNavigate('/system/settings');
                        setUserOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[14px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-lg transition-colors cursor-pointer text-left"
                    >
                      <Settings className="w-4 h-4 text-[#8c8c8c] shrink-0" />
                      <span>Settings</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onNavigate('/system/keys');
                        setUserOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[14px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-lg transition-colors cursor-pointer text-left"
                    >
                      <Key className="w-4 h-4 text-[#8c8c8c] shrink-0" />
                      <span>API Key Vault</span>
                    </button>
                  </div>

                  {/* Edge-to-edge line through padding */}
                  <div className="-mx-1.5 h-px bg-[#222222] my-1.5" />

                  {/* Sign out */}
                  <button
                    type="button"
                    onClick={async () => {
                      setUserOpen(false);
                      try {
                        await api.logout();
                      } catch {
                        // Ignore network logout errors
                      }
                      if (onLogout) {
                        onLogout();
                      } else {
                        clearSession();
                        window.location.href = '/system';
                      }
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[14px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-lg transition-colors cursor-pointer text-left"
                  >
                    <LogOut className="w-4 h-4 text-[#8c8c8c] shrink-0" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Workspace Canvas Area */}
        <main className="flex-1 p-4 sm:p-6 w-full max-w-[1600px] mx-auto min-w-0">
          {children}
        </main>

        {/* Cloudflare Production Site Footer (from binary_alive) */}
        <footer
          className="h-12 shrink-0 bg-[#000000] border-t border-[#222222] mt-auto px-4 md:px-6 flex items-center justify-center select-none"
          id="site-footer"
        >
          <div className="w-full flex items-center justify-center">
            <ul className="m-0 p-0 flex items-center justify-center flex-wrap list-none text-[13px] leading-none">
              {/* Documentation */}
              <li className="flex items-center">
                <a
                  className="text-[#cccccc] hover:text-white transition-colors whitespace-nowrap no-underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  href="https://github.com/toxichome-whoami/axiom#readme"
                >
                  Documentation
                </a>
              </li>

              {/* Divider */}
              <li aria-hidden="true" className="h-3.5 w-px bg-[#262626] mx-3.5 shrink-0" />

              {/* GitHub */}
              <li className="flex items-center">
                <a
                  className="group flex items-center gap-1.5 text-[#cccccc] hover:text-white transition-colors whitespace-nowrap no-underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  href="https://github.com/toxichome-whoami/axiom"
                >
                  <svg
                    className="w-3.5 h-3.5 text-[#8c8c8c] group-hover:text-white transition-colors"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                    />
                  </svg>
                  <span>GitHub</span>
                </a>
              </li>

              {/* Divider */}
              <li aria-hidden="true" className="h-3.5 w-px bg-[#262626] mx-3.5 shrink-0" />

              {/* Copyright */}
              <li className="flex items-center">
                <span className="text-[13px] text-[#737373] whitespace-nowrap leading-none">
                  © 2026 toxichome
                </span>
              </li>
            </ul>
          </div>
        </footer>
      </div>

      {/* Global Quick Search Modal (exact matching binary_alive) */}
      {searchModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={() => setSearchModalOpen(false)}
          />
          <div className="relative w-full max-w-lg bg-[#0c0c0c] border border-[#262626] rounded-[8px] shadow-2xl p-1.5 flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-[#0e0e0e] border border-[#222222] rounded-[6px] overflow-hidden flex flex-col">
              <div className="flex items-center px-4 py-3 border-b border-[#222222]">
                <Search className="w-5 h-5 text-[#8c8c8c] mr-3 shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  className="flex-1 bg-transparent border-none outline-none text-[14px] text-white placeholder-[#8c8c8c]"
                  placeholder="Search for pages..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleModalKeyDown}
                />
                <kbd className="ml-2 font-sans text-[10px] font-semibold text-[#8c8c8c] bg-[#1a1a1a] px-2 py-1 rounded border border-[#262626] select-none">
                  ESC
                </kbd>
              </div>

              <div className="max-h-[300px] overflow-y-auto p-2 scrollbar-thin">
                {filteredSearchItems.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[#8c8c8c] text-sm">
                    No results found for "{searchQuery}"
                  </div>
                ) : (
                  filteredSearchItems.map((item, index) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => handleSearchSelect(item.path)}
                        className={cn(
                          'w-full flex items-center px-3.5 py-2.5 rounded-lg text-sm transition-colors cursor-pointer text-left',
                          index === searchSelectedIndex
                            ? 'bg-[#1a1a1a] text-white'
                            : 'text-[#8c8c8c] hover:bg-[#141414] hover:text-white'
                        )}
                      >
                        <Icon
                          className={cn(
                            'w-4 h-4 mr-3 shrink-0',
                            index === searchSelectedIndex ? 'text-[#3b82f6] opacity-100' : 'opacity-60'
                          )}
                        />
                        <span className="flex-1 truncate">{item.label}</span>
                        <span className="text-[11px] text-[#666666] font-normal">{item.category}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
