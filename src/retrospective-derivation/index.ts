/**
 * WP-13 durability S4 — shared retrospective derivation (barrel).
 *
 * Exposes the ONE authoritative shared pure derivation primitive
 * (`deriveExecutionRetrospectiveFacts`), the thin durable-state resolver
 * (cold-restart path), and the closed type vocabulary ONLY.
 *
 * Deliberately NOT exported (and absent from this family): any canonical
 * fact-set serializer, fact-set hash/identity (the retired retrospective
 * fact-set content identity), byte-equality machinery,
 * receipt material (WP-15), identity/time sources, store write surfaces,
 * and scheduler/recovery vocabulary. The superseded WP-13D implementation
 * (`src/retrospective/**`) is historical and is NOT part of this
 * supported source tree.
 */
export { deriveExecutionRetrospectiveFacts } from './facts.js';
export { resolveRetrospectiveDurableState, deriveRetrospectiveFactsFromStore } from './resolver.js';
export { RETROSPECTIVE_FACTS_KEYS, RETROSPECTIVE_DERIVATION_FAILURE_CATEGORIES } from './types.js';
export type {
  ExecutionRetrospectiveFacts,
  RetrospectiveDerivationFailureCategory,
  RetrospectiveDerivationResult,
  RetrospectiveReadBoundary,
  RetrospectiveDerivationInput,
  ValidatedDurableState,
} from './types.js';
