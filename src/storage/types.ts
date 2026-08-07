/**
 * WP-8 storage domain types (WP-8-B non-mutating foundation).
 *
 * This module defines internal TypeScript representations for the WP-8
 * contract (docs/specs/wp-8-local-storage-registry-contract.md) without
 * creating runtime authority, persistence, or filesystem access.
 *
 * Type-level vocabulary only: no value in this module (or anywhere in
 * `src/storage/**`) may authorize or perform a mutation, and no capability
 * instance or factory exists in this phase.
 */
import type { ReadCapability } from './capabilities/authenticity.js';
import type { AuditEventKind } from './audit/write-audit.js';

/** Supported layout version constant (contract LAY-001, LAY-006). */
export const STORAGE_LAYOUT_VERSION = 'v1' as const;
export type StorageLayoutVersion = typeof STORAGE_LAYOUT_VERSION;

/**
 * The two versioned namespace roots below the trusted parent (CSR-002).
 * Relative paths derived in this phase are namespace-relative; the versioned
 * root name is a layout constant only.
 */
export const CONFIG_NAMESPACE_ROOT = 'config-v1' as const;
export const RECORDS_NAMESPACE_ROOT = 'store-v1' as const;
export type NamespaceRootName = typeof CONFIG_NAMESPACE_ROOT | typeof RECORDS_NAMESPACE_ROOT;

/** Per-namespace internal directories (LAY-001/5.2). */
export const STORE_DIRECTORY_NAMES = ['metadata', 'records', 'index', 'audit', 'tmp', 'locks', 'quarantine'] as const;
export type StoreDirectoryName = (typeof STORE_DIRECTORY_NAMES)[number];

/** Namespace kinds distinguished by the layout (LAY-013). */
export type NamespaceKind = 'store-records' | 'configuration';

/**
 * The closed 18-class record taxonomy (contract 6.2, TAX-011). Kebab-case
 * storage identifiers; the PascalCase contract label is carried per class.
 */
export const RECORD_CLASS_IDS = [
  'validation-record',
  'approval-record',
  'issuance-record',
  'revocation-record',
  'runtime-grant',
  'activation-record',
  'execution-occurrence-record',
  'execution-attempt-record',
  'trusted-receipt',
  'result-publication-record',
  'supersession-record',
  'execution-summary-record',
  'migration-record',
  'authoritative-audit-event',
  'registry-snapshot',
  'store-metadata',
  'store-evidence-record',
  'configuration-snapshot-record',
] as const;
export type RecordClassId = (typeof RECORD_CLASS_IDS)[number];

/** Closed evidence-kind discriminator for `StoreEvidenceRecord` (TAX-008/013). */
export const STORE_EVIDENCE_KINDS = [
  'recovery-evidence',
  'retention-evidence',
  'quarantine-evidence',
  'lock-recovery-evidence',
  'initialization-evidence',
  'migration-evidence',
  'audit-reconstruction-evidence',
] as const;
export type StoreEvidenceKind = (typeof STORE_EVIDENCE_KINDS)[number];

/** Accepted typed-identifier prefixes (contract 5.3; WP-2 / accepted schema). */
export const ACCEPTED_IDENTIFIER_PREFIXES = ['pgw:i:', 'pgw:r:', 'pgw:w:', 'pgw:g:', 'pgw:l:'] as const;
export type AcceptedIdentifierPrefix = (typeof ACCEPTED_IDENTIFIER_PREFIXES)[number];

/** Opaque component length: exactly 32 lowercase hexadecimal characters (LAY-004). */
export const OPAQUE_IDENTIFIER_LENGTH = 32 as const;

/** Parsed typed identifier (format/identifier.ts). */
export interface TypedIdentifier {
  readonly raw: string;
  readonly prefix: AcceptedIdentifierPrefix;
  /** Exactly 32 lowercase hexadecimal characters following the prefix. */
  readonly opaque: string;
}

/** Storage record identity components (RFM-003; never path-based). */
export interface RecordIdentity {
  readonly recordId: TypedIdentifier;
  readonly recordClass: RecordClassId;
}

/** Canonical record envelope fields (contract 7.1, RFM-001). */
export interface RecordEnvelope {
  readonly recordKind: string;
  readonly formatVersion: string;
  readonly recordId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly trustedActionId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadDigest: string;
  readonly referenceDigests?: readonly string[];
  readonly previousRecordDigest?: string;
  readonly integrityMetadata?: Readonly<Record<string, unknown>>;
  readonly retentionClass?: string;
}

/** Canonical persisted-byte descriptor (contract 6.3, RFM-008/014). */
export interface PersistedByteDescriptor {
  /** Canonical UTF-8 bytes (string form) of the persisted record. */
  readonly canonicalUtf8: string;
  readonly byteLength: number;
  /** Domain-separated SHA-256 digest of the canonical bytes. */
  readonly digest: string;
}

/** Integrity descriptor (ITG-001/002/011; RFM-002). */
export interface IntegrityDescriptor {
  readonly payloadDigest: string;
  readonly previousRecordDigest?: string;
  readonly metadataDigest?: string;
}

/** Limit-profile identity binding (LMT-011, 19.2). */
export interface LimitProfileIdentity {
  readonly configurationVersion: string;
  readonly configurationIdentity?: string;
  readonly storeMetadataDigest?: string;
}

/** Configuration-chain input: a caller-supplied snapshot record view. */
export interface ConfigurationChainInput {
  readonly revision: number;
  readonly recordId: string;
  readonly predecessorId?: string;
  readonly predecessorDigest?: string;
  readonly payloadDigest: string;
  /** Canonical bytes of the snapshot record (for duplicate classification). */
  readonly canonicalUtf8: string;
  readonly recordDigest: string;
}

/** Deterministic chain-head result (CSR-013/016; 3.6). */
export interface ConfigurationChainResult {
  readonly heads: readonly ConfigurationChainInput[];
  readonly selectedHead?: ConfigurationChainInput;
  readonly findings: readonly StorageFinding[];
}

/** Operation-phase vocabulary (contract 18.1; WPR 10.5 stage semantics). */
export type OperationPhase =
  | 'request-validation'
  | 'lock-acquisition'
  | 'pre-mutation'
  | 'temporary-write'
  | 'pre-publication'
  | 'post-primary-publication'
  | 'post-final-directory-sync'
  | 'post-temporary-unlink'
  | 'post-tmp-directory-sync'
  | 'audit-publication'
  | 'post-audit-publication'
  | 'acknowledgement'
  | 'recovery'
  | 'unknown';

/** Durability-state vocabulary (WPR-021/022, ERM-006). */
export type DurabilityState =
  | 'none'
  | 'unknown'
  | 'primary-durable'
  | 'primary-durable-temp-removal-unknown'
  | 'durability-point-reached'
  | 'verify-required';

/** Per-code state summary (contract 18.1 columns). */
export interface ErrorStateSummary {
  readonly retryable: boolean;
  readonly recoveryRequired: boolean;
  readonly primaryStateChanged: 'yes' | 'no' | 'unknown' | 'n/a';
  readonly durabilityPointReached: 'yes' | 'no' | 'unknown' | 'n/a';
  readonly auditChanged: 'yes' | 'no' | 'unknown' | 'n/a';
  readonly verifyBeforeRetry: boolean;
}

/** Deterministic, disclosure-safe storage finding (ERM-004). */
export interface StorageFinding {
  readonly code: string;
  /** Static, disclosure-safe message; never interpolates paths, errno, or identities. */
  readonly message: string;
  readonly phase: OperationPhase;
  readonly state: ErrorStateSummary;
}

/** Type-level future-capability vocabulary only (contract 21, CAP-001). */
export type CapabilityKind =
  | 'initialization'
  | 'write'
  | 'read'
  | 'verify'
  | 'recovery'
  | 'retention'
  | 'migration';

/** Type-level capability descriptor; NO value of this shape may authorize mutation. */
export interface CapabilityDescriptor {
  readonly kind: CapabilityKind;
  readonly mutationCapable: boolean;
}

// ─── WP-8-D: write/read/verify operations, publication, locking, audit ────
// Type-level vocabulary only. No value in this module authorizes a mutation;
// every mutation path requires a genuine capability created by a gated
// creator in `src/storage/capabilities/authenticity.ts`.

/** WP-8-D write operation set (CAP-001, CAP-004). */
export type WriteOperation = 'record-publish';

/** WP-8-D read-operation set (non-mutating; CAP-001). */
export type ReadOperation = 'read-record' | 'enumerate-class';

/** WP-8-D verify-operation set (non-mutating; CAP-001). */
export type VerifyOperation = 'verify-record';

/**
 * Verified store instance facts used as capability bindings (ADR-029 D-5).
 * Only the metadata verification pipeline (descriptor-bound read, canonical
 * parse, digest and identity verification) may produce this value; it is
 * never constructible from raw request or structural objects.
 */
export interface VerifiedStoreInstance {
  readonly parentIdentity: RootIdentity;
  /** Exactly the two verified namespace identities (configuration, store-records). */
  readonly namespaces: readonly NamespaceIdentity[];
  readonly configurationIdentity: string;
  readonly serviceUid: number;
  /** Selected limit profile (values), correlated with the verified metadata. */
  readonly limitProfile: Readonly<Record<string, number>>;
}

/** Canonical writer lock record (contract 12.3, LOK-005/006/015). */
export interface WriterLockRecord {
  readonly lockVersion: '1';
  /** Store instance: both namespace identities (dev/ino) — never PID alone. */
  readonly storeInstance: readonly { readonly kind: NamespaceKind; readonly dev: number; readonly ino: number }[];
  /** Random per-acquisition nonce (contract 12.3). */
  readonly nonce: string;
  /** Safe reference: domain digest of the trusted action identity. */
  readonly actionIdentityDigest: string;
  readonly pid: number;
  readonly processStartTime: number;
  /** Host boot identity where available; absent in WP-8-D (injectable; reserved for phase-4 recovery). */
  readonly bootIdentity?: string;
  readonly acquisitionTime: number;
  /** Maximum age from the limit profile (`lockWait`); informational in WP-8-D. */
  readonly maxAgeMs: number;
}

