/**
 * WP-8-J lock-recovery tests (contract 12.3.1, LOK-019…022; ADR-033):
 * external adjudication only (no liveness inference), exact lock-instance
 * binding, the recovery-break guard serialization, the digest-bound exact
 * removal, the new-writer race closure, deterministic evidence and
 * idempotency states, scanner/plan integration, post-break writer
 * behavior, and the fixed 12-stage crash inventory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, utimesSync, renameSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createRecoveryActionProvenance, createTrustedStorageBootstrapInput, createTrustedWriteRequest, createTrustedRecoveryRequest } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../../src/storage/publication/index.js';
import { runRecoveryScan, executeRecoveryMutation, lockObservationId, computeLockRecoveryEvidenceIdentity } from '../../../src/storage/recovery/index.js';
import { verifyStoreInstance } from '../../../src/storage/read/read-record.js';
import { createWriteCapability, createRecoveryCapability } from '../../../src/storage/capabilities/authenticity.js';
import { acquireWriterLock, releaseWriterLock, canonicalLockRecordBytes, computeWriterLockInstanceIdentity, acquireRecoveryBreakGuard, RECOVERY_BREAK_GUARD_NAME } from '../../../src/storage/locks/lock.js';
import { computePayloadDigest, canonicalEnvelopeBytes, computeDomainDigest, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../../../src/storage/format/envelope.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../../src/storage/limits/limits.js';
import { deriveRecordRelativePath } from '../../../src/storage/layout/layout.js';
import type { RecoveryMutationRequest, RecoveryMutationStage } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const WRITE_ACTION = 'wp8j-writer';
const RECOVERY_ACTION = 'wp8j-recovery';

function profile(overrides: Partial<Record<string, number>> = {}): SelectedLimitProfile {
  const base: Record<string, number> = { ...defaultLimitProfile() };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) base[k] = v;
  }
  return base;
}

function genuineConfig(): object {
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity: CONFIG_IDENTITY };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

interface TestEnv {
  readonly dir: string;
  readonly config: object;
  readonly trustedInput: unknown;
  readonly limitProfile: SelectedLimitProfile;
  readonly storeRoot: string;
  readonly storeInstance: ReturnType<typeof verifyStoreInstance>['storeInstance'];
}

function makeStore(limitProfile: SelectedLimitProfile = profile()): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wp8j-lk-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: 'wp8j-bootstrap',
    locator: dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile,
  });
  const inputResult = createTrustedStorageBootstrapInput(config, bootstrapProvenance, { locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile });
  assert.equal(inputResult.ok, true);
  const result = initializeTrustedStore({ trustedConfiguration: config, actionProvenance: bootstrapProvenance, locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  const storeResult = verifyStoreInstance({ locator: dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile });
  assert.equal(storeResult.ok, true);
  return { dir, config, trustedInput: inputResult.input, limitProfile, storeRoot: `${dir}/store-v1`, storeInstance: storeResult.storeInstance! };
}

function publish(env: TestEnv, recordId: string, payload: Readonly<Record<string, unknown>> = { approved: true }): void {
  const provenance = createStorageWriteActionProvenance({
    actionIdentity: WRITE_ACTION,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: env.limitProfile,
  });
  const record = {
    recordKind: 'ApprovalRecord',
    formatVersion: '1.0',
    recordId,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    trustedActionId: WRITE_ACTION,
    payload,
    payloadDigest: computePayloadDigest(payload),
  };
  const result = publishRecord({
    trustedConfiguration: env.config,
    bootstrapInput: env.trustedInput,
    writeActionProvenance: provenance,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: env.limitProfile,
    recordClass: 'approval-record',
    record,
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
}

function namespaces(env: TestEnv): readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[] {
  return env.storeInstance!.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }));
}

/** Acquire a genuine writer lock through the accepted write-path primitive and HOLD it. */
function acquireHeldLock(env: TestEnv): { readonly recordDigest: string; readonly instanceId: string; readonly lockPath: string; readonly record: Record<string, unknown> } {
  const provenance = createStorageWriteActionProvenance({
    actionIdentity: WRITE_ACTION,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: env.limitProfile,
  });
  const request = createTrustedWriteRequest(env.config, provenance, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
  assert.equal(request.ok, true);
  const capability = createWriteCapability({ trustedWriteRequest: request.request!, storeInstance: env.storeInstance! });
  assert.ok(capability !== undefined);
  const lockPath = `${env.storeRoot}/locks/writer.lock`;
  try {
    const acquired = acquireWriterLock({
      capability: capability!,
      operation: 'record-publish',
      lockPath,
      locksDirPath: `${env.storeRoot}/locks`,
      storeInstance: namespaces(env),
      actionIdentity: WRITE_ACTION,
      lockWaitMs: 5000,
      timeSource: { now: () => 1000, processStartTime: 500 },
    });
    assert.equal(acquired.ok, true, JSON.stringify(acquired));
    const recordDigest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, canonicalLockRecordBytes(acquired.record!));
    const instanceId = computeWriterLockInstanceIdentity({ storeInstance: namespaces(env), lockRecordDigest: recordDigest });
    return { recordDigest, instanceId, lockPath, record: acquired.record as unknown as Record<string, unknown> };
  } finally {
    capability!.dispose();
  }
}

