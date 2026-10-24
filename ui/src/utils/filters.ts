/*
 * Shared filtering interfaces and predicates used across table views (AuditLog, Databases, Keys, Roles, Cluster).
 * Owned by: ui/utils
 * Invariants: Matching is case-insensitive.
 */

export interface FilterRule {
  id: string;
  field: string;
  operator: 'contains' | 'equals' | 'starts_with';
  value: string;
}

export function matchesRule(
  itemVal: string,
  operator: 'contains' | 'equals' | 'starts_with' | string,
  ruleVal: string
): boolean {
  const v = (itemVal ?? '').toLowerCase();
  const t = (ruleVal ?? '').toLowerCase();
  if (operator === 'contains') return v.includes(t);
  if (operator === 'equals') return v === t;
  if (operator === 'starts_with') return v.startsWith(t);
  return true;
}
