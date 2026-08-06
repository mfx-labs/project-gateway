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
