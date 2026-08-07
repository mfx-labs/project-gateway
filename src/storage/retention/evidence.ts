/**
 * WP-8-L durable retention deletion evidence (contract §15.4/RNT-004,
 * TAX-008/013 `retention-evidence`; ADR-035). FILESYSTEM-FREE at module
 * scope: this module constructs the deterministic deletion-intent and
 * deletion-completion evidence records and their mechanical
 * `authorized-write` audit events purely, and delegates every filesystem
 * mutation to the exact retention publication substrate
 * (`publication/publish-record.ts`) and the audit builder
 * (`audit/write-audit.ts`) under the genuine retention capability. No
 * direct filesystem API import exists here.
 *
 * Evidence model (WP-8-L):
 *   - ONE record class: `StoreEvidenceRecord` with the closed
 *     `evidenceKind` discriminator `retention-evidence` (6.3; no new
 *     evidence kind — the taxonomy already reserves it);
 *   - deterministic identities: domain digests over the exact factual
 *     tuple (store/namespace identities, retention operation, target
 *     class/identity/revision/digest, policy/decision/hold bindings,
 *     history binding, and for completions the exact intent evidence
 *     identity) — no clock, nonce, action identity, generation, or path
 *     enters an identity, so identical facts yield identical identities
 *     and replay is idempotent;
 *   - the envelope binds the trusted retention action identity, the
 *     retention time (creation evidence), the referenced digests, and the
 *     bounded evidence payload (never paths, never nonces);
 *   - evidence is published through the immutable hard-link protocol with
 *     the same durability point as any record, followed by its mechanical
 *     `authorized-write` audit event (WPR-010/AUD-003).
 *
 * The intent record is published BEFORE any unlink (the durable
 * authorization-to-delete fact; it grants no authority by itself) and the
 * completion record only AFTER the unlink and containing-directory fsync
 * (the durable proof required before any later audit deletion).
 */
import { canonicalEnvelopeBytes, computeDomainDigest, computePayloadDigest, isValidDigestSyntax, parsePersistedEnvelope } from '../format/envelope.js';
import { buildAuthorizedWriteAuditEvent } from '../audit/write-audit.js';
import { verifyObjectBytesAt } from '../publication/publish-record.js';
import { publishRetentionBoundRecord } from '../publication/publish-record.js';
import { deriveRecordRelativePath } from '../layout/layout.js';
import { isGenuineRetentionCapability, createRetentionPublicationPermit, type RetentionCapability } from '../capabilities/authenticity.js';
import type { AuditHistoryInspectionResult, RetentionEvidenceOutcome, RetentionHoldResult, RetentionMutationStage, VerifiedStoreInstance } from '../types.js';

/** Domain-separated retention identity domains (ADR-035 §5/§7/§8). */
export const STORAGE_RETENTION_RECORD_DELETE_INTENT_DOMAIN = 'PGAP-STORAGE-RETENTION-RECORD-DELETE-INTENT-v1\u0000';
export const STORAGE_RETENTION_AUDIT_DELETE_INTENT_DOMAIN = 'PGAP-STORAGE-RETENTION-AUDIT-DELETE-INTENT-v1\u0000';
export const STORAGE_RETENTION_RECORD_DELETE_COMPLETION_DOMAIN = 'PGAP-STORAGE-RETENTION-RECORD-DELETE-COMPLETION-v1\u0000';
export const STORAGE_RETENTION_AUDIT_DELETE_COMPLETION_DOMAIN = 'PGAP-STORAGE-RETENTION-AUDIT-DELETE-COMPLETION-v1\u0000';
/** Hold-state generation domain (the freshness binding; ADR-035 §3). */
export const STORAGE_RETENTION_HOLD_STATE_GENERATION_DOMAIN = 'PGAP-STORAGE-RETENTION-HOLD-STATE-GENERATION-v1\u0000';
/** History-binding digest domain (ADR-035 §4). */
export const STORAGE_RETENTION_HISTORY_BINDING_DOMAIN = 'PGAP-STORAGE-RETENTION-HISTORY-BINDING-v1\u0000';

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

function storeTuple(storeInstance: VerifiedStoreInstance): readonly { readonly kind: string; readonly dev: number; readonly ino: number }[] {
  return storeInstance.namespaces
    .map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }))
    .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}

/**
 * Hold-state generation (ADR-035 §3): deterministic digest over the exact
 * (configuration identity, configuration version) the trusted authority
 * adjudicated. Storage re-derives it from the CURRENT genuine trusted
 * configuration at every mutation boundary and requires exact equality
 * with the decision's binding and the durable intent's binding. A new
 * hold (or policy change) advances the configuration snapshot, changes
 * this generation, and fails the freshness check — never wall-clock TTL.
 */
export function computeRetentionHoldStateGeneration(input: { readonly configurationIdentity: string; readonly configurationVersion: string }): string {
  if (!isValidDigestSyntax(input.configurationIdentity)) throw new TypeError('configurationIdentity must use sha-256:<64-hex> syntax');
  const tuple = { configurationIdentity: input.configurationIdentity, configurationVersion: input.configurationVersion };
  return computeDomainDigest(STORAGE_RETENTION_HOLD_STATE_GENERATION_DOMAIN, JSON.stringify(tuple));
}

