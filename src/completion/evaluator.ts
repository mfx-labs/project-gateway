/**
 * WP-13B — deterministic completion evaluation (pure).
 *
 * The completion decision gate (§4.2) and the check evaluation for the
 * retrospective result body. Everything here is a pure function of
 * committed/validated inputs: the WP-13A outcome, the WP-5A observation,
 * the validated CompletionContract, and the enforcement-evidence reference.
 * Nothing is fabricated: a non-completed disposition, a missing observation,
 * or a missing contract yields a bounded NO-RESULT decision (EXE-008/009);
 * the result body carries only observed facts.
 */
import type { ExecutionAttemptOutcome } from '../execution/types.js';
import type { PiExecutionObservation } from '../adapters/pi/types.js';
import type { ValidatedArtifact } from '../api/types.js';
import type { CompletionAttemptFacts, NoResultReason, ResultEvidenceReference } from './types.js';

export type CompletionDecision =
  | { readonly decision: 'produce' }
  | { readonly decision: 'no-result'; readonly reason: NoResultReason };

/**
 * Deterministic completion gate (§4.2 + EXE-008/009):
 * - `completed` → produce, provided the evaluation evidence (observation)
 *   and the validated CompletionContract are available;
 * - `rejected` → NO result (denied reservation/attempt never gains a result
 *   association; EXE-009);
 * - `incomplete` → NO result (ambiguous, fail closed);
 * - `failed`/`cancelled`/`timed-out`/`crashed` → NO result (retryable;
 *   completion evaluation happens only for a completed attempt);
 * - absent observation / absent contract → NO result (evaluation evidence
 *   unavailable; the protocol never fabricates one).
 */
export function completionDecision(input: {
  readonly outcome: ExecutionAttemptOutcome;
  readonly observation: PiExecutionObservation | undefined;
  readonly completionContract: ValidatedArtifact | undefined;
}): CompletionDecision {
  switch (input.outcome.disposition) {
    case 'completed':
      break;
    case 'rejected':
      return { decision: 'no-result', reason: 'disposition-rejected' };
    case 'incomplete':
      return { decision: 'no-result', reason: 'disposition-ambiguous' };
    default:
      return { decision: 'no-result', reason: 'disposition-non-completed' };
  }
  if (input.observation === undefined) return { decision: 'no-result', reason: 'evidence-unavailable' };
  if (input.completionContract === undefined) return { decision: 'no-result', reason: 'contract-unavailable' };
  return { decision: 'produce' };
}

/** One evaluated completion-check observation (committed body vocabulary). */
export interface CompletionCheckObservation {
  readonly check_id: string;
  readonly status: 'satisfied' | 'not-satisfied' | 'not-evaluated';
  readonly evidence: readonly ResultEvidenceReference[];
}

/**
 * Deterministic check evaluation over the committed CompletionContract
 * check vocabulary. The evidence references consulted are exactly the
 * committed result evidence references; produced-artifact references are
 * empty in WP-13B (no produced artifacts are ever fabricated).
 */
export function evaluateChecks(input: {
  readonly contract: ValidatedArtifact;
  readonly evidenceReferences: readonly ResultEvidenceReference[];
  readonly producedArtifactInstanceIds: readonly string[];
}): CompletionCheckObservation[] {
  const model = input.contract.model as Readonly<Record<string, unknown>>;
  const body = isRecord(model['body']) ? model['body'] : undefined;
  const checks = isRecord(body) && Array.isArray(body['checks']) ? (body['checks'] as readonly unknown[]) : [];
  const referenceKinds = new Set<string>(input.evidenceReferences.map((r) => r.kind));
  const observations: CompletionCheckObservation[] = [];
  for (const raw of checks) {
    if (!isRecord(raw)) continue;
    const checkId = raw['check_id'];
    if (typeof checkId !== 'string') continue;
    const check = raw['check'];
    if (!isRecord(check)) continue;
    const checkType = check['type'];
    let status: CompletionCheckObservation['status'] = 'not-evaluated';
    let evidence: readonly ResultEvidenceReference[] = [];
    if (checkType === 'project-gateway.deliverable-presence') {
      const expected = check['expected_deliverable_ids'];
      if (Array.isArray(expected)) {
        const satisfied = (expected as readonly unknown[]).every((id) => typeof id === 'string' && input.producedArtifactInstanceIds.includes(id));
        status = satisfied ? 'satisfied' : 'not-satisfied';
        // No produced-artifact references exist in WP-13B: nothing is consulted.
        evidence = [];
      }
    } else if (checkType === 'project-gateway.evidence-presence') {
      const required = check['required_evidence_kinds'];
      if (Array.isArray(required)) {
        const satisfied = (required as readonly unknown[]).every((kind) => typeof kind === 'string' && referenceKinds.has(kind));
        status = satisfied ? 'satisfied' : 'not-satisfied';
        evidence = input.evidenceReferences;
      }
    }
    observations.push({ check_id: checkId, status, evidence });
  }
  return observations;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Ensure the completion gate facts are exactly correlated (attempt-level). */
export function completionFactsCorrelated(input: {
  readonly workspaceId: string;
  readonly attempt: CompletionAttemptFacts;
  readonly outcome: ExecutionAttemptOutcome;
  readonly observation: PiExecutionObservation;
}): boolean {
  return (
    input.outcome.occurrenceId === input.attempt.occurrenceId &&
    input.outcome.attemptId === input.attempt.attemptId &&
    input.outcome.ordinal === input.attempt.ordinal &&
    input.observation.occurrenceId === input.attempt.occurrenceId &&
    input.observation.attemptId === input.attempt.attemptId
  );
}