/** Lock outcome vocabulary (LOK-001/008/011/013). */
export type LockOutcome =
  | 'acquired'
  | 'contention'
  | 'timeout'
  | 'cancelled'
  | 'released'
  | 'not-owned'
  | 'foreign-lock';

export interface LockResult {
  readonly ok: boolean;
  readonly outcome?: LockOutcome;
  readonly record?: WriterLockRecord;
  readonly code?: string;
  readonly message?: string;
}

/** Minimal mechanical write-audit event payload (AUD-002/003/005; D-8). */
export interface WriteAuditEventModel {
  /** `pgw:l:<32-hex>` deterministic event identity (D-8). */
  readonly recordId: string;
  readonly envelope: Readonly<Record<string, unknown>>;
  readonly canonicalUtf8: string;
  readonly digest: string;
  /** Ordering tuple: primary createdAt, primary record identity, event identity (DTM-003). */
  readonly ordering: readonly [string, string, string];
}

/** Publication outcome vocabulary (WPR-006/012/019; 10.2). */
export type PublicationOutcome =
  | 'published'
  | 'idempotent-duplicate'
  | 'duplicate'
  | 'conflict-revision'
  | 'temp-exists-retry'
  | 'failed';

export interface PublishRecordResult {
  readonly ok: boolean;
  readonly outcome?: PublicationOutcome;
  readonly recordId?: string;
  readonly recordDigest?: string;
  readonly auditEventId?: string;
  readonly findings?: readonly StorageFinding[];
}

/** Exact-read result (RDS-001/002/008). */
export interface ReadRecordResult {
  readonly ok: boolean;
  readonly record?: Readonly<Record<string, unknown>>;
  readonly digest?: string;
  readonly byteLength?: number;
  readonly findings?: readonly StorageFinding[];
}

/** Verify-by-identity result (RDS-003): structured findings, never content. */
export interface VerifyRecordResult {
  readonly ok: boolean;
  readonly findings: readonly StorageFinding[];
}

/** Enumeration continuation cursor (RDS-004, LMT-006). */
export interface EnumerationCursor {
  readonly shard: string;
  readonly entry: string;
}

/** One enumerated item: a verified record identity or a bounded finding. */
export interface EnumeratedItem {
  readonly recordId?: string;
  readonly finding?: StorageFinding;
}

export interface EnumerateClassResult {
  readonly ok: boolean;
  readonly items: readonly EnumeratedItem[];
  readonly continuation?: EnumerationCursor;
  readonly scannedEntries: number;
  readonly truncated: boolean;
  readonly findings?: readonly StorageFinding[];
}

// ─── WP-8-K: audit-history inspection (contract 13.4, HST-001…010, AUD-014; ADR-034) ───

/** Closed audit-history status vocabulary (HST-007). */
export type AuditHistoryStatus = 'complete' | 'missing-authorized-write' | 'reconstructed-gap' | 'ambiguous-history';

/** Closed audit-history finding vocabulary (HST-007). */
export type AuditHistoryFindingKind =
  | 'missing-authorized-write'
  | 'dangling-audit'
  | 'wrong-target-digest'
  | 'duplicate-audit'
  | 'conflicting-audit'
  | 'malformed-audit'
  | 'unsupported-audit-version'
  | 'unverified-audit'
  | 'ambiguous-history'
  | 'evidence-without-event'
  | 'event-without-evidence';

/** One audit-history finding (closed vocabulary; never a repair instruction). */
export interface AuditHistoryFinding {
  readonly kind: AuditHistoryFindingKind;
  /** Deterministic surface position of the object (layout components; never a raw path). */
  readonly position?: { readonly surface: 'audit' | 'evidence'; readonly shard: string; readonly entry: string };
  /** Associated audit event identity when the finding concerns a named event. */
  readonly eventId?: string;
  readonly reason: string;
}

/** One verified audit event in the target's history (event kind preserved; never flattened). */
export interface HistoryAuditEvent {
  /** Deterministic audit event identity (`pgw:l:<32-hex>`; D-8). */
  readonly eventId: string;
  /** Closed implemented event-kind vocabulary (imported; never duplicated; AUD-011/014). */
  readonly eventKind: AuditEventKind;
  /** Canonical record-bytes digest of the durable event bytes. */
  readonly digest: string;
  /** Recorded creation evidence (primary logical creation time or recovery time; never an ordering authority by itself). */
  readonly createdAt: string;
  /** Trusted action identity recorded in the event envelope (original write action for authorized-write; recovery action for reconstruction). */
  readonly trustedActionId: string;
  /** True when the event is the deterministic original authorized-write of the target (D-8 expected identity/digest match). */
  readonly isOriginalWrite: boolean;
  /** Reconstruction events only: the explicit gap marker naming the missing original event kind. */
  readonly gapMarker?: { readonly missingEventKind: 'authorized-write' };
}

/** Operational recovery evidence related to the target (annotation; never part of the target's audit history). */
export interface ReconstructionEvidenceAnnotation {
  readonly evidenceId: string;
  readonly outcome: string;
  readonly targetRecordDigest: string;
  readonly reconstructionAuditId: string;
  /** Record-bytes digest of the reconstructed audit event as bound by the evidence payload (WP-8-G §8; linkage fact). */
  readonly reconstructionAuditDigest: string;
  /** Original trusted action identity recorded in the evidence payload (a durable fact). */
  readonly originalActionIdentity: string;
  /** Trusted recovery action identity recorded in the evidence envelope. */
  readonly recoveryActionIdentity: string;
  readonly createdAt: string;
  /** Identity of the durable reconstruction event when the evidence's reconstructionAuditId matches one (undefined when none). */
  readonly linkedReconstructionEventId?: string;
  readonly verified: boolean;
}

/** Opaque self-validating audit-history continuation cursor (HST-008; never a raw path). */
export interface AuditHistoryCursor {
  /** Explicit cursor schema/version marker (HST-008): old/unsupported/ambiguous cursor shapes fail closed. */
  readonly formatVersion: number;
  /** Deterministic authoritative history snapshot identity bound to this cursor (HST-008/009; domain digest). */
  readonly historySnapshotIdentity: string;
  /** Deterministic store/namespace identity binding (domain digest; PGAP-STORAGE-AUDIT-HISTORY-CURSOR-v1). */
  readonly storeIdentity: string;
  readonly recordClass: string;
  readonly recordId: string;
  readonly revision: number;
  readonly generation: string;
  readonly surfaceGeneration: string;
  /** Deterministic digest of the query limit shape (changing limits invalidates the cursor). */
  readonly queryShape: string;
  /** Resume phase: the audit surface pass or the evidence-surface pass. */
  readonly phase: 'audit' | 'evidence';
  /** Last reported audit-surface position (layout components; findings resume boundary). */
  readonly lastAuditShard?: string;
  readonly lastAuditEntry?: string;
  /** WP-8-L: last reported event's normative tuple position (HST-005; events resume in tuple order). */
  readonly lastReportedEventTuple?: { readonly createdAt: string; readonly eventId: string };
  /** Last reported evidence-surface position (layout components; resume boundary). */
  readonly lastEvidenceShard?: string;
  readonly lastEvidenceEntry?: string;
}

/** Verified target-record facts for one history query (13.4; HST-002). */
export interface AuditHistoryTargetFacts {
  readonly recordClass: RecordClassId;
  readonly recordId: string;
  readonly revision: number;
  readonly recordDigest: string;
  readonly recordKind: string;
  readonly formatVersion: string;
  /** Original trusted action identity recorded in the durable target envelope (a fact, never an authority). */
  readonly trustedActionId: string;
  readonly createdAt: string;
}

/** Bounded audit-history inspection result (HST-010; pure data; no authority). */
export interface AuditHistoryInspectionResult {
  readonly ok: boolean;
  /** Boundary failure findings (request/store/snapshot errors); empty when ok. */
  readonly findings: readonly StorageFinding[];
  readonly target?: AuditHistoryTargetFacts;
  readonly status?: AuditHistoryStatus;
  readonly originalAuthorizedWrite?: { readonly present: boolean; readonly eventId?: string; readonly digest?: string };
  readonly reconstruction?: { readonly present: boolean; readonly events: readonly HistoryAuditEvent[] };
  /** Verified events of the target (D-8 ordering tuple; kinds preserved). */
  readonly events?: readonly HistoryAuditEvent[];
  /** Closed-vocabulary history findings (HST-007). */
  readonly auditFindings?: readonly AuditHistoryFinding[];
  /** Operational recovery evidence annotations related to the target. */
  readonly reconstructionEvidence?: readonly ReconstructionEvidenceAnnotation[];
  readonly completeness?: { readonly complete: boolean; readonly truncated: boolean; readonly scannedAuditEntries: number; readonly scannedEvidenceEntries: number; readonly scannedBytes: number };
  readonly snapshot?: { readonly generation: string; readonly surfaceGeneration: string; readonly historySnapshotIdentity: string };
  readonly continuation?: AuditHistoryCursor;
}

/** Audit-history inspection request (closed logical identifiers only; HST-001). */
export interface InspectAuditHistoryRequest {
  /** Genuine WP-6 validated trusted configuration (runtime-branded). */
  readonly trustedConfiguration: unknown;
  /** Genuine branded `TrustedStorageBootstrapInput`. */
  readonly trustedInput: unknown;
  readonly recordClass: RecordClassId;
  /** Canonical typed record identity (never a path). */
  readonly recordId: string;
  /** Exact revision (default 1); history is exact-revision inspection (13.4/HST-001). */
  readonly revision?: number;
  /** Opaque self-validating continuation cursor (HST-008). */
  readonly continuation?: AuditHistoryCursor;
}

