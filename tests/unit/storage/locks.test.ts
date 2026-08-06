/**
 * WP-8-D writer lock tests (contract 12.3, LOK-001…018; ADR-029 D-3).
 *
 * Deterministic injected clock/wait/cancellation sources; the lock module
 * itself contains no timers, clocks, or environment access (D-3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, statSync, rmSync, writeFileSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageWriteActionProvenance, createTrustedWriteRequest } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { createWriteCapability, type WriteCapability } from '../../../src/storage/capabilities/authenticity.js';
import { acquireWriterLock, releaseWriterLock, probeWriterLock, canonicalLockRecordBytes, LOCK_VERSION } from '../../../src/storage/locks/lock.js';
import { defaultLimitProfile } from '../../../src/storage/limits/limits.js';
import type { VerifiedStoreInstance } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const ACTION = 'lock-action-1';

function genuineConfig(): object {
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity: CONFIG_IDENTITY };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

function makeStoreInstance(): VerifiedStoreInstance {
  const dir = mkdtempSync(join(tmpdir(), 'wp8d-lock-'));
  chmodSync(dir, 0o700);
  const stat = statSync(dir);
  return {
    parentIdentity: { canonicalPath: dir, dev: Number(stat.dev), ino: Number(stat.ino), fileType: 'directory' },
    namespaces: [
      { kind: 'configuration', canonicalPath: join(dir, 'config-v1'), dev: Number(stat.dev), ino: Number(stat.ino) + 1 },
      { kind: 'store-records', canonicalPath: join(dir, 'store-v1'), dev: Number(stat.dev), ino: Number(stat.ino) + 2 },
    ],
    configurationIdentity: CONFIG_IDENTITY,
    serviceUid: UID,
    limitProfile: defaultLimitProfile(),
  };
}

function makeCapability(store: VerifiedStoreInstance): WriteCapability {
  const provenance = createStorageWriteActionProvenance({
    actionIdentity: ACTION,
    locator: store.parentIdentity.canonicalPath,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
  });
  const request = createTrustedWriteRequest(genuineConfig(), provenance, {
    locator: store.parentIdentity.canonicalPath,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
  });
  assert.equal(request.ok, true);
  const capability = createWriteCapability({ trustedWriteRequest: request.request, storeInstance: store });
  assert.ok(capability !== undefined);
  return capability!;
}

function env() {
  const store = makeStoreInstance();
  const locksDir = join(store.parentIdentity.canonicalPath, 'locks');
  mkdirSync(locksDir, { mode: 0o700 });
  chmodSync(locksDir, 0o700);
  const lockPath = join(locksDir, 'writer.lock');
  return { store, locksDir, lockPath, timeSource: { now: () => 1000, processStartTime: 500 } };
}

test('locks: acquisition creates the normative lock record and release is identity-bound', () => {
  const e = env();
  const capability = makeCapability(e.store);
  try {
    const acquired = acquireWriterLock({
      capability,
      lockPath: e.lockPath,
      locksDirPath: e.locksDir,
      storeInstance: e.store.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      actionIdentity: ACTION,
      lockWaitMs: 5000,
      timeSource: e.timeSource,
    });
    assert.equal(acquired.ok, true, JSON.stringify(acquired));
    assert.equal(acquired.outcome, 'acquired');
    const record = acquired.record!;
    assert.equal(record.lockVersion, LOCK_VERSION);
    assert.match(record.nonce, /^[0-9a-f]{32}$/);
    assert.equal(record.pid, process.pid);
    assert.equal(record.processStartTime, 500);
    assert.equal(record.acquisitionTime, 1000);
    assert.equal(record.maxAgeMs, 5000);
    assert.equal(record.storeInstance.length, 2);
    // The lock file exists with exact policy.
    const stat = statSync(e.lockPath);
    assert.equal(Number(stat.mode) & 0o777, 0o600);
    // Probe sees contention.
    assert.equal(probeWriterLock(e.lockPath).code, 'ERR-STO-LOCK-UNAVAILABLE');
    // Identity-bound release.
    const released = releaseWriterLock({
      capability,
      lockPath: e.lockPath,
      locksDirPath: e.locksDir,
      expected: { nonce: record.nonce, storeInstance: record.storeInstance },
      timeSource: e.timeSource,
    });
    assert.equal(released.ok, true, JSON.stringify(released));
    assert.equal(released.outcome, 'released');
    assert.equal(existsSync(e.lockPath), false);
    assert.equal(probeWriterLock(e.lockPath).ok, true);
    capability.dispose();
  } finally {
    rmSync(e.store.parentIdentity.canonicalPath, { recursive: true, force: true });
  }
});

test('locks: per-acquisition nonce is random and never reused', () => {
  const e = env();
  const capability = makeCapability(e.store);
  try {
    const a = acquireWriterLock({ capability, lockPath: e.lockPath, locksDirPath: e.locksDir, storeInstance: e.store.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })), actionIdentity: ACTION, lockWaitMs: 5000, timeSource: e.timeSource });
    assert.equal(a.ok, true);
    const nonceA = a.record!.nonce;
    assert.equal(releaseWriterLock({ capability, lockPath: e.lockPath, locksDirPath: e.locksDir, expected: { nonce: nonceA, storeInstance: a.record!.storeInstance }, timeSource: e.timeSource }).ok, true);
    const b = acquireWriterLock({ capability, lockPath: e.lockPath, locksDirPath: e.locksDir, storeInstance: e.store.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })), actionIdentity: ACTION, lockWaitMs: 5000, timeSource: e.timeSource });
    assert.equal(b.ok, true);
    assert.notEqual(b.record!.nonce, nonceA, 'each acquisition must mint a fresh nonce');
    releaseWriterLock({ capability, lockPath: e.lockPath, locksDirPath: e.locksDir, expected: { nonce: b.record!.nonce, storeInstance: b.record!.storeInstance }, timeSource: e.timeSource });
    capability.dispose();
  } finally {
    rmSync(e.store.parentIdentity.canonicalPath, { recursive: true, force: true });
  }
});

test('locks: release with a wrong nonce or store instance never touches the lock', () => {
  const e = env();
  const capability = makeCapability(e.store);
  try {
    const acquired = acquireWriterLock({ capability, lockPath: e.lockPath, locksDirPath: e.locksDir, storeInstance: e.store.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })), actionIdentity: ACTION, lockWaitMs: 5000, timeSource: e.timeSource });
    assert.equal(acquired.ok, true);
    const wrongNonce = releaseWriterLock({ capability, lockPath: e.lockPath, locksDirPath: e.locksDir, expected: { nonce: '0'.repeat(32), storeInstance: acquired.record!.storeInstance }, timeSource: e.timeSource });
    assert.equal(wrongNonce.ok, false);
    assert.equal(wrongNonce.outcome, 'not-owned');
    assert.equal(statSync(e.lockPath).isFile(), true, 'a non-owned lock must never be removed');
    const wrongStore = releaseWriterLock({ capability, lockPath: e.lockPath, locksDirPath: e.locksDir, expected: { nonce: acquired.record!.nonce, storeInstance: [{ kind: 'store-records', dev: 9, ino: 9 }] }, timeSource: e.timeSource });
    assert.equal(wrongStore.ok, false);
    assert.equal(statSync(e.lockPath).isFile(), true);
    capability.dispose();
  } finally {
    rmSync(e.store.parentIdentity.canonicalPath, { recursive: true, force: true });
  }
});

test('locks: contention, timeout and cancellation map to the closed lock codes', () => {
  const e = env();
  const capability = makeCapability(e.store);
  try {
    // Pre-existing foreign lock file (not ours): fail closed, never broken.
    writeFileSync(e.lockPath, 'foreign', { mode: 0o600 });
    const contended = acquireWriterLock({ capability, lockPath: e.lockPath, locksDirPath: e.locksDir, storeInstance: e.store.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })), actionIdentity: ACTION, lockWaitMs: 5000, timeSource: e.timeSource });
    assert.equal(contended.ok, false);
    assert.equal(contended.outcome, 'contention');
    assert.equal(contended.code, 'ERR-STO-LOCK-UNAVAILABLE');
    assert.equal(statSync(e.lockPath).isFile(), true, 'an existing lock is never broken');
    // Bounded wait with an advancing clock: timeout.
    let t = 0;
    const timed = acquireWriterLock({ capability, lockPath: e.lockPath, locksDirPath: e.locksDir, storeInstance: e.store.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })), actionIdentity: ACTION, lockWaitMs: 100, timeSource: { now: () => t, processStartTime: 0, wait: () => { t += 50; } } });
    assert.equal(timed.ok, false);
    assert.equal(timed.outcome, 'timeout');
    assert.equal(timed.code, 'ERR-STO-LOCK-TIMEOUT');
    // Cancellation during the wait.
    let u = 0;
    const cancelled = acquireWriterLock({ capability, lockPath: e.lockPath, locksDirPath: e.locksDir, storeInstance: e.store.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })), actionIdentity: ACTION, lockWaitMs: 1000, timeSource: { now: () => u, processStartTime: 0, wait: () => { u += 10; }, cancelled: () => u >= 20 } });
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.outcome, 'cancelled');
    assert.equal(cancelled.code, 'ERR-STO-CANCELLED');
    rmSync(e.lockPath, { force: true });
    capability.dispose();
  } finally {
    rmSync(e.store.parentIdentity.canonicalPath, { recursive: true, force: true });
  }
});

test('locks: foreign and malformed lock objects fail closed', () => {
  const e = env();
  const capability = makeCapability(e.store);
  try {
    // A directory at the lock path is foreign.
    mkdirSync(e.lockPath, { mode: 0o700 });
    const dirLock = acquireWriterLock({ capability, lockPath: e.lockPath, locksDirPath: e.locksDir, storeInstance: e.store.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })), actionIdentity: ACTION, lockWaitMs: 5000, timeSource: e.timeSource });
    assert.equal(dirLock.ok, false);
    assert.equal(dirLock.outcome, 'foreign-lock');
    rmSync(e.lockPath, { recursive: true, force: true });
    // A symlink at the lock path fails no-follow.
    const target = join(e.store.parentIdentity.canonicalPath, 'target');
    writeFileSync(target, 'x');
    symlinkSync(target, e.lockPath);
    const linkLock = acquireWriterLock({ capability, lockPath: e.lockPath, locksDirPath: e.locksDir, storeInstance: e.store.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })), actionIdentity: ACTION, lockWaitMs: 5000, timeSource: e.timeSource });
    assert.equal(linkLock.ok, false);
    assert.equal(linkLock.outcome, 'foreign-lock');
    rmSync(e.lockPath, { force: true });
    rmSync(target, { force: true });
    // A malformed lock record cannot be released as owned.
    writeFileSync(e.lockPath, '{not json', { mode: 0o600 });
    const release = releaseWriterLock({ capability, lockPath: e.lockPath, locksDirPath: e.locksDir, expected: { nonce: 'a'.repeat(32), storeInstance: [] }, timeSource: e.timeSource });
    assert.equal(release.ok, false);
    assert.equal(release.outcome, 'not-owned');
    assert.equal(statSync(e.lockPath).isFile(), true);
    rmSync(e.lockPath, { force: true });
    capability.dispose();
  } finally {
    rmSync(e.store.parentIdentity.canonicalPath, { recursive: true, force: true });
  }
});

test('locks: a structural capability operand is rejected before any filesystem access', () => {
  const e = env();
  try {
    const forged = { binding: { serviceUid: UID }, verify: () => ({ ok: true }), assertExpected: () => ({ ok: true }), dispose: () => undefined } as never;
    const result = acquireWriterLock({ capability: forged, lockPath: e.lockPath, locksDirPath: e.locksDir, storeInstance: [], actionIdentity: ACTION, lockWaitMs: 5000, timeSource: e.timeSource });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ERR-STO-REQ-INVALID');
    assert.equal(existsSync(e.lockPath), false, 'no lock file may be created by a forged capability');
  } finally {
    rmSync(e.store.parentIdentity.canonicalPath, { recursive: true, force: true });
  }
});

test('locks: canonical lock-record bytes are deterministic for identical fields', () => {
  const record = {
    lockVersion: LOCK_VERSION,
    storeInstance: [{ kind: 'store-records' as const, dev: 1, ino: 2 }],
    nonce: 'a'.repeat(32),
    actionIdentityDigest: 'sha-256:' + 'b'.repeat(64),
    pid: 1234,
    processStartTime: 100,
    acquisitionTime: 200,
    maxAgeMs: 5000,
  };
  const a = canonicalLockRecordBytes(record);
  const b = canonicalLockRecordBytes({ ...record });
  assert.equal(a, b);
  assert.ok(a.length > 0 && a.length <= 4096);
});