/**
 * Deterministic history-binding digest (ADR-035 §4): domain digest over the
 * canonical projection of a WP-8-K inspection result — exact target facts,
 * verified history events (normative tuple order), recovery annotations,
 * closed findings, completeness, and generation/surface tokens. JCS
 * canonicalization keeps the projection deterministic; the digest is
 * recomputed by the mutation under the writer lock and must equal the
 * trusted decision's binding (a history change after intent fails closed).
 */
export function retentionHistoryBindingDigest(history: AuditHistoryInspectionResult): string | undefined {
  if (!history.ok || history.target === undefined || history.snapshot === undefined) return undefined;
  const projection = {
    target: {
      recordClass: history.target.recordClass,
      recordId: history.target.recordId,
      revision: history.target.revision,
      recordDigest: history.target.recordDigest,
      recordKind: history.target.recordKind,
      formatVersion: history.target.formatVersion,
      trustedActionId: history.target.trustedActionId,
      createdAt: history.target.createdAt,
    },
    status: history.status ?? null,
    events: (history.events ?? []).map((e) => ({
      eventId: e.eventId,
      eventKind: e.eventKind,
      digest: e.digest,
      createdAt: e.createdAt,
      trustedActionId: e.trustedActionId,
      isOriginalWrite: e.isOriginalWrite,
      ...(e.gapMarker === undefined ? {} : { gapMarker: e.gapMarker }),
    })),
    reconstructionEvidence: (history.reconstructionEvidence ?? []).map((a) => ({
      evidenceId: a.evidenceId,
      outcome: a.outcome,
      targetRecordDigest: a.targetRecordDigest,
      reconstructionAuditId: a.reconstructionAuditId,
      originalActionIdentity: a.originalActionIdentity,
      recoveryActionIdentity: a.recoveryActionIdentity,
      ...(a.linkedReconstructionEventId === undefined ? {} : { linkedReconstructionEventId: a.linkedReconstructionEventId }),
    })),
    auditFindings: (history.auditFindings ?? []).map((f) => ({
      kind: f.kind,
      ...(f.position === undefined ? {} : { position: f.position }),
      ...(f.eventId === undefined ? {} : { eventId: f.eventId }),
    })),
    completeness: history.completeness === undefined ? null : { complete: history.completeness.complete, truncated: history.completeness.truncated },
    snapshot: history.snapshot,
    ...(history.continuation === undefined ? {} : { continuation: { phase: history.continuation.phase, lastAuditShard: history.continuation.lastAuditShard ?? null, lastAuditEntry: history.continuation.lastAuditEntry ?? null, lastEvidenceShard: history.continuation.lastEvidenceShard ?? null, lastEvidenceEntry: history.continuation.lastEvidenceEntry ?? null } }),
  };
  return computeDomainDigest(STORAGE_RETENTION_HISTORY_BINDING_DOMAIN, JSON.stringify(projection));
}

