/**
 * WP-15 Phase 1B — trusted receipt production type vocabulary.
 *
 * The `trusted-receipt-producer` authority domain (WP-15 Phase 1B) turns ONE
 * narrow receipt issuance request (workspace + event type + exact event
 * record identity — nothing else) into AT MOST ONE durable `TrustedReceipt`
 * through the exact single-class store boundary, under the event-subject
 * coordination lock, with mandatory fresh durable-state reconstruction,
 * under-lock re-read, claimant enumeration, and material
 * replay/conflict semantics. The receipt is constructed INTERNALLY from
 * freshly verified trusted state: no caller-supplied receipt, retrospective
 * fact, outcome, result fact, registry truth, grant/revocation status, or
 * provenance is ever accepted as authority (§4).
 *
 * The authority performs NO result-publication correlation transition, NO
 * successor `ResultPublicationRecord`, NO `SupersessionRecord` production,
 * NO privileged-scope enabling, NO execution/activation/grant mutation, and
 * NO pi-guard interaction. A valid `result-publication-correlation`
 * TrustedReceipt may exist while the publication remains ordinary-review
 * (contract-approved; the separate correlation transition is Phase 2).
 *
 * Committed contract: WP-15 Phase 1A (A1) event/disposition semantics
 * (`src/lifecycle/retrospective-eligibility.ts`,
 * `src/lifecycle/graph.ts`), the committed `trusted-receipt` lifecycle
 * schema, the WP-8 `publishRecord` contract, the WP-12 host-side
 * coordination-lock pattern, and the WP-13C/S2/S3 authority-family
 * conventions (CAP-008…016).
 */
import type { AcceptedRegistryContext } from '../api/types.js';
import type { DecisionCoordinator, LifecycleEnumerateResult, LifecycleReadResult } from '../control-plane/types.js';
import type { LockTimeSource, PublishRecordResult, RecordClassId } from '../storage/types.js';

/** The single publishable record class of the receipt authority (§15). */
export const TRUSTED_RECEIPT_RECORD_CLASS = 'trusted-receipt' as const;

/** The exact receipt role (schema const; the authority's responsible role). */
export const TRUSTED_RECEIPT_PRODUCER_ROLE = 'trusted-receipt-producer' as const;

/**
 * The closed read-only class set of the receipt authority (§3). Exactly the
 * contract's expected read set; no approval/issuance/supersession/migration/
 * summary/generic-audit classes. All are read-only (never published); the
 * ONLY publishable class is `trusted-receipt`.
 */
export const RECEIPT_READ_CLASSES: ReadonlySet<string> = new Set([
  'trusted-receipt',
  'execution-attempt-record',
  'execution-occurrence-record',
  'execution-outcome-record',
  'activation-record',
  'runtime-grant',
  'revocation-record',
  'validation-record',
  'result-publication-record',
]);

// ─── closed receipt failure taxonomy (§18) ──────────────────────────────────

export const RECEIPT_FAILURE_CATEGORIES = [
  /** Invalid request: unknown keys, malformed/unknown event type, workspace/identity mismatch (never a lifecycle-state finding). */
  'RECEIPT-INPUT-INVALID',
  /** Capability/permit denial: not genuine, disposed, stale generation, foreign domain, sink-level rejection. */
  'RECEIPT-CAPABILITY-DENIED',
  /** Event-subject coordination lock contention surfaced by the committed coordinator. */
  'RECEIPT-LOCK-CONFLICT',
  /** Durable state unverifiable: read/enumerate failure, unreadable/corrupt entries inside a read class. */
  'RECEIPT-STATE-UNVERIFIABLE',
  /** Issuance preconditions failed: source missing/mismatched, receipt-ineligible/terminal-unverifiable, registry invalid, revoked/authority-invalid. */
  'RECEIPT-LIFECYCLE-REJECTED',
  /** Durable conflict: multiple claimants, material divergence, conflicting/malformed outcome or publication-context state. */
  'RECEIPT-CONFLICT',
  /** The single-class store boundary rejected the durable write. */
  'RECEIPT-WRITE-FAILED',
  /** Unexpected internal exception. */
  'RECEIPT-INTERNAL-FAILURE',
] as const;
export type ReceiptFailureCategory = (typeof RECEIPT_FAILURE_CATEGORIES)[number];

/**
 * Typed fail-closed result of one receipt issuance decision. `issued` = the
 * no-claimant branch wrote exactly one new durable receipt; `replayed` = an
 * existing materially-identical durable receipt was returned with zero
 * allocations/writes (no audit event). `auditEventId` is present ONLY on
 * `issued` (the D-6 authorized-write audit fires at the WP-8 durability
 * point of a real write; replay/conflict/denial never emit it).
 */
export type ReceiptResult =
  | { readonly ok: true; readonly outcome: 'issued' | 'replayed'; readonly recordId: string; readonly recordDigest: string; readonly auditEventId?: string }
  | { readonly ok: false; readonly category: ReceiptFailureCategory; readonly code: string; readonly message: string };

