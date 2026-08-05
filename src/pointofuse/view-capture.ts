/**
 * WP-6 Phase 3A: receiver-bound callable-view adapters (contract Section 7).
 *
 * For each enumerated callable member, the method is extracted exactly once
 * through own-or-prototype property descriptors: an own data descriptor
 * holding a function is accepted; a prototype data descriptor holding a
 * function is accepted only for the explicitly enumerated callable method
 * names (class-style implementations); accessor descriptors anywhere on the
 * walk are rejected without invocation; the prototype walk stops
 * deterministically (bounded depth, never inspecting Object.prototype);
 * structural traps and revoked Proxies fail closed.
 *
 * The wrapper invokes the extracted method with the ORIGINAL receiver through
 * `Reflect.apply`, so receiver live state may affect invocation outcomes while
 * method replacement after capture has no effect. Extraction performs zero
 * Proxy `get` and zero getter invocation; no claim is made that method
 * execution itself performs zero reads.
 */
import type {
  IdentityViewAdapter,
  ResolverViewAdapter,
  RevocationsViewAdapter,
} from './router-types.js';

export type ViewExtractionFailureCode = 'accessor' | 'not-found' | 'traps';

export type ViewAdapterResult<T> =
  | { readonly ok: true; readonly adapter: T }
  | { readonly ok: false; readonly code: ViewExtractionFailureCode };

/** Deterministic prototype-walk bound (class hierarchies are shallow). */
const MAX_PROTOTYPE_DEPTH = 16;

export interface ExtractedCallable {
  readonly receiver: object;
  readonly method: (...args: unknown[]) => unknown;
}

/**
 * Extract one callable member by name. Own descriptor first, then a bounded
 * prototype walk; Object.prototype is never inspected; accessors are rejected
 * without invocation; a data descriptor holding a non-function for a callable
 * name is rejected. All descriptor reads go through
 * `Object.getOwnPropertyDescriptor` — Proxy `get` traps never fire.
 */
export function extractCallable(
  view: unknown,
  name: string,
): { readonly ok: true; readonly callable: ExtractedCallable } | { readonly ok: false; readonly code: ViewExtractionFailureCode } {
  if (view === null || (typeof view !== 'object' && typeof view !== 'function')) {
    return { ok: false, code: 'not-found' };
  }
  const receiver = view as object;
  let current: object | null = receiver;
  let depth = 0;
  while (current !== null && current !== Object.prototype && depth < MAX_PROTOTYPE_DEPTH) {
    let desc: PropertyDescriptor | undefined;
    try {
      desc = Object.getOwnPropertyDescriptor(current, name);
    } catch {
      // Descriptor traps and revoked Proxies fail closed.
      return { ok: false, code: 'traps' };
    }
    if (desc !== undefined) {
      if (desc.get !== undefined || desc.set !== undefined) {
        return { ok: false, code: 'accessor' };
      }
      const value = desc.value;
      if (typeof value === 'function') {
        return { ok: true, callable: { receiver, method: value as (...args: unknown[]) => unknown } };
      }
      return { ok: false, code: 'not-found' };
    }
    let proto: object | null;
    try {
      proto = Object.getPrototypeOf(current);
    } catch {
      return { ok: false, code: 'traps' };
    }
    current = proto;
    depth++;
  }
  return { ok: false, code: 'not-found' };
}

function bindMethod(callable: ExtractedCallable): (...args: unknown[]) => unknown {
  const { receiver, method } = callable;
  return (...args: unknown[]) => Reflect.apply(method, receiver, args);
}

/** Extract all named members of a view and build one frozen receiver-bound adapter. */
export function createBoundAdapter(
  view: unknown,
  names: readonly string[],
): ViewAdapterResult<Readonly<Record<string, (...args: unknown[]) => unknown>>> {
  const methods: Record<string, (...args: unknown[]) => unknown> = {};
  for (const name of names) {
    const extracted = extractCallable(view, name);
    if (!extracted.ok) return { ok: false, code: extracted.code };
    methods[name] = bindMethod(extracted.callable);
  }
  return { ok: true, adapter: Object.freeze(methods) };
}

/** Receiver-bound adapter for the IdentityStateView (four enumerated members). */
export function createIdentityViewAdapter(view: unknown): ViewAdapterResult<IdentityViewAdapter> {
  const bound = createBoundAdapter(view, ['findInstance', 'findRevision', 'findPredecessor', 'verifyRegistration']);
  if (!bound.ok) return bound;
  const m = bound.adapter;
  return {
    ok: true,
    adapter: Object.freeze({
      findInstance: m['findInstance'] as unknown as IdentityViewAdapter['findInstance'],
      findRevision: m['findRevision'] as unknown as IdentityViewAdapter['findRevision'],
      findPredecessor: m['findPredecessor'] as unknown as IdentityViewAdapter['findPredecessor'],
      verifyRegistration: m['verifyRegistration'] as unknown as IdentityViewAdapter['verifyRegistration'],
    }),
  };
}

/** Receiver-bound adapter for the ExactSubjectResolver (one enumerated member). */
export function createResolverViewAdapter(view: unknown): ViewAdapterResult<ResolverViewAdapter> {
  const bound = createBoundAdapter(view, ['resolve']);
  if (!bound.ok) return bound;
  return {
    ok: true,
    adapter: Object.freeze({ resolve: bound.adapter['resolve'] as unknown as ResolverViewAdapter['resolve'] }),
  };
}

/** Receiver-bound adapter for the RevocationView (one enumerated member). */
export function createRevocationsViewAdapter(view: unknown): ViewAdapterResult<RevocationsViewAdapter> {
  const bound = createBoundAdapter(view, ['revocationsByTarget']);
  if (!bound.ok) return bound;
  return {
    ok: true,
    adapter: Object.freeze({
      revocationsByTarget: bound.adapter['revocationsByTarget'] as unknown as RevocationsViewAdapter['revocationsByTarget'],
    }),
  };
}
