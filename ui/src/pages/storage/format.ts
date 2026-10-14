/*
 * Pure formatting utilities and quota presets for blob storage telemetry.
 * Owned by: ui/pages/storage
 * Key deps: none
 * Invariants: Operates purely on primitive numerical and temporal inputs.
 * Last structural change: Extracted from monolithic Storage.tsx.
 */

/**
 * Converts raw bytes into human-readable engineering scale with two-decimal precision.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export const QUOTA_OPTIONS = [
  { value: 'unlimited', label: 'No Limit (Unlimited)' },
  { value: '104857600', label: '100 MB' },
  { value: '524288000', label: '500 MB' },
  { value: '1073741824', label: '1 GB' },
  { value: '5368709120', label: '5 GB' },
  { value: '10737418240', label: '10 GB' },
  { value: '53687091200', label: '50 GB' },
  { value: 'custom', label: 'Custom (in bytes)' },
];