// ─── the narrow issuance request (§4) ───────────────────────────────────────

/**
 * The ONLY caller-supplied material. Nominates the exact intended receipt
 * event subject and nothing authoritative: the caller can never supply a
 * TrustedReceipt, retrospective facts, outcome bytes, result facts, registry
 * truth, grant/revocation status, receipt provenance, or disposition. Every
 * trusted fact is reconstructed/reverified internally from fresh durable
 * state. `expectedDisposition` is NOT accepted: the disposition is always
 * derivable from trusted source state (§10), so the API contract does not
 * require it.
 */
export interface ReceiptRequest {
  /** The exact workspace binding (`pgw:w:`); must equal the source record's workspace. */
  readonly workspaceId: string;
  /** The receipt event type (closed Phase 1A vocabulary; resolved to its exact source class internally). */
  readonly eventType: string;
  /** The exact committed source record identity (`pgw:l:`) for the intended event. */
  readonly eventRecordId: string;
}

/** Host-owned receipt identity sources (D-3 pattern; WP-12/WP-13 family). */
export interface ReceiptIdentitySource {
  /** Trusted UTC timestamp in the accepted `YYYY-MM-DDTHH:MM:SS.sssZ` form. */
  readonly nowUtcIso: () => string;
  /** Fresh opaque lifecycle record identity (`pgw:l:<32 lowercase hex>`); non-reusable. */
  readonly newRecordId: () => string;
}

/**
 * The narrow single-class store boundary (§15). The publish surface is
 * EXACTLY one method (`publishTrustedReceipt`, permit-gated) and the read
 * surface is the closed §3 allowlist. The underlying unrestricted WP-8
 * publisher is never exposed.
 */
export interface ReceiptStoreBoundary {
  /** Publish exactly one `TrustedReceipt` (permit-gated; the ONLY publish path). */
  readonly publishTrustedReceipt: (permit: unknown, payload: Readonly<Record<string, unknown>>) => ReceiptPublicationResult;
  /** Read-only payload reads for the under-lock re-read (closed §3 class set). */
  readonly readLifecyclePayload: (recordClass: RecordClassId, recordId: string) => LifecycleReadResult;
  /** Read-only class enumeration for the under-lock re-read (closed §3 class set). */
  readonly enumerateLifecycleRecords: (recordClass: RecordClassId) => LifecycleEnumerateResult;
}

/**
 * The single-class publication result of the store boundary. `published` =
 * WP-8 wrote a new durable receipt; `idempotent-duplicate`/`duplicate` =
 * WP-8 found an existing record for the same identity (the authority
 * re-reads and compares material exactness under the held lock).
 */
export type ReceiptPublicationResult =
  | { readonly ok: true; readonly outcome: 'published' | 'idempotent-duplicate' | 'duplicate' | 'conflict-revision'; readonly recordId: string; readonly recordDigest: string; readonly auditEventId?: string }
  | { readonly ok: false; readonly category: ReceiptFailureCategory; readonly code: string; readonly message: string };

/**
 * The complete trusted receipt-issuance input (host-assembled decision core
 * context; SIR-WP15-P1B-002). This is the INTERNAL core input: the trusted
 * members (registry, store, coordinate, identity, schemaRegistry,
 * capability, hooks) are supplied ONLY by the trusted host composition,
 * never by the issuance caller. The public authority surface is
 * `ReceiptProducerAuthority.issue(request: ReceiptRequest)` — the caller
 * nominates ONLY the three non-authoritative request keys.
 */
export interface ReceiptInput {
  /** The narrow caller request (closed keys; nothing authoritative). */
  readonly request: ReceiptRequest;
  /** Current registry context (host-supplied at issuance time; §16). */
  readonly registry: AcceptedRegistryContext;
  /** Narrow single-class store boundary (host-injected). */
  readonly store: ReceiptStoreBoundary;
  /** Host-side event-subject decision coordinator (FSCR-W12-001 pattern). */
  readonly coordinate: DecisionCoordinator;
  /** Host-owned receipt identity sources. */
  readonly identity: ReceiptIdentitySource;
  /** Offline schema registry for the record schema gate (host-built). */
  readonly schemaRegistry: unknown;
  /** Genuine trusted-receipt capability (module-private brand; minted ONLY by the trusted host composition). */
  readonly capability: unknown;
  /**
   * Test/host seam (WP-12 race-coverage pattern): runs inside the
   * event-subject lock after the under-lock eligibility re-verification,
   * immediately before claimant enumeration/allocation. A throwing hook is
   * a typed internal failure. NOT an issuer operand: the host composition
   * closes over it (SIR-WP15-P1B-002 §7).
   */
  readonly hooks?: { readonly beforeFirstReceiptPublication?: () => void };
}

/** Kept for source-level symmetry with the WP-13C publication result shape. */
export type { PublishRecordResult, LockTimeSource };