/** Write a raw lock record at the lock path (fixture; canonical bytes). */
function writeLockRecord(env: TestEnv, record: Record<string, unknown>): { readonly recordDigest: string; readonly instanceId: string } {
  const canonical = canonicalLockRecordBytes(record as unknown as Parameters<typeof canonicalLockRecordBytes>[0]);
  const lockPath = `${env.storeRoot}/locks/writer.lock`;
  writeFileSync(lockPath, canonical, { mode: 0o600 });
  chmodSync(lockPath, 0o600);
  const recordDigest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, canonical);
  const instanceId = computeWriterLockInstanceIdentity({ storeInstance: namespaces(env), lockRecordDigest: recordDigest });
  return { recordDigest, instanceId };
}

/** Recovery-mode generation/surface tokens (the break request bindings). */
function recoveryTokens(env: TestEnv): { readonly generation: string; readonly surfaceGeneration: string } {
  const result = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  return { generation: result.assessment!.source.generation, surfaceGeneration: result.assessment!.source.surfaceGeneration };
}

function breakRequest(env: TestEnv, lockFacts: { readonly recordDigest: string; readonly instanceId: string }, tokens: { readonly generation: string; readonly surfaceGeneration: string }, overrides: Partial<RecoveryMutationRequest['action']> = {}): RecoveryMutationRequest {
  const provenance = createRecoveryActionProvenance({
    actionIdentity: RECOVERY_ACTION,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: env.limitProfile,
  });
  return {
    trustedConfiguration: env.config,
    recoveryActionProvenance: provenance,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: env.limitProfile,
    action: {
      category: 'break-writer-lock',
      expectedLockRecordDigest: lockFacts.recordDigest,
      expectedLockInstanceId: lockFacts.instanceId,
      expectedLockObservationId: lockObservationId(),
      expectedGeneration: tokens.generation,
      expectedSurfaceGeneration: tokens.surfaceGeneration,
      ...overrides,
    } as RecoveryMutationRequest['action'],
    timeSource: { now: () => 1000, processStartTime: 500 },
  };
}

function breakLock(env: TestEnv, lockFacts: { readonly recordDigest: string; readonly instanceId: string }, overrides: Partial<RecoveryMutationRequest['action']> = {}): { readonly ok: boolean; readonly outcome?: string; readonly evidenceId?: string; readonly code?: string; readonly message?: string } {
  const result = executeRecoveryMutation(breakRequest(env, lockFacts, recoveryTokens(env), overrides));
  return { ok: result.ok, outcome: result.outcome, evidenceId: result.evidenceId, code: result.findings?.[0]?.code, message: result.findings?.[0]?.message };
}

function derivedOf(env: TestEnv, recordClass: string, recordId: string): string {
  const derived = deriveRecordRelativePath(recordClass as Parameters<typeof deriveRecordRelativePath>[0], recordId);
  assert.equal(derived.ok, true);
  return (derived as { readonly ok: true; readonly relativePath: string }).relativePath;
}

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Minimal lock record with arbitrary pid/age facts (fixture). */
function lockRecordWith(env: TestEnv, overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    lockVersion: '1',
    storeInstance: namespaces(env).map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
    nonce: 'a'.repeat(32),
    actionIdentityDigest: computeDomainDigest('PGAP-STORAGE-LOCK-ACTION-v1\u0000', WRITE_ACTION),
    pid: 12345,
    processStartTime: 999,
    acquisitionTime: 1000,
    maxAgeMs: 5000,
    ...overrides,
  };
}

// ── Authority and adjudication model ───────────────────────────────────────