/** Shared evidence-build result shape (mirrors the recovery evidence shape). */
export interface RetentionEvidenceBuild {
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

/** Decision/hold binding facts shared by every retention evidence payload. */
export interface RetentionDecisionBinding {
  readonly policyIdentity: string;
  readonly policyVersion: string;
  readonly decisionId: string;
  readonly holdStateGeneration: string;
  readonly holdResult: RetentionHoldResult;
}

/** Record-deletion intent input (identity binds the full factual tuple). */
export interface RetentionRecordIntentInput extends RetentionDecisionBinding {
  readonly storeInstance: VerifiedStoreInstance;
  readonly retentionOperation: 'retention-delete-record';
  readonly targetRecordClass: string;
  readonly targetRecordId: string;
  readonly targetRecordRevision: number;
  readonly targetRecordDigest: string;
  readonly historyDigest: string;
  readonly historyStatus: string;
  readonly generation: string;
  readonly surfaceGeneration: string;
  readonly createdAt: string;
}

/** Audit-deletion intent input. */
export interface RetentionAuditIntentInput extends RetentionDecisionBinding {
  readonly storeInstance: VerifiedStoreInstance;
  readonly retentionOperation: 'retention-delete-audit';
  readonly targetRecordClass: 'authoritative-audit-event';
  readonly targetRecordId: string;
  readonly targetRecordRevision: number;
  readonly targetRecordDigest: string;
  readonly referencedRecordId: string;
  readonly referencedRecordDigest: string;
  readonly primaryDeletionCompletionEvidenceId: string;
  readonly generation: string;
  readonly surfaceGeneration: string;
  readonly createdAt: string;
}

/** Record-deletion completion input (binds the exact durable intent). */
export interface RetentionRecordCompletionInput extends RetentionDecisionBinding {
  readonly storeInstance: VerifiedStoreInstance;
  readonly retentionOperation: 'retention-delete-record';
  readonly intentEvidenceId: string;
  readonly intentEvidenceDigest: string;
  readonly targetRecordClass: string;
  readonly targetRecordId: string;
  readonly targetRecordRevision: number;
  readonly targetRecordDigest: string;
  readonly historyDigest: string;
  readonly outcome: RetentionEvidenceOutcome;
  readonly generation: string;
  readonly surfaceGeneration: string;
  readonly createdAt: string;
}

/** Audit-deletion completion input. */
export interface RetentionAuditCompletionInput extends RetentionDecisionBinding {
  readonly storeInstance: VerifiedStoreInstance;
  readonly retentionOperation: 'retention-delete-audit';
  readonly intentEvidenceId: string;
  readonly intentEvidenceDigest: string;
  readonly targetRecordClass: 'authoritative-audit-event';
  readonly targetRecordId: string;
  readonly targetRecordRevision: number;
  readonly targetRecordDigest: string;
  readonly referencedRecordId: string;
  readonly referencedRecordDigest: string;
  readonly primaryDeletionCompletionEvidenceId: string;
  readonly outcome: RetentionEvidenceOutcome;
  readonly generation: string;
  readonly surfaceGeneration: string;
  readonly createdAt: string;
}

/** Record-deletion intent payload (bounded; no paths, no nonces). */
export function retentionRecordIntentPayload(input: RetentionRecordIntentInput): Readonly<Record<string, unknown>> {
  return {
    evidenceKind: 'retention-evidence',
    retentionOperation: input.retentionOperation,
    targetRecordClass: input.targetRecordClass,
    targetRecordId: input.targetRecordId,
    targetRecordRevision: input.targetRecordRevision,
    targetRecordDigest: input.targetRecordDigest,
    policyIdentity: input.policyIdentity,
    policyVersion: input.policyVersion,
    decisionId: input.decisionId,
    holdStateGeneration: input.holdStateGeneration,
    holdResult: input.holdResult,
    historyDigest: input.historyDigest,
    historyStatus: input.historyStatus,
    generation: input.generation,
    surfaceGeneration: input.surfaceGeneration,
    intendedResultingState: { recordAbsent: true, auditHistoryIntact: true },
  };
}

/** Deterministic record-delete intent identity (time/action/generation-free). */
export function computeRetentionRecordIntentIdentity(input: Omit<RetentionRecordIntentInput, 'generation' | 'surfaceGeneration' | 'createdAt'>): string {
  const tuple = {
    storeInstance: storeTuple(input.storeInstance),
    retentionOperation: input.retentionOperation,
    targetRecordClass: input.targetRecordClass,
    targetRecordId: input.targetRecordId,
    targetRecordRevision: input.targetRecordRevision,
    targetRecordDigest: input.targetRecordDigest,
    policyIdentity: input.policyIdentity,
    policyVersion: input.policyVersion,
    decisionId: input.decisionId,
    holdStateGeneration: input.holdStateGeneration,
    holdResult: input.holdResult,
    historyDigest: input.historyDigest,
    historyStatus: input.historyStatus,
    intendedResultingState: { recordAbsent: true, auditHistoryIntact: true },
  };
  const digest = computeDomainDigest(STORAGE_RETENTION_RECORD_DELETE_INTENT_DOMAIN, JSON.stringify(tuple));
  return `pgw:r:${digest.slice('sha-256:'.length, 'sha-256:'.length + 32)}`;
}

/** Audit-delete intent payload. */
export function retentionAuditIntentPayload(input: RetentionAuditIntentInput): Readonly<Record<string, unknown>> {
  return {
    evidenceKind: 'retention-evidence',
    retentionOperation: input.retentionOperation,
    targetRecordClass: input.targetRecordClass,
    targetRecordId: input.targetRecordId,
    targetRecordRevision: input.targetRecordRevision,
    targetRecordDigest: input.targetRecordDigest,
    referencedRecordId: input.referencedRecordId,
    referencedRecordDigest: input.referencedRecordDigest,
    primaryDeletionCompletionEvidenceId: input.primaryDeletionCompletionEvidenceId,
    policyIdentity: input.policyIdentity,
    policyVersion: input.policyVersion,
    decisionId: input.decisionId,
    holdStateGeneration: input.holdStateGeneration,
    holdResult: input.holdResult,
    generation: input.generation,
    surfaceGeneration: input.surfaceGeneration,
    intendedResultingState: { auditEventAbsent: true, referencedRecordAbsent: true },
  };
}

/** Deterministic audit-delete intent identity. */
export function computeRetentionAuditIntentIdentity(input: Omit<RetentionAuditIntentInput, 'generation' | 'surfaceGeneration' | 'createdAt'>): string {
  const tuple = {
    storeInstance: storeTuple(input.storeInstance),
    retentionOperation: input.retentionOperation,
    targetRecordClass: input.targetRecordClass,
    targetRecordId: input.targetRecordId,
    targetRecordRevision: input.targetRecordRevision,
    targetRecordDigest: input.targetRecordDigest,
    referencedRecordId: input.referencedRecordId,
    referencedRecordDigest: input.referencedRecordDigest,
    primaryDeletionCompletionEvidenceId: input.primaryDeletionCompletionEvidenceId,
    policyIdentity: input.policyIdentity,
    policyVersion: input.policyVersion,
    decisionId: input.decisionId,
    holdStateGeneration: input.holdStateGeneration,
    holdResult: input.holdResult,
    intendedResultingState: { auditEventAbsent: true, referencedRecordAbsent: true },
  };
  const digest = computeDomainDigest(STORAGE_RETENTION_AUDIT_DELETE_INTENT_DOMAIN, JSON.stringify(tuple));
  return `pgw:r:${digest.slice('sha-256:'.length, 'sha-256:'.length + 32)}`;
}

/** Record-delete completion payload. */
export function retentionRecordCompletionPayload(input: RetentionRecordCompletionInput): Readonly<Record<string, unknown>> {
  return {
    evidenceKind: 'retention-evidence',
    retentionOperation: input.retentionOperation,
    intentEvidenceId: input.intentEvidenceId,
    intentEvidenceDigest: input.intentEvidenceDigest,
    targetRecordClass: input.targetRecordClass,
    targetRecordId: input.targetRecordId,
    targetRecordRevision: input.targetRecordRevision,
    targetRecordDigest: input.targetRecordDigest,
    policyIdentity: input.policyIdentity,
    policyVersion: input.policyVersion,
    decisionId: input.decisionId,
    holdStateGeneration: input.holdStateGeneration,
    holdResult: input.holdResult,
    historyDigest: input.historyDigest,
    outcome: input.outcome,
    generation: input.generation,
    surfaceGeneration: input.surfaceGeneration,
    resultingState: { recordAbsent: true },
  };
}

/** Deterministic record-delete completion identity (binds the exact intent). */
export function computeRetentionRecordCompletionIdentity(input: Omit<RetentionRecordCompletionInput, 'intentEvidenceDigest' | 'historyDigest' | 'policyIdentity' | 'policyVersion' | 'decisionId' | 'holdStateGeneration' | 'holdResult' | 'generation' | 'surfaceGeneration' | 'createdAt'>): string {
  const tuple = {
    storeInstance: storeTuple(input.storeInstance),
    retentionOperation: input.retentionOperation,
    intentEvidenceId: input.intentEvidenceId,
    targetRecordClass: input.targetRecordClass,
    targetRecordId: input.targetRecordId,
    targetRecordRevision: input.targetRecordRevision,
    targetRecordDigest: input.targetRecordDigest,
    outcome: input.outcome,
  };
  const digest = computeDomainDigest(STORAGE_RETENTION_RECORD_DELETE_COMPLETION_DOMAIN, JSON.stringify(tuple));
  return `pgw:r:${digest.slice('sha-256:'.length, 'sha-256:'.length + 32)}`;
}

/** Audit-delete completion payload. */
export function retentionAuditCompletionPayload(input: RetentionAuditCompletionInput): Readonly<Record<string, unknown>> {
  return {
    evidenceKind: 'retention-evidence',
    retentionOperation: input.retentionOperation,
    intentEvidenceId: input.intentEvidenceId,
    intentEvidenceDigest: input.intentEvidenceDigest,
    targetRecordClass: input.targetRecordClass,
    targetRecordId: input.targetRecordId,
    targetRecordRevision: input.targetRecordRevision,
    targetRecordDigest: input.targetRecordDigest,
    referencedRecordId: input.referencedRecordId,
    referencedRecordDigest: input.referencedRecordDigest,
    primaryDeletionCompletionEvidenceId: input.primaryDeletionCompletionEvidenceId,
    policyIdentity: input.policyIdentity,
    policyVersion: input.policyVersion,
    decisionId: input.decisionId,
    holdStateGeneration: input.holdStateGeneration,
    holdResult: input.holdResult,
    outcome: input.outcome,
    generation: input.generation,
    surfaceGeneration: input.surfaceGeneration,
    resultingState: { auditEventAbsent: true },
  };
}

/** Deterministic audit-delete completion identity. */
export function computeRetentionAuditCompletionIdentity(input: Omit<RetentionAuditCompletionInput, 'intentEvidenceDigest' | 'referencedRecordId' | 'referencedRecordDigest' | 'primaryDeletionCompletionEvidenceId' | 'policyIdentity' | 'policyVersion' | 'decisionId' | 'holdStateGeneration' | 'holdResult' | 'generation' | 'surfaceGeneration' | 'createdAt'>): string {
  const tuple = {
    storeInstance: storeTuple(input.storeInstance),
    retentionOperation: input.retentionOperation,
    intentEvidenceId: input.intentEvidenceId,
    targetRecordClass: input.targetRecordClass,
    targetRecordId: input.targetRecordId,
    targetRecordRevision: input.targetRecordRevision,
    targetRecordDigest: input.targetRecordDigest,
    outcome: input.outcome,
  };
  const digest = computeDomainDigest(STORAGE_RETENTION_AUDIT_DELETE_COMPLETION_DOMAIN, JSON.stringify(tuple));
  return `pgw:r:${digest.slice('sha-256:'.length, 'sha-256:'.length + 32)}`;
}

/** Shared envelope construction for retention evidence (6.3; RFM). */
function buildRetentionEvidenceEnvelope(input: {
  readonly storeInstance: VerifiedStoreInstance;
  readonly actionIdentity: string;
  readonly recordId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly referenceDigests: readonly string[];
  readonly createdAt: string;
}): RetentionEvidenceBuild {
  const payloadDigest = computePayloadDigest(input.payload);
  const envelope: Readonly<Record<string, unknown>> = {
    recordKind: 'StoreEvidenceRecord',
    formatVersion: '1.0',
    recordId: input.recordId,
    revision: 1,
    createdAt: input.createdAt,
    trustedActionId: input.actionIdentity,
    payload: input.payload,
    payloadDigest,
    referenceDigests: [...input.referenceDigests],
    retentionClass: 'indefinite',
  };
  const canonical = canonicalEnvelopeBytes(envelope);
  const audit = buildAuthorizedWriteAuditEvent({
    storeInstance: input.storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
    primaryClass: 'store-evidence-record',
    primaryRecordId: input.recordId,
    primaryRevision: 1,
    primaryDigest: canonical.digest,
    eventKind: 'authorized-write',
    trustedActionIdentity: input.actionIdentity,
    primaryCreatedAt: input.createdAt,
  });
  if (!audit.ok || audit.event === undefined) {
    return { ok: false, code: 'ERR-STO-INTERNAL-INVARIANT', message: audit.message ?? 'retention evidence audit event could not be constructed' };
  }
  return {
    ok: true,
    record: {
      recordId: input.recordId,
      canonicalUtf8: canonical.canonicalUtf8,
      digest: canonical.digest,
      createdAt: input.createdAt,
      auditCanonicalUtf8: audit.event.canonicalUtf8,
      auditDigest: audit.event.digest,
      auditEventId: audit.event.recordId,
    },
  };
}

/** Pure deterministic record-delete intent evidence construction. */
export function buildRetentionRecordIntentEvidence(input: RetentionRecordIntentInput & { readonly actionIdentity: string }): RetentionEvidenceBuild {
  if (!isValidDigestSyntax(input.targetRecordDigest) || !isValidDigestSyntax(input.historyDigest) || !isValidDigestSyntax(input.holdStateGeneration)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'retention intent digest bindings are malformed' };
  }
  const recordId = computeRetentionRecordIntentIdentity(input);
  return buildRetentionEvidenceEnvelope({
    storeInstance: input.storeInstance,
    actionIdentity: input.actionIdentity,
    recordId,
    payload: retentionRecordIntentPayload(input),
    referenceDigests: [input.targetRecordDigest],
    createdAt: input.createdAt,
  });
}

