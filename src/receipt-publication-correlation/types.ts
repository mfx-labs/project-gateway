/**
 * WP-15 Phase 2 — receipt/publication correlation production type vocabulary.
 *
 * The `receipt-publication-correlation-producer` authority domain (WP-15
 * Approved Decision 1.B) turns ONE narrow correlation request (workspace +
 * exact predecessor publication identity + exact TrustedReceipt identity —
 * nothing else) into AT MOST ONE immutable successor `ResultPublicationRecord`
 * plus AT MOST ONE exact `SupersessionRecord`, through the exact two-class
 * store boundary, under the publication-correlation coordination lock, with
 * mandatory fresh durable-state reconstruction, under-lock re-read,
 * claimant-first currentness/supersession resolution, and material
 * replay/conflict semantics. The successor and supersession are constructed
 * INTERNALLY from freshly verified trusted state: no caller-supplied
 * successor bytes, supersession bytes, scopes, receipt correlations, result/
 * outcome/occurrence/attempt facts, registry reference, responsible role,
 * provenance, publication digest, predecessor currentness, successor
 * identity, or supersession identity is ever accepted as authority (§6/§15).
 *
 * The authority performs NO TrustedReceipt issuance, NO ExecutionResult
 * mutation, NO validation/evaluator provenance change, NO mutation of the
 * historical predecessor, and NO generic lifecycle-write authority. Schema
 * role attribution stays committed and distinct from the capability
 * identity (A1 §8/§10): the successor `ResultPublicationRecord` retains its
 * committed `trusted-result-publisher` role; the `SupersessionRecord`
 * retains its committed `trusted-lifecycle-authority` role; the new
 * capability is `receipt-publication-correlation-producer`.
 *
 * Committed contract: WP-15 contract §10–§13 (Approved Decision 1.B, A1),
 * Phase 1A event/source semantics (`src/lifecycle/graph.ts`,
 * `src/lifecycle/retrospective-eligibility.ts`), the committed S4 shared
 * retrospective derivation (`src/retrospective-derivation`), the WP-8
 * `publishRecord` contract, the WP-12 host-side coordination-lock pattern,
 * and the WP-13C/S2/Phase-1B authority-family conventions (CAP-008…016).
 */
import type { AcceptedRegistryContext } from '../api/types.js';
import type { DecisionCoordinator, LifecycleEnumerateResult, LifecycleReadResult } from '../control-plane/types.js';
import type { LockTimeSource, PublishRecordResult, RecordClassId } from '../storage/types.js';

/** The exact TWO publishable record classes of the correlation authority (§2). */
export const CORRELATION_PUBLICATION_RECORD_CLASS = 'result-publication-record' as const;
export const CORRELATION_SUPERSESSION_RECORD_CLASS = 'supersession-record' as const;

/**
 * The exact schema-const responsible roles of the TWO produced record
 * classes (A1 §8/§10; §26). These are SCHEMA attribution constants — they
 * are NOT the capability identity (`receipt-publication-correlation-producer`)
 * and are NEVER changed to name this producer.
 */
export const CORRELATION_PUBLICATION_ROLE = 'trusted-result-publisher' as const;
export const CORRELATION_SUPERSESSION_ROLE = 'trusted-lifecycle-authority' as const;

/** The new distinct capability identity (module-private brand; §1/§26). */
export const CORRELATION_PRODUCER_CAPABILITY_IDENTITY = 'receipt-publication-correlation-producer' as const;

/**
 * The closed read-only class set of the correlation authority (§3/§29).
 * Exactly the contract's Phase 2 read allowlist; approval-record,
 * issuance-record, runtime-grant, execution-summary-record,
 * migration-record, and authoritative-audit-event are EXPLICITLY excluded —
 * the correlation producer verifies the receipt's durable correlation and
 * predecessor currentness without RuntimeGrant (the TrustedReceipt already
 * carries trusted event attestation; §29). All are read-only (never
 * published); the ONLY publishable classes are the two above.
 */
export const CORRELATION_READ_CLASSES: ReadonlySet<string> = new Set([
  'trusted-receipt',
  'result-publication-record',
  'supersession-record',
  'validation-record',
  'execution-outcome-record',
  'execution-attempt-record',
  'execution-occurrence-record',
  'activation-record',
  'revocation-record',
]);

// ─── closed correlation failure taxonomy (§30) ──────────────────────────────

