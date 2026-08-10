/**
 * WP-13B — completion & result type vocabulary.
 *
 * The completion foundation turns one exact WP-13A attempt outcome +
 * observation + validated CompletionContract into (a) a deterministic
 * completion evaluation, (b) one originated/adopted `ExecutionResult`
 * artifact (project-visible, canonical bytes), (c) a WP-4-validated,
 * WP-12-recorded passing `ValidationRecord` identity, and (d) a bounded
 * validated-result handoff for WP-13C. It performs NO publication (ADR-038
 * stays WP-13C), NO receipt production, NO authority evaluation, NO
 * lifecycle-record production beyond the WP-12 `recordValidation` path
 * (WP-12 remains the trusted ValidationRecord producer), and NO pi-guard
 * interaction.
 *
 * Identity semantics (ADR-008; SIR-WP13B-001): the result instance and
 * revision identifiers are OPAQUE, host-supplied through the trusted
 * identity boundary (`ResultIdentitySource`), and never encode workspace,
 * lifecycle, or content semantics; no content-derived identity protocol
 * exists in this family. Evidence references use only committed identity
 * material (the WP-5B enforcement-evidence fingerprint) plus opaque
 * `pgw:e:` evidence ids from the same trusted boundary.
 *
 * Committed contract:
 * docs/reports/wp-13-pre-implementation-contract-decision.md §3.1/§3.2/§3.4
 * (SCR-WP13-002 validation path; SCR-WP13-003 result-write semantics) and
 * the committed `execution-result`/`execution-result-body` schemas.
 */
import type { PiExecutionObservation } from '../adapters/pi/types.js';
import type { ExecutionAttemptOutcome } from '../execution/types.js';
import type { ValidationReport, ValidatedArtifact } from '../api/types.js';
import type { SchemaRegistry } from '../schema/registry.js';

// ─── closed completion failure taxonomy ─────────────────────────────────────

/** Closed WP-13B failure categories (no additions without contract change). */
export const COMPLETION_FAILURE_CATEGORIES = [
  'COMPLETION-INPUT-INVALID',
  'COMPLETION-INTERNAL-FAILURE',
  'RESULT-VALIDATION-REJECTED',
  'RESULT-CANDIDATE-INVALID',
  'RESULT-WRITE-CONFLICT',
  'RESULT-CONTAINMENT-DENIED',
  'RESULT-WRITE-FAILED',
  'VALIDATION-RECORDING-FAILED',
] as const;
export type CompletionFailureCategory = (typeof COMPLETION_FAILURE_CATEGORIES)[number];

/** Bounded no-result reasons (EXE-008: an attempt may have no evaluator-produced result). */
export const NO_RESULT_REASONS = [
  'disposition-rejected',
  'disposition-ambiguous',
  'disposition-non-completed',
  'evidence-unavailable',
  'contract-unavailable',
] as const;
export type NoResultReason = (typeof NO_RESULT_REASONS)[number];

// ─── completion input (host-assembled; untrusted operands) ─────────────────

/** Exact attempt/orchestration facts (WP-12-derived; correlation operands only). */
export interface CompletionAttemptFacts {
  readonly occurrenceId: string;
  readonly attemptId: string;
  readonly ordinal: number;
  readonly attemptRecordId: string;
  readonly occurrenceRecordId: string;
  readonly activationRecordId: string;
  readonly runtimeGrantId: string;
}

/** The committed enforcement-evidence reference for the attempt (WP-5B). */
export interface CompletionEnforcementEvidenceReference {
  /** The exact PiEnforcementEvidence.evidenceFingerprint (committed sha-256 form). */
  readonly evidenceFingerprint: string;
}

/** One complete WP-13B completion input (host-assembled). */
export interface CompletionInput {
  readonly workspaceId: string;
  readonly attempt: CompletionAttemptFacts;
  /** The exact WP-13A attempt outcome (in-session, validated shape). */
  readonly outcome: ExecutionAttemptOutcome;
  /** The exact WP-5A execution observation (absent = evaluation evidence unavailable). */
  readonly observation?: PiExecutionObservation;
  /** The validated CompletionContract artifact (host-resolved from the bundle). */
  readonly completionContract?: ValidatedArtifact;
  /** The occurrence enforcement evidence fingerprint (required; contract §3.1). */
  readonly enforcementEvidence: CompletionEnforcementEvidenceReference;
  /** Adoption: exact candidate bytes (project-visible; must equal the canonical result). */
  readonly adoptCandidateBytes?: Uint8Array;
  /** WP-6 verified workspace root for the deterministic result destination. */
  readonly resultRoot: string;
  /** Host-injected trusted opaque identity source (D-3 pattern; ADR-008). */
  readonly identitySource: ResultIdentitySource;
  /** Service uid ownership expectation for the result destination (WP-6). */
  readonly serviceUid: number;
  /** Offline schema registry for the WP-4 validation run (host-built). */
  readonly schemaRegistry: SchemaRegistry;
  /** The WP-12 recordValidation boundary (host-injected; WP-12 stays the producer). */
  readonly controlPlane: ValidationRecordingBoundary;
}

