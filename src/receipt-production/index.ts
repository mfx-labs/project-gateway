/**
 * WP-15 Phase 1B — trusted receipt production (barrel).
 *
 * Exposes the authority entry, the trusted host composition, the narrow
 * single-class store-boundary factory, and the closed type vocabulary ONLY.
 *
 * Capability/permit internals (the creators, the brand verifiers, and the
 * brand sets) are deliberately NOT exported here: the capability is minted
 * ONLY by the trusted host composition (`produce.ts`) and the permit is
 * minted internally by the authority — capability internals never appear in
 * public exports, serialization, logging, structural cloning, or
 * caller-supplied objects (CAP-011/014/015). No raw brand sets, no permit
 * internals, no unrestricted store handles, and no generic publishRecord
 * authority leave this family.
 *
 * This family performs NO result-publication correlation transition, NO
 * successor ResultPublicationRecord, NO SupersessionRecord production, NO
 * execution/activation/grant mutation, and NO pi-guard interaction. There is
 * no public barrel export at the package root for Phase 1B (receipt
 * issuance is a trusted local control-plane capability; host composition is
 * explicit).
 */
export { issueTrustedReceipt } from './authority.js';
export { createReceiptProducerAuthority } from './produce.js';
export { createReceiptStoreBoundary } from './store.js';
export { TRUSTED_RECEIPT_RECORD_CLASS, TRUSTED_RECEIPT_PRODUCER_ROLE, RECEIPT_READ_CLASSES, RECEIPT_FAILURE_CATEGORIES } from './types.js';
export type {
  ReceiptFailureCategory,
  ReceiptResult,
  ReceiptRequest,
  ReceiptIdentitySource,
  ReceiptStoreBoundary,
  ReceiptPublicationResult,
  ReceiptInput,
} from './types.js';
export type { ReceiptProducerAuthority, ReceiptProducerAuthorityOptions } from './produce.js';