/** Pure deterministic audit-delete intent evidence construction. */
export function buildRetentionAuditIntentEvidence(input: RetentionAuditIntentInput & { readonly actionIdentity: string }): RetentionEvidenceBuild {
  if (!isValidDigestSyntax(input.targetRecordDigest) || !isValidDigestSyntax(input.referencedRecordDigest) || !isValidDigestSyntax(input.holdStateGeneration)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'retention audit intent digest bindings are malformed' };
  }
  const recordId = computeRetentionAuditIntentIdentity(input);
  return buildRetentionEvidenceEnvelope({
    storeInstance: input.storeInstance,
    actionIdentity: input.actionIdentity,
    recordId,
    payload: retentionAuditIntentPayload(input),
    referenceDigests: [input.referencedRecordDigest, input.targetRecordDigest],
    createdAt: input.createdAt,
  });
}

/** Pure deterministic record-delete completion evidence construction. */
export function buildRetentionRecordCompletionEvidence(input: RetentionRecordCompletionInput & { readonly actionIdentity: string }): RetentionEvidenceBuild {
  if (!isValidDigestSyntax(input.intentEvidenceDigest) || !isValidDigestSyntax(input.targetRecordDigest) || !isValidDigestSyntax(input.historyDigest) || !isValidDigestSyntax(input.holdStateGeneration)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'retention completion digest bindings are malformed' };
  }
  const recordId = computeRetentionRecordCompletionIdentity(input);
  return buildRetentionEvidenceEnvelope({
    storeInstance: input.storeInstance,
    actionIdentity: input.actionIdentity,
    recordId,
    payload: retentionRecordCompletionPayload(input),
    referenceDigests: [input.intentEvidenceDigest, input.targetRecordDigest],
    createdAt: input.createdAt,
  });
}