/** Bounded result of one completion flow run. */
export type CompletionResult =
  | { readonly ok: true; readonly decision: 'produced'; readonly handoff: ValidatedResultHandoff }
  | { readonly ok: true; readonly decision: 'no-result'; readonly reason: NoResultReason }
  | { readonly ok: false; readonly category: CompletionFailureCategory; readonly code: string; readonly message: string };

// ─── evaluator-produced result identity ─────────────────────────────────────

/** Opaque result identities (committed id syntax; ADR-008, SIR-WP13B-001). */
export interface ExecutionResultIdentities {
  readonly instanceId: string;
  readonly revisionId: string;
  /** The committed artifact digest (sha-256 over the canonical projection). */
  readonly digest: string;
  /** Exact canonical bytes of the full result artifact (JCS; the file content). */
  readonly canonicalUtf8: string;
  /** The result body (immutable, digest-covered). */
  readonly body: Readonly<Record<string, unknown>>;
}

// ─── bounded validated-result handoff (WP-13C input) ────────────────────────

/** Exact evidence references bound into the result body (committed vocabulary). */
export interface ResultEvidenceReference {
  readonly kind: 'external-evidence';
  readonly evidence_id: string;
  readonly content_digest: string;
  readonly declared_media_type: string;
  readonly observation_role: 'evaluation-evidence';
}

/** The bounded validated-result handoff for WP-13C (identities/digests only). */
export interface ValidatedResultHandoff {
  readonly workspaceId: string;
  readonly occurrenceId: string;
  readonly attemptId: string;
  readonly ordinal: number;
  readonly bundleReference: Readonly<Record<string, unknown>>;
  readonly disposition: 'completed';
  readonly associationMode: 'originated' | 'adopted';
  readonly resultInstanceId: string;
  readonly resultRevisionId: string;
  readonly resultDigest: string;
  /** Deterministic destination relative to the verified result root (binding is by digest, never by path). */
  readonly artifactRelativePath: string;
  /** The durable passing ValidationRecord id (WP-12 `recordValidation`; role trusted-validator). */
  readonly validationRecordId: string;
  readonly evaluatorId: string;
  readonly capabilityProfileId: string;
  readonly evidenceReferences: readonly ResultEvidenceReference[];
  /** Write outcome: created or exact-existing recovery reuse. */
  readonly writeOutcome: 'created' | 'already-exact';
}

// ─── WP-12 recordValidation boundary (host-injected; WP-12 stays the producer) ─

/** Canonical subject shape for the recordValidation request. */
export interface ResultValidationSubject {
  readonly protocolId: string;
  readonly protocolVersion: string;
  readonly kindId: string;
  readonly kindVersion: string;
  readonly instanceId: string;
  readonly revisionId: string;
  readonly digest: string;
  readonly workspaceId: string;
}

export type ValidationRecordingResult =
  | { readonly ok: true; readonly validationRecordId: string }
  | { readonly ok: false; readonly category: string; readonly code: string; readonly message: string };

/**
 * The ONLY WP-12 surface WP-13B touches for recording: `recordValidation`
 * with host-injected accepted WP-4 evidence (WP-12 remains the trusted
 * ValidationRecord producer; the eight-class store allowlist is unchanged).
 * An exact existing record for the same subject is recognized idempotently.
 */
export interface ValidationRecordingBoundary {
  readonly recordValidation: (input: {
    readonly workspaceId: string;
    readonly subject: ResultValidationSubject;
    readonly evidence: { readonly report: Readonly<Record<string, unknown>>; readonly artifact: ValidatedArtifact };
  }) => ValidationRecordingResult;
}

/**
 * Host-injected trusted opaque identity boundary (D-3 pattern — the same
 * host-composition pattern as the committed WP-12 identity sources; no new
 * registrar, no new identity protocol). Every value is a fresh opaque
 * identifier in the committed syntax with 128 random bits; none encodes
 * workspace/lifecycle/content semantics. Malformed or throwing returns are
 * contained by the caller (safeCall → exact shape validation → use).
 */
export interface ResultIdentitySource {
  /** Fresh opaque result instance id (`pgw:i:<32 lowercase hex>`; ADR-008). */
  readonly newResultInstanceId: () => string;
  /** Fresh opaque result revision id (`pgw:r:<32 lowercase hex>`; ADR-008). */
  readonly newResultRevisionId: () => string;
  /** Fresh opaque evidence id (`pgw:e:<32 lowercase hex>`; committed evidenceId syntax). */
  readonly newEvidenceId: () => string;
}

export type { ValidationReport, ValidatedArtifact };
