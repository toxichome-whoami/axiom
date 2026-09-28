/*
 * AppSidebar component implementing the Shadcn UI Sidebar architecture.
 * Owned by: ui/components/layout
 * Key deps: ../ui/sidebar, react-router-dom, lucide-react, ../../api
 * Invariants: Semantic navigation hierarchy, collapsible off-canvas/icon states, live user/status footer.
 */

import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '../ui/sidebar';
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
  LogOut,
  User,
  Radio,
  X,
} from 'lucide-react';
import { api } from '../../api';
import { toast } from '../ui/Toast';

interface NavItem {
  id: string;
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_MAIN: NavItem[] = [
  { id: 'overview', label: 'Overview', to: '/overview', icon: LayoutDashboard },
  { id: 'databases', label: 'Database Pools', to: '/databases', icon: Database },
  { id: 'cache', label: 'Cache Engine', to: '/cache', icon: Zap },
];

const NAV_SECURITY: NavItem[] = [
  { id: 'keys', label: 'API Keys', to: '/keys', icon: Key },
  { id: 'roles', label: 'Roles & RBAC', to: '/roles', icon: Shield },
  { id: 'audit', label: 'Audit Log', to: '/audit', icon: FileText },
];

const NAV_SYSTEM: NavItem[] = [
  { id: 'logs', label: 'Live Logs', to: '/logs', icon: Terminal },
  { id: 'metrics', label: 'Metrics', to: '/metrics', icon: Activity },
  { id: 'system', label: 'System Specs', to: '/system', icon: Server },
];

export const AppSidebar: React.FC = () => {
  const navigate = useNavigate();
  const { isCollapsed, setIsOpen } = useSidebar();
  const username = localStorage.getItem('axiom_username') || 'admin';

  const handleLogout = async () => {
    await api.logout();
    toast.info('Signed out of Axiom Gateway');
    navigate('/login');
  };

  const renderNavGroup = (title: string, items: NavItem[]) => (
    <SidebarGroup>
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.id}>
                <NavLink
                  to={item.to}
                  onClick={() => setIsOpen(false)}
                  className="w-full block"
                >
                  {({ isActive }) => (
                    <SidebarMenuButton
                      isActive={isActive}
                      title={isCollapsed ? item.label : undefined}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#f38020]' : 'text-[#8c8c8c]'}`} />
                      {!isCollapsed && <span className="truncate">{item.label}</span>}
                    </SidebarMenuButton>
                  )}
                </NavLink>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="offcanvas">
      {/* Brand Header */}
      <SidebarHeader>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-[#f38020] flex items-center justify-center text-black font-bold text-xs tracking-tighter shrink-0 shadow-sm">
              ▲
            </div>
            {!isCollapsed && (
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-sm tracking-tight text-white font-mono">AXIOM</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#161718] border border-[#26282a] text-[#a1a1a1]">
                  v4.0.0
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="md:hidden text-[#8c8c8c] hover:text-white p-1 rounded hover:bg-[#161616]"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </SidebarHeader>

      {/* Navigation Content */}
      <SidebarContent>
        {/* Quick Search palette trigger */}
        {!isCollapsed && (
          <div className="px-1 pb-1">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                window.dispatchEvent(new CustomEvent('open-search-palette'));
              }}
              className="w-full flex items-center justify-between h-8 px-2.5 rounded bg-[#0c0c0c] hover:bg-[#141414] border border-[#222222] text-[#8c8c8c] hover:text-white transition-colors text-xs"
            >
              <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5" />
                <span>Quick search...</span>
              </div>
              <kbd className="px-1.5 py-0.5 rounded bg-[#181818] border border-[#262626] text-[10px] font-mono text-[#666666]">
                Ctrl K
              </kbd>
            </button>
          </div>
        )}

        {renderNavGroup('DATA PLANE', NAV_MAIN)}
        {renderNavGroup('ACCESS & SECURITY', NAV_SECURITY)}
        {renderNavGroup('SYSTEM & TELEMETRY', NAV_SYSTEM)}
      </SidebarContent>

      {/* User / Session Footer */}
      <SidebarFooter>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-[#181818] border border-[#282828] flex items-center justify-center text-[#cccccc] shrink-0">
              <User className="w-3.5 h-3.5" />
            </div>
            {!isCollapsed && (
              <div className="min-w-0 flex flex-col">
                <span className="text-xs font-medium text-white truncate">{username}</span>
                <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <Radio className="w-2.5 h-2.5 animate-pulse" />
                  <span>online</span>
                </span>
              </div>
            )}
          </div>

          {!isCollapsed && (
            <button
              onClick={handleLogout}
              className="p-1.5 rounded text-[#8c8c8c] hover:text-rose-400 hover:bg-[#181818] transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
};

// Backward compatibility export alias
export const SidebarComponent = AppSidebar;
