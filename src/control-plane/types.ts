/**
 * WP-12 Slice 1 — control-plane type vocabulary (transport-free approval and
 * issuance decision core).
 *
 * Type-level vocabulary only. This module performs no I/O, no persistence,
 * and no authority issuance. It defines the untrusted request model, the
 * trusted host-injected context model, the WP-8 store boundary, the
 * host-side decision coordination boundary, and the closed Slice-1 result
 * taxonomy per the committed WP-12 pre-implementation contract
 * (docs/reports/wp-12-pre-implementation-contract-decision.md).
 *
 * Trust separation is structural: untrusted request operands and trusted
 * host context are distinct object families and never share fields. The
 * request payload can never supply the approver/issuer role, configuration,
 * ceilings, registry context, store boundary, validation outcome, or any
 * authority-bearing object (SCR-W12-003; FSCR-W12-001/002).
 */
import type { SchemaRegistry } from '../schema/registry.js';
import type {
  AcceptedRegistryContext,
  ConsumerSupportDeclaration,
  ValidationReport,
  ValidatedArtifact,
} from '../api/types.js';
import type {
  EnumerateClassResult,
  PublishRecordResult,
  ReadRecordResult,
  RecordClassId,
} from '../storage/types.js';
import type { ValidatedTrustedWorkspaceConfiguration, ValidatedWorkspaceRecord } from '../trusted/types.js';

// ─── fixed Slice-1 vocabulary ───────────────────────────────────────────────

/** The five prospective artifact kinds permitted by the accepted lifecycle contract. */
export const SLICE_1_KIND_IDS = ['TaskSpec', 'AuthorityPolicy', 'ContextManifest', 'CompletionContract', 'ExecutionBundle'] as const;
export type Slice1KindId = (typeof SLICE_1_KIND_IDS)[number];

/** Slice-1 family operations + Slice 2A revoke + Slice 2B verify + Slice-3A issueRuntimeGrant. */
export const SLICE_1_OPERATIONS = ['recordValidation', 'approve', 'issue', 'revoke', 'verifyCurrentLifecycleState', 'issueRuntimeGrant', 'decideActivation', 'createOccurrence'] as const;
export type Slice1Operation = (typeof SLICE_1_OPERATIONS)[number];

/**
 * Operational revocation target record types (schema target enum subset).
 * Slice 2A: ApprovalRecord, IssuanceRecord. Slice-3A extends the existing
 * revoke operation with RuntimeGrant (contract §26.15); no separate
 * revokeRuntimeGrant operation exists. The later publication target stays
 * out of the operational set (a later result-publisher context).
 */
export const SLICE_2A_TARGET_RECORD_TYPES = ['ApprovalRecord', 'IssuanceRecord', 'RuntimeGrant'] as const;
export type Slice2ATargetRecordType = (typeof SLICE_2A_TARGET_RECORD_TYPES)[number];

/** Slice-2A operational revocation scopes for approval/issuance targets. */
export const REVOKE_SCOPES = ['all-uses', 'execution-use'] as const;
export type RevokeScope = (typeof REVOKE_SCOPES)[number];

/** Accepted RevocationRecord reason_code syntax (schema pattern). */
export const REASON_CODE_RE = /^[a-z][a-z0-9-]{0,63}$/;
/** Registry snapshot identity syntax (pgw:g: + 32 lowercase hex). */
export const REGISTRY_SNAPSHOT_ID_RE = /^pgw:g:[0-9a-f]{32}$/;
/** The Slice-2A primary publication class for revocation records. */
export const REVOCATION_RECORD_CLASS = 'revocation-record' as const;


/**
 * Accepted capability identifier syntax (capability-vocabulary.md): the
 * `project-gateway.<class>` convention with a lowercase class token. Only
 * SYNTAX is enforced here; vocabulary membership is the accepted
 * `isKnownCapability` check (well-formed-but-unknown fails closed at
 * evaluation as `eligibility-denied`, never here).
 */
