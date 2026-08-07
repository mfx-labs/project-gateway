/**
 * WP-8-F/WP-8-G authorized recovery-mutation composition boundary (contract
 * 16.2, WPR-023 (a), CSA-001/010/013/014, CAP-008/009, LOK; contract 21.1
 * recovery capability). FILESYSTEM-FREE: all filesystem work is delegated
 * to the exact fs-bearing owners (`recovery/reverify.ts`,
 * `recovery/cleanup.ts`, `locks/lock.ts`, `publication/publish-record.ts`).
 *
 * Authority: the sole production consumer of the recovery-capability,
 * trusted-recovery-request, and recovery-action-provenance creators
 * (static-guard enforced). Zero production recovery-action-provenance
 * producers exist, so production recovery mutation is UNREACHABLE: the
 * recovery capability can only be created from a genuine branded
 * `TrustedRecoveryRequest`, which requires genuine branded recovery-action
 * provenance. A `RecoveryPlan`, assessment, cursor, observation, path,
 * filename, environment value, or caller boolean NEVER grants authority.
 *
 * Mutation model (WP-8-F §3/§4): genuine trusted input + genuine recovery
 * provenance → store revalidation → recovery capability → assessment-
 * generation and surface-generation recomputation and comparison → single-
 * writer lock acquisition (never broken or replaced) → descriptor-bound
 * target/twin re-verification → exact mutation (temporary-name unlink with
 * `tmp/` directory fsync; quarantine hard-link plus unlink; reconstructed
 * `recovery-audit-reconstruction` event publication) → durable recovery
 * evidence (StoreEvidenceRecord `recovery-evidence` + its authorized-write
 * audit event) → capability and root revalidation → identity-bound lock
 * release. Any mismatch fails closed before any mutation.
 *
 * Interrupted-removal roll-forward: when the temporary name is already gone
 * but the durable twin is intact and unchanged, the mutation completes the
 * evidence half (provable roll-forward of the removal fact); when the
 * evidence is already durable with a matching factual binding, the result
 * is deterministic `already-completed` — never a re-unlink, never a second
 * evidence record.
 *
 * Quarantine category requests are rejected deterministically: the contract
 * reserves `quarantine/` (5.2; D-7) but defines no destination layout or
 * mutation primitive, so quarantine execution is contract-decision-gated
 * and never guessed.
 */
import { createRecoveryCapability, type RecoveryCapability } from '../capabilities/authenticity.js';
import { createTrustedRecoveryRequest, isGenuineTrustedStorageBootstrapInput } from '../trusted-input/bootstrap-input.js';
import { verifyStoreInstance } from '../read/read-record.js';
import { revalidateParentIdentity } from '../root/resolve.js';
import { runRegistrySnapshotScan } from '../registry/compose.js';
import { buildRegistryIndex, parseRegistryIndex, registryIndexManifest, REGISTRY_INDEX_MAX_ENTRIES } from '../registry/index-model.js';
import { probeRegistryEntrySet, readRegistryIndexFile, compareManifestAgainstProbe } from '../registry/index-store.js';
import { publishRegistryIndex } from './index-rebuild.js';
import { computeScanGeneration, recordObservationId, auditEventsForRecord, reconstructionEvidenceForTarget, temporaryObservationId, quarantineObservationId, indexObservationId, currentTemporaryObservation, currentQuarantineObservation, currentIndexObservation, recomputeSurfaceGeneration, isPublicationTemporaryName } from './scan.js';
import { reverifyOrphanTwin, reverifyQuarantineSource, reverifyTwinOnly, reverifyReconstructionTarget } from './reverify.js';
import { removeOrphanTemporary } from './cleanup.js';
import { executeQuarantineTemporary } from './quarantine.js';
import { buildQuarantineEvidenceRecord, buildRecoveryEvidenceRecord, computeQuarantineEvidenceIdentity, computeQuarantineTemporaryId, publishRecoveryEvidence, verifyExistingRecoveryEvidence, isoFromEpochMs, buildDispositionEvidenceRecord, computeDispositionEvidenceIdentity, verifyExistingDispositionEvidence } from './evidence.js';
import { unlinkVerifiedTarget, fsyncContainingDirectory } from './disposition.js';
import { buildRecoveryAuditReconstructionEvent, AUTHORIZED_WRITE_EVENT_KIND, RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND } from '../audit/write-audit.js';
import {
  buildAuditReconstructionEvidenceRecord,
  publishReconstructedAudit,
  publishAuditReconstructionEvidence,
  isReconstructionTargetClass,
} from './reconstruct.js';
import { verifyObjectBytesAt } from '../publication/publish-record.js';
import { acquireWriterLock, releaseWriterLock } from '../locks/lock.js';
import { deriveRecordRelativePath } from '../layout/layout.js';
import { isValidDigestSyntax } from '../format/envelope.js';
import { RECORD_CLASS_BY_ID } from '../format/taxonomy.js';
import type { RecoveryMutationRequest, RecoveryMutationResult, RecordClassId, StorageFinding, VerifiedStoreInstance } from '../types.js';

const NO_STATE = { retryable: false, recoveryRequired: false, primaryStateChanged: 'no' as const, durabilityPointReached: 'no' as const, auditChanged: 'no' as const, verifyBeforeRetry: false };

function finding(code: string, message: string, phase: StorageFinding['phase'] = 'request-validation'): StorageFinding {
  return { code, message, phase, state: NO_STATE };
}

function failResult(code: string, message: string): RecoveryMutationResult {
  return { ok: false, findings: [finding(code, message)] };
}

/** Closed twin-class acceptance: any store-records `.rec` class or the audit class. */
function isTwinClass(recordClass: RecordClassId): boolean {
  const profile = RECORD_CLASS_BY_ID.get(recordClass);
  return profile !== undefined && profile.namespace === 'store-records' && profile.id !== 'store-metadata';
}

/** Target-class acceptance for audit reconstruction (WP-8-G §2; 16.3). */
function isReconstructionClass(recordClass: RecordClassId): boolean {
  return isReconstructionTargetClass(recordClass);
}

/** Validate the narrow structured action (never a plan action; never a path). */
function validateAction(input: RecoveryMutationRequest): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  const action = input.action;
  if (typeof action !== 'object' || action === null) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery action is malformed' };
  }
  if (action.category !== 'orphan-removal' && action.category !== 'quarantine-temporary' && action.category !== 'audit-reconstruction' && action.category !== 'registry-index-rebuild' && action.category !== 'dispose-wpr023d-temporary' && action.category !== 'dispose-quarantined-temporary' && action.category !== 'dispose-conflicting-index') {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery action category is outside the supported vocabulary; no generic quarantine authority exists' };
  }
  if (action.category === 'audit-reconstruction') {
    if (action.targetRecordClass === undefined || !isReconstructionClass(action.targetRecordClass)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target record class is outside the reconstructable store-records vocabulary' };
    }
    if (typeof action.targetRecordId !== 'string' || !/^pgw:r:[0-9a-f]{32}$/.test(action.targetRecordId)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target record identity is not a canonical typed identifier' };
    }
    if (typeof action.targetRecordDigest !== 'string' || !isValidDigestSyntax(action.targetRecordDigest)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target record digest is malformed' };
    }
    if (typeof action.expectedOriginalActionIdentity !== 'string' || action.expectedOriginalActionIdentity.length === 0) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected original trusted action identity is malformed' };
    }
    if (!Array.isArray(action.expectedObservationIds) || action.expectedObservationIds.length !== 1 || typeof action.expectedObservationIds[0] !== 'string') {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected observation evidence identifiers are malformed' };
    }
    if (typeof action.expectedMissingAuditFindingId !== 'string' || action.expectedMissingAuditFindingId.length === 0) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected missing-audit finding identifier is malformed' };
    }
    if (typeof action.expectedGeneration !== 'string' || !isValidDigestSyntax(action.expectedGeneration)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected scan generation is malformed' };
    }
    if (typeof action.expectedSurfaceGeneration !== 'string' || !isValidDigestSyntax(action.expectedSurfaceGeneration)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected surface generation is malformed' };
    }
    return { ok: true };
  }
  if (action.category === 'quarantine-temporary') {
    if (typeof action.targetEntry !== 'string' || !isPublicationTemporaryName(action.targetEntry)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target entry is not a publication temporary designation' };
    }
    if (action.expectedClassification !== 'incomplete-unpublished' && action.expectedClassification !== 'malformed-temporary') {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'quarantine classification is outside the eligible WPR-023 (b)/(c) vocabulary' };
    }
    if (typeof action.expectedSourceDigest !== 'string' || !isValidDigestSyntax(action.expectedSourceDigest)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected source digest is malformed' };
    }
    return { ok: true };
  }
  if (action.category === 'registry-index-rebuild') {
    if (typeof action.expectedRegistryGeneration !== 'string' || !isValidDigestSyntax(action.expectedRegistryGeneration)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected registry generation is malformed' };
    }
    if (typeof action.expectedRegistrySurfaceGeneration !== 'string' || !isValidDigestSyntax(action.expectedRegistrySurfaceGeneration)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected registry surface generation is malformed' };
    }
    return { ok: true };
  }
  // WP-8-I external-disposition categories: narrow structured adjudication
  // actions binding only closed identifiers (surface, entry, shard,
  // observation/finding ids, exact classification/code, type/digest where
  // available, generation/surface tokens). Never a path, descriptor,
  // callback, fs function, plan action, or lock nonce.
  if (action.category === 'dispose-wpr023d-temporary') {
    if (typeof action.targetEntry !== 'string' || !isPublicationTemporaryName(action.targetEntry)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target entry is not a publication temporary designation' };
    }
    if (action.expectedDispositionClassification !== 'temporary-other') {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'disposition classification is outside the WPR-023 (d) vocabulary' };
    }
    if (action.expectedCode !== 'ERR-STO-FTYPE-UNSUPPORTED' && action.expectedCode !== 'ERR-STO-PERM-DENIED' && action.expectedCode !== 'ERR-STO-INTEGRITY') {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected observation code is outside the WPR-023 (d) vocabulary' };
    }
    if (action.expectedEntryType !== 'regular' && action.expectedEntryType !== 'symlink' && action.expectedEntryType !== 'special' && action.expectedEntryType !== 'directory') {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected entry type is outside the closed vocabulary' };
    }
    if (!Array.isArray(action.expectedObservationIds) || action.expectedObservationIds.length !== 1 || typeof action.expectedObservationIds[0] !== 'string') {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected observation evidence identifiers are malformed' };
    }
    if (typeof action.expectedDispositionFindingId !== 'string' || action.expectedDispositionFindingId.length === 0) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected disposition finding identifier is malformed' };
    }
    if (typeof action.expectedGeneration !== 'string' || !isValidDigestSyntax(action.expectedGeneration)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected scan generation is malformed' };
    }
    if (typeof action.expectedSurfaceGeneration !== 'string' || !isValidDigestSyntax(action.expectedSurfaceGeneration)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected surface generation is malformed' };
    }
    return { ok: true };
  }
  if (action.category === 'dispose-quarantined-temporary') {
    if (typeof action.targetEntry !== 'string' || action.targetEntry.length === 0 || action.targetEntry.includes('/') || action.targetEntry === '.' || action.targetEntry === '..' || action.targetEntry === 'temporary') {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target entry is not a quarantine entry designation' };
    }
    if (typeof action.targetShard !== 'string' || (action.targetShard !== '' && !/^[0-9a-f]{4}$/.test(action.targetShard))) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target shard is not a closed quarantine shard designation' };
    }
    const quarantineDispositionClassifications: readonly string[] = ['quarantine-malformed', 'foreign-entry', 'quarantine-conflict', 'unexpected-hard-link', 'wrong-type', 'wrong-uid-or-mode'];
    if (action.expectedDispositionClassification === undefined || !quarantineDispositionClassifications.includes(action.expectedDispositionClassification)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'disposition classification is outside the quarantine-object disposition vocabulary' };
    }
    if (typeof action.expectedCode !== 'string' || action.expectedCode.length === 0) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected observation code is malformed' };
    }
    if (action.expectedContentDigest !== undefined && !isValidDigestSyntax(action.expectedContentDigest)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected content digest is malformed' };
    }
    if (!Array.isArray(action.expectedObservationIds) || action.expectedObservationIds.length !== 1 || typeof action.expectedObservationIds[0] !== 'string') {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected observation evidence identifiers are malformed' };
    }
    if (typeof action.expectedDispositionFindingId !== 'string' || action.expectedDispositionFindingId.length === 0) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected disposition finding identifier is malformed' };
    }
    if (typeof action.expectedGeneration !== 'string' || !isValidDigestSyntax(action.expectedGeneration)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected scan generation is malformed' };
    }
    if (typeof action.expectedSurfaceGeneration !== 'string' || !isValidDigestSyntax(action.expectedSurfaceGeneration)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected surface generation is malformed' };
    }
    return { ok: true };
  }
  if (action.category === 'dispose-conflicting-index') {
    if (typeof action.targetEntry !== 'string' || !/^[0-9a-f]{32}\.idx$/.test(action.targetEntry)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target entry is not a registry-index artifact designation' };
    }
    if (typeof action.targetShard !== 'string' || !/^[0-9a-f]{4}$/.test(action.targetShard)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target shard is not a 4-hex index shard designation' };
    }
    if (action.expectedDispositionClassification !== 'index-conflicting') {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'disposition classification is outside the conflicting-index vocabulary' };
    }
    if (action.expectedCode !== 'ERR-STO-INTEGRITY') {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected observation code is outside the conflicting-index vocabulary' };
    }
    if (!Array.isArray(action.expectedObservationIds) || action.expectedObservationIds.length !== 1 || typeof action.expectedObservationIds[0] !== 'string') {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected observation evidence identifiers are malformed' };
    }
    if (typeof action.expectedDispositionFindingId !== 'string' || action.expectedDispositionFindingId.length === 0) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected disposition finding identifier is malformed' };
    }
    if (typeof action.expectedGeneration !== 'string' || !isValidDigestSyntax(action.expectedGeneration)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected scan generation is malformed' };
    }
    if (typeof action.expectedSurfaceGeneration !== 'string' || !isValidDigestSyntax(action.expectedSurfaceGeneration)) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected surface generation is malformed' };
    }
    return { ok: true };
  }
  if (typeof action.targetEntry !== 'string' || !isPublicationTemporaryName(action.targetEntry)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'target entry is not a publication temporary designation' };
  }
  if (typeof action.expectedTwinRecordId !== 'string' || !/^pgw:[rl]:[0-9a-f]{32}$/.test(action.expectedTwinRecordId)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected twin identity is not a canonical typed identifier' };
  }
  if (action.expectedTwinRecordClass === undefined || !isTwinClass(action.expectedTwinRecordClass)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected twin record class is not a store-records class' };
  }
  if (typeof action.expectedTwinDigest !== 'string' || !isValidDigestSyntax(action.expectedTwinDigest)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected twin digest is malformed' };
  }
  if (!Number.isSafeInteger(action.expectedLinkCount) || action.expectedLinkCount! < 2 || action.expectedLinkCount! > 64) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected link count is outside the accepted range' };
  }
  if (!Array.isArray(action.expectedObservationIds) || action.expectedObservationIds.length !== 1 || typeof action.expectedObservationIds[0] !== 'string') {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected observation evidence identifiers are malformed' };
  }
  if (typeof action.expectedGeneration !== 'string' || !isValidDigestSyntax(action.expectedGeneration)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected scan generation is malformed' };
  }
  if (typeof action.expectedSurfaceGeneration !== 'string' || !isValidDigestSyntax(action.expectedSurfaceGeneration)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected surface generation is malformed' };
  }
  return { ok: true };
}

