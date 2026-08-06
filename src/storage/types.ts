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
