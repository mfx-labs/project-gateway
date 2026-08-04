/**
 * Descriptor-derived snapshot hardening for trusted configuration runtime
 * inputs (WP-6 Phase 1, F-EL5).
 *
 * Reuses the established WP-4/WP-5A snapshot pattern (`snapshotJson` in
 * `src/internal/snapshot.ts`):
 * - protocol-significant properties are captured exactly once from own data
 *   property descriptors;
 * - ordinary getters are never invoked (accessor properties are rejected);
 * - Proxy `get` traps are not used for protocol-significant reads (values are
 *   read from descriptors; `get` traps never fire for captured values);
 * - structural introspection failures (throwing descriptor traps,
 *   non-plain prototypes, cycles, unsupported value types, non-finite
 *   numbers) produce typed fail-closed findings;
 * - captured snapshots are deeply frozen and share no nested reference with
 *   caller-owned input;
 * - caller containers are never reread after snapshot construction, so later
 *   caller mutation cannot change validated state, identity, ceilings,
 *   trustedExtensionSet, workspace lookup, or findings already produced;
 * - deterministic byte-equivalence is scoped consistently with the accepted
 *   WP-5A rule for intentionally stateful descriptor-changing structural
 *   Proxies: introspection observes whatever descriptors the object exposes
 *   at capture time; safety remains fail closed.
 *
 * This module performs no filesystem, network, or process I/O.
 */
import { snapshotJson, SnapshotError } from '../internal/snapshot.js';

export type TrustedSnapshotErrorKind =
  | 'non-plain-object'
  | 'accessor-property'
  | 'cyclic-reference'
  | 'unsupported-value-type'
  | 'non-finite-number'
  | 'nesting-limit'
  | 'sparse-array'
  | 'unexpected-array-property'
  | 'symbol-property'
  | 'malformed-array-length'
  | 'descriptor-introspection-failed';

export class TrustedSnapshotError extends Error {
  readonly kind: TrustedSnapshotErrorKind;

  constructor(kind: TrustedSnapshotErrorKind, message: string) {
    super(message);
    this.name = 'TrustedSnapshotError';
    this.kind = kind;
  }
}

function classifySnapshotError(err: SnapshotError): TrustedSnapshotErrorKind {
  const message = err.message;
  if (message.includes('accessor property')) return 'accessor-property';
  if (message.includes('cyclic reference')) return 'cyclic-reference';
  if (message.includes('non-plain object')) return 'non-plain-object';
  if (message.includes('unsupported value type')) return 'unsupported-value-type';
  if (message.includes('non-finite number')) return 'non-finite-number';
  if (message.includes('nesting limit')) return 'nesting-limit';
  if (message.includes('sparse array')) return 'sparse-array';
  if (message.includes('unexpected own property')) return 'unexpected-array-property';
  if (message.includes('symbol properties')) return 'symbol-property';
  if (message.includes('array length')) return 'malformed-array-length';
  return 'descriptor-introspection-failed';
}

/**
 * Capture a defensive deep snapshot of a trusted configuration runtime input.
 * Throws TrustedSnapshotError on hostile or unsupported structures; the
 * validator converts these into typed fail-closed findings.
 */
export function snapshotTrustedWorkspaceConfigurationInput(value: unknown): unknown {
  try {
    return snapshotJson(value, '$');
  } catch (err) {
    if (err instanceof SnapshotError) {
      throw new TrustedSnapshotError(classifySnapshotError(err), err.message);
    }
    // Descriptor introspection threw a non-SnapshotError (e.g. a Proxy trap
    // threw): treat as a descriptor-introspection failure, fail closed.
    throw new TrustedSnapshotError('descriptor-introspection-failed', 'descriptor introspection failed');
  }
}
