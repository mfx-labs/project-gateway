/**
 * WP-7 — Operational error codes (23 closed enumeration).
 *
 * Every code has exactly one primary condition. Naming follows
 * ERR-<AREA>-<NAME>. Codes are stable; messages are safe keys.
 */
import { type OperationFailure, type OperationCorrelation, type FailureStage, failure } from './types.js';

// ---------------------------------------------------------------------------
// Error code enumeration (23 codes — closed)
// ---------------------------------------------------------------------------

export const ERROR_CODES = Object.freeze([
  'ERR-REQ-INVALID',
  'ERR-WS-UNKNOWN',
  'ERR-CON-DENIED',
  'ERR-SYM-ESCAPE',
  'ERR-PAT-TRAVERSAL',
  'ERR-FTYPE-UNSUPPORTED',
  'ERR-NOT-FOUND',
  'ERR-PERM-DENIED',
  'ERR-LIMIT-SIZE',
  'ERR-LIMIT-ENTRIES',
  'ERR-LIMIT-RESULTS',
  'ERR-LIMIT-CONCURRENCY',
  'ERR-TEXT-MALFORMED',
  'ERR-OP-CANCELLED',
  'ERR-GIT-UNAVAILABLE',
  'ERR-GIT-NOT-REPO',
  'ERR-GIT-STATE-UNSUPPORTED',
  'ERR-GIT-TIMEOUT',
  'ERR-GIT-SANITIZED-FAILURE',
  'ERR-FFF-UNAVAILABLE',
  'ERR-FFF-TIMEOUT',
  'ERR-FFF-MALFORMED',
  'ERR-INTERNAL-INVARIANT',
] as const);

export type ErrorCode = (typeof ERROR_CODES)[number];

// Retryable codes
const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'ERR-GIT-TIMEOUT',
  'ERR-GIT-UNAVAILABLE',
  'ERR-FFF-TIMEOUT',
  'ERR-FFF-UNAVAILABLE',
]);

export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE.has(code);
}

// ---------------------------------------------------------------------------
// Constructors — each maps exactly one condition
// ---------------------------------------------------------------------------

function makeFailure(
  code: ErrorCode,
  stage: FailureStage,
  messageKey: string,
  correlation: OperationCorrelation,
): OperationFailure {
  return failure(code, stage, messageKey, isRetryable(code), correlation);
}

// Request validation
export function errReqInvalid(messageKey: string, correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-REQ-INVALID', 'request-validation', `wp7.request.${messageKey}`, correlation);
}

// Unknown workspace
export function errWsUnknown(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-WS-UNKNOWN', 'containment', 'wp7.containment.workspace-unknown', correlation);
}

// Containment denial (ordinary)
export function errConDenied(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-CON-DENIED', 'containment', 'wp7.containment.denied', correlation);
}

// Symlink escape
export function errSymEscape(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-SYM-ESCAPE', 'containment', 'wp7.containment.symlink-escape', correlation);
}

// Path traversal
export function errPatTraversal(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-PAT-TRAVERSAL', 'containment', 'wp7.containment.traversal', correlation);
}

// Unsupported file type
export function errFtypeUnsupported(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-FTYPE-UNSUPPORTED', 'filesystem', 'wp7.filesystem.unsupported-type', correlation);
}

// Not found
export function errNotFound(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-NOT-FOUND', 'filesystem', 'wp7.filesystem.not-found', correlation);
}

// Permission denied
export function errPermDenied(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-PERM-DENIED', 'filesystem', 'wp7.filesystem.permission-denied', correlation);
}

// Limit: size
export function errLimitSize(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-LIMIT-SIZE', 'internal', 'wp7.limit.size', correlation);
}

// Limit: entries
export function errLimitEntries(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-LIMIT-ENTRIES', 'internal', 'wp7.limit.entries', correlation);
}

// Limit: results
export function errLimitResults(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-LIMIT-RESULTS', 'internal', 'wp7.limit.results', correlation);
}

// Limit: concurrency
export function errLimitConcurrency(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-LIMIT-CONCURRENCY', 'internal', 'wp7.limit.concurrency', correlation);
}

// Text malformed
export function errTextMalformed(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-TEXT-MALFORMED', 'filesystem', 'wp7.filesystem.text-malformed', correlation);
}

// Operation cancelled
export function errOpCancelled(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-OP-CANCELLED', 'internal', 'wp7.internal.cancelled', correlation);
}

// Git unavailable
export function errGitUnavailable(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-GIT-UNAVAILABLE', 'git', 'wp7.git.unavailable', correlation);
}

// Git not a repo
export function errGitNotRepo(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-GIT-NOT-REPO', 'git', 'wp7.git.not-repo', correlation);
}

// Git state unsupported
export function errGitStateUnsupported(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-GIT-STATE-UNSUPPORTED', 'git', 'wp7.git.state-unsupported', correlation);
}

// Git timeout
export function errGitTimeout(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-GIT-TIMEOUT', 'git', 'wp7.git.timeout', correlation);
}

// Git sanitized failure
export function errGitSanitizedFailure(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-GIT-SANITIZED-FAILURE', 'git', 'wp7.git.sanitized-failure', correlation);
}

// FFF unavailable
export function errFffUnavailable(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-FFF-UNAVAILABLE', 'discovery', 'wp7.fff.unavailable', correlation);
}

// FFF timeout
export function errFffTimeout(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-FFF-TIMEOUT', 'discovery', 'wp7.fff.timeout', correlation);
}

// FFF malformed
export function errFffMalformed(correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-FFF-MALFORMED', 'discovery', 'wp7.fff.malformed', correlation);
}

// Internal invariant
export function errInternalInvariant(messageKey: string, correlation: OperationCorrelation): OperationFailure {
  return makeFailure('ERR-INTERNAL-INVARIANT', 'internal', `wp7.internal.${messageKey}`, correlation);
}