/** Injected time/identity sources for the lock module (D-3; non-authority fields). */
export interface LockTimeSource {
  /** Bounded acquisition clock (ms epoch). Never derived from request payloads. */
  readonly now: () => number;
  /** Process start time (ms epoch), supplied by the trusted composition root. */
  readonly processStartTime: number;
  /** Host boot identity where available; omitted in WP-8-D (reserved for phase-4 recovery). */
  readonly bootIdentity?: string;
  /** Bounded wait primitive for lock contention (injected; no timers in storage source). */
  readonly wait?: (ms: number) => void;
  /** Caller cancellation signal checked during bounded waits (LOK-012). */
  readonly cancelled?: () => boolean;
}

/** Injectable fs hooks for deterministic per-stage failure tests (WPR-022). */
export interface PublicationHooks {
  readonly fsyncFile?: (fd: number) => void;
  readonly fsyncDirectory?: (path: string) => void;
  readonly write?: (fd: number, buf: Uint8Array, off: number, len: number, pos: number | null) => number;
  readonly link?: (existingPath: string, newPath: string) => void;
  readonly unlink?: (path: string) => void;
}

/** Authorized-write request (composition boundary; D-2/D-5). */
export interface PublishRecordRequest {
  /** Genuine WP-6 validated trusted configuration (runtime-branded). */
  readonly trustedConfiguration: unknown;
  /** Genuine branded `TrustedStorageBootstrapInput` (initialization-family gate). */
  readonly bootstrapInput: unknown;
  /** Genuine branded `StorageWriteActionProvenance` (zero production producers). */
  readonly writeActionProvenance: unknown;
  /** Correlated raw fields (verified for exact equality against the provenance). */
  readonly locator: string;
  readonly serviceUid: number;
  readonly forbiddenRoots: readonly string[];
  readonly limitProfile: Readonly<Record<string, number>>;
  /** Closed record class of the primary record. */
  readonly recordClass: RecordClassId;
  /** Validated envelope model of the primary record (canonicalized at admission). */
  readonly record: Readonly<Record<string, unknown>>;
  /** Injected time/identity sources for the lock module (D-3). */
  readonly timeSource: LockTimeSource;
  /** Injectable fs hooks for deterministic per-stage failure tests. */
  readonly hooks?: PublicationHooks;
}

/** Exact-read request (non-mutating; D-5). */
export interface ReadRecordRequest {
  /** Genuine WP-6 validated trusted configuration (runtime-branded). */
  readonly trustedConfiguration: unknown;
  /** Genuine branded `TrustedStorageBootstrapInput`. */
  readonly trustedInput: unknown;
  readonly recordClass: RecordClassId;
  readonly recordId: string;
}

/** Verify-by-identity request (non-mutating; D-5). */
export interface VerifyRecordRequest {
  readonly trustedConfiguration: unknown;
  readonly trustedInput: unknown;
  readonly recordClass: RecordClassId;
  readonly recordId: string;
}

/** Bounded enumeration request (non-mutating; D-5). */
export interface EnumerateClassRequest {
  readonly trustedConfiguration: unknown;
  readonly trustedInput: unknown;
  readonly recordClass: RecordClassId;
  readonly continuation?: EnumerationCursor;
}

// ─── WP-8-C: trusted root, initialization, and metadata domain types ──────
// Type-level vocabulary for the trusted-root/bootstrap phase. No value in
// this module authorizes mutation; the initialization capability is the only
// mutation gate and is created only by the gated factory in
// `src/storage/capabilities/authenticity.ts`.

/** Descriptor-bound identity of the trusted parent or a namespace root. */
export interface RootIdentity {
  /** Canonical absolute path (never derived from env, argv, cwd, or request). */
  readonly canonicalPath: string;
  readonly dev: number;
  readonly ino: number;
  readonly fileType: 'directory' | 'file' | 'symlink' | 'other';
}

/** Descriptor-bound identity of one versioned namespace root. */
export interface NamespaceIdentity {
  readonly kind: NamespaceKind;
  readonly canonicalPath: string;
  readonly dev: number;
  readonly ino: number;
}

/** Per-namespace and aggregate initialization state vocabulary. */
export type InitializationStateKind =
  | 'ABSENT'
  | 'PROVISIONAL'
  | 'INITIALIZED'
  | 'PARTIAL'
  | 'FOREIGN'
  | 'IDENTITY_DRIFTED'
  | 'MALFORMED_METADATA'
  | 'UNSUPPORTED_VERSION';

/** Per-namespace state classification with the fixed entry set. */
export interface NamespaceState {
  readonly kind: NamespaceKind;
  readonly state: InitializationStateKind;
  /** Fixed expected entries present under the namespace root. */
  readonly entries: readonly string[];
  /** True when an unknown or unexpected entry was detected (fails closed). */
  readonly unknownEntries: boolean;
  /**
   * True only for a phase-2-initialized namespace (exact `metadata,tmp` with
   * verified metadata) under the phase-3 classifier policy: upgradeable, not
   * foreign (ADR-029 D-7 state A). The namespace remains PROVISIONAL.
   */
  readonly phase3UpgradeRequired?: boolean;
  /** Namespace root identity when the directory exists and was verified. */
  readonly identity?: NamespaceIdentity;
}

/** Aggregate initialization state over both namespaces. */
export interface AggregateState {
  readonly state: InitializationStateKind;
  readonly namespaces: readonly NamespaceState[];
}

/** Bounded, deterministic compatibility-probe result (FSL-010). */
export interface ProbeResultProfile {
  readonly sameDevice: boolean;
  readonly hardLink: 'supported' | 'unsupported';
  readonly directoryFsync: 'supported' | 'unsupported';
  readonly regularFileFsync: 'supported' | 'unsupported';
  readonly exclusiveCreation: 'supported' | 'unsupported';
  readonly noFollow: 'supported' | 'unsupported';
  readonly caseSensitive: boolean;
}

/** Immutable per-namespace StoreMetadata facts (LAY-002, FSL-010). */
export interface StoreMetadataFacts {
  readonly metadataFormatVersion: '1';
  readonly layoutVersion: string;
  readonly namespaceKind: NamespaceKind;
  readonly namespaceIdentity: NamespaceIdentity;
  readonly parentIdentity: RootIdentity;
  readonly lane: string;
  readonly probe: ProbeResultProfile;
  readonly configurationIdentity: string;
  readonly actionIdentity: string;
  readonly limitProfileIdentity: LimitProfileIdentity;
}

/** Re-derivable stable facts used for metadata replay comparison (probe integrity is carried by the payload digest). */
export type StoreMetadataExpectation = Omit<StoreMetadataFacts, 'probe'>;

/** Parsed, verified StoreMetadata model (canonical envelope + digests). */
export interface VerifiedStoreMetadata {
  readonly facts: StoreMetadataExpectation;
  readonly payloadDigest: string;
  readonly recordByteDigest: string;
  readonly canonicalUtf8: string;
}

/** Truthful initialization result; namespace identities are results, never retroactive bindings. */
export interface InitializationResult {
  readonly ok: boolean;
  readonly state?: InitializationStateKind;
  readonly parentIdentity?: RootIdentity;
  readonly namespaceIdentities?: readonly NamespaceIdentity[];
  readonly metadataDigests?: readonly { readonly namespaceKind: NamespaceKind; readonly recordByteDigest: string }[];
  readonly findings?: readonly StorageFinding[];
}

// ─── WP-8-E: read-only store scan, registry views, recovery assessment ────
// Type-level vocabulary only (contract §13 RDS-004…007, §14 RGY, §16 CSA,
// §24 DTM). No value in this module authorizes mutation; this slice performs
// no write, rename, unlink, quarantine, lock break, audit publication, or
// capability minting. Observations, views, assessments, and plans are plain
// data: they contain no raw filesystem paths, no record payload bytes, no
// lock nonce, and no capability objects.

/** Closed per-candidate classification vocabulary (WP-8-E scope; codes stay within §18.1). */
export type RecordCandidateClassification =
  | 'valid-immutable-record'
  | 'malformed'
  | 'unsupported-version'
  | 'digest-mismatch'
  | 'wrong-derived-location'
  | 'wrong-type'
  | 'wrong-uid-or-mode'
  | 'unexpected-hard-link'
  | 'foreign-entry'
  | 'incomplete-relationship'
  | 'duplicate-conflicting-identity';

/** WPR-023 closed crash-reappearing temporary categories (16.3/CSA-015). */
export type TemporaryObjectClassification =
  | 'orphan-referencing-published'
  | 'incomplete-unpublished'
  | 'malformed-temporary'
  | 'temporary-other';

/** Closed writer-lock observation vocabulary (LOK-004…008; observation only). */
export type LockObservationKind =
  | 'writer-lock-present'
  | 'writer-lock-foreign'
  | 'writer-lock-malformed'
  // WP-8-J: the recovery-break guard artifact (12.3.1/ADR-033; a leftover
  // guard is a foreign lock object requiring external disposition).
  | 'recovery-break-guard-present'
  | 'recovery-break-guard-malformed';

/** WP-8-J lock-recovery evidence payload facts (store-evidence-record class only). */
export interface LockRecoveryEvidenceFacts {
  /** Exact pre-break lock-record digest (canonical bytes digest). */
  readonly lockRecordDigest?: string;
  /** Deterministic lock-instance identity (non-authoritative; PGAP-STORAGE-WRITER-LOCK-INSTANCE-v1). */
  readonly lockInstanceId?: string;
  readonly outcome?: string;
  /** True when the payload claims break-writer-lock but the facts are incomplete/invalid. */
  readonly malformed: boolean;
}

/** Descriptor facts for one scanned object (never a path). */
export interface ScannedObjectStat {
  readonly fileType: 'regular' | 'directory' | 'symlink' | 'special';
  readonly uid: number;
  readonly mode: number;
  readonly nlink: number;
  readonly size: number;
  readonly dev: number;
  readonly ino: number;
}

