/**
 * WP-8-M authorized configuration-namespace recovery composition boundary
 * (contract §16.7/CSA-016…018; ADR-036). FILESYSTEM-FREE: all filesystem
 * work is delegated to the exact fs-bearing owners (the metadata
 * persistence owner `metadata/bootstrap-persist.ts`, the probe owner
 * `probe/probe.ts`, the scan/classification owner `recovery/scan.ts`, the
 * revalidation owner `read/read-record.ts`, the lock owner
 * `locks/lock.ts`, and the evidence publication owner
 * `recovery/evidence.ts`).
 *
 * DUAL-AUTHORITY GATE (ADR-036 §2): configuration recovery executes only
 * when BOTH inputs are genuine:
 *   1. recovery authority — genuine branded recovery-action provenance,
 *      the exact `recover-configuration-namespace` operation, and the
 *      verified store instance (config-tolerant revalidation: parent +
 *      both namespace descriptors + fully verified store-records
 *      metadata); and
 *   2. trusted configuration/bootstrap input — a genuine branded
 *      `TrustedStorageBootstrapInput` correlated with the genuine WP-6
 *      trusted configuration, binding the exact configuration identity,
 *      configuration version, and the deterministic trusted-input identity
 *      digest.
 * The recovery capability can never invent or modify trusted configuration
 * facts; the trusted input alone grants no filesystem mutation authority
 * (the capability gate is mandatory). Only the composition of both gates
 * enables the exact recovery action. An on-disk configuration object NEVER
 * authorizes its own repair: the expected canonical bytes are derived
 * purely from the genuine trusted input + verified store facts via the
 * SAME canonical transformation used by normal initialization
 * (`fullFacts` + `buildStoreMetadata` + the compatibility probe), never
 * from on-disk configuration contents.
 *
 * NO OVERWRITE: the canonical destination is published with the exact
 * no-overwrite metadata protocol; an existing object is only byte-exact
 * replayed (idempotent) or fails closed — never truncated, replaced,
 * renamed over, chmod/chown-repaired, or unlinked. Missing metadata
 * DIRECTORY is not recovery-recoverable (bootstrap action required).
 */
import { createRecoveryCapability, createConfigurationRecoveryMetadataPermit, type RecoveryCapability } from '../capabilities/authenticity.js';
import { createTrustedRecoveryRequest, isGenuineTrustedStorageBootstrapInput, type TrustedStorageBootstrapInput } from '../trusted-input/bootstrap-input.js';
import { verifyStoreInstanceConfigurationTolerant, verifyStoreMetadataAtPath, STORE_LANE, STORE_LAYOUT_VERSION, STORE_METADATA_FORMAT_VERSION } from '../read/read-record.js';
import { revalidateParentIdentity } from '../root/resolve.js';
import { metadataFilePath, provisionRecoveryPhase3TopLevel } from '../initialization/provision.js';
import { buildStoreMetadata, METADATA_FORMAT_VERSION, type StoreMetadataExpectation } from '../metadata/store-metadata.js';
import { persistRecoveryConfigurationMetadata } from '../metadata/bootstrap-persist.js';
import { runCompatibilityProbeRecovery } from '../probe/probe.js';
import { computeScanGeneration, recomputeSurfaceGeneration, classifyConfigurationMetadataState, configurationMetadataObservationId } from './scan.js';
import { acquireWriterLock, releaseWriterLock } from '../locks/lock.js';
import {
  computeTrustedInputIdentity,
  buildConfigurationRecoveryEvidenceRecord,
  configurationRecoveryEvidenceIdentityFacts,
  verifyExistingConfigurationRecoveryEvidence,
  publishRecoveryEvidence,
  verifyRecoveryEvidenceDurability,
  isoFromEpochMs,
  type RecoveryEvidenceBuild,
} from './evidence.js';
import { deriveRecordRelativePath } from '../layout/layout.js';
import type { ConfigurationMetadataState, RecoveryMutationRequest, RecoveryMutationResult, StorageFinding, StoreMetadataFacts, VerifiedStoreInstance } from '../types.js';

