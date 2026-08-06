/**
 * WP-8-D authorized-write composition boundary (contract 10, WPR-001…023,
 * LOK, CAP-008/009; ADR-029 D-2/D-5/D-7/D-8/D-12). Filesystem-free: all
 * filesystem work is delegated to the exact fs-bearing modules
 * (`publication/publish-record.ts`, `locks/lock.ts`, `read/read-record.ts`,
 * `initialization/provision.ts`).
 *
 * Sole production consumer of the write-capability, trusted-write-request,
 * and provisioning-capability creators (static-guard enforced). Zero
 * production write-action-provenance producers exist, so production
 * publication is UNREACHABLE: the write capability can only be created from
 * a genuine branded `TrustedWriteRequest`, which requires genuine branded
 * write-action provenance (D-2).
 *
 * Publication order (contract 10.1): validate request/class/identity/
 * canonical bytes/limits → verify genuine trusted action and capability →
 * revalidate store roots, metadata, capability → phase-3 top-level
 * provisioning (initialization-family `provision-phase3`, before lock
 * acquisition) → writer-lock acquisition → class/shard directories under
 * the genuine live write capability → hard-link no-replace publication →
 * final-directory fsync → exact-own-temp unlink → tmp-directory fsync →
 * mechanical `authorized-write` audit event at the operation durability
 * point → revalidation before success → identity-bound lock release.
 *
 * CAP-009 boundaries: before the first trusted-state mutation; immediately
 * before primary publication; before required audit publication; before
 * reporting successful completion. Invalidation before any trusted-state
 * mutation → ERR-STO-REQ-INVALID; after durable publication → the
 * durability class with verify-before-retry; never rollback, never ordinary
 * success.
 */
import { createProvisioningCapability, createWriteCapability } from '../capabilities/authenticity.js';
import { createTrustedWriteRequest } from '../trusted-input/bootstrap-input.js';
import { isGenuineTrustedStorageBootstrapInput } from '../trusted-input/bootstrap-input.js';
import { provisionPhase3TopLevel, namespaceRootPath } from '../initialization/provision.js';
import { acquireWriterLock, releaseWriterLock } from '../locks/lock.js';
import { ensureClassShardDirectories, inspectTempObject, publicationTempName, publishImmutableRecord, verifyObjectBytesAt } from './publish-record.js';
import { buildAuthorizedWriteAuditEvent } from '../audit/write-audit.js';
import { verifyStoreInstance } from '../read/read-record.js';
import { revalidateParentIdentity } from '../root/resolve.js';
import { canonicalEnvelopeBytes, computePayloadDigest, isValidDigestSyntax, validateRecordEnvelope } from '../format/envelope.js';
import { recordClassProfile } from '../format/taxonomy.js';
import { parseTypedIdentifier } from '../format/identifier.js';
import { deriveRecordRelativePath } from '../layout/layout.js';
import type { WriteCapability } from '../capabilities/authenticity.js';
import type { ErrorStateSummary, PublishRecordRequest, PublishRecordResult, StorageFinding, VerifiedStoreInstance } from '../types.js';

const NO_STATE: ErrorStateSummary = {
  retryable: false,
  recoveryRequired: false,
  primaryStateChanged: 'no',
  durabilityPointReached: 'no',
  auditChanged: 'no',
  verifyBeforeRetry: false,
};

/** 10.5 audit-row tuple: primary durable, audit possibly absent or partial. */
const AUDIT_ROW_STATE: ErrorStateSummary = {
  retryable: true,
  recoveryRequired: true,
  primaryStateChanged: 'yes',
  durabilityPointReached: 'yes',
  auditChanged: 'unknown',
  verifyBeforeRetry: true,
};

/** WPR-017 durability-unknown tuple: no complete state provable. */
const UNKNOWN_STATE: ErrorStateSummary = {
  retryable: true,
  recoveryRequired: true,
  primaryStateChanged: 'unknown',
  durabilityPointReached: 'unknown',
  auditChanged: 'unknown',
  verifyBeforeRetry: true,
};

function finding(code: string, message: string, phase: StorageFinding['phase'] = 'request-validation', state: ErrorStateSummary = NO_STATE): StorageFinding {
  return { code, message, phase, state };
}

function failResult(findings: readonly StorageFinding[]): PublishRecordResult {
  return { ok: false, findings: [...findings] };
}

