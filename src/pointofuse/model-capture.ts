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
 * Capture one bare model. The captured value is a deeply frozen plain JSON
 * object (record); arrays and primitives are rejected because bundle, policy,
 * and grant are record-shaped models.
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
  return { ok: true, model: captured as ImmutableJsonValue };
}
