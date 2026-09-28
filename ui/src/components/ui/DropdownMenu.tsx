/*
 * Shadcn UI DropdownMenu component family.
 * Owned by: ui/components/ui
 * Key deps: React, clsx, tailwind-merge
 * Invariants: Context provider with zero wrapper DOM nodes for pure composability.
 */

import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { cn } from '../../utils/cn';

interface DropdownMenuContextValue {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  triggerRef: React.RefObject<HTMLElement | null>;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null);

export const DropdownMenu: React.FC<{
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}> = ({ children, open: controlledOpen, onOpenChange }) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = (next: React.SetStateAction<boolean>) => {
    const nextVal = typeof next === 'function' ? next(open) : next;
    if (!isControlled) {
      setUncontrolledOpen(nextVal);
    }
    onOpenChange?.(nextVal);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen, triggerRef }}>
      {children}
    </DropdownMenuContext.Provider>
  );
};

export const DropdownMenuTrigger = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement> & { asChild?: boolean }
>(({ className, children, asChild, onClick, ...props }, ref) => {
  const context = useContext(DropdownMenuContext);
  if (!context) return null;

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onClick?.(e as any);
    context.setOpen((prev) => !prev);
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      ref: (node: HTMLElement) => {
        (context.triggerRef as any).current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as any).current = node;
      },
      onClick: (e: React.MouseEvent<HTMLElement>) => {
        (children as React.ReactElement<any>).props.onClick?.(e);
        handleClick(e);
      },
      'data-state': context.open ? 'open' : 'closed',
      ...props,
    });
  }

  return (
    <button
      ref={(node) => {
        (context.triggerRef as any).current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as any).current = node;
      }}
      type="button"
      onClick={handleClick as any}
      data-state={context.open ? 'open' : 'closed'}
      className={cn('inline-flex items-center cursor-pointer', className)}
      {...props}
    >
      {children}
    </button>
  );
});
DropdownMenuTrigger.displayName = 'DropdownMenuTrigger';

export const DropdownMenuContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    align?: 'start' | 'center' | 'end';
    side?: 'top' | 'right' | 'bottom' | 'left';
    sideOffset?: number;
  }
>(({ className, align = 'start', side = 'bottom', sideOffset = 4, children, ...props }, ref) => {
  const context = useContext(DropdownMenuContext);
  if (!context || !context.open) return null;

  const alignStyles = {
    start: 'left-0',
    center: 'left-1/2 -translate-x-1/2',
    end: 'right-0',
  };

  const sideStyles = {
    top: 'bottom-full mb-1',
    bottom: 'top-full mt-1',
    left: 'right-full mr-1 top-0',
    right: 'left-full ml-1 top-0',
  };

  return (
    <div
      ref={ref}
      data-slot="dropdown-menu-content"
      className={cn(
        'absolute z-50 min-w-[8rem] overflow-hidden rounded-md border border-[#27272a] bg-[#121214] p-1 text-white shadow-xl animate-in fade-in-0 zoom-in-95',
        alignStyles[align],
        sideStyles[side],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('space-y-0.5', className)} {...props} />
));
DropdownMenuGroup.displayName = 'DropdownMenuGroup';

export const DropdownMenuItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: 'default' | 'destructive';
    inset?: boolean;
  }
>(({ className, variant = 'default', inset, onClick, children, ...props }, ref) => {
  const context = useContext(DropdownMenuContext);

  return (
    <div
      ref={ref}
      onClick={(e) => {
        onClick?.(e);
        context?.setOpen(false);
      }}
      data-slot="dropdown-menu-item"
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-[#27272a] focus:bg-[#27272a]',
        variant === 'destructive' && 'text-rose-400 hover:text-rose-300 hover:bg-rose-950/30',
        inset && 'pl-8',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="dropdown-menu-label"
    className={cn(
      'px-2 py-1.5 text-xs font-semibold text-white',
      inset && 'pl-8',
      className
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

export const DropdownMenuSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="dropdown-menu-separator"
    className={cn('-mx-1 my-1 h-px bg-[#27272a]', className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';
