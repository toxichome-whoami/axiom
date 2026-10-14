/*
 * Pure path normalization and hierarchy traversal logic for virtual storage filesystem.
 * Owned by: ui/pages/storage
 * Key deps: none
 * Invariants: Virtual directory keys end with trailing slash; leading slashes are stripped.
 * Last structural change: Extracted from monolithic Storage.tsx.
 */

/**
 * Strips leading slashes and normalizes directory trailing slash.
 */
export function sanitizeFolder(folder: string): string {
  let clean = folder.trim().replace(/^[/\\]+/, '');
  if (clean && !clean.endsWith('/')) {
    clean += '/';
  }
  return clean;
}

/**
 * Returns parent directory prefix of a key, or empty string if at root.
 */
export function parentOf(key: string): string {
  const parts = key.split('/').filter(Boolean);
  parts.pop();
  return parts.length > 0 ? `${parts.join('/')}/` : '';
}

/**
 * Joins folder directory and target item name into a canonical key.
 */
export function joinKey(dir: string, name: string, isFolder: boolean): string {
  const cleanDir = sanitizeFolder(dir);
  const cleanName = name.trim().replace(/[/\\]+/g, '');
  return isFolder ? `${cleanDir}${cleanName}/` : `${cleanDir}${cleanName}`;
}

/**
 * Prevents recursive circular folder moves (e.g. moving 'docs/' into 'docs/archive/').
 */
export function isSelfOrDescendant(srcPrefix: string, destPrefix: string): boolean {
  if (!srcPrefix.endsWith('/')) return srcPrefix === destPrefix;
  return destPrefix.startsWith(srcPrefix);
}

/**
 * Validates a single directory or file segment name against invalid shell/filesystem characters.
 */
export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Name cannot be empty';
  if (trimmed === '.' || trimmed === '..') return 'Name cannot be a traversal marker';
  if (trimmed.includes('/') || trimmed.includes('\\')) return 'Name cannot contain path separators';
  if (trimmed.length > 255) return 'Name exceeds 255 character limit';
  return null;
}
