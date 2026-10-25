import * as React from "react";
import { cn } from "../../utils/cn";

export interface SwitchProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/**
 * Switch component adhering strictly to shadcn/ui and Table page toggle specifications:
 * - Peer switch with smooth ease-in-out transition
 * - Dark theme palette: bg-[#27272a] when off, primary blue (bg-blue-600) with subtle glow when on
 * - Matches Table page toggle switch styling
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      className,
      checked = false,
      onCheckedChange,
      disabled,
      onClick,
      ...props
    },
    ref,
  ) => {
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
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-50",
          checked
            ? "bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.35)]"
            : "bg-[#27272a]",
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full shadow-md transition-transform duration-200 ease-in-out",
            checked ? "translate-x-4 bg-white" : "translate-x-0 bg-[#a1a1aa]",
          )}
        />
      </button>
    );
  },
);

Switch.displayName = "Switch";