/** Validate the primary record request (WPR-001/002, RFM; stage 1). */
function validatePrimaryRecord(input: {
  readonly recordClass: string;
  readonly record: Readonly<Record<string, unknown>>;
  readonly actionIdentity: string;
  readonly limitProfile: Readonly<Record<string, number>>;
}): { readonly ok: boolean; readonly canonicalUtf8?: string; readonly digest?: string; readonly recordId?: string; readonly revision?: number; readonly createdAt?: string; readonly code?: string; readonly message?: string } {
  const profile = recordClassProfile(input.recordClass as never);
  if (profile === undefined) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record class is not accepted' };
  }
  if (profile.id === 'authoritative-audit-event' || profile.id === 'store-metadata') {
    // Primary publication is for lifecycle/snapshot classes only; the
    // write-audit event is produced mechanically (D-6), and StoreMetadata is
    // bootstrap state never republished as an ordinary record.
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record class is not publishable as a primary record' };
  }
  const envelope = validateRecordEnvelope(input.record);
  if (!envelope.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record envelope is not valid' };
  }
  if (input.record['recordKind'] !== profile.label) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record kind does not match the requested class' };
  }
  const recordId = input.record['recordId'];
  if (typeof recordId !== 'string' || !parseTypedIdentifier(recordId).ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record identity is not a canonical typed identifier' };
  }
  const revision = input.record['revision'];
  const createdAt = input.record['createdAt'];
  if (typeof revision !== 'number' || typeof createdAt !== 'string') {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record revision or creation time is malformed' };
  }
  // WPR-014: every authorized write carries the trusted action identity of
  // the genuine capability; a different or absent identity is rejected.
  if (input.record['trustedActionId'] !== input.actionIdentity) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record trusted action identity does not match the authorized action' };
  }
  const payload = input.record['payload'];
  const declared = input.record['payloadDigest'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || typeof declared !== 'string') {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record payload or payload digest is malformed' };
  }
  if (!isValidDigestSyntax(declared) || computePayloadDigest(payload as Readonly<Record<string, unknown>>) !== declared) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record payload digest does not match the payload' };
  }
  // Limits (LMT): recordBytes, payloadBytes, referencesPerRecord.
  const bytes = canonicalEnvelopeBytes(input.record);
  const recordBytesLimit = input.limitProfile['recordBytes'] ?? 1024 * 1024;
  if (bytes.byteLength > recordBytesLimit) {
    return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'record exceeds the recordBytes limit' };
  }
  const payloadBytesLimit = input.limitProfile['payloadBytes'] ?? 512 * 1024;
  const payloadLength = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (payloadLength > payloadBytesLimit) {
    return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'record payload exceeds the payloadBytes limit' };
  }
  const refs = input.record['referenceDigests'];
  const refsLimit = input.limitProfile['referencesPerRecord'] ?? 64;
  if (refs !== undefined && (!Array.isArray(refs) || refs.length > refsLimit)) {
    return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'record references exceed the referencesPerRecord limit' };
  }
  return { ok: true, canonicalUtf8: bytes.canonicalUtf8, digest: bytes.digest, recordId, revision, createdAt };
}

/** Deadline/cancellation check at a stage boundary (LMT-008, ERM-008/009). */
function deadlineCheck(input: {
  readonly timeSource: { readonly now: () => number; readonly cancelled?: () => boolean };
  readonly startedAt: number;
  readonly operationTimeoutMs: number;
  readonly afterDurability: boolean;
}): { readonly ok: boolean; readonly code?: string; readonly message?: string; readonly state?: ErrorStateSummary } {
  if (input.timeSource.cancelled?.() === true) {
    return input.afterDurability
      ? { ok: false, code: 'ERR-STO-DURABILITY', message: 'operation cancelled after durable publication; verify state before retry', state: UNKNOWN_STATE }
      : { ok: false, code: 'ERR-STO-CANCELLED', message: 'operation cancelled before the durability point' };
  }
  if (input.timeSource.now() - input.startedAt > input.operationTimeoutMs) {
    return input.afterDurability
      ? { ok: false, code: 'ERR-STO-DURABILITY', message: 'operation timed out after durable publication; verify state before retry', state: UNKNOWN_STATE }
      : { ok: false, code: 'ERR-STO-TIMEOUT', message: 'operation timed out before the durability point' };
  }
  return { ok: true };
}

function storeRootOf(storeInstance: VerifiedStoreInstance): string {
  return namespaceRootPath(storeInstance.parentIdentity.canonicalPath, 'store-records');
}