export const CAPABILITY_IDENTIFIER_RE = /^project-gateway\.[a-z][a-z0-9-]*$/;
/** Bound on requested capabilities per verify request (untrusted operand). */
export const VERIFY_CAPABILITY_MAX_COUNT = 64;
/** Bound on one capability identifier length (untrusted operand). */
export const VERIFY_CAPABILITY_MAX_LENGTH = 128;
/** Bound on ConsumerSupportDeclaration array lengths (untrusted operand). */
export const CONSUMER_SUPPORT_MAX_ITEMS = 128;
/** Bound on one ConsumerSupportDeclaration item length (untrusted operand). */
export const CONSUMER_SUPPORT_MAX_ITEM_LENGTH = 128;
/** Bound on the consumer identity length (untrusted operand). */
export const CONSUMER_ID_MAX_LENGTH = 256;

/** Accepted artifact protocol identity/version (schema const). */
export const ARTIFACT_PROTOCOL_ID = 'project-gateway.artifact' as const;
export const ARTIFACT_PROTOCOL_VERSION = '1.0' as const;

/** Accepted validator profile (schema const; the accepted WP-4 engine profile). */
export const VALIDATOR_PROFILE_ID = 'project-gateway.structural-semantic-v1' as const;
export const VALIDATOR_PROFILE_VERSION = '1.0' as const;

/** The only accepted approval purpose in Slice 1 (schema enum). */
export const SLICE_1_PURPOSES = ['execution-use'] as const;
/** The only accepted issuance use class in Slice 1 (schema enum). */
export const SLICE_1_USE_CLASSES = ['execution-use'] as const;

/** Capability vocabulary tokens consumed by Slice 1 (capability-vocabulary.md). */
export const APPROVAL_OPERATE_CAPABILITY = 'project-gateway.approval-operate' as const;
export const LIFECYCLE_ISSUE_CAPABILITY = 'project-gateway.lifecycle-issue' as const;

/** Closed identity syntaxes (WP-2 / accepted schemas). */
export const INSTANCE_ID_RE = /^pgw:i:[0-9a-f]{32}$/;
export const REVISION_ID_RE = /^pgw:r:[0-9a-f]{32}$/;
export const WORKSPACE_ID_RE = /^pgw:w:[0-9a-f]{32}$/;
export const RECORD_ID_RE = /^pgw:l:[0-9a-f]{32}$/;
export const DIGEST_RE = /^sha-256:[0-9a-f]{64}$/;
export const VERSION_RE = /^[1-9][0-9]*\.(0|[1-9][0-9]*)$/;
export const TIMESTAMP_RE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/;

/** Bound on the optional descriptive reason operand. */
export const REASON_MAX_LENGTH = 200;
/** Bound on validation-record references per approval (schema maxItems 16). */
export const VALIDATION_REF_MAX_COUNT = 16;
/** Issuance activation limit bounds (schema minimum/maximum). */
export const ACTIVATION_LIMIT_MIN = 1;
export const ACTIVATION_LIMIT_MAX = 64;

// ─── Slice-3A grant vocabulary ───────────────────────────────────────────────

/** The Slice-3A primary publication class for RuntimeGrant records. */
export const RUNTIME_GRANT_CLASS = 'runtime-grant' as const;
/** The Slice-3B primary publication class for activation decisions. */
export const ACTIVATION_RECORD_CLASS = 'activation-record' as const;
/** The Slice-3B primary publication class for execution occurrences. */
export const EXECUTION_OCCURRENCE_RECORD_CLASS = 'execution-occurrence-record' as const;
/** Closed occurrence identity syntax (accepted schema: `pgw:o:` + 32 lowercase hex). */
export const OCCURRENCE_ID_RE = /^pgw:o:[0-9a-f]{32}$/;
/** RuntimeGrant attempt allowance bounds (schema bounds; contract §26.11). */
export const ATTEMPT_LIMIT_MIN = 1;
export const ATTEMPT_LIMIT_MAX = 64;
/** The four schema-admitted RuntimeGrant narrowing forms (contract §26.6). */
export const NARROWED_CONSTRAINT_TYPES = ['max-actions', 'max-resources', 'read-only', 'require-exact-resource'] as const;
export type NarrowedConstraintType = (typeof NARROWED_CONSTRAINT_TYPES)[number];
/** Bound on narrowed_constraints per grant (schema maxItems 16; non-empty enforced at capture). */
export const NARROWED_CONSTRAINT_MAX_COUNT = 16;

