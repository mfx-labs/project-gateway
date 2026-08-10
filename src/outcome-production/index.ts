/**
 * WP-13 durability S3 — trusted execution-outcome production (barrel).
 *
 * Exposes the decision core, the trusted host composition, and the closed
 * type vocabulary ONLY. Capability/permit internals and the branded
 * outcome-precondition context factory are never exported here (the context
 * factory lives in `src/internal/publication-outcome-context.ts` and is
 * consumed ONLY by the composition). No receipt production (WP-15), no
 * ExecutionRetrospectiveFacts derivation (S4), no recovery/resume protocol.
 */
export { produceExecutionOutcome, canonicalObservationContentDigest } from './produce.js';
export { createExecutionOutcomeAuthority } from './compose.js';
export { buildOutcomePayload, publishNewOutcome } from './new-outcome.js';
export type { OutcomeMaterial } from './new-outcome.js';
export {
  OUTCOME_PRODUCTION_FAILURE_CATEGORIES,
} from './types.js';
export type {
  OutcomeAuthorityInput,
  OutcomeIdentitySource,
  OutcomeProductionFailureCategory,
  OutcomeProductionInput,
  OutcomeProductionResult,
  PublicationAuthorityInput,
} from './types.js';
export type { ExecutionOutcomeAuthority, ExecutionOutcomeAuthorityOptions } from './compose.js';