/** Revalidate capability + store instance at a CAP-009 boundary. */
function revalidateBoundary(input: {
  readonly capability: WriteCapability;
  readonly storeInstance: VerifiedStoreInstance;
  readonly operation: 'record-publish';
}): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  const check = input.capability.verify(input.operation);
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'write capability is not usable at a mutation boundary' };
  }
  const expected = input.capability.assertExpected({
    storeInstance: input.storeInstance,
    configurationIdentity: input.storeInstance.configurationIdentity,
    serviceUid: input.storeInstance.serviceUid,
    limitProfile: input.storeInstance.limitProfile,
  });
  if (!expected.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'write capability binding mismatch at a mutation boundary' };
  }
  return { ok: true };
}

/**
 * Verify the caller-tuple-specific audit target for retry classification
 * (MINOR-2 protocol step 3; D-8/N-2). The audit event identity is
 * deterministic for the caller's tuple; the existing audit object is
 * verified byte-exact against the expected canonical event.
 */
function verifyAuditTargetForCaller(input: {
  readonly storeInstance: VerifiedStoreInstance;
  readonly recordClass: string;
  readonly recordId: string;
  readonly revision: number;
  readonly digest: string;
  readonly createdAt: string;
  readonly actionIdentity: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
}): { readonly ok: boolean; readonly exact?: boolean; readonly code?: string; readonly message?: string } {
  const audit = buildAuthorizedWriteAuditEvent({
    storeInstance: input.storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
    primaryClass: input.recordClass,
    primaryRecordId: input.recordId,
    primaryRevision: input.revision,
    primaryDigest: input.digest,
    eventKind: 'authorized-write',
    trustedActionIdentity: input.actionIdentity,
    primaryCreatedAt: input.createdAt,
  });
  if (!audit.ok || audit.event === undefined) {
    return { ok: false, code: 'ERR-STO-INTERNAL-INVARIANT', message: 'audit event could not be constructed' };
  }
  const derived = deriveRecordRelativePath('authoritative-audit-event' as never, audit.event.recordId);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'audit path derivation failed' };
  }
  const auditPath = `${storeRootOf(input.storeInstance)}/${derived.relativePath}`;
  const existing = verifyObjectBytesAt({ path: auditPath, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
  if (!existing.ok) {
    return { ok: false, code: existing.code, message: existing.message };
  }
  return { ok: true, exact: existing.canonicalUtf8 === audit.event.canonicalUtf8 && existing.digest === audit.event.digest };
}

/**
 * Publish one immutable record with its mandatory write-audit event
 * (WPR-010, AUD-003). Production publication is unreachable (D-2).
 */
export function publishRecord(request: PublishRecordRequest): PublishRecordResult {
  const timeSource = request.timeSource;
  const startedAt = timeSource.now();
  const operationTimeoutMs = request.limitProfile['operationTimeout'] ?? 30000;
  const lockWaitMs = request.limitProfile['lockWait'] ?? 5000;
  const byteLimit = request.limitProfile['recordBytes'] ?? 1024 * 1024;
  let writeCapability: WriteCapability | undefined;
  let provisioningCapability: ReturnType<typeof createProvisioningCapability> | undefined;
  try {
    // Stage 1-2: validate request, class, identity, canonical bytes, limits,
    // and verify the genuine trusted action (WPR-001/002/014).
    const inputResult = createTrustedWriteRequest(
      request.trustedConfiguration,
      request.writeActionProvenance,
      { locator: request.locator, serviceUid: request.serviceUid, forbiddenRoots: request.forbiddenRoots, limitProfile: request.limitProfile },
    );
    if (!inputResult.ok || inputResult.request === undefined) {
      const code = inputResult.reason === 'not-genuine-configuration' || inputResult.reason === 'not-genuine-action-provenance' || inputResult.reason === 'configuration-identity-mismatch'
        ? 'ERR-STO-CONFIG-UNAVAILABLE'
        : 'ERR-STO-REQ-INVALID';
      return failResult([finding(code, inputResult.message ?? 'trusted write request could not be established')]);
    }
    const writeRequest = inputResult.request;
    const configuration = request.trustedConfiguration as { readonly configurationVersion: string; readonly identity: string };
    const recordValidation = validatePrimaryRecord({
      recordClass: request.recordClass,
      record: request.record,
      actionIdentity: writeRequest.actionIdentity,
      limitProfile: request.limitProfile,
    });
    if (!recordValidation.ok) {
      return failResult([finding(recordValidation.code ?? 'ERR-STO-REQ-INVALID', recordValidation.message ?? 'record validation failed')]);
    }
    const canonicalUtf8 = recordValidation.canonicalUtf8!;
    const recordDigest = recordValidation.digest!;
    const recordId = recordValidation.recordId!;
    const revision = recordValidation.revision!;
    const createdAt = recordValidation.createdAt!;

    // Stage 3: revalidate store roots, metadata and establish the verified
    // store instance (D-5; SRX-013). This is CAP-009 boundary 1 (before the
    // first trusted-state mutation).
    const store = verifyStoreInstance({
      locator: request.locator,
      serviceUid: request.serviceUid,
      forbiddenRoots: request.forbiddenRoots,
      configurationIdentity: configuration.identity,
      configurationVersion: configuration.configurationVersion,
      limitProfile: request.limitProfile,
    });
    if (!store.ok || store.storeInstance === undefined) {
      return failResult([finding(store.code ?? 'ERR-STO-INTEGRITY', store.message ?? 'store revalidation failed')]);
    }
    const storeInstance = store.storeInstance;

    // Stage 3b: create and validate the genuine write capability (D-5).
    writeCapability = createWriteCapability({ trustedWriteRequest: writeRequest, storeInstance });
    if (writeCapability === undefined) {
      return failResult([finding('ERR-STO-REQ-INVALID', 'write capability could not be issued')]);
    }
    const bound = revalidateBoundary({ capability: writeCapability, storeInstance, operation: 'record-publish' });
    if (!bound.ok) {
      return failResult([finding(bound.code ?? 'ERR-STO-REQ-INVALID', bound.message ?? 'write capability binding mismatch')]);
    }

    // Stage 4: phase-3 top-level provisioning before lock acquisition
    // (initialization-family `provision-phase3`; M-1). Requires the genuine
    // branded bootstrap input; zero production issuance (D-2).
    if (!isGenuineTrustedStorageBootstrapInput(request.bootstrapInput)) {
      return failResult([finding('ERR-STO-REQ-INVALID', 'bootstrap trusted input is not genuine')]);
    }
    provisioningCapability = createProvisioningCapability({ trustedInput: request.bootstrapInput, storeInstance });
    if (provisioningCapability === undefined) {
      return failResult([finding('ERR-STO-REQ-INVALID', 'provisioning capability could not be issued')]);
    }
    const provisionCheck = provisioningCapability.verify('provision-phase3');
    if (!provisionCheck.ok) {
      return failResult([finding('ERR-STO-REQ-INVALID', 'provisioning capability is not usable')]);
    }
    const provisioned = provisionPhase3TopLevel(provisioningCapability, storeInstance.parentIdentity, request.serviceUid);
    if (!provisioned.ok) {
      return failResult([finding(provisioned.code ?? 'ERR-STO-IO-FAILURE', provisioned.message ?? 'phase-3 top-level provisioning failed')]);
    }
    provisioningCapability.dispose();
    provisioningCapability = undefined;

    // Stage 5: acquire the writer lock (LOK-005/006/011; D-3).
    const deadline = deadlineCheck({ timeSource, startedAt, operationTimeoutMs, afterDurability: false });
    if (!deadline.ok) {
      return failResult([finding(deadline.code ?? 'ERR-STO-TIMEOUT', deadline.message ?? 'operation deadline exceeded', 'lock-acquisition')]);
    }
    const storeRoot = storeRootOf(storeInstance);
    const locksDir = `${storeRoot}/locks`;
    const lockPath = `${locksDir}/writer.lock`;
    const acquired = acquireWriterLock({
      capability: writeCapability,
      lockPath,
      locksDirPath: locksDir,
      storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      actionIdentity: writeRequest.actionIdentity,
      lockWaitMs,
      timeSource,
      hooks: request.hooks,
    });
    if (!acquired.ok || acquired.record === undefined) {
      return failResult([finding(acquired.code ?? 'ERR-STO-LOCK-UNAVAILABLE', acquired.message ?? 'writer lock could not be acquired', 'lock-acquisition')]);
    }
    const lockRecord = acquired.record;
    const release = (afterDurability: boolean): PublishRecordResult => {
      const released = releaseWriterLock({
        capability: writeCapability!,
        lockPath,
        locksDirPath: locksDir,
        expected: { nonce: lockRecord.nonce, storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })) },
        timeSource,
        hooks: request.hooks,
      });
      if (!released.ok) {
        // D-10: post-durability cleanup failure maps to the closed
        // cleanup-failure code; the lock remains for phase-4 recovery.
        const state = afterDurability ? UNKNOWN_STATE : NO_STATE;
        return failResult([finding('ERR-STO-PUBLISH-FAILED', 'lock release failed; the lock remains for recovery', 'acknowledgement', state)]);
      }
      return { ok: true };
    };

    // Stage 6: class/shard directories under the genuine live write
    // capability, after lock acquisition (M-1).
    const shardReady = ensureClassShardDirectories({ capability: writeCapability, namespaceRoot: storeRoot, recordClass: request.recordClass, rawIdentifier: recordId, serviceUid: request.serviceUid });
    if (!shardReady.ok) {
      const released = release(false);
      return { ...released, ok: false, findings: [finding(shardReady.code ?? 'ERR-STO-IO-FAILURE', shardReady.message ?? 'class/shard provisioning failed')] };
    }
    const primaryDerived = deriveRecordRelativePath(request.recordClass, recordId);
    if (!primaryDerived.ok) {
      const released = release(false);
      return { ...released, ok: false, findings: [finding('ERR-STO-CONTAINMENT-DENIED', 'primary record path derivation failed')] };
    }
    const primaryDir = primaryDerived.relativePath.slice(0, primaryDerived.relativePath.lastIndexOf('/'));
    const finalPath = `${storeRoot}/${primaryDerived.relativePath}`;
    const finalDirPath = `${storeRoot}/${primaryDir}`;
    const tmpDirPath = `${storeRoot}/tmp`;
    const primaryTempName = publicationTempName(writeRequest.actionIdentity, 0);
    const primaryTmpPath = `${tmpDirPath}/${primaryTempName}`;

    // Stage 7-15: exclusive temp creation, bounded write-all, fsync,
    // hard-link publication, final verification, directory fsyncs.
    const published = publishImmutableRecord({
      capability: writeCapability,
      canonicalUtf8,
      byteLimit,
      tmpPath: primaryTmpPath,
      tmpDirPath,
      finalPath,
      finalDirPath,
      serviceUid: request.serviceUid,
      expectedRecordId: recordId,
      expectedRevision: revision,
      expectedDigest: recordDigest,
      hooks: request.hooks,
    });
    if (!published.ok) {
      if (published.outcome === 'temp-exists') {
        // Same-action temp EEXIST retry (MINOR-2): never adopt/reopen/unlink;
        // inspect only bounded no-follow descriptor facts.
        const inspected = inspectTempObject({ tmpPath: primaryTmpPath, serviceUid: request.serviceUid });
        if (!inspected.ok) {
          const released = release(false);
          return { ...released, ok: false, findings: [finding(inspected.code ?? 'ERR-STO-FTYPE-UNSUPPORTED', inspected.message ?? 'temporary object is not a store-owned regular file')] };
        }
        // Verify the final primary target and the caller-tuple audit target.
        const primaryExisting = verifyObjectBytesAt({ path: finalPath, serviceUid: request.serviceUid, byteLimit });
        if (!primaryExisting.ok) {
          // Neither complete state provable (absent, partial, or unverifiable):
          // durability-unknown class (WPR-017, ERM-006); no new code.
          const released = release(true);
          return { ...released, ok: false, outcome: 'failed', findings: [finding('ERR-STO-DURABILITY', 'primary target state could not be positively established', 'pre-publication', UNKNOWN_STATE)] };
        }
        const primaryExact = primaryExisting.canonicalUtf8 === canonicalUtf8 && primaryExisting.digest === recordDigest;
        if (!primaryExact) {
          const released = release(true);
          return { ...released, ok: false, findings: [finding('ERR-STO-DURABILITY', 'primary target does not match the requested record; durability unknown', 'pre-publication', UNKNOWN_STATE)] };
        }
        const auditTarget = verifyAuditTargetForCaller({
          storeInstance,
          recordClass: request.recordClass,
          recordId,
          revision,
          digest: recordDigest,
          createdAt,
          actionIdentity: writeRequest.actionIdentity,
          serviceUid: request.serviceUid,
          byteLimit,
        });
        if (!auditTarget.ok) {
          const released = release(true);
          return { ...released, ok: false, findings: [finding('ERR-STO-DURABILITY', auditTarget.message ?? 'audit target could not be verified', 'post-primary-publication', AUDIT_ROW_STATE)] };
        }
        if (!auditTarget.exact) {
          const released = release(true);
          return { ...released, ok: false, findings: [finding('ERR-STO-DURABILITY', 'primary durable but the required audit event is incomplete', 'post-primary-publication', AUDIT_ROW_STATE)] };
        }
        // Primary and audit fully durable and exact: contract-permitted
        // idempotent result (WPR-012/019); the leftover temp is phase-4.
        const released = release(true);
        if (!released.ok) return released;
        return { ok: true, outcome: 'idempotent-duplicate', recordId, recordDigest, auditEventId: undefined };
      }
      // Hard-link failure or existing-target classification.
      if (published.outcome === 'idempotent-duplicate') {
        // WPR-019: verify the caller-tuple audit target before declaring
        // idempotent success; a missing audit is the 10.5 audit-row outcome.
        const auditTarget = verifyAuditTargetForCaller({
          storeInstance,
          recordClass: request.recordClass,
          recordId,
          revision,
          digest: recordDigest,
          createdAt,
          actionIdentity: writeRequest.actionIdentity,
          serviceUid: request.serviceUid,
          byteLimit,
        });
        if (!auditTarget.ok || !auditTarget.exact) {
          const released = release(true);
          return { ...released, ok: false, findings: [finding('ERR-STO-DURABILITY', auditTarget.message ?? 'primary durable but the required audit event is incomplete', 'post-primary-publication', AUDIT_ROW_STATE)] };
        }
        const released = release(true);
        if (!released.ok) return released;
        return { ok: true, outcome: 'idempotent-duplicate', recordId, recordDigest };
      }
      const released = release(false);
      const state = published.outcome === 'duplicate' || published.outcome === 'conflict-revision' ? NO_STATE : UNKNOWN_STATE;
      return {
        ...released,
        ok: false,
        outcome: published.outcome === 'duplicate' || published.outcome === 'conflict-revision' ? published.outcome : 'failed',
        findings: [finding(published.code ?? 'ERR-STO-PUBLISH-FAILED', published.message ?? 'publication failed', published.outcome === 'duplicate' || published.outcome === 'conflict-revision' ? 'post-primary-publication' : 'pre-publication', state)],
      };
    }
    const primaryOutcome = published.outcome;

    // Stage 18: construct and publish the mandatory write-audit event at the
    // operation durability point (WPR-010, AUD-003; D-8).
    const deadlineAudit = deadlineCheck({ timeSource, startedAt, operationTimeoutMs, afterDurability: true });
    if (!deadlineAudit.ok) {
      const released = release(true);
      return { ...released, ok: false, findings: [finding(deadlineAudit.code ?? 'ERR-STO-DURABILITY', deadlineAudit.message ?? 'operation deadline exceeded after primary publication', 'post-primary-publication', UNKNOWN_STATE)] };
    }
    const audit = buildAuthorizedWriteAuditEvent({
      storeInstance: storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      primaryClass: request.recordClass,
      primaryRecordId: recordId,
      primaryRevision: revision,
      primaryDigest: recordDigest,
      eventKind: 'authorized-write',
      trustedActionIdentity: writeRequest.actionIdentity,
      primaryCreatedAt: createdAt,
    });
    if (!audit.ok || audit.event === undefined) {
      const released = release(true);
      return { ...released, ok: false, findings: [finding('ERR-STO-DURABILITY', audit.message ?? 'audit event could not be constructed', 'post-primary-publication', AUDIT_ROW_STATE)] };
    }
    const auditDerived = deriveRecordRelativePath('authoritative-audit-event' as never, audit.event.recordId);
    if (!auditDerived.ok) {
      const released = release(true);
      return { ...released, ok: false, findings: [finding('ERR-STO-DURABILITY', 'audit path derivation failed', 'post-primary-publication', AUDIT_ROW_STATE)] };
    }
    const auditClassDir = `${storeRoot}/audit/${auditDerived.classSegment}`;
    const auditShardDir = `${auditClassDir}/${auditDerived.shard}`;
    const auditShardReady = ensureClassShardDirectories({ capability: writeCapability, namespaceRoot: storeRoot, recordClass: 'authoritative-audit-event' as never, rawIdentifier: audit.event.recordId, serviceUid: request.serviceUid });
    if (!auditShardReady.ok) {
      const released = release(true);
      return { ...released, ok: false, findings: [finding('ERR-STO-DURABILITY', 'audit class/shard directories could not be established', 'post-primary-publication', AUDIT_ROW_STATE)] };
    }
    const auditFinalPath = `${storeRoot}/${auditDerived.relativePath}`;
    const auditTempPath = `${tmpDirPath}/${publicationTempName(writeRequest.actionIdentity, 1)}`;
    const auditPublished = publishImmutableRecord({
      capability: writeCapability,
      canonicalUtf8: audit.event.canonicalUtf8,
      byteLimit,
      tmpPath: auditTempPath,
      tmpDirPath,
      finalPath: auditFinalPath,
      finalDirPath: auditShardDir,
      serviceUid: request.serviceUid,
      expectedRecordId: audit.event.recordId,
      expectedRevision: 1,
      expectedDigest: audit.event.digest,
      // Audit durability: audit file fsync + shard dir + class dir + audit
      // top dir (10.1 step 9; AUD-003).
      syncDirectories: [auditClassDir, `${storeRoot}/audit`],
      hooks: request.hooks,
    });
    if (!auditPublished.ok) {
      let state = AUDIT_ROW_STATE;
      if (auditPublished.outcome === 'temp-exists') {
        // Same-action audit-temp EEXIST: verify the audit final target only;
        // never adopt or unlink the temp.
        const existing = verifyObjectBytesAt({ path: auditFinalPath, serviceUid: request.serviceUid, byteLimit });
        if (existing.ok && existing.canonicalUtf8 === audit.event.canonicalUtf8 && existing.digest === audit.event.digest) {
          // Audit durable: the operation durability point is complete.
          state = { ...AUDIT_ROW_STATE, auditChanged: 'yes', durabilityPointReached: 'yes' };
          const released = release(true);
          if (!released.ok) return released;
          return { ok: true, outcome: primaryOutcome === 'published' ? 'published' : 'idempotent-duplicate', recordId, recordDigest, auditEventId: audit.event.recordId };
        }
      } else if (auditPublished.outcome === 'idempotent-duplicate') {
        // Deterministic audit identity: identical bytes at the audit target
        // mean the event is already durably published.
        const existing = verifyObjectBytesAt({ path: auditFinalPath, serviceUid: request.serviceUid, byteLimit });
        if (existing.ok && existing.canonicalUtf8 === audit.event.canonicalUtf8 && existing.digest === audit.event.digest) {
          const released = release(true);
          if (!released.ok) return released;
          return { ok: true, outcome: primaryOutcome === 'published' ? 'published' : 'idempotent-duplicate', recordId, recordDigest, auditEventId: audit.event.recordId };
        }
      }
      const released = release(true);
      return { ...released, ok: false, findings: [finding('ERR-STO-DURABILITY', auditPublished.message ?? 'audit event durability point not reached', 'post-primary-publication', state)] };
    }

    // Stage 20: revalidate capability and roots before success (CAP-009
    // boundary 4; SRX-013).
    const beforeSuccess = revalidateBoundary({ capability: writeCapability, storeInstance, operation: 'record-publish' });
    if (!beforeSuccess.ok) {
      const released = release(true);
      return { ...released, ok: false, findings: [finding('ERR-STO-DURABILITY', 'capability invalidated before acknowledgement; state is durable and authoritative', 'acknowledgement', { ...UNKNOWN_STATE, primaryStateChanged: 'yes', auditChanged: 'yes' })] };
    }
    const rootRevalidated = revalidateParentIdentity(storeInstance.parentIdentity, request.serviceUid);
    if (!rootRevalidated.ok) {
      const released = release(true);
      return { ...released, ok: false, findings: [finding(rootRevalidated.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', rootRevalidated.message ?? 'trusted parent identity changed', 'acknowledgement', { ...UNKNOWN_STATE, primaryStateChanged: 'yes', auditChanged: 'yes' })] };
    }

    // Stage 21: identity-bound lock release (LOK-013).
    const released = release(true);
    if (!released.ok) return released;

    // Stage 22: success only after the full durability point (WPR-008/021).
    return { ok: true, outcome: primaryOutcome === 'published' ? 'published' : 'idempotent-duplicate', recordId, recordDigest, auditEventId: audit.event.recordId };
  } finally {
    provisioningCapability?.dispose();
    writeCapability?.dispose();
  }
}
