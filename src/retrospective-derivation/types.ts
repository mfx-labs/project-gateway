/**
 * WP-13 durability S4 — shared retrospective derivation type vocabulary.
 *
 * ONE authoritative shared pure derivation primitive
 * (`deriveExecutionRetrospectiveFacts` — `facts.ts`) derives the fixed
 * 21-field `ExecutionRetrospectiveFacts` SEMANTIC object exclusively from
 * trusted durable state (retrospective simplification amendment;
 * `docs/reports/wp-13-closure-durability-architecture-decision.md` §12
 * durable-source mapping). WP-13 (S4) consumes it now; WP-15 later reuses
 * the SAME primitive — there is no second derivation engine.
 *
 * Proof target: repeated/cold derivation of the same valid durable
 * semantic state produces STRUCTURALLY EQUAL 21-field values (semantic
 * equality — a normal structural assertion such as `deepStrictEqual` is
 * sufficient). The fact-set is a semantic object: NO JCS/canonical-byte
 * serialization of the fact-set, NO retrospective fact-set hash identity,
 * NO byte-identity comparison. The committed JCS/NFC/hash disciplines protecting the underlying
 * durable records/evidence remain untouched (they live in their owning
 * modules, never here).
 *
 * Derivation purity boundary (contract §1): this family is read-only, free
 * of store mutation, persistence, identity allocation, timestamps/current
 * time, random values, authority decisions, receipt material, and
 * scheduler/recovery semantics. `terminal-unverifiable` attempts emit NO
 * fact-set (typed `RETROSPECTIVE-NO-FACTS`); `terminal-unpublished`
 * attempts keep their result association with publication id `null` and
 * scopes `[]`. No automatic publication recovery.
 *
 * Fixed v1 shape (contract §5.3): all 21 top-level keys are ALWAYS present
 * when a fact-set exists; unavailable scalars/references are `null`;
 * collections are `[]` when empty; no `undefined`; no alternate absence
 * sentinel; grouped-field consistency is enforced.
 */
import type { ExecutionAttemptDisposition } from '../execution/types.js';
import type { LifecycleEnumerateResult, LifecycleReadResult } from '../control-plane/types.js';
import type { RecordClassId } from '../storage/types.js';

/** The exact 21-key fixed v1 top-level vocabulary (§5.3; never extended). */
export const RETROSPECTIVE_FACTS_KEYS = [
  'workspace_id',
  'bundle',
  'occurrence_id',
  'attempt_id',
  'attempt_ordinal',
  'activation_record_id',
  'runtime_grant_id',
  'execution_attempt_record_id',
  'occurrence_record_id',
  'previous_attempt_id',
  'disposition',
  'result_instance_id',
  'result_revision_digest',
  'association_mode',
  'result_validation_record_id',
  'result_publication_record_id',
  'publication_scopes',
  'observation_references',
  'enforcement_evidence_identity',
  'enforcement_evidence_fingerprint',
  'orchestration_evidence_identity',
] as const;

/** The fixed v1 21-field fact-set (every key always present). */
export interface ExecutionRetrospectiveFacts {
  readonly workspace_id: string;
  /** Exact `ExecutionBundle` reference object (kind/instance/revision/digest). */
  readonly bundle: Readonly<Record<string, unknown>>;
  readonly occurrence_id: string;
  readonly attempt_id: string;
  readonly attempt_ordinal: number;
  readonly activation_record_id: string;
  readonly runtime_grant_id: string;
  readonly execution_attempt_record_id: string;
  readonly occurrence_record_id: string;
  readonly previous_attempt_id: string | null;
  readonly disposition: ExecutionAttemptDisposition;
  readonly result_instance_id: string | null;
  readonly result_revision_digest: string | null;
  readonly association_mode: 'originated' | 'adopted' | null;
  readonly result_validation_record_id: string | null;
  readonly result_publication_record_id: string | null;
  readonly publication_scopes: readonly string[];
  readonly observation_references: readonly Readonly<Record<string, unknown>>[];
  readonly enforcement_evidence_identity: string | null;
  readonly enforcement_evidence_fingerprint: string | null;
  readonly orchestration_evidence_identity: string;
}

// ─── closed S4 failure taxonomy ─────────────────────────────────────────────

