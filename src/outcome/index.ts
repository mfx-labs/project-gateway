/**
 * WP-13 durability S2 — trusted execution-outcome-recorder (barrel).
 *
 * Exposes the narrow store-boundary factory and the closed type vocabulary
 * ONLY. Capability internals (the creator, the brand verifier, and the
 * permit creator) are deliberately NOT exported here: the capability is
 * minted ONLY by the trusted host composition (ADR-039; zero production
 * producers outside it) and the permit is minted by the outcome authority
 * (S3) — capability internals never appear in public exports,
 * serialization, logging, structural cloning, or caller-supplied objects.
 *
 * S2 performs NO outcome-record production (no eligibility decision, no
 * construction, no evidence/lifecycle identity allocation, no attempt
 * lock, no replay/conflict), NO publication of any other record class, NO
 * receipt production, NO WP-13D retrospective-facts work, and NO pi-guard
 * interaction.
 */
export { createOutcomeStoreBoundary } from './store-boundary.js';
export {
  EXECUTION_OUTCOME_OPERATION,
  EXECUTION_OUTCOME_RECORD_CLASS,
  OUTCOME_PUBLICATION_FAILURE_CATEGORIES,
} from './types.js';
export type {
  ExecutionOutcomeOperation,
  OutcomePublicationFailureCategory,
  OutcomePublicationResult,
  OutcomeStoreBoundary,
} from './types.js';
