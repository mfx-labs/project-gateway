/**
 * WP-8-F durable recovery evidence (contract 6.3 `StoreEvidenceRecord`;
 * WPR-023 (a); CSA-001/010). FILESYSTEM-FREE at module scope: this module
 * constructs the deterministic evidence record and its mechanical
 * `authorized-write` audit event purely, and delegates every filesystem
 * mutation to the exact publication substrate (`publication/publish-record.ts`)
 * and the audit builder (`audit/write-audit.ts`) under the genuine recovery
 * capability. No direct filesystem API import exists here.
 *
 * Evidence model (WP-8-F):
 *   - ONE record class: `StoreEvidenceRecord` (segment `evidence`), with the
 *     closed `evidenceKind` discriminator `recovery-evidence` (6.3);
 *   - deterministic identity: domain digest over (store/namespace identity,
 *     evidence kind, recovery operation, target entry designation, twin
 *     identity, pre-mutation evidence digest, outcome) — no clock, nonce,
 *     action identity, or path enters the identity, so identical facts yield
 *     identical identities and replay is idempotent;
 *   - the envelope binds the trusted recovery action identity, the recovery
 *     time (creation evidence), the referenced twin digest, and the bounded
 *     evidence payload (never paths, never nonces);
 *   - the evidence record is published through the immutable hard-link
 *     protocol with the same durability point as any record, followed by its
 *     mechanical `authorized-write` audit event (WPR-010/AUD-003; the audit
 *     linkage of 6.3).
 *
 * Success is reported only after the evidence and its audit event are
 * durable. EEXIST replay classification mirrors the write path (MINOR-2):
 * an existing evidence final target is verified byte-exact (idempotent) or
 * rejected; an existing evidence temporary is never adopted or unlinked.
 */
import { canonicalEnvelopeBytes, computeDomainDigest, computePayloadDigest, isValidDigestSyntax, parsePersistedEnvelope } from '../format/envelope.js';
import { buildAuthorizedWriteAuditEvent } from '../audit/write-audit.js';
import { verifyObjectBytesAt } from '../publication/publish-record.js';
import { publishRecoveryBoundRecord } from '../publication/publish-record.js';
import { deriveRecordRelativePath } from '../layout/layout.js';
import { isGenuineRecoveryCapability, createRecoveryPublicationPermit, type RecoveryCapability } from '../capabilities/authenticity.js';
import type { StoreEvidenceKind, VerifiedStoreInstance } from '../types.js';