/** Envelope facts extracted by the scan (never payload bytes). */
export interface RecordObservationFacts {
  readonly recordId?: string;
  readonly revision?: number;
  readonly createdAt?: string;
  readonly payloadDigest?: string;
  /** Domain-separated digest of the canonical record bytes. */
  readonly recordDigest?: string;
  readonly previousRecordDigest?: string;
  readonly referenceDigests?: readonly string[];
}

/** Audit association facts extracted from the audit payload (D-8 payload shape). */
export interface AuditAssociationFacts {
  readonly eventKind: string;
  readonly primaryRecordId?: string;
  readonly primaryDigest?: string;
}

export interface ScanObservationBase {
  /** Deterministic observation identity: domain digest over kind/location/entry. */
  readonly id: string;
  readonly entry: string;
  /** Closed ERR-STO-* code (Section 18.1). */
  readonly code: string;
  /** Absent only for foreign entries that are never opened. */
  readonly stat?: ScannedObjectStat;
}

export interface RecordScanObservation extends ScanObservationBase {
  readonly kind: 'record';
  readonly recordClass: RecordClassId;
  readonly shard: string;
  readonly classification: RecordCandidateClassification;
  readonly envelope?: RecordObservationFacts;
  /** WP-8-F: quarantine-temporary evidence payload facts (store-evidence-record class only). */
  readonly quarantineEvidenceFacts?: { readonly quarantineId: string; readonly sourceDigest: string; readonly sourceEntry: string };
  /** WP-8-G: audit-reconstruction evidence payload facts (store-evidence-record class only). */
  readonly reconstructionEvidenceFacts?: {
    readonly targetRecordId?: string;
    readonly targetRecordClass?: string;
    readonly targetRecordDigest?: string;
    readonly reconstructionAuditId?: string;
    readonly outcome?: string;
    /** True when the payload claims audit-reconstruction but the facts are incomplete/invalid. */
    readonly malformed: boolean;
  };
  /** WP-8-I: disposition evidence payload facts (store-evidence-record class only). */
  readonly dispositionEvidenceFacts?: {
    readonly recoveryOperation?: string;
    readonly targetEntry?: string;
    readonly targetShard?: string;
    readonly targetIndexId?: string;
    readonly targetDigest?: string;
    readonly observationId?: string;
    readonly outcome?: string;
    /** True when the payload claims an executable disposition operation but the facts are incomplete/invalid. */
    readonly malformed: boolean;
  };
  /** WP-8-J: lock-recovery evidence payload facts (store-evidence-record class only). */
  readonly lockRecoveryEvidenceFacts?: {
    readonly lockRecordDigest?: string;
    readonly lockInstanceId?: string;
    readonly outcome?: string;
    /** True when the payload claims break-writer-lock but the facts are incomplete/invalid. */
    readonly malformed: boolean;
  };
  /** WP-8-M: configuration-recovery evidence payload facts (§16.7/ADR-036). */
  readonly configurationRecoveryEvidenceFacts?: {
    readonly configurationIdentity?: string;
    readonly configurationVersion?: string;
    readonly configurationDigest?: string;
    readonly trustedInputIdentity?: string;
    readonly outcome?: string;
    /** True when the payload claims recover-configuration-namespace but the facts are incomplete/invalid. */
    readonly malformed: boolean;
  };
  /** WP-8-L: retention deletion evidence payload facts (§15.4/ADR-035). */
  readonly retentionEvidenceFacts?: {
    /** Discriminator: durable deletion intent (no outcome) vs deletion completion (outcome + exact intent binding). */
    readonly kind?: 'intent' | 'completion';
    readonly retentionOperation?: 'retention-delete-record' | 'retention-delete-audit';
    readonly targetRecordClass?: string;
    readonly targetRecordId?: string;
    readonly targetRecordRevision?: number;
    readonly targetRecordDigest?: string;
    readonly referencedRecordId?: string;
    readonly referencedRecordDigest?: string;
    /** Audit flow only: the exact primary-deletion completion evidence the audit deletion is bound to. */
    readonly primaryDeletionCompletionEvidenceId?: string;
    /** Completion only: the exact durable intent evidence identity this completion binds. */
    readonly intentEvidenceId?: string;
    /** Completion only: canonical bytes digest of the bound durable intent evidence. */
    readonly intentEvidenceDigest?: string;
    readonly holdStateGeneration?: string;
    /** Record flow only: the history-binding digest the intent/completion was adjudicated against. */
    readonly historyDigest?: string;
    /** Completion only: closed completion outcome (`deleted` | `already-completed`). */
    readonly outcome?: string;
    /** True when the payload claims a retention operation but the facts are incomplete/invalid. */
    readonly malformed: boolean;
  };
}

export interface AuditScanObservation extends ScanObservationBase {
  readonly kind: 'audit-event';
  readonly recordClass: 'authoritative-audit-event';
  readonly shard: string;
  readonly classification: RecordCandidateClassification;
  readonly envelope?: RecordObservationFacts;
  readonly auditAssociation?: AuditAssociationFacts;
}

export interface TemporaryScanObservation extends ScanObservationBase {
  readonly kind: 'temporary-object';
  readonly classification: TemporaryObjectClassification;
  readonly envelope?: RecordObservationFacts;
  /** Deterministic digest of the raw temporary bytes (record-bytes digest domain; WP-8-F evidence binding). */
  readonly contentDigest?: string;
  /** True when the temporary name and a verified published record share one inode (WPR-023 (a)). */
  readonly sharesInodeWithPublished: boolean;
  /** WP-8-H: true when the temporary bytes parse as a canonical registry-index envelope. */
  readonly indexContent?: boolean;
}

export interface LockScanObservation extends ScanObservationBase {
  readonly kind: 'lock-object';
  readonly classification: LockObservationKind;
  readonly lock?: LockFacts;
  /** WP-8-J: canonical lock-record bytes digest (writer-lock-present; non-secret instance binding). */
  readonly lockRecordDigest?: string;
  /** WP-8-J: deterministic lock-instance identity (PGAP-STORAGE-WRITER-LOCK-INSTANCE-v1; non-authoritative). */
  readonly lockInstanceId?: string;
}

export interface ForeignScanObservation extends ScanObservationBase {
  readonly kind: 'foreign-object';
  readonly recordClass?: RecordClassId;
  /** WP-8-H: shard location when the foreign entry sits inside a valid shard (additive). */
  readonly shard?: string;
  /** WP-8-H: parent surface for parent-level foreign entries (additive; observation-id derivation). */
  readonly surface?: 'records' | 'audit';
  readonly classification: 'foreign-entry';
}

/** Closed quarantine-object classification vocabulary (WP-8-F; §16.5). */
export type QuarantineObjectClassification =
  | 'quarantined-valid'
  | 'quarantined-missing-evidence'
  | 'quarantine-interrupted-link'
  | 'quarantine-conflict'
  | 'quarantine-malformed'
  | 'foreign-entry'
  | 'wrong-type'
  | 'wrong-uid-or-mode'
  | 'unexpected-hard-link';

export interface QuarantineScanObservation extends ScanObservationBase {
  readonly kind: 'quarantine-object';
  /** 4-hex quarantine shard (empty for malformed/foreign entries). */
  readonly shard: string;
  readonly classification: QuarantineObjectClassification;
  /** Quarantine-ID filename stem when the name grammar holds. */
  readonly quarantineId?: string;
  /** Source temporary entry designation (from matching evidence; interrupted-link/conflict states). */
  readonly sourceEntry?: string;
  readonly contentDigest?: string;
  readonly envelope?: RecordObservationFacts;
  /** True when a tmp/ object shares the quarantine inode (interrupted link). */
  readonly sharesInodeWithTemporary?: boolean;
}

/** Closed index-artifact classification vocabulary (WP-8-H; §11). */
export type IndexObjectClassification =
  | 'index-current-valid'
  | 'index-stale'
  | 'index-malformed'
  | 'index-unsupported-version'
  | 'index-conflicting'
  | 'index-wrong-type'
  | 'index-wrong-uid-or-mode'
  | 'foreign-entry';

/** One scanned registry-index artifact (WP-8-H; recovery mode; §11). */
export interface IndexScanObservation extends ScanObservationBase {
  readonly kind: 'index-object';
  /** 4-hex index shard (empty for malformed/foreign entries). */
  readonly shard: string;
  readonly classification: IndexObjectClassification;
  /** Index-identity filename stem when the name grammar holds. */
  readonly indexId?: string;
  /** Parsed model version (present when the canonical form parses). */
  readonly modelVersion?: string;
  /** Parsed binding facts (present when the canonical form parses). */
  readonly binding?: {
    readonly generation: string;
    readonly surfaceGeneration: string;
    readonly recordRoot: string;
    readonly auditRoot: string;
  };
  /** Deterministic stale-reason designation (e.g. `stale-generation`). */
  readonly staleReason?: string;
}

export type ScanObservation =
  | RecordScanObservation
  | AuditScanObservation
  | TemporaryScanObservation
  | LockScanObservation
  | ForeignScanObservation
  | QuarantineScanObservation
  | IndexScanObservation;

/** Stored lock-record facts observable without disclosure (no nonce; 18.3/ERM-004). */
export interface LockFacts {
  readonly lockVersion?: string;
  readonly storeInstanceMatches: boolean;
  readonly actionIdentityDigestPresent: boolean;
  readonly pid?: number;
  readonly processStartTime?: number;
  readonly acquisitionTime?: number;
  readonly maxAgeMs?: number;
  readonly bootIdentityPresent: boolean;
}

/** Scan mode vocabulary (F2: the generation token binds the mode). */
export type ScanMode = 'registry' | 'recovery';

