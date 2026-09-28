/*
 * Shadcn UI Sidebar primitives family.
 * Owned by: ui/components/ui
 * Key deps: React, clsx, tailwind-merge, lucide-react
 * Invariants: Provides collapsible sidebar context, responsive off-canvas mobile view, and semantic subcomponents.
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { cn } from '../../utils/cn';
import { PanelLeft } from 'lucide-react';

interface SidebarContextValue {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isCollapsed: boolean;
  toggleSidebar: () => void;
  toggleCollapse: () => void;
}

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}

export interface SidebarProviderProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
  defaultCollapsed?: boolean;
}

export const SidebarProvider: React.FC<SidebarProviderProps> = ({
  children,
  defaultOpen = false,
  defaultCollapsed = false,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const toggleSidebar = () => setIsOpen((prev) => !prev);
  const toggleCollapse = () => setIsCollapsed((prev) => !prev);

  // Keyboard shortcut Ctrl+B or Cmd+B to toggle collapse
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleCollapse();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <SidebarContext.Provider
      value={{ isOpen, setIsOpen, isCollapsed, toggleSidebar, toggleCollapse }}
    >
      {children}
    </SidebarContext.Provider>
  );
};

export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  collapsible?: 'offcanvas' | 'icon' | 'none';
}

export const Sidebar = React.forwardRef<HTMLElement, SidebarProps>(
  ({ className, collapsible = 'offcanvas', children, ...props }, ref) => {
    const { isOpen, setIsOpen, isCollapsed } = useSidebar();

    return (
      <>
        {/* Mobile backdrop for offcanvas */}
        {isOpen && (
          <div
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm md:hidden"
            aria-hidden="true"
          />
        )}

        <aside
          ref={ref}
          data-collapsed={isCollapsed}
          className={cn(
            'fixed md:sticky top-0 left-0 z-40 h-screen bg-[#000000] border-r border-[#222222] flex flex-col shrink-0 select-none transition-all duration-200 ease-in-out',
            isCollapsed ? 'w-[64px]' : 'w-[260px]',
            isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
            className
          )}
          {...props}
        >
          {children}
        </aside>
      </>
    );
  }
);
Sidebar.displayName = 'Sidebar';

export const SidebarHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('h-[58px] px-4 flex items-center justify-between border-b border-[#222222] shrink-0', className)}
      {...props}
    />
  )
);
SidebarHeader.displayName = 'SidebarHeader';

export const SidebarContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex-1 overflow-y-auto px-3 py-3 space-y-4 overflow-x-hidden', className)}
      {...props}
    />
  )
);
SidebarContent.displayName = 'SidebarContent';

export const SidebarFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('p-3 border-t border-[#222222] shrink-0 bg-[#000000]', className)}
      {...props}
    />
  )
);
SidebarFooter.displayName = 'SidebarFooter';

export const SidebarGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('space-y-1', className)} {...props} />
  )
);
SidebarGroup.displayName = 'SidebarGroup';

export const SidebarGroupLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { isCollapsed } = useSidebar();
    if (isCollapsed) return null;
    return (
      <div
        ref={ref}
        className={cn(
          'px-2.5 py-1 text-[10px] font-mono font-medium text-[#666666] tracking-wider uppercase',
          className
        )}
        {...props}
      />
    );
  }
);
SidebarGroupLabel.displayName = 'SidebarGroupLabel';

export const SidebarGroupContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('space-y-0.5', className)} {...props} />
  )
);
SidebarGroupContent.displayName = 'SidebarGroupContent';

export const SidebarMenu = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn('flex flex-col gap-0.5 w-full', className)} {...props} />
  )
);
SidebarMenu.displayName = 'SidebarMenu';

export const SidebarMenuItem = React.forwardRef<HTMLLIElement, React.HTMLAttributes<HTMLLIElement>>(
  ({ className, ...props }, ref) => (
    <li ref={ref} className={cn('relative list-none', className)} {...props} />
  )
);
SidebarMenuItem.displayName = 'SidebarMenuItem';

export interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
  asChild?: boolean;
}

export const SidebarMenuButton = React.forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  ({ className, isActive, asChild = false, children, ...props }, ref) => {
    const { isCollapsed } = useSidebar();
    const base = cn(
      'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors relative select-none',
      isCollapsed ? 'justify-center px-0' : '',
      isActive
        ? 'bg-[#141414] text-white font-semibold'
        : 'text-[#8c8c8c] hover:text-white hover:bg-[#101010]',
      className
    );

    return (
      <button ref={ref} className={base} {...props}>
        {isActive && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-[#f38020] rounded-r" />
        )}
        {children}
      </button>
    );
  }
);
SidebarMenuButton.displayName = 'SidebarMenuButton';

export const SidebarTrigger: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className,
  ...props
}) => {
  const { toggleSidebar, toggleCollapse } = useSidebar();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.innerWidth < 768) {
          toggleSidebar();
        } else {
          toggleCollapse();
        }
      }}
      className={cn(
        'flex items-center justify-center w-8 h-8 rounded-md text-[#8c8c8c] hover:text-white hover:bg-[#161616] border border-transparent hover:border-[#262626] transition-colors',
        className
      )}
      aria-label="Toggle Sidebar"
      {...props}
    >
      <PanelLeft className="w-4 h-4" />
    </button>
  );
};

export const SidebarInset = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col flex-1 min-w-0 bg-[#000000]', className)}
      {...props}
    />
  )
);
SidebarInset.displayName = 'SidebarInset';
