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
import { createStorageBootstrapActionProvenance, createTrustedStorageBootstrapInput } from '../../../src/storage/trusted-input/bootstrap-input.js';
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
  // A truly unknown entry (not a phase-3 member) fails closed; the phase-3
  // classifier policy (D-7) accepts records/audit/locks as fixed entries.
  mkdirSync(join(env.dir, 'store-v1', 'evil'), { mode: 0o700 });
  const result = initializeTrustedStore(request(env.dir));
  assert.equal(result.ok, false);
  assert.equal(result.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  // A deferred phase-4 entry (index) also fails closed (D-7 state D).
  const env2 = makeEnv();
  assert.equal(initializeTrustedStore(request(env2.dir)).ok, true);
  mkdirSync(join(env2.dir, 'store-v1', 'index'), { mode: 0o700 });
  const result2 = initializeTrustedStore(request(env2.dir));
  assert.equal(result2.ok, false);
  rmSync(env.dir, { recursive: true, force: true });
  rmSync(env2.dir, { recursive: true, force: true });
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

// ─── WP-8-D: phase-3 classifier policy (ADR-029 D-7/M-2) ───────────────────

import { classifyNamespace, NAMESPACE_CLASSIFIER_ENTRIES } from '../../../src/storage/initialization/provision.js';
import { createInitializationCapability } from '../../../src/storage/capabilities/authenticity.js';
import type { RootIdentity } from '../../../src/storage/types.js';

function classifierEnv() {
  const env = makeEnv();
  const input = (() => {
    const r = createTrustedStorageBootstrapInput(genuineConfig(), createStorageBootstrapActionProvenance({
      actionIdentity: 'classify-action',
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: CONFIG_IDENTITY,
      limitProfile: defaultLimitProfile(),
    }), { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: defaultLimitProfile() });
    assert.equal(r.ok, true);
    return r.input!;
  })();
  const stat = statSync(env.dir);
  const parent: RootIdentity = { canonicalPath: env.dir, dev: Number(stat.dev), ino: Number(stat.ino), fileType: 'directory' };
  const capability = createInitializationCapability({ trustedInput: input, parentIdentity: parent })!;
  const nsRoot = join(env.dir, 'store-v1');
  const seed = (entries: readonly string[]): void => {
    mkdirSync(nsRoot, { recursive: true, mode: 0o700 });
    for (const e of entries) {
      try {
        mkdirSync(join(nsRoot, e), { mode: 0o700 });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
    }
  };
  return { env, capability, parent, nsRoot, seed, cleanup: () => rmSync(env.dir, { recursive: true, force: true }) };
}

test('classifier: phase-2 initialized store is upgradeable, never foreign (state A)', () => {
  const c = classifierEnv();
  try {
    c.seed(['metadata', 'tmp']);
    const ns = classifyNamespace(c.capability, c.parent, 'store-records', UID, true);
    assert.equal(ns.state, 'PROVISIONAL');
    assert.equal(ns.phase3UpgradeRequired, true);
    assert.equal(ns.unknownEntries, false);
  } finally {
    c.cleanup();
  }
});

test('classifier: upgrade in progress and incomplete phase-3 sets are PROVISIONAL regardless of the metadata flag (states B/C)', () => {
  const c = classifierEnv();
  try {
    // B: allowed subset without the metadata dir yet.
    c.seed(['tmp', 'records']);
    const b = classifyNamespace(c.capability, c.parent, 'store-records', UID, false);
    assert.equal(b.state, 'PROVISIONAL');
    assert.equal(b.unknownEntries, false);
    // C: metadata + tmp + a proper subset of records/audit/locks, with
    // verified metadata: still PROVISIONAL (never FOREIGN).
    c.seed(['metadata', 'tmp', 'records', 'audit']);
    const cState = classifyNamespace(c.capability, c.parent, 'store-records', UID, true);
    assert.equal(cState.state, 'PROVISIONAL');
    assert.equal(cState.phase3UpgradeRequired, undefined);
    assert.equal(cState.unknownEntries, false);
  } finally {
    c.cleanup();
  }
});

test('classifier: foreign and deferred entries fail closed (state D)', () => {
  const c = classifierEnv();
  try {
    // Deferred phase-4 entry present.
    c.seed(['metadata', 'tmp', 'records', 'audit', 'locks', 'index']);
    const d = classifyNamespace(c.capability, c.parent, 'store-records', UID, true);
    assert.equal(d.state, 'FOREIGN');
    assert.equal(d.unknownEntries, true);
    // Arbitrary unknown entry.
    c.seed(['metadata', 'tmp', 'records', 'audit', 'locks', 'quarantine']);
    assert.equal(classifyNamespace(c.capability, c.parent, 'store-records', UID, true).state, 'FOREIGN');
    c.seed(['metadata', 'tmp', 'evil']);
    assert.equal(classifyNamespace(c.capability, c.parent, 'store-records', UID, true).state, 'FOREIGN');
  } finally {
    c.cleanup();
  }
});

test('classifier: exact verified phase-3 set is INITIALIZED (state E); partial set after crash stays PROVISIONAL', () => {
  const c = classifierEnv();
  try {
    c.seed(['metadata', 'tmp', 'records', 'audit', 'locks']);
    const e = classifyNamespace(c.capability, c.parent, 'store-records', UID, true);
    assert.equal(e.state, 'INITIALIZED');
    assert.equal(e.entries.length, 5);
  } finally {
    c.cleanup();
  }
  // Crash-partial set (some phase-3 dirs missing): PROVISIONAL, retryable,
  // deterministic retry path — never FOREIGN.
  const c2 = classifierEnv();
  try {
    c2.seed(['metadata', 'tmp', 'records']);
    const partial = classifyNamespace(c2.capability, c2.parent, 'store-records', UID, true);
    assert.equal(partial.state, 'PROVISIONAL');
    assert.equal(partial.unknownEntries, false);
  } finally {
    c2.cleanup();
  }
});

test('classifier: the phase-3 fixed entry set is committed policy, not caller input', () => {
  assert.deepEqual([...NAMESPACE_CLASSIFIER_ENTRIES], ['metadata', 'tmp', 'records', 'audit', 'locks']);
});


test('classifier state-D: a regular file at a fixed entry path fails closed (wrong type)', () => {
  const c = classifierEnv();
  try {
    c.seed(['metadata', 'tmp']);
    writeFileSync(join(c.nsRoot, 'records'), 'not a directory', { mode: 0o600 });
    const ns = classifyNamespace(c.capability, c.parent, 'store-records', UID, true);
    assert.equal(ns.state, 'FOREIGN');
    assert.equal(ns.unknownEntries, false, 'the entry NAME is known; the OBJECT is invalid');
  } finally {
    c.cleanup();
  }
});

test('classifier state-D: a symlink at a fixed entry path fails closed (no-follow)', () => {
  const c = classifierEnv();
  try {
    c.seed(['metadata', 'tmp', 'records', 'audit', 'locks']);
    const target = join(c.nsRoot, 'metadata');
    rmSync(join(c.nsRoot, 'tmp'), { recursive: true, force: true });
    symlinkSync(target, join(c.nsRoot, 'tmp'));
    const ns = classifyNamespace(c.capability, c.parent, 'store-records', UID, true);
    assert.equal(ns.state, 'FOREIGN');
  } finally {
    c.cleanup();
  }
});

test('classifier state-D: wrong mode at a fixed entry path fails closed', () => {
  const c = classifierEnv();
  try {
    c.seed(['metadata', 'tmp', 'records', 'audit', 'locks']);
    chmodSync(join(c.nsRoot, 'locks'), 0o644);
    const ns = classifyNamespace(c.capability, c.parent, 'store-records', UID, true);
    assert.equal(ns.state, 'FOREIGN');
    assert.equal(ns.unknownEntries, false);
  } finally {
    c.cleanup();
  }
});

test('classifier state-D: wrong UID at a fixed entry path fails closed (privilege-gated)', (t) => {
  const c = classifierEnv();
  try {
    c.seed(['metadata', 'tmp', 'records', 'audit', 'locks']);
    try {
      chownSync(join(c.nsRoot, 'audit'), 12345, 12345);
    } catch {
      // Deterministic synthetic coverage for wrong-UID policy lives in the
      // committed stat-policy tests (verifyDirectoryStat); the classifier
      // reuses that exact predicate, so this integration variant may skip
      // only when the environment lacks chown privileges.
      t.skip('chown requires privileges; wrong-UID coverage is provided by the synthetic stat-policy tests');
      return;
    }
    const ns = classifyNamespace(c.capability, c.parent, 'store-records', UID, true);
    assert.equal(ns.state, 'FOREIGN');
  } finally {
    c.cleanup();
  }
});
