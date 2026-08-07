/**
 * WP-8-F authorized recovery-mutation composition boundary (contract 16.2,
 * WPR-023 (a), CSA-001/010, CAP-008/009, LOK; contract 21.1 recovery
 * capability). FILESYSTEM-FREE: all filesystem work is delegated to the
 * exact fs-bearing owners (`recovery/reverify.ts`, `recovery/cleanup.ts`,
 * `locks/lock.ts`, `publication/publish-record.ts`).
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
 * target/twin re-verification → exact temporary-name unlink with `tmp/`
 * directory fsync → durable recovery evidence (StoreEvidenceRecord
 * `recovery-evidence` + its authorized-write audit event) → capability and
 * root revalidation → identity-bound lock release. Any mismatch fails
 * closed before any mutation.
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
import { createTrustedRecoveryRequest } from '../trusted-input/bootstrap-input.js';
import { verifyStoreInstance } from '../read/read-record.js';
import { revalidateParentIdentity } from '../root/resolve.js';
import { computeScanGeneration, temporaryObservationId, recomputeSurfaceGeneration, isPublicationTemporaryName } from './scan.js';
import { reverifyOrphanTwin, reverifyQuarantineSource, reverifyTwinOnly } from './reverify.js';
import { removeOrphanTemporary } from './cleanup.js';
import { executeQuarantineTemporary } from './quarantine.js';
import { buildQuarantineEvidenceRecord, buildRecoveryEvidenceRecord, computeQuarantineEvidenceIdentity, computeQuarantineTemporaryId, publishRecoveryEvidence, verifyExistingRecoveryEvidence, isoFromEpochMs } from './evidence.js';
import { acquireWriterLock, releaseWriterLock } from '../locks/lock.js';
import { deriveRecordRelativePath } from '../layout/layout.js';
import { isValidDigestSyntax } from '../format/envelope.js';
import { RECORD_CLASS_BY_ID } from '../format/taxonomy.js';
import type { RecoveryMutationRequest, RecoveryMutationResult, RecordClassId, StorageFinding } from '../types.js';

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

/** Validate the narrow structured action (never a plan action; never a path). */
function validateAction(input: RecoveryMutationRequest): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  const action = input.action;
  if (typeof action !== 'object' || action === null) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery action is malformed' };
  }
  if (action.category !== 'orphan-removal' && action.category !== 'quarantine-temporary') {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery action category is outside the supported vocabulary; no generic quarantine authority exists' };
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
  const expectedSourceDigest = action.expectedSourceDigest as string | undefined;
  if (expectedClassification === undefined || expectedSourceDigest === undefined) {
    return failResult('ERR-STO-REQ-INVALID', 'quarantine request is missing the expected classification or source digest');
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
      targetEntry: action.targetEntry,
      expectedClassification: classification,
      expectedSourceDigest: sourceDigest,
      expectedSurfaceGeneration: action.expectedSurfaceGeneration,
    });
    hooks.stage?.('after-source-verification');

    const quarantineId = computeQuarantineTemporaryId({
      storeInstance,
      sourceEntry: action.targetEntry,
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
        sourceEntry: action.targetEntry,
        sourceClassification: classification,
        sourceDigest,
        observationIds: action.expectedObservationIds,
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
        targetEntry: action.targetEntry,
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
      targetEntry: action.targetEntry,
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
 * Execute one authorized recovery mutation. Only `orphan-removal` is
 * executable in this slice; every other category fails closed.
 */
export function executeRecoveryMutation(request: RecoveryMutationRequest): RecoveryMutationResult {
  const validation = validateAction(request);
  if (!validation.ok) {
    return failResult(validation.code ?? 'ERR-STO-REQ-INVALID', validation.message ?? 'recovery action validation failed');
  }
  const hooks = request.hooks ?? {};
  // The expected observation evidence must match the deterministic
  // temporary-object observation identity of the WP-8-E scan.
  const recomputedObservationId = temporaryObservationId(request.action.targetEntry);
  if (request.action.expectedObservationIds[0] !== recomputedObservationId) {
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