/** Quarantine-temporary mutation flow (ADR-030; §16.5). */
function executeQuarantineMutation(
  request: RecoveryMutationRequest,
  action: RecoveryMutationRequest['action'] & { category: 'quarantine-temporary' },
  hooks: NonNullable<RecoveryMutationRequest['hooks']>,
): RecoveryMutationResult {
  const expectedClassification = action.expectedClassification as 'incomplete-unpublished' | 'malformed-temporary' | undefined;
  const targetEntryName = action.targetEntry as string | undefined;
  const expectedSourceDigest = action.expectedSourceDigest as string | undefined;
  if (expectedClassification === undefined || expectedSourceDigest === undefined || targetEntryName === undefined) {
    return failResult('ERR-STO-REQ-INVALID', 'quarantine request is missing the expected classification, source digest, or target entry');
  }
  const classification = expectedClassification as 'incomplete-unpublished' | 'malformed-temporary';
  const sourceDigest = expectedSourceDigest as string;

  const inputResult = createTrustedRecoveryRequest(
    request.trustedConfiguration,
    request.recoveryActionProvenance,
    { locator: request.locator, serviceUid: request.serviceUid, forbiddenRoots: request.forbiddenRoots, limitProfile: request.limitProfile },
  );
  if (!inputResult.ok || inputResult.request === undefined) {
    const code = inputResult.reason === 'not-genuine-configuration' || inputResult.reason === 'not-genuine-action-provenance' || inputResult.reason === 'configuration-identity-mismatch'
      ? 'ERR-STO-CONFIG-UNAVAILABLE'
      : 'ERR-STO-REQ-INVALID';
    return failResult(code, inputResult.message ?? 'trusted recovery request could not be established');
  }
  const store = verifyStoreInstance({
    locator: request.locator,
    serviceUid: request.serviceUid,
    forbiddenRoots: request.forbiddenRoots,
    configurationIdentity: (request.trustedConfiguration as { readonly identity: string }).identity,
    configurationVersion: (request.trustedConfiguration as { readonly configurationVersion: string }).configurationVersion,
    limitProfile: request.limitProfile,
  });
  if (!store.ok || store.storeInstance === undefined) {
    return failResult(store.code ?? 'ERR-STO-INTEGRITY', store.message ?? 'store revalidation failed');
  }
  const storeInstance = store.storeInstance;
  const recoveryCapability = createRecoveryCapability({ trustedRecoveryRequest: inputResult.request, storeInstance });
  if (recoveryCapability === undefined) {
    return failResult('ERR-STO-REQ-INVALID', 'recovery capability could not be issued');
  }
  let capability: RecoveryCapability | undefined = recoveryCapability;
  try {
    const profile = storeInstance.limitProfile;
    const recomputedGeneration = computeScanGeneration({
      storeInstance,
      mode: 'recovery',
      entryLimit: profile['recoveryScanEntries'] ?? 1024 * 1024,
      byteLimit: profile['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024,
      failClosed: true,
    });
    if (recomputedGeneration !== action.expectedGeneration) {
      return failResult('ERR-STO-REQ-INVALID', 'assessment scan generation does not match the current store and limits');
    }
    const storeRoot = `${storeInstance.parentIdentity.canonicalPath}/store-v1`;
    const surface = recomputeSurfaceGeneration({ namespaceRoot: storeRoot, serviceUid: request.serviceUid, mode: 'recovery' });
    if (!surface.ok || surface.generation === undefined) {
      return failResult(surface.code ?? 'ERR-STO-IO-FAILURE', surface.message ?? 'surface structure could not be re-read');
    }
    if (surface.generation !== action.expectedSurfaceGeneration) {
      return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'store structure changed since the recovery assessment');
    }
    const surfaceGeneration = surface.generation as string;
    const bound = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid: request.serviceUid,
      limitProfile: storeInstance.limitProfile,
    });
    if (!bound.ok) {
      return failResult('ERR-STO-REQ-INVALID', 'recovery capability binding mismatch');
    }
    hooks.stage?.('before-lock-acquisition');
    const locksDir = `${storeRoot}/locks`;
    const lockPath = `${locksDir}/writer.lock`;
    const lockWaitMs = profile['lockWait'] ?? 5000;
    const acquired = acquireWriterLock({
      capability,
      operation: 'quarantine-temporary',
      lockPath,
      locksDirPath: locksDir,
      storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      actionIdentity: inputResult.request.actionIdentity,
      lockWaitMs,
      timeSource: request.timeSource,
      hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!acquired.ok || acquired.record === undefined) {
      return failResult(acquired.code ?? 'ERR-STO-LOCK-UNAVAILABLE', acquired.message ?? 'writer lock could not be acquired');
    }
    const lockRecord = acquired.record;
    hooks.stage?.('after-lock-acquisition');
    const release = (): RecoveryMutationResult => {
      hooks.stage?.('before-lock-release');
      const released = releaseWriterLock({
        capability,
        operation: 'quarantine-temporary',
        lockPath,
        locksDirPath: locksDir,
        expected: { nonce: lockRecord.nonce, storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })) },
        timeSource: request.timeSource,
        hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
      });
      if (!released.ok) {
        return failResult('ERR-STO-RECOVERY-FAILED', 'lock release failed; the lock remains for recovery');
      }
      return { ok: true };
    };
    const temporaryBytes = profile['temporaryBytes'] ?? 64 * 1024 * 1024;
    const recordBytes = profile['recordBytes'] ?? 1024 * 1024;

    // Immediate source re-verification (16.5 step 7).
    const verified = reverifyQuarantineSource({
      capability,
      namespaceRoot: storeRoot,
      serviceUid: request.serviceUid,
      temporaryBytes,
      targetEntry: targetEntryName,
      expectedClassification: classification,
      expectedSourceDigest: sourceDigest,
      expectedSurfaceGeneration: action.expectedSurfaceGeneration,
    });
    hooks.stage?.('after-source-verification');

    const quarantineId = computeQuarantineTemporaryId({
      storeInstance,
      sourceEntry: targetEntryName,
      classification,
      sourceDigest,
    });
    const evidenceId = computeQuarantineEvidenceIdentity({
      storeInstance,
      quarantineId,
      sourceDigest,
      outcome: 'quarantined',
    });
    const buildEvidence = (): { readonly ok: boolean; readonly record?: NonNullable<ReturnType<typeof buildQuarantineEvidenceRecord>['record']>; readonly code?: string; readonly message?: string } => {
      const built = buildQuarantineEvidenceRecord({
        storeInstance,
        actionIdentity: inputResult.request!.actionIdentity,
        evidenceKind: 'recovery-evidence',
        recoveryOperation: 'quarantine-temporary',
        quarantineId,
        sourceEntry: targetEntryName,
        sourceClassification: classification,
        sourceDigest,
        observationIds: action.expectedObservationIds as readonly string[],
        outcome: 'quarantined',
        generation: recomputedGeneration,
        surfaceGeneration,
        createdAt: isoFromEpochMs(request.timeSource.now()),
      });
      if (!built.ok || built.record === undefined) {
        return { ok: false, code: built.code ?? 'ERR-STO-INTERNAL-INVARIANT', message: built.message ?? 'quarantine evidence could not be constructed' };
      }
      return { ok: true, record: built.record };
    };

    // Source absent → destination-only states (roll-forward / already-completed).
    if (!verified.ok && verified.code === 'ERR-STO-NOT-FOUND') {
      // The destination must exist and be exact; executeQuarantineTemporary
      // decides roll-forward vs already-completed by the evidence state.
      const executed = executeQuarantineTemporary({
        capability,
        namespaceRoot: storeRoot,
        serviceUid: request.serviceUid,
        targetEntry: targetEntryName,
        quarantineId,
        evidenceId,
        expectedSourceDigest: sourceDigest,
        temporaryBytes,
        sourceFacts: { dev: 0, ino: 0, nlink: 0 },
        hooks,
      });
      if (!executed.ok) {
        const released = release();
        if (!released.ok) return released;
        return failResult(executed.code ?? 'ERR-STO-RECOVERY-FAILED', executed.message ?? 'quarantine state could not be resolved');
      }
      if (executed.outcome === 'already-completed') {
        const released = release();
        if (!released.ok) return released;
        return { ok: true, outcome: 'already-completed', evidenceId };
      }
      // Roll forward: publish the missing recovery evidence and audit.
      const built = buildEvidence();
      if (!built.ok) {
        const released = release();
        if (!released.ok) return released;
        return failResult(built.code ?? 'ERR-STO-INTERNAL-INVARIANT', built.message ?? 'quarantine evidence could not be constructed');
      }
      hooks.stage?.('before-evidence-publication');
      const evidencePublished = publishRecoveryEvidence({
        capability,
        storeInstance,
        namespaceRoot: storeRoot,
        serviceUid: request.serviceUid,
        byteLimit: recordBytes,
        record: built.record!,
        operation: 'quarantine-temporary',
        hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
      });
      if (!evidencePublished.ok) {
        const released = release();
        if (!released.ok) return released;
        return failResult(evidencePublished.code ?? 'ERR-STO-RECOVERY-FAILED', evidencePublished.message ?? 'quarantine evidence is not durable');
      }
      hooks.stage?.('after-evidence-publication');
      const released = release();
      if (!released.ok) return released;
      return { ok: true, outcome: 'quarantined', evidenceId };
    }
    if (!verified.ok || verified.source === undefined) {
      const released = release();
      if (!released.ok) return released;
      return failResult(verified.code ?? 'ERR-STO-INTEGRITY', verified.message ?? 'quarantine source re-verification failed');
    }

    // Source present: normal execution or interrupted-link continuation.
    const executed = executeQuarantineTemporary({
      capability,
      namespaceRoot: storeRoot,
      serviceUid: request.serviceUid,
      targetEntry: targetEntryName,
      quarantineId,
      evidenceId,
      expectedSourceDigest: sourceDigest,
      temporaryBytes,
      sourceFacts: verified.source,
      hooks,
    });
    if (!executed.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult(executed.code ?? 'ERR-STO-RECOVERY-FAILED', executed.message ?? 'quarantine mutation failed');
    }
    if (executed.outcome === 'already-completed') {
      const released = release();
      if (!released.ok) return released;
      return { ok: true, outcome: 'already-completed', evidenceId };
    }
    if (executed.evidenceAlreadyDurable) {
      // Interrupted-link continuation completed over matching evidence.
      const released = release();
      if (!released.ok) return released;
      return { ok: true, outcome: 'already-completed', evidenceId };
    }
    // Publish the durable recovery evidence and its audit.
    const built = buildEvidence();
    if (!built.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult(built.code ?? 'ERR-STO-INTERNAL-INVARIANT', built.message ?? 'quarantine evidence could not be constructed');
    }
    hooks.stage?.('before-evidence-publication');
    const evidencePublished = publishRecoveryEvidence({
      capability,
      storeInstance,
      namespaceRoot: storeRoot,
      serviceUid: request.serviceUid,
      byteLimit: recordBytes,
      record: built.record!,
      operation: 'quarantine-temporary',
      hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!evidencePublished.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult(evidencePublished.code ?? 'ERR-STO-RECOVERY-FAILED', evidencePublished.message ?? 'quarantine evidence is not durable');
    }
    hooks.stage?.('after-evidence-publication');
    const beforeSuccess = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid: request.serviceUid,
      limitProfile: storeInstance.limitProfile,
    });
    if (!beforeSuccess.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult('ERR-STO-DURABILITY', 'capability invalidated before acknowledgement; quarantine and evidence are durable');
    }
    const rootRevalidated = revalidateParentIdentity(storeInstance.parentIdentity, request.serviceUid);
    if (!rootRevalidated.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult(rootRevalidated.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', rootRevalidated.message ?? 'trusted parent identity changed');
    }
    const released = release();
    if (!released.ok) return released;
    return { ok: true, outcome: 'quarantined', evidenceId };
  } finally {
    capability?.dispose();
  }
}

