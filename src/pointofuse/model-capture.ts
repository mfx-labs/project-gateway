/**
 * WP-6 Phase 3A: safe bare-model capture for bundle, policy, and grant
 * (contract Section 13; F-P3-EL-21 Model A). Bare `ImmutableModel` values have
 * NO runtime brand; descriptor-safe deep capture through the committed
 * `snapshotJson` creates a detached deeply frozen plain JSON value.
 *
 * The committed snapshot rejects non-finite numbers, functions, cycles,
 * symbols, unsupported prototypes, accessors, non-enumerable fields, missing
 * descriptors, structural traps, and revoked Proxies, and deep-freezes the
 * result. Malformed-but-JSON-representable semantic content (for example a
 * grant narrowed constraint with a non-number `max-actions`) remains
 * capturable for later semantic denial; no Phase-3 semantic policy or grant
 * validation happens in this package.
 *
 * No new runtime brand is introduced. Object property order does not affect
 * identity (JCS sorts keys at whole-projection serialization); array order
 * remains meaningful. The original model is never reread.
 */
import { snapshotJson } from '../internal/snapshot.js';
import type { ImmutableJsonValue } from './router-types.js';

export type BareModelCaptureResult =
  | { readonly ok: true; readonly model: ImmutableJsonValue }
  | { readonly ok: false };

/**
 * True when every number in the detached captured JSON value is admissible
 * under the repository's committed canonical-input numeric profile (the
 * committed RFC 8785 serializer accepts exactly safe integers; `-0` is
 * normalized to `0` and is therefore admissible). Finite non-integer values
 * such as `1.5` are JSON-representable but NOT canonical-input-representable:
 * they must fail at the model-capture boundary so no captured projection can
 * ever fail static identity solely because of a numeric value.
 *
 * Walks only the detached captured value (never the hostile source), performs
 * zero getter/Proxy `get` (the captured value is a deeply frozen plain JSON
 * value), and never mutates. Object-key order and array order are preserved.
 * This is a canonical-input-profile check only — no policy, grant, bundle, or
 * schema semantic validation happens here.
 */
function hasCanonicalNumbersOnly(value: ImmutableJsonValue): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!hasCanonicalNumbersOnly(item)) return false;
    }
    return true;
  }
  for (const key of Object.keys(value as Readonly<Record<string, ImmutableJsonValue>>)) {
    // snapshotJson outputs contain no undefined values; the assertion is
    // type-level only (strict noUncheckedIndexedAccess).
    if (!hasCanonicalNumbersOnly((value as Readonly<Record<string, ImmutableJsonValue>>)[key]!)) return false;
  }
  return true;
}

/**
 * Capture one bare model. The captured value is a deeply frozen plain JSON
 * object (record); arrays and primitives are rejected because bundle, policy,
 * and grant are record-shaped models. The captured value must also satisfy
 * the committed canonical-input numeric profile (safe integers only), so that
 * every accepted model is serializable by the committed JCS implementation.
 */
export function captureBareModel(value: unknown): BareModelCaptureResult {
  let captured: unknown;
  try {
    captured = snapshotJson(value, '$');
  } catch {
    // Hostile or non-representable values (functions, cycles, symbols,
    // unsupported prototypes, non-finite numbers, accessors, traps, revoked
    // Proxies) fail closed as a typed capture failure.
    return { ok: false };
  }
  if (captured === null || typeof captured !== 'object' || Array.isArray(captured)) {
    return { ok: false };
  }
  // Canonical-input numeric profile: a finite non-integer or unsafe number is
  // JSON-representable but not JCS-representable; rejecting it here (typed
  // model-capture boundary failure) guarantees static identity can never fail
  // because of a captured numeric value.
  if (!hasCanonicalNumbersOnly(captured as ImmutableJsonValue)) {
    return { ok: false };
  }
  return { ok: true, model: captured as ImmutableJsonValue };
}
