import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind CSS class names safely, deduplicating conflicting classes.
 * Follows the standard pattern used across Vercel & Cloudflare design systems.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