/** One schema-admitted narrowed constraint operand (untrusted requested narrowing). */
export interface RuntimeGrantConstraint {
  readonly type: NarrowedConstraintType;
  /** max-actions/max-resources: non-negative safe integer; read-only/require-exact-resource: true. */
  readonly value: number | boolean;
}

// ─── canonical subject model (Decision 3; SCR-W12-008) ─────────────────────

/**
 * Intrinsic artifact revision identity plus the operation-scope workspace
 * binding. Per SCR-W12-008, workspaceId is NOT part of the artifact's
 * intrinsic revision identity, but it IS an exact required component of the
 * lifecycle record subject/binding; the payload builders always place
 * `workspace_id` inside the record subject exactly as the accepted protocol
 * record schemas/fixtures require.
 */
export interface CanonicalSubject {
  readonly protocolId: string;
  readonly protocolVersion: string;
  readonly kindId: Slice1KindId;
  readonly kindVersion: string;
  readonly instanceId: string;
  readonly revisionId: string;
  readonly digest: string;
  readonly workspaceId: string;
}

// ─── untrusted request model ────────────────────────────────────────────────

/** Untrusted Slice-1/Slice-2A request operands (exact-key validated; never authority-bearing). */
export interface Slice1Request {
  readonly operation: Slice1Operation;
  /** Slice-1 operations only (recordValidation/approve/issue); absent for revoke. */
  readonly subject?: CanonicalSubject;
  readonly workspaceId: string;
  /** approve only; must equal the accepted purpose enum value. */
  readonly purpose?: string;
  /** issue only; must equal the accepted use-class enum value. */
  readonly useClass?: string;
  /** approve only; exact ValidationRecord references (pgw:l: identities). */
  readonly validationRecordIds?: readonly string[];
  /** Optional bounded descriptive operand; never decision-bearing. */
  readonly reason?: string;
  /** revoke only: exact target record type (ApprovalRecord | IssuanceRecord). */
  readonly targetRecordType?: Slice2ATargetRecordType;
  /** revoke only: exact target record identity (pgw:l:). */
  readonly targetRecordId?: string;
  /** revoke only: operational scope (all-uses | execution-use). */
  readonly scope?: RevokeScope;
  /** revoke only: accepted trusted timestamp; MAY be future-dated. */
  readonly effectiveAt?: string;
  /** revoke only: bounded reason code (schema pattern); descriptive only. */
  readonly reasonCode?: string;
  /** revoke/verify only: REQUIRED untrusted registry-context correlation echo. */
  readonly registryEcho?: Readonly<{ registry_snapshot_id: string; registry_snapshot_digest: string }>;
  /** verify only: REQUIRED untrusted requested capability identifiers (accepted `project-gateway.<class>` grammar). */
  readonly capabilityRequirements?: readonly string[];
  /** verify only: REQUIRED untrusted consumer-support declaration (accepted ConsumerSupportDeclaration fields). */
  readonly consumerSupport?: ConsumerSupportDeclaration;
  /** issueRuntimeGrant only: untrusted requested attempt allowance (1..64 inclusive; per reserved occurrence). */
  readonly attemptLimit?: number;
  /** issueRuntimeGrant only: untrusted requested validity window (not_before <= not_after; accepted timestamps). */
  readonly validity?: Readonly<{ not_before: string; not_after: string }>;
  /** issueRuntimeGrant only: untrusted requested narrowing (schema forms; non-empty, duplicate-free). */
  readonly narrowedConstraints?: readonly RuntimeGrantConstraint[];
  /** decideActivation only: untrusted grant correlation operand (exact RuntimeGrant record identity). */
  readonly grantId?: string;
  /** decideActivation / createOccurrence only: untrusted reserved-occurrence correlation operand. */
  readonly reservedOccurrenceId?: string;
}