/**
 * Audit-reconstruction mutation flow (16.3; AUD-011/012; CSA-013/014;
 * WP-8-G §4/§7/§9). Authority, revalidation, and locking mirror the
 * quarantine flow; the target is re-verified descriptor-bound at its
 * derived canonical location; the current audit state is re-enumerated
 * (never a prior view) and classified; the exact reconstructed
 * `recovery-audit-reconstruction` event is derived mechanically and
 * published under a dedicated exact-record permit; the reconstruction
 * evidence and its authorized-write audit are published; every required
 * durability point is re-verified before success.
 *
 * Deterministic states: audit absent → normal reconstruction; exact
 * reconstructed audit durable + evidence absent → evidence roll-forward;
 * exact reconstructed audit + matching evidence → already-completed;
 * original authorized-write audit present (gap filled by the write path
 * itself) → already-completed without evidence; conflicting audit,
 * contesting duplicates, malformed audit association, unreadable audit
 * surface, changed/replaced/missing target → fail closed; matching
 * evidence without the reconstructed audit → fail closed (integrity
 * failure; never republish from evidence alone).
 */
function executeAuditReconstructionMutation(
  request: RecoveryMutationRequest,
  action: RecoveryMutationRequest['action'] & { category: 'audit-reconstruction' },
  hooks: NonNullable<RecoveryMutationRequest['hooks']>,
): RecoveryMutationResult {
  const targetRecordClass = action.targetRecordClass as RecordClassId;
  const targetRecordId = action.targetRecordId as string;
  const targetRecordDigest = action.targetRecordDigest as string;
  const expectedOriginalActionIdentity = action.expectedOriginalActionIdentity as string;
  const expectedMissingAuditFindingId = action.expectedMissingAuditFindingId as string;
  if (
    !isReconstructionClass(targetRecordClass) ||
    typeof targetRecordId !== 'string' ||
    typeof targetRecordDigest !== 'string' ||
    typeof expectedOriginalActionIdentity !== 'string' ||
    typeof expectedMissingAuditFindingId !== 'string'
  ) {
    return failResult('ERR-STO-REQ-INVALID', 'audit-reconstruction request is missing a required target binding');
  }
  const inputResult = createTrustedRecoveryRequest(
    request.trustedConfiguration,
    request.recoveryActionProvenance,
    { locator: request.locator, serviceUid: request.serviceUid, forbiddenRoots: request.forbiddenRoots, limitProfile: request.limitProfile },
  );
  if (!inputResult.ok || inputResult.request === undefined) {
    const code = inputResult.reason === 'not-genuine-configuration' || inputResult.reason === 'not-genuine-action-provenance' || inputResult.reason === 'configuration-identity-mismatch'
      ? 'ERR-STO-CONFIG-UNAVAILABLE'
      : 'ERR-STO-REQ-INVALID';
    return failResult(code, inputResult.message ?? 'trusted recovery request could not be established');
  }
  const store = verifyStoreInstance({
    locator: request.locator,
    serviceUid: request.serviceUid,
    forbiddenRoots: request.forbiddenRoots,
    configurationIdentity: (request.trustedConfiguration as { readonly identity: string }).identity,
    configurationVersion: (request.trustedConfiguration as { readonly configurationVersion: string }).configurationVersion,
    limitProfile: request.limitProfile,
  });
  if (!store.ok || store.storeInstance === undefined) {
    return failResult(store.code ?? 'ERR-STO-INTEGRITY', store.message ?? 'store revalidation failed');
  }
  const storeInstance = store.storeInstance;
  const recoveryCapability = createRecoveryCapability({ trustedRecoveryRequest: inputResult.request, storeInstance });
  if (recoveryCapability === undefined) {
    return failResult('ERR-STO-REQ-INVALID', 'recovery capability could not be issued');
  }
  let capability: RecoveryCapability | undefined = recoveryCapability;
  try {
    const profile = storeInstance.limitProfile;
    const recomputedGeneration = computeScanGeneration({
      storeInstance,
      mode: 'recovery',
      entryLimit: profile['recoveryScanEntries'] ?? 1024 * 1024,
      byteLimit: profile['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024,
      failClosed: true,
    });
    if (recomputedGeneration !== action.expectedGeneration) {
      return failResult('ERR-STO-REQ-INVALID', 'assessment scan generation does not match the current store and limits');
    }
    const storeRoot = `${storeInstance.parentIdentity.canonicalPath}/store-v1`;
    const surface = recomputeSurfaceGeneration({ namespaceRoot: storeRoot, serviceUid: request.serviceUid, mode: 'recovery' });
    if (!surface.ok || surface.generation === undefined) {
      return failResult(surface.code ?? 'ERR-STO-IO-FAILURE', surface.message ?? 'surface structure could not be re-read');
    }
    if (surface.generation !== action.expectedSurfaceGeneration) {
      return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'store structure changed since the recovery assessment');
    }
    const surfaceGeneration = surface.generation as string;
    const bound = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid: request.serviceUid,
      limitProfile: storeInstance.limitProfile,
    });
    if (!bound.ok) {
      return failResult('ERR-STO-REQ-INVALID', 'recovery capability binding mismatch');
    }
    hooks.stage?.('before-lock-acquisition');
    const locksDir = `${storeRoot}/locks`;
    const lockPath = `${locksDir}/writer.lock`;
    const lockWaitMs = profile['lockWait'] ?? 5000;
    const acquired = acquireWriterLock({
      capability,
      operation: 'audit-reconstruction',
      lockPath,
      locksDirPath: locksDir,
      storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      actionIdentity: inputResult.request.actionIdentity,
      lockWaitMs,
      timeSource: request.timeSource,
      hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!acquired.ok || acquired.record === undefined) {
      return failResult(acquired.code ?? 'ERR-STO-LOCK-UNAVAILABLE', acquired.message ?? 'writer lock could not be acquired');
    }
    const lockRecord = acquired.record;
    hooks.stage?.('after-lock-acquisition');
    const release = (): RecoveryMutationResult => {
      hooks.stage?.('before-lock-release');
      const released = releaseWriterLock({
        capability,
        operation: 'audit-reconstruction',
        lockPath,
        locksDirPath: locksDir,
        expected: { nonce: lockRecord.nonce, storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })) },
        timeSource: request.timeSource,
        hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
      });
      if (!released.ok) {
        return failResult('ERR-STO-RECOVERY-FAILED', 'lock release failed; the lock remains for recovery');
      }
      return { ok: true };
    };
    // Every fail-closed path after lock acquisition releases the identity-
    // bound lock (never broken or replaced); only a simulated crash leaves
    // the held lock as the deterministic fail-closed state.
    const failClosed = (code: string, message: string): RecoveryMutationResult => {
      const released = release();
      if (!released.ok) return released;
      return failResult(code, message);
    };
    const recordBytes = profile['recordBytes'] ?? 1024 * 1024;
    const recoveryTime = isoFromEpochMs(request.timeSource.now());

    // Descriptor-bound target re-verification (WP-8-G §4.8–10): exact
    // UID/mode/type/link-count, exact identity/digest/class, exact
    // original trusted action identity from the durable envelope.
    const verified = reverifyReconstructionTarget({
      capability,
      namespaceRoot: storeRoot,
      serviceUid: request.serviceUid,
      recordBytes,
      targetRecordClass,
      targetRecordId,
      targetRecordDigest,
      expectedOriginalActionIdentity,
      expectedSurfaceGeneration: action.expectedSurfaceGeneration,
    });
    hooks.stage?.('after-target-verification');
    if (!verified.ok || verified.target === undefined) {
      return failClosed(verified.code ?? 'ERR-STO-INTEGRITY', verified.message ?? 'target record re-verification failed');
    }

    // Current audit-state enumeration and classification (WP-8-G §4.11/4.12).
    const auditState = auditEventsForRecord({
      namespaceRoot: storeRoot,
      serviceUid: request.serviceUid,
      byteLimit: recordBytes,
      targetRecordId,
    });
    if (!auditState.ok || auditState.events === undefined) {
      return failClosed(auditState.code ?? 'ERR-STO-INTEGRITY', auditState.message ?? 'current audit state could not be verified');
    }
    const events = auditState.events;
    const exactReconstruction = events.filter(
      (e) => e.eventKind === RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND && e.primaryDigest === targetRecordDigest && e.gapMarker,
    );
    const malformedReconstruction = events.filter(
      (e) => e.eventKind === RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND && e.primaryDigest === targetRecordDigest && !e.gapMarker,
    );
    const conflicting = events.filter((e) => e.primaryDigest !== targetRecordDigest);
    const exactOriginal = events.filter((e) => e.eventKind === AUTHORIZED_WRITE_EVENT_KIND && e.primaryDigest === targetRecordDigest);
    const otherKinds = events.filter(
      (e) => e.primaryDigest === targetRecordDigest && e.eventKind !== AUTHORIZED_WRITE_EVENT_KIND && e.eventKind !== RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND,
    );
    if (malformedReconstruction.length > 0 || conflicting.length > 0 || otherKinds.length > 0) {
      return failClosed('ERR-STO-INTEGRITY', 'conflicting audit exists for the target; fail closed');
    }
    if (exactReconstruction.length > 1 || exactOriginal.length > 1) {
      return failClosed('ERR-STO-INTEGRITY', 'multiple contesting audits exist for the target; external disposition required');
    }
    hooks.stage?.('after-audit-absence-verification');

    // The derived reconstruction audit (identity time-independent; the
    // recovery-time bytes are creation evidence).
    const auditBuilt = buildRecoveryAuditReconstructionEvent({
      storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      primaryClass: targetRecordClass,
      primaryRecordId: targetRecordId,
      primaryRevision: verified.target.revision,
      primaryDigest: targetRecordDigest,
      recoveryActionIdentity: inputResult.request.actionIdentity,
      recoveryTime,
    });
    if (!auditBuilt.ok || auditBuilt.event === undefined) {
      return failClosed(auditBuilt.code ?? 'ERR-STO-INTERNAL-INVARIANT', auditBuilt.message ?? 'reconstructed audit could not be derived');
    }

    // Evidence construction/verification shared by the roll-forward and
    // normal paths (binds the audit identity that is actually durable).
    const buildEvidence = (reconstructionAuditId: string, reconstructionAuditDigest: string): RecoveryMutationResult => {
      const built = buildAuditReconstructionEvidenceRecord({
        storeInstance,
        actionIdentity: inputResult.request!.actionIdentity,
        evidenceKind: 'recovery-evidence',
        recoveryOperation: 'audit-reconstruction',
        targetRecordClass,
        targetRecordId,
        targetRecordDigest,
        originalActionIdentity: verified.target!.originalActionIdentity,
        reconstructionAuditId,
        reconstructionAuditDigest,
        missingAuditObservationId: expectedMissingAuditFindingId,
        generation: recomputedGeneration,
        surfaceGeneration,
        outcome: 'reconstructed',
        createdAt: isoFromEpochMs(request.timeSource.now()),
      });
      if (!built.ok || built.record === undefined) {
        return failResult(built.code ?? 'ERR-STO-INTERNAL-INVARIANT', built.message ?? 'reconstruction evidence could not be constructed');
      }
      const evidenceDerived = deriveRecordRelativePath('store-evidence-record', built.record.recordId);
      const evidenceAuditDerived = deriveRecordRelativePath('authoritative-audit-event', built.record.auditEventId);
      const reconstructionAuditDerived = deriveRecordRelativePath('authoritative-audit-event', reconstructionAuditId);
      if (!evidenceDerived.ok || !evidenceAuditDerived.ok || !reconstructionAuditDerived.ok) {
        return failResult('ERR-STO-CONTAINMENT-DENIED', 'reconstruction evidence path derivation failed');
      }
      // The derived evidence identity must be ABSENT before publication: an
      // existing object at the exact evidence path (even one whose payload
      // references another target) is a conflicting evidence state.
      const evidencePath = `${storeRoot}/${evidenceDerived.relativePath}`;
      const existingAtPath = verifyObjectBytesAt({ path: evidencePath, serviceUid: request.serviceUid, byteLimit: recordBytes });
      if (existingAtPath.ok) {
        return failResult('ERR-STO-INTEGRITY', 'conflicting evidence exists at the derived evidence identity; fail closed');
      }
      if (existingAtPath.code !== 'ERR-STO-NOT-FOUND') {
        return failResult(existingAtPath.code ?? 'ERR-STO-INTEGRITY', existingAtPath.message ?? 'evidence path could not be verified');
      }
      hooks.stage?.('before-evidence-publication');
      const evidencePublished = publishAuditReconstructionEvidence({
        capability,
        storeInstance,
        namespaceRoot: storeRoot,
        serviceUid: request.serviceUid,
        byteLimit: recordBytes,
        record: built.record,
        hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
      });
      if (!evidencePublished.ok) {
        return failResult(evidencePublished.code ?? 'ERR-STO-RECOVERY-FAILED', evidencePublished.message ?? 'reconstruction evidence is not durable');
      }
      hooks.stage?.('after-evidence-publication');
      hooks.stage?.('after-evidence-audit-publication');
      // Verify every required durability point (WP-8-G §7.14): the
      // reconstructed audit (the id/digest that is actually durable),
      // the evidence, and the evidence's authorized-write audit.
      const points: ReadonlyArray<{ readonly path: string; readonly expectedDigest: string; readonly label: string }> = [
        { path: `${storeRoot}/${reconstructionAuditDerived.relativePath}`, expectedDigest: reconstructionAuditDigest, label: 'reconstructed audit' },
        { path: `${storeRoot}/${evidenceDerived.relativePath}`, expectedDigest: built.record!.digest, label: 'reconstruction evidence' },
        { path: `${storeRoot}/${evidenceAuditDerived.relativePath}`, expectedDigest: built.record!.auditDigest, label: 'evidence audit' },
      ];
      for (const point of points) {
        const durable = verifyObjectBytesAt({ path: point.path, serviceUid: request.serviceUid, byteLimit: recordBytes });
        if (!durable.ok || durable.digest !== point.expectedDigest) {
          return failResult('ERR-STO-DURABILITY', `${point.label} durability point is not verified`);
        }
      }
      return { ok: true, evidenceId: built.record.recordId };
    };

    // Current reconstruction-evidence state (WP-8-G §9): any durable
    // reconstruction evidence for the target is verified against the
    // CURRENT surface, never a prior view.
    const evidenceState = reconstructionEvidenceForTarget({
      namespaceRoot: storeRoot,
      serviceUid: request.serviceUid,
      byteLimit: recordBytes,
      targetRecordId,
    });
    if (!evidenceState.ok || evidenceState.evidence === undefined) {
      return failResult(evidenceState.code ?? 'ERR-STO-INTEGRITY', evidenceState.message ?? 'current reconstruction evidence state could not be verified');
    }
    const targetEvidence = evidenceState.evidence;
    const evidenceMatches = (e: (typeof targetEvidence)[number], auditId: string): boolean =>
      e.reconstructionAuditId === auditId && e.targetRecordDigest === targetRecordDigest && (e.outcome === 'reconstructed' || e.outcome === 'already-completed');

    // Flow A: the exact reconstructed audit is already durable — roll the
    // recovery evidence forward or return already-completed.
    if (exactReconstruction.length === 1) {
      const durableAudit = exactReconstruction[0]!;
      const matchingEvidence = targetEvidence.filter((e) => evidenceMatches(e, durableAudit.eventId));
      const conflictingEvidence = targetEvidence.filter((e) => !evidenceMatches(e, durableAudit.eventId));
      if (conflictingEvidence.length > 0) {
        return failClosed('ERR-STO-INTEGRITY', 'conflicting reconstruction evidence exists for the target; fail closed');
      }
      if (matchingEvidence.length > 1) {
        return failClosed('ERR-STO-INTEGRITY', 'duplicate reconstruction evidence exists for the target; fail closed');
      }
      if (matchingEvidence.length === 1) {
        const released = release();
        if (!released.ok) return released;
        return { ok: true, outcome: 'already-completed', evidenceId: matchingEvidence[0]!.evidenceId };
      }
      const rolled = buildEvidence(durableAudit.eventId, durableAudit.digest);
      if (!rolled.ok) {
        const released = release();
        if (!released.ok) return released;
        return rolled;
      }
      const released = release();
      if (!released.ok) return released;
      return { ok: true, outcome: 'reconstructed', evidenceId: rolled.evidenceId };
    }

    // No exact reconstructed audit is durable. Any durable reconstruction
    // evidence for the target is an integrity failure (evidence without
    // its reconstructed audit) or a conflict: never republish from
    // evidence alone (WP-8-G §9).
    if (targetEvidence.length > 0) {
      return failClosed('ERR-STO-INTEGRITY', 'reconstruction evidence exists without its reconstructed audit; integrity failure, no republish');
    }

    // Flow B: the original authorized-write audit now exists (the write
    // path itself filled the gap; CSA-014). Nothing was reconstructed and
    // no evidence may be invented; deterministic already-completed.
    if (exactOriginal.length === 1) {
      const released = release();
      if (!released.ok) return released;
      return { ok: true, outcome: 'already-completed' };
    }

    // Flow C: normal reconstruction — publish the derived audit, confirm
    // its durability, publish the evidence and its audit, verify all
    // durability points, revalidate, release.
    hooks.stage?.('before-reconstructed-audit-publication');
    const auditPublished = publishReconstructedAudit({
      capability,
      namespaceRoot: storeRoot,
      serviceUid: request.serviceUid,
      byteLimit: recordBytes,
      targetRecordClass,
      targetRecordId,
      targetRecordDigest,
      audit: auditBuilt.event,
      hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!auditPublished.ok) {
      return failClosed(auditPublished.code ?? 'ERR-STO-RECOVERY-FAILED', auditPublished.message ?? 'reconstructed audit publication failed');
    }
    hooks.stage?.('after-reconstructed-audit-publication');
    hooks.stage?.('before-reconstructed-audit-durability-confirmation');
    const auditDerived = deriveRecordRelativePath('authoritative-audit-event', auditBuilt.event.recordId);
    if (!auditDerived.ok) {
      return failResult('ERR-STO-CONTAINMENT-DENIED', 'reconstructed audit path derivation failed');
    }
    const auditDurable = verifyObjectBytesAt({ path: `${storeRoot}/${auditDerived.relativePath}`, serviceUid: request.serviceUid, byteLimit: recordBytes });
    if (!auditDurable.ok || auditDurable.digest !== auditBuilt.event.digest) {
      return failClosed('ERR-STO-DURABILITY', 'reconstructed audit durability point is not verified');
    }
    hooks.stage?.('after-reconstructed-audit-durability-confirmation');
    const evidenceStep = buildEvidence(auditBuilt.event.recordId, auditBuilt.event.digest);
    if (!evidenceStep.ok) {
      const released = release();
      if (!released.ok) return released;
      return evidenceStep;
    }
    const beforeSuccess = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid: request.serviceUid,
      limitProfile: storeInstance.limitProfile,
    });
    if (!beforeSuccess.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult('ERR-STO-DURABILITY', 'capability invalidated before acknowledgement; reconstruction is durable');
    }
    const rootRevalidated = revalidateParentIdentity(storeInstance.parentIdentity, request.serviceUid);
    if (!rootRevalidated.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult(rootRevalidated.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', rootRevalidated.message ?? 'trusted parent identity changed');
    }
    const released = release();
    if (!released.ok) return released;
    return { ok: true, outcome: 'reconstructed', evidenceId: evidenceStep.evidenceId };
  } finally {
    capability?.dispose();
  }
}

