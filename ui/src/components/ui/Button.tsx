import React from 'react';
import { cn } from '../../utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

/**
 * Vercel/Cloudflare technical button with subtle glossy gradient,
 * high-contrast focus rings, and clean loading state.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = 'primary', size = 'md', isLoading = false, disabled, className, ...props }, ref) => {
    const baseStyles =
      'group relative inline-flex items-center justify-center font-medium rounded-lg transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed select-none overflow-hidden';

    const variantStyles: Record<ButtonVariant, string> = {
      primary: 'text-white shadow-xs ring-1 ring-[#1d4ed8] bg-[#2563eb]',
      secondary: 'bg-[#141415] hover:bg-[#1a1a1c] text-white border border-[#2a2a2d]',
      danger: 'text-white shadow-xs ring-1 ring-[#be123c] bg-[#e11d48]',
      outline: 'border border-[#2a2a2d] hover:bg-[#141415] text-gray-300',
      ghost: 'hover:bg-[#141415] text-gray-300',
    };

    const sizeStyles: Record<ButtonSize, string> = {
      sm: 'text-[13px] h-8 px-3 gap-1.5',
      md: 'text-[14px] h-9 px-4 gap-2',
      lg: 'text-[15px] h-10 px-5 gap-2.5',
      icon: 'h-9 w-9 p-2',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
        {...props}
      >
        {/* Glossy gradient effect for primary and danger variants */}
        {(variant === 'primary' || variant === 'danger') && (
          <>
            <span 
              aria-hidden="true" 
              className={cn(
                "pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]",
                variant === 'primary' ? 'bg-gradient-to-b from-[#3b82f6] to-[#2563eb]' : 'bg-gradient-to-b from-[#f43f5e] to-[#e11d48]'
              )} 
            />
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
          </>
        )}
        
        <span className="relative flex items-center justify-center gap-2">
          {isLoading && (
            <svg className="animate-spin h-3.5 w-3.5 text-current" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
          )}
          {children}
        </span>
      </button>
    );
  }
);

Button.displayName = 'Button';