// ─── accepted WP-4 validation evidence (host-injected) ─────────────────────

/**
 * Host-injected trusted validation evidence: an ACCEPTED WP-4 validation run.
 * The artifact wrapper must come from the accepted WP-4 pipeline
 * (validateArtifactRevision and friends); the report must be its ok:true
 * report. WP-12 derives every ValidationRecord validation field exclusively
 * from this operand and never accepts a caller-authored outcome
 * (SCR-W12-004).
 */
export interface AcceptedValidationEvidence {
  readonly report: ValidationReport;
  readonly artifact: ValidatedArtifact;
}

// ─── WP-8 store boundary (host-injected; the ONLY publication path) ────────

/** Bounded read result over one lifecycle record payload. */
export interface LifecycleReadResult {
  readonly ok: boolean;
  /** The lifecycle record payload (the stored envelope's payload). */
  readonly payload?: Readonly<Record<string, unknown>>;
  /**
   * Internal-only result code: `'not-found'` (semantic absence, preserved
   * from WP-8 `ERR-STO-NOT-FOUND`; SR-W12-S1-004), `'read-failed'` (actual
   * read/storage malfunction), `'malformed-record'`. Never exposed publicly;
   * the core maps these internal codes to the closed public taxonomy.
   */
  readonly code?: string;
}

/** Bounded enumeration result over one record class (identities only). */
export interface LifecycleEnumerateResult {
  readonly ok: boolean;
  readonly recordIds: readonly string[];
  readonly code?: string;
}

/**
 * Injected WP-8 store boundary. The real adapter wraps
 * `publishRecord`/`readRecord`/`enumerateClass` unchanged (WP-8 keeps its
 * internal writer lock and mechanical write-audit); tests may inject fakes.
 * WP-12 never writes files, never acquires WP-8 writer locks, and never
 * publishes AuthoritativeAuditEvent records (SCR-W12-001).
 */
export interface ControlPlaneStoreBoundary {
  readonly publishLifecycleRecord: (recordClass: RecordClassId, payload: Readonly<Record<string, unknown>>) => PublishRecordResult;
  readonly readLifecyclePayload: (recordClass: RecordClassId, recordId: string) => LifecycleReadResult;
  readonly enumerateLifecycleRecords: (recordClass: RecordClassId) => LifecycleEnumerateResult;
}

// ─── host-side decision coordination (FSCR-W12-001) ─────────────────────────

/**
 * Host-side / process-level decision serialization ONLY. The host owns the
 * mechanism; the core owns the ordering (capture → withLock → read state →
 * revalidate → publish → verify → release). This is NOT a WP-8 filesystem
 * lock: it creates no entry under the WP-8 `locks/` layout, is not a second
 * writer lock, and provides no cross-process exclusion.
 */
export interface DecisionCoordinator {
  withLock<T>(key: string, fn: () => T): T;
}

// ─── trusted host context (host-injected; never request-supplied) ──────────

/** Host-asserted trusted operator roles (structural approver independence). */
export interface ControlPlaneOperatorContext {
  /** Approval authority exists only when the host asserts this role. */
  readonly approverRole: boolean;
  /** Issuance authority exists only when the host asserts this role. */
  readonly issuerRole: boolean;
  /** Revocation authority exists only when the host asserts this role (Slice 2A; optional for Slice-1 hosts). */
  readonly revokerRole?: boolean;
  /** RuntimeGrant authority exists only when the host asserts this role (Slice 3A; never request-supplied). */
  readonly grantRole?: boolean;
  /** Activation authority exists only when the host asserts this role (Slice 3B; never request-supplied). */
  readonly activationRole?: boolean;
  /** Host-owned operational attribution; never itself authority. */
  readonly operatorIdentity: string;
}