/**
 * Registry-index rebuild flow (WP-8-H §9; ADR-031): a COMPLETE verified
 * registry snapshot is derived WITHOUT the writer lock (a long read-only
 * scan never holds it), the deterministic canonical index is built, the
 * writer lock is taken only for the publication phase, the store
 * generation/surface tokens and the live entry-set probe are re-checked
 * under the lock (any change since the scan fails closed as a stale
 * build), the exact immutable index is published under a dedicated
 * exact-record permit, every durability point is verified, and the newly
 * published index is reopened and verified. A conflicting index at the
 * derived identity fails closed (no overwrite; disposition out of scope).
 */
function executeRegistryIndexRebuildMutation(
  request: RecoveryMutationRequest,
  action: RecoveryMutationRequest['action'] & { category: 'registry-index-rebuild' },
  hooks: NonNullable<RecoveryMutationRequest['hooks']>,
): RecoveryMutationResult {
  if (!isGenuineTrustedStorageBootstrapInput(request.trustedInput)) {
    return failResult('ERR-STO-REQ-INVALID', 'registry-index-rebuild requires a genuine branded trusted bootstrap input');
  }
  const inputResult = createTrustedRecoveryRequest(
    request.trustedConfiguration,
    request.recoveryActionProvenance,
    { locator: request.locator, serviceUid: request.serviceUid, forbiddenRoots: request.forbiddenRoots, limitProfile: request.limitProfile },
  );
  if (!inputResult.ok || inputResult.request === undefined) {
    const code = inputResult.reason === 'not-genuine-configuration' || inputResult.reason === 'not-genuine-action-provenance' || inputResult.reason === 'configuration-identity-mismatch'
      ? 'ERR-STO-CONFIG-UNAVAILABLE'
      : 'ERR-STO-REQ-INVALID';
    return failResult(code, inputResult.message ?? 'trusted recovery request could not be established');
  }
  const store = verifyStoreInstance({
    locator: request.locator,
    serviceUid: request.serviceUid,
    forbiddenRoots: request.forbiddenRoots,
    configurationIdentity: (request.trustedConfiguration as { readonly identity: string }).identity,
    configurationVersion: (request.trustedConfiguration as { readonly configurationVersion: string }).configurationVersion,
    limitProfile: request.limitProfile,
  });
  if (!store.ok || store.storeInstance === undefined) {
    return failResult(store.code ?? 'ERR-STO-INTEGRITY', store.message ?? 'store revalidation failed');
  }
  const storeInstance = store.storeInstance;
  const recoveryCapability = createRecoveryCapability({ trustedRecoveryRequest: inputResult.request, storeInstance });
  if (recoveryCapability === undefined) {
    return failResult('ERR-STO-REQ-INVALID', 'recovery capability could not be issued');
  }
  let capability: RecoveryCapability | undefined = recoveryCapability;
  try {
    const profile = storeInstance.limitProfile;
    const entryLimit = profile['totalScanEntries'] ?? 1024 * 1024;
    const byteLimit = profile['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024;
    const indexRebuildWork = profile['indexRebuildWork'] ?? 1024 * 1024;
    const indexBytes = profile['indexBytes'] ?? 64 * 1024 * 1024;
    // Registry-mode generation recomputation (the index binds the registry
    // scan generation; F2).
    const recomputedGeneration = computeScanGeneration({ storeInstance, mode: 'registry', entryLimit, byteLimit, failClosed: false });
    if (recomputedGeneration !== action.expectedRegistryGeneration) {
      return failResult('ERR-STO-REQ-INVALID', 'registry scan generation does not match the current store and limits');
    }
    const storeRoot = `${storeInstance.parentIdentity.canonicalPath}/store-v1`;
    const surface = recomputeSurfaceGeneration({ namespaceRoot: storeRoot, serviceUid: request.serviceUid, mode: 'registry' });
    if (!surface.ok || surface.generation === undefined) {
      return failResult(surface.code ?? 'ERR-STO-IO-FAILURE', surface.message ?? 'surface structure could not be re-read');
    }
    if (surface.generation !== action.expectedRegistrySurfaceGeneration) {
      return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'store structure changed since the registry snapshot');
    }
    // Complete verified snapshot scan WITHOUT the writer lock (WP-8-H §9:
    // a long read-only full-store scan must not hold the writer lock).
    const snapshot = runRegistrySnapshotScan({ trustedConfiguration: request.trustedConfiguration, trustedInput: request.trustedInput });
    if (!snapshot.ok || snapshot.observations === undefined || snapshot.scanFacts === undefined) {
      return failResult(snapshot.code ?? 'ERR-STO-INTEGRITY', snapshot.message ?? 'complete registry snapshot could not be derived');
    }
    // Deterministic canonical index (rejects truncated scans, unresolved
    // continuations, and every bound overflow; WP-8-H §5/§13).
    const built = buildRegistryIndex({
      observations: snapshot.observations,
      findings: snapshot.findings ?? [],
      scanFacts: snapshot.scanFacts,
      storeInstance,
      entryLimit,
      byteLimit,
      indexRebuildWork,
      indexBytes,
      continuation: snapshot.continuation,
    });
    if (!built.ok || built.index === undefined) {
      return failResult(built.code ?? 'ERR-STO-INTERNAL-INVARIANT', built.message ?? 'registry index could not be built');
    }
    const index = built.index;
    // Pre-lock surface recheck (cheap): the structural token must still
    // match the build input.
    const surfacePre = recomputeSurfaceGeneration({ namespaceRoot: storeRoot, serviceUid: request.serviceUid, mode: 'registry' });
    if (!surfacePre.ok || surfacePre.generation === undefined || surfacePre.generation !== snapshot.scanFacts.surfaceGeneration) {
      return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'store structure changed during the registry snapshot; stale build');
    }
    hooks.stage?.('before-lock-acquisition');
    const locksDir = `${storeRoot}/locks`;
    const lockPath = `${locksDir}/writer.lock`;
    const lockWaitMs = profile['lockWait'] ?? 5000;
    const acquired = acquireWriterLock({
      capability,
      operation: 'registry-index-rebuild',
      lockPath,
      locksDirPath: locksDir,
      storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      actionIdentity: inputResult.request.actionIdentity,
      lockWaitMs,
      timeSource: request.timeSource,
      hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!acquired.ok || acquired.record === undefined) {
      return failResult(acquired.code ?? 'ERR-STO-LOCK-UNAVAILABLE', acquired.message ?? 'writer lock could not be acquired');
    }
    const lockRecord = acquired.record;
    hooks.stage?.('after-lock-acquisition');
    const release = (): RecoveryMutationResult => {
      hooks.stage?.('before-lock-release');
      const released = releaseWriterLock({
        capability,
        operation: 'registry-index-rebuild',
        lockPath,
        locksDirPath: locksDir,
        expected: { nonce: lockRecord.nonce, storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })) },
        timeSource: request.timeSource,
        hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
      });
      if (!released.ok) {
        return failResult('ERR-STO-RECOVERY-FAILED', 'lock release failed; the lock remains for recovery');
      }
      return { ok: true };
    };
    const failClosed = (code: string, message: string): RecoveryMutationResult => {
      const released = release();
      if (!released.ok) return released;
      return failResult(code, message);
    };
    // Generation recheck under the writer lock (WP-8-H §9.7): the store
    // generation, the structural surface, and the live entry-set probe must
    // still match the build input; any change since the scan is a stale
    // build and the index for the old snapshot is never published.
    const genUnderLock = computeScanGeneration({ storeInstance, mode: 'registry', entryLimit, byteLimit, failClosed: false });
    if (genUnderLock !== recomputedGeneration) {
      return failClosed('ERR-STO-REQ-INVALID', 'registry scan generation changed; stale build, rebuild from a fresh view');
    }
    const surfaceUnderLock = recomputeSurfaceGeneration({ namespaceRoot: storeRoot, serviceUid: request.serviceUid, mode: 'registry' });
    if (!surfaceUnderLock.ok || surfaceUnderLock.generation === undefined || surfaceUnderLock.generation !== snapshot.scanFacts.surfaceGeneration) {
      return failClosed('ERR-STO-ROOT-IDENTITY-CHANGED', 'store structure changed between build and publication; stale build');
    }
    const probe = probeRegistryEntrySet(storeRoot, request.serviceUid);
    if (!probe.ok || probe.entries === undefined) {
      return failClosed(probe.code ?? 'ERR-STO-INTEGRITY', probe.message ?? 'live entry-set probe failed; stale build');
    }
    const indexParsed = parseRegistryIndex(index.canonicalUtf8, indexBytes, REGISTRY_INDEX_MAX_ENTRIES);
    if (!indexParsed.ok || indexParsed.model === undefined) {
      return failClosed('ERR-STO-INTERNAL-INVARIANT', 'built registry index does not re-parse');
    }
    const manifest = registryIndexManifest(indexParsed.model);
    const comparison = compareManifestAgainstProbe(manifest, probe.entries);
    if (!comparison.ok) {
      return failClosed('ERR-STO-INTEGRITY', `immutable store state changed between build and publication (${comparison.side ?? 'records'}/${comparison.reason ?? 'changed'}); stale build`);
    }
    hooks.stage?.('after-generation-recheck');
    // Existing index at the derived identity: byte-exact is idempotent,
    // anything else fails closed (no overwrite; WP-8-H §7).
    const existing = readRegistryIndexFile({ namespaceRoot: storeRoot, serviceUid: request.serviceUid, byteLimit: indexBytes, indexId: index.indexId });
    if (existing.ok && existing.raw === index.canonicalUtf8) {
      const released = release();
      if (!released.ok) return released;
      return { ok: true, outcome: 'already-completed', indexId: index.indexId };
    }
    if (existing.ok) {
      return failClosed('ERR-STO-INTEGRITY', 'conflicting registry-index exists at the derived identity; fail closed');
    }
    if (existing.code !== 'ERR-STO-NOT-FOUND') {
      return failClosed(existing.code ?? 'ERR-STO-INTEGRITY', existing.message ?? 'derived registry-index path could not be verified');
    }
    // Exact immutable index publication (dedicated permit; sink-confined).
    hooks.stage?.('before-index-publication');
    const published = publishRegistryIndex({
      capability,
      namespaceRoot: storeRoot,
      serviceUid: request.serviceUid,
      byteLimit: indexBytes,
      index,
      hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!published.ok) {
      return failClosed(published.code ?? 'ERR-STO-RECOVERY-FAILED', published.message ?? 'registry-index publication failed');
    }
    hooks.stage?.('after-index-publication');
    // Directory durability and final-object durability confirmation (the
    // directory fsyncs run inside the immutable substrate before it
    // returns; the confirmation re-verifies the final object).
    hooks.stage?.('before-directory-durability');
    const durable = readRegistryIndexFile({ namespaceRoot: storeRoot, serviceUid: request.serviceUid, byteLimit: indexBytes, indexId: index.indexId });
    if (!durable.ok || durable.raw !== index.canonicalUtf8) {
      return failClosed('ERR-STO-DURABILITY', 'registry-index durability point is not verified');
    }
    hooks.stage?.('after-directory-durability');
    const beforeSuccess = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid: request.serviceUid,
      limitProfile: storeInstance.limitProfile,
    });
    if (!beforeSuccess.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult('ERR-STO-DURABILITY', 'capability invalidated before acknowledgement; registry index is durable');
    }
    const rootRevalidated = revalidateParentIdentity(storeInstance.parentIdentity, request.serviceUid);
    if (!rootRevalidated.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult(rootRevalidated.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', rootRevalidated.message ?? 'trusted parent identity changed');
    }
    const released = release();
    if (!released.ok) return released;
    // Reopen and verify the newly published index (WP-8-H §9.11): canonical
    // form, self-consistency, store identity, and the current generation /
    // surface tokens (the entry-set probe is intentionally excluded here —
    // a legitimate write landing after lock release makes the index stale
    // for the fast path, not a publication failure).
    const reopen = readRegistryIndexFile({ namespaceRoot: storeRoot, serviceUid: request.serviceUid, byteLimit: indexBytes, indexId: index.indexId });
    if (!reopen.ok) {
      return failResult('ERR-STO-DURABILITY', 'registry-index reopen verification failed');
    }
    const reopenParsed = parseRegistryIndex(reopen.raw ?? '', indexBytes, REGISTRY_INDEX_MAX_ENTRIES);
    if (!reopenParsed.ok || reopenParsed.model === undefined || reopenParsed.model.indexId !== index.indexId) {
      return failResult('ERR-STO-DURABILITY', 'registry-index reopen parse failed');
    }
    const reopenSurface = recomputeSurfaceGeneration({ namespaceRoot: storeRoot, serviceUid: request.serviceUid, mode: 'registry' });
    if (!reopenParsed.model || reopenParsed.model.binding.generation !== recomputedGeneration || (reopenSurface.ok && reopenSurface.generation !== undefined && reopenSurface.generation !== reopenParsed.model.binding.surfaceGeneration)) {
      return failResult('ERR-STO-DURABILITY', 'registry-index reopen binding does not match the current store');
    }
    return { ok: true, outcome: 'rebuilt', indexId: index.indexId };
  } finally {
    capability?.dispose();
  }
}

