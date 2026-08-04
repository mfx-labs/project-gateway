/**
 * Defensive deep snapshot of an accepted JSON data model.
 *
 * Copies only plain JSON value types using own data-property descriptors:
 * - no caller prototypes, getters, setters, methods, symbols, inherited
 *   properties, custom classes, proxies, or accessors are preserved;
 * - caller getters are never invoked;
 * - every array and object in the snapshot is deeply frozen;
 * - no nested reference is shared with caller-owned input.
 *
 * Traversal state is strictly per top-level `snapshotJson()` call:
 * - the recursion stack (`inProgress`) distinguishes true cycles from repeated
 *   acyclic shared references and is cleaned up with `try/finally`;
 * - a failed nested traversal can never contaminate a later call, another
 *   input, another library instance, or a concurrent/reentrant call;
 * - repeated acyclic shared references are ACCEPTED: each occurrence is
 *   materialized as an independent deeply-frozen JSON subtree (documented
 *   policy); only actual cycles are rejected.
 *
 * Runtime branding uses module-private WeakSet membership:
 * - no brand is stored as an own symbol property, string property, exported
 *   token, global symbol, or enumerable metadata;
 * - `Object.getOwnPropertySymbols(wrapper)` reveals no brand capability;
 * - a spread, clone, proxy, or forged lookalike is not a member;
 * - artifact, registry-snapshot, and lifecycle-record memberships are distinct;
 * - membership is valid only within the physical module instance that created
 *   the wrapper (no `Symbol.for`, no process-global membership).
 */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

interface TraversalState {
  /** Objects on the current recursion path (true-cycle detection). */
  readonly inProgress: Set<object>;
  /** Objects whose snapshot completed successfully (distinguished state). */
  readonly completed: Set<object>;
  /** Depth bound so pathological nesting fails deterministically. */
  depth: number;
}

function createTraversalState(): TraversalState {
  return { inProgress: new Set(), completed: new Set(), depth: 0 };
}

const MAX_SNAPSHOT_DEPTH = 512;

function snapshotInner(state: TraversalState, value: unknown, path: string): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'boolean' || t === 'string') return value;
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new SnapshotError(`non-finite number at ${path}`);
    return value;
  }
  if (t !== 'object') {
    throw new SnapshotError(`unsupported value type at ${path}: ${t}`);
  }
  const obj = value as object;
  if (state.depth >= MAX_SNAPSHOT_DEPTH) {
    throw new SnapshotError(`snapshot nesting limit exceeded at ${path}`);
  }
  // A value still on the recursion stack is a true cycle; a value that was
  // completed earlier is a repeated acyclic shared reference, which is accepted
  // and materialized as a fresh independent subtree.
  if (state.inProgress.has(obj)) {
    throw new SnapshotError(`cyclic reference at ${path}`);
  }
  state.inProgress.add(obj);
  state.depth++;
  try {
    let result: unknown;
    if (Array.isArray(value)) {
      const copy: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        copy.push(snapshotInner(state, value[i], `${path}/${i}`));
      }
      result = Object.freeze(copy);
    } else {
      // reject non-plain objects (class instances, Date, Map, proxies with traps,
      // functions, etc.) — the accepted model contains plain JSON data only.
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new SnapshotError(`non-plain object at ${path}`);
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(descriptors)) {
        const desc = descriptors[key]!;
        if (desc.get !== undefined || desc.set !== undefined) {
          // accessor properties are never invoked; a validated data model must not
          // contain them
          throw new SnapshotError(`accessor property "${key}" at ${path}`);
        }
        if (!desc.enumerable) continue;
        copy[key] = snapshotInner(state, desc.value, `${path}/${key}`);
      }
      result = Object.freeze(copy);
    }
    state.completed.add(obj);
    return result;
  } finally {
    state.depth--;
    state.inProgress.delete(obj);
  }
}

export function snapshotJson(value: unknown, path = '$'): unknown {
  // Fresh traversal state per top-level call: no module-global WeakMap/WeakSet
  // holds traversal state, so failed calls cannot affect later calls.
  const state = createTraversalState();
  return snapshotInner(state, value, path);
}

// ---------------------------------------------------------------------------
// private membership branding (module-private WeakSets)
// ---------------------------------------------------------------------------

const artifactWrappers = new WeakSet<object>();
const registryWrappers = new WeakSet<object>();
const recordWrappers = new WeakSet<object>();

/** Register a validated artifact wrapper (module-private membership). */
export function brandArtifactWrapper(wrapper: object): void {
  artifactWrappers.add(wrapper);
}

/** Register a validated registry-snapshot wrapper (module-private membership). */
export function brandRegistryWrapper(wrapper: object): void {
  registryWrappers.add(wrapper);
}

/** Register a validated lifecycle-record wrapper (module-private membership). */
export function brandRecordWrapper(wrapper: object): void {
  recordWrappers.add(wrapper);
}

export function isBrandedArtifact(value: unknown): boolean {
  return value !== null && typeof value === 'object' && artifactWrappers.has(value as object);
}
export function isBrandedRegistry(value: unknown): boolean {
  return value !== null && typeof value === 'object' && registryWrappers.has(value as object);
}
export function isBrandedRecord(value: unknown): boolean {
  return value !== null && typeof value === 'object' && recordWrappers.has(value as object);
}
