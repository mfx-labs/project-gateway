/**
 * Stable adapter findings (bounded set, deterministic ordering).
 *
 * Expected incompatibility and invalid input return typed failures with stable
 * categories and keys; raw host exception text is never part of the protocol
 * error contract.
 */
import type { PiFinding, PiFindingCategory } from './types.js';

const CATEGORY_ORDER: readonly PiFindingCategory[] = [
  'PI-ADAPTER-INPUT-INVALID',
  'PI-ADAPTER-BUNDLE-MISMATCH',
  'PI-ADAPTER-CONTEXT-MISMATCH',
  'PI-ADAPTER-CONTEXT-BOUND-EXCEEDED',
  'PI-ADAPTER-UNSUPPORTED-MEDIA',
  'PI-ADAPTER-HOST-INCOMPATIBLE',
  'PI-ADAPTER-REQUIRED-SEMANTIC-UNSUPPORTED',
  'PI-ADAPTER-PROJECTION-FAILURE',
  'PI-ADAPTER-HOST-OBSERVATION-FAILURE',
  'PI-ADAPTER-CORRELATION-MISMATCH',
];

/** Deterministic finding ordering: category order, then key, then location. */
export function sortFindings(findings: readonly PiFinding[]): PiFinding[] {
  return [...findings].sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    return (a.location ?? '').localeCompare(b.location ?? '');
  });
}

/** Build one stable finding. */
export function piFinding(
  category: PiFindingCategory,
  key: string,
  message: string,
  location?: string,
): PiFinding {
  return Object.freeze({ category, key, message, ...(location !== undefined ? { location } : {}) });
}
