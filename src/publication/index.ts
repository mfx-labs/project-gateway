/**
 * WP-13C — trusted result publication (barrel).
 *
 * Exposes the authority entry, the narrow store-boundary factory, and the
 * closed type vocabulary. Capability internals (the creator, the brand
 * verifier, and the permit creators) are deliberately NOT exported here:
 * the capability is minted ONLY by the trusted host composition (ADR-038
 * decision 1; zero production producers outside it) and the permit is
 * minted internally by the authority — capability internals never appear in
 * public exports, serialization, logging, structural cloning, or
 * caller-supplied objects (CAP-011/014/015).
 *
 * WP-13C performs NO publication beyond the single ResultPublicationRecord
 * class, NO receipt production, NO privileged scopes, NO
 * ExecutionRetrospectiveFacts (WP-13D), and NO pi-guard interaction.
 */
export { publishValidatedResult } from './publish.js';
export { createPublicationStoreBoundary } from './store-boundary.js';
export {
  RESULT_PUBLICATION_SCOPE,
  RESULT_PUBLICATION_RECORD_CLASS,
  PUBLICATION_FAILURE_CATEGORIES,
} from './types.js';
export type {
  PublicationFailureCategory,
  PublicationResult,
  PublicationInput,
  PublicationIdentitySource,
  PublicationStoreBoundary,
} from './types.js';
