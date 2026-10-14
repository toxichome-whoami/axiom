import * as React from 'react';
import { cn } from '../../utils/cn';

export interface SwitchProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/**
 * Switch component adhering strictly to shadcn/ui and Radix UI specifications:
 * - Peer switch with smooth ease-in-out transition
 * - Dark theme palette: bg-input (#27272a) when off, primary (white) when on
 * - Focus-visible ring outline
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked = false, onCheckedChange, disabled, onClick, ...props }, ref) => {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;
      onCheckedChange?.(!checked);
      onClick?.(e);
    };

    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        ref={ref}
        onClick={handleClick}
        className={cn(
          'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-white' : 'bg-[#27272a]',
          className
        )}
        {...props}
      >
        <span
          className={cn(
            'pointer-events-none block h-4 w-4 rounded-full shadow-lg ring-0 transition-transform duration-200',
            checked ? 'translate-x-4 bg-black' : 'translate-x-0 bg-[#a1a1aa]'
          )}
        />
      </button>
    );
  }
);

Switch.displayName = 'Switch';