export const CORRELATION_FAILURE_CATEGORIES = [
  /** Invalid request: unknown keys, malformed identifiers, workspace mismatch (never a lifecycle-state finding). */
  'CORRELATION-INPUT-INVALID',
  /** Capability/permit denial: not genuine, disposed, stale generation, foreign domain, sink-level rejection. */
  'CORRELATION-CAPABILITY-DENIED',
  /** Publication-correlation coordination lock contention surfaced by the committed coordinator. */
  'CORRELATION-LOCK-CONFLICT',
  /** Durable state unverifiable: read/enumerate failure, unreadable/corrupt entries inside a read class. */
  'CORRELATION-STATE-UNVERIFIABLE',
  /** The nominated TrustedReceipt is missing, schema-invalid, wrong event type, wrong disposition, or otherwise not a valid correlation receipt. */
  'CORRELATION-RECEIPT-REJECTED',
  /** The nominated predecessor ResultPublicationRecord is missing, schema-invalid, wrong role, revoked, or otherwise not a valid Phase-2 predecessor. */
  'CORRELATION-PREDECESSOR-REJECTED',
  /** Exact receipt↔publication binding failure: different workspace/occurrence/attempt/event source, outcome/association/validation provenance divergence. */
  'CORRELATION-MISMATCH',
  /** The committed shared retrospective path rejected the durable state (other than the expected two-publication successor state). */
  'CORRELATION-RETROSPECTIVE-INVALID',
  /** The predecessor is not current: an existing SupersessionRecord claims it with a divergent successor. */
  'CORRELATION-PREDECESSOR-NOT-CURRENT',
  /** Supersession conflict: multiple claimants, divergent durable supersession, schema-invalid claimant. */
  'CORRELATION-SUPERSESSION-CONFLICT',
  /** Successor conflict: a divergent durable publication claims the exact successor subject; multiple claimants. */
  'CORRELATION-SUCCESSOR-CONFLICT',
  /** Host registry/currentness context malformed (registry genuineness failed). */
  'CORRELATION-REGISTRY-INVALID',
  /** The two-class store boundary rejected the successor write. */
  'CORRELATION-SUCCESSOR-WRITE-FAILED',
  /** The two-class store boundary rejected the supersession write. */
  'CORRELATION-SUPERSESSION-WRITE-FAILED',
  /** Unexpected internal exception. */
  'CORRELATION-INTERNAL-FAILURE',
] as const;
export type CorrelationFailureCategory = (typeof CORRELATION_FAILURE_CATEGORIES)[number];

/**
 * Typed fail-closed result of one correlation decision (§30/§32).
 *
 * `outcome`:
 * - `correlated` — both the successor and the supersession were newly
 *   published (each carries its own actual D-6 audit identity);
 * - `recovered` — the exact durable successor already existed (zero new
 *   successor IDs/writes) and only the missing SupersessionRecord was newly
 *   published (§22 State B);
 * - `replayed` — the exact successor AND the exact supersession already
 *   existed durably: idempotent replay with ZERO new IDs/writes/audits
 *   (§22 State E).
 *
 * Audit identities are present ONLY for writes that actually occurred
 * (§31): a recovered/replayed successor never claims a successor audit; a
 * replayed supersession never claims a supersession audit. No partial
 * success: if the successor write succeeded but the supersession write
 * failed, the result is a typed incomplete/retryable failure
 * (CORRELATION-SUPERSESSION-WRITE-FAILED) and the durable successor
 * remains for exact recovery on retry (§30).
 */
export type CorrelationResult =
  | {
      readonly ok: true;
      readonly outcome: 'correlated' | 'recovered' | 'replayed';
      /** The exact predecessor publication identity (immutable, unchanged). */
      readonly predecessorRecordId: string;
      /** The exact durable successor publication identity. */
      readonly successorRecordId: string;
      /** The exact durable SupersessionRecord identity. */
      readonly supersessionRecordId: string;
      /** The nominated TrustedReceipt identity (the exact unlocking correlation). */
      readonly receiptRecordId: string;
      readonly successorRecordDigest: string;
      readonly supersessionRecordDigest: string;
      /** D-6 authorized-write audit identity; present ONLY when the successor was newly written. */
      readonly successorAuditEventId?: string;
      /** D-6 authorized-write audit identity; present ONLY when the supersession was newly written. */
      readonly supersessionAuditEventId?: string;
    }
  | { readonly ok: false; readonly category: CorrelationFailureCategory; readonly code: string; readonly message: string };

// ─── the narrow correlation request (§6) ────────────────────────────────────

/**
 * The ONLY caller-supplied material. Nominates exactly the intended
 * correlation subject: the workspace, the exact predecessor publication,
 * and the exact TrustedReceipt. The caller can NEVER supply a successor
 * payload, supersession payload, target scopes, receipt_correlations,
 * result/outcome/occurrence/attempt facts, registry reference,
 * responsible_role, provenance, publication digest, predecessor
 * currentness, successor identity, or supersession identity — every
 * trusted transition fact is derived internally from fresh durable state.
 */