test('lock-recovery: exact genuine break authority breaks the adjudicated writer lock with durable evidence', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const held = acquireHeldLock(env);
    assert.equal(exists(held.lockPath), true);
    // The lock observation binds the deterministic name identity.
    const scanBefore = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scanBefore.ok, true);
    const lockFinding = scanBefore.assessment!.persistentLockObservations.find((l) => l.classification === 'writer-lock-present');
    assert.ok(lockFinding !== undefined);
    assert.equal(lockFinding!.observationId, lockObservationId());
    assert.equal(lockFinding!.lockRecordDigest, held.recordDigest);
    // The plan names break-writer-lock with external adjudication wording.
    const planAction = scanBefore.plan!.actions.find((a) => a.requiredOperation === 'break-writer-lock');
    assert.ok(planAction !== undefined, 'the plan must name break-writer-lock');
    assert.match(planAction!.reason ?? '', /externally adjudicated/);
    assert.equal(planAction!.safety, 'unsafe');
    // Break the adjudicated lock.
    const broken = breakLock(env, held);
    assert.equal(broken.ok, true, broken.message ?? '');
    assert.equal(broken.outcome, 'lock-broken');
    assert.ok(broken.evidenceId !== undefined);
    assert.equal(exists(held.lockPath), false, 'the adjudicated lock must be removed');
    // Durable evidence: recovery-evidence kind, break-writer-lock operation,
    // no nonce, no raw path.
    const evidencePath = join(env.storeRoot, derivedOf(env, 'store-evidence-record', broken.evidenceId!));
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as Record<string, unknown>;
    const payload = evidence['payload'] as Record<string, unknown>;
    assert.equal(payload['evidenceKind'], 'recovery-evidence');
    assert.equal(payload['recoveryOperation'], 'break-writer-lock');
    assert.equal(payload['lockRecordDigest'], held.recordDigest);
    assert.equal(payload['lockInstanceId'], held.instanceId);
    assert.equal(payload['outcome'], 'lock-broken');
    assert.equal('nonce' in payload, false);
    assert.equal('path' in payload, false);
    assert.deepEqual(payload['resultingState'], { writerLockRemoved: true });
    // The evidence identity is deterministic.
    const expectedEvidenceId = computeLockRecoveryEvidenceIdentity({
      storeInstance: env.storeInstance!,
      evidenceKind: 'recovery-evidence',
      recoveryOperation: 'break-writer-lock',
      lockRecordDigest: held.recordDigest,
      lockInstanceId: held.instanceId,
      observationId: lockObservationId(),
      outcome: 'lock-broken',
    });
    assert.equal(broken.evidenceId, expectedEvidenceId);
    // No recovery-break guard remains.
    assert.equal(exists(join(env.storeRoot, 'locks', RECOVERY_BREAK_GUARD_NAME)), false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('lock-recovery: no liveness inference — pid, age, and mtime never gate authorization', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    // A lock whose recorded pid/start-time/age are implausible or zero must
    // still break with a matching digest: those fields are recorded facts,
    // never authorization conditions (12.3.1; ADR-033).
    const implausible = writeLockRecord(env, lockRecordWith(env, { pid: 0, processStartTime: 0, acquisitionTime: 0, maxAgeMs: 0 }));
    const broken = breakLock(env, implausible);
    assert.equal(broken.ok, true, `pid/age facts must not gate authorization: ${broken.message ?? ''}`);
    assert.equal(broken.outcome, 'lock-broken');
    // mtime/atime changes never matter: content digest is the binding.
    const second = writeLockRecord(env, lockRecordWith(env, { nonce: 'b'.repeat(32) }));
    const lockPath = `${env.storeRoot}/locks/writer.lock`;
    const past = new Date(946684800000); // year 2000
    utimesSync(lockPath, past, past);
    const brokenMtime = breakLock(env, second);
    assert.equal(brokenMtime.ok, true, 'lock mtime must never gate authorization');
    assert.equal(brokenMtime.outcome, 'lock-broken');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('lock-recovery: wrong operation, reduced authority, forged provenance, wrong store, and plan-derived requests are rejected', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const held = acquireHeldLock(env);
    // Wrong observation identity binding.
    const wrongObs = breakLock(env, held, { expectedLockObservationId: 'obs-0000000000000000' });
    assert.equal(wrongObs.ok, false);
    assert.equal(wrongObs.code, 'ERR-STO-REQ-INVALID');
    // Reduced operation set: an authority whose set excludes
    // break-writer-lock can never reach the guard.
    const provenance = createRecoveryActionProvenance({ actionIdentity: RECOVERY_ACTION, locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile });
    const inputResult = createTrustedRecoveryRequest(env.config, provenance, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
    assert.equal(inputResult.ok, true);
    const reduced = createRecoveryCapability({ trustedRecoveryRequest: inputResult.request!, storeInstance: env.storeInstance!, operationSet: ['orphan-removal', 'quarantine-temporary'] });
    assert.ok(reduced !== undefined);
    assert.equal(reduced!.verify('break-writer-lock').ok, false);
    // A reduced authority can never verify the exact operation (production
    // minting always uses the full vocabulary; the closed subset is a test
    // seam, exercised here at the capability gate).
    reduced!.dispose();
    // Forged/cloned provenance: a structural object never authenticates.
    const forged = executeRecoveryMutation({ ...breakRequest(env, held, recoveryTokens(env)), recoveryActionProvenance: { actionIdentity: RECOVERY_ACTION, locator: env.dir } });
    assert.equal(forged.ok, false);
    assert.equal(forged.findings?.[0]?.code, 'ERR-STO-CONFIG-UNAVAILABLE');
    // Wrong store: a different locator fails store revalidation.
    const wrongStore = executeRecoveryMutation({ ...breakRequest(env, held, recoveryTokens(env)), locator: join(env.dir, 'other') });
    assert.equal(wrongStore.ok, false);
    // A recovery plan action is never an execution operand.
    const planAction = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput }).plan!.actions.find((a) => a.requiredOperation === 'break-writer-lock');
    assert.ok(planAction !== undefined);
    const planDerived = executeRecoveryMutation({ ...breakRequest(env, held, recoveryTokens(env)), action: planAction as unknown as RecoveryMutationRequest['action'] });
    assert.equal(planDerived.ok, false, 'a plan action must never execute');
    // The lock survives every rejection.
    assert.equal(exists(held.lockPath), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Target binding ─────────────────────────────────────────────────────────

test('lock-recovery: target binding is exact — changed digest, replacement, malformed, foreign, and wrong-mode fail closed', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const held = acquireHeldLock(env);
    // Changed digest binding: wrong digest for the same present lock.
    const wrongDigest = breakLock(env, { recordDigest: 'sha-256:' + '9'.repeat(64), instanceId: held.instanceId });
    assert.equal(wrongDigest.ok, false);
    assert.equal(wrongDigest.code, 'ERR-STO-INTEGRITY');
    // Wrong instance identity.
    const wrongInstance = breakLock(env, { recordDigest: held.recordDigest, instanceId: 'pgw:r:' + 'f'.repeat(32) });
    assert.equal(wrongInstance.ok, false);
    // Replacement lock: a different lock record at the same name.
    const replacement = writeLockRecord(env, lockRecordWith(env, { nonce: 'c'.repeat(32) }));
    const staleRequest = breakLock(env, held);
    assert.equal(staleRequest.ok, false, 'a changed lock instance must fail closed');
    assert.equal(staleRequest.code, 'ERR-STO-INTEGRITY');
    assert.equal(exists(held.lockPath), true, 'the replacement lock must remain untouched');
    // The replacement itself breaks under its own adjudication.
    const ok = breakLock(env, replacement);
    assert.equal(ok.ok, true);
    // Malformed lock: non-canonical bytes.
    writeFileSync(held.lockPath, '{not canonical', { mode: 0o600 });
    chmodSync(held.lockPath, 0o600);
    const malformedFacts = { recordDigest: 'sha-256:' + '1'.repeat(64), instanceId: 'pgw:r:' + '2'.repeat(32) };
    const malformed = breakLock(env, malformedFacts);
    assert.equal(malformed.ok, false);
    assert.equal(exists(held.lockPath), true, 'a malformed lock must remain untouched');
    rmSync(held.lockPath);
    // Foreign lock: a symlink at the lock location.
    symlinkSync('/nonexistent-lock-target', held.lockPath);
    const foreign = breakLock(env, malformedFacts);
    assert.equal(foreign.ok, false);
    assert.equal(lstatSync(held.lockPath).isSymbolicLink(), true, 'the symlink must remain untouched');
    rmSync(held.lockPath);
    // Wrong mode.
    writeFileSync(held.lockPath, canonicalLockRecordBytes(lockRecordWith(env, { nonce: 'd'.repeat(32) }) as unknown as Parameters<typeof canonicalLockRecordBytes>[0]), { mode: 0o644 });
    chmodSync(held.lockPath, 0o644);
    const wrongMode = breakLock(env, malformedFacts);
    assert.equal(wrongMode.ok, false);
    assert.equal(exists(held.lockPath), true);
    // Wrong store-instance facts: a lock bound to another store identity.
    const otherNamespace = writeLockRecord(env, lockRecordWith(env, { nonce: 'e'.repeat(32), storeInstance: [{ kind: 'configuration', dev: 1, ino: 2 }, { kind: 'store-records', dev: 1, ino: 3 }] }));
    const wrongStoreLock = breakLock(env, otherNamespace);
    assert.equal(wrongStoreLock.ok, false, 'a lock of another store must fail closed');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Race closure (LOK-021) ─────────────────────────────────────────────────

test('lock-recovery: a same-name legitimate new writer lock is never removed by old recovery authorization', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const first = acquireHeldLock(env);
    // Break the first lock with evidence.
    const broken = breakLock(env, first);
    assert.equal(broken.ok, true);
    assert.equal(broken.outcome, 'lock-broken');
    // A NEW legitimate writer acquires a fresh lock at the same name.
    const second = acquireHeldLock(env);
    assert.notEqual(second.recordDigest, first.recordDigest, 'a fresh acquisition must produce a distinct lock instance');
    // Replaying the OLD recovery action against the NEW lock fails closed
    // and the new lock survives.
    const replay = breakLock(env, first);
    assert.equal(replay.ok, false, 'old recovery authorization must not break the new lock');
    assert.equal(replay.code, 'ERR-STO-INTEGRITY');
    assert.equal(exists(second.lockPath), true, 'the new writer lock must remain untouched');
    // The new writer can still release its own lock normally.
    const provenance = createStorageWriteActionProvenance({ actionIdentity: WRITE_ACTION, locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile });
    const request = createTrustedWriteRequest(env.config, provenance, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
    const capability = createWriteCapability({ trustedWriteRequest: request.request!, storeInstance: env.storeInstance! });
    try {
      const released = releaseWriterLock({
        capability: capability!,
        operation: 'record-publish',
        lockPath: second.lockPath,
        locksDirPath: `${env.storeRoot}/locks`,
        expected: { nonce: second.record['nonce'] as string, storeInstance: namespaces(env) },
        timeSource: { now: () => 1000, processStartTime: 500 },
      });
      assert.equal(released.ok, true, JSON.stringify(released));
    } finally {
      capability!.dispose();
    }
    assert.equal(exists(second.lockPath), false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('lock-recovery: replacement at the final recheck fails closed within the supported writer protocol', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const held = acquireHeldLock(env);
    const tokens = recoveryTokens(env);
    // Inject a same-name replacement at the narrowest harness point —
    // immediately before the digest-bound final recheck inside the removal
    // primitive. A replacement with DIFFERENT lock bytes (new nonce, as any
    // legitimate new acquisition would carry) must fail the digest recheck.
    let replaced = false;
    const result = executeRecoveryMutation({
      ...breakRequest(env, held, tokens),
      hooks: {
        stage: (s) => {
          if (s === 'before-lock-unlink' && !replaced) {
            replaced = true;
            rmSync(held.lockPath);
            writeLockRecord(env, lockRecordWith(env, { nonce: 'f'.repeat(32) }));
          }
        },
      },
    });
    assert.equal(replaced, true);
    assert.equal(result.ok, false, 'a replaced lock must fail closed');
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    const replacementBytes = readFileSync(held.lockPath, 'utf8');
    assert.equal(replacementBytes, canonicalLockRecordBytes(lockRecordWith(env, { nonce: 'f'.repeat(32) }) as unknown as Parameters<typeof canonicalLockRecordBytes>[0]), 'the replacement lock must remain untouched');
    // A same-bytes copy at a GENUINELY different inode must fail the
    // descriptor recheck: restore the exact adjudicated instance bytes, then
    // in the hook rename the file away (keeping its inode alive so the new
    // file cannot recycle it) and write the same bytes at a fresh inode.
    const originalLockBytes = canonicalLockRecordBytes(held.record as unknown as Parameters<typeof canonicalLockRecordBytes>[0]);
    writeFileSync(held.lockPath, originalLockBytes, { mode: 0o600 });
    chmodSync(held.lockPath, 0o600);
    const stashPath = join(env.storeRoot, 'locks', 'stash-copy.lock');
    let replaced2 = false;
    const result2 = executeRecoveryMutation({
      ...breakRequest(env, held, tokens),
      hooks: {
        stage: (s) => {
          if (s === 'before-lock-unlink' && !replaced2) {
            replaced2 = true;
            renameSync(held.lockPath, stashPath);
            writeFileSync(held.lockPath, originalLockBytes, { mode: 0o600 });
            chmodSync(held.lockPath, 0o600);
          }
        },
      },
    });
    assert.equal(replaced2, true);
    assert.equal(result2.ok, false, 'a same-bytes replacement (new inode) must fail the descriptor recheck');
    assert.equal(readFileSync(held.lockPath, 'utf8'), originalLockBytes, 'the same-bytes replacement must remain untouched');
    rmSync(stashPath);
    // The guard was released on the fail-closed path.
    assert.equal(exists(join(env.storeRoot, 'locks', RECOVERY_BREAK_GUARD_NAME)), false);
    // The genuine lock (still at the same name) breaks under its own
    // adjudication afterward.
    const finalFacts = writeLockRecord(env, held.record as Record<string, unknown>);
    const ok = breakLock(env, finalFacts);
    assert.equal(ok.ok, true, ok.message ?? '');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Idempotency / evidence states (LOK-022) ────────────────────────────────

test('lock-recovery: idempotency and evidence states — already-completed, absent-no-evidence, live-target, conflicting', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const held = acquireHeldLock(env);
    // Matching replay after a completed break → already-completed.
    const first = breakLock(env, held);
    assert.equal(first.ok, true);
    const replay = breakLock(env, held);
    assert.equal(replay.ok, true, 'matching evidence with the lock absent must resolve already-completed');
    assert.equal(replay.outcome, 'already-completed');
    assert.equal(replay.evidenceId, first.evidenceId);
    // Absent without evidence → fail closed (no inference). A fresh lock
    // record that is removed by hand leaves no evidence behind.
    const ghost = writeLockRecord(env, lockRecordWith(env, { nonce: 'g'.repeat(32) }));
    rmSync(held.lockPath);
    const absentNoEvidence = breakLock(env, ghost);
    assert.equal(absentNoEvidence.ok, false, 'absent lock without evidence must fail closed');
    assert.equal(absentNoEvidence.code, 'ERR-STO-NOT-FOUND');
    // Evidence with the live target → integrity inconsistency: recreate the
    // exact broken lock bytes (replay of an earlier internally valid state;
    // TML-002 boundary) and re-run the old adjudication.
    const recreated = writeLockRecord(env, held.record as Record<string, unknown>);
    assert.equal(recreated.recordDigest, held.recordDigest);
    const liveTarget = breakLock(env, held);
    assert.equal(liveTarget.ok, false, 'evidence with the exact live lock must fail closed');
    assert.equal(liveTarget.code, 'ERR-STO-INTEGRITY');
    assert.equal(exists(held.lockPath), true);
    // Conflicting evidence: tamper the evidence payload digest binding.
    rmSync(held.lockPath);
    const evidencePath = join(env.storeRoot, derivedOf(env, 'store-evidence-record', first.evidenceId!));
    const evidenceModel = JSON.parse(readFileSync(evidencePath, 'utf8')) as Record<string, unknown>;
    const payload = evidenceModel['payload'] as Record<string, unknown>;
    payload['lockRecordDigest'] = 'sha-256:' + '7'.repeat(64);
    evidenceModel['payload'] = payload;
    evidenceModel['payloadDigest'] = computePayloadDigest(payload);
    writeFileSync(evidencePath, canonicalEnvelopeBytes(evidenceModel).canonicalUtf8, { mode: 0o600 });
    chmodSync(evidencePath, 0o600);
    const conflicting = breakLock(env, held);
    assert.equal(conflicting.ok, false, 'conflicting evidence must fail closed');
    assert.equal(conflicting.code, 'ERR-STO-INTEGRITY');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('lock-recovery: only the exact lock is unlinked; unrelated lock artifacts are preserved', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const held = acquireHeldLock(env);
    // Unrelated artifacts in locks/ (a stray foreign file and a held
    // recovery-break guard from another breaker) must survive.
    const strayPath = join(env.storeRoot, 'locks', 'stray.txt');
    writeFileSync(strayPath, 'x', { mode: 0o600 });
    chmodSync(strayPath, 0o600);
    // A leftover guard blocks a second breaker (guard contention).
    const rp = createRecoveryActionProvenance({ actionIdentity: RECOVERY_ACTION, locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile });
    const ir = createTrustedRecoveryRequest(env.config, rp, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
    assert.equal(ir.ok, true);
    const cap = createRecoveryCapability({ trustedRecoveryRequest: ir.request!, storeInstance: env.storeInstance! });
    assert.ok(cap !== undefined);
    const guardAcquired = acquireRecoveryBreakGuard({
      capability: cap!,
      lockPath: join(env.storeRoot, 'locks', RECOVERY_BREAK_GUARD_NAME),
      locksDirPath: `${env.storeRoot}/locks`,
      storeInstance: namespaces(env),
      actionIdentity: RECOVERY_ACTION,
      timeSource: { now: () => 1000, processStartTime: 500 },
    });
    assert.equal(guardAcquired.ok, true);
    cap!.dispose();
    // A second breaker fails closed on the held guard; nothing is removed.
    const blocked = breakLock(env, held);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'ERR-STO-LOCK-UNAVAILABLE');
    assert.equal(exists(held.lockPath), true);
    assert.equal(exists(strayPath), true);
    // Release the guard (fixture; the holder's own release) and break.
    rmSync(join(env.storeRoot, 'locks', RECOVERY_BREAK_GUARD_NAME));
    const broken = breakLock(env, held);
    assert.equal(broken.ok, true, broken.message ?? '');
    assert.equal(exists(held.lockPath), false, 'the exact lock is gone');
    assert.equal(exists(strayPath), true, 'unrelated lock artifacts must be preserved');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Scanner / plan integration ─────────────────────────────────────────────

test('lock-recovery: scanner and plan classify lock states and lock-recovery evidence deterministically', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    // Persistent lock: requiresDisposition with the external-adjudication
    // wording; never "stale" by time.
    const held = acquireHeldLock(env);
    let scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scan.ok, true);
    assert.equal(scan.assessment!.requiresDisposition.some((d) => d.classification === 'writer-lock-present'), true);
    assert.match(scan.assessment!.requiresDisposition.find((d) => d.classification === 'writer-lock-present')!.reason ?? '', /externally adjudicated/);
    assert.equal(scan.assessment!.lockRecoveryStates.length, 0);
    // Completed: break → evidence; scan classifies completed-lock-recovery.
    const broken = breakLock(env, held);
    assert.equal(broken.ok, true);
    scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scan.ok, true);
    const completed = scan.assessment!.lockRecoveryStates.find((s) => s.state === 'completed-lock-recovery');
    assert.ok(completed !== undefined, 'completed lock recovery must be classified');
    assert.equal(scan.assessment!.requiresDisposition.some((d) => d.classification === 'writer-lock-present'), false);
    assert.equal(scan.plan!.actions.some((a) => a.requiredOperation === 'break-writer-lock'), false, 'no break action for an absent lock');
    // Evidence with a different current lock: a new writer acquires; the
    // old evidence does not authorize it.
    const second = acquireHeldLock(env);
    scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    const different = scan.assessment!.lockRecoveryStates.find((s) => s.state === 'evidence-with-different-lock');
    assert.ok(different !== undefined, 'evidence with a different current lock must be classified');
    assert.equal(scan.plan!.actions.some((a) => a.requiredOperation === 'break-writer-lock'), true, 'the new lock needs a fresh external adjudication');
    // Liveness facts are observable but never authorize: the finding
    // carries pid/start-time as recorded facts only.
    const currentLockFinding = scan.assessment!.persistentLockObservations.find((l) => l.classification === 'writer-lock-present');
    assert.ok(currentLockFinding !== undefined);
    assert.equal(currentLockFinding!.pid !== undefined, true);
    // Conflicting evidence: recreate the exact broken lock bytes.
    writeLockRecord(env, held.record as Record<string, unknown>);
    scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    const conflicting = scan.assessment!.lockRecoveryStates.find((s) => s.state === 'conflicting-lock-recovery-evidence');
    assert.ok(conflicting !== undefined, 'evidence with the exact live lock must be classified as conflicting');
    rmSync(held.lockPath);
    // Dangling evidence: a hand-built evidence record claiming
    // break-writer-lock with incomplete facts.
    const danglingPayload = {
      evidenceKind: 'recovery-evidence',
      recoveryOperation: 'break-writer-lock',
      targetEntry: 'writer.lock',
      outcome: 'lock-broken',
      resultingState: { writerLockRemoved: true },
    };
    const danglingId = computeLockRecoveryEvidenceIdentity({
      storeInstance: env.storeInstance!,
      evidenceKind: 'recovery-evidence',
      recoveryOperation: 'break-writer-lock',
      lockRecordDigest: 'sha-256:' + '1'.repeat(64),
      lockInstanceId: 'pgw:r:' + '2'.repeat(32),
      observationId: lockObservationId(),
      outcome: 'lock-broken',
    });
    const danglingDerived = deriveRecordRelativePath('store-evidence-record', danglingId);
    assert.equal(danglingDerived.ok, true);
    const danglingPath = join(env.storeRoot, (danglingDerived as { readonly ok: true; readonly relativePath: string }).relativePath);
    const danglingModel = {
      recordKind: 'StoreEvidenceRecord',
      formatVersion: '1.0',
      recordId: danglingId,
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: RECOVERY_ACTION,
      payload: danglingPayload,
      payloadDigest: computePayloadDigest(danglingPayload),
      referenceDigests: [],
      retentionClass: 'indefinite',
    };
    mkdirSync(danglingPath.slice(0, danglingPath.lastIndexOf('/')), { recursive: true, mode: 0o700 });
    writeFileSync(danglingPath, canonicalEnvelopeBytes(danglingModel).canonicalUtf8, { mode: 0o600 });
    chmodSync(danglingPath, 0o600);
    scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    const dangling = scan.assessment!.lockRecoveryStates.find((s) => s.state === 'dangling-lock-recovery-evidence');
    assert.ok(dangling !== undefined, 'malformed lock-recovery evidence must be classified as dangling');
    // Leftover recovery-break guard: classified and disposition-required.
    const rp = createRecoveryActionProvenance({ actionIdentity: RECOVERY_ACTION, locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile });
    const ir = createTrustedRecoveryRequest(env.config, rp, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
    assert.equal(ir.ok, true);
    const cap = createRecoveryCapability({ trustedRecoveryRequest: ir.request!, storeInstance: env.storeInstance! });
    assert.ok(cap !== undefined);
    const guardAcquired = acquireRecoveryBreakGuard({
      capability: cap!,
      lockPath: join(env.storeRoot, 'locks', RECOVERY_BREAK_GUARD_NAME),
      locksDirPath: `${env.storeRoot}/locks`,
      storeInstance: namespaces(env),
      actionIdentity: RECOVERY_ACTION,
      timeSource: { now: () => 1000, processStartTime: 500 },
    });
    assert.equal(guardAcquired.ok, true);
    cap!.dispose();
    scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    const guardFinding = scan.assessment!.persistentLockObservations.find((l) => l.classification === 'recovery-break-guard-present');
    assert.ok(guardFinding !== undefined, 'a leftover guard must be classified');
    assert.equal(scan.assessment!.requiresDisposition.some((d) => d.classification === 'recovery-break-guard-present'), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Crash model (12-stage) ─────────────────────────────────────────────────

/** Fixed lock-recovery crash-stage inventory (12.3.1/ADR-033 §12). */
const LOCK_RECOVERY_CRASH_STAGES: readonly RecoveryMutationStage[] = [
  'before-recovery-break-guard',
  'after-recovery-break-guard',
  'after-lock-target-verification',
  'after-lock-instance-recheck',
  'before-lock-unlink',
  'after-lock-unlink',
  'before-locks-directory-fsync',
  'after-locks-directory-fsync',
  'before-lock-evidence-publication',
  'after-lock-evidence-publication',
  'after-lock-evidence-audit-publication',
  'before-recovery-break-guard-release',
];

test('lock-recovery: the fixed 12-stage crash inventory is asserted', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const held = acquireHeldLock(env);
    const seen: RecoveryMutationStage[] = [];
    const result = executeRecoveryMutation({
      ...breakRequest(env, held, recoveryTokens(env)),
      hooks: { stage: (s) => seen.push(s) },
    });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.deepEqual(seen, LOCK_RECOVERY_CRASH_STAGES, 'the fixed lock-recovery crash-stage inventory must be exercised in order');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('lock-recovery: a crash at every stage leaves a classifiable state and a safe fresh rerun', () => {
  for (const stage of LOCK_RECOVERY_CRASH_STAGES) {
    const env = makeStore();
    try {
      publish(env, 'pgw:r:11110000000000000000000000000001');
      const held = acquireHeldLock(env);
      const tokens = recoveryTokens(env);
      const request = (): RecoveryMutationRequest => breakRequest(env, held, tokens);
      let crashed = false;
      try {
        executeRecoveryMutation({
          ...request(),
          hooks: {
            stage: (s) => {
              if (s === stage) {
                crashed = true;
                throw new Error(`simulated crash at ${stage}`);
              }
            },
          },
        });
      } catch {
        assert.equal(crashed, true, `crash must fire at ${stage}`);
      }
      // The authoritative store is untouched except for the recovery
      // evidence itself (the sole permitted mutation): the approval record
      // remains, and the only additional durable record is the evidence
      // once its publication stage has passed.
      const scanAfterCrash = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      assert.equal(scanAfterCrash.ok, true, JSON.stringify(scanAfterCrash.findings));
      const evidenceIndexStage = LOCK_RECOVERY_CRASH_STAGES.indexOf('after-lock-evidence-publication');
      const expectedRecords = LOCK_RECOVERY_CRASH_STAGES.indexOf(stage) >= evidenceIndexStage ? 2 : 1;
      assert.equal(scanAfterCrash.assessment!.verifiedDurableRecords.length, expectedRecords, `${stage}: only the recovery evidence may be added`);
      assert.equal(scanAfterCrash.assessment!.verifiedDurableRecords.some((r) => r.recordId === 'pgw:r:11110000000000000000000000000001'), true, `${stage}: the approval record must remain untouched`);
      const guardPath = join(env.storeRoot, 'locks', RECOVERY_BREAK_GUARD_NAME);
      const guardPresent = exists(guardPath);
      if (stage !== 'before-recovery-break-guard') {
        assert.equal(guardPresent, true, `crash at ${stage} leaves the recovery-break guard`);
        // A concurrent breaker fails closed on the held guard; the guard is
        // never auto-broken (fixture release for the rerun, matching the
        // accepted crash harness).
        const blocked = executeRecoveryMutation(request());
        assert.equal(blocked.ok, false);
        assert.equal(blocked.findings?.[0]?.code, 'ERR-STO-LOCK-UNAVAILABLE');
        rmSync(guardPath);
      }
      // Rerun: deterministic per stage — complete (pre-unlink), fail closed
      // (unlink done, evidence absent — no inference), or already-completed
      // (evidence durable).
      const rerun = executeRecoveryMutation(request());
      const unlinkIndex = LOCK_RECOVERY_CRASH_STAGES.indexOf('after-lock-unlink');
      const evidenceIndex = LOCK_RECOVERY_CRASH_STAGES.indexOf('after-lock-evidence-publication');
      const stageIndex = LOCK_RECOVERY_CRASH_STAGES.indexOf(stage);
      if (stageIndex < unlinkIndex) {
        assert.equal(rerun.ok, true, `${stage}: rerun must complete: ${JSON.stringify(rerun.findings)}`);
        assert.equal(rerun.outcome, 'lock-broken');
        assert.equal(exists(held.lockPath), false, `${stage}: the adjudicated lock must be gone after the rerun`);
      } else if (stageIndex < evidenceIndex) {
        assert.equal(rerun.ok, false, `${stage}: lock absent without evidence must fail closed (no inference)`);
        assert.equal(rerun.findings?.[0]?.code, 'ERR-STO-NOT-FOUND');
      } else {
        assert.equal(rerun.ok, true, `${stage}: rerun must resolve already-completed: ${JSON.stringify(rerun.findings)}`);
        assert.equal(rerun.outcome, 'already-completed');
      }
      assert.equal(exists(guardPath), false, `${stage}: the guard must be released after the rerun`);
    } finally {
      rmSync(env.dir, { recursive: true, force: true });
    }
  }
});
