/**
 * WP-8-D exact read, verify-by-identity and bounded enumeration tests
 * (contract 13, RDS-001…012; ADR-029 D-5).
 *
 * All fixtures are test-created temporary stores; records are published
 * through the accepted publication path with test-only producers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, statSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createTrustedStorageBootstrapInput } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../../src/storage/publication/index.js';
import { readRecord, verifyRecord, enumerateClass } from '../../../src/storage/read/index.js';
import { computePayloadDigest } from '../../../src/storage/format/envelope.js';
import { defaultLimitProfile } from '../../../src/storage/limits/limits.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const WRITE_ACTION = 'read-action-1';

function genuineConfig(): object {
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity: CONFIG_IDENTITY };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

interface ReadEnv {
  readonly dir: string;
  readonly config: object;
  readonly trustedInput: unknown;
}

function makeStore(): ReadEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wp8d-read-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: 'read-bootstrap-action',
    locator: dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
  });
  const inputResult = createTrustedStorageBootstrapInput(config, bootstrapProvenance, { locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile: defaultLimitProfile() });
  assert.equal(inputResult.ok, true);
  const result = initializeTrustedStore({ trustedConfiguration: config, actionProvenance: bootstrapProvenance, locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile: defaultLimitProfile() });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  return { dir, config, trustedInput: inputResult.input };
}

function publish(env: ReadEnv, recordId: string, payload: Readonly<Record<string, unknown>> = { approved: true }, revision = 1): void {
  const provenance = createStorageWriteActionProvenance({
    actionIdentity: WRITE_ACTION,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
  });
  const record = {
    recordKind: 'ApprovalRecord',
    formatVersion: '1.0',
    recordId,
    revision,
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
    limitProfile: defaultLimitProfile(),
    recordClass: 'approval-record',
    record,
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
}

test('read: exact read returns the verified record with digest, never a live handle', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:000000000000000000000000000000a1';
    publish(env, recordId);
    const result = readRecord({ trustedConfiguration: env.config, trustedInput: env.trustedInput, recordClass: 'approval-record', recordId });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.record?.['recordId'], recordId);
    assert.match(result.digest ?? '', /^sha-256:[0-9a-f]{64}$/);
    assert.ok(result.byteLength !== undefined && result.byteLength > 0);
    // Copy-on-return: the returned object is frozen.
    assert.equal(Object.isFrozen(result.record), true);
    assert.throws(() => { (result.record as Record<string, unknown>)['x'] = 1; }, TypeError);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('read: absent, tampered and malformed records fail closed with mapped codes', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:000000000000000000000000000000a2';
    const missing = readRecord({ trustedConfiguration: env.config, trustedInput: env.trustedInput, recordClass: 'approval-record', recordId });
    assert.equal(missing.ok, false);
    assert.equal(missing.findings?.[0]?.code, 'ERR-STO-NOT-FOUND');
    // Publish then tamper the bytes.
    publish(env, recordId);
    const derived = join(env.dir, 'store-v1', 'records', 'approval', recordId.slice(6, 10), recordId.slice(6) + '.rec');
    const raw = JSON.parse(readFileSync(derived, 'utf8')) as Record<string, unknown>;
    raw['payload'] = { approved: false };
    writeFileSync(derived, JSON.stringify(raw), { mode: 0o600 });
    const tampered = readRecord({ trustedConfiguration: env.config, trustedInput: env.trustedInput, recordClass: 'approval-record', recordId });
    assert.equal(tampered.ok, false);
    assert.equal(tampered.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    // Malformed bytes.
    writeFileSync(derived, '{broken', { mode: 0o600 });
    const malformed = readRecord({ trustedConfiguration: env.config, trustedInput: env.trustedInput, recordClass: 'approval-record', recordId });
    assert.equal(malformed.ok, false);
    assert.equal(malformed.findings?.[0]?.code, 'ERR-STO-MALFORMED');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('read: invalid class or identity operands are rejected without I/O', () => {
  const env = makeStore();
  try {
    const badClass = readRecord({ trustedConfiguration: env.config, trustedInput: env.trustedInput, recordClass: 'not-a-class' as never, recordId: 'pgw:r:000000000000000000000000000000a3' });
    assert.equal(badClass.ok, false);
    assert.equal(badClass.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    const badId = readRecord({ trustedConfiguration: env.config, trustedInput: env.trustedInput, recordClass: 'approval-record', recordId: '../etc/passwd' });
    assert.equal(badId.ok, false);
    assert.equal(badId.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    const forgedInput = readRecord({ trustedConfiguration: env.config, trustedInput: { ...(env.trustedInput as object) }, recordClass: 'approval-record', recordId: 'pgw:r:000000000000000000000000000000a3' });
    assert.equal(forgedInput.ok, false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('verify: structured pass/fail findings, never content, never authority', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:000000000000000000000000000000a4';
    publish(env, recordId);
    const ok = verifyRecord({ trustedConfiguration: env.config, trustedInput: env.trustedInput, recordClass: 'approval-record', recordId });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.findings, []);
    const missing = verifyRecord({ trustedConfiguration: env.config, trustedInput: env.trustedInput, recordClass: 'approval-record', recordId: 'pgw:r:000000000000000000000000000000a5' });
    assert.equal(missing.ok, false);
    assert.equal(missing.findings[0]?.code, 'ERR-STO-NOT-FOUND');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('enumerate: bounded deterministic enumeration over verified records', () => {
  const env = makeStore();
  try {
    // Two records in different shards, one foreign entry.
    const idA = 'pgw:r:000000000000000000000000000000b1';
    const idB = 'pgw:r:ffff00000000000000000000000000b2';
    publish(env, idA);
    publish(env, idB);
    // A foreign entry inside a shard dir.
    const shardDir = join(env.dir, 'store-v1', 'records', 'approval', '0000');
    writeFileSync(join(shardDir, 'not-a-record.txt'), 'x', { mode: 0o600 });
    const result = enumerateClass({ trustedConfiguration: env.config, trustedInput: env.trustedInput, recordClass: 'approval-record' });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.truncated, false);
    const records = result.items.filter((i) => i.recordId !== undefined).map((i) => i.recordId);
    assert.deepEqual(records, [idA, idB], 'deterministic order');
    // The foreign entry is a bounded finding, never a record.
    assert.equal(result.items.filter((i) => i.finding !== undefined).length, 1);
    assert.equal(result.items.filter((i) => i.finding?.code === 'ERR-STO-MALFORMED').length, 1);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('enumerate: bounds and continuation', () => {
  const env = makeStore();
  try {
    const idA = 'pgw:r:000000000000000000000000000000c1';
    const idB = 'pgw:r:000100000000000000000000000000c2';
    publish(env, idA);
    publish(env, idB);
    const profile = { ...defaultLimitProfile(), enumerationResults: 1 };
    // Rebuild the input with the narrowed profile (request lowering).
    const config = genuineConfig();
    const bootstrapProvenance = createStorageBootstrapActionProvenance({
      actionIdentity: 'read-bootstrap-action',
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: CONFIG_IDENTITY,
      limitProfile: profile,
    });
    const inputResult = createTrustedStorageBootstrapInput(config, bootstrapProvenance, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: profile });
    assert.equal(inputResult.ok, true);
    const first = enumerateClass({ trustedConfiguration: config, trustedInput: inputResult.input, recordClass: 'approval-record' });
    assert.equal(first.ok, true);
    assert.equal(first.truncated, true);
    assert.equal(first.items.filter((i) => i.recordId !== undefined).length, 1);
    assert.ok(first.continuation !== undefined);
    // The cursor resumes strictly after the reported entry.
    const second = enumerateClass({ trustedConfiguration: config, trustedInput: inputResult.input, recordClass: 'approval-record', continuation: first.continuation });
    assert.equal(second.ok, true);
    assert.equal(second.items.filter((i) => i.recordId !== undefined).length, 1);
    assert.ok(second.continuation !== undefined);
    // A final page past the last entry completes without truncation.
    const third = enumerateClass({ trustedConfiguration: config, trustedInput: inputResult.input, recordClass: 'approval-record', continuation: second.continuation });
    assert.equal(third.ok, true);
    assert.equal(third.truncated, false);
    const all = [...first.items, ...second.items, ...third.items].filter((i) => i.recordId !== undefined).map((i) => i.recordId);
    assert.deepEqual(all.sort(), [idA, idB].sort());
    // No duplicate reporting across pages.
    assert.equal(new Set(all).size, all.length);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});