/** Pure deterministic audit-delete completion evidence construction. */
export function buildRetentionAuditCompletionEvidence(input: RetentionAuditCompletionInput & { readonly actionIdentity: string }): RetentionEvidenceBuild {
  if (!isValidDigestSyntax(input.intentEvidenceDigest) || !isValidDigestSyntax(input.targetRecordDigest) || !isValidDigestSyntax(input.referencedRecordDigest) || !isValidDigestSyntax(input.holdStateGeneration)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'retention audit completion digest bindings are malformed' };
  }
  const recordId = computeRetentionAuditCompletionIdentity(input);
  return buildRetentionEvidenceEnvelope({
    storeInstance: input.storeInstance,
    actionIdentity: input.actionIdentity,
    recordId,
    payload: retentionAuditCompletionPayload(input),
    referenceDigests: [input.intentEvidenceDigest, input.targetRecordDigest],
    createdAt: input.createdAt,
  });
}

/**
 * Read the parsed payload of one durable retention evidence record at its
 * derived path (conflict classification; never authority). Returns the raw
 * payload when the object verifies.
 */
export function readRetentionEvidencePayload(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly evidenceId: string;
}): { readonly ok: boolean; readonly payload?: Readonly<Record<string, unknown>>; readonly code?: string; readonly message?: string } {
  const derived = deriveRecordRelativePath('store-evidence-record', input.evidenceId);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'retention evidence path derivation failed' };
  }
  const existing = verifyObjectBytesAt({ path: `${input.namespaceRoot}/${derived.relativePath}`, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
  if (!existing.ok) {
    return { ok: false, code: existing.code ?? 'ERR-STO-INTEGRITY', message: existing.message ?? 'retention evidence could not be read' };
  }
  const parsed = parsePersistedEnvelope(existing.canonicalUtf8 ?? '', input.byteLimit);
  if (!parsed.ok || parsed.model === undefined) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'retention evidence record is not a canonical envelope' };
  }
  const model = parsed.model as Readonly<Record<string, unknown>>;
  const payload = model['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'retention evidence payload is malformed' };
  }
  return { ok: true, payload: payload as Readonly<Record<string, unknown>> };
}