/** Host-owned identity sources (D-3 pattern; never request-supplied). */
export interface ControlPlaneIdentitySource {
  /** Trusted UTC timestamp in the accepted `YYYY-MM-DDTHH:MM:SS.sssZ` form. */
  readonly nowUtcIso: () => string;
  /** Fresh opaque record identity (`pgw:l:<32 lowercase hex>`); non-reusable. */
  readonly newRecordId: () => string;
  /**
   * Fresh opaque reserved-occurrence identity (`pgw:o:<32 lowercase hex>`);
   * allocated INTERNALLY by issueRuntimeGrant under the coordination lock
   * (contract §26.9); never a caller operand.
   */
  readonly newOccurrenceId: () => string;
}

/** Host-owned approval decision defaults (trusted issuance-side operands). */
export interface ControlPlaneApprovalDefaults {
  readonly requiredSemantics?: { readonly protocol_features: readonly string[]; readonly consumer_capabilities: readonly string[] };
  readonly validUntil?: string | null;
}

/** Host-owned issuance decision defaults (trusted issuance-side operands). */
export interface ControlPlaneIssuanceDefaults {
  readonly activationLimit?: number;
  readonly validUntil?: string | null;
}

/** Complete trusted host-injected context for one Slice-1 command. */
export interface ControlPlaneTrustedContext {
  /** Runtime-genuine validated trusted configuration (WP-6; branded). */
  readonly configuration: ValidatedTrustedWorkspaceConfiguration;
  /** Accepted trusted registry context (WP-4/WP-6). */
  readonly registry: AcceptedRegistryContext;
  /** Host-asserted trusted operator roles (approver/issuer). */
  readonly operator: ControlPlaneOperatorContext;
  /** Injected WP-8 store boundary (the ONLY publication path). */
  readonly store: ControlPlaneStoreBoundary;
  /** Injected host-side process-level decision serialization (FSCR-W12-001). */
  readonly coordinate: DecisionCoordinator;
  /** Host-owned identity sources. */
  readonly identity: ControlPlaneIdentitySource;
  /** Host-owned approval defaults (required semantics / validity end). */
  readonly approval?: ControlPlaneApprovalDefaults;
  /** Host-owned issuance defaults (activation limit / validity end). */
  readonly issuance?: ControlPlaneIssuanceDefaults;
  /** Optional offline schema registry; a fresh accepted registry is used when absent. */
  readonly schemaRegistry?: SchemaRegistry;
  /** recordValidation only: the accepted WP-4 validation run (host-injected evidence). */
  readonly validationEvidence?: AcceptedValidationEvidence;
  /** approve/issue only: the exact validated artifact model (host-injected evidence). */
  readonly subjectArtifact?: ValidatedArtifact;
  /** decideActivation only: host-asserted consumer/enforcement support (never request-supplied; §26.8). */
  readonly consumerSupport?: ConsumerSupportDeclaration;
  /** decideActivation only: the exact validated AuthorityPolicy artifact resolved from the bundle reference (host-injected). */
  readonly policyEvidence?: ValidatedArtifact;
}

// ─── closed Slice-1 result taxonomy (committed contract §13) ───────────────

/** The exact closed Slice-1 failure categories (no additions; SCR-W12-004/FSCR-W12-002). */
export type Slice1FailureCategory =
  | 'request-invalid'
  | 'subject-invalid'
  | 'subject-not-validated'
  | 'approver-not-independent'
  | 'eligibility-denied'
  | 'ceiling-denied'
  | 'lifecycle-state-missing'
  | 'lifecycle-conflict'
  | 'already-approved'
  | 'approval-revoked'
  | 'issuance-not-authorized'
  | 'already-issued'
  | 'occurrence-conflict'
  | 'replay-denied'
  | 'registry-context-mismatch'
  | 'store-failure'
  | 'lock-conflict'
  | 'internal-failure';

export type Slice1Outcome = 'recorded' | 'approved' | 'issued' | 'revoked' | 'verified' | 'granted' | 'activated' | 'recovered';

