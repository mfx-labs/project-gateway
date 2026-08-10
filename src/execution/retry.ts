/**
 * WP-13A — retry decision core (committed retry rule §4).
 *
 * Pure, deterministic retry-eligibility evaluation. WP-13A owns the retry
 * DECISION and the proposed ordinal; WP-12 remains the authoritative
 * recorder/gate (`recordExecutionAttempt` re-validates every proposal).
 * There is no scheduler, no timer, no queue: this evaluation runs only
 * inside an explicit execution request.
 */
import type { DurableAttemptFact, ExecutionAttemptDisposition, ExecutionAttemptOutcome, RetryClassification, RetryNonProposalReason } from './types.js';
import { EXECUTION_ATTEMPT_DISPOSITIONS } from './types.js';

/** Closed-vocabulary guard for a host-supplied previous outcome. */
export function isExecutionAttemptOutcome(value: unknown): value is ExecutionAttemptOutcome {
  if (value === null || typeof value !== 'object') return false;
  const o = value as Readonly<Record<string, unknown>>;
  if (!EXECUTION_ATTEMPT_DISPOSITIONS.includes(o['disposition'] as ExecutionAttemptDisposition)) return false;
  if (typeof o['occurrenceId'] !== 'string' || o['occurrenceId'].length === 0) return false;
  if (typeof o['attemptId'] !== 'string' || o['attemptId'].length === 0) return false;
  if (typeof o['ordinal'] !== 'number' || !Number.isSafeInteger(o['ordinal']) || (o['ordinal'] as number) < 1) return false;
  if (typeof o['observedAt'] !== 'string' || o['observedAt'].length === 0) return false;
  return true;
}

/**
 * Deterministic terminal-vs-retryable classification (§4.2). `completed`
 * proceeds to completion evaluation (WP-13B); `rejected` (enforcement
 * denial) and `incomplete` (ambiguous) are terminal with no retry.
 */
export function classifyDisposition(disposition: ExecutionAttemptOutcome['disposition']): RetryClassification {
  switch (disposition) {
    case 'failed':
    case 'cancelled':
    case 'timed-out':
    case 'crashed':
      return 'retryable';
    default:
      return 'terminal';
  }
}

/** The terminal non-proposal reason for a terminal disposition. */
export function terminalReason(disposition: ExecutionAttemptOutcome['disposition']): RetryNonProposalReason {
  switch (disposition) {
    case 'completed':
      return 'terminal-completed';
    case 'rejected':
      return 'terminal-rejected';
    default:
      return 'terminal-ambiguous';
  }
}

export type RetryEvaluation =
  | { readonly mayPropose: true; readonly ordinal: number }
  | { readonly mayPropose: false; readonly reason: RetryNonProposalReason };

export interface RetryEvaluationInput {
  readonly occurrenceId: string;
  readonly workspaceId: string;
  /** In-session outcome of the immediately preceding attempt (absent = first attempt). */
  readonly previousOutcome: ExecutionAttemptOutcome | undefined;
  /** Durable attempt facts for the exact occurrence (immutable record set; S4-D3 source). */
  readonly durableAttempts: readonly DurableAttemptFact[];
  /** Currentness/allowance facts from the WP-12 orchestration decision. */
  readonly orchestration: {
    readonly runtimeGrantId: string;
    readonly grantCurrent: boolean;
    readonly remainingAllowance: number;
  };
}

/**
 * Evaluate retry eligibility and derive the proposed ordinal (§4.3/§4.4/§4.5/
 * §4.6/§4.8). Every condition must hold; any ambiguity fails closed. The
 * proposed ordinal is always the durable attempt count + 1 (gapless; the
 * WP-12 boundary re-validates it authoritatively).
 */
export function evaluateRetryEligibility(input: RetryEvaluationInput): RetryEvaluation {
  const { previousOutcome, durableAttempts, orchestration } = input;
  const count = durableAttempts.length;
  const sorted = [...durableAttempts].sort((a, b) => a.ordinal - b.ordinal);
  const last = count > 0 ? sorted[count - 1] : undefined;

  // First attempt: no retry basis required; ordinal 1 (S4-D3).
  if (previousOutcome === undefined) {
    if (count === 0) return { mayPropose: true, ordinal: 1 };
    // A retry request without the in-session previous outcome: the host
    // lost the execution basis (e.g. restart). Fail closed — a restart
    // requires a fresh activation decision and projection (WP-5B), i.e. a
    // fresh occurrence, never a retry.
    return { mayPropose: false, reason: 'basis-ambiguous' };
  }

  // A supplied outcome for an occurrence with no durable attempt is a stale
  // or conflicting basis.
  if (count === 0 || last === undefined) return { mayPropose: false, reason: 'basis-ambiguous' };
  if (previousOutcome.occurrenceId !== input.occurrenceId) return { mayPropose: false, reason: 'basis-ambiguous' };

  // Terminal outcomes never retry (§4.2).
  if (classifyDisposition(previousOutcome.disposition) === 'terminal') {
    return { mayPropose: false, reason: terminalReason(previousOutcome.disposition) };
  }

  // Stale basis: the outcome must be the outcome of the LATEST durable
  // attempt (the immediately preceding attempt; §4.6/§4.7).
  if (previousOutcome.attemptId !== last.attemptId) return { mayPropose: false, reason: 'basis-stale' };

  // EXE-006 subject stability (§4.3.4): every durable attempt must share
  // the exact occurrence grant and the exact bundle reference of the first
  // attempt. WP-12 remains the authoritative byte-level gate.
  const first = sorted[0]!;
  const subjectStable = durableAttempts.every(
    (a) =>
      a.runtimeGrantId === orchestration.runtimeGrantId &&
      JSON.stringify(a.bundle) === JSON.stringify(first.bundle),
  );
  if (!subjectStable) return { mayPropose: false, reason: 'subject-mismatch' };

  // Grant currentness and allowance (§4.3.3/§4.5): derived from the WP-12
  // orchestration decision; the durable set is the count source (S4-D4).
  if (!orchestration.grantCurrent) return { mayPropose: false, reason: 'grant-not-current' };
  if (orchestration.remainingAllowance < 1) {
    return { mayPropose: false, reason: 'allowance-exhausted' };
  }

  // §4.3.7/§4.4: ordinal = durable count + 1 (unique, gapless).
  return { mayPropose: true, ordinal: count + 1 };
}