/**
 * WP-8-I external-disposition adjudication foundation (contract §16.5
 * "disposition required"; WP-8-H conflicting-index disposition; WP-8-G
 * evidence model — none defines a disposition MUTATION primitive). This
 * flow is the complete authority/request/re-verification foundation that a
 * future contract-authorized disposition mutation will extend: genuine
 * trusted input, store revalidation, generation/surface recomputation,
 * single-writer lock, current-surface re-enumeration and classification
 * recomputation with the committed scanner logic, and a deterministic
 * `disposition-required` result. NO mutation is performed: no unlink, no
 * rename, no overwrite, no byte copy, no evidence publication — the
 * contract defines no disposition primitive for any supported class.
 *
 * States (deterministic): target present with the exact expected
 * classification → `disposition-required`; target absent → fail closed
 * (nothing was disposed, so no roll-forward); classification changed,
 * identity/type/digest changed, or conflicting evidence → fail closed;
 * repeated execution is idempotent. The target is left byte-identical.
 */
function executeDispositionAdjudication(
  request: RecoveryMutationRequest,
  action: RecoveryMutationRequest['action'] & { category: 'dispose-wpr023d-temporary' | 'dispose-quarantined-temporary' | 'dispose-conflicting-index' },
  hooks: NonNullable<RecoveryMutationRequest['hooks']>,
): RecoveryMutationResult {
  const targetEntry = action.targetEntry as string;
  const targetShard = action.targetShard as string | undefined;
  const expectedClassification = action.expectedDispositionClassification as string;
  const expectedCode = action.expectedCode as string;
  if (typeof targetEntry !== 'string' || typeof expectedClassification !== 'string' || typeof expectedCode !== 'string') {
    return failResult('ERR-STO-REQ-INVALID', 'external-disposition request is missing a required target binding');
  }
  const inputResult = createTrustedRecoveryRequest(
    request.trustedConfiguration,
    request.recoveryActionProvenance,
    { locator: request.locator, serviceUid: request.serviceUid, forbiddenRoots: request.forbiddenRoots, limitProfile: request.limitProfile },
  );
  if (!inputResult.ok || inputResult.request === undefined) {
    const code = inputResult.reason === 'not-genuine-configuration' || inputResult.reason === 'not-genuine-action-provenance' || inputResult.reason === 'configuration-identity-mismatch'
      ? 'ERR-STO-CONFIG-UNAVAILABLE'
      : 'ERR-STO-REQ-INVALID';
    return failResult(code, inputResult.message ?? 'trusted recovery request could not be established');
  }
  const store = verifyStoreInstance({
    locator: request.locator,
    serviceUid: request.serviceUid,
    forbiddenRoots: request.forbiddenRoots,
    configurationIdentity: (request.trustedConfiguration as { readonly identity: string }).identity,
    configurationVersion: (request.trustedConfiguration as { readonly configurationVersion: string }).configurationVersion,
    limitProfile: request.limitProfile,
  });
  if (!store.ok || store.storeInstance === undefined) {
    return failResult(store.code ?? 'ERR-STO-INTEGRITY', store.message ?? 'store revalidation failed');
  }
  const storeInstance = store.storeInstance;
  const recoveryCapability = createRecoveryCapability({ trustedRecoveryRequest: inputResult.request, storeInstance });
  if (recoveryCapability === undefined) {
    return failResult('ERR-STO-REQ-INVALID', 'recovery capability could not be issued');
  }
  let capability: RecoveryCapability | undefined = recoveryCapability;
  try {
    const profile = storeInstance.limitProfile;
    const recomputedGeneration = computeScanGeneration({
      storeInstance,
      mode: 'recovery',
      entryLimit: profile['recoveryScanEntries'] ?? 1024 * 1024,
      byteLimit: profile['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024,
      failClosed: true,
    });
    if (recomputedGeneration !== action.expectedGeneration) {
      return failResult('ERR-STO-REQ-INVALID', 'assessment scan generation does not match the current store and limits');
    }
    const storeRoot = `${storeInstance.parentIdentity.canonicalPath}/store-v1`;
    const surface = recomputeSurfaceGeneration({ namespaceRoot: storeRoot, serviceUid: request.serviceUid, mode: 'recovery' });
    if (!surface.ok || surface.generation === undefined) {
      return failResult(surface.code ?? 'ERR-STO-IO-FAILURE', surface.message ?? 'surface structure could not be re-read');
    }
    if (surface.generation !== action.expectedSurfaceGeneration) {
      return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'store structure changed since the recovery assessment');
    }
    const bound = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid: request.serviceUid,
      limitProfile: storeInstance.limitProfile,
    });
    if (!bound.ok) {
      return failResult('ERR-STO-REQ-INVALID', 'recovery capability binding mismatch');
    }
    hooks.stage?.('before-lock-acquisition');
    const locksDir = `${storeRoot}/locks`;
    const lockPath = `${locksDir}/writer.lock`;
    const lockWaitMs = profile['lockWait'] ?? 5000;
    const acquired = acquireWriterLock({
      capability,
      operation: action.category,
      lockPath,
      locksDirPath: locksDir,
      storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      actionIdentity: inputResult.request.actionIdentity,
      lockWaitMs,
      timeSource: request.timeSource,
      hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!acquired.ok || acquired.record === undefined) {
      return failResult(acquired.code ?? 'ERR-STO-LOCK-UNAVAILABLE', acquired.message ?? 'writer lock could not be acquired');
    }
    const lockRecord = acquired.record;
    hooks.stage?.('after-lock-acquisition');
    const release = (): RecoveryMutationResult => {
      hooks.stage?.('before-lock-release');
      const released = releaseWriterLock({
        capability,
        operation: action.category,
        lockPath,
        locksDirPath: locksDir,
        expected: { nonce: lockRecord.nonce, storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })) },
        timeSource: request.timeSource,
        hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
      });
      if (!released.ok) {
        return failResult('ERR-STO-RECOVERY-FAILED', 'lock release failed; the lock remains for recovery');
      }
      return { ok: true };
    };
    const failClosed = (code: string, message: string): RecoveryMutationResult => {
      const released = release();
      if (!released.ok) return released;
      return failResult(code, message);
    };
    const temporaryBytes = profile['temporaryBytes'] ?? 64 * 1024 * 1024;
    const recordBytes = profile['recordBytes'] ?? 1024 * 1024;
    const totalScanBytes = profile['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024;
    const recoveryScanEntries = profile['recoveryScanEntries'] ?? 1024 * 1024;
    const indexBytes = profile['indexBytes'] ?? 64 * 1024 * 1024;
    const surfaceGeneration = surface.generation as string;

    // Current-surface re-enumeration + classification recomputation with
    // the committed scanner logic (WP-8-I §4.7–4.10).
    let classification: string;
    let code: string;
    // Descriptor facts (dev/ino/nlink) from the immediate re-verification,
    // used by the pre-unlink identity recheck (ADR-032 §3.12).
    let verifiedDescriptor: { readonly dev: number; readonly ino: number; readonly nlink: number } | undefined;
    let currentDigest: string | undefined;
    if (action.category === 'dispose-wpr023d-temporary') {
      const current = currentTemporaryObservation({
        namespaceRoot: storeRoot,
        serviceUid: request.serviceUid,
        temporaryBytes,
        recordBytes,
        byteLimit: totalScanBytes,
        entry: targetEntry,
      });
      if (!current.ok || current.observation === undefined) {
        return failClosed(current.code ?? 'ERR-STO-INTEGRITY', current.message ?? 'target temporary could not be re-verified');
      }
      classification = current.observation.classification;
      code = current.observation.code;
      const expectedEntryType = action.expectedEntryType as 'regular' | 'symlink' | 'special' | 'directory' | undefined;
      if (current.entryType !== expectedEntryType) {
        return failClosed('ERR-STO-INTEGRITY', 'target entry type changed since the recovery assessment');
      }
    } else if (action.category === 'dispose-quarantined-temporary') {
      const current = currentQuarantineObservation({
        namespaceRoot: storeRoot,
        serviceUid: request.serviceUid,
        temporaryBytes,
        recordBytes,
        storeInstance,
        byteLimit: totalScanBytes,
        tmpEntryLimit: recoveryScanEntries,
        shard: targetShard ?? '',
        entry: targetEntry,
      });
      if (!current.ok) {
        // Target absent: the executable operations resolve the
        // already-completed state from the durable disposition evidence
        // (ADR-032 §8); the WPR-023 (d) adjudication and the
        // adjudication-only subclasses fail closed (nothing was disposed).
        if (current.code === 'ERR-STO-NOT-FOUND') {
          const resolved = resolveAbsentTarget(storeInstance, action, recomputedEvidenceId(storeInstance, action, expectedClassification));
          if (resolved !== undefined) {
            if (!resolved.ok) return failClosed(resolved.code, resolved.message);
            const released = release();
            if (!released.ok) return released;
            return { ok: true, outcome: 'already-completed', evidenceId: resolved.evidenceId };
          }
        }
        return failClosed(current.code ?? 'ERR-STO-INTEGRITY', current.message ?? 'target quarantine object could not be re-verified');
      }
      if (current.observation === undefined) {
        return failClosed('ERR-STO-INTEGRITY', 'target quarantine object re-verification produced no observation');
      }
      classification = current.observation.classification;
      code = current.observation.code;
      currentDigest = current.observation.contentDigest;
      if (current.observation.stat !== undefined) {
        verifiedDescriptor = { dev: current.observation.stat.dev, ino: current.observation.stat.ino, nlink: current.observation.stat.nlink };
      }
    } else {
      const current = currentIndexObservation({
        namespaceRoot: storeRoot,
        serviceUid: request.serviceUid,
        indexByteLimit: indexBytes,
        shard: targetShard ?? '',
        entry: targetEntry,
      });
      if (!current.ok) {
        if (current.code === 'ERR-STO-NOT-FOUND') {
          const resolved = resolveAbsentTarget(storeInstance, action, recomputedEvidenceId(storeInstance, action, expectedClassification));
          if (resolved !== undefined) {
            if (!resolved.ok) return failClosed(resolved.code, resolved.message);
            const released = release();
            if (!released.ok) return released;
            return { ok: true, outcome: 'already-completed', evidenceId: resolved.evidenceId };
          }
        }
        return failClosed(current.code ?? 'ERR-STO-INTEGRITY', current.message ?? 'target registry-index artifact could not be re-verified');
      }
      if (current.facts === undefined) {
        return failClosed('ERR-STO-INTEGRITY', 'target registry-index artifact re-verification produced no facts');
      }
      if (current.facts.indexId !== undefined && current.facts.indexId !== targetEntry.slice(0, 32)) {
        return failClosed('ERR-STO-INTEGRITY', 'target registry-index identity changed since the recovery assessment');
      }
      classification = current.facts.classification;
      code = current.facts.code;
      currentDigest = current.facts.digest;
      if (current.facts.descriptor !== undefined) {
        verifiedDescriptor = { dev: current.facts.descriptor.dev, ino: current.facts.descriptor.ino, nlink: current.facts.descriptor.nlink };
      }
    }
    hooks.stage?.('after-target-verification');

    // Exact classification and code (WP-8-I §4.9/4.10): the target must
    // still require exactly the externally authorized disposition.
    if (classification !== expectedClassification || code !== expectedCode) {
      return failClosed('ERR-STO-INTEGRITY', 'target classification changed since the recovery assessment; fail closed');
    }
    hooks.stage?.('after-classification-recomputation');

    // WPR-023 (d) remains ADJUDICATION-ONLY (ADR-032 §A/§6): no unlink, no
    // quarantine transition, no rename/copy/overwrite, no evidence.
    if (action.category === 'dispose-wpr023d-temporary') {
      const beforeSuccess = capability.assertExpected({
        storeInstance,
        configurationIdentity: storeInstance.configurationIdentity,
        serviceUid: request.serviceUid,
        limitProfile: storeInstance.limitProfile,
      });
      if (!beforeSuccess.ok) {
        const released = release();
        if (!released.ok) return released;
        return failResult('ERR-STO-DURABILITY', 'capability invalidated before the disposition verdict');
      }
      const rootRevalidated = revalidateParentIdentity(storeInstance.parentIdentity, request.serviceUid);
      if (!rootRevalidated.ok) {
        const released = release();
        if (!released.ok) return released;
        return failResult(rootRevalidated.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', rootRevalidated.message ?? 'trusted parent identity changed');
      }
      const released = release();
      if (!released.ok) return released;
      return { ok: true, outcome: 'disposition-required' };
    }

    // Executable disposition (ADR-032 §B/§C): the exact eligible subclasses
    // only. Quarantine: malformed/foreign/conflict regular files with exact
    // UID/mode/nlink/digest bindings. Index: the exact conflicting derived
    // artifact with exact UID/mode/nlink/digest bindings.
    const boundDigest = action.expectedContentDigest;
    if (boundDigest !== undefined && currentDigest !== undefined && boundDigest !== currentDigest) {
      return failClosed('ERR-STO-INTEGRITY', 'target content digest changed since the recovery assessment; fail closed');
    }
    if (boundDigest !== undefined && currentDigest === undefined) {
      return failClosed('ERR-STO-INTEGRITY', 'target is no longer a readable policy-compliant object; fail closed');
    }
    // Exact eligible subclass (ADR-032 §B/§C): regular file, exact
    // UID/mode (verified by the committed scanner reads), `nlink === 1`,
    // size within the bound (verified by the committed scanner reads), and
    // the exact content digest bound to the request.
    const descriptorOk = verifiedDescriptor !== undefined && verifiedDescriptor.nlink === 1;
    const executable =
      action.category === 'dispose-quarantined-temporary'
        ? (classification === 'quarantine-malformed' || classification === 'foreign-entry' || classification === 'quarantine-conflict') &&
          descriptorOk &&
          boundDigest !== undefined &&
          currentDigest !== undefined
        : descriptorOk && boundDigest !== undefined && currentDigest !== undefined;
    if (!executable) {
      // Adjudication-only subclasses (wrong-type, wrong-uid-or-mode,
      // unexpected-hard-link; non-regular or non-readable objects; digest
      // not bound): deterministic disposition-required, no mutation.
      const beforeSuccess = capability.assertExpected({
        storeInstance,
        configurationIdentity: storeInstance.configurationIdentity,
        serviceUid: request.serviceUid,
        limitProfile: storeInstance.limitProfile,
      });
      if (!beforeSuccess.ok) {
        const released = release();
        if (!released.ok) return released;
        return failResult('ERR-STO-DURABILITY', 'capability invalidated before the disposition verdict');
      }
      const rootRevalidated = revalidateParentIdentity(storeInstance.parentIdentity, request.serviceUid);
      if (!rootRevalidated.ok) {
        const released = release();
        if (!released.ok) return released;
        return failResult(rootRevalidated.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', rootRevalidated.message ?? 'trusted parent identity changed');
      }
      const released = release();
      if (!released.ok) return released;
      return { ok: true, outcome: 'disposition-required' };
    }

    // Evidence-state check BEFORE the unlink (ADR-032 §8): matching or
    // conflicting disposition evidence with a live target fails closed as
    // an integrity inconsistency; no repair-by-guessing.
    const expectedObservationId = (action.expectedObservationIds as readonly string[] | undefined)?.[0] ?? '';
    const evidenceId = recomputedEvidenceId(storeInstance, action, expectedClassification);
    const existingEvidence = verifyExistingDispositionEvidence({
      namespaceRoot: storeRoot,
      serviceUid: request.serviceUid,
      byteLimit: recordBytes,
      evidenceId,
      recoveryOperation: action.category === 'dispose-quarantined-temporary' ? 'dispose-quarantined-temporary' : 'dispose-conflicting-index',
      targetEntry,
      ...(action.category === 'dispose-quarantined-temporary' ? { targetShard: targetShard ?? '' } : { targetIndexId: targetEntry.slice(0, 32) }),
      targetClassification: expectedClassification,
      targetDigest: boundDigest!,
      observationId: expectedObservationId,
    });
    if (!existingEvidence.ok) {
      return failClosed(existingEvidence.code ?? 'ERR-STO-INTEGRITY', existingEvidence.message ?? 'existing disposition evidence could not be verified');
    }
    if (existingEvidence.matches) {
      return failClosed('ERR-STO-INTEGRITY', 'disposition evidence exists while the target is still present; integrity inconsistency');
    }

    // Exact unlink primitive: internally derived target path, descriptor
    // identity recheck, unlink exactly one name, absence verification.
    const targetPath =
      action.category === 'dispose-quarantined-temporary'
        ? `${storeRoot}/quarantine/temporary/${targetShard ?? ''}/${targetEntry}`
        : `${storeRoot}/index/registry-index/${targetShard ?? ''}/${targetEntry}`;
    const directoryPath = targetPath.slice(0, targetPath.lastIndexOf('/'));
    hooks.stage?.('before-unlink');
    const unlinked = unlinkVerifiedTarget({
      targetPath,
      serviceUid: request.serviceUid,
      expected: verifiedDescriptor!,
    });
    if (!unlinked.ok) {
      return failClosed(unlinked.code ?? 'ERR-STO-RECOVERY-FAILED', unlinked.message ?? 'disposition unlink failed');
    }
    hooks.stage?.('after-unlink');
    hooks.stage?.('before-directory-fsync');
    const synced = fsyncContainingDirectory({ directoryPath, serviceUid: request.serviceUid });
    if (!synced.ok) {
      return failClosed(synced.code ?? 'ERR-STO-DURABILITY', synced.message ?? 'containing directory fsync failed after unlink');
    }
    hooks.stage?.('after-directory-fsync');

    // Durable recovery evidence (ADR-032 §7): StoreEvidenceRecord with the
    // EXISTING recovery-evidence kind, the exact disposition operation, and
    // the per-operation domain-separated identity; published through the
    // WP-8F exact-record permit pipeline followed by the evidence's
    // mechanical authorized-write audit.
    const evidenceBuilt = buildDispositionEvidenceRecord({
      storeInstance,
      actionIdentity: inputResult.request!.actionIdentity,
      evidenceKind: 'recovery-evidence',
      recoveryOperation: action.category === 'dispose-quarantined-temporary' ? 'dispose-quarantined-temporary' : 'dispose-conflicting-index',
      targetEntry,
      ...(action.category === 'dispose-quarantined-temporary' ? { targetShard: targetShard ?? '' } : { targetIndexId: targetEntry.slice(0, 32) }),
      targetClassification: expectedClassification,
      targetDigest: boundDigest!,
      observationId: expectedObservationId,
      generation: recomputedGeneration,
      surfaceGeneration,
      outcome: 'disposed',
      createdAt: isoFromEpochMs(request.timeSource.now()),
    });
    if (!evidenceBuilt.ok || evidenceBuilt.record === undefined) {
      return failClosed(evidenceBuilt.code ?? 'ERR-STO-INTERNAL-INVARIANT', evidenceBuilt.message ?? 'disposition evidence could not be constructed');
    }
    const evidenceDerived = deriveRecordRelativePath('store-evidence-record', evidenceBuilt.record.recordId);
    const evidenceAuditDerived = deriveRecordRelativePath('authoritative-audit-event', evidenceBuilt.record.auditEventId);
    if (!evidenceDerived.ok || !evidenceAuditDerived.ok) {
      return failClosed('ERR-STO-CONTAINMENT-DENIED', 'disposition evidence path derivation failed');
    }
    hooks.stage?.('before-evidence-publication');
    const evidencePublished = publishRecoveryEvidence({
      capability,
      storeInstance,
      namespaceRoot: storeRoot,
      serviceUid: request.serviceUid,
      byteLimit: recordBytes,
      record: evidenceBuilt.record,
      operation: action.category === 'dispose-quarantined-temporary' ? 'dispose-quarantined-temporary' : 'dispose-conflicting-index',
      hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!evidencePublished.ok) {
      return failClosed(evidencePublished.code ?? 'ERR-STO-RECOVERY-FAILED', evidencePublished.message ?? 'disposition evidence is not durable');
    }
    hooks.stage?.('after-evidence-publication');
    hooks.stage?.('after-evidence-audit-publication');
    // Verify every required durability point (§3.20): evidence, evidence
    // audit, and the target's absence.
    const evidencePoint = verifyObjectBytesAt({ path: `${storeRoot}/${evidenceDerived.relativePath}`, serviceUid: request.serviceUid, byteLimit: recordBytes });
    if (!evidencePoint.ok || evidencePoint.digest !== evidenceBuilt.record.digest) {
      return failClosed('ERR-STO-DURABILITY', 'disposition evidence durability point is not verified');
    }
    const evidenceAuditPoint = verifyObjectBytesAt({ path: `${storeRoot}/${evidenceAuditDerived.relativePath}`, serviceUid: request.serviceUid, byteLimit: recordBytes });
    if (!evidenceAuditPoint.ok || evidenceAuditPoint.digest !== evidenceBuilt.record.auditDigest) {
      return failClosed('ERR-STO-DURABILITY', 'disposition evidence audit durability point is not verified');
    }
    const targetGone = verifyObjectBytesAt({ path: targetPath, serviceUid: request.serviceUid, byteLimit: recordBytes });
    if (targetGone.ok) {
      return failClosed('ERR-STO-INTEGRITY', 'target reappeared after disposition; fail closed');
    }
    if (targetGone.code !== 'ERR-STO-NOT-FOUND') {
      return failClosed(targetGone.code ?? 'ERR-STO-INTEGRITY', targetGone.message ?? 'target absence could not be verified after disposition');
    }
    const beforeSuccess = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid: request.serviceUid,
      limitProfile: storeInstance.limitProfile,
    });
    if (!beforeSuccess.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult('ERR-STO-DURABILITY', 'capability invalidated before acknowledgement; disposition is durable');
    }
    const rootRevalidated = revalidateParentIdentity(storeInstance.parentIdentity, request.serviceUid);
    if (!rootRevalidated.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult(rootRevalidated.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', rootRevalidated.message ?? 'trusted parent identity changed');
    }
    const released = release();
    if (!released.ok) return released;
    return { ok: true, outcome: 'disposed', evidenceId: evidenceBuilt.record.recordId };
  } finally {
    capability?.dispose();
  }
}

/** Deterministic disposition-evidence identity for the request bindings (ADR-032 §7/§8). */
function recomputedEvidenceId(
  storeInstance: VerifiedStoreInstance,
  action: RecoveryMutationRequest['action'] & { category: 'dispose-wpr023d-temporary' | 'dispose-quarantined-temporary' | 'dispose-conflicting-index' },
  expectedClassification: string,
): string {
  const targetEntry = action.targetEntry as string;
  const targetShard = action.targetShard as string | undefined;
  return computeDispositionEvidenceIdentity({
    storeInstance,
    evidenceKind: 'recovery-evidence',
    recoveryOperation: action.category === 'dispose-quarantined-temporary' ? 'dispose-quarantined-temporary' : 'dispose-conflicting-index',
    targetEntry,
    ...(action.category === 'dispose-quarantined-temporary' ? { targetShard: targetShard ?? '' } : { targetIndexId: targetEntry.slice(0, 32) }),
    targetClassification: expectedClassification,
    targetDigest: (action.expectedContentDigest as string) ?? '',
    observationId: (action.expectedObservationIds as readonly string[] | undefined)?.[0] ?? '',
    outcome: 'disposed',
  });
}

/**
 * Target-absent resolution for the executable disposition operations
 * (ADR-032 §8): TARGET ABSENT + MATCHING EVIDENCE → `already-completed`;
 * TARGET ABSENT + NO EVIDENCE → fail closed (nothing was disposed, no
 * inference); CONFLICTING EVIDENCE → fail closed. Returns undefined when
 * the request is not an executable-eligible disposition (adjudication-only
 * subclasses have no evidence model and fail closed as NOT-FOUND). The
 * caller releases the writer lock around the returned decision.
 */
function resolveAbsentTarget(
  storeInstance: VerifiedStoreInstance,
  action: RecoveryMutationRequest['action'] & { category: 'dispose-wpr023d-temporary' | 'dispose-quarantined-temporary' | 'dispose-conflicting-index' },
  evidenceId: string,
): { readonly ok: true; readonly evidenceId: string } | { readonly ok: false; readonly code: string; readonly message: string } | undefined {
  if (action.category === 'dispose-wpr023d-temporary') return undefined;
  const expectedClassification = action.expectedDispositionClassification as string;
  if (action.category === 'dispose-quarantined-temporary') {
    if (expectedClassification !== 'quarantine-malformed' && expectedClassification !== 'foreign-entry' && expectedClassification !== 'quarantine-conflict') {
      return undefined;
    }
  }
  const boundDigest = action.expectedContentDigest;
  if (boundDigest === undefined) return undefined;
  const targetEntry = action.targetEntry as string;
  const targetShard = action.targetShard as string | undefined;
  const verified = verifyExistingDispositionEvidence({
    namespaceRoot: `${storeInstance.parentIdentity.canonicalPath}/store-v1`,
    serviceUid: storeInstance.serviceUid,
    byteLimit: storeInstance.limitProfile['recordBytes'] ?? 1024 * 1024,
    evidenceId,
    recoveryOperation: action.category === 'dispose-quarantined-temporary' ? 'dispose-quarantined-temporary' : 'dispose-conflicting-index',
    targetEntry,
    ...(action.category === 'dispose-quarantined-temporary' ? { targetShard: targetShard ?? '' } : { targetIndexId: targetEntry.slice(0, 32) }),
    targetClassification: expectedClassification,
    targetDigest: boundDigest,
    observationId: (action.expectedObservationIds as readonly string[] | undefined)?.[0] ?? '',
  });
  if (!verified.ok) {
    return { ok: false, code: verified.code ?? 'ERR-STO-INTEGRITY', message: verified.message ?? 'existing disposition evidence conflicts with the authorized request' };
  }
  if (verified.matches) {
    return { ok: true, evidenceId };
  }
  return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'target is absent and no matching disposition evidence exists; fail closed (no inference)' };
}

