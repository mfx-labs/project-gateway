/**
 * WP-15 Phase 2 — receipt/publication correlation production (barrel).
 *
 * Exposes the authority entry, the trusted host composition, the narrow
 * two-class store-boundary factory, and the closed type vocabulary ONLY.
 *
 * Capability/permit internals (the creators, the brand verifiers, and the
 * brand sets) are deliberately NOT exported here: the capability is minted
 * ONLY by the trusted host composition (`produce.ts`) and the permits are
 * minted internally by the authority — capability internals never appear in
 * public exports, serialization, logging, structural cloning, or
 * caller-supplied objects (CAP-011/014/015). No raw brand sets, no permit
 * internals, no unrestricted store handles, and no generic publishRecord
 * authority leave this family.
 *
 * This family performs NO TrustedReceipt issuance, NO ExecutionResult
 * mutation, NO validation/evaluator provenance change, NO mutation of the
 * historical predecessor, NO generic lifecycle-write authority, and NO
 * pi-guard interaction. There is no public barrel export at the package
 * root for Phase 2 (the correlation transition is a trusted local
 * control-plane capability; host composition is explicit).
 */
export { correlateReceiptPublication } from './authority.js';
export { createReceiptPublicationCorrelationAuthority } from './produce.js';
export { createCorrelationStoreBoundary } from './store.js';
export {
  CORRELATION_PUBLICATION_RECORD_CLASS,
  CORRELATION_SUPERSESSION_RECORD_CLASS,
  CORRELATION_PUBLICATION_ROLE,
  CORRELATION_SUPERSESSION_ROLE,
  CORRELATION_PRODUCER_CAPABILITY_IDENTITY,
  CORRELATION_READ_CLASSES,
  CORRELATION_FAILURE_CATEGORIES,
} from './types.js';
export type {
  CorrelationFailureCategory,
  CorrelationResult,
  CorrelationRequest,
  CorrelationIdentitySource,
  CorrelationStoreBoundary,
  CorrelationPublicationResult,
  CorrelationInput,
} from './types.js';
export type { CorrelationAuthority, CorrelationAuthorityOptions } from './produce.js';
