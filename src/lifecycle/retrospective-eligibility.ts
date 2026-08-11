/**
 * WP-15 Phase 1A — authoritative receipt/outcome semantics (SIR-WP15-P1A-001…003).
 *
 * ONE shared exact outcome-resolution primitive and ONE authoritative
 * event/disposition mapping, consumed by every Phase 1A receipt-verification
 * path (EXE-012 receipt eligibility, the retrospective-complete classifier,
 * result-publication-correlation outcome resolution, EXE-008 receipt-facts
 * obligation qualification, and direct receipt semantic verification). No
 * parallel definitions of "matching outcome" exist.
 *
 * Exact outcome resolution (SIR-WP15-P1A-001): a matching
 * `ExecutionOutcomeRecord` MUST satisfy the exact subject — workspace_id,
 * occurrence_id, attempt_id, exact bundle/reference identity, AND the
 * `execution_attempt_record_id` anchor equal to the exact trusted
 * `ExecutionAttemptRecord` (plus the committed ordinal binding of the
 * outcome contract, EXE-010). Cardinality is exact:
 *
 *   - zero claimants                     → `none` (terminal-unverifiable /
 *                                         receipt-ineligible);
 *   - exactly one fully exact claimant   → `exactly-one-valid`;
 *   - more than one claimant             → `conflict` (fail closed; never
 *                                         "at least one", never first/latest,
 *                                         never enumeration order);
 *   - one claimant violating any exact binding
 *                                         → `malformed` (fail closed; a
 *                                         divergent competing record never
 *                                         becomes "one valid outcome").
 *
 * Event/disposition validation (SIR-WP15-P1A-003): the exact WP-15 contract
 * mapping (§3.2) with source-state agreement — the source record's
 * authoritative decision/state and the exact resolved outcome disposition
 * must agree with the receipt disposition; enforcement-denial requires a
 * `rejected` outcome WITH the committed enforcement-evidence group.
 *
 * Receipt qualification (SIR-WP15-P1A-002): `qualifyReceiptForAttempt` is a
 * pure semantic predicate — independent of finding emission and entry
 * filtering — used by the EXE-008 attempt-side receipt-facts obligation.
 * A receipt qualifies ONLY when its event type is a legitimate
 * attempt-correlated fact, its event_record_id is the exact attempt record,
 * its workspace/occurrence/attempt bindings are exact, the attempt is
 * exactly-one-valid outcome-covered, and the event/disposition pair is
 * valid. A `result-publication-correlation` receipt never satisfies the
 * general attempt receipt-facts obligation.
 *
 * Pure module: no I/O, no persistence, no authority, no mutation.
 */
import { bundleReferencesEqual } from '../internal/protocol-equality.js';

/** The exact trusted source class for each receipt event type (contract §3.2). */
export const ATTEMPT_CORRELATED_RECEIPT_EVENTS: ReadonlySet<string> = new Set([
  'attempt-start',
  'attempt-end',
  'enforcement-denial',
  'timeout',
  'crash',
]);

export type RetrospectiveEligibility = 'retrospective-complete' | 'terminal-unverifiable' | 'conflict';

/**
 * Exact outcome resolution result. The `outcome` is present ONLY in the
 * `exactly-one-valid` case; every other case fails closed.
 */
export type ExactOutcomeResolution =
  | { readonly kind: 'exactly-one-valid'; readonly outcome: Readonly<Record<string, unknown>> }
  | { readonly kind: 'none' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'malformed' };

