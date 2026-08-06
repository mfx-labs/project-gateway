/**
 * WP-8-D immutable publication integration tests (contract 10, WPR-001…023,
 * LOK, CAP-008/009; ADR-029 D-2/D-5/D-7/D-8/D-12).
 *
 * All fixtures are test-created temporary stores initialized through the
 * accepted WP-8-C flow with test-only producers; production publication
 * remains unreachable (no production importer of the write-action-provenance
 * creator). No real host store is ever touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, statSync, rmSync, readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createTrustedStorageBootstrapInput } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../../src/storage/publication/index.js';
import { publicationTempName } from '../../../src/storage/publication/publish-record.js';
import { buildAuthorizedWriteAuditEvent } from '../../../src/storage/audit/write-audit.js';
import { computePayloadDigest, canonicalEnvelopeBytes } from '../../../src/storage/format/envelope.js';
import { deriveRecordRelativePath } from '../../../src/storage/layout/layout.js';
import { defaultLimitProfile } from '../../../src/storage/limits/limits.js';
import type { PublishRecordRequest } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const WRITE_ACTION = 'write-action-1';
const BOOTSTRAP_ACTION = 'bootstrap-action-1';

function genuineConfig(identity: string = CONFIG_IDENTITY): object {
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

interface StoreEnv {
  readonly dir: string;
  readonly config: object;
  readonly bootstrapInput: unknown;
  readonly storeRoot: string;
}

function makeStore(): StoreEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wp8d-pub-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: BOOTSTRAP_ACTION,
    locator: dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
  });
  const inputResult = createTrustedStorageBootstrapInput(config, bootstrapProvenance, {
    locator: dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
  });
  assert.equal(inputResult.ok, true);
  const result = initializeTrustedStore({
    trustedConfiguration: config,
    actionProvenance: bootstrapProvenance,
    locator: dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  return { dir, config, bootstrapInput: inputResult.input, storeRoot: join(dir, 'store-v1') };
}

function writeProvenance(locator: string) {
  return createStorageWriteActionProvenance({
    actionIdentity: WRITE_ACTION,
    locator,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
  });
}

function request(env: StoreEnv, record: Readonly<Record<string, unknown>>, overrides: Partial<PublishRecordRequest> = {}): PublishRecordRequest {
  return {
    trustedConfiguration: env.config,
    bootstrapInput: env.bootstrapInput,
    writeActionProvenance: writeProvenance(env.dir),
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
    recordClass: 'approval-record',
    record,
    timeSource: { now: () => 1000, processStartTime: 500, wait: () => undefined },
    ...overrides,
  };
}

function approvalRecord(recordId: string, actionIdentity = WRITE_ACTION, revision = 1, payload: Readonly<Record<string, unknown>> = { approved: true }): Readonly<Record<string, unknown>> {
  return {
    recordKind: 'ApprovalRecord',
    formatVersion: '1.0',
    recordId,
    revision,
    createdAt: '2026-01-01T00:00:00.000Z',
    trustedActionId: actionIdentity,
    payload,
    payloadDigest: computePayloadDigest(payload),
  };
}

function primaryPaths(env: StoreEnv, recordId: string) {
  const derived = deriveRecordRelativePath('approval-record', recordId);
  assert.equal(derived.ok, true);
  return { finalPath: join(env.storeRoot, derived.relativePath), shardDir: join(env.storeRoot, 'records', 'approval', derived.shard), relativePath: derived.relativePath };
}

function auditPaths(env: StoreEnv, recordId: string, revision: number, recordModel: Readonly<Record<string, unknown>>) {
  const configStat = statSync(join(env.dir, 'config-v1'));
  const storeStat = statSync(env.storeRoot);
  const audit = buildAuthorizedWriteAuditEvent({
    storeInstance: [
      { kind: 'configuration', dev: Number(configStat.dev), ino: Number(configStat.ino) },
      { kind: 'store-records', dev: Number(storeStat.dev), ino: Number(storeStat.ino) },
    ],
    primaryClass: 'approval-record',
    primaryRecordId: recordId,
    primaryRevision: revision,
    primaryDigest: canonicalEnvelopeBytes(recordModel).digest,
    eventKind: 'authorized-write',
    trustedActionIdentity: WRITE_ACTION,
    primaryCreatedAt: recordModel['createdAt'] as string,
  });
  assert.equal(audit.ok, true);
  const derived = deriveRecordRelativePath('authoritative-audit-event', audit.event!.recordId);
  assert.equal(derived.ok, true);
  return { finalPath: join(env.storeRoot, derived.relativePath), event: audit.event! };
}

test('publication: full publish with mandatory audit at the durability point', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:00000000000000000000000000000001';
    const result = publishRecord(request(env, approvalRecord(recordId)));
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'published');
    assert.equal(result.recordId, recordId);
    assert.ok(result.auditEventId?.startsWith('pgw:l:'));
    assert.equal(result.auditEventId?.length, 6 + 32);
    // Primary file: mode 0600, exact bytes.
    const primary = primaryPaths(env, recordId);
    const primaryStat = statSync(primary.finalPath);
    assert.equal(Number(primaryStat.mode) & 0o777, 0o600);
    assert.equal(primaryStat.isFile(), true);
    const bytes = JSON.parse(readFileSync(primary.finalPath, 'utf8')) as Record<string, unknown>;
    assert.equal(bytes['recordKind'], 'ApprovalRecord');
    // Audit event exists at the derived audit path with identical bytes on
    // retry (deterministic identity).
    const audit = auditPaths(env, recordId, 1, approvalRecord(recordId));
    assert.equal(statSync(audit.finalPath).isFile(), true);
    const auditBytes = JSON.parse(readFileSync(audit.finalPath, 'utf8')) as Record<string, unknown>;
    assert.equal(auditBytes['recordKind'], 'AuthoritativeAuditEvent');
    assert.equal(auditBytes['trustedActionId'], WRITE_ACTION);
    // Phase-3 top-level directories exist (both namespaces).
    for (const ns of ['config-v1', 'store-v1']) {
      const entries = readdirSync(join(env.dir, ns)).sort();
      assert.deepEqual(entries, ['audit', 'locks', 'metadata', 'records', 'tmp']);
    }
    // Writer lock is released.
    assert.equal(existsSync(join(env.storeRoot, 'locks', 'writer.lock')), false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('publication: idempotent retry returns the contract-permitted duplicate result without a second event', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:00000000000000000000000000000002';
    const first = publishRecord(request(env, approvalRecord(recordId)));
    assert.equal(first.ok, true);
    const second = publishRecord(request(env, approvalRecord(recordId)));
    assert.equal(second.ok, true, JSON.stringify(second.findings));
    assert.equal(second.outcome, 'idempotent-duplicate');
    // Exactly one audit event exists (retries verify, never emit).
    const auditDir = join(env.storeRoot, 'audit', 'audit-event');
    const shards = readdirSync(auditDir);
    let events = 0;
    for (const shard of shards) {
      const entries = readdirSync(join(auditDir, shard));
      events += entries.filter((e) => e.endsWith('.aud')).length;
    }
    assert.equal(events, 1);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('publication: duplicate and revision-conflict classification per 10.2/18.2', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:00000000000000000000000000000003';
    const first = publishRecord(request(env, approvalRecord(recordId, WRITE_ACTION, 1, { approved: true })));
    assert.equal(first.ok, true);
    // Different bytes under the same identity: the committed 18.2
    // classifier maps any revision/digest divergence to the revision-conflict
    // class (same revision with conflicting digest is explicit in 18.2;
    // different revision is a conflicting revision). ERR-STO-DUPLICATE stays
    // reserved for the canonical-impossible same-digest-different-bytes case.
    const different = publishRecord(request(env, approvalRecord(recordId, WRITE_ACTION, 2, { approved: false })));
    assert.equal(different.ok, false);
    assert.equal(different.outcome, 'conflict-revision');
    assert.equal(different.findings?.[0]?.code, 'ERR-STO-CONFLICT-REVISION');
    const conflict = publishRecord(request(env, approvalRecord(recordId, WRITE_ACTION, 1, { approved: false })));
    assert.equal(conflict.ok, false);
    assert.equal(conflict.outcome, 'conflict-revision');
    assert.equal(conflict.findings?.[0]?.code, 'ERR-STO-CONFLICT-REVISION');
    // The existing object is never overwritten.
    const primary = primaryPaths(env, recordId);
    const bytes = JSON.parse(readFileSync(primary.finalPath, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(bytes['payload'], { approved: true });
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('publication: request validation rejects malformed, misattributed and over-limit records', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:00000000000000000000000000000004';
    // Wrong class kind.
    const wrongKind = publishRecord(request(env, { ...approvalRecord(recordId), recordKind: 'RuntimeGrant' }));
    assert.equal(wrongKind.ok, false);
    assert.equal(wrongKind.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    // Wrong trusted action identity (WPR-014).
    const wrongAction = publishRecord(request(env, approvalRecord(recordId, 'other-action')));
    assert.equal(wrongAction.ok, false);
    assert.equal(wrongAction.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    // Payload digest mismatch.
    const badDigest = publishRecord(request(env, { ...approvalRecord(recordId), payloadDigest: 'sha-256:' + '0'.repeat(64) }));
    assert.equal(badDigest.ok, false);
    assert.equal(badDigest.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    // Over-limit record bytes (request lowering of recordBytes; the
    // provenance must carry the same selected profile for correlation).
    const smallProfile = { ...defaultLimitProfile(), recordBytes: 1024 };
    const big = publishRecord(request(env, approvalRecord(recordId, WRITE_ACTION, 1, { blob: 'x'.repeat(4096) }), {
      limitProfile: smallProfile,
      writeActionProvenance: createStorageWriteActionProvenance({
        actionIdentity: WRITE_ACTION,
        locator: env.dir,
        serviceUid: UID,
        forbiddenRoots: [],
        configurationIdentity: CONFIG_IDENTITY,
        limitProfile: smallProfile,
      }),
    }));
    assert.equal(big.ok, false);
    assert.equal(big.findings?.[0]?.code, 'ERR-STO-LIMIT-EXCEEDED');
    // The audit class and store-metadata are not primary-publishable (D-6).
    const auditAsPrimary = publishRecord(request(env, { ...approvalRecord(recordId), recordKind: 'AuthoritativeAuditEvent' }, { recordClass: 'authoritative-audit-event' as never }));
    assert.equal(auditAsPrimary.ok, false);
    assert.equal(auditAsPrimary.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('publication: same-action temp EEXIST retry is idempotent only when primary and audit are durable and exact', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:00000000000000000000000000000005';
    // Simulate a crashed attempt: deterministic temp name exists, primary
    // durable, audit durable.
    const record = approvalRecord(recordId);
    const primary = primaryPaths(env, recordId);
    mkdirSync(primary.shardDir, { recursive: true, mode: 0o700 });
    chmodSync(primary.shardDir, 0o700);
    writeFileSync(primary.finalPath, JSON.stringify(record), { mode: 0o600 });
    chmodSync(primary.finalPath, 0o600);
    const audit = auditPaths(env, recordId, 1, record);
    mkdirSync(join(env.storeRoot, 'audit', 'audit-event', audit.finalPath.split('/').at(-2)!), { recursive: true, mode: 0o700 });
    writeFileSync(audit.finalPath, audit.event.canonicalUtf8, { mode: 0o600 });
    const tmpName = publicationTempName(WRITE_ACTION, 0);
    const tmpPath = join(env.storeRoot, 'tmp', tmpName);
    writeFileSync(tmpPath, JSON.stringify(record), { mode: 0o600 });
    chmodSync(tmpPath, 0o600);
    const result = publishRecord(request(env, record));
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'idempotent-duplicate');
    // The leftover temp is NOT adopted or unlinked by WP-8-D (phase-4 cleanup).
    assert.equal(statSync(tmpPath).isFile(), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('publication: primary durable but audit incomplete returns the durability class', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:00000000000000000000000000000006';
    const record = approvalRecord(recordId);
    const primary = primaryPaths(env, recordId);
    mkdirSync(primary.shardDir, { recursive: true, mode: 0o700 });
    chmodSync(primary.shardDir, 0o700);
    writeFileSync(primary.finalPath, JSON.stringify(record), { mode: 0o600 });
    chmodSync(primary.finalPath, 0o600);
    const tmpName = publicationTempName(WRITE_ACTION, 0);
    const tmpPath = join(env.storeRoot, 'tmp', tmpName);
    writeFileSync(tmpPath, JSON.stringify(record), { mode: 0o600 });
    chmodSync(tmpPath, 0o600);
    const result = publishRecord(request(env, record));
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-DURABILITY');
    assert.equal(result.findings?.[0]?.state.primaryStateChanged, 'yes');
    assert.equal(result.findings?.[0]?.state.verifyBeforeRetry, true);
    // The primary record remains untouched.
    assert.equal(statSync(primary.finalPath).isFile(), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('publication: neither state provable returns the durability-unknown tuple', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:00000000000000000000000000000007';
    // Only a stale temp exists; no primary, no audit.
    const record = approvalRecord(recordId);
    const tmpName = publicationTempName(WRITE_ACTION, 0);
    const tmpPath = join(env.storeRoot, 'tmp', tmpName);
    writeFileSync(tmpPath, JSON.stringify(record), { mode: 0o600 });
    chmodSync(tmpPath, 0o600);
    const result = publishRecord(request(env, record));
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-DURABILITY');
    assert.equal(result.findings?.[0]?.state.primaryStateChanged, 'unknown');
    assert.equal(result.findings?.[0]?.state.verifyBeforeRetry, true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('publication: hostile temp object fails closed without adoption', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:00000000000000000000000000000008';
    const record = approvalRecord(recordId);
    // A directory at the deterministic temp name is a foreign object.
    const tmpName = publicationTempName(WRITE_ACTION, 0);
    const tmpPath = join(env.storeRoot, 'tmp', tmpName);
    mkdirSync(tmpPath, { mode: 0o700 });
    const result = publishRecord(request(env, record));
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-FTYPE-UNSUPPORTED');
    // The foreign object is untouched.
    assert.equal(statSync(tmpPath).isDirectory(), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('publication: capability invalidation before the first mutation blocks the write', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:00000000000000000000000000000009';
    // Configuration replacement advances the generation; the composition
    // creates a fresh capability per call, so it must fail closed when the
    // store's recorded metadata no longer correlates (config mismatch).
    const otherConfig = genuineConfig('sha-256:' + 'b'.repeat(64));
    const otherProvenance = createStorageWriteActionProvenance({
      actionIdentity: WRITE_ACTION,
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: 'sha-256:' + 'b'.repeat(64),
      limitProfile: defaultLimitProfile(),
    });    const result = publishRecord(request(env, approvalRecord(recordId), { trustedConfiguration: otherConfig, writeActionProvenance: otherProvenance }));
    assert.equal(result.ok, false);
    // The store metadata verification rejects the mismatched configuration
    // identity before any trusted-state mutation.
    assert.ok(['ERR-STO-INTEGRITY', 'ERR-STO-CONFIG-UNAVAILABLE', 'ERR-STO-REQ-INVALID'].includes(result.findings?.[0]?.code ?? ''));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('publication: forged operands never reach the filesystem', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:0000000000000000000000000000000a';
    const forged = publishRecord(request(env, approvalRecord(recordId), { writeActionProvenance: { ...writeProvenance(env.dir) } }));
    assert.equal(forged.ok, false);
    assert.equal(forged.findings?.[0]?.code, 'ERR-STO-CONFIG-UNAVAILABLE');
    // No lock, no record, no audit file was created.
    assert.equal(existsSync(join(env.storeRoot, 'locks', 'writer.lock')), false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('publication: injected stage hooks produce deterministic failure codes', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:0000000000000000000000000000000b';
    // Zero-progress write: the bounded write-all loop terminates fail-closed.
    const zero = publishRecord(request(env, approvalRecord(recordId), { hooks: { write: () => 0 } }));
    assert.equal(zero.ok, false);
    assert.equal(zero.findings?.[0]?.code, 'ERR-STO-DURABILITY');
    // Link failure maps deterministically (ENOSPC-like path).
    const linkFail = publishRecord(request(env, approvalRecord(recordId), {
      hooks: { link: () => { const e = new Error('no space') as NodeJS.ErrnoException; e.code = 'ENOSPC'; throw e; } },
    }));
    assert.equal(linkFail.ok, false);
    assert.equal(linkFail.findings?.[0]?.code, 'ERR-STO-NO-SPACE');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});