/**
 * Deterministic scan continuation cursor (records/audit surface only). The
 * request `generation` binds store identity, namespace identity, effective
 * entry/byte limits, scan mode, fail-closed behavior, and the class-order
 * model version; the `surfaceGeneration` binds the cross-page structural
 * snapshot — `records/` and `audit/` parent presence and identity, the
 * expected record-class presence set, `audit-event` presence, and the
 * identities of every present class directory (F3-G). A cursor is rejected
 * unless its request generation equals the current request's computed
 * generation (ERR-STO-REQ-INVALID; F2) and its surface generation equals
 * the re-read structural snapshot (ERR-STO-ROOT-IDENTITY-CHANGED; F3-G).
 * Plain deterministic data with no authority semantics; never carries a
 * raw store identity, device, or inode value.
 */
export interface ScanCursor {
  /** Deterministic request-compatibility generation digest (F2). */
  readonly generation: string;
  /** Deterministic cross-page structural snapshot digest (F3-G). */
  readonly surfaceGeneration: string;
  readonly recordClass: RecordClassId;
  readonly shard: string;
  readonly entry: string;
}

/** Scan bounds (contract 19.1 totalScanEntries/totalScanBytes/recoveryScanEntries; LMT-006/010). */
export interface ScanBounds {
  /** Scan mode; the generation token binds it (F2). */
  readonly mode: ScanMode;
  readonly entryLimit: number;
  readonly byteLimit: number;
  /** True for recovery scans: over-limit fails closed instead of truncating (recoveryScanEntries row). */
  readonly failClosed: boolean;
  /** WP-8-H: per-index-file read bound (profile `indexBytes`); present only for scans that classify index artifacts. */
  readonly indexByteLimit?: number;
}

/** Immutable facts of the scanned snapshot the derived view is valid for (RGY-005). */
export interface ScanFacts {
  /** Deterministic generation token: domain digest over store identity + bounds. */
  readonly generation: string;
  /** Deterministic cross-page surface-structure token (F3-G; binds parent structure and class identities). */
  readonly surfaceGeneration: string;
  readonly scannedEntries: number;
  readonly scannedBytes: number;
  readonly truncated: boolean;
  readonly failClosed: boolean;
}

/** One verified primary record in a derived view. */
export interface VerifiedRecordView {
  readonly observationId: string;
  readonly shard: string;
  readonly entry: string;
  readonly recordId: string;
  readonly recordClass: RecordClassId;
  readonly revision: number;
  readonly createdAt: string;
  readonly payloadDigest: string;
  readonly recordDigest: string;
  readonly previousRecordDigest?: string;
}

/** One verified audit event in a derived view. */
export interface AuditEventView {
  readonly observationId: string;
  readonly eventId: string;
  readonly eventKind: string;
  readonly createdAt: string;
  readonly recordDigest: string;
  readonly primaryRecordId?: string;
  readonly primaryDigest?: string;
  readonly associated: boolean;
}

export interface DuplicateConflictFinding {
  readonly identity: string;
  readonly kind: 'duplicate-identity' | 'conflict-revision';
  readonly code: string;
  readonly observationIds: readonly string[];
}

export interface MissingAuditFinding {
  readonly observationId: string;
  readonly recordId: string;
  readonly recordClass: RecordClassId;
  readonly recordDigest: string;
}

export interface DanglingAuditFinding {
  readonly observationId: string;
  readonly eventId: string;
  readonly eventKind: string;
  readonly primaryRecordId?: string;
  readonly primaryDigest?: string;
  readonly code: string;
}

/** Deterministic in-memory registry view over one scanned snapshot (RGY-001…010). */
export interface RegistryView {
  readonly source: ScanFacts;
  /** Verified records grouped by class (taxonomy order); entries sorted by (shard, entry). */
  readonly recordsByClass: Readonly<Record<string, readonly VerifiedRecordView[]>>;
  /** Verified records grouped by logical identity; each group sorted by (revision, record digest). */
  readonly recordsByIdentity: Readonly<Record<string, readonly VerifiedRecordView[]>>;
  /** Highest revision per identity whose record is verified and chain-resolved (mechanical; RGY-002). */
  readonly latestResolvableRevision: Readonly<Record<string, VerifiedRecordView>>;
  readonly duplicateConflicts: readonly DuplicateConflictFinding[];
  /** Verified audit events grouped by referenced primary identity; sorted by (createdAt, event id). */
  readonly auditByPrimary: Readonly<Record<string, readonly AuditEventView[]>>;
  readonly missingAudit: readonly MissingAuditFinding[];
  readonly danglingAudit: readonly DanglingAuditFinding[];
  readonly findings: readonly StorageFinding[];
}

/** WPR-023 orphan temporary observation (CSA-010/015; observation only). */
export interface OrphanTemporaryFinding {
  readonly observationId: string;
  readonly entry: string;
  readonly classification: TemporaryObjectClassification;
  readonly recordId?: string;
  readonly recordDigest?: string;
  /** Deterministic digest of the raw temporary bytes (WP-8-F quarantine source binding). */
  readonly contentDigest?: string;
  readonly sharesInodeWithPublished: boolean;
}

/** Persistent writer-lock observation (LOK-004…008; liveness is never assumed; WP-8-J: adjudication is external). */
export interface LockObservationFinding {
  readonly observationId: string;
  readonly classification: LockObservationKind;
  readonly parseable: boolean;
  readonly storeInstanceMatches?: boolean;
  readonly pid?: number;
  readonly processStartTime?: number;
  readonly acquisitionTime?: number;
  readonly maxAgeMs?: number;
  readonly bootIdentityPresent: boolean;
  /** WP-8-J: canonical lock-record bytes digest (writer-lock-present only; non-secret instance binding). */
  readonly lockRecordDigest?: string;
  /** WP-8-J: deterministic lock-instance identity (non-authoritative). */
  readonly lockInstanceId?: string;
}

export interface IncompletePublicationFinding {
  readonly kind: 'missing-audit' | 'dangling-audit' | 'orphan-temporary';
  readonly recordId?: string;
  readonly recordClass?: RecordClassId;
  readonly eventId?: string;
  readonly observationId: string;
  readonly code: string;
}

export interface ObjectFinding {
  readonly observationId: string;
  readonly classification: string;
  readonly code: string;
  /** Envelope identity when the object carried one (never a path). */
  readonly recordId?: string;
}

export interface DispositionFinding extends ObjectFinding {
  readonly reason: string;
}

export interface ReconstructionCandidateFinding {
  readonly recordId: string;
  readonly recordClass: RecordClassId;
  readonly recordDigest: string;
  readonly observationId: string;
  readonly reason: string;
}

/** WP-8-G: one deterministic reconstruction-state classification (16.3; §11). */
/** WP-8-I: one deterministic disposition-state classification (ADR-032; §10). */
export interface DispositionStateFinding {
  /** Logical target designation (quarantine entry or index artifact identity). */
  readonly targetDesignation: string;
  readonly state:
    /** Disposition evidence durable and the referenced target is absent from the current surface. */
    | 'completed-disposition'
    /** Disposition evidence durable but the referenced target is still present (evidence-with-live-target integrity inconsistency). */
    | 'conflicting-disposition-evidence'
    /** Disposition evidence whose payload facts are incomplete or outside the closed vocabulary. */
    | 'dangling-disposition-evidence';
  readonly evidenceObservationId: string;
  readonly recoveryOperation: string;
  readonly reason: string;
}

export interface ReconstructionStateFinding {
  /** Target record identity (the durable primary the state refers to). */
  readonly recordId: string;
  readonly recordClass: RecordClassId;
  readonly recordDigest: string;
  readonly state:
    /** Exact reconstruction audit durable but its recovery evidence missing (roll-forward state). */
    | 'audit-without-evidence'
    /** Exact reconstruction audit plus matching recovery evidence (complete). */
    | 'complete'
    /** Recovery evidence present but no exact reconstruction audit (integrity failure; never republish from evidence alone). */
    | 'evidence-without-audit'
    /** Reconstruction-kind audit referencing a wrong digest or an absent target. */
    | 'conflicting-audit'
    /** More than one reconstruction-kind audit for the same target. */
    | 'duplicate-audit'
    /** Evidence record claims audit-reconstruction with incomplete or invalid facts. */
    | 'malformed-evidence'
    /** Evidence references a target that is not verified present with the bound digest. */
    | 'dangling-evidence';
  readonly auditEventIds: readonly string[];
  readonly evidenceObservationId?: string;
  readonly reason: string;
}

/** WP-8-J: one deterministic lock-recovery state classification (12.3.1/ADR-033). */
export interface LockRecoveryStateFinding {
  /** Deterministic lock-instance identity referenced by the evidence (empty when malformed). */
  readonly lockInstanceId: string;
  /** Exact pre-break lock-record digest referenced by the evidence (empty when malformed). */
  readonly lockRecordDigest: string;
  readonly state:
    /** Lock-recovery evidence durable and the exact referenced writer lock is absent. */
    | 'completed-lock-recovery'
    /** Lock-recovery evidence durable while the exact referenced writer lock is still present (integrity inconsistency). */
    | 'conflicting-lock-recovery-evidence'
    /** Lock-recovery evidence references a different lock instance than the current writer lock. */
    | 'evidence-with-different-lock'
    /** Lock-recovery evidence payload is incomplete or outside the closed vocabulary. */
    | 'dangling-lock-recovery-evidence';
  readonly evidenceObservationId: string;
  readonly reason: string;
}

/** WP-8-L: one deterministic retention-deletion state classification (§15.4/ADR-035). */
export interface RetentionEvidenceStateFinding {
  /** Exact target record identity referenced by the retention evidence. */
  readonly targetRecordId: string;
  readonly retentionOperation: 'retention-delete-record' | 'retention-delete-audit';
  readonly state:
    /** Matching durable deletion intent + completion and the target is absent (the deletion is completed). */
    | 'completed'
    /** Durable deletion completion exists but the exact target is still present (integrity inconsistency). */
    | 'evidence-with-live-target'
    /** Durable deletion intent exists, the target is present, no completion (pre-unlink or crashed in-flight state). */
    | 'intent-pending'
    /** Durable deletion intent exists, the target is absent, no completion (safe completion roll-forward state). */
    | 'roll-forward-eligible'
    /** Multiple distinct retention intents/completions contest the same target (fail closed). */
    | 'conflicting'
    /** Retention evidence payload is incomplete or outside the closed vocabulary. */
    | 'dangling-evidence';
  readonly evidenceObservationIds: readonly string[];
  readonly reason: string;
}