export const RETROSPECTIVE_DERIVATION_FAILURE_CATEGORIES = [
  /**
   * `terminal-unverifiable` (EXE-012): the exact durable attempt exists but
   * no valid retrospective-complete outcome record exists. NO fact-set is
   * emitted; no disposition is guessed; no observation/result/publication
   * is fabricated; the attempt is receipt-ineligible. This is a VALID
   * lifecycle state, NOT corruption.
   */
  'RETROSPECTIVE-NO-FACTS',
  /** Ambiguous/corrupt durable state: unreadable/malformed records, duplicate occurrence, duplicate/missing previous attempt, multiple outcome records, multiple publications, partial groups. */
  'RETROSPECTIVE-STATE-CORRUPT',
  /** Exact-match divergence between durable records (validation vs outcome association; publication vs outcome association; EXE-013). */
  'RETROSPECTIVE-CORRELATION-MISMATCH',
  /** The derivation/resolver input itself is malformed (never a lifecycle-state finding). */
  'RETROSPECTIVE-INPUT-INVALID',
  /** Unexpected internal exception. */
  'RETROSPECTIVE-INTERNAL-FAILURE',
] as const;
export type RetrospectiveDerivationFailureCategory = (typeof RETROSPECTIVE_DERIVATION_FAILURE_CATEGORIES)[number];

/** Typed fail-closed result of one retrospective derivation decision. */
export type RetrospectiveDerivationResult =
  | { readonly ok: true; readonly facts: ExecutionRetrospectiveFacts }
  | { readonly ok: false; readonly category: RetrospectiveDerivationFailureCategory; readonly code: string; readonly message: string };

// ─── durable read surface (read-only; never a write boundary) ───────────────

/** The narrow read-only durable-record surface of the S4 resolver (WP-8-backed). */
export interface RetrospectiveReadBoundary {
  readonly readLifecyclePayload: (recordClass: RecordClassId, recordId: string) => LifecycleReadResult;
  readonly enumerateLifecycleRecords: (recordClass: RecordClassId) => LifecycleEnumerateResult;
}

/**
 * Resolver input: the exact durable `ExecutionAttemptRecord` identity (the
 * §12 anchor). Every other fact input is discovered from durable records by
 * exact content correlation — never by enumeration order, timestamp,
 * record id, or lexical ordering.
 */
export interface RetrospectiveDerivationInput {
  /** Read-only durable-record surface (trusted store; WP-8). */
  readonly records: RetrospectiveReadBoundary;
  /** The exact anchor `ExecutionAttemptRecord` record identity (`pgw:l:`). */
  readonly attemptRecordId: string;
}

/**
 * The validated durable semantic state consumed by the ONE shared pure
 * derivation primitive. Assembled exclusively by the S4 resolver
 * (`resolveRetrospectiveDurableState`) from trusted durable records with
 * exact correlation/cardinality established; never constructed from
 * process-local objects (`ExecutionAttemptOutcome`, live
 * `PiExecutionObservation`, `ValidatedResultHandoff`), the project-visible
 * `ExecutionResult` file, receipt material, or any in-memory cache.
 */
export interface ValidatedDurableState {
  /** The exact validated `ExecutionAttemptRecord` payload (the §12 anchor). */
  readonly attempt: Readonly<Record<string, unknown>>;
  /** The exact correlated `ExecutionOccurrenceRecord` payload (exactly one; §12 row 9). */
  readonly occurrence: Readonly<Record<string, unknown>>;
  /** `null` iff `attempt.ordinal` is 1; otherwise the exact ordinal−1 attempt id of the same occurrence/workspace/bundle (exactly one; §12 row 10). */
  readonly previousAttemptId: string | null;
  /** The exactly-one valid `ExecutionOutcomeRecord` payload (retrospective-complete; §12 rows 11/18/19/20). */
  readonly outcome: Readonly<Record<string, unknown>>;
  /** The exact passing `ValidationRecord` payload, present iff the outcome carries a result association (§12 row 15). */
  readonly validation?: Readonly<Record<string, unknown>>;
  /** The at-most-one attempt-scoped `ResultPublicationRecord` payload (§12 rows 16/17; absent = `terminal-unpublished`). */
  readonly publication?: Readonly<Record<string, unknown>>;
}