const NO_STATE = { retryable: false, recoveryRequired: false, primaryStateChanged: 'no' as const, durabilityPointReached: 'no' as const, auditChanged: 'no' as const, verifyBeforeRetry: false };

/** The only recoverable configuration state in this slice (§16.7). */
const RECOVERABLE_STATE: ConfigurationMetadataState = 'configuration-missing';

function finding(code: string, message: string, phase: StorageFinding['phase'] = 'request-validation'): StorageFinding {
  return { code, message, phase, state: NO_STATE };
}

function failResult(code: string, message: string): RecoveryMutationResult {
  return { ok: false, findings: [finding(code, message)] };
}

function configFacts(trustedConfiguration: unknown): { readonly configurationVersion: string; readonly configurationIdentity: string } | undefined {
  if (typeof trustedConfiguration !== 'object' || trustedConfiguration === null) return undefined;
  const c = trustedConfiguration as Readonly<Record<string, unknown>>;
  if (typeof c['configurationVersion'] !== 'string' || typeof c['identity'] !== 'string') return undefined;
  return { configurationVersion: c['configurationVersion'], configurationIdentity: c['identity'] };
}

/** Validate the exact configuration-recovery action (never a path, JSON, callback, or plan action). */
export function validateConfigurationRecoveryAction(action: RecoveryMutationRequest['action']): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  if (action.category !== 'recover-configuration-namespace') {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'action category is not the configuration-namespace recovery operation' };
  }
  if (typeof action.expectedConfigurationIdentity !== 'string' || !/^sha-256:[0-9a-f]{64}$/.test(action.expectedConfigurationIdentity)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected configuration identity is malformed' };
  }
  if (typeof action.expectedConfigurationVersion !== 'string' || action.expectedConfigurationVersion.length === 0) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected configuration version is malformed' };
  }
  if (typeof action.expectedTrustedInputIdentity !== 'string' || !/^sha-256:[0-9a-f]{64}$/.test(action.expectedTrustedInputIdentity)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected trusted-input identity is malformed' };
  }
  if (typeof action.expectedConfigurationDigest !== 'string' || !/^sha-256:[0-9a-f]{64}$/.test(action.expectedConfigurationDigest)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected configuration digest is malformed' };
  }
  if (typeof action.expectedConfigurationObservationId !== 'string' || action.expectedConfigurationObservationId.length === 0 || !action.expectedConfigurationObservationId.startsWith('obs-')) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected configuration observation identity is malformed' };
  }
  if (typeof action.expectedGeneration !== 'string' || !/^sha-256:[0-9a-f]{64}$/.test(action.expectedGeneration)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected generation is malformed' };
  }
  if (typeof action.expectedSurfaceGeneration !== 'string' || !/^sha-256:[0-9a-f]{64}$/.test(action.expectedSurfaceGeneration)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'expected surface generation is malformed' };
  }
  return { ok: true };
}

/** Registry of recovery fields that must NOT appear on this category. */
function hasForeignActionFields(action: RecoveryMutationRequest['action']): boolean {
  const allowed: readonly string[] = [
    'category',
    'expectedConfigurationIdentity',
    'expectedConfigurationVersion',
    'expectedTrustedInputIdentity',
    'expectedConfigurationDigest',
    'expectedConfigurationObservationId',
    'expectedGeneration',
    'expectedSurfaceGeneration',
  ];
  return Object.keys(action).some((k) => !(allowed as readonly string[]).includes(k));
}

/**
 * Execute the exact configuration-namespace recovery operation (§16.7;
 * ADR-036 §4/§6; the 16-step recovery ordering).
 */
