/**
 * Numeric ceiling validation (WP-6 Phase 1, F-07 semantics).
 *
 * Numeric action ceilings (`globalActionCeiling`, workspace `actionCeiling`)
 * are orthogonal action-count limits:
 * - domain: non-negative safe integers (0 .. Number.MAX_SAFE_INTEGER);
 * - zero is an explicit zero ceiling (denies the limited quantity);
 * - missing is preserved as "no additional quantitative restriction" — never
 *   permission;
 * - negative, fractional, NaN, ±Infinity, and unsafe values fail closed;
 * - negative zero is canonicalized to zero (consistent with the repository
 *   canonical-number rule: JCS serializes -0 as 0);
 * - canonical decimal identity without exponent notation (safe integers
 *   serialize as plain decimal digits via the shared canonical serializer).
 */

export function validateNonNegativeSafeInteger(value: number): boolean {
  if (!Number.isSafeInteger(value)) return false;
  return value >= 0;
}

/** Canonical decimal string for an accepted non-negative safe integer. */
export function canonicalNumericCeiling(value: number): string {
  return String(value);
}
