/**
 * WP-13 durability S3 — trusted execution-outcome production type
 * vocabulary.
 *
 * The outcome-production authority (ADR-039 §9/§10; WP-13 durability
 * decision §1–§9) turns ONE already trusted retrospective-complete attempt
 * (durable ExecutionAttemptRecord + verified terminal ExecutionAttemptOutcome
 * + genuine correlated PiExecutionObservation, optional exactly correlated
 * PiEnforcementEvidence, optional ValidatedResultHandoff + exact passing
 * ValidationRecord) into AT MOST ONE durable ExecutionOutcomeRecord through
 * the S2 outcome store boundary — under the attempt-level coordination lock,
 * with under-lock re-read, material replay/conflict semantics, and opaque
 * identity/timestamp allocation ONLY in the no-existing branch.
 *
 * S3 performs NO ExecutionRetrospectiveFacts derivation (S4), NO receipt
 * production (WP-15), NO result publication (WP-13C), and NO
 * recovery/resume protocol.
 *
 * Committed contract: ADR-039, docs/reports/wp-13-closure-durability-architecture-decision.md
 * §1–§11/§15, the S2 outcome authority boundary, and the committed
 * `execution-outcome-record` lifecycle schema (S1).
 */
import type { PiExecutionObservation } from '../adapters/pi/types.js';
import type { PiEnforcementEvidence } from '../adapters/pi/enforcement/types.js';
import type { ExecutionAttemptOutcome } from '../execution/types.js';
import type { ValidatedResultHandoff } from '../completion/types.js';
import type { AcceptedRegistryContext } from '../api/types.js';
import type { DecisionCoordinator, ControlPlaneStoreBoundary } from '../control-plane/types.js';
import type { OutcomeStoreBoundary } from '../outcome/types.js';
import type { PublicationInput, PublicationResult } from '../publication/types.js';

/** Host-owned opaque identity/time sources (D-3 pattern; WP-12/WP-13B family). */
export interface OutcomeIdentitySource {
  /** Trusted UTC timestamp in the accepted `YYYY-MM-DDTHH:MM:SS.sssZ` form. */
  readonly nowUtcIso: () => string;
  /** Fresh opaque lifecycle record identity (`pgw:l:<32 lowercase hex>`); non-reusable. */
  readonly newRecordId: () => string;
  /** Fresh opaque observation evidence identity (`pgw:e:<32 lowercase hex>`); non-reusable. */
  readonly newEvidenceId: () => string;
}

// ─── closed S3 decision failure taxonomy ────────────────────────────────────

export const OUTCOME_PRODUCTION_FAILURE_CATEGORIES = [
  /** Trusted input/correlation invalid (never a lifecycle-state corruption). */
  'OUTCOME-INPUT-INVALID',
  /** S2 authority denial (capability not genuine/disposed/stale; permit denied at the sink). */
  'OUTCOME-CAPABILITY-DENIED',
  /** Attempt coordination lock contention surfaced by the committed coordinator. */
  'OUTCOME-LOCK-CONFLICT',
  /** Durable outcome conflict: multiple records, material divergence, malformed/corrupt existing state. */
  'OUTCOME-CONFLICT',
  /** Identity/time source failure in the no-existing branch. */
  'OUTCOME-IDENTITY-FAILURE',
  /** S2 permit/publication failure (WP-8 rejection). */
  'OUTCOME-WRITE-FAILED',
  /** Unexpected internal exception. */
  'OUTCOME-INTERNAL-FAILURE',
] as const;
export type OutcomeProductionFailureCategory = (typeof OUTCOME_PRODUCTION_FAILURE_CATEGORIES)[number];

/**
 * Typed fail-closed result of one outcome-production decision. `published` =
 * the no-existing branch wrote exactly one new record; `replayed` = an
 * existing exact durable record was returned with zero allocations/writes.
 */
export type OutcomeProductionResult =
  | {
      readonly ok: true;
      readonly outcome: 'published' | 'replayed';
      readonly recordId: string;
      readonly recordDigest: string;
      /** The durable observation evidence identity (`pgw:e:`; minted only in the no-existing branch). */
      readonly evidenceId: string;
      readonly auditEventId?: string;
    }
  | { readonly ok: false; readonly category: OutcomeProductionFailureCategory; readonly code: string; readonly message: string };

/** One complete trusted outcome-production input (host-assembled). */
export interface OutcomeProductionInput {
  /** The exact durable ExecutionAttemptRecord payload (caller-verified; re-read under the lock). */
  readonly attempt: Readonly<Record<string, unknown>>;
  /** The verified terminal ExecutionAttemptOutcome (exact attempt correlation). */
  readonly outcome: ExecutionAttemptOutcome;
  /** The genuine branded PiExecutionObservation (exact attempt correlation). */
  readonly observation: PiExecutionObservation;
  /** Optional exactly correlated WP-5B enforcement evidence (retrospective-only; grants no authority). */
  readonly enforcement?: PiEnforcementEvidence;
  /** Optional complete validated-result handoff (result association exists iff present). */
  readonly handoff?: ValidatedResultHandoff;
  /** Required iff handoff present: the exact durable passing ValidationRecord payload. */
  readonly validation?: Readonly<Record<string, unknown>>;
  /** Current registry context (host-supplied; the record's registry binding). */
  readonly registry: AcceptedRegistryContext;
  /** The S2 outcome store boundary (outcome candidates + the ONLY outcome write path). */
  readonly store: OutcomeStoreBoundary;
  /** The WP-12 control-plane store boundary (under-lock durable attempt re-read). */
  readonly records: ControlPlaneStoreBoundary;
  /** Host-side attempt-level decision coordinator (FSCR-W12-001 pattern; Model-1). */
  readonly coordinate: DecisionCoordinator;
  /** Host-owned opaque identity/time sources. */
  readonly identity: OutcomeIdentitySource;
  /** Offline schema registry for the committed lifecycle schema gate (host-built). */
  readonly schemaRegistry: unknown;
  /** Genuine outcome-recorder capability (minted ONLY by the trusted host composition; S2). */
  readonly capability: unknown;
  /**
   * Test/host seam (WP-12 race-coverage pattern): runs inside the attempt
   * lock after the under-lock re-read proves zero existing outcome records,
   * immediately before the no-existing allocation/write. A throwing hook is
   * a typed internal failure.
   */
  readonly hooks?: { readonly beforeFirstOutcomePublication?: () => void };
}

/** Outcome-production input without the host-composed S2 members. */
export type OutcomeAuthorityInput = Omit<OutcomeProductionInput, 'store' | 'capability' | 'schemaRegistry'>;

/**
 * Trusted publication-composition input: the WP-13C publication input minus
 * the host-composed members (`store` boundary, `capability`, `schemaRegistry`)
 * and the branded outcome-precondition context — the S3 host composition
 * injects all of them from its genuine trusted context.
 */
export type PublicationAuthorityInput = Omit<PublicationInput, 'store' | 'capability' | 'schemaRegistry' | 'outcome'>;