export function executeConfigurationRecovery(
  request: RecoveryMutationRequest,
  action: RecoveryMutationRequest['action'] & { category: 'recover-configuration-namespace' },
  hooks: NonNullable<RecoveryMutationRequest['hooks']>,
): RecoveryMutationResult {
  const validation = validateConfigurationRecoveryAction(action);
  if (!validation.ok) {
    return failResult(validation.code ?? 'ERR-STO-REQ-INVALID', validation.message ?? 'configuration-recovery action validation failed');
  }
  if (hasForeignActionFields(action)) {
    return failResult('ERR-STO-REQ-INVALID', 'configuration-recovery action carries fields outside the closed vocabulary');
  }
  // ── Step 1-2: dual authority — recovery provenance AND genuine trusted input. ──
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
  if (!isGenuineTrustedStorageBootstrapInput(request.trustedInput)) {
    return failResult('ERR-STO-REQ-INVALID', 'trusted configuration/bootstrap input is not genuine');
  }
  const trustedInput = request.trustedInput as TrustedStorageBootstrapInput;
  const facts = configFacts(request.trustedConfiguration);
  if (facts === undefined) {
    return failResult('ERR-STO-CONFIG-UNAVAILABLE', 'trusted configuration facts are unavailable');
  }
  if (trustedInput.configurationIdentity !== facts.configurationIdentity || trustedInput.configurationIdentity !== inputResult.request.configurationIdentity) {
    return failResult('ERR-STO-CONFIG-UNAVAILABLE', 'trusted input does not correlate with the trusted configuration and recovery provenance');
  }
  if (facts.configurationVersion !== action.expectedConfigurationVersion) {
    return failResult('ERR-STO-REQ-INVALID', 'configuration version does not match the trusted decision binding');
  }
  const trustedInputIdentity = computeTrustedInputIdentity({
    configurationIdentity: trustedInput.configurationIdentity,
    serviceUid: trustedInput.serviceUid,
    forbiddenRoots: trustedInput.forbiddenRoots,
    limitProfile: trustedInput.limitProfile,
    locator: trustedInput.locator,
  });
  if (trustedInputIdentity !== action.expectedTrustedInputIdentity) {
    return failResult('ERR-STO-REQ-INVALID', 'trusted-input identity does not match the trusted decision binding');
  }
  if (facts.configurationIdentity !== action.expectedConfigurationIdentity) {
    return failResult('ERR-STO-REQ-INVALID', 'configuration identity does not match the trusted decision binding');
  }

  // ── Step 3: config-tolerant store revalidation (the store identity anchor). ──
  const store = verifyStoreInstanceConfigurationTolerant({
    locator: request.locator,
    serviceUid: request.serviceUid,
    forbiddenRoots: request.forbiddenRoots,
    configurationIdentity: facts.configurationIdentity,
    configurationVersion: facts.configurationVersion,
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
    const recordBytes = profile['recordBytes'] ?? 1024 * 1024;
    const configRoot = `${storeInstance.parentIdentity.canonicalPath}/config-v1`;
    const namespaceRoot = `${storeInstance.parentIdentity.canonicalPath}/store-v1`;
    const serviceUid = request.serviceUid;
    const metadataPath = metadataFilePath(configRoot);
    const metadataDirPath = `${configRoot}/metadata`;

    const bound = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid,
      limitProfile: profile,
    });
    if (!bound.ok) {
      return failResult('ERR-STO-REQ-INVALID', 'recovery capability binding mismatch');
    }

    // ── Step 4-5: derive the expected canonical configuration from trusted
    // input via the SAME trusted-input-to-storage transformation as normal
    // initialization (probe + full facts + buildStoreMetadata). ──
    const probe = runCompatibilityProbeRecovery(capability, inputResult.request.actionIdentity, `${configRoot}/tmp`, `${namespaceRoot}/tmp`);
    if (!probe.ok || probe.profile === undefined) {
      return failResult(probe.code ?? 'ERR-STO-FS-UNSUPPORTED', probe.message ?? 'compatibility probe failed at the configuration-recovery boundary');
    }
    const expectation: StoreMetadataExpectation = {
      metadataFormatVersion: STORE_METADATA_FORMAT_VERSION,
      layoutVersion: STORE_LAYOUT_VERSION,
      namespaceKind: 'configuration',
      namespaceIdentity: storeInstance.namespaces.find((n) => n.kind === 'configuration')!,
      parentIdentity: storeInstance.parentIdentity,
      lane: STORE_LANE,
      configurationIdentity: facts.configurationIdentity,
      actionIdentity: trustedInput.actionIdentity,
      limitProfileIdentity: { configurationVersion: facts.configurationVersion, configurationIdentity: facts.configurationIdentity },
    };
    const metadataFacts: StoreMetadataFacts = { ...expectation, probe: probe.profile };
    const built = buildStoreMetadata(metadataFacts);
    if (!built.ok || built.metadata === undefined) {
      return failResult(built.code ?? 'ERR-STO-INTERNAL-INVARIANT', built.message ?? 'expected configuration metadata could not be constructed');
    }
    if (built.metadata.recordByteDigest !== action.expectedConfigurationDigest) {
      return failResult('ERR-STO-REQ-INVALID', 'expected configuration digest does not match the trusted decision binding');
    }
    const expectedCanonicalUtf8 = built.metadata.canonicalUtf8;

    // ── Step 6-8: recompute the recovery generation and surface; classify
    // the current configuration state (pre-lock observation). ──
    const generation = computeScanGeneration({
      storeInstance,
      mode: 'recovery',
      entryLimit: profile['recoveryScanEntries'] ?? 1024 * 1024,
      byteLimit: profile['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024,
      failClosed: true,
    });
    if (generation !== action.expectedGeneration) {
      return failResult('ERR-STO-REQ-INVALID', 'recovery scan generation does not match the trusted decision');
    }
    const surface = recomputeSurfaceGeneration({ namespaceRoot, serviceUid, mode: 'recovery' });
    if (!surface.ok || surface.generation === undefined) {
      return failResult(surface.code ?? 'ERR-STO-IO-FAILURE', surface.message ?? 'surface structure could not be re-read');
    }
    if (surface.generation !== action.expectedSurfaceGeneration) {
      return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'store structure changed since the trusted decision');
    }
    const surfaceGeneration = surface.generation;
    const preClassification = classifyConfigurationMetadataState({
      configRoot,
      serviceUid,
      byteLimit: recordBytes,
      expectedCanonicalUtf8,
      expectedDigest: built.metadata.recordByteDigest,
      configurationIdentity: facts.configurationIdentity,
      storeInstance,
    });
    if (!preClassification.ok || preClassification.observation === undefined) {
      return failResult(preClassification.code ?? 'ERR-STO-IO-FAILURE', preClassification.message ?? 'configuration namespace could not be classified');
    }
    if (preClassification.observation.id !== action.expectedConfigurationObservationId) {
      return failResult('ERR-STO-REQ-INVALID', 'configuration observation identity does not match the trusted decision; the configuration state changed');
    }
    const preState = preClassification.observation.state;
    // Idempotency: an exact healthy configuration without evidence is the
    // non-mutating already-present state (no recovery evidence fabricated —
    // a healthy store is indistinguishable from an interrupted recovery and
    // evidence roll-forward is only provable under contract facts).
    if (preState === 'configuration-healthy') {
      // Verify the evidence state for the already-completed classification.
      const evidenceId = configurationRecoveryEvidenceIdentityFacts({
        storeInstance,
        evidenceKind: 'recovery-evidence',
        recoveryOperation: 'recover-configuration-namespace',
        configurationIdentity: facts.configurationIdentity,
        configurationVersion: facts.configurationVersion,
        metadataFormatVersion: METADATA_FORMAT_VERSION,
        configurationDigest: built.metadata.recordByteDigest,
        trustedInputIdentity,
        outcome: 'configuration-recovered',
      });
      const evidenceCheck = verifyExistingConfigurationRecoveryEvidence({
        namespaceRoot,
        serviceUid,
        byteLimit: recordBytes,
        evidenceId,
        configurationIdentity: facts.configurationIdentity,
        configurationVersion: facts.configurationVersion,
        configurationDigest: built.metadata.recordByteDigest,
        trustedInputIdentity,
      });
      if (!evidenceCheck.ok) {
        return failResult(evidenceCheck.code ?? 'ERR-STO-INTEGRITY', evidenceCheck.message ?? 'existing configuration-recovery evidence conflicts with the trusted decision');
      }
      if (evidenceCheck.matches === true) {
        return { ok: true, outcome: 'already-completed', evidenceId };
      }
      return { ok: true, outcome: 'already-present' };
    }
    if (preState !== RECOVERABLE_STATE) {
      // Every other state fails closed (external disposition / migration
      // boundary / bootstrap action); recovery never mutates them.
      return failResult('ERR-STO-RECOVERY-REQUIRED', `configuration state ${preState} is not recovery-recoverable; external disposition or bootstrap action required`);
    }
    // Pre-lock evidence conflict check (missing configuration + matching
    // completion evidence is an integrity failure).
    const evidenceId = configurationRecoveryEvidenceIdentityFacts({
      storeInstance,
      evidenceKind: 'recovery-evidence',
      recoveryOperation: 'recover-configuration-namespace',
      configurationIdentity: facts.configurationIdentity,
      configurationVersion: facts.configurationVersion,
      metadataFormatVersion: METADATA_FORMAT_VERSION,
      configurationDigest: built.metadata.recordByteDigest,
      trustedInputIdentity,
      outcome: 'configuration-recovered',
    });
    const evidenceCheck = verifyExistingConfigurationRecoveryEvidence({
      namespaceRoot,
      serviceUid,
      byteLimit: recordBytes,
      evidenceId,
      configurationIdentity: facts.configurationIdentity,
      configurationVersion: facts.configurationVersion,
      configurationDigest: built.metadata.recordByteDigest,
      trustedInputIdentity,
    });
    if (!evidenceCheck.ok) {
      return failResult(evidenceCheck.code ?? 'ERR-STO-INTEGRITY', evidenceCheck.message ?? 'existing configuration-recovery evidence conflicts with the trusted decision');
    }
    if (evidenceCheck.matches === true) {
      return failResult('ERR-STO-INTEGRITY', 'configuration-recovery evidence is durable while the expected configuration object is missing; integrity failure');
    }

    // ── Step 9: provision the exact phase-3 top-level entry set (records,
    // audit, locks in both namespaces — a freshly initialized store has
    // none until the first write publication) and acquire the normal writer
    // lock. Provisioning is confined to the exact fixed phase-3 set and
    // runs before lock acquisition exactly like the write path; the
    // configuration METADATA directory is never created by recovery and
    // index/quarantine are never created. ──
    const provisioned = provisionRecoveryPhase3TopLevel(capability, storeInstance.parentIdentity, serviceUid);
    if (!provisioned.ok) {
      return failResult(provisioned.code ?? 'ERR-STO-IO-FAILURE', provisioned.message ?? 'phase-3 top-level directories could not be established');
    }
    hooks.stage?.('before-writer-lock');
    const locksDir = `${namespaceRoot}/locks`;
    const lockPath = `${locksDir}/writer.lock`;
    const lockWaitMs = profile['lockWait'] ?? 5000;
    const acquired = acquireWriterLock({
      capability,
      operation: 'recover-configuration-namespace',
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
    hooks.stage?.('after-writer-lock');
    const release = (): RecoveryMutationResult => {
      hooks.stage?.('before-writer-lock-release');
      const released = releaseWriterLock({
        capability,
        operation: 'recover-configuration-namespace',
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

    // ── Steps 10-14: under-lock current-state re-enumeration and
    // re-classification; trusted-input revalidation; a conflicting object
    // that appeared after the initial scan fails closed (never overwritten). ──
    const reBound = capability.assertExpected({
      storeInstance,
      configurationIdentity: storeInstance.configurationIdentity,
      serviceUid,
      limitProfile: profile,
    });
    if (!reBound.ok) {
      return failClosed('ERR-STO-REQ-INVALID', 'recovery capability binding mismatch under the writer lock');
    }
    const reInputIdentity = computeTrustedInputIdentity({
      configurationIdentity: trustedInput.configurationIdentity,
      serviceUid: trustedInput.serviceUid,
      forbiddenRoots: trustedInput.forbiddenRoots,
      limitProfile: trustedInput.limitProfile,
      locator: trustedInput.locator,
    });
    if (reInputIdentity !== action.expectedTrustedInputIdentity) {
      return failClosed('ERR-STO-REQ-INVALID', 'trusted-input identity changed under the writer lock; recovery fails closed');
    }
    const reClassification = classifyConfigurationMetadataState({
      configRoot,
      serviceUid,
      byteLimit: recordBytes,
      expectedCanonicalUtf8,
      expectedDigest: built.metadata.recordByteDigest,
      configurationIdentity: facts.configurationIdentity,
      storeInstance,
    });
    if (!reClassification.ok || reClassification.observation === undefined) {
      return failClosed(reClassification.code ?? 'ERR-STO-IO-FAILURE', reClassification.message ?? 'configuration namespace could not be re-classified under the writer lock');
    }
    if (reClassification.observation.id !== action.expectedConfigurationObservationId) {
      return failClosed('ERR-STO-ROOT-IDENTITY-CHANGED', 'configuration state changed after the initial observation; fail closed');
    }
    if (reClassification.observation.state !== RECOVERABLE_STATE) {
      return failClosed('ERR-STO-INTEGRITY', 'configuration state changed under the writer lock; the conflicting object is never overwritten');
    }
    hooks.stage?.('after-current-state-verification');

    // ── Steps 15-18: exact no-overwrite configuration publication via the
    // dedicated permit (never a raw capability; never a conflicting
    // overwrite; EEXIST replay is byte-exact-only). ──
    const permit = createConfigurationRecoveryMetadataPermit({
      capability,
      operation: 'recover-configuration-namespace',
      configurationIdentity: facts.configurationIdentity,
      configurationVersion: facts.configurationVersion,
      configurationDigest: built.metadata.recordByteDigest,
      trustedInputIdentity,
      destinationDesignation: 'metadata/metadata.json',
    });
    if (permit === undefined) {
      return failClosed('ERR-STO-REQ-INVALID', 'configuration-recovery metadata permit could not be issued');
    }
    try {
      hooks.stage?.('before-configuration-publication');
      const persisted = persistRecoveryConfigurationMetadata({
        permit,
        path: metadataPath,
        canonicalUtf8: expectedCanonicalUtf8,
        configurationDigest: built.metadata.recordByteDigest,
        serviceUid,
        metadataDirPath,
        namespaceDirPath: configRoot,
        hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory, write: undefined },
      });
      if (!persisted.ok) {
        // EEXIST replay classified exact bytes as 'verified' (idempotent
        // continuation); any other failure means a conflict appeared or
        // durability failed — fail closed, never overwrite.
        return failClosed(persisted.code ?? 'ERR-STO-DURABILITY', persisted.message ?? 'configuration publication failed; a conflicting object is never overwritten');
      }
      hooks.stage?.('after-configuration-publication');
      hooks.stage?.('before-configuration-durability-confirmation');
      // ── Step 19: configuration durability confirmation — re-read and
      // fully verify the published object exactly as the normal consumer
      // path does. ──
      const expectedWithoutAction: Omit<StoreMetadataExpectation, 'actionIdentity'> = {
        metadataFormatVersion: expectation.metadataFormatVersion,
        layoutVersion: expectation.layoutVersion,
        namespaceKind: expectation.namespaceKind,
        namespaceIdentity: expectation.namespaceIdentity,
        parentIdentity: expectation.parentIdentity,
        lane: expectation.lane,
        configurationIdentity: expectation.configurationIdentity,
        limitProfileIdentity: expectation.limitProfileIdentity,
      };
      const reRead = verifyStoreMetadataAtPath({
        path: metadataPath,
        expected: expectedWithoutAction,
        serviceUid,
      });
      if (!reRead.ok || reRead.metadata === undefined) {
        return failClosed(reRead.code ?? 'ERR-STO-DURABILITY', reRead.message ?? 'published configuration could not be re-verified');
      }
      if (reRead.metadata.canonicalUtf8 !== expectedCanonicalUtf8 || reRead.metadata.recordByteDigest !== built.metadata.recordByteDigest) {
        return failClosed('ERR-STO-INTEGRITY', 'published configuration bytes do not match the expected canonical configuration');
      }
      hooks.stage?.('after-configuration-durability');

      // ── Steps 20-22: durable recovery evidence + its authorized-write
      // audit through the existing exact recovery-evidence permit pipeline. ──
      const createdAt = isoFromEpochMs(request.timeSource.now());
      const evidenceBuilt = buildConfigurationRecoveryEvidenceRecord({
        storeInstance,
        actionIdentity: inputResult.request.actionIdentity,
        evidenceKind: 'recovery-evidence',
        recoveryOperation: 'recover-configuration-namespace',
        configurationIdentity: facts.configurationIdentity,
        configurationVersion: facts.configurationVersion,
        metadataFormatVersion: METADATA_FORMAT_VERSION,
        configurationDigest: built.metadata.recordByteDigest,
        trustedInputIdentity,
        preRecoveryState: preState,
        observationId: action.expectedConfigurationObservationId,
        generation,
        surfaceGeneration,
        outcome: 'configuration-recovered',
        createdAt,
      });
      if (!evidenceBuilt.ok || evidenceBuilt.record === undefined) {
        return failClosed(evidenceBuilt.code ?? 'ERR-STO-INTERNAL-INVARIANT', evidenceBuilt.message ?? 'configuration-recovery evidence could not be constructed');
      }
      hooks.stage?.('before-evidence-publication');
      const evidencePublished = publishRecoveryEvidence({
        capability,
        storeInstance,
        namespaceRoot,
        serviceUid,
        byteLimit: recordBytes,
        record: evidenceBuilt.record,
        operation: 'recover-configuration-namespace',
        hooks: { fsyncFile: hooks.fsyncFile, fsyncDirectory: hooks.fsyncDirectory },
      });
      if (!evidencePublished.ok) {
        return failClosed(evidencePublished.code ?? 'ERR-STO-DURABILITY', evidencePublished.message ?? 'configuration-recovery evidence is not durable');
      }
      hooks.stage?.('after-evidence-publication');
      hooks.stage?.('after-evidence-audit-publication');

      // ── Step 23: verify every required durability point (configuration,
      // evidence, evidence audit). ──
      const evidenceDurable = verifyRecoveryEvidenceDurability({
        namespaceRoot,
        serviceUid,
        byteLimit: recordBytes,
        record: evidenceBuilt.record,
      });
      if (!evidenceDurable.ok) {
        return failClosed(evidenceDurable.code ?? 'ERR-STO-DURABILITY', evidenceDurable.message ?? 'configuration-recovery evidence durability point is not verified');
      }
      const configStillExact = verifyStoreMetadataAtPath({ path: metadataPath, expected: expectedWithoutAction, serviceUid });
      if (!configStillExact.ok || configStillExact.metadata === undefined) {
        return failClosed(configStillExact.code ?? 'ERR-STO-DURABILITY', configStillExact.message ?? 'published configuration is no longer verifiable');
      }
      const beforeSuccess = capability.assertExpected({
        storeInstance,
        configurationIdentity: storeInstance.configurationIdentity,
        serviceUid,
        limitProfile: profile,
      });
      if (!beforeSuccess.ok) {
        return failClosed('ERR-STO-DURABILITY', 'capability invalidated before acknowledgement; configuration and evidence are durable');
      }
      const rootRevalidated = revalidateParentIdentity(storeInstance.parentIdentity, serviceUid);
      if (!rootRevalidated.ok) {
        return failClosed(rootRevalidated.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', rootRevalidated.message ?? 'trusted parent identity changed');
      }
      const released = release();
      if (!released.ok) return released;
      return { ok: true, outcome: 'configuration-recovered', evidenceId: evidenceBuilt.record.recordId };
    } finally {
      permit.dispose();
    }
  } finally {
    capability?.dispose();
  }
}