/**
 * Execute one authorized recovery mutation. `orphan-removal`,
 * `quarantine-temporary`, `audit-reconstruction`, `registry-index-rebuild`,
 * the executable disposition operations (`dispose-quarantined-temporary`
 * for its eligible regular-file subclasses, `dispose-conflicting-index`
 * for the exact conflicting artifact), and the adjudication-only
 * `dispose-wpr023d-temporary` are executable in this slice; every other
 * category fails closed.
 */
export function executeRecoveryMutation(request: RecoveryMutationRequest): RecoveryMutationResult {
  const validation = validateAction(request);
  if (!validation.ok) {
    return failResult(validation.code ?? 'ERR-STO-REQ-INVALID', validation.message ?? 'recovery action validation failed');
  }
  const hooks = request.hooks ?? {};
  if (request.action.category === 'registry-index-rebuild') {
    return executeRegistryIndexRebuildMutation(request, request.action as RecoveryMutationRequest['action'] & { category: 'registry-index-rebuild' }, hooks);
  }
  if (
    request.action.category === 'dispose-wpr023d-temporary' ||
    request.action.category === 'dispose-quarantined-temporary' ||
    request.action.category === 'dispose-conflicting-index'
  ) {
    // The expected observation evidence and the expected disposition
    // finding must match the deterministic observation identity of the
    // committed scanner at the target's surface designation.
    const targetEntry = request.action.targetEntry as string;
    const targetShard = request.action.targetShard as string | undefined;
    let recomputedObservationId: string;
    if (request.action.category === 'dispose-wpr023d-temporary') {
      recomputedObservationId = temporaryObservationId(targetEntry);
    } else if (request.action.category === 'dispose-quarantined-temporary') {
      recomputedObservationId = quarantineObservationId(targetShard ?? '', targetEntry);
    } else {
      recomputedObservationId = indexObservationId(targetShard ?? '', targetEntry);
    }
    if (request.action.expectedObservationIds?.[0] !== recomputedObservationId || request.action.expectedDispositionFindingId !== recomputedObservationId) {
      return failResult('ERR-STO-REQ-INVALID', 'expected observation or disposition finding does not match the scanned target object');
    }
    return executeDispositionAdjudication(
      request,
      request.action as RecoveryMutationRequest['action'] & { category: 'dispose-wpr023d-temporary' | 'dispose-quarantined-temporary' | 'dispose-conflicting-index' },
      hooks,
    );
  }
  if (request.action.category === 'audit-reconstruction') {
    // The expected observation evidence and the expected missing-audit
    // finding must match the deterministic record observation identity of
    // the WP-8-E scan at the target's derived canonical location.
    const targetRecordClass = request.action.targetRecordClass as RecordClassId;
    const targetRecordId = request.action.targetRecordId as string;
    const derived = deriveRecordRelativePath(targetRecordClass, targetRecordId);
    if (!derived.ok || derived.shard === undefined || derived.filename === undefined) {
      return failResult('ERR-STO-CONTAINMENT-DENIED', 'target record path derivation failed');
    }
    const recomputedObservationId = recordObservationId(targetRecordClass, derived.shard, derived.filename);
    if (request.action.expectedObservationIds?.[0] !== recomputedObservationId || request.action.expectedMissingAuditFindingId !== recomputedObservationId) {
      return failResult('ERR-STO-REQ-INVALID', 'expected observation or missing-audit finding does not match the scanned target record');
    }
    return executeAuditReconstructionMutation(request, request.action as RecoveryMutationRequest['action'] & { category: 'audit-reconstruction' }, hooks);
  }
  // The expected observation evidence must match the deterministic
  // temporary-object observation identity of the WP-8-E scan.
  const recomputedObservationId = temporaryObservationId(request.action.targetEntry!);
  if (request.action.expectedObservationIds?.[0] !== recomputedObservationId) {
    return failResult('ERR-STO-REQ-INVALID', 'expected observation evidence does not match the scanned temporary object');
  }
  if (request.action.category === 'quarantine-temporary') {
    return executeQuarantineMutation(request, request.action as RecoveryMutationRequest['action'] & { category: 'quarantine-temporary' }, hooks);
  }
  const action = request.action as {
    category: 'orphan-removal';
    targetEntry: string;
    expectedTwinRecordId: string;
    expectedTwinRecordClass: RecordClassId;
    expectedTwinDigest: string;
    expectedLinkCount: number;
    expectedObservationIds: readonly string[];
    expectedGeneration: string;
    expectedSurfaceGeneration: string;
  };
  // Genuine trusted recovery request (authority boundary; WP-8-F §1).
  const inputResult = createTrustedRecoveryRequest(
    request.trustedConfiguration,
    request.recoveryActionProvenance,
    { locator: request.locator, serviceUid: request.serviceUid, forbiddenRoots: request.forbiddenRoots, limitProfile: request.limitProfile },
  );
  if (!inputResult.ok || inputResult.request === undefined) {
    const code = inputResult.reason === 'not-genuine-configuration' || inputResult.reason === 'not-genuine-action-provenance' || inputResult.reason === 'configuration-identity-mismatch'
      ? 'ERR-STO-CONFIG-UNAVAILABLE'
      : 'ERR-STO-REQ-INVALID';
    return failResult(code, inputResult.message ?? 'trusted recovery request could not be established');
  }
  // Store revalidation through the metadata verification pipeline.
  const store = verifyStoreInstance({
    locator: request.locator,
    serviceUid: request.serviceUid,
    forbiddenRoots: request.forbiddenRoots,
    configurationIdentity: (request.trustedConfiguration as { readonly identity: string }).identity,
    configurationVersion: (request.trustedConfiguration as { readonly configurationVersion: string }).configurationVersion,
    limitProfile: request.limitProfile,
  });
  if (!store.ok || store.storeInstance === undefined) {
    return failResult(store.code ?? 'ERR-STO-INTEGRITY', store.message ?? 'store revalidation failed');
  }
  const storeInstance = store.storeInstance;
  const recoveryCapability = createRecoveryCapability({ trustedRecoveryRequest: inputResult.request, storeInstance });
  if (recoveryCapability === undefined) {
    return failResult('ERR-STO-REQ-INVALID', 'recovery capability could not be issued');
  }
  let capability: RecoveryCapability | undefined = recoveryCapability;
  try {
    // Assessment-generation recomputation: the recovery scan's token must
    // still match (store identity, mode, recovery limits, fail-closed).
    const profile = storeInstance.limitProfile;
    const recomputedGeneration = computeScanGeneration({
      storeInstance,
      mode: 'recovery',
      entryLimit: profile['recoveryScanEntries'] ?? 1024 * 1024,
      byteLimit: profile['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024,
      failClosed: true,
    });
    if (recomputedGeneration !== action.expectedGeneration) {
      return failResult('ERR-STO-REQ-INVALID', 'assessment scan generation does not match the current store and limits');
    }
    // Surface-structure recomputation (F3-G): assessed structure must match.
    const storeRoot = `${storeInstance.parentIdentity.canonicalPath}/store-v1`;
    const surface = recomputeSurfaceGeneration({ namespaceRoot: storeRoot, serviceUid: request.serviceUid, mode: 'recovery' });
    if (!surface.ok || surface.generation === undefined) {
      return failResult(surface.code ?? 'ERR-STO-IO-FAILURE', surface.message ?? 'surface structure could not be re-read');
    }
    if (surface.generation !== action.expectedSurfaceGeneration) {
      return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'store structure changed since the recovery assessment');
    }

    // CAP-009 boundary: capability live and bound before the first mutation.
    const bound = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid: request.serviceUid,
      limitProfile: storeInstance.limitProfile,
    });
    if (!bound.ok) {
      return failResult('ERR-STO-REQ-INVALID', 'recovery capability binding mismatch');
    }

    // Single-writer lock acquisition (never broken or replaced; LOK).
    hooks.stage?.('before-lock-acquisition');
    const locksDir = `${storeRoot}/locks`;
    const lockPath = `${locksDir}/writer.lock`;
    const lockWaitMs = profile['lockWait'] ?? 5000;
    const acquired = acquireWriterLock({
      capability,
      operation: 'orphan-removal',
      lockPath,
      locksDirPath: locksDir,
      storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      actionIdentity: inputResult.request.actionIdentity,
      lockWaitMs,
      timeSource: request.timeSource,
      hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!acquired.ok || acquired.record === undefined) {
      return failResult(acquired.code ?? 'ERR-STO-LOCK-UNAVAILABLE', acquired.message ?? 'writer lock could not be acquired');
    }
    const lockRecord = acquired.record;
    hooks.stage?.('after-lock-acquisition');

    const release = (): RecoveryMutationResult => {
      hooks.stage?.('before-lock-release');
      const released = releaseWriterLock({
        capability,
        operation: 'orphan-removal',
        lockPath,
        locksDirPath: locksDir,
        expected: { nonce: lockRecord.nonce, storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })) },
        timeSource: request.timeSource,
        hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
      });
      if (!released.ok) {
        return failResult('ERR-STO-RECOVERY-FAILED', 'lock release failed; the lock remains for recovery');
      }
      return { ok: true };
    };

    // Descriptor-bound re-verification of the target and its durable twin.
    const temporaryBytes = profile['temporaryBytes'] ?? 64 * 1024 * 1024;
    const recordBytes = profile['recordBytes'] ?? 1024 * 1024;
    const verified = reverifyOrphanTwin({
      capability,
      namespaceRoot: storeRoot,
      serviceUid: request.serviceUid,
      temporaryBytes,
      recordBytes,
      targetEntry: action.targetEntry,
      expectedTwinRecordId: action.expectedTwinRecordId,
      expectedTwinDigest: action.expectedTwinDigest,
      expectedLinkCount: action.expectedLinkCount,
      expectedSurfaceGeneration: action.expectedSurfaceGeneration,
    });
    hooks.stage?.('after-target-verification');

    const evidenceBuildInput = {
      storeInstance,
      actionIdentity: inputResult.request.actionIdentity,
      evidenceKind: 'recovery-evidence' as const,
      recoveryOperation: 'orphan-removal' as const,
      targetEntry: action.targetEntry,
      twinRecordId: action.expectedTwinRecordId,
      twinRecordClass: action.expectedTwinRecordClass,
      twinRecordDigest: action.expectedTwinDigest,
      observationIds: action.expectedObservationIds,
      generation: recomputedGeneration,
      surfaceGeneration: surface.generation,
      createdAt: isoFromEpochMs(request.timeSource.now()),
    };

    if (!verified.ok && verified.code === 'ERR-STO-NOT-FOUND') {
      // Already-removed / interrupted-removal path: the temporary name is
      // gone. The durable twin must be intact with the link count reduced
      // by exactly one.
      const twin = reverifyTwinOnly({
        namespaceRoot: storeRoot,
        serviceUid: request.serviceUid,
        recordBytes,
        twinRecordId: action.expectedTwinRecordId,
        twinRecordClass: action.expectedTwinRecordClass,
        expectedTwinDigest: action.expectedTwinDigest,
        expectedLinkCount: action.expectedLinkCount,
      });
      if (!twin.ok) {
        const released = release();
        if (!released.ok) return released;
        return failResult(twin.code ?? 'ERR-STO-INTEGRITY', twin.message ?? 'durable twin could not be confirmed on the already-removed path');
      }
      // Evidence roll-forward: if the recovery evidence is already durable
      // with a matching factual binding, the result is deterministic
      // already-completed; otherwise the evidence half is completed now.
      const evidenceBuild = buildRecoveryEvidenceRecord({ ...evidenceBuildInput, outcome: 'orphan-removed' as const });
      if (!evidenceBuild.ok || evidenceBuild.record === undefined) {
        const released = release();
        if (!released.ok) return released;
        return failResult(evidenceBuild.code ?? 'ERR-STO-INTERNAL-INVARIANT', evidenceBuild.message ?? 'recovery evidence could not be constructed');
      }
      const existing = verifyExistingRecoveryEvidence({
        namespaceRoot: storeRoot,
        serviceUid: request.serviceUid,
        byteLimit: recordBytes,
        evidenceId: evidenceBuild.record.recordId,
        targetEntry: action.targetEntry,
        twinRecordId: action.expectedTwinRecordId,
        twinRecordDigest: action.expectedTwinDigest,
      });
      if (!existing.ok) {
        const released = release();
        if (!released.ok) return released;
        return failResult(existing.code ?? 'ERR-STO-INTEGRITY', existing.message ?? 'existing recovery evidence could not be verified');
      }
      if (existing.matches) {
        const released = release();
        if (!released.ok) return released;
        return { ok: true, outcome: 'already-completed', evidenceId: evidenceBuild.record.recordId };
      }
      hooks.stage?.('before-evidence-publication');
      const evidencePublished = publishRecoveryEvidence({
        capability,
        storeInstance,
        namespaceRoot: storeRoot,
        serviceUid: request.serviceUid,
        byteLimit: recordBytes,
        record: evidenceBuild.record,
        hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
      });
      if (!evidencePublished.ok) {
        const released = release();
        if (!released.ok) return released;
        return failResult(evidencePublished.code ?? 'ERR-STO-RECOVERY-FAILED', evidencePublished.message ?? 'recovery evidence is not durable');
      }
      hooks.stage?.('after-evidence-publication');
      const released = release();
      if (!released.ok) return released;
      return { ok: true, outcome: 'removed', evidenceId: evidenceBuild.record.recordId };
    }

    if (!verified.ok || verified.temp === undefined || verified.twin === undefined || verified.twin.recordClass === undefined) {
      const released = release();
      if (!released.ok) return released;
      return failResult(verified.code ?? 'ERR-STO-INTEGRITY', verified.message ?? 'target re-verification failed');
    }
    // The derived twin class must equal the authorized class.
    if (verified.twin.recordClass !== action.expectedTwinRecordClass) {
      const released = release();
      if (!released.ok) return released;
      return failResult('ERR-STO-INTEGRITY', 'durable twin class does not match the authorized request');
    }

    // Safe cleanup: exact temporary-name unlink + tmp/ directory fsync.
    const twinDerived = deriveRecordRelativePath(verified.twin.recordClass, verified.twin.recordId);
    if (!twinDerived.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult('ERR-STO-CONTAINMENT-DENIED', 'twin path derivation failed');
    }
    const cleaned = removeOrphanTemporary({
      capability,
      tmpDirPath: `${storeRoot}/tmp`,
      tmpName: action.targetEntry,
      serviceUid: request.serviceUid,
      verifiedTemp: verified.temp,
      twinPath: `${storeRoot}/${twinDerived.relativePath}`,
      verifiedTwin: verified.twin,
      hooks,
    });
    if (!cleaned.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult(cleaned.code ?? 'ERR-STO-RECOVERY-FAILED', cleaned.message ?? 'orphan temporary could not be removed');
    }

    // Durable recovery evidence (StoreEvidenceRecord; WPR-023 (a) "remove
    // with evidence"). Identity is deterministic; replay publishes
    // byte-identical bytes or recognizes the existing evidence.
    const evidenceBuild = buildRecoveryEvidenceRecord({ ...evidenceBuildInput, outcome: 'orphan-removed' as const });
    if (!evidenceBuild.ok || evidenceBuild.record === undefined) {
      const released = release();
      if (!released.ok) return released;
      return failResult(evidenceBuild.code ?? 'ERR-STO-INTERNAL-INVARIANT', evidenceBuild.message ?? 'recovery evidence could not be constructed');
    }
    hooks.stage?.('before-evidence-publication');
    const evidencePublished = publishRecoveryEvidence({
      capability,
      storeInstance,
      namespaceRoot: storeRoot,
      serviceUid: request.serviceUid,
      byteLimit: recordBytes,
      record: evidenceBuild.record,
      hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
    });
    if (!evidencePublished.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult(evidencePublished.code ?? 'ERR-STO-RECOVERY-FAILED', evidencePublished.message ?? 'recovery evidence is not durable');
    }
    hooks.stage?.('after-evidence-publication');

    // CAP-009 boundary before success: capability + trusted roots.
    const beforeSuccess = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid: request.serviceUid,
      limitProfile: storeInstance.limitProfile,
    });
    if (!beforeSuccess.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult('ERR-STO-DURABILITY', 'capability invalidated before acknowledgement; removal and evidence are durable');
    }
    const rootRevalidated = revalidateParentIdentity(storeInstance.parentIdentity, request.serviceUid);
    if (!rootRevalidated.ok) {
      const released = release();
      if (!released.ok) return released;
      return failResult(rootRevalidated.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', rootRevalidated.message ?? 'trusted parent identity changed');
    }

    const released = release();
    if (!released.ok) return released;
    return { ok: true, outcome: 'removed', evidenceId: evidenceBuild.record.recordId };
  } finally {
    capability?.dispose();
  }
}
