/**
 * WP-8 closed error-code vocabulary (contract 18.1; ERM-001…015).
 *
 * Exactly 31 closed `ERR-STO-*` codes with deterministic per-code
 * phase/retryability/recovery/state/durability/audit/verify semantics.
 * Filesystem-originating errors are represented but never generated from
 * real filesystem operations in this phase.
 */
import type { ErrorStateSummary, OperationPhase } from '../types.js';

export interface ErrorCodeDefinition {
  readonly code: string;
  /** Static, disclosure-safe message (ERM-004). */
  readonly message: string;
  /** Typical phase where the code arises. */
  readonly phase: OperationPhase;
  readonly state: ErrorStateSummary;
}

const NO: ErrorStateSummary = { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false };
const UNKNOWN: ErrorStateSummary = { retryable: false, recoveryRequired: false, primaryStateChanged: 'unknown', durabilityPointReached: 'unknown', auditChanged: 'unknown', verifyBeforeRetry: true };

function def(code: string, message: string, phase: OperationPhase, state: ErrorStateSummary): ErrorCodeDefinition {
  return { code, message, phase, state };
}

/**
 * The closed set of 31 codes. ERR-STO-READONLY-FS is one code with three
 * phase-parameterized rows (18.1, ERM-015).
 */
export const ERROR_CODE_DEFINITIONS: readonly ErrorCodeDefinition[] = [
  def('ERR-STO-REQ-INVALID', 'request or operand is malformed or unknown', 'request-validation', NO),
  def('ERR-STO-CONFIG-UNAVAILABLE', 'trusted configuration is absent or invalid', 'request-validation', NO),
  def('ERR-STO-ROOT-INVALID', 'root path is invalid, forbidden, or relative', 'request-validation', NO),
  def('ERR-STO-ROOT-IDENTITY-CHANGED', 'root identity changed; re-initialization required', 'request-validation', { retryable: false, recoveryRequired: true, primaryStateChanged: 'unknown', durabilityPointReached: 'unknown', auditChanged: 'no', verifyBeforeRetry: true }),
  def('ERR-STO-CONTAINMENT-DENIED', 'derived path escapes the containment profile', 'request-validation', NO),
  def('ERR-STO-FTYPE-UNSUPPORTED', 'a special file or unsupported file type was encountered', 'temporary-write', NO),
  def('ERR-STO-PERM-DENIED', 'permission, ownership, or ACL policy violation', 'temporary-write', NO),
  def('ERR-STO-NOT-FOUND', 'record or identity is absent', 'request-validation', { retryable: true, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false }),
  def('ERR-STO-DUPLICATE', 'same identifier with different bytes; existing record must be verified', 'post-primary-publication', { retryable: false, recoveryRequired: false, primaryStateChanged: 'yes', durabilityPointReached: 'yes', auditChanged: 'no', verifyBeforeRetry: true }),
  def('ERR-STO-CONFLICT-REVISION', 'conflicting revision or revision/digest mismatch', 'pre-publication', { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: true }),
  def('ERR-STO-INTEGRITY', 'digest, chain, or location verification failed; quarantine required', 'pre-publication', { retryable: false, recoveryRequired: true, primaryStateChanged: 'yes', durabilityPointReached: 'unknown', auditChanged: 'no', verifyBeforeRetry: true }),
  def('ERR-STO-UNSUPPORTED-VERSION', 'format or record version is outside the supported set', 'request-validation', NO),
  def('ERR-STO-MALFORMED', 'record bytes are non-canonical or malformed', 'request-validation', NO),
  def('ERR-STO-DURABILITY', 'durability point not reached; verify state before retry', 'acknowledgement', { retryable: true, recoveryRequired: true, primaryStateChanged: 'unknown', durabilityPointReached: 'unknown', auditChanged: 'unknown', verifyBeforeRetry: true }),
  def('ERR-STO-PUBLISH-FAILED', 'atomic publication failed; verify state before retry', 'post-primary-publication', { retryable: true, recoveryRequired: true, primaryStateChanged: 'unknown', durabilityPointReached: 'unknown', auditChanged: 'unknown', verifyBeforeRetry: true }),
  def('ERR-STO-LOCK-UNAVAILABLE', 'writer lock is held, contended, or liveness is undeterminable', 'lock-acquisition', { retryable: true, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false }),
  def('ERR-STO-LOCK-TIMEOUT', 'lock wait exceeded the bounded limit', 'lock-acquisition', { retryable: true, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false }),
  def('ERR-STO-CONCURRENCY', 'a concurrent writer was rejected', 'lock-acquisition', { retryable: true, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false }),
  def('ERR-STO-CANCELLED', 'caller cancellation before the durability point', 'pre-publication', NO),
  def('ERR-STO-TIMEOUT', 'operation timeout before the durability point', 'pre-publication', { retryable: true, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false }),
  def('ERR-STO-RETENTION-DENIED', 'retention action is not authorized', 'request-validation', NO),
  def('ERR-STO-RECOVERY-REQUIRED', 'recovery must run before normal operation resumes', 'recovery', { retryable: false, recoveryRequired: true, primaryStateChanged: 'n/a', durabilityPointReached: 'n/a', auditChanged: 'n/a', verifyBeforeRetry: false }),
  def('ERR-STO-RECOVERY-FAILED', 'recovery could not complete', 'recovery', { retryable: false, recoveryRequired: true, primaryStateChanged: 'n/a', durabilityPointReached: 'n/a', auditChanged: 'n/a', verifyBeforeRetry: false }),
  def('ERR-STO-INTERNAL-INVARIANT', 'an unreachable invariant was violated; verify state before retry', 'unknown', UNKNOWN),
  def('ERR-STO-NO-SPACE', 'capacity limit reached during a store operation', 'temporary-write', { retryable: true, recoveryRequired: false, primaryStateChanged: 'unknown', durabilityPointReached: 'unknown', auditChanged: 'unknown', verifyBeforeRetry: true }),
  def('ERR-STO-QUOTA-EXCEEDED', 'quota exceeded during a store operation', 'temporary-write', { retryable: true, recoveryRequired: false, primaryStateChanged: 'unknown', durabilityPointReached: 'unknown', auditChanged: 'unknown', verifyBeforeRetry: true }),
  // ERR-STO-READONLY-FS — one code, three phase rows (ERM-015).
  def('ERR-STO-READONLY-FS', 'read-only filesystem detected before publication', 'pre-publication', { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false }),
  def('ERR-STO-READONLY-FS', 'read-only filesystem detected after primary publication', 'post-primary-publication', { retryable: false, recoveryRequired: true, primaryStateChanged: 'unknown', durabilityPointReached: 'unknown', auditChanged: 'unknown', verifyBeforeRetry: true }),
  def('ERR-STO-READONLY-FS', 'read-only filesystem detected after audit publication', 'post-audit-publication', { retryable: false, recoveryRequired: false, primaryStateChanged: 'yes', durabilityPointReached: 'yes', auditChanged: 'unknown', verifyBeforeRetry: true }),
  def('ERR-STO-CROSS-DEVICE', 'cross-device condition during publication', 'post-primary-publication', NO),
  def('ERR-STO-FS-UNSUPPORTED', 'unsupported filesystem or missing primitive', 'request-validation', NO),
  def('ERR-STO-IO-FAILURE', 'general I/O failure', 'temporary-write', { retryable: true, recoveryRequired: true, primaryStateChanged: 'unknown', durabilityPointReached: 'unknown', auditChanged: 'unknown', verifyBeforeRetry: true }),
  def('ERR-STO-LIMIT-EXCEEDED', 'a store-internal limit was exceeded', 'request-validation', NO),
];

export const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODE_DEFINITIONS.map((d) => d.code));

export const READONLY_FS_PHASES: readonly OperationPhase[] = ['pre-publication', 'post-primary-publication', 'post-audit-publication'];

export function isClosedErrorCode(code: string): boolean {
  return ERROR_CODE_SET.has(code);
}

export function errorCodeDefinition(code: string): ErrorCodeDefinition | undefined {
  return ERROR_CODE_DEFINITIONS.find((d) => d.code === code);
}

/** Deterministic phase-parameterized semantics for ERR-STO-READONLY-FS (ERM-015). */
export function readonlyFsState(phase: OperationPhase): ErrorCodeDefinition | undefined {
  if (phase === 'pre-publication' || phase === 'post-primary-publication' || phase === 'post-audit-publication') {
    return ERROR_CODE_DEFINITIONS.find((d) => d.code === 'ERR-STO-READONLY-FS' && d.phase === phase);
  }
  return undefined;
}
