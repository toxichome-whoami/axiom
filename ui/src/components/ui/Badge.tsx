/*
 * Shadcn UI Badge component.
 * Owned by: ui/components/ui
 * Key deps: clsx, tailwind-merge
 * Invariants: Compact inline badge for status labels, operations, and role indicators.
 */

import React from 'react';
import { cn } from '../../utils/cn';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'orange';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  className,
  ...props
}) => {
  const variantStyles: Record<BadgeVariant, string> = {
    default: 'bg-[#3b82f6]/15 text-[#60a5fa] border-[#3b82f6]/30',
    secondary: 'bg-[#181818] text-[#d1d5db] border-[#2e2e2e]',
    destructive: 'bg-rose-950/40 text-rose-400 border-rose-800/60',
    outline: 'bg-transparent text-[#9ca3af] border-[#2e2e2e]',
    success: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/60',
    warning: 'bg-amber-950/40 text-amber-400 border-amber-800/60',
    orange: 'bg-orange-950/40 text-[#f38020] border-orange-800/60',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono tracking-tight font-medium border transition-colors',
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
