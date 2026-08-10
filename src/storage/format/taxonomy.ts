/**
 * WP-8 record taxonomy (contract 6.2; TAX-001…014).
 *
 * Represents the closed 19-class taxonomy with namespace, envelope profile,
 * fixed suffix or layout class, semantic-owner, producer, and
 * lifecycle-effect attributes. Representation never creates decision
 * authority (TAU-010, TAX-002).
 */
import {
  type NamespaceKind,
  type RecordClassId,
  RECORD_CLASS_IDS,
  STORE_EVIDENCE_KINDS,
  type StoreEvidenceKind,
} from '../types.js';

/** Record-format profile accepted for a class. */
export type EnvelopeProfile = 'lifecycle-record' | 'registry-snapshot' | 'store-metadata' | 'store-evidence' | 'configuration-snapshot';

/**
 * Whether WP-8 may produce the persisted form (ADR-029 D-6; M-3 canonical
 * array rules). `'write-audit'` is the mechanical authorized-write evidence
 * production by the write substrate (WPR-010/AUD-003); `'reconstruction-only'`
 * remains the phase-4 recovery path (CSA-013/16.3). Arrays are immutable,
 * never empty, contain no duplicates, and use the exact declared order; no
 * runtime sorting or normalization is permitted.
 */
export type Wp8Production = 'no' | 'initialization' | 'maintenance' | 'reconstruction-only' | 'write-audit';

export interface RecordClassProfile {
  readonly id: RecordClassId;
  /** PascalCase contract label (contract 6.2). */
  readonly label: string;
  readonly namespace: NamespaceKind;
  /** Layout parent segment (LAY-005); `approval` per Appendix H vector. */
  readonly segment: string;
  /** Fixed filename suffix (LAY 5.3): `.rec` records, `.aud` audit events. */
  readonly suffix: '.rec' | '.aud';
  readonly profile: EnvelopeProfile;
  readonly semanticOwner: string;
  readonly producer: string;
  /** Canonical production array (M-3): one exact member per class except the audit class. */
  readonly wp8Production: readonly Wp8Production[];
  /** WP-8's stored form never affects lifecycle state (TAU-008/010). */
  readonly lifecycleEffect: 'none';
  /** Retained per RNT-002 in the MVP. */
  readonly retentionClass: 'indefinite';
}

const BASE: Omit<RecordClassProfile, 'id' | 'label' | 'segment' | 'producer'> = {
  namespace: 'store-records',
  suffix: '.rec',
  profile: 'lifecycle-record',
  semanticOwner: 'WP-2 / WP-12',
  wp8Production: ['no'],
  lifecycleEffect: 'none',
  retentionClass: 'indefinite',
};

/** The closed 19-class taxonomy table (contract 6.2). */
export const RECORD_CLASS_PROFILES: readonly RecordClassProfile[] = [
  { ...BASE, id: 'validation-record', label: 'ValidationRecord', segment: 'validation', producer: 'trusted validator' },
  { ...BASE, id: 'approval-record', label: 'ApprovalRecord', segment: 'approval', producer: 'trusted approver' },
  { ...BASE, id: 'issuance-record', label: 'IssuanceRecord', segment: 'issuance', producer: 'trusted issuer' },
  { ...BASE, id: 'revocation-record', label: 'RevocationRecord', segment: 'revocation', producer: 'trusted revocation authority' },
  { ...BASE, id: 'runtime-grant', label: 'RuntimeGrant', segment: 'runtime-grant', producer: 'trusted grant authority' },
  { ...BASE, id: 'activation-record', label: 'ActivationRecord', segment: 'activation', producer: 'trusted activation authority' },
  { ...BASE, id: 'execution-occurrence-record', label: 'ExecutionOccurrenceRecord', segment: 'execution-occurrence', producer: 'trusted control plane' },
  { ...BASE, id: 'execution-attempt-record', label: 'ExecutionAttemptRecord', segment: 'execution-attempt', producer: 'trusted execution recorder' },
  { ...BASE, id: 'execution-outcome-record', label: 'ExecutionOutcomeRecord', segment: 'execution-outcome', producer: 'trusted execution outcome recorder' },
  { ...BASE, id: 'trusted-receipt', label: 'TrustedReceipt', segment: 'trusted-receipt', producer: 'trusted receipt producer' },
  { ...BASE, id: 'result-publication-record', label: 'ResultPublicationRecord', segment: 'result-publication', producer: 'trusted result publisher' },
  { ...BASE, id: 'supersession-record', label: 'SupersessionRecord', segment: 'supersession', producer: 'trusted lifecycle authority' },
  { ...BASE, id: 'execution-summary-record', label: 'ExecutionSummaryRecord', segment: 'execution-summary', producer: 'trusted reporting authority' },
  { ...BASE, id: 'migration-record', label: 'MigrationRecord', segment: 'migration', producer: 'trusted migration authority' },
  {
    ...BASE,
    id: 'authoritative-audit-event',
    label: 'AuthoritativeAuditEvent',
    segment: 'audit-event',
    suffix: '.aud',
    semanticOwner: 'WP-2 / WP-12',
    producer: 'trusted control plane',
    // D-6: mechanical write-audit evidence production joins the phase-4
    // reconstruction path; the only two-member production array (M-3).
    wp8Production: ['reconstruction-only', 'write-audit'],
  },
  {
    ...BASE,
    id: 'registry-snapshot',
    label: 'RegistrySnapshot (accepted)',
    segment: 'registry-snapshot',
    semanticOwner: 'WP-2',
    producer: 'control plane',
  },
  {
    ...BASE,
    id: 'store-metadata',
    label: 'Store metadata',
    segment: 'store-metadata',
    profile: 'store-metadata',
    semanticOwner: 'WP-8',
    producer: 'store initialization',
    wp8Production: ['initialization'],
  },
  {
    ...BASE,
    id: 'store-evidence-record',
    label: 'StoreEvidenceRecord',
    segment: 'evidence',
    profile: 'store-evidence',
    semanticOwner: 'WP-8',
    producer: 'store maintenance',
    wp8Production: ['maintenance'],
  },
  {
    ...BASE,
    id: 'configuration-snapshot-record',
    label: 'ConfigurationSnapshotRecord',
    segment: 'configuration-snapshot',
    namespace: 'configuration',
    profile: 'configuration-snapshot',
    semanticOwner: 'WP-8 (store class, configuration namespace)',
    producer: 'trusted control plane (semantic producer)',
    wp8Production: ['no'],
  },
];

export const RECORD_CLASS_BY_ID: ReadonlyMap<RecordClassId, RecordClassProfile> = new Map(
  RECORD_CLASS_PROFILES.map((p) => [p.id, p]),
);

/** Closed evidence-kind set for `StoreEvidenceRecord` (TAX-013). */
export const STORE_EVIDENCE_KIND_SET: readonly StoreEvidenceKind[] = [...STORE_EVIDENCE_KINDS];

export function recordClassProfile(id: string): RecordClassProfile | undefined {
  return RECORD_CLASS_BY_ID.get(id as RecordClassId);
}

/** True only for the 19 accepted class identifiers (TAX-010 unknown → fail closed). */
export function isAcceptedRecordClass(id: string): id is RecordClassId {
  return (RECORD_CLASS_IDS as readonly string[]).includes(id);
}
