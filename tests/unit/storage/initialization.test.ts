/**
 * WP-8-C initialization orchestrator integration tests (ADR-028 C/F;
 * state machine and partial-state rules; W8C-D04/D05).
 *
 * All fixtures are test-created temporary directories; no real host store is
 * ever initialized. The complete flow is exercised through test-only
 * action-provenance producers; production initialization remains unreachable
 * (no production importer of the action-provenance creator exists).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, statSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, chownSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { classifyNamespaceOpenError } from '../../../src/storage/initialization/provision.js';
import { defaultLimitProfile } from '../../../src/storage/limits/limits.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);

function genuineConfig(identity: string = CONFIG_IDENTITY): object {
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

function makeEnv(): { readonly dir: string; readonly forbidden: readonly string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'wp8c-init-'));
  chmodSync(dir, 0o700);
  return { dir, forbidden: [] };
}

function request(dir: string, forbiddenRoots: readonly string[] = [], config: object = genuineConfig(), actionIdentity = 'init-action-1', locator = dir) {
  return {
    trustedConfiguration: config,
    actionProvenance: createStorageBootstrapActionProvenance({
      actionIdentity,
      locator,
      serviceUid: UID,
      forbiddenRoots,
      configurationIdentity: CONFIG_IDENTITY,
      limitProfile: defaultLimitProfile(),
    }),
    locator,
    serviceUid: UID,
    forbiddenRoots,
    limitProfile: defaultLimitProfile(),
  };
}

test('initialization: fully absent aggregate initializes successfully', () => {
  const env = makeEnv();
  const result = initializeTrustedStore(request(env.dir));
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.equal(result.state, 'INITIALIZED');
  assert.equal(result.namespaceIdentities?.length, 2);
  assert.equal(result.metadataDigests?.length, 2);
  assert.equal(result.metadataDigests?.[0]?.recordByteDigest.startsWith('sha-256:'), true);
  // Fixed layout exists with the exact entry set.
  for (const ns of ['config-v1', 'store-v1']) {
    const entries = readdirSync(join(env.dir, ns)).sort();
    assert.deepEqual(entries, ['metadata', 'tmp']);
    const nsStat = statSync(join(env.dir, ns));
    assert.equal(Number(nsStat.mode) & 0o777, 0o700);
    const metaStat = statSync(join(env.dir, ns, 'metadata', 'metadata.json'));
    assert.equal(Number(metaStat.mode) & 0o777, 0o600);
    assert.equal(metaStat.isFile(), true);
  }
  // Metadata parses as canonical JSON.
  const meta = JSON.parse(readFileSync(join(env.dir, 'config-v1', 'metadata', 'metadata.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(meta['recordKind'], 'store-metadata');
  assert.equal(meta['formatVersion'], '1.0');
  rmSync(env.dir, { recursive: true, force: true });
});

test('initialization: exact replay is verification-only', () => {
  const env = makeEnv();
  const first = initializeTrustedStore(request(env.dir));
  assert.equal(first.ok, true);
  const before = statSync(join(env.dir, 'config-v1', 'metadata', 'metadata.json'));
  const second = initializeTrustedStore(request(env.dir));
  assert.equal(second.ok, true);
  assert.equal(second.state, 'INITIALIZED');
  assert.deepEqual(second.metadataDigests, first.metadataDigests);
  const after = statSync(join(env.dir, 'config-v1', 'metadata', 'metadata.json'));
  assert.equal(after.mtimeMs, before.mtimeMs, 'verification-only replay must not rewrite metadata');
  rmSync(env.dir, { recursive: true, force: true });
});

test('initialization: partial aggregate (one namespace removed) fails closed', () => {
  const env = makeEnv();
  assert.equal(initializeTrustedStore(request(env.dir)).ok, true);
  // Remove one namespace entirely: one INITIALIZED + one ABSENT = PARTIAL.
  rmSync(join(env.dir, 'store-v1'), { recursive: true, force: true });
  const result = initializeTrustedStore(request(env.dir));
  assert.equal(result.ok, false);
  assert.equal(result.findings?.[0]?.code, 'ERR-STO-RECOVERY-REQUIRED');
  rmSync(env.dir, { recursive: true, force: true });
});

test('initialization: foreign metadata fails closed without repair', () => {
  const env = makeEnv();
  assert.equal(initializeTrustedStore(request(env.dir)).ok, true);
  writeFileSync(join(env.dir, 'config-v1', 'metadata', 'metadata.json'), '{"recordKind":"store-metadata","formatVersion":"1.0","payload":{},"payloadDigest":"sha-256:' + 'b'.repeat(64) + '"}');
  const result = initializeTrustedStore(request(env.dir));
  assert.equal(result.ok, false);
  // No repair: the tampered file remains untouched.
  assert.equal(readFileSync(join(env.dir, 'config-v1', 'metadata', 'metadata.json'), 'utf8').startsWith('{"recordKind"'), true);
  rmSync(env.dir, { recursive: true, force: true });
});

test('initialization: unknown entries fail closed', () => {
  const env = makeEnv();
  assert.equal(initializeTrustedStore(request(env.dir)).ok, true);
  mkdirSync(join(env.dir, 'store-v1', 'records'), { mode: 0o700 });
  const result = initializeTrustedStore(request(env.dir));
  assert.equal(result.ok, false);
  assert.equal(result.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  rmSync(env.dir, { recursive: true, force: true });
});

test('initialization: non-genuine or mismatched operands fail closed', () => {
  const env = makeEnv();
  const forged = request(env.dir);
  forged.actionProvenance = { ...forged.actionProvenance };
  const a = initializeTrustedStore(forged);
  assert.equal(a.ok, false);
  assert.equal(a.findings?.[0]?.code, 'ERR-STO-CONFIG-UNAVAILABLE');
  // Locator mismatch: the provenance binds one locator, the request supplies another.
  const prov = createStorageBootstrapActionProvenance({
    actionIdentity: 'init-action-1',
    locator: join(env.dir, 'other'),
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
  });
  const b = initializeTrustedStore({
    trustedConfiguration: genuineConfig(),
    actionProvenance: prov,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
  });
  assert.equal(b.ok, false);
  assert.equal(b.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
  rmSync(env.dir, { recursive: true, force: true });
});

test('initialization: forbidden-root overlap fails closed', () => {
  const env = makeEnv();
  const result = initializeTrustedStore(request(env.dir, [env.dir]));
  assert.equal(result.ok, false);
  assert.equal(result.findings?.[0]?.code, 'ERR-STO-ROOT-INVALID');
  rmSync(env.dir, { recursive: true, force: true });
});

test('initialization: parent mode drift fails closed', () => {
  const env = makeEnv();
  assert.equal(initializeTrustedStore(request(env.dir)).ok, true);
  chmodSync(env.dir, 0o755);
  const result = initializeTrustedStore(request(env.dir));
  assert.equal(result.ok, false);
  assert.equal(result.findings?.[0]?.code, 'ERR-STO-PERM-DENIED');
  chmodSync(env.dir, 0o700);
  rmSync(env.dir, { recursive: true, force: true });
});

test('initialization: failure disposes the capability (no second use)', () => {
  const env = makeEnv();
  // First failure consumes the action; a second attempt with a NEW genuine
  // action succeeds, proving one-shot semantics are per-action.
  const forged = request(env.dir);
  forged.actionProvenance = { ...forged.actionProvenance };
  assert.equal(initializeTrustedStore(forged).ok, false);
  const retry = initializeTrustedStore(request(env.dir, [], genuineConfig(), 'init-action-2'));
  assert.equal(retry.ok, true);
  rmSync(env.dir, { recursive: true, force: true });
});

test('initialization: verification-only path rejects wrong-mode namespace directory (W8C-S03)', () => {
  const env = makeEnv();
  assert.equal(initializeTrustedStore(request(env.dir)).ok, true);
  chmodSync(join(env.dir, 'config-v1'), 0o755);
  const result = initializeTrustedStore(request(env.dir));
  assert.equal(result.ok, false, JSON.stringify(result.findings));
  assert.equal(result.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  // No silent repair: the wrong mode is untouched.
  assert.equal(Number(statSync(join(env.dir, 'config-v1')).mode) & 0o777, 0o755);
  chmodSync(join(env.dir, 'config-v1'), 0o700);
  rmSync(env.dir, { recursive: true, force: true });
});

test('initialization: verification-only path rejects wrong-UID namespace directory (W8C-S03)', (t) => {
  const env = makeEnv();
  assert.equal(initializeTrustedStore(request(env.dir)).ok, true);
  try {
    chownSync(join(env.dir, 'config-v1'), 12345, 12345);
  } catch {
    t.skip('chown requires privileges; wrong-UID coverage is provided by the synthetic stat-policy tests');
    rmSync(env.dir, { recursive: true, force: true });
    return;
  }
  const result = initializeTrustedStore(request(env.dir));
  assert.equal(result.ok, false);
  assert.equal(result.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  rmSync(env.dir, { recursive: true, force: true });
});

test('initialization: verification-only path rejects wrong-type and drifted namespace roots (W8C-S03)', () => {
  const env = makeEnv();
  assert.equal(initializeTrustedStore(request(env.dir)).ok, true);
  // Wrong type: replace the namespace root with a regular file.
  rmSync(join(env.dir, 'config-v1'), { recursive: true, force: true });
  writeFileSync(join(env.dir, 'config-v1'), 'not a directory');
  const wrongType = initializeTrustedStore(request(env.dir));
  assert.equal(wrongType.ok, false);
  assert.equal(wrongType.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  // Identity drift: replace the namespace root with a fresh directory (new inode).
  // The fresh empty root classifies PROVISIONAL; one INITIALIZED + one
  // PROVISIONAL namespace is PARTIAL — fail closed, never initialized success.
  rmSync(join(env.dir, 'config-v1'), { recursive: true, force: true });
  mkdirSync(join(env.dir, 'config-v1'), { mode: 0o700 });
  const drifted = initializeTrustedStore(request(env.dir));
  assert.equal(drifted.ok, false);
  assert.equal(drifted.findings?.[0]?.code, 'ERR-STO-RECOVERY-REQUIRED');
  rmSync(env.dir, { recursive: true, force: true });
});

test('initialization: non-ENOENT namespace open failures fail closed without provisioning (W8C-S03)', () => {
  // A regular file at the namespace root: ENOTDIR must classify FOREIGN, not
  // ABSENT, so no provisioning mutation occurs on the sibling namespace.
  const fileEnv = makeEnv();
  writeFileSync(join(fileEnv.dir, 'config-v1'), 'not a directory');
  const fileResult = initializeTrustedStore(request(fileEnv.dir));
  assert.equal(fileResult.ok, false);
  assert.equal(fileResult.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  // store-v1 must NOT have been created: classification failure precedes mutation.
  let storeCreated = false;
  try {
    statSync(join(fileEnv.dir, 'store-v1'));
    storeCreated = true;
  } catch {
    storeCreated = false;
  }
  assert.equal(storeCreated, false, 'no provisioning mutation may occur after a non-ENOENT classification failure');
  rmSync(fileEnv.dir, { recursive: true, force: true });
  // A symlink at the namespace root: ELOOP must classify FOREIGN.
  const linkEnv = makeEnv();
  symlinkSync(join(linkEnv.dir, 'target'), join(linkEnv.dir, 'config-v1'));
  const linkResult = initializeTrustedStore(request(linkEnv.dir));
  assert.equal(linkResult.ok, false);
  assert.equal(linkResult.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  rmSync(linkEnv.dir, { recursive: true, force: true });
});

test('initialization: namespace open-error classification is deterministic (W8C-S03)', () => {
  assert.equal(classifyNamespaceOpenError('ENOENT'), 'absent');
  for (const code of ['ENOTDIR', 'ELOOP', 'EACCES', 'EPERM', 'ENAMETOOLONG', 'EINVAL']) {
    assert.equal(classifyNamespaceOpenError(code), 'foreign', code);
  }
  assert.equal(classifyNamespaceOpenError(undefined), 'drifted');
  assert.equal(classifyNamespaceOpenError('EIO'), 'drifted');
  assert.equal(classifyNamespaceOpenError('EOTHER'), 'drifted');
});
