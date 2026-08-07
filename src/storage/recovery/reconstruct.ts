/**
 * WP-8-G authorized audit reconstruction (contract 16.3, W8A-C11; AUD-011/
 * 012; CSA-013/014): the `audit-reconstruction` recovery operation.
 * FILESYSTEM-FREE at module scope: this module derives the exact
 * `recovery-audit-reconstruction` audit event mechanically from durable
 * target-record facts (identity, class, revision, digest) plus the trusted
 * RECOVERY action identity and the recovery time, constructs the
 * deterministic `StoreEvidenceRecord` reconstruction evidence and its
 * mechanical `authorized-write` audit event purely, and delegates every
 * filesystem mutation to the exact publication substrate
 * (`publication/publish-record.ts`) and the recovery evidence builder
 * (`recovery/evidence.ts`) under exact-record permits. No direct
 * filesystem API import exists here.
 *
 * Contract model (16.3): the reconstructed event is the DISTINCT
 * `recovery-audit-reconstruction` kind with the trusted recovery action
 * identity, the recovery time, an explicit gap marker naming the missing
 * original `authorized-write` event, and a digest-bound reference to the
 * target record. The event NEVER pretends the original operation emitted
 * it (AUD-012); the original trusted action identity is a verified
 * durable-record fact recorded in the reconstruction evidence, never
 * substituted into the reconstructed event.
 *
 * Idempotency model (WP-8-G §9): the audit event identity is
 * time-independent (D-8 tuple); the recovery-time bytes are creation
 * evidence. Roll-forward and already-completed matching is by payload
 * facts (event kind, target identity/digest, gap marker) and evidence
 * facts — never by byte digest alone — so an interrupted or repeated run
 * resolves deterministically. Conflicting audits, contesting duplicates,
 * evidence-without-audit, and audit-without-evidence states fail closed;
 * no repair-by-guessing.
 */
import { buildRecoveryAuditReconstructionEvent, RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND, type AuditEventBuildResult } from '../audit/write-audit.js';
import { buildAuthorizedWriteAuditEvent } from '../audit/write-audit.js';
import { canonicalEnvelopeBytes, computeDomainDigest, computePayloadDigest, isValidDigestSyntax, parsePersistedEnvelope } from '../format/envelope.js';
import { deriveRecordRelativePath } from '../layout/layout.js';
import { RECORD_CLASS_BY_ID } from '../format/taxonomy.js';
import { verifyObjectBytesAt, publishRecoveryBoundRecord } from '../publication/publish-record.js';
import { isGenuineRecoveryCapability, createRecoveryPublicationPermit, type RecoveryCapability } from '../capabilities/authenticity.js';
import { publishRecoveryEvidence, type RecoveryEvidenceBuild } from './evidence.js';
import type { PublicationHooks, RecordClassId, VerifiedStoreInstance } from '../types.js';

/** Domain-separated audit-reconstruction evidence identity domain (WP-8-G §8). */
export const STORAGE_AUDIT_RECONSTRUCTION_EVIDENCE_IDENTITY_DOMAIN = 'PGAP-STORAGE-AUDIT-RECONSTRUCTION-EVIDENCE-v1\u0000';

/** Closed reconstruction-evidence outcome vocabulary (the fact recorded, never a decision). */
export type AuditReconstructionOutcome = 'reconstructed' | 'already-completed';

/** Eligible reconstruction target classes: store-records `.rec` classes with the
 * mechanical audit relationship (WPR-010/AUD-003), excluding bootstrap metadata,
 * registry/index snapshots, and the audit class itself (WP-8-G §2). */
export function isReconstructionTargetClass(recordClass: RecordClassId): boolean {
  const profile = RECORD_CLASS_BY_ID.get(recordClass);
  return (
    profile !== undefined &&
    profile.namespace === 'store-records' &&
    profile.suffix === '.rec' &&
    profile.id !== 'store-metadata' &&
    profile.id !== 'registry-snapshot'
  );
}

export interface AuditReconstructionEvidenceInput {
  readonly storeInstance: VerifiedStoreInstance;
  /** Trusted RECOVERY action identity (from the genuine provenance; never the original write action). */
  readonly actionIdentity: string;
  readonly evidenceKind: 'recovery-evidence';
  readonly recoveryOperation: 'audit-reconstruction';
  readonly targetRecordClass: RecordClassId;
  readonly targetRecordId: string;
  /** Record-bytes digest of the durable target (the pre-reconstruction evidence digest). */
  readonly targetRecordDigest: string;
  /** Original trusted action identity verified from the durable target envelope (a fact; never substituted into the event). */
  readonly originalActionIdentity: string;
  /** Identity of the reconstructed audit event (derived or durable; time-independent). */
  readonly reconstructionAuditId: string;
  /** Digest of the reconstructed audit event bytes as derived/durable at execution time (payload-only binding). */
  readonly reconstructionAuditDigest: string;
  /** The assessment's missing-audit finding id (the target record observation id). */
  readonly missingAuditObservationId: string;
  /** Assessment scan-generation and surface-structure tokens (recomputed at the boundary). */
  readonly generation: string;
  readonly surfaceGeneration: string;
  readonly outcome: AuditReconstructionOutcome;
  /** Recovery time (creation evidence; never the original operation time). */
  readonly createdAt: string;
}