/** Verify one durable retention evidence record at its derived path against factual bindings. */
function verifyRetentionEvidenceAt(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly evidenceId: string;
  readonly expect: (p: Readonly<Record<string, unknown>>, model: Readonly<Record<string, unknown>>) => boolean;
}): { readonly ok: boolean; readonly matches?: boolean; readonly code?: string; readonly message?: string } {
  const derived = deriveRecordRelativePath('store-evidence-record', input.evidenceId);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'retention evidence path derivation failed' };
  }
  const existing = verifyObjectBytesAt({ path: `${input.namespaceRoot}/${derived.relativePath}`, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
  if (!existing.ok) {
    if (existing.code === 'ERR-STO-NOT-FOUND') return { ok: true, matches: false };
    return { ok: false, code: existing.code, message: existing.message };
  }
  const parsed = parsePersistedEnvelope(existing.canonicalUtf8 ?? '', input.byteLimit);
  if (!parsed.ok || parsed.model === undefined) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'existing retention evidence record is not a canonical envelope' };
  }
  const model = parsed.model as Readonly<Record<string, unknown>>;
  if (model['recordKind'] !== 'StoreEvidenceRecord') {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'existing retention evidence target is not a StoreEvidenceRecord' };
  }
  const payload = model['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'existing retention evidence payload is malformed' };
  }
  const matches = input.expect(payload as Readonly<Record<string, unknown>>, model);
  if (!matches) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'existing retention evidence conflicts with the authorized request' };
  }
  return { ok: true, matches: true };
}

/** Existing record-delete intent verification (idempotency classification). */
export function verifyExistingRetentionRecordIntent(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly evidenceId: string;
  readonly targetRecordId: string;
  readonly targetRecordRevision: number;
  readonly targetRecordDigest: string;
  readonly policyIdentity: string;
  readonly policyVersion: string;
  readonly decisionId: string;
  readonly holdStateGeneration: string;
  readonly holdResult: RetentionHoldResult;
  readonly historyDigest: string;
}): { readonly ok: boolean; readonly matches?: boolean; readonly code?: string; readonly message?: string } {
  return verifyRetentionEvidenceAt({
    namespaceRoot: input.namespaceRoot,
    serviceUid: input.serviceUid,
    byteLimit: input.byteLimit,
    evidenceId: input.evidenceId,
    expect: (p) =>
      p['evidenceKind'] === 'retention-evidence' &&
      p['retentionOperation'] === 'retention-delete-record' &&
      p['targetRecordId'] === input.targetRecordId &&
      p['targetRecordRevision'] === input.targetRecordRevision &&
      p['targetRecordDigest'] === input.targetRecordDigest &&
      p['policyIdentity'] === input.policyIdentity &&
      p['policyVersion'] === input.policyVersion &&
      p['decisionId'] === input.decisionId &&
      p['holdStateGeneration'] === input.holdStateGeneration &&
      p['holdResult'] === input.holdResult &&
      p['historyDigest'] === input.historyDigest,
  });
}

