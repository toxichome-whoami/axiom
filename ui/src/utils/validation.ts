/*
 * Validation utilities enforcing canonical naming constraints across resources (keys, roles, databases).
 * Owned by: ui/utils
 * Invariants: Restricts names to lowercase alphanumeric with internal hyphens or underscores; max 64 chars.
 */

export function validateCleanName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: 'Name cannot be empty.' };
  }
  if (trimmed.length > 64) {
    return { valid: false, error: 'Name must not exceed 64 characters.' };
  }
  if (/[A-Z]/.test(trimmed)) {
    return { valid: false, error: 'Uppercase letters not allowed. Use lowercase only.' };
  }
  if (/\s/.test(trimmed)) {
    return { valid: false, error: 'Spaces not allowed. Use hyphens or underscores.' };
  }
  if (/[^a-z0-9_-]/.test(trimmed)) {
    return { valid: false, error: 'Only lowercase letters, numbers, hyphens, and underscores allowed.' };
  }
  if (trimmed.startsWith('_') || trimmed.startsWith('-')) {
    return { valid: false, error: 'Cannot start with a hyphen or underscore.' };
  }
  if (trimmed.endsWith('_') || trimmed.endsWith('-')) {
    return { valid: false, error: 'Cannot end with a trailing hyphen or underscore.' };
  }
  if (trimmed.length === 1 && !/^[a-z0-9]$/.test(trimmed)) {
    return { valid: false, error: 'Must be a lowercase letter or number.' };
  }
  if (!/^[a-z0-9][a-z0-9_-]*[a-z0-9]$/.test(trimmed)) {
    return { valid: false, error: 'Must be lowercase alphanumeric with hyphens or underscores.' };
  }
  return { valid: true };
}