/** WP-8-L: one intentionally retained audit event of a retention-deleted primary (§15.4; scanner distinction). */
export interface RetentionSurvivorFinding {
  /** Surviving audit event identity. */
  readonly eventId: string;
  /** Referenced (deleted) primary record identity. */
  readonly primaryRecordId: string;
  readonly primaryRecordDigest: string;
  /** Deterministic retention deletion completion evidence that explains the orphaned state. */
  readonly completionEvidenceId: string;
  readonly reason: string;
}

/** Bounded recovery assessment over one scanned snapshot (CSA-001…015; observation only). */
export interface RecoveryAssessment {
  readonly source: ScanFacts;
  readonly verifiedDurableRecords: readonly VerifiedRecordView[];
  readonly verifiedAuditEvidence: readonly AuditEventView[];
  readonly orphanTemporaryObjects: readonly OrphanTemporaryFinding[];
  readonly persistentLockObservations: readonly LockObservationFinding[];
  readonly incompletePublicationStates: readonly IncompletePublicationFinding[];
  readonly malformedOrForeignObjects: readonly ObjectFinding[];
  readonly quarantineEligible: readonly ObjectFinding[];
  readonly requiresDisposition: readonly DispositionFinding[];
  readonly reconstructionCandidates: readonly ReconstructionCandidateFinding[];
  /** WP-8-F: scanned quarantine objects (recovery mode only). */
  readonly quarantineObjects: readonly QuarantineScanObservation[];
  /** WP-8-F: quarantine evidence referencing no present quarantine object. */
  readonly danglingQuarantineEvidence: readonly { readonly evidenceObservationId: string; readonly quarantineId: string; readonly sourceEntry?: string }[];
  /** WP-8-G: deterministic audit-reconstruction state classifications (16.3; §11). */
  readonly reconstructionStates: readonly ReconstructionStateFinding[];
  /** WP-8-I: deterministic disposition state classifications (ADR-032; §10). */
  readonly dispositionStates: readonly DispositionStateFinding[];
  /** WP-8-H: scanned registry-index artifacts (recovery mode only; §11). */
  readonly indexArtifacts: readonly IndexScanObservation[];
  /** WP-8-H: true when no registry-index family exists (rebuild candidate). */
  readonly indexMissing: boolean;
  /** WP-8-J: deterministic lock-recovery evidence states (12.3.1/ADR-033; §14). */
  readonly lockRecoveryStates: readonly LockRecoveryStateFinding[];
  /** WP-8-L: deterministic retention deletion evidence states (§15.4/ADR-035). */
  readonly retentionEvidenceStates: readonly RetentionEvidenceStateFinding[];
  /** WP-8-L: audit events intentionally retained after a retention deletion (§15.4; never disposition candidates). */
  readonly retentionSurvivors: readonly RetentionSurvivorFinding[];
  /** WP-8-M: deterministic configuration-namespace observation (recovery mode; §16.7/ADR-036). */
  readonly configurationObservation?: ConfigurationNamespaceObservation;
  /** WP-8-M: deterministic configuration-recovery evidence states (§16.7). */
  readonly configurationRecoveryEvidenceStates: readonly ConfigurationRecoveryEvidenceStateFinding[];
  readonly findings: readonly StorageFinding[];
}

/** WP-8-M: one deterministic configuration-recovery evidence state (§16.7). */
export interface ConfigurationRecoveryEvidenceStateFinding {
  readonly evidenceObservationId: string;
  readonly state: ConfigurationRecoveryEvidenceState;
  readonly configurationIdentity: string;
  readonly reason: string;
}

export type RecoveryActionCategory =
  | 'quarantine'
  | 'orphan-removal'
  | 'audit-reconstruction'
  | 'registry-index-rebuild'
  | 'lock-recovery'
  | 'disposition';

export type RecoveryActionSafety = 'safe' | 'unsafe' | 'requires-external-disposition';

/** One advisory recovery-plan action (Section 5 of the WP-8-E scope; never executable data). */
export interface RecoveryPlanAction {
  readonly actionId: string;
  readonly targetLogicalIdentity: string;
  readonly targetKind: 'primary-record' | 'audit-event' | 'temporary-object' | 'lock-object' | 'foreign-object' | 'quarantine-object' | 'index-object';
  readonly category: RecoveryActionCategory;
  readonly observedEvidence: readonly string[];
  readonly reason: string;
  readonly requiredCapability: 'recovery' | 'control-plane';
  readonly requiredOperation:
    | 'quarantine'
    | 'orphan-removal'
    | 'audit-reconstruction'
    | 'registry-index-rebuild'
    | 'lock-recovery'
    | 'break-writer-lock'
    | 'disposition'
    // WP-8-I: exact externally authorized disposition operations (ADR-032; §11).
    | 'dispose-wpr023d-temporary'
    | 'dispose-quarantined-temporary'
    | 'dispose-conflicting-index';
  readonly verifyImmediatelyBeforeMutation: boolean;
  readonly safety: RecoveryActionSafety;
}

/** Structured, deterministic, non-authoritative recovery plan (advisory data only). */
export interface RecoveryPlan {
  readonly advisoryOnly: true;
  readonly source: ScanFacts;
  readonly actions: readonly RecoveryPlanAction[];
  readonly summary: { readonly total: number; readonly safe: number; readonly unsafe: number; readonly requiresExternalDisposition: number };
}

/** Registry-view derivation request (read-only composition boundary; RDS-005). */
export interface RegistryViewRequest {
  /** Genuine WP-6 validated trusted configuration (runtime-branded). */
  readonly trustedConfiguration: unknown;
  /** Genuine branded `TrustedStorageBootstrapInput`. */
  readonly trustedInput: unknown;
  /** Optional continuation from a previous truncated registry scan. */
  readonly continuation?: ScanCursor;
  /** WP-8-H: opt-in persistent-index fast path; falls back to the authoritative scan on any index invalidity. */
  readonly usePersistentIndex?: boolean;
}

export interface RegistryViewResult {
  readonly ok: boolean;
  readonly view?: RegistryView;
  /** Resume cursor when the scan truncated with forward progress (F1-B). */
  readonly continuation?: ScanCursor;
  /** WP-8-H: deterministic index-state classification when the fast path was attempted (e.g. `current-valid`, `missing`, `stale-record-set`). */
  readonly indexState?: string;
  /**
   * Findings. A truncated result WITHOUT a continuation is the detectable
   * no-progress state: the byte profile cannot make progress, and the
   * caller must restart without the cursor with a larger byte limit (the
   * request generation binds byte limits, so a raised limit invalidates the
   * old cursor with ERR-STO-REQ-INVALID anyway).
   */
  readonly findings?: readonly StorageFinding[];
}

/** Recovery-scan request (read-only composition boundary; CSA, LMT-006/010). */
export interface RecoveryScanRequest {
  readonly trustedConfiguration: unknown;
  readonly trustedInput: unknown;
}

export interface RecoveryScanResult {
  readonly ok: boolean;
  readonly assessment?: RecoveryAssessment;
  readonly plan?: RecoveryPlan;
  readonly findings?: readonly StorageFinding[];
}

/** Test-only scan injection hooks (drift/crash determinism; no production use). */
export interface ScanHooks {
  /** Runs after each directory readdir, before the post-snapshot identity check. */
  readonly afterReaddir?: (location: {
    readonly surface: 'records' | 'audit' | 'tmp' | 'locks' | 'quarantine' | 'quarantine-temporary';
    readonly recordClass?: RecordClassId;
    readonly shard?: string;
  }) => void;
}

/** Read-only store scan input (RDS-004/007; LMT-006/010). */
export interface StoreScanInput {
  readonly capability: ReadCapability;
  readonly namespaceRoot: string;
  readonly bounds: ScanBounds;
  readonly continuation?: ScanCursor;
  readonly hooks?: ScanHooks;
}

/** Bounded store-scan result (records/audit, plus tmp/locks in recovery mode). */
export interface StoreScanResult {
  readonly ok: boolean;
  readonly observations: readonly ScanObservation[];
  readonly findings: readonly StorageFinding[];
  readonly scannedEntries: number;
  readonly scannedBytes: number;
  readonly truncated: boolean;
  readonly continuation?: ScanCursor;
  /** Deterministic generation digest of this scan (present on success). */
  readonly generation?: string;
  /** WP-8-M: configuration-namespace observation (recovery mode only; §16.7; advisory). */
  readonly configurationObservation?: ConfigurationNamespaceObservation;
  /** Deterministic cross-page surface-structure token (present on success; F3-G). */
  readonly surfaceGeneration?: string;
}

// ─── WP-8-F: authorized recovery mutation (authority-gated, re-verified) ──
// This slice performs exactly one mutation: safe orphan-temporary cleanup of
// WPR-023 (a) inode twins with durable recovery evidence. Quarantine
// execution requires a contract decision (destination layout undefined; D-7)
// and is rejected fail-closed at the boundary. No raw path, descriptor,
// nonce, callback, capability, or filesystem function is accepted in a
// request; every location is re-derived internally from verified store
// configuration and closed vocabularies.

