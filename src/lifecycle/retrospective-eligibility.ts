/**
 * Retrospective-eligibility classification (WP-13 durability S1).
 *
 * Lifecycle validity and retrospective eligibility are separate questions.
 * The lifecycle graph validates durable state; this pure deterministic
 * classifier derives the retrospective/receipt eligibility of one durable
 * ExecutionAttemptRecord:
 *
 * - an outcome record exists for the exact attempt (workspace + bundle +
 *   occurrence + attempt) AND its anchor correlation validates against the
 *   attempt  → `retrospective-complete` candidate;
 * - otherwise (execution/completion still in progress, crash after attempt
 *   recording, or a normal WP-13A post-recording failure) the attempt is
 *   `terminal-unverifiable`: no ExecutionOutcomeRecord, no
 *   ExecutionRetrospectiveFacts, receipt-ineligible, no inferred
 *   disposition, no fabricated observation, no recovery synthesis.
 *
 * `terminal-unverifiable` is a VALID durable protocol state — it never makes
 * the lifecycle graph invalid and never marks the attempt record corrupt.
 *
 * Pure module: no I/O, no persistence, no authority, no mutation.
 */
import { bundleReferencesEqual } from '../internal/protocol-equality.js';

export type RetrospectiveEligibility = 'retrospective-complete' | 'terminal-unverifiable';

function str(r: Readonly<Record<string, unknown>>, key: string): string {
  const v = r[key];
  return typeof v === 'string' ? v : '';
}

/**
 * Classify one durable attempt against the outcome-record set.
 *
 * The exact attempt binding is the same uniqueness subject the
 * outcome-recorder uses (workspace + bundle instance/revision/digest +
 * occurrence + attempt). The anchor correlation requires the outcome record's
 * `execution_attempt_record_id` to resolve to the attempt itself, so an
 * outcome bound to a different attempt never classifies this attempt
 * retrospective-complete.
 */
export function classifyRetrospectiveEligibility(
  attempt: Readonly<Record<string, unknown>>,
  outcomes: readonly Readonly<Record<string, unknown>>[],
): RetrospectiveEligibility {
  const attemptId = str(attempt, 'record_id');
  const covered = outcomes.some(
    (o) =>
      str(o, 'record_type') === 'ExecutionOutcomeRecord' &&
      str(o, 'workspace_id') === str(attempt, 'workspace_id') &&
      str(o, 'occurrence_id') === str(attempt, 'occurrence_id') &&
      str(o, 'attempt_id') === str(attempt, 'attempt_id') &&
      str(o, 'execution_attempt_record_id') === attemptId &&
      bundleReferencesEqual(o['bundle'], attempt['bundle']),
  );
  return covered ? 'retrospective-complete' : 'terminal-unverifiable';
}