/**
 * Deterministic reconstruction-evidence identity (WP-8-G §8): domain digest
 * over the factual tuple — store/namespace identity, evidence kind,
 * recovery operation, target class/id/digest, original action identity,
 * reconstructed audit identity, missing-audit finding id, and outcome. No
 * clock, nonce, recovery action identity, path, or byte digest enters it,
 * so identical facts yield identical identities and replay is idempotent.
 */
export function computeAuditReconstructionEvidenceIdentity(input: {
  readonly storeInstance: VerifiedStoreInstance;
  readonly targetRecordClass: RecordClassId;
  readonly targetRecordId: string;
  readonly targetRecordDigest: string;
  readonly originalActionIdentity: string;
  readonly reconstructionAuditId: string;
  readonly missingAuditObservationId: string;
  readonly outcome: AuditReconstructionOutcome;
}): string {
  const tuple = {
    storeInstance: input.storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
    evidenceKind: 'recovery-evidence',
    recoveryOperation: 'audit-reconstruction',
    targetRecordClass: input.targetRecordClass,
    targetRecordId: input.targetRecordId,
    targetRecordDigest: input.targetRecordDigest,
    originalActionIdentity: input.originalActionIdentity,
    reconstructionAuditId: input.reconstructionAuditId,
    missingAuditObservationId: input.missingAuditObservationId,
    outcome: input.outcome,
  };
  const digest = computeDomainDigest(STORAGE_AUDIT_RECONSTRUCTION_EVIDENCE_IDENTITY_DOMAIN, JSON.stringify(tuple));
  return `pgw:r:${digest.slice('sha-256:'.length, 'sha-256:'.length + 32)}`;
}

/** Reconstruction evidence payload (bounded; no paths, no nonces, no descriptors). */
export function auditReconstructionEvidencePayload(input: AuditReconstructionEvidenceInput): Readonly<Record<string, unknown>> {
  return {
    evidenceKind: input.evidenceKind,
    recoveryOperation: input.recoveryOperation,
    targetRecordClass: input.targetRecordClass,
    targetRecordId: input.targetRecordId,
    targetRecordDigest: input.targetRecordDigest,
    originalActionIdentity: input.originalActionIdentity,
    reconstructionAuditId: input.reconstructionAuditId,
    reconstructionAuditDigest: input.reconstructionAuditDigest,
    missingAuditObservationId: input.missingAuditObservationId,
    generation: input.generation,
    surfaceGeneration: input.surfaceGeneration,
    outcome: input.outcome,
    resultingState: { targetIntact: true, reconstructionAuditDurable: true, evidenceDurable: true },
  };
}

/**
 * Pure deterministic reconstruction-evidence record construction (6.3;
 * WP-8-G §8). The envelope binds the trusted RECOVERY action identity, the
 * recovery time, and the bounded payload; `referenceDigests` carries the
 * reconstructed audit digest and the target digest (digest linkage). The
 * evidence's own mechanical `authorized-write` audit event is constructed
 * with the recovery action identity at the same durability point.
 */
export function buildAuditReconstructionEvidenceRecord(input: AuditReconstructionEvidenceInput): RecoveryEvidenceBuild {
  if (!isValidDigestSyntax(input.targetRecordDigest) || !isValidDigestSyntax(input.reconstructionAuditDigest)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target and reconstruction-audit digests must use sha-256:<64-hex> syntax' };
  }
  if (!/^pgw:r:[0-9a-f]{32}$/.test(input.targetRecordId)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target record identity is not a canonical typed identifier' };
  }
  if (!isReconstructionTargetClass(input.targetRecordClass)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target record class is outside the reconstructable vocabulary' };
  }
  const payload = auditReconstructionEvidencePayload(input);
  const payloadDigest = computePayloadDigest(payload);
  const recordId = computeAuditReconstructionEvidenceIdentity(input);
  const envelope: Readonly<Record<string, unknown>> = {
    recordKind: 'StoreEvidenceRecord',
    formatVersion: '1.0',
    recordId,
    revision: 1,
    createdAt: input.createdAt,
    trustedActionId: input.actionIdentity,
    payload,
    payloadDigest,
    referenceDigests: [input.reconstructionAuditDigest, input.targetRecordDigest],
    retentionClass: 'indefinite',
  };
  const canonical = canonicalEnvelopeBytes(envelope);
  const audit = buildAuthorizedWriteAuditEvent({
    storeInstance: input.storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
    primaryClass: 'store-evidence-record',
    primaryRecordId: recordId,
    primaryRevision: 1,
    primaryDigest: canonical.digest,
    eventKind: 'authorized-write',
    trustedActionIdentity: input.actionIdentity,
    primaryCreatedAt: input.createdAt,
  });
  if (!audit.ok || audit.event === undefined) {
    return { ok: false, code: 'ERR-STO-INTERNAL-INVARIANT', message: audit.message ?? 'reconstruction evidence audit event could not be constructed' };
  }
  return {
    ok: true,
    record: {
      recordId,
      canonicalUtf8: canonical.canonicalUtf8,
      digest: canonical.digest,
      createdAt: input.createdAt,
      auditCanonicalUtf8: audit.event.canonicalUtf8,
      auditDigest: audit.event.digest,
      auditEventId: audit.event.recordId,
    },
  };
}