export interface CorrelationRequest {
  /** The exact workspace binding (`pgw:w:`); must equal the predecessor and receipt workspace. */
  readonly workspaceId: string;
  /** The exact immutable predecessor `ResultPublicationRecord` identity (`pgw:l:`). */
  readonly predecessorPublicationRecordId: string;
  /** The exact durable `TrustedReceipt` identity (`pgw:l:`) to verify and bind. */
  readonly trustedReceiptRecordId: string;
}

/** Host-owned correlation identity sources (D-3 pattern; Phase 1B family). */
export interface CorrelationIdentitySource {
  /** Trusted UTC timestamp in the accepted `YYYY-MM-DDTHH:MM:SS.sssZ` form. */
  readonly nowUtcIso: () => string;
  /** Fresh opaque lifecycle record identity (`pgw:l:<32 lowercase hex>`); non-reusable. */
  readonly newRecordId: () => string;
}

/**
 * The narrow two-class store boundary (§25). The publish surface is EXACTLY
 * two permit-gated methods (successor `ResultPublicationRecord` and
 * `SupersessionRecord`) and the read surface is the closed §3 allowlist.
 * The underlying unrestricted WP-8 publisher is never exposed; attempting
 * to publish any other class (including TrustedReceipt) fails at the sink.
 */
export interface CorrelationStoreBoundary {
  /** Publish exactly one successor `ResultPublicationRecord` (permit-gated; class-confined). */
  readonly publishSuccessorPublication: (permit: unknown, payload: Readonly<Record<string, unknown>>) => CorrelationPublicationResult;
  /** Publish exactly one `SupersessionRecord` (permit-gated; class-confined). */
  readonly publishSupersession: (permit: unknown, payload: Readonly<Record<string, unknown>>) => CorrelationPublicationResult;
  /** Read-only payload reads for the under-lock re-read (closed §3 class set). */
  readonly readLifecyclePayload: (recordClass: RecordClassId, recordId: string) => LifecycleReadResult;
  /** Read-only class enumeration for the under-lock re-read (closed §3 class set). */
  readonly enumerateLifecycleRecords: (recordClass: RecordClassId) => LifecycleEnumerateResult;
}

/**
 * The two-class publication result of the store boundary. `published` =
 * WP-8 wrote a new durable record; `idempotent-duplicate`/`duplicate` =
 * WP-8 found an existing record for the same identity (the authority
 * re-reads and compares material exactness under the held lock);
 * `conflict-revision` = a conflicting durable record exists for the
 * identity.
 */
export type CorrelationPublicationResult =
  | { readonly ok: true; readonly outcome: 'published' | 'idempotent-duplicate' | 'duplicate' | 'conflict-revision'; readonly recordId: string; readonly recordDigest: string; readonly auditEventId?: string }
  | { readonly ok: false; readonly category: CorrelationFailureCategory; readonly code: string; readonly message: string };

/**
 * The complete trusted correlation input (host-assembled decision core
 * context; SIR-WP15-P1B-002 pattern). The trusted members (registry, store,
 * coordinate, identity, schemaRegistry, capability, hooks) are supplied
 * ONLY by the trusted host composition, never by the correlation caller.
 * The public authority surface is
 * `CorrelationAuthority.correlate(request: CorrelationRequest)`.
 */
export interface CorrelationInput {
  /** The narrow caller request (closed keys; nothing authoritative). */
  readonly request: CorrelationRequest;
  /** Current registry context (host-supplied at correlation time; §28). */
  readonly registry: AcceptedRegistryContext;
  /** Narrow two-class store boundary (host-injected). */
  readonly store: CorrelationStoreBoundary;
  /** Host-side publication-correlation decision coordinator (FSCR-W12-001 pattern). */
  readonly coordinate: DecisionCoordinator;
  /** Host-owned correlation identity sources. */
  readonly identity: CorrelationIdentitySource;
  /** Offline schema registry for the record schema gate (host-built). */
  readonly schemaRegistry: unknown;
  /** Genuine receipt-publication-correlation capability (module-private brand; minted ONLY by the trusted host composition). */
  readonly capability: unknown;
  /**
   * Test/host seam (Phase 1B race-coverage pattern): runs inside the
   * publication-correlation lock after the under-lock re-verification.
   * `beforeFirstSuccessorPublication` runs before successor resolution
   * (divergent-successor race coverage); `beforeFirstSupersessionPublication`
   * runs after a fresh successor is durable and immediately before the
   * supersession publication (crash-after-successor coverage). A throwing
   * hook is a typed internal failure. NOT a caller operand: the host
   * composition closes over it.
   */
  readonly hooks?: { readonly beforeFirstSuccessorPublication?: () => void; readonly beforeFirstSupersessionPublication?: () => void };
}

/** Kept for source-level symmetry with the Phase 1B receipt result shape. */
export type { PublishRecordResult, LockTimeSource };
