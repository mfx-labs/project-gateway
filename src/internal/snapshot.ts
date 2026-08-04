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
 * Array capture is descriptor-derived (WP-6 Phase-1 correction F-1):
 * - the array `length` is acquired through its own property descriptor and
 *   must be a data descriptor carrying a non-negative safe integer within the
 *   ECMA-262 array-length bound;
 * - every index value is acquired through its own property descriptor (never
 *   through `value[i]` ordinary indexed reads, so Proxy `get` traps never
 *   supply protocol values);
 * - accessor index/length descriptors are rejected without invocation;
 * - sparse arrays (missing index descriptors) are rejected deterministically:
 *   holes are not representable in the canonical JSON input contract;
 * - unexpected own string properties on arrays (any key that is not a
 *   canonical index below `length`) are rejected;
 * - own symbol properties on objects and arrays are rejected (symbols are not
 *   representable in the canonical JSON input contract);
 * - Proxy structural traps (`ownKeys`, `getOwnPropertyDescriptor`,
 *   `getPrototypeOf`) may be invoked and are the only trap category used;
 *   throwing or inconsistent structural traps fail closed.
 *
 * Object capture is descriptor-derived with a single structural
 * key-enumeration pass (WP-6 Phase-1 correction F-RR-1):
 * - every own string key reported by `ownKeys` must carry exactly one own
 *   property descriptor; a key whose `getOwnPropertyDescriptor` returns
 *   `undefined` is a structural inconsistency and fails closed — the key is
 *   never silently omitted (omitting an advertised restrictive field such as
 *   a capability or numeric ceiling would widen effective authority and
 *   would collapse identity into the identity of a genuinely absent field);
 * - non-enumerable own string properties are unsupported in the canonical
 *   JSON input contract and fail closed (a non-enumerable protocol field
 *   could conceal a restriction);
 * - accessor descriptors are rejected without invocation;
 * - values are always read from the data descriptor, never through ordinary
 *   property access, so Proxy `get` traps never supply protocol values.
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

/** ECMA-262 array-length upper bound (2^32 - 1). */
const MAX_ARRAY_LENGTH = 0xffffffff;

/** True when `key` is a canonical array index string `0..length-1`. */
function isArrayIndexKey(key: string, length: number): boolean {
  if (key === '0') return length > 0;
  if (key.length === 0 || key.length > 1 && key.charCodeAt(0) === 48 /* '0' */) return false; // no leading zeros
  const n = Number(key);
  return n > 0 && n < length && String(n) === key;
}

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
    try {
      let isArray: boolean;
      try {
        isArray = Array.isArray(value);
      } catch {
        // A revoked Proxy cannot be structurally classified: fail closed.
        throw new SnapshotError(`descriptor introspection failed at ${path}`);
      }
      if (isArray) {
      // Descriptor-derived array capture: length and every index are acquired
      // through own property descriptors; ordinary indexed reads (which would
      // fire Proxy `get` traps) are never used for protocol values.
      const lengthDesc = Object.getOwnPropertyDescriptor(value, 'length');
      if (lengthDesc === undefined || lengthDesc.get !== undefined || lengthDesc.set !== undefined) {
        throw new SnapshotError(`array length is not a data descriptor at ${path}`);
      }
      const length = lengthDesc.value;
      if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY_LENGTH) {
        throw new SnapshotError(`malformed array length at ${path}`);
      }
      // Reject unexpected own string properties (only canonical indices below
      // `length` are valid array members in the canonical JSON contract).
      for (const key of Object.getOwnPropertyNames(value)) {
        if (key === 'length') continue;
        if (!isArrayIndexKey(key, length)) {
          throw new SnapshotError(`unexpected own property "${key}" on array at ${path}`);
        }
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new SnapshotError(`symbol properties are not supported on arrays at ${path}`);
      }
      const copy: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const key = String(i);
        const desc = Object.getOwnPropertyDescriptor(value, key);
        if (desc === undefined) {
          // Sparse hole: not representable in canonical JSON input; reject
          // deterministically (matches the pre-correction fail-closed result).
          throw new SnapshotError(`sparse array index ${key} at ${path}`);
        }
        if (desc.get !== undefined || desc.set !== undefined) {
          throw new SnapshotError(`accessor property "${key}" at ${path}`);
        }
        copy.push(snapshotInner(state, desc.value, `${path}/${key}`));
      }
      result = Object.freeze(copy);
    } else {
      // reject non-plain objects (class instances, Date, Map, proxies with traps,
      // functions, etc.) — the accepted model contains plain JSON data only.
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new SnapshotError(`non-plain object at ${path}`);
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        // Symbols are not representable in the canonical JSON input contract.
        throw new SnapshotError(`symbol properties are not supported at ${path}`);
      }
      // Single structural key-enumeration pass (correction F-RR-1): every own
      // string key reported by the enumeration must carry exactly one own
      // property descriptor, looked up once. A listed key without a data
      // descriptor is a structural inconsistency and fails closed; a listed
      // non-enumerable string key is unsupported and fails closed; accessors
      // are rejected without invocation; values come from the descriptor only.
      const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(value)) {
        const desc = Object.getOwnPropertyDescriptor(value, key);
        if (desc === undefined) {
          throw new SnapshotError(`missing own property descriptor for "${key}" at ${path}`);
        }
        if (desc.get !== undefined || desc.set !== undefined) {
          // accessor properties are never invoked; a validated data model must not
          // contain them
          throw new SnapshotError(`accessor property "${key}" at ${path}`);
        }
        if (!desc.enumerable) {
          throw new SnapshotError(`non-enumerable own property "${key}" at ${path}`);
        }
        copy[key] = snapshotInner(state, desc.value, `${path}/${key}`);
      }
      result = Object.freeze(copy);
    }
    } catch (err) {
      // A Proxy structural trap (ownKeys, getOwnPropertyDescriptor,
      // getPrototypeOf) that throws a non-SnapshotError fails closed as a
      // typed SnapshotError; precise SnapshotErrors (accessors, cycles,
      // unsupported values, sparse arrays, malformed lengths) pass through
      // unchanged.
      if (err instanceof SnapshotError) throw err;
      throw new SnapshotError(`descriptor introspection failed at ${path}`);
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