/** Existing audit-delete intent verification. */
export function verifyExistingRetentionAuditIntent(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly evidenceId: string;
  readonly targetRecordId: string;
  readonly targetRecordRevision: number;
  readonly targetRecordDigest: string;
  readonly referencedRecordId: string;
  readonly referencedRecordDigest: string;
  readonly primaryDeletionCompletionEvidenceId: string;
  readonly policyIdentity: string;
  readonly policyVersion: string;
  readonly decisionId: string;
  readonly holdStateGeneration: string;
  readonly holdResult: RetentionHoldResult;
}): { readonly ok: boolean; readonly matches?: boolean; readonly code?: string; readonly message?: string } {
  return verifyRetentionEvidenceAt({
    namespaceRoot: input.namespaceRoot,
    serviceUid: input.serviceUid,
    byteLimit: input.byteLimit,
    evidenceId: input.evidenceId,
    expect: (p) =>
      p['evidenceKind'] === 'retention-evidence' &&
      p['retentionOperation'] === 'retention-delete-audit' &&
      p['targetRecordId'] === input.targetRecordId &&
      p['targetRecordRevision'] === input.targetRecordRevision &&
      p['targetRecordDigest'] === input.targetRecordDigest &&
      p['referencedRecordId'] === input.referencedRecordId &&
      p['referencedRecordDigest'] === input.referencedRecordDigest &&
      p['primaryDeletionCompletionEvidenceId'] === input.primaryDeletionCompletionEvidenceId &&
      p['policyIdentity'] === input.policyIdentity &&
      p['policyVersion'] === input.policyVersion &&
      p['decisionId'] === input.decisionId &&
      p['holdStateGeneration'] === input.holdStateGeneration &&
      p['holdResult'] === input.holdResult,
  });
}

/** Existing record-delete completion verification (roll-forward/already-completed classification). */
export function verifyExistingRetentionRecordCompletion(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly evidenceId: string;
  /** Exact intent binding; checked only when the caller can derive it (the record-delete flow always can). */
  readonly intentEvidenceId?: string;
  /** Exact target class binding; checked only when supplied (the audit-delete gate supplies it). */
  readonly targetRecordClass?: string;
  readonly targetRecordId: string;
  /** Exact revision binding; checked only when supplied. */
  readonly targetRecordRevision?: number;
  readonly targetRecordDigest: string;
}): { readonly ok: boolean; readonly matches?: boolean; readonly code?: string; readonly message?: string } {
  return verifyRetentionEvidenceAt({
    namespaceRoot: input.namespaceRoot,
    serviceUid: input.serviceUid,
    byteLimit: input.byteLimit,
    evidenceId: input.evidenceId,
    expect: (p) => {
      if (p['evidenceKind'] !== 'retention-evidence' || p['retentionOperation'] !== 'retention-delete-record') return false;
      if (p['targetRecordId'] !== input.targetRecordId || p['targetRecordDigest'] !== input.targetRecordDigest) return false;
      if (input.intentEvidenceId !== undefined && p['intentEvidenceId'] !== input.intentEvidenceId) return false;
      if (input.targetRecordClass !== undefined && p['targetRecordClass'] !== input.targetRecordClass) return false;
      if (input.targetRecordRevision !== undefined && p['targetRecordRevision'] !== input.targetRecordRevision) return false;
      return p['outcome'] === 'deleted' || p['outcome'] === 'already-completed';
    },
  });
}

/** Existing audit-delete completion verification. */
export function verifyExistingRetentionAuditCompletion(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly evidenceId: string;
  readonly intentEvidenceId: string;
  readonly targetRecordId: string;
  readonly targetRecordRevision: number;
  readonly targetRecordDigest: string;
  readonly referencedRecordId: string;
  readonly referencedRecordDigest: string;
  readonly primaryDeletionCompletionEvidenceId: string;
}): { readonly ok: boolean; readonly matches?: boolean; readonly code?: string; readonly message?: string } {
  return verifyRetentionEvidenceAt({
    namespaceRoot: input.namespaceRoot,
    serviceUid: input.serviceUid,
    byteLimit: input.byteLimit,
    evidenceId: input.evidenceId,
    expect: (p) =>
      p['evidenceKind'] === 'retention-evidence' &&
      p['retentionOperation'] === 'retention-delete-audit' &&
      p['intentEvidenceId'] === input.intentEvidenceId &&
      p['targetRecordId'] === input.targetRecordId &&
      p['targetRecordRevision'] === input.targetRecordRevision &&
      p['targetRecordDigest'] === input.targetRecordDigest &&
      p['referencedRecordId'] === input.referencedRecordId &&
      p['referencedRecordDigest'] === input.referencedRecordDigest &&
      p['primaryDeletionCompletionEvidenceId'] === input.primaryDeletionCompletionEvidenceId &&
      (p['outcome'] === 'deleted' || p['outcome'] === 'already-completed'),
  });
}

/** Retention publication hooks (stage/fsync injection). */
export interface RetentionEvidenceHooks {
  readonly fsyncFile?: (fd: number) => void;
  readonly fsyncDirectory?: (path: string) => void;
}

