/**
 * WP-13 durability S2 — trusted execution-outcome-recorder type vocabulary.
 *
 * The outcome-recorder authority (ADR-039) turns one already-constructed
 * exact `ExecutionOutcomeRecord` into at most one durable
 * `ExecutionOutcomeRecord` through the existing WP-8 `publishRecord` path.
 * S2 owns the capability, the exact-record publication permit, and the
 * narrow one-class store boundary ONLY. It does NOT decide WHEN an outcome
 * record should exist, construct records from execution observations,
 * allocate evidence/lifecycle identities, acquire the attempt-level lock,
 * or decide replay/conflict (S3).
 *
 * Committed contract:
 * ADR-039, docs/reports/wp-13-closure-durability-architecture-decision.md
 * §5/§8/§9, the committed `execution-outcome-record` lifecycle schema
 * (S1), and the WP-8 `publishRecord` contract.
 */
import type { LifecycleEnumerateResult, LifecycleReadResult } from '../control-plane/types.js';
import type { LockTimeSource, RecordClassId } from '../storage/types.js';

/** The single publishable record class of the outcome authority (ADR-039). */
export const EXECUTION_OUTCOME_RECORD_CLASS = 'execution-outcome-record' as const;

/** The closed outcome-recording operation identity (domain-scoped). */
export const EXECUTION_OUTCOME_OPERATION = 'execution-outcome-recording' as const;
export type ExecutionOutcomeOperation = typeof EXECUTION_OUTCOME_OPERATION;

// ─── closed outcome-publication failure taxonomy (S2 boundary scope) ────────

export const OUTCOME_PUBLICATION_FAILURE_CATEGORIES = [
  'OUTCOME-CAPABILITY-DENIED',
  'OUTCOME-INPUT-INVALID',
  'OUTCOME-WRITE-FAILED',
  'OUTCOME-INTERNAL-FAILURE',
] as const;
export type OutcomePublicationFailureCategory = (typeof OUTCOME_PUBLICATION_FAILURE_CATEGORIES)[number];

/**
 * Typed fail-closed result of one exact outcome-record publication. WP-8
 * storage-level outcomes (`published`, `idempotent-duplicate`,
 * `conflict-revision`) pass through unchanged; they are storage facts, NOT
 * S3 attempt-level decisions. S3-specific semantics (outcome conflict,
 * duplicate attempt outcome, replay mismatch, attempt lock conflict,
 * retrospective eligibility, observation correlation) are deliberately
 * absent from S2.
 */
export type OutcomePublicationResult =
  | {
      readonly ok: true;
      readonly outcome: 'published' | 'idempotent-duplicate' | 'duplicate' | 'conflict-revision';
      readonly recordId: string;
      readonly recordDigest: string;
      readonly auditEventId?: string;
    }
  | { readonly ok: false; readonly category: OutcomePublicationFailureCategory; readonly code: string; readonly message: string };

/** The narrow WP-8 outcome store boundary (single-class confinement). */
export interface OutcomeStoreBoundary {
  /**
   * Publish exactly one already-constructed `ExecutionOutcomeRecord`
   * (permit-gated; the ONLY outcome write path). The permit binds the
   * exact record identity + canonical digest; the payload must exactly
   * equal the permit-bound record and pass the committed lifecycle schema
   * gate before any WP-8 delegation.
   */
  readonly publishExactOutcomeRecord: (permit: unknown, payload: Readonly<Record<string, unknown>>) => OutcomePublicationResult;
  /** Read-only payload reads for later S3 under-lock discovery (closed class set). */
  readonly readLifecyclePayload: (recordClass: RecordClassId, recordId: string) => LifecycleReadResult;
  /** Read-only class enumeration for later S3 under-lock discovery (closed class set). */
  readonly enumerateLifecycleRecords: (recordClass: RecordClassId) => LifecycleEnumerateResult;
}
