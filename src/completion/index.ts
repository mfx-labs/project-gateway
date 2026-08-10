/**
 * WP-13B — completion & result (barrel).
 *
 * Completion/result foundation only: no ADR-038 publication authority, no
 * ResultPublicationRecord, no publication scopes, no ExecutionRetrospectiveFacts,
 * no TrustedReceipt — those remain WP-13C/D. Nothing here grants lifecycle
 * authority, activates pi-guard, or publishes lifecycle records (WP-12 stays
 * the trusted ValidationRecord producer through `recordValidation`).
 */
export { completeExecution, COMPLETION_EVALUATOR_ID, COMPLETION_EVALUATOR_CAPABILITY_PROFILE_ID } from './run.js';
export { createResultValidationBoundary } from './control-plane.js';
export { completionDecision, evaluateChecks, completionFactsCorrelated } from './evaluator.js';
export { buildResultModel, enforcementEvidenceReference } from './result.js';
export { writeResultArtifact, resultRelativePath, RESULT_RELATIVE_DIR, RESULT_FILE_NAME, RESULT_BYTE_LIMIT } from './writer.js';
export * from './types.js';