/** Fixed crash-stage inventory for recovery mutations (asserted in tests). */
export type RecoveryMutationStage =
  | 'before-lock-acquisition'
  | 'after-lock-acquisition'
  | 'after-target-verification'
  | 'before-source-unlink'
  | 'after-source-unlink'
  | 'before-directory-fsync'
  | 'after-directory-fsync'
  | 'before-evidence-publication'
  | 'after-evidence-publication'
  | 'before-lock-release'
  // WP-8-F quarantine-temporary stages.
  | 'after-source-verification'
  | 'after-quarantine-directory-provisioning'
  | 'before-destination-link'
  | 'after-destination-link'
  | 'before-destination-directory-fsync'
  | 'after-destination-directory-fsync'
  | 'before-tmp-directory-fsync'
  | 'after-tmp-directory-fsync'
  // WP-8-G audit-reconstruction stages (fixed inventory; 16.3).
  | 'after-audit-absence-verification'
  | 'before-reconstructed-audit-publication'
  | 'after-reconstructed-audit-publication'
  | 'before-reconstructed-audit-durability-confirmation'
  | 'after-reconstructed-audit-durability-confirmation'
  | 'after-evidence-audit-publication'
  // WP-8-H registry-index-rebuild stages (fixed inventory; §16).
  | 'after-generation-recheck'
  | 'before-index-publication'
  | 'after-index-publication'
  // WP-8-M configuration-namespace recovery stages (fixed inventory; §16.7).
  | 'before-writer-lock'
  | 'after-writer-lock'
  | 'after-current-state-verification'
  | 'before-configuration-publication'
  | 'after-configuration-publication'
  | 'before-configuration-durability-confirmation'
  | 'after-configuration-durability'
  | 'before-writer-lock-release'
  | 'before-directory-durability'
  | 'after-directory-durability'
  // WP-8-I external-disposition adjudication stages (fixed inventory; §11).
  // The foundation performs NO mutation (no contract-defined primitive
  // exists), so the inventory covers authentication, re-verification, and
  // classification only — no mutation/fsync/evidence stages.
  | 'after-classification-recomputation'
  // WP-8-I executable-disposition stages (fixed inventory; §9): the exact
  // unlink-with-evidence sequence for the eligible quarantine and
  // conflicting-index subclasses.
  | 'before-unlink'
  | 'after-unlink'
  // WP-8-J lock-recovery stages (fixed 12-stage inventory; 12.3.1/ADR-033):
  // recovery-break guard acquisition/release, current lock re-verification,
  // digest-bound instance recheck, exact unlink, locks-directory fsync,
  // recovery-evidence publication and durability.
  | 'before-recovery-break-guard'
  | 'after-recovery-break-guard'
  | 'after-lock-target-verification'
  | 'after-lock-instance-recheck'
  | 'before-lock-unlink'
  | 'after-lock-unlink'
  | 'before-locks-directory-fsync'
  | 'after-locks-directory-fsync'
  | 'before-lock-evidence-publication'
  | 'after-lock-evidence-publication'
  | 'after-lock-evidence-audit-publication'
  | 'before-recovery-break-guard-release';

/** Test-only crash/fsync injection hooks (same pattern as `PublicationHooks`). */
export interface RecoveryMutationHooks {
  /** Runs at each fixed stage; throwing simulates a crash at that stage. */
  readonly stage?: (stage: RecoveryMutationStage) => void;
  readonly fsyncFile?: (fd: number) => void;
  readonly fsyncDirectory?: (path: string) => void;
}

/** Narrow structured recovery-mutation action (never a plan action, never a path). */
export interface RecoveryMutationAction {
  /**
   * Closed category vocabulary: exactly the implemented recovery operations;
   * no generic `quarantine` or generic disposition operation exists. The
   * three `dispose-*` categories are the externally authorized disposition
   * vocabulary (WP-8-I): in this slice every execution is the non-mutating
   * adjudication foundation returning `disposition-required` (the contract
   * defines no disposition mutation primitive).
   */
  readonly category:
    | 'orphan-removal'
    | 'quarantine-temporary'
    | 'audit-reconstruction'
    | 'registry-index-rebuild'
    | 'dispose-wpr023d-temporary'
    | 'dispose-quarantined-temporary'
    | 'dispose-conflicting-index'
    | 'break-writer-lock'
    // WP-8-M: the exact configuration-namespace recovery operation (§16.7/
    // ADR-036). No generic configuration write/replace/repair operation
    // exists; recovery requires BOTH genuine recovery authority AND a
    // genuine trusted configuration/bootstrap input.
    | 'recover-configuration-namespace';
  /** Orphan-removal/quarantine-temporary only: deterministic entry designation (temporary name; never a path). */
  readonly targetEntry?: string;
  /** Orphan-removal only: verified durable publication sharing the temporary's inode (WPR-023 (a)). */
  readonly expectedTwinRecordId?: string;
  /** Orphan-removal only: closed-vocabulary class of the durable publication. */
  readonly expectedTwinRecordClass?: RecordClassId;
  /** Orphan-removal only: record-bytes digest of the durable publication (pre-mutation evidence digest). */
  readonly expectedTwinDigest?: string;
  /** Orphan-removal only: link count observed at assessment (exact re-verification requirement). */
  readonly expectedLinkCount?: number;
  /** Evidence identifiers from the recovery assessment (one per mutation; not used by registry-index-rebuild). */
  readonly expectedObservationIds?: readonly string[];
  /** Assessment scan-generation token (recomputed and compared before mutation; not used by registry-index-rebuild). */
  readonly expectedGeneration?: string;
  /** Assessment surface-structure token (recomputed and compared before mutation; not used by registry-index-rebuild). */
  readonly expectedSurfaceGeneration?: string;
  /** Quarantine-temporary only: the assessed WPR-023 classification of the source (b or c). */
  readonly expectedClassification?: 'incomplete-unpublished' | 'malformed-temporary';
  /** Quarantine-temporary only: exact source content digest (the pre-mutation evidence digest). */
  readonly expectedSourceDigest?: string;
  /** Audit-reconstruction only: closed store-records target class (never store-metadata, registry-snapshot, audit, or configuration). */
  readonly targetRecordClass?: RecordClassId;
  /** Audit-reconstruction only: canonical target record identity (`pgw:r:<32-hex>`). */
  readonly targetRecordId?: string;
  /** Audit-reconstruction only: record-bytes digest of the durable target (the pre-reconstruction evidence digest). */
  readonly targetRecordDigest?: string;
  /** Audit-reconstruction only: expected original trusted action identity of the durable record (verified, never substituted into the reconstructed event). */
  readonly expectedOriginalActionIdentity?: string;
  /** Audit-reconstruction only: the assessment's missing-audit finding id (equals the record observation id). */
  readonly expectedMissingAuditFindingId?: string;
  /** Registry-index-rebuild only: registry-mode scan-generation token of the assessment snapshot. */
  readonly expectedRegistryGeneration?: string;
  /** Registry-index-rebuild only: registry-mode surface-structure token of the assessment snapshot. */
  readonly expectedRegistrySurfaceGeneration?: string;
  /** Disposition only: target shard designation (4-hex for shard-level entries; empty for parent-level foreign entries). */
  readonly targetShard?: string;
  /** Disposition only: exact current recovery classification of the target (closed per operation). */
  readonly expectedDispositionClassification?: string;
  /** Disposition only: exact observation code of the target classification. */
  readonly expectedCode?: string;
  /** Disposition only (WPR-023 (d)): exact current entry type (regular | symlink | special | directory). */
  readonly expectedEntryType?: 'regular' | 'symlink' | 'special' | 'directory';
  /** Disposition only (quarantine classes where available): exact content digest of the target object. */
  readonly expectedContentDigest?: string;
  /** Disposition only: the assessment's requires-external-disposition finding id (equals the object observation id). */
  readonly expectedDispositionFindingId?: string;
  /** Break-writer-lock only: canonical lock-record bytes digest of the exact adjudicated lock instance. */
  readonly expectedLockRecordDigest?: string;
  /** Break-writer-lock only: deterministic lock-instance identity of the exact adjudicated lock instance. */
  readonly expectedLockInstanceId?: string;
  /** Break-writer-lock only: deterministic lock observation identity (`writer.lock`; recomputed and compared). */
  readonly expectedLockObservationId?: string;
  /** Recover-configuration-namespace only: expected configuration identity (sha-256 digest syntax). */
  readonly expectedConfigurationIdentity?: string;
  /** Recover-configuration-namespace only: expected configuration version (the trusted configuration's version). */
  readonly expectedConfigurationVersion?: string;
  /** Recover-configuration-namespace only: deterministic trusted-input identity digest (PGAP-STORAGE-TRUSTED-INPUT-IDENTITY-v1). */
  readonly expectedTrustedInputIdentity?: string;
  /** Recover-configuration-namespace only: expected record-byte digest of the canonical configuration metadata derived from trusted input. */
  readonly expectedConfigurationDigest?: string;
  /** Recover-configuration-namespace only: deterministic configuration-namespace observation id of the current state (recomputed and compared). */
  readonly expectedConfigurationObservationId?: string;
}

/** Authorized recovery-mutation request (WP-8-F composition boundary). */
export interface RecoveryMutationRequest {
  /** Genuine WP-6 validated trusted configuration (runtime-branded). */
  readonly trustedConfiguration: unknown;
  /** Genuine branded `StorageRecoveryActionProvenance` (zero production producers). */
  readonly recoveryActionProvenance: unknown;
  /** Correlated raw fields (verified for exact equality against the provenance). */
  readonly locator: string;
  readonly serviceUid: number;
  readonly forbiddenRoots: readonly string[];
  readonly limitProfile: Readonly<Record<string, number>>;
  /** Narrow structured action; no path, descriptor, nonce, callback, or fs function. */
  readonly action: RecoveryMutationAction;
  readonly timeSource: LockTimeSource;
  /** WP-8-H: genuine branded `TrustedStorageBootstrapInput` (required only for `registry-index-rebuild`). */
  readonly trustedInput?: unknown;
  /** Test-only crash/fsync injection. */
  readonly hooks?: RecoveryMutationHooks;
}

