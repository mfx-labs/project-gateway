/**
 * WP-13A — execution foundation (barrel).
 *
 * Execution foundation only (WP-13A): no CompletionContract evaluation, no
 * ExecutionResult, no result publication, no ExecutionRetrospectiveFacts,
 * no TrustedReceipt — those remain WP-13B/C/D. Nothing here grants
 * lifecycle authority, activates pi-guard, or publishes lifecycle records.
 */
export { executeExecutionAttempt } from './run.js';
export { createControlPlaneExecutionBoundary } from './control-plane.js';
export { classifyDisposition, evaluateRetryEligibility, terminalReason, isExecutionAttemptOutcome } from './retry.js';
export * from './types.js';
