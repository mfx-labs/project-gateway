/**
 * WP-13C — trusted result publication type vocabulary.
 *
 * The trusted publication authority (ADR-038) turns one exact WP-13B
 * `ValidatedResultHandoff` into at most one durable `ResultPublicationRecord`
 * through the existing WP-8 `publishRecord` path, under the attempt-level
 * host-side coordination lock, with mandatory under-lock re-read and
 * material-exactness replay/conflict semantics (SCR-WP13-003/005/006). It
 * performs NO receipt production, NO completion-status/downstream-automation/
 * authoritative-reporting scoping (WP-15-owned), NO lifecycle authority
 * beyond the single `ResultPublicationRecord` class, NO retrospective-facts
 * production (WP-13D), and NO pi-guard interaction.
 *
 * Committed contract:
 * docs/reports/wp-13-pre-implementation-contract-decision.md §3.3–§3.7,
 * ADR-038, ADR-012, the committed `result-publication-record` lifecycle
 * schema, the WP-8 `publishRecord` contract, and the WP-12 host-side
 * coordination-lock pattern (FSCR-W12-001).
 */
import type { AcceptedRegistryContext } from '../api/types.js';
import type { ValidatedResultHandoff } from '../completion/types.js';
import type { DecisionCoordinator } from '../control-plane/types.js';
import type { LifecycleEnumerateResult, LifecycleReadResult } from '../control-plane/types.js';
import type { LockTimeSource, PublishRecordResult, RecordClassId } from '../storage/types.js';
import type { OutcomeStoreBoundary } from '../outcome/types.js';

/** WP-13 publication scope: ordinary-review ONLY (closed vocabulary; §3.6). */
export const RESULT_PUBLICATION_SCOPE = 'ordinary-review' as const;
export type ResultPublicationScope = typeof RESULT_PUBLICATION_SCOPE;

/** The single publishable record class of the authority (ADR-038 decision 2). */
export const RESULT_PUBLICATION_RECORD_CLASS = 'result-publication-record' as const;

// ─── closed publication failure taxonomy ────────────────────────────────────

export const PUBLICATION_FAILURE_CATEGORIES = [
  'PUBLICATION-INPUT-INVALID',
  'PUBLICATION-CAPABILITY-DENIED',
  'PUBLICATION-LOCK-CONFLICT',
  'PUBLICATION-STATE-UNVERIFIABLE',
  'PUBLICATION-LIFECYCLE-REJECTED',
  // WP-13 durability S3: the mandatory outcome-record precondition failed
  // (missing/multiple/invalid outcome record, missing result association,
  // or an exact-match divergence from the publication request/handoff).
  'PUBLICATION-OUTCOME-REJECTED',
  'PUBLICATION-CONFLICT',
  'PUBLICATION-WRITE-FAILED',
  'PUBLICATION-INTERNAL-FAILURE',
] as const;
export type PublicationFailureCategory = (typeof PUBLICATION_FAILURE_CATEGORIES)[number];

export type PublicationResult =
  | { readonly ok: true; readonly outcome: 'published' | 'idempotent-replay'; readonly recordId: string; readonly recordDigest: string }
  | { readonly ok: false; readonly category: PublicationFailureCategory; readonly code: string; readonly message: string };

// ─── host-injected trusted context (never request-supplied) ─────────────────

/** Host-owned publication identity sources (D-3 pattern; WP-12 identity pattern). */
export interface PublicationIdentitySource {
  /** Trusted UTC timestamp in the accepted `YYYY-MM-DDTHH:MM:SS.sssZ` form. */
  readonly nowUtcIso: () => string;
  /** Fresh opaque record identity (`pgw:l:<32 lowercase hex>`); non-reusable. */
  readonly newRecordId: () => string;
}

/** The narrow WP-8 publication boundary (single-class confinement; §8). */
export interface PublicationStoreBoundary {
  /** Publish exactly one `ResultPublicationRecord` (permit-gated; the ONLY publish path). */
  readonly publishResultPublicationRecord: (permit: unknown, payload: Readonly<Record<string, unknown>>) => PublishRecordResult;
  /** Read-only payload reads for the under-lock re-read (closed class set). */
  readonly readLifecyclePayload: (recordClass: RecordClassId, recordId: string) => LifecycleReadResult;
  /** Read-only class enumeration for the under-lock re-read (closed class set). */
  readonly enumerateLifecycleRecords: (recordClass: RecordClassId) => LifecycleEnumerateResult;
}

/**
 * S3 outcome-record precondition context (ADR-039 §11; durability decision
 * §11; SIR-WP13-DUR-S3-001): a branded, module-private context wrapping the
 * genuine S2 outcome store boundary. It is constructed ONLY by the trusted
 * S3 host composition (`createPublicationOutcomePrecondition`, static-guard
 * confined) and verified by `publishValidatedResult` before use — an
 * arbitrary caller cannot fabricate the outcome view WP-13C reads.
 *
 * The TypeScript property is kept optional solely for source compatibility
 * with legacy callers; RUNTIME omission deterministically fails closed as
 * `PUBLICATION-OUTCOME-REJECTED` `outcome.context-missing` with zero
 * publication write.
 */
export interface PublicationOutcomePrecondition {
  /** The genuine S2 outcome store boundary (reads confined to execution-outcome-record). */
  readonly store: OutcomeStoreBoundary;
}

/** The trusted publication request material (host-composed; §2). */
export interface PublicationInput {
  /** The exact WP-13B validated-result handoff (never reconstructed). */
  readonly handoff: ValidatedResultHandoff;
  /**
   * The exact evaluator provenance bound into the record (committed
   * schema-valid opaque forms `pgw:ev:<32 hex>` / `pgw:cp:<32 hex>`),
   * supplied by the trusted composition; MUST exactly equal the handoff's
   * `evaluatorId`/`capabilityProfileId` (re-correlation; never mapped).
   */
  readonly evaluatorProvenance: { readonly evaluator_id: string; readonly capability_profile_id: string };
  /** Current registry context (host-supplied at publication time; §3.7). */
  readonly registry: AcceptedRegistryContext;
  /** Narrow single-class WP-8 publication boundary (host-injected). */
  readonly store: PublicationStoreBoundary;
  /** Host-side attempt-level decision coordinator (FSCR-W12-001 pattern). */
  readonly coordinate: DecisionCoordinator;
  /** Host-owned publication identity sources. */
  readonly identity: PublicationIdentitySource;
  /** Offline schema registry for the record schema gate (host-built). */
  readonly schemaRegistry: unknown;
  /** Genuine result-publication capability (module-private brand; CAP-008…016). */
  readonly capability: unknown;
  /**
   * WP-13 durability S3 outcome precondition (see PublicationOutcomePrecondition).
   * Absent only on the superseded pre-durability closure path; the trusted S3
   * host composition always supplies it.
   */
  readonly outcome?: PublicationOutcomePrecondition;
  /**
   * Test/host seam (WP-12 race-coverage pattern): runs inside the
   * attempt-level lock after the under-lock re-read, immediately before the
   * first-publication decision. A throwing hook is a typed internal failure.
   */
  readonly hooks?: { readonly beforeFirstPublication?: () => void };
}
