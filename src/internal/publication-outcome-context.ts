/**
 * WP-13 durability S3 — branded publication-outcome precondition context
 * (SIR-WP13-DUR-S3-001 correction).
 *
 * A caller-supplied structural `OutcomeStoreBoundary` is NOT sufficient
 * trust for the WP-13C outcome precondition: the publication boundary must
 * prove it reads the GENUINE S2-backed durable outcome store. This module
 * holds a module-private WeakSet brand for the precondition context; the
 * factory is consumed ONLY by the trusted S3 host composition
 * (`src/outcome-production/compose.ts`, the single mint site — static-guard
 * pinned) and is never exported from any ordinary/public barrel.
 *
 * `publishValidatedResult` verifies the genuine brand before touching the
 * store, so an arbitrary caller cannot fabricate the outcome view used by
 * WP-13C (a structurally compatible fake context is rejected as
 * `outcome.context-not-genuine`). Test doubles exist only behind explicit
 * test-owned seams (tests import the factory directly, exactly like the
 * established capability-internals test pattern) — never as production
 * authority.
 *
 * Pure module: no I/O, no persistence, no authority beyond the brand.
 */
import type { OutcomeStoreBoundary } from '../outcome/types.js';
import type { PublicationOutcomePrecondition } from '../publication/types.js';

const contextBrand = new WeakSet<PublicationOutcomePrecondition>();

/**
 * Build the branded precondition context over a genuine S2 outcome store
 * boundary. Minted ONLY by the trusted S3 host composition (static-guard
 * pinned: production mentions of this factory are confined to this module +
 * `src/outcome-production/compose.ts`).
 */
export function createPublicationOutcomePrecondition(store: OutcomeStoreBoundary): PublicationOutcomePrecondition | undefined {
  if (
    store === null ||
    typeof store !== 'object' ||
    typeof (store as unknown as Readonly<Record<string, unknown>>)['publishExactOutcomeRecord'] !== 'function' ||
    typeof (store as unknown as Readonly<Record<string, unknown>>)['readLifecyclePayload'] !== 'function' ||
    typeof (store as unknown as Readonly<Record<string, unknown>>)['enumerateLifecycleRecords'] !== 'function'
  ) {
    return undefined;
  }
  const context: PublicationOutcomePrecondition = Object.freeze({ store });
  contextBrand.add(context);
  return context;
}

/** True only for a precondition context branded by this module in this process. */
export function isGenuinePublicationOutcomePrecondition(value: unknown): value is PublicationOutcomePrecondition {
  return value !== null && typeof value === 'object' && contextBrand.has(value as PublicationOutcomePrecondition);
}