/** Bounded deterministic success evidence (identity/digest facts only). */
export interface Slice1Success {
  readonly ok: true;
  readonly outcome: Slice1Outcome;
  readonly evidence: {
    readonly recordClass: RecordClassId;
    readonly recordId: string;
    readonly recordDigest?: string;
    /** WP-8 mechanical write-audit event identity (D-6) when reported. */
    readonly auditEventId?: string;
    readonly subject: CanonicalSubject;
    readonly workspaceId: string;
    // ── Slice-2B verifyCurrentLifecycleState evidence (outcome 'verified') ──
    // Bounded NON-AUTHORIZING current-state facts for the completed
    // evaluation only (contract §25.3/§25.17/§25.18): nothing here is
    // accepted as authority input by any mutating operation, carries no
    // freshness token, and is never sufficient for later privileged work.
    /** Verification form selector: exactly one of purpose (approval form) / useClass (issuance form). */
    readonly purpose?: string;
    readonly useClass?: string;
    /** The exact current usable ApprovalRecord (approval form: the verified record; issuance form: the referenced approval). */
    readonly approvalRecordId?: string;
    /** Issuance form only: the exact current usable IssuanceRecord (equals recordId). */
    readonly issuanceRecordId?: string;
    /** The current accepted registry context (host-injected). */
    readonly registrySnapshotId?: string;
    readonly registrySnapshotDigest?: string;
    /** Trusted verification time from the host-injected time source. */
    readonly verifiedAt?: string;
    /** Derived fact: the requested lifecycle state was current at evaluation time. */
    readonly currentState?: 'current';
    /** Derived fact: the requested capability/consumer/ceiling intersection held. */
    readonly intersection?: 'satisfied';
    // ── Slice-3A issueRuntimeGrant evidence (outcome 'granted') ──
    // Bounded deterministic correlation facts only (contract §25): the
    // RuntimeGrant record in the trusted store is authoritative lifecycle
    // state; this evidence is correlation data and never transferable
    // authority. No raw record payload, role, store path, config, or
    // coordinator is returned.
    /** The internally allocated reserved occurrence identity (pgw:o:). */
    readonly reservedOccurrenceId?: string;
    /** The granted attempt allowance (per reserved occurrence). */
    readonly attemptLimit?: number;
    /** The granted validity window (untrusted requested narrowing). */
    readonly validity?: { readonly not_before: string; readonly not_after: string };
    /** The granted narrowing constraints (untrusted requested narrowing). */
    readonly narrowedConstraints?: readonly Readonly<RuntimeGrantConstraint>[];
    // ── Slice-3B activation/recovery evidence (outcomes 'activated' / 'recovered') ──
    // Bounded deterministic evidence per §26.16: activation outcome, record
    // identities, grant identity, reserved occurrence identity, workspace,
    // exact bundle revision identity, registry correlation. Complete
    // accepted activation evidence exists ONLY after BOTH records are
    // durable; the five issuance IDs are NOT included (§26.16). Denied
    // activation evidence is historical decision facts only — never
    // PiEnforcementEvidence authority.
    /** Activation decision ('accepted' | 'denied'); absent for recovery. */
    readonly decision?: 'accepted' | 'denied';
    /** The exact correlated RuntimeGrant record identity. */
    readonly runtimeGrantId?: string;
    /** Accepted activation only: the mandatory internal ExecutionOccurrenceRecord identity. */
    readonly occurrenceRecordId?: string;
    readonly occurrenceRecordClass?: string;
    readonly occurrenceRecordDigest?: string;
    readonly occurrenceAuditEventId?: string;
    /** createOccurrence recovery: the exact accepted ActivationRecord anchor. */
    readonly activationRecordId?: string;
  };
}

/** Bounded redacted failure (fixed message; no paths/errno/stacks/internals). */
export interface Slice1Failure {
  readonly ok: false;
  readonly category: Slice1FailureCategory;
  readonly code: string;
  readonly message: string;
}

export type Slice1Result = Slice1Success | Slice1Failure;

export type { PublishRecordResult, ReadRecordResult, EnumerateClassResult, RecordClassId };
export type { ValidatedTrustedWorkspaceConfiguration, ValidatedWorkspaceRecord };
