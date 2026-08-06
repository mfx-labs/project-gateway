/**
 * WP-8-C pure aggregate state classification (ADR-028 decision F; W8C-D04).
 *
 * Fail-closed rules:
 * - both namespaces ABSENT → ABSENT (may initialize);
 * - both namespaces INITIALIZED with exact match → INITIALIZED (verification
 *   only);
 * - one INITIALIZED and the other ABSENT/PROVISIONAL → PARTIAL (fail closed);
 * - any FOREIGN, IDENTITY_DRIFTED, MALFORMED_METADATA, or
 *   UNSUPPORTED_VERSION namespace → that state (fail closed);
 * - both PROVISIONAL, or PROVISIONAL + ABSENT → PROVISIONAL (may continue
 *   only under a new genuine one-shot capability, after verification);
 * - unknown entries fail closed at the namespace classifier.
 *
 * No repair, reconstruction, deletion, or authoritative-state cleanup is
 * ever performed by WP-8-C.
 */
import type { AggregateState, InitializationStateKind, NamespaceState } from '../types.js';

const FAIL_CLOSED: readonly InitializationStateKind[] = ['PARTIAL', 'FOREIGN', 'IDENTITY_DRIFTED', 'MALFORMED_METADATA', 'UNSUPPORTED_VERSION'];

export function classifyAggregateState(namespaces: readonly NamespaceState[]): AggregateState {
  const byKind = new Map<NamespaceState['state'], NamespaceState[]>();
  for (const ns of namespaces) {
    const list = byKind.get(ns.state) ?? [];
    list.push(ns);
    byKind.set(ns.state, list);
  }
  for (const state of FAIL_CLOSED) {
    const list = byKind.get(state);
    if (list !== undefined && list.length > 0) {
      return { state, namespaces: [...namespaces] };
    }
  }
  if (namespaces.some((ns) => ns.unknownEntries)) {
    return { state: 'FOREIGN', namespaces: [...namespaces] };
  }
  const initialized = byKind.get('INITIALIZED')?.length ?? 0;
  const absent = byKind.get('ABSENT')?.length ?? 0;
  const provisional = byKind.get('PROVISIONAL')?.length ?? 0;
  if (initialized === 2) return { state: 'INITIALIZED', namespaces: [...namespaces] };
  if (initialized === 1 && (absent === 1 || provisional === 1)) return { state: 'PARTIAL', namespaces: [...namespaces] };
  if (absent === 2) return { state: 'ABSENT', namespaces: [...namespaces] };
  if (provisional > 0 && initialized === 0) return { state: 'PROVISIONAL', namespaces: [...namespaces] };
  return { state: 'FOREIGN', namespaces: [...namespaces] };
}
