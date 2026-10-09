import React from 'react';
import { cn } from '../../utils/cn';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

/**
 * Minimalist, high-performance dark skeleton loader.
 * Emits a subtle pulse animation matching Cloudflare/Vercel dashboard tones.
 */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading..."
      className={cn('animate-pulse rounded-[4px] bg-[#16171d]/80 border border-[#1e2025]/40', className)}
      {...props}
    />
  );
}