export interface RetentionEvidencePublishResult {
  readonly ok: boolean;
  readonly outcome?: 'published' | 'already-completed';
  readonly evidenceId?: string;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Publish one retention evidence record and its mechanical authorized-write
 * audit through the exact-record retention permit pipeline (§15.4). EEXIST
 * replay classification mirrors the write path: an existing evidence final
 * object is verified byte-exact (already-completed) or rejected; an
 * existing temporary is never adopted or unlinked. Success requires the
 * evidence and its audit to be durable.
 */
export function publishRetentionEvidence(input: {
  readonly capability: RetentionCapability;
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly record: NonNullable<RetentionEvidenceBuild['record']>;
  readonly operation: 'retention-delete-record' | 'retention-delete-audit';
  readonly hooks?: RetentionEvidenceHooks;
}): RetentionEvidencePublishResult {
  if (!isGenuineRetentionCapability(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'retention capability operand is not genuine' };
  }
  const check = input.capability.verify(input.operation);
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'retention capability is not usable at the evidence boundary' };
  }
  const evidenceDerived = deriveRecordRelativePath('store-evidence-record', input.record.recordId);
  if (!evidenceDerived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'retention evidence path derivation failed' };
  }
  const evidencePermit = createRetentionPublicationPermit({
    capability: input.capability,
    operation: input.operation,
    role: 'retention-evidence',
    recordId: input.record.recordId,
    recordDigest: input.record.digest,
    canonicalBytesDigest: input.record.digest,
    destinationDesignation: evidenceDerived.relativePath,
  });
  if (evidencePermit === undefined) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'retention evidence permit could not be issued' };
  }
  try {
    const published = publishRetentionBoundRecord({
      permit: evidencePermit,
      canonicalUtf8: input.record.canonicalUtf8,
      byteLimit: input.byteLimit,
      serviceUid: input.serviceUid,
      hooks: input.hooks,
    });
    if (!published.ok) {
      // EEXIST replay classification: verify the existing evidence final
      // object byte-exact; never adopt or unlink a temp.
      const existing = verifyObjectBytesAt({ path: `${input.namespaceRoot}/${evidenceDerived.relativePath}`, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
      if (existing.ok && existing.canonicalUtf8 === input.record.canonicalUtf8 && existing.digest === input.record.digest) {
        return { ok: true, outcome: 'already-completed', evidenceId: input.record.recordId };
      }
      return { ok: false, code: published.code ?? 'ERR-STO-DURABILITY', message: published.message ?? 'retention evidence publication did not reach its durability point' };
    }
    const auditDerived = deriveRecordRelativePath('authoritative-audit-event', input.record.auditEventId);
    if (!auditDerived.ok) {
      return { ok: false, code: 'ERR-STO-DURABILITY', message: 'retention evidence audit path derivation failed' };
    }
    const auditPermit = createRetentionPublicationPermit({
      capability: input.capability,
      operation: input.operation,
      role: 'retention-authorized-write-audit',
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
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'retention audit permit could not be issued' };
    }
    try {
      const auditPublished = publishRetentionBoundRecord({
        permit: auditPermit,
        canonicalUtf8: input.record.auditCanonicalUtf8,
        byteLimit: input.byteLimit,
        serviceUid: input.serviceUid,
        hooks: input.hooks,
      });
      if (!auditPublished.ok) {
        return { ok: false, code: auditPublished.code ?? 'ERR-STO-DURABILITY', message: auditPublished.message ?? 'retention evidence audit did not reach its durability point' };
      }
      return { ok: true, outcome: 'published', evidenceId: input.record.recordId };
    } finally {
      auditPermit.dispose();
    }
  } finally {
    evidencePermit.dispose();
  }
}

/** Verify every required durability point of one retention evidence publication. */
export function verifyRetentionEvidenceDurability(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly record: NonNullable<RetentionEvidenceBuild['record']>;
}): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  const evidenceDerived = deriveRecordRelativePath('store-evidence-record', input.record.recordId);
  const auditDerived = deriveRecordRelativePath('authoritative-audit-event', input.record.auditEventId);
  if (!evidenceDerived.ok || !auditDerived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'retention evidence durability derivation failed' };
  }
  const points: ReadonlyArray<{ readonly path: string; readonly expectedDigest: string; readonly label: string }> = [
    { path: `${input.namespaceRoot}/${evidenceDerived.relativePath}`, expectedDigest: input.record.digest, label: 'retention evidence' },
    { path: `${input.namespaceRoot}/${auditDerived.relativePath}`, expectedDigest: input.record.auditDigest, label: 'retention evidence audit' },
  ];
  for (const point of points) {
    const durable = verifyObjectBytesAt({ path: point.path, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
    if (!durable.ok || durable.digest !== point.expectedDigest) {
      return { ok: false, code: 'ERR-STO-DURABILITY', message: `${point.label} durability point is not verified` };
    }
  }
  return { ok: true };
}
