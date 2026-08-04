/**
 * Deterministic locale-independent string ordering (WP-6 Phase-1 correction
 * F-3).
 *
 * Protocol-significant ordering must never depend on host locale, ICU
 * version, or environment: `String.prototype.localeCompare` is forbidden for
 * protocol ordering. `compareStrings` orders strings by UTF-16 code units
 * (identical to the repository's canonical JSON key ordering), is total,
 * stable, and byte-deterministic across environments and implementations.
 *
 * Used consistently for: validated workspace ordering, identity projection
 * ordering, capability-set canonical ordering, trustedExtensionSet canonical
 * ordering, and finding ordering.
 */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
