/*
 * Shadcn UI Button component.
 * Owned by: ui/components/ui
 * Key deps: clsx, tailwind-merge, lucide-react
 * Invariants: Accessible button supporting variants, sizes, loading spinners, and forwardRef.
 */

import React from 'react';
import { cn } from '../../utils/cn';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = 'default', size = 'default', isLoading = false, disabled, className, ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 select-none active:scale-[0.99] rounded-md';

    const variantStyles: Record<ButtonVariant, string> = {
      default: 'bg-[#3b82f6] text-white shadow hover:bg-[#2563eb] border border-blue-500/20',
      secondary: 'bg-[#181818] text-[#f3f4f6] hover:bg-[#222222] border border-[#2e2e2e]',
      destructive: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 border border-rose-500/30',
      outline: 'border border-[#2e2e2e] bg-transparent text-[#f3f4f6] hover:bg-[#181818] hover:text-white',
      ghost: 'text-[#a1a1a1] hover:bg-[#181818] hover:text-white',
      link: 'text-[#3b82f6] underline-offset-4 hover:underline p-0 h-auto',
    };

    const sizeStyles: Record<ButtonSize, string> = {
      default: 'h-9 px-4 py-2 gap-2 text-xs font-semibold',
      sm: 'h-7 px-2.5 py-1 text-xs gap-1.5',
      lg: 'h-10 px-6 py-2.5 text-sm gap-2.5',
      icon: 'h-8 w-8 p-0',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
        {...props}
      >
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-current" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