/** Deterministic UTC ISO-8601 formatter from an epoch-ms value (no Date). */
export function isoFromEpochMs(ms: number): string {
  if (!Number.isSafeInteger(ms)) throw new RangeError('epoch ms must be a safe integer');
  const totalSeconds = Math.floor(ms / 1000);
  const millis = ms - totalSeconds * 1000;
  const days = Math.floor(totalSeconds / 86400);
  const secondsOfDay = totalSeconds - days * 86400;
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = month <= 2 ? y + 1 : y;
  const pad = (n: number, w: number): string => String(n).padStart(w, '0');
  const hours = Math.floor(secondsOfDay / 3600);
  const minutes = Math.floor((secondsOfDay % 3600) / 60);
  const seconds = secondsOfDay % 60;
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}Z`;
}

/** Domain-separated recovery-evidence identity domain (WP-8-F). */
export const STORAGE_RECOVERY_EVIDENCE_IDENTITY_DOMAIN = 'PGAP-STORAGE-RECOVERY-EVIDENCE-IDENTITY-v1\u0000';
/** Domain-separated quarantine-temporary identity domain (ADR-030; §16.5). */
export const STORAGE_QUARANTINE_TEMPORARY_ID_DOMAIN = 'PGAP-STORAGE-QUARANTINE-TEMPORARY-v1\u0000';
/** WP-8-I disposition evidence identity domains (ADR-032; §7). */
export const STORAGE_QUARANTINE_DISPOSITION_EVIDENCE_IDENTITY_DOMAIN = 'PGAP-STORAGE-QUARANTINE-DISPOSITION-EVIDENCE-v1\u0000';
export const STORAGE_INDEX_DISPOSITION_EVIDENCE_IDENTITY_DOMAIN = 'PGAP-STORAGE-INDEX-DISPOSITION-EVIDENCE-v1\u0000';
/** WP-8-J lock-recovery evidence identity domain (12.3.1/ADR-033; §9). */
export const STORAGE_LOCK_RECOVERY_EVIDENCE_IDENTITY_DOMAIN = 'PGAP-STORAGE-LOCK-RECOVERY-EVIDENCE-v1\u0000';

export interface QuarantineTemporaryIdInput {
  readonly storeInstance: VerifiedStoreInstance;
  /** Source temporary entry designation (WPR-003 name). */
  readonly sourceEntry: string;
  readonly classification: 'incomplete-unpublished' | 'malformed-temporary';
  /** Exact source content digest (record-bytes digest domain; pre-mutation evidence digest). */
  readonly sourceDigest: string;
}

/** Deterministic quarantine ID (lowercase SHA-256 domain digest; §16.5). */
export function computeQuarantineTemporaryId(input: QuarantineTemporaryIdInput): string {
  const tuple = {
    storeInstance: input.storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
    sourceEntry: input.sourceEntry,
    classification: input.classification,
    sourceDigest: input.sourceDigest,
  };
  const digest = computeDomainDigest(STORAGE_QUARANTINE_TEMPORARY_ID_DOMAIN, JSON.stringify(tuple));
  return digest.slice('sha-256:'.length);
}

/** Quarantine destination logical designation (never a raw path). */
export function quarantineDestinationDesignation(quarantineId: string): string {
  return `temporary/${quarantineId.slice(0, 4)}/${quarantineId}.qtn`;
}

/** Recovery operations that produce evidence in this slice. */
export type RecoveryEvidenceOperation =
  | 'orphan-removal'
  | 'quarantine-temporary'
  | 'audit-reconstruction'
  | 'dispose-quarantined-temporary'
  | 'dispose-conflicting-index'
  | 'break-writer-lock';

/** Evidence outcome vocabulary (closed; the fact recorded, never a decision). */
export type RecoveryEvidenceOutcome = 'orphan-removed' | 'already-completed' | 'lock-broken';

export interface RecoveryEvidenceInput {
  readonly storeInstance: VerifiedStoreInstance;
  /** Trusted recovery action identity (from the genuine provenance; never from plan data). */
  readonly actionIdentity: string;
  readonly evidenceKind: 'recovery-evidence';
  readonly recoveryOperation: RecoveryEvidenceOperation;
  readonly targetEntry: string;
  readonly twinRecordId: string;
  /** Closed-vocabulary twin class (store-records). */
  readonly twinRecordClass: string;
  /** Pre-mutation evidence digest: the twin's record-bytes digest. */
  readonly twinRecordDigest: string;
  readonly observationIds: readonly string[];
  readonly outcome: RecoveryEvidenceOutcome;
  /** Assessment scan-generation and surface-structure tokens (recomputed at the boundary). */
  readonly generation: string;
  readonly surfaceGeneration: string;
  /** Recovery time (creation evidence; never the original operation time). */
  readonly createdAt: string;
}

export interface RecoveryEvidenceBuild {
  readonly ok: boolean;
  readonly record?: {
    readonly recordId: string;
    readonly canonicalUtf8: string;
    readonly digest: string;
    readonly createdAt: string;
    readonly auditCanonicalUtf8: string;
    readonly auditDigest: string;
    readonly auditEventId: string;
  };
  readonly code?: string;
  readonly message?: string;
}

/** Evidence payload (bounded; no paths, no nonces, no descriptors). */
export function recoveryEvidencePayload(input: RecoveryEvidenceInput): Readonly<Record<string, unknown>> {
  return {
    evidenceKind: input.evidenceKind,
    recoveryOperation: input.recoveryOperation,
    targetEntry: input.targetEntry,
    twinRecordId: input.twinRecordId,
    twinRecordClass: input.twinRecordClass,
    twinRecordDigest: input.twinRecordDigest,
    observationIds: [...input.observationIds],
    outcome: input.outcome,
    generation: input.generation,
    surfaceGeneration: input.surfaceGeneration,
    resultingState: { temporaryRemoved: input.outcome === 'orphan-removed' || input.outcome === 'already-completed', twinIntact: true },
  };
}

/** Deterministic evidence identity: domain digest over the factual tuple. */
export function computeRecoveryEvidenceIdentity(input: RecoveryEvidenceInput): string {
  const tuple = {
    storeInstance: input.storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
    evidenceKind: input.evidenceKind,
    recoveryOperation: input.recoveryOperation,
    targetEntry: input.targetEntry,
    twinRecordId: input.twinRecordId,
    twinRecordClass: input.twinRecordClass,
    twinRecordDigest: input.twinRecordDigest,
    outcome: input.outcome,
  };
  const digest = computeDomainDigest(STORAGE_RECOVERY_EVIDENCE_IDENTITY_DOMAIN, JSON.stringify(tuple));
  return `pgw:r:${digest.slice('sha-256:'.length, 'sha-256:'.length + 32)}`;
}

/**
 * Pure deterministic evidence-record construction (RFM; 6.3). The envelope
 * binds the recovery action identity, the recovery time, the twin digest,
 * and the bounded payload; `referenceDigests` carries the twin digest
 * (audit/evidence linkage by digest only).
 */
export function buildRecoveryEvidenceRecord(input: RecoveryEvidenceInput): RecoveryEvidenceBuild {
  if (!isValidDigestSyntax(input.twinRecordDigest)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'twin digest must use sha-256:<64-hex> syntax' };
  }
  if (!isPublicationTempEntry(input.targetEntry)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target entry is not a publication temporary designation' };
  }
  const payload = recoveryEvidencePayload(input);
  const payloadDigest = computePayloadDigest(payload);
  const recordId = computeRecoveryEvidenceIdentity(input);
  const envelope: Readonly<Record<string, unknown>> = {
    recordKind: 'StoreEvidenceRecord',
    formatVersion: '1.0',
    recordId,
    revision: 1,
    createdAt: input.createdAt,
    trustedActionId: input.actionIdentity,
    payload,
    payloadDigest,
    referenceDigests: [input.twinRecordDigest],
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
    return { ok: false, code: 'ERR-STO-INTERNAL-INVARIANT', message: audit.message ?? 'evidence audit event could not be constructed' };
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

function isPublicationTempEntry(name: string): boolean {
  return /^pub-[0-9a-f]{16}-[0-9a-f]{1,4}$/.test(name);
}

/**
 * Verify an existing recovery-evidence record at its deterministic derived
 * path against the factual binding (evidence kind, operation, target entry,
 * twin identity/class/digest, outcome). The recovery time and action
 * identity are creation evidence, not binding facts: an already-completed
 * state recorded by an earlier run (possibly with a different recovery time
 * or action identity) is recognized deterministically; any factual mismatch
 * fails closed as conflicting evidence.
 */
export function verifyExistingRecoveryEvidence(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly evidenceId: string;
  readonly targetEntry: string;
  readonly twinRecordId: string;
  readonly twinRecordDigest: string;
}): { readonly ok: boolean; readonly matches?: boolean; readonly code?: string; readonly message?: string } {
  const derived = deriveRecordRelativePath('store-evidence-record', input.evidenceId);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'evidence path derivation failed' };
  }
  const existing = verifyObjectBytesAt({ path: `${input.namespaceRoot}/${derived.relativePath}`, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
  if (!existing.ok) {
    if (existing.code === 'ERR-STO-NOT-FOUND') return { ok: true, matches: false };
    return { ok: false, code: existing.code, message: existing.message };
  }
  const parsed = parsePersistedEnvelope(existing.canonicalUtf8 ?? '', input.byteLimit);
  if (!parsed.ok || parsed.model === undefined) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'existing evidence record is not a canonical envelope' };
  }
  const model = parsed.model as Readonly<Record<string, unknown>>;
  if (model['recordKind'] !== 'StoreEvidenceRecord') {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'existing evidence target is not a StoreEvidenceRecord' };
  }
  const payload = model['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'existing evidence payload is malformed' };
  }
  const p = payload as Readonly<Record<string, unknown>>;
  const matches =
    p['evidenceKind'] === 'recovery-evidence' &&
    p['recoveryOperation'] === 'orphan-removal' &&
    p['targetEntry'] === input.targetEntry &&
    p['twinRecordId'] === input.twinRecordId &&
    p['twinRecordDigest'] === input.twinRecordDigest &&
    (p['outcome'] === 'orphan-removed' || p['outcome'] === 'already-completed');
  if (!matches) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'existing recovery evidence conflicts with the authorized request' };
  }
  return { ok: true, matches: true };
}

/** Quarantine-temporary evidence input (identity binds the factual tuple). */
export interface QuarantineEvidenceInput {
  readonly storeInstance: VerifiedStoreInstance;
  readonly actionIdentity: string;
  readonly evidenceKind: 'recovery-evidence';
  readonly recoveryOperation: 'quarantine-temporary';
  readonly quarantineId: string;
  readonly sourceEntry: string;
  readonly sourceClassification: 'incomplete-unpublished' | 'malformed-temporary';
  readonly sourceDigest: string;
  readonly observationIds: readonly string[];
  readonly outcome: 'quarantined' | 'already-completed';
  readonly generation: string;
  readonly surfaceGeneration: string;
  readonly createdAt: string;
}

/** Deterministic quarantine evidence identity (derivable by the scanner from the object). */
export function computeQuarantineEvidenceIdentity(input: {
  readonly storeInstance: VerifiedStoreInstance;
  readonly quarantineId: string;
  readonly sourceDigest: string;
  readonly outcome: 'quarantined' | 'already-completed';
}): string {
  const tuple = {
    storeInstance: input.storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
    evidenceKind: 'recovery-evidence',
    recoveryOperation: 'quarantine-temporary',
    quarantineId: input.quarantineId,
    sourceDigest: input.sourceDigest,
    outcome: input.outcome,
  };
  const digest = computeDomainDigest(STORAGE_RECOVERY_EVIDENCE_IDENTITY_DOMAIN, JSON.stringify(tuple));
  return `pgw:r:${digest.slice('sha-256:'.length, 'sha-256:'.length + 32)}`;
}

/** Quarantine evidence payload (bounded; no paths, no nonces). */
export function quarantineEvidencePayload(input: QuarantineEvidenceInput): Readonly<Record<string, unknown>> {
  return {
    evidenceKind: input.evidenceKind,
    recoveryOperation: input.recoveryOperation,
    quarantineId: input.quarantineId,
    targetEntry: input.sourceEntry,
    sourceClassification: input.sourceClassification,
    sourceDigest: input.sourceDigest,
    observationIds: [...input.observationIds],
    outcome: input.outcome,
    generation: input.generation,
    surfaceGeneration: input.surfaceGeneration,
    destination: quarantineDestinationDesignation(input.quarantineId),
    resultingState: { sourceRemoved: true, destinationIntact: true },
  };
}

/** Pure deterministic quarantine evidence record construction (6.3; QRN-005). */
export function buildQuarantineEvidenceRecord(input: QuarantineEvidenceInput): RecoveryEvidenceBuild {
  if (!/^[0-9a-f]{64}$/.test(input.quarantineId)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'quarantine ID must be 64 lowercase hex characters' };
  }
  if (!isValidDigestSyntax(input.sourceDigest)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'source digest must use sha-256:<64-hex> syntax' };
  }
  const payload = quarantineEvidencePayload(input);
  const payloadDigest = computePayloadDigest(payload);
  const recordId = computeQuarantineEvidenceIdentity(input);
  const envelope: Readonly<Record<string, unknown>> = {
    recordKind: 'StoreEvidenceRecord',
    formatVersion: '1.0',
    recordId,
    revision: 1,
    createdAt: input.createdAt,
    trustedActionId: input.actionIdentity,
    payload,
    payloadDigest,
    referenceDigests: [input.sourceDigest],
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
    return { ok: false, code: 'ERR-STO-INTERNAL-INVARIANT', message: audit.message ?? 'quarantine evidence audit event could not be constructed' };
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

/** Quarantine evidence existence/binding verification (WP-8-F; §16.5 idempotency). */
export function verifyExistingQuarantineEvidence(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly evidenceId: string;
  readonly quarantineId: string;
  readonly sourceDigest: string;
  readonly sourceEntry: string;
}): { readonly ok: boolean; readonly matches?: boolean; readonly code?: string; readonly message?: string } {
  const derived = deriveRecordRelativePath('store-evidence-record', input.evidenceId);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'evidence path derivation failed' };
  }
  const existing = verifyObjectBytesAt({ path: `${input.namespaceRoot}/${derived.relativePath}`, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
  if (!existing.ok) {
    if (existing.code === 'ERR-STO-NOT-FOUND') return { ok: true, matches: false };
    return { ok: false, code: existing.code, message: existing.message };
  }
  const parsed = parsePersistedEnvelope(existing.canonicalUtf8 ?? '', input.byteLimit);
  if (!parsed.ok || parsed.model === undefined) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'existing evidence record is not a canonical envelope' };
  }
  const model = parsed.model as Readonly<Record<string, unknown>>;
  if (model['recordKind'] !== 'StoreEvidenceRecord') {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'existing evidence target is not a StoreEvidenceRecord' };
  }
  const payload = model['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'existing evidence payload is malformed' };
  }
  const p = payload as Readonly<Record<string, unknown>>;
  const matches =
    p['evidenceKind'] === 'recovery-evidence' &&
    p['recoveryOperation'] === 'quarantine-temporary' &&
    p['quarantineId'] === input.quarantineId &&
    p['sourceDigest'] === input.sourceDigest &&
    p['targetEntry'] === input.sourceEntry &&
    (p['outcome'] === 'quarantined' || p['outcome'] === 'already-completed');
  if (!matches) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'existing quarantine evidence conflicts with the authorized request' };
  }
  return { ok: true, matches: true };
}

/**
 * WP-8-I disposition evidence (ADR-032; §7): deterministic `StoreEvidenceRecord`
 * with the EXISTING `recovery-evidence` evidence kind (no new evidence kind;
 * TAX-013 closed), distinguished by the exact disposition recovery operation
 * and a per-operation domain-separated identity. Produced ONLY by the two
 * executable disposition mutations (eligible quarantine regular files and
 * the exact conflicting index artifact); `dispose-wpr023d-temporary` is
 * adjudication-only and never emits evidence.
 */
export interface DispositionEvidenceInput {
  readonly storeInstance: VerifiedStoreInstance;
  /** Trusted RECOVERY action identity (from the genuine provenance). */
  readonly actionIdentity: string;
  readonly evidenceKind: 'recovery-evidence';
  readonly recoveryOperation: 'dispose-quarantined-temporary' | 'dispose-conflicting-index';
  /** Logical entry designation (quarantine entry name or index artifact filename; never a path). */
  readonly targetEntry: string;
  /** Quarantine disposition only: the 4-hex shard designation (empty for parent-level entries). */
  readonly targetShard?: string;
  /** Index disposition only: the 32-hex index artifact identity. */
  readonly targetIndexId?: string;
  /** Pre-disposition recovery classification (exact). */
  readonly targetClassification: string;
  /** Pre-disposition object digest (content digest; index record digest). */
  readonly targetDigest: string;
  /** The object observation/finding evidence id bound by the request. */
  readonly observationId: string;
  /** Assessment scan-generation and surface-structure tokens (recomputed at the boundary). */
  readonly generation: string;
  readonly surfaceGeneration: string;
  readonly outcome: 'disposed' | 'already-completed';
  /** Recovery time (creation evidence; never the original operation time). */
  readonly createdAt: string;
}

/** Identity-relevant disposition facts (the deterministic identity tuple; §7). */
export type DispositionEvidenceIdentityInput = Pick<
  DispositionEvidenceInput,
  'storeInstance' | 'evidenceKind' | 'recoveryOperation' | 'targetEntry' | 'targetShard' | 'targetIndexId' | 'targetClassification' | 'targetDigest' | 'observationId' | 'outcome'
>;

/** Deterministic disposition-evidence identity (per-operation domain; §7). */
export function computeDispositionEvidenceIdentity(input: DispositionEvidenceIdentityInput): string {
  const domain =
    input.recoveryOperation === 'dispose-quarantined-temporary'
      ? STORAGE_QUARANTINE_DISPOSITION_EVIDENCE_IDENTITY_DOMAIN
      : STORAGE_INDEX_DISPOSITION_EVIDENCE_IDENTITY_DOMAIN;
  const tuple = {
    storeInstance: input.storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
    evidenceKind: input.evidenceKind,
    recoveryOperation: input.recoveryOperation,
    targetEntry: input.targetEntry,
    targetShard: input.targetShard ?? null,
    targetIndexId: input.targetIndexId ?? null,
    targetClassification: input.targetClassification,
    targetDigest: input.targetDigest,
    observationId: input.observationId,
    outcome: input.outcome,
  };
  const digest = computeDomainDigest(domain, JSON.stringify(tuple));
  return `pgw:r:${digest.slice('sha-256:'.length, 'sha-256:'.length + 32)}`;
}

/** Disposition evidence payload (bounded; no paths, no nonces). */
export function dispositionEvidencePayload(input: DispositionEvidenceInput): Readonly<Record<string, unknown>> {
  return {
    evidenceKind: input.evidenceKind,
    recoveryOperation: input.recoveryOperation,
    targetSurface: input.recoveryOperation === 'dispose-quarantined-temporary' ? 'quarantine' : 'index',
    targetEntry: input.targetEntry,
    ...(input.targetShard !== undefined ? { targetShard: input.targetShard } : {}),
    ...(input.targetIndexId !== undefined ? { targetIndexId: input.targetIndexId } : {}),
    targetClassification: input.targetClassification,
    targetDigest: input.targetDigest,
    observationId: input.observationId,
    generation: input.generation,
    surfaceGeneration: input.surfaceGeneration,
    outcome: input.outcome,
    resultingState: { targetRemoved: true },
  };
}

/**
 * Pure deterministic disposition-evidence record construction (6.3; ADR-032
 * §7): `StoreEvidenceRecord` with `evidenceKind: recovery-evidence`, the
 * exact disposition operation, the trusted RECOVERY action identity, the
 * recovery time, and the bounded payload; `referenceDigests` carries the
 * pre-disposition target digest. The evidence's own mechanical
 * `authorized-write` audit event is constructed with the recovery action
 * identity at the same durability point.
 */
export function buildDispositionEvidenceRecord(input: DispositionEvidenceInput): RecoveryEvidenceBuild {
  if (!isValidDigestSyntax(input.targetDigest)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target digest must use sha-256:<64-hex> syntax' };
  }
  if (input.recoveryOperation !== 'dispose-quarantined-temporary' && input.recoveryOperation !== 'dispose-conflicting-index') {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'disposition evidence requires an executable disposition operation' };
  }
  const payload = dispositionEvidencePayload(input);
  const payloadDigest = computePayloadDigest(payload);
  const recordId = computeDispositionEvidenceIdentity(input);
  const envelope: Readonly<Record<string, unknown>> = {
    recordKind: 'StoreEvidenceRecord',
    formatVersion: '1.0',
    recordId,
    revision: 1,
    createdAt: input.createdAt,
    trustedActionId: input.actionIdentity,
    payload,
    payloadDigest,
    referenceDigests: [input.targetDigest],
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
    return { ok: false, code: 'ERR-STO-INTERNAL-INVARIANT', message: audit.message ?? 'disposition evidence audit event could not be constructed' };
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

/**
 * Verify an existing disposition-evidence record at its deterministic
 * derived path against the factual binding (recovery time and recovery
 * action identity are creation evidence, not binding facts). Any factual
 * mismatch fails closed as conflicting evidence.
 */
export function verifyExistingDispositionEvidence(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly evidenceId: string;
  readonly recoveryOperation: 'dispose-quarantined-temporary' | 'dispose-conflicting-index';
  readonly targetEntry: string;
  readonly targetShard?: string;
  readonly targetIndexId?: string;
  readonly targetClassification: string;
  readonly targetDigest: string;
  readonly observationId: string;
}): { readonly ok: boolean; readonly matches?: boolean; readonly code?: string; readonly message?: string } {
  const derived = deriveRecordRelativePath('store-evidence-record', input.evidenceId);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'disposition evidence path derivation failed' };
  }
  const existing = verifyObjectBytesAt({ path: `${input.namespaceRoot}/${derived.relativePath}`, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
  if (!existing.ok) {
    if (existing.code === 'ERR-STO-NOT-FOUND') return { ok: true, matches: false };
    return { ok: false, code: existing.code, message: existing.message };
  }
  const parsed = parsePersistedEnvelope(existing.canonicalUtf8 ?? '', input.byteLimit);
  if (!parsed.ok || parsed.model === undefined) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'existing disposition evidence is not a canonical envelope' };
  }
  const model = parsed.model as Readonly<Record<string, unknown>>;
  if (model['recordKind'] !== 'StoreEvidenceRecord') {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'existing disposition evidence target is not a StoreEvidenceRecord' };
  }
  const payload = model['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'existing disposition evidence payload is malformed' };
  }
  const p = payload as Readonly<Record<string, unknown>>;
  const outcome = p['outcome'];
  const matches =
    p['evidenceKind'] === 'recovery-evidence' &&
    p['recoveryOperation'] === input.recoveryOperation &&
    p['targetEntry'] === input.targetEntry &&
    (input.targetShard === undefined || p['targetShard'] === input.targetShard) &&
    (input.targetIndexId === undefined || p['targetIndexId'] === input.targetIndexId) &&
    p['targetClassification'] === input.targetClassification &&
    p['targetDigest'] === input.targetDigest &&
    p['observationId'] === input.observationId &&
    (outcome === 'disposed' || outcome === 'already-completed');
  if (!matches) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'existing disposition evidence conflicts with the authorized request' };
  }
  return { ok: true, matches: true };
}

/**
 * WP-8-J lock-recovery evidence (12.3.1; ADR-033): deterministic
 * `StoreEvidenceRecord` with the existing `recovery-evidence` evidence kind
 * (TAX-013 implemented vocabulary; ADR-032 decision 4 precedent), the exact
 * `break-writer-lock` operation, and the domain-separated identity
 * `PGAP-STORAGE-LOCK-RECOVERY-EVIDENCE-v1`. The evidence binds the exact
 * pre-break lock-record digest and the deterministic lock-instance identity
 * — never the raw nonce and never a path — so it can never authorize
 * breaking any other lock instance.
 */
export interface LockRecoveryEvidenceInput {
  readonly storeInstance: VerifiedStoreInstance;
  /** Trusted RECOVERY action identity (from the genuine provenance). */
  readonly actionIdentity: string;
  readonly evidenceKind: 'recovery-evidence';
  readonly recoveryOperation: 'break-writer-lock';
  /** Exact pre-break canonical lock-record digest. */
  readonly lockRecordDigest: string;
  /** Deterministic lock-instance identity (PGAP-STORAGE-WRITER-LOCK-INSTANCE-v1). */
  readonly lockInstanceId: string;
  /** The lock observation identity bound by the trusted request. */
  readonly observationId: string;
  /** Assessment scan-generation and surface-structure tokens (recomputed at the boundary). */
  readonly generation: string;
  readonly surfaceGeneration: string;
  readonly outcome: 'lock-broken' | 'already-completed';
  /** Recovery time (creation evidence; never a staleness judgment). */
  readonly createdAt: string;
}

/** Identity-relevant lock-recovery facts (the deterministic identity tuple). */
export type LockRecoveryEvidenceIdentityInput = Pick<
  LockRecoveryEvidenceInput,
  'storeInstance' | 'evidenceKind' | 'recoveryOperation' | 'lockRecordDigest' | 'lockInstanceId' | 'observationId' | 'outcome'
>;

/** Deterministic lock-recovery evidence identity (12.3.1; ADR-033 §9). */
export function computeLockRecoveryEvidenceIdentity(input: LockRecoveryEvidenceIdentityInput): string {
  const tuple = {
    storeInstance: input.storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
    evidenceKind: input.evidenceKind,
    recoveryOperation: input.recoveryOperation,
    lockRecordDigest: input.lockRecordDigest,
    lockInstanceId: input.lockInstanceId,
    observationId: input.observationId,
    outcome: input.outcome,
  };
  const digest = computeDomainDigest(STORAGE_LOCK_RECOVERY_EVIDENCE_IDENTITY_DOMAIN, JSON.stringify(tuple));
  return `pgw:r:${digest.slice('sha-256:'.length, 'sha-256:'.length + 32)}`;
}

/** Lock-recovery evidence payload (bounded; no paths, no nonce). */
export function lockRecoveryEvidencePayload(input: LockRecoveryEvidenceInput): Readonly<Record<string, unknown>> {
  return {
    evidenceKind: input.evidenceKind,
    recoveryOperation: input.recoveryOperation,
    targetEntry: 'writer.lock',
    lockRecordDigest: input.lockRecordDigest,
    lockInstanceId: input.lockInstanceId,
    observationId: input.observationId,
    generation: input.generation,
    surfaceGeneration: input.surfaceGeneration,
    outcome: input.outcome,
    resultingState: { writerLockRemoved: true },
  };
}

/**
 * Pure deterministic lock-recovery evidence construction (12.3.1; LOK-010):
 * `StoreEvidenceRecord` with `evidenceKind: recovery-evidence`, the exact
 * `break-writer-lock` operation, the trusted RECOVERY action identity, the
 * recovery time, and the bounded payload; `referenceDigests` carries the
 * pre-break lock-record digest. The evidence's own mechanical
 * `authorized-write` audit event is constructed with the recovery action
 * identity at the same durability point.
 */
export function buildLockRecoveryEvidenceRecord(input: LockRecoveryEvidenceInput): RecoveryEvidenceBuild {
  if (!isValidDigestSyntax(input.lockRecordDigest)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'lock-record digest must use sha-256:<64-hex> syntax' };
  }
  if (!/^pgw:r:[0-9a-f]{32}$/.test(input.lockInstanceId)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'lock-instance identity is not a canonical typed identifier' };
  }
  const payload = lockRecoveryEvidencePayload(input);
  const payloadDigest = computePayloadDigest(payload);
  const recordId = computeLockRecoveryEvidenceIdentity(input);
  const envelope: Readonly<Record<string, unknown>> = {
    recordKind: 'StoreEvidenceRecord',
    formatVersion: '1.0',
    recordId,
    revision: 1,
    createdAt: input.createdAt,
    trustedActionId: input.actionIdentity,
    payload,
    payloadDigest,
    referenceDigests: [input.lockRecordDigest],
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
    return { ok: false, code: 'ERR-STO-INTERNAL-INVARIANT', message: audit.message ?? 'lock-recovery evidence audit event could not be constructed' };
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

/** Verify existing lock-recovery evidence against the request bindings. */
export function verifyExistingLockRecoveryEvidence(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly evidenceId: string;
  readonly recoveryOperation: 'break-writer-lock';
  readonly lockRecordDigest: string;
  readonly lockInstanceId: string;
  readonly observationId: string;
}): { readonly ok: boolean; readonly matches?: boolean; readonly code?: string; readonly message?: string } {
  const derived = deriveRecordRelativePath('store-evidence-record', input.evidenceId);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'lock-recovery evidence path derivation failed' };
  }
  const existing = verifyObjectBytesAt({ path: `${input.namespaceRoot}/${derived.relativePath}`, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
  if (!existing.ok) {
    if (existing.code === 'ERR-STO-NOT-FOUND') return { ok: true, matches: false };
    return { ok: false, code: existing.code, message: existing.message };
  }
  const parsed = parsePersistedEnvelope(existing.canonicalUtf8 ?? '', input.byteLimit);
  if (!parsed.ok || parsed.model === undefined) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'existing lock-recovery evidence is not a canonical envelope' };
  }
  const model = parsed.model as Readonly<Record<string, unknown>>;
  if (model['recordKind'] !== 'StoreEvidenceRecord') {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'existing lock-recovery evidence target is not a StoreEvidenceRecord' };
  }
  const payload = model['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'existing lock-recovery evidence payload is malformed' };
  }
  const p = payload as Readonly<Record<string, unknown>>;
  const outcome = p['outcome'];
  const matches =
    p['evidenceKind'] === 'recovery-evidence' &&
    p['recoveryOperation'] === input.recoveryOperation &&
    p['targetEntry'] === 'writer.lock' &&
    p['lockRecordDigest'] === input.lockRecordDigest &&
    p['lockInstanceId'] === input.lockInstanceId &&
    p['observationId'] === input.observationId &&
    (outcome === 'lock-broken' || outcome === 'already-completed');
  if (!matches) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'existing lock-recovery evidence conflicts with the authorized request' };
  }
  return { ok: true, matches: true };
}

export interface EvidencePublishResult {
  readonly ok: boolean;
  readonly outcome?: 'published' | 'already-completed';
  readonly evidenceId?: string;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Publish the evidence record and its mechanical audit event (WP-8-F
 * correction). The recovery capability NEVER reaches the generic
 * publication substrate: the canonical `StoreEvidenceRecord` is
 * constructed first, then an exact-record `RecoveryPublicationPermit` is
 * minted (evidence role) and consumed by the dedicated permit-bound entry
 * point; only after the evidence is durable is the mechanically
 * corresponding `authorized-write` audit event built and published under
 * a second exact audit permit. EEXIST at the evidence final target
 * verifies the existing object byte-exact before declaring
 * already-completed.
 */
export function publishRecoveryEvidence(input: {
  readonly capability: RecoveryCapability;
  readonly storeInstance: VerifiedStoreInstance;
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly record: NonNullable<RecoveryEvidenceBuild['record']>;
  /** Recovery operation that produced the evidence (drives the capability check and temp ordinals). */
  readonly operation?: RecoveryEvidenceOperation;
  readonly hooks?: { readonly fsyncFile?: (fd: number) => void; readonly fsyncDirectory?: (path: string) => void };
}): EvidencePublishResult {
  if (!isGenuineRecoveryCapability(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability operand is not genuine' };
  }
  const operation = input.operation ?? 'orphan-removal';
  const check = input.capability.verify(operation);
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability is not usable at the evidence boundary' };
  }
  const evidenceDerived = deriveRecordRelativePath('store-evidence-record', input.record.recordId);
  if (!evidenceDerived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'evidence path derivation failed' };
  }
  // Exact evidence permit: class store-evidence-record, exact identity,
  // digest, canonical bytes, and internally derived destination only.
  const evidencePermit = createRecoveryPublicationPermit({
    capability: input.capability,
    operation,
    role: 'recovery-evidence',
    recordId: input.record.recordId,
    recordDigest: input.record.digest,
    canonicalBytesDigest: input.record.digest,
    destinationDesignation: evidenceDerived.relativePath,
  });
  if (evidencePermit === undefined) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery evidence permit could not be issued' };
  }
  let auditPermit: ReturnType<typeof createRecoveryPublicationPermit>;
  try {
    const published = publishRecoveryBoundRecord({
      permit: evidencePermit,
      canonicalUtf8: input.record.canonicalUtf8,
      byteLimit: input.byteLimit,
      serviceUid: input.serviceUid,
      hooks: input.hooks,
    });
    if (!published.ok) {
      // EEXIST replay classification (MINOR-2 pattern): verify the existing
      // evidence final object byte-exact; never adopt or unlink a temp.
      const existing = verifyObjectBytesAt({ path: `${input.namespaceRoot}/${evidenceDerived.relativePath}`, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
      if (existing.ok && existing.canonicalUtf8 === input.record.canonicalUtf8 && existing.digest === input.record.digest) {
        return { ok: true, outcome: 'already-completed', evidenceId: input.record.recordId };
      }
      return { ok: false, code: published.code ?? 'ERR-STO-DURABILITY', message: published.message ?? 'evidence publication did not reach its durability point' };
    }
    // The evidence audit event at the same durability point (WPR-010/AUD-003);
    // the audit facts were constructed deterministically with the evidence.
    const auditDerived = deriveRecordRelativePath('authoritative-audit-event', input.record.auditEventId);
    if (!auditDerived.ok) {
      return { ok: false, code: 'ERR-STO-DURABILITY', message: 'evidence audit path derivation failed' };
    }
    // Exact audit permit: class authoritative-audit-event, event kind
    // authorized-write, exact evidence identity/digest, exact trusted
    // recovery action identity, exact audit identity/digest/bytes/destination.
    auditPermit = createRecoveryPublicationPermit({
      capability: input.capability,
      operation,
      role: 'recovery-authorized-write-audit',
      recordId: input.record.auditEventId,
      recordDigest: input.record.auditDigest,
      canonicalBytesDigest: input.record.auditDigest,
      destinationDesignation: auditDerived.relativePath,
      audit: {
        referencedRecordId: input.record.recordId,
        referencedRecordDigest: input.record.digest,
        eventKind: 'authorized-write',
        trustedActionIdentity: input.capability.binding.actionIdentity,
      },
    });
    if (auditPermit === undefined) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery audit permit could not be issued' };
    }
    const auditPublished = publishRecoveryBoundRecord({
      permit: auditPermit,
      canonicalUtf8: input.record.auditCanonicalUtf8,
      byteLimit: input.byteLimit,
      serviceUid: input.serviceUid,
      hooks: input.hooks,
    });
    if (!auditPublished.ok) {
      // Evidence durable, audit incomplete: the 10.5 audit-row outcome.
      return { ok: false, code: 'ERR-STO-DURABILITY', message: auditPublished.message ?? 'evidence audit event durability point not reached' };
    }
    return { ok: true, outcome: 'published', evidenceId: input.record.recordId };
  } finally {
    evidencePermit.dispose();
    auditPermit?.dispose();
  }
}
