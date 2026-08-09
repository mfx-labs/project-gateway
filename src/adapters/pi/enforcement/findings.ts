/**
 * WP-5B — deterministic finding helpers (bounded, stable machine-readable
 * keys; raw host exception text never enters a finding message).
 */
import type { GuardFinding, GuardFindingCategory } from './types.js';

export function piGuardFinding(category: GuardFindingCategory, key: string, message: string): GuardFinding {
  return Object.freeze({ category, key, message });
}

/** Stable ordering for deterministic finding output. */
export function sortGuardFindings(findings: readonly GuardFinding[]): readonly GuardFinding[] {
  return Object.freeze([...findings].sort((a, b) => compare(a.key, b.key) || compare(a.category, b.category)));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