/** Reconstructed-audit publication result (exact-record permit confined). */
export interface ReconstructedAuditPublishResult {
  readonly ok: boolean;
  readonly outcome?: 'published' | 'already-completed';
  readonly code?: string;
  readonly message?: string;
}

/**
 * Publish the exact reconstructed `recovery-audit-reconstruction` audit
 * event (WP-8-G §6/§7): a dedicated exact-record `RecoveryPublicationPermit`
 * (role `reconstructed-recovery-audit`) binds the genuine recovery
 * capability, the `audit-reconstruction` operation, the audit class, the
 * exact audit identity/digest/canonical-byte digest/destination, the exact
 * referenced target record identity and digest, the exact event kind, and
 * the exact trusted RECOVERY action identity. All substitutions fail before
 * any directory provisioning or record publication. An EEXIST replay at the
 * derived audit path is verified byte-exact before `already-completed`.
 */
export function publishReconstructedAudit(input: {
  readonly capability: RecoveryCapability;
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly targetRecordClass: RecordClassId;
  readonly targetRecordId: string;
  readonly targetRecordDigest: string;
  /** Derived reconstruction audit facts (identity/bytes/digest). */
  readonly audit: NonNullable<AuditEventBuildResult['event']>;
  readonly hooks?: PublicationHooks;
}): ReconstructedAuditPublishResult {
  if (!isGenuineRecoveryCapability(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability operand is not genuine' };
  }
  const check = input.capability.verify('audit-reconstruction');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability is not usable at the reconstructed-audit publication boundary' };
  }
  const auditDerived = deriveRecordRelativePath('authoritative-audit-event', input.audit.recordId);
  if (!auditDerived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'reconstructed audit path derivation failed' };
  }
  const permit = createRecoveryPublicationPermit({
    capability: input.capability,
    operation: 'audit-reconstruction',
    role: 'reconstructed-recovery-audit',
    recordId: input.audit.recordId,
    recordDigest: input.audit.digest,
    canonicalBytesDigest: input.audit.digest,
    destinationDesignation: auditDerived.relativePath,
    audit: {
      referencedRecordId: input.targetRecordId,
      referencedRecordDigest: input.targetRecordDigest,
      eventKind: RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND,
      trustedActionIdentity: input.capability.binding.actionIdentity,
    },
  });
  if (permit === undefined) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'reconstructed-audit permit could not be issued' };
  }
  try {
    const published = publishRecoveryBoundRecord({
      permit,
      canonicalUtf8: input.audit.canonicalUtf8,
      byteLimit: input.byteLimit,
      serviceUid: input.serviceUid,
      hooks: input.hooks,
    });
    if (!published.ok) {
      // EEXIST replay classification: an existing object at the derived
      // audit path is verified byte-exact (idempotent) or rejected.
      const existing = verifyObjectBytesAt({ path: `${input.namespaceRoot}/${auditDerived.relativePath}`, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
      if (existing.ok && existing.canonicalUtf8 === input.audit.canonicalUtf8 && existing.digest === input.audit.digest) {
        return { ok: true, outcome: 'already-completed' };
      }
      return { ok: false, code: published.code ?? 'ERR-STO-DURABILITY', message: published.message ?? 'reconstructed audit publication did not reach its durability point' };
    }
    return { ok: true, outcome: 'published' };
  } finally {
    permit.dispose();
  }
}

/**
 * Publish the reconstruction recovery evidence and its mechanical
 * `authorized-write` audit event (WP-8-G §7.11–13) through the WP-8-F
 * evidence pipeline under the `audit-reconstruction` operation. The
 * reconstruction evidence is a `StoreEvidenceRecord` (`recovery-evidence`,
 * `audit-reconstruction`); the evidence's own audit is the normal
 * `authorized-write` event of the recovery action.
 */
export function publishAuditReconstructionEvidence(input: {
  readonly capability: RecoveryCapability;
  readonly storeInstance: VerifiedStoreInstance;
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly record: NonNullable<RecoveryEvidenceBuild['record']>;
  readonly hooks?: { readonly fsyncFile?: (fd: number) => void; readonly fsyncDirectory?: (path: string) => void };
}): ReturnType<typeof publishRecoveryEvidence> {
  return publishRecoveryEvidence({
    capability: input.capability,
    storeInstance: input.storeInstance,
    namespaceRoot: input.namespaceRoot,
    serviceUid: input.serviceUid,
    byteLimit: input.byteLimit,
    record: input.record,
    operation: 'audit-reconstruction',
    hooks: input.hooks,
  });
}