function str(r: Readonly<Record<string, unknown>>, key: string): string {
  const v = r[key];
  return typeof v === 'string' ? v : '';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * THE one authoritative exact outcome resolver (SIR-WP15-P1A-001).
 *
 * `attempt` is the exact trusted `ExecutionAttemptRecord` anchor for the
 * subject. First identify EVERY `ExecutionOutcomeRecord` that claims this
 * attempt: either its workspace/occurrence/attempt tuple matches, OR it
 * cites this exact attempt record id. Only then validate every committed
 * binding (including bundle, anchor, and ordinal). This ensures an
 * anchor-linked or tuple-linked divergent record cannot disappear before
 * cardinality analysis.
 *
 * Never existential: `.some()`/`.find()` are not used for selection; the
 * semantic result is exact cardinality.
 */
export function resolveExactOutcome(
  attempt: Readonly<Record<string, unknown>>,
  outcomes: readonly Readonly<Record<string, unknown>>[],
): ExactOutcomeResolution {
  const workspaceId = str(attempt, 'workspace_id');
  const occurrenceId = str(attempt, 'occurrence_id');
  const attemptKey = str(attempt, 'attempt_id');
  const attemptRecordId = str(attempt, 'record_id');
  const ordinal = attempt['ordinal'];
  const bundle = attempt['bundle'];
  const claimants = outcomes.filter((o) => {
    if (str(o, 'record_type') !== 'ExecutionOutcomeRecord') return false;
    const tupleClaim =
      str(o, 'workspace_id') === workspaceId &&
      str(o, 'occurrence_id') === occurrenceId &&
      str(o, 'attempt_id') === attemptKey;
    return tupleClaim || str(o, 'execution_attempt_record_id') === attemptRecordId;
  });
  if (claimants.length === 0) return { kind: 'none' };
  // More than one claim against this attempt is conflicting durable state —
  // even when one claimant happens to be fully exact-bound.
  if (claimants.length > 1) return { kind: 'conflict' };
  const claimant = claimants[0]!;
  const exactBound =
    str(claimant, 'workspace_id') === workspaceId &&
    str(claimant, 'occurrence_id') === occurrenceId &&
    str(claimant, 'attempt_id') === attemptKey &&
    bundleReferencesEqual(claimant['bundle'], bundle) &&
    str(claimant, 'execution_attempt_record_id') === attemptRecordId &&
    claimant['ordinal'] === ordinal;
  return exactBound ? { kind: 'exactly-one-valid', outcome: claimant } : { kind: 'malformed' };
}

/**
 * Retrospective-eligibility classification delegating to the shared resolver
 * (SIR-WP15-P1A-001). `terminal-unverifiable` remains a VALID durable
 * protocol state (it never invalidates the lifecycle graph); `conflict`
 * covers conflicting/multiple/divergent authoritative outcome state and
 * fails closed.
 */
export function classifyRetrospectiveEligibility(
  attempt: Readonly<Record<string, unknown>>,
  outcomes: readonly Readonly<Record<string, unknown>>[],
): RetrospectiveEligibility {
  switch (resolveExactOutcome(attempt, outcomes).kind) {
    case 'exactly-one-valid':
      return 'retrospective-complete';
    case 'none':
      return 'terminal-unverifiable';
    default:
      return 'conflict';
  }
}

/** The committed ExecutionOutcomeRecord enforcement-evidence group (SIR-WP15-P1A-003 §12). */
function enforcementEvidencePresent(outcome: Readonly<Record<string, unknown>>): boolean {
  const e = outcome['enforcement_evidence'];
  if (!isRecord(e)) return false;
  const projection = e['projection_identity'];
  const fingerprint = e['evidence_fingerprint'];
  return typeof projection === 'string' && projection !== '' && typeof fingerprint === 'string' && fingerprint !== '';
}

/**
 * THE one authoritative receipt-disposition derivation (SIR-WP15-P1B-005).
 *
 * The `trusted-receipt-producer` constructs every receipt disposition
 * through THIS primitive; the receipt-production family carries no second
 * event/disposition map. The derivation is the exact inverse of the
 * committed `receiptEventDispositionOk` validator (same contract §3.2
 * semantics):
 *
 *   activation accepted → accepted; denied → denied
 *   occurrence-start / attempt-start → started
 *   attempt-end → the exact seven-value outcome disposition (one-to-one)
 *   enforcement-denial → denied ONLY when the exact outcome is `rejected`
 *     WITH the committed enforcement-evidence group
 *   cancellation → cancelled
 *   timeout → timed-out; crash → crashed
 *   result-publication-correlation → completed
 *
 * `exactOutcome` is the exact resolved outcome (present iff the event is
 * attempt-correlated and eligibility resolved). Not-derivable (unknown
 * event type, unknown activation decision, missing/incompatible outcome)
 * returns `{ ok: false }` — never a guessed disposition.
 */
export type ReceiptDispositionDerivation =
  | { readonly ok: true; readonly disposition: string }
  | { readonly ok: false };

export function deriveReceiptDisposition(
  eventType: string,
  eventSource: Readonly<Record<string, unknown>>,
  exactOutcome: Readonly<Record<string, unknown>> | undefined,
): ReceiptDispositionDerivation {
  switch (eventType) {
    case 'activation-decision': {
      const decision = str(eventSource, 'decision');
      if (decision === 'accepted') return { ok: true, disposition: 'accepted' };
      if (decision === 'denied') return { ok: true, disposition: 'denied' };
      return { ok: false };
    }
    case 'occurrence-start':
    case 'attempt-start':
      return { ok: true, disposition: 'started' };
    case 'attempt-end':
      return exactOutcome !== undefined
        ? { ok: true, disposition: str(exactOutcome, 'disposition') }
        : { ok: false };
    case 'enforcement-denial':
      // denied ONLY when the exact outcome is rejected WITH the committed
      // enforcement-evidence group (contract §3.2; SIR-WP15-P1A-003 §12); a
      // completed outcome or missing/partial evidence is NOT derivable.
      return exactOutcome !== undefined &&
        str(exactOutcome, 'disposition') === 'rejected' &&
        enforcementEvidencePresent(exactOutcome)
        ? { ok: true, disposition: 'denied' }
        : { ok: false };
    case 'cancellation':
      return { ok: true, disposition: 'cancelled' };
    case 'timeout':
      return { ok: true, disposition: 'timed-out' };
    case 'crash':
      return { ok: true, disposition: 'crashed' };
    case 'result-publication-correlation':
      return { ok: true, disposition: 'completed' };
    default:
      return { ok: false };
  }
}

/**
 * THE one authoritative event/disposition validator (SIR-WP15-P1A-003 §10).
 *
 * Implements the exact WP-15 contract mapping (§3.2) and requires source
 * state agreement (§11): the source record's authoritative
 * decision/state — and, for attempt-correlated events, the exact resolved
 * outcome disposition — must match the receipt disposition. Enforcement-
 * denial additionally requires a `rejected` outcome WITH the committed
 * enforcement-evidence group (§12); a completed outcome or missing evidence
 * fails. Outcome disposition and event disposition stay distinct (`rejected`
 * outcome is never mapped to a `denied` receipt for attempt-end; the
 * enforcement-denial event keeps its event-specific `denied` disposition).
 *
 * `outcome` is the exact resolved outcome (present iff the event is
 * attempt-correlated and eligibility resolved).
 */
export function receiptEventDispositionOk(
  eventType: string,
  disposition: string,
  event: Readonly<Record<string, unknown>>,
  outcome: Readonly<Record<string, unknown>> | undefined,
): boolean {
  switch (eventType) {
    case 'activation-decision': {
      const decision = str(event, 'decision');
      if (decision === 'accepted') return disposition === 'accepted';
      if (decision === 'denied') return disposition === 'denied';
      return false;
    }
    case 'occurrence-start':
      return disposition === 'started';
    case 'attempt-start':
      return disposition === 'started';
    case 'attempt-end':
      // exact outcome disposition, one-to-one, no lossy conversion
      return outcome !== undefined && disposition === str(outcome, 'disposition');
    case 'enforcement-denial':
      return (
        disposition === 'denied' &&
        outcome !== undefined &&
        str(outcome, 'disposition') === 'rejected' &&
        enforcementEvidencePresent(outcome)
      );
    case 'cancellation':
      if (str(event, 'record_type') === 'ExecutionOccurrenceRecord') {
        // occurrence-level cancellation: exact committed cancellation source/state
        return disposition === 'cancelled';
      }
      return disposition === 'cancelled' && outcome !== undefined && str(outcome, 'disposition') === 'cancelled';
    case 'timeout':
      return disposition === 'timed-out' && outcome !== undefined && str(outcome, 'disposition') === 'timed-out';
    case 'crash':
      return disposition === 'crashed' && outcome !== undefined && str(outcome, 'disposition') === 'crashed';
    case 'result-publication-correlation':
      return disposition === 'completed';
    default:
      return false;
  }
}

/**
 * Pure semantic qualification of one receipt against one exact attempt
 * (SIR-WP15-P1A-002 §6/§7). Used by the EXE-008 attempt-side receipt-facts
 * obligation; independent of finding emission and entry filtering.
 *
 * Qualifies ONLY when ALL hold:
 *   - event type is a legitimate attempt-correlated fact for the attempt
 *     (attempt-start, attempt-end, enforcement-denial, timeout, crash, and
 *     attempt-level cancellation — the event_record_id must be the exact
 *     attempt record, so occurrence-level cancellation never qualifies);
 *   - event_record_id === the exact attempt record (exact source identity);
 *   - workspace/occurrence/attempt bindings exact;
 *   - the attempt is exactly-one-valid outcome-covered (EXE-012);
 *   - the event/disposition pair is valid (receiptEventDispositionOk).
 *
 * A `result-publication-correlation` receipt NEVER satisfies the general
 * attempt receipt-facts obligation.
 */
export function qualifyReceiptForAttempt(
  receipt: Readonly<Record<string, unknown>>,
  attempt: Readonly<Record<string, unknown>>,
  outcomes: readonly Readonly<Record<string, unknown>>[],
): boolean {
  const eventType = str(receipt, 'event_type');
  if (!ATTEMPT_CORRELATED_RECEIPT_EVENTS.has(eventType) && eventType !== 'cancellation') return false;
  if (str(receipt, 'event_record_id') !== str(attempt, 'record_id')) return false;
  if (str(receipt, 'workspace_id') !== str(attempt, 'workspace_id')) return false;
  if (str(receipt, 'occurrence_id') !== str(attempt, 'occurrence_id')) return false;
  if (str(receipt, 'attempt_id') !== str(attempt, 'attempt_id')) return false;
  const resolution = resolveExactOutcome(attempt, outcomes);
  if (resolution.kind !== 'exactly-one-valid') return false;
  return receiptEventDispositionOk(eventType, str(receipt, 'disposition'), attempt, resolution.outcome);
}