/** Recovery-mutation result (advisory data; no capability, path, or nonce). */
export interface RecoveryMutationResult {
  readonly ok: boolean;
  /** `removed` (orphan removed), `quarantined` (temporary quarantined), `reconstructed` (audit reconstructed), `rebuilt` (index published), `disposed` (eligible disposition target unlinked with evidence), `disposition-required` (externally authorized disposition adjudicated; no mutation performed), `lock-broken` (adjudicated writer lock removed with evidence), `already-completed`: no work needed. */
  readonly outcome?: 'removed' | 'quarantined' | 'reconstructed' | 'rebuilt' | 'disposed' | 'disposition-required' | 'lock-broken' | 'already-completed' | 'configuration-recovered' | 'already-present';
  /** Deterministic evidence record identity when evidence is durable. */
  readonly evidenceId?: string;
  /** WP-8-H: deterministic registry-index identity when an index is published/current. */
  readonly indexId?: string;
  readonly findings?: readonly StorageFinding[];
}

// ─── WP-8-L: retention deletion and legal hold (contract §15.4, RNT-011…020; ADR-035) ───

/** Closed legal-hold adjudication vocabulary carried by the trusted retention action (§15.4). */
export type RetentionHoldResult = 'active-hold' | 'unknown-hold-state' | 'stale-hold-decision' | 'clear-current-hold-state';

/** Closed history-status eligibility for retention deletion (only `complete` is eligible in this slice). */
export type RetentionHistoryEligibility = 'complete';

/** Retention evidence outcome vocabulary (the recorded fact, never a decision). */
export type RetentionEvidenceOutcome = 'deleted' | 'already-completed';

/** WP-8-L: narrow structured retention action (never a path, descriptor, nonce, callback, or plan action). */
export interface RetentionMutationAction {
  /** Closed category vocabulary: exactly the implemented retention operations; no generic deletion exists. */
  readonly category: 'retention-delete-record' | 'retention-delete-audit';
  /** Closed retention-deletable target class (record flow: lifecycle fact classes; audit flow: authoritative-audit-event). */
  readonly targetRecordClass: RecordClassId;
  /** Canonical target identity (record flow `pgw:r:<32-hex>`; audit flow `pgw:l:<32-hex>`). */
  readonly targetRecordId: string;
  /** Exact revision of the durable target (verified from the envelope). */
  readonly expectedTargetRevision: number;
  /** Record-bytes digest of the durable target. */
  readonly targetRecordDigest: string;
  /** Retention policy identity adjudicated by the trusted authority (opaque control-plane vocabulary). */
  readonly expectedPolicyIdentity: string;
  /** Retention policy version adjudicated by the trusted authority. */
  readonly expectedPolicyVersion: string;
  /** Exact retention decision identity issued by the trusted authority. */
  readonly expectedDecisionId: string;
  /** Hold-state generation/snapshot the authority adjudicated (PGAP-STORAGE-RETENTION-HOLD-STATE-GENERATION-v1 digest over the current configuration identity/version). */
  readonly expectedHoldStateGeneration: string;
  /** Explicit hold adjudication result from the trusted authority (never a caller boolean). */
  readonly expectedHoldResult: RetentionHoldResult;
  /** Audit-delete only: referenced primary record identity bound by the exact audit event. */
  readonly referencedRecordId?: string;
  /** Audit-delete only: referenced primary record digest bound by the exact audit event. */
  readonly referencedRecordDigest?: string;
  /** Audit-delete only: exact retention-deletable class of the referenced primary record. */
  readonly referencedRecordClass?: RecordClassId;
  /** Audit-delete only: durable retention-delete-record completion evidence identity for the referenced primary. */
  readonly expectedPrimaryDeletionCompletionEvidenceId?: string;
  /** Record-delete only: deterministic history-binding digest over the WP-8-K inspection result (§15.4). */
  readonly expectedHistoryDigest?: string;
  /** Record-delete only: history status observed by the trusted decision (`complete` only; reconstructed gaps fail closed). */
  readonly expectedHistoryStatus?: RetentionHistoryEligibility;
  /** Registry-mode scan-generation token of the decision snapshot (recomputed and compared). */
  readonly expectedGeneration: string;
  /** Registry-mode surface-structure token of the decision snapshot (recomputed and compared). */
  readonly expectedSurfaceGeneration: string;
}

/** WP-8-L: authorized retention-mutation request (composition boundary). */
export interface RetentionMutationRequest {
  /** Genuine WP-6 validated trusted configuration (runtime-branded). */
  readonly trustedConfiguration: unknown;
  /** Genuine branded `StorageRetentionActionProvenance` (zero production producers). */
  readonly retentionActionProvenance: unknown;
  /** Genuine branded `TrustedStorageBootstrapInput` (read-side correlation for history derivation). */
  readonly trustedInput: unknown;
  /** Correlated raw fields (verified for exact equality against the provenance). */
  readonly locator: string;
  readonly serviceUid: number;
  readonly forbiddenRoots: readonly string[];
  readonly limitProfile: Readonly<Record<string, number>>;
  /** Narrow structured action; no path, descriptor, nonce, callback, or fs function. */
  readonly action: RetentionMutationAction;
  readonly timeSource: LockTimeSource;
  /** Test-only crash/fsync injection. */
  readonly hooks?: RetentionMutationHooks;
}

/** WP-8-L: fixed crash-stage vocabulary (asserted in order; §15.4). */
export type RetentionMutationStage =
  | 'before-writer-lock'
  | 'after-writer-lock'
  | 'before-intent-publication'
  | 'after-intent-publication'
  | 'after-intent-audit-publication'
  | 'after-post-intent-revalidation'
  | 'before-target-unlink'
  | 'after-target-unlink'
  | 'before-directory-fsync'
  | 'after-directory-fsync'
  | 'before-completion-publication'
  | 'after-completion-publication'
  | 'after-completion-audit-publication'
  | 'before-writer-lock-release';

export interface RetentionMutationHooks {
  /** Runs at each fixed stage; throwing simulates a crash at that stage. */
  readonly stage?: (stage: RetentionMutationStage) => void;
  readonly fsyncFile?: (fd: number) => void;
  readonly fsyncDirectory?: (path: string) => void;
}

/** WP-8-L: retention-mutation result (pure factual outcomes; no capability, path, or nonce). */
export interface RetentionMutationResult {
  readonly ok: boolean;
  /** `deleted` | `already-completed` (success); `hold-blocked` | `policy-blocked` | `history-incomplete` (factual refusals). */
  readonly outcome?: 'deleted' | 'already-completed' | 'hold-blocked' | 'policy-blocked' | 'history-incomplete';
  /** Deterministic deletion-intent evidence identity when durable. */
  readonly intentEvidenceId?: string;
  /** Deterministic deletion-completion evidence identity when durable. */
  readonly completionEvidenceId?: string;
  readonly findings?: readonly StorageFinding[];
}

// ─── WP-8-M: configuration namespace recovery (contract §16.7, CSA-016…018; ADR-036) ───

/** Closed current-state classification of the configuration-namespace metadata object (§16.7). */
export type ConfigurationMetadataState =
  /** Exact expected canonical configuration metadata is present (healthy; no mutation needed). */
  | 'configuration-healthy'
  /** The expected canonical configuration metadata file is absent (the recoverable state). */
  | 'configuration-missing'
  /** The metadata directory itself is absent (bootstrap action required; not recovery-recoverable). */
  | 'configuration-directory-missing'
  /** Present but not canonical / wrong record kind / duplicate keys (fail closed; external disposition). */
  | 'malformed-configuration'
  /** Present, canonical, supported version, but bytes differ from the expected canonical configuration (fail closed; external disposition). */
  | 'conflicting-configuration'
  /** Present, canonical, but a recognized configuration version outside the supported set (fail closed; migration boundary). */
  | 'unsupported-configuration-version'
  /** Present but not a regular file (symlink, directory, special) (fail closed; external disposition). */
  | 'wrong-type-configuration'
  /** Present regular file with wrong UID or mode (never repaired; external disposition). */
  | 'wrong-uid-mode-configuration'
  /** Present bytes are a provable strict prefix of the expected canonical configuration (interrupted publication; external disposition — never overwritten). */
  | 'interrupted-configuration-publication'
  /** Foreign entries in the configuration metadata directory (fail closed; external disposition). */
  | 'foreign-configuration-entry'
  /** Older supported configuration version requiring transformation (migration-required; zero migration in this slice). */
  | 'migration-required';

/** Configuration-recovery evidence state classification (ADR-036 §10; scanner). */
export type ConfigurationRecoveryEvidenceState =
  /** Matching durable configuration-recovery evidence; configuration state consistent with the evidence outcome. */
  | 'completed-configuration-recovery'
  /** Configuration-recovery evidence durable but the configuration object is missing (integrity failure). */
  | 'evidence-without-configuration'
  /** Configuration-recovery evidence durable while a conflicting configuration object is present. */
  | 'conflicting-configuration-recovery-evidence'
  /** Configuration-recovery evidence payload is incomplete or outside the closed vocabulary. */
  | 'dangling-configuration-recovery-evidence';

/** WP-8-M: deterministic configuration-namespace scan observation (advisory; never authority). */
export interface ConfigurationNamespaceObservation {
  /** Deterministic observation id (PGAP-STORAGE-CONFIGURATION-OBSERVATION-v1; binds store, state, entry). */
  readonly id: string;
  readonly state: ConfigurationMetadataState;
  /** Declared configuration identity from a self-consistent stored metadata object (fact, never authority). */
  readonly declaredConfigurationIdentity?: string;
  /** Declared metadata format version (fact). */
  readonly declaredMetadataVersion?: string;
  /** Record-byte digest of a self-consistent stored metadata object (fact). */
  readonly metadataDigest?: string;
  /** Foreign entry designations in the metadata directory (layout components). */
  readonly foreignEntries?: readonly string[];
  readonly reason: string;
}

/** WP-8-M: configuration-recovery evidence payload facts (scan; records/evidence/ observations). */
export interface ConfigurationRecoveryEvidenceFacts {
  readonly configurationIdentity?: string;
  readonly configurationVersion?: string;
  readonly configurationDigest?: string;
  readonly trustedInputIdentity?: string;
  readonly outcome?: string;
  /** True when the payload claims recover-configuration-namespace but the facts are incomplete/invalid. */
  readonly malformed: boolean;
}
