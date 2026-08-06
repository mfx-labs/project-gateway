/**
 * WP-8-C filesystem compatibility probe tests (FSL-001…010; W8C-D08/D14).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, chmodSync, statSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createTrustedStorageBootstrapInput } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { createInitializationCapability, type InitializationCapability } from '../../../src/storage/capabilities/authenticity.js';
import { defaultLimitProfile } from '../../../src/storage/limits/limits.js';
import { runCompatibilityProbe, mapProbeError } from '../../../src/storage/probe/probe.js';
import { scratchName, newScratchOwnership } from '../../../src/storage/probe/scratch.js';
import type { RootIdentity } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const ACTION = 'probe-action';

function genuineConfig(): object {
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity: CONFIG_IDENTITY };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

function makeCapability(parent: RootIdentity): InitializationCapability {
  const p = createStorageBootstrapActionProvenance({ actionIdentity: ACTION, locator: parent.canonicalPath, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: defaultLimitProfile() });
  const result = createTrustedStorageBootstrapInput(genuineConfig(), p, { locator: parent.canonicalPath, serviceUid: UID, forbiddenRoots: [], limitProfile: defaultLimitProfile() });
  assert.equal(result.ok, true);
  const capability = createInitializationCapability({ trustedInput: result.input, parentIdentity: parent });
  assert.ok(capability !== undefined);
  return capability;
}

function makeTmpDirs(): { readonly dir: string; readonly configTmp: string; readonly storeTmp: string; readonly capability: InitializationCapability } {
  const dir = mkdtempSync(join(tmpdir(), 'wp8c-probe-'));
  chmodSync(dir, 0o700);
  const stat = statSync(dir);
  const parent: RootIdentity = { canonicalPath: dir, dev: Number(stat.dev), ino: Number(stat.ino), fileType: 'directory' };
  const configTmp = join(dir, 'config-v1', 'tmp');
  const storeTmp = join(dir, 'store-v1', 'tmp');
  mkdirSync(join(dir, 'config-v1'), { mode: 0o700 });
  mkdirSync(configTmp, { mode: 0o700 });
  mkdirSync(join(dir, 'store-v1'), { mode: 0o700 });
  mkdirSync(storeTmp, { mode: 0o700 });
  return { dir, configTmp, storeTmp, capability: makeCapability(parent) };
}

test('probe: error mapping is deterministic and inside the closed vocabulary', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['ENOSPC', 'ERR-STO-NO-SPACE'],
    ['EDQUOT', 'ERR-STO-QUOTA-EXCEEDED'],
    ['EROFS', 'ERR-STO-READONLY-FS'],
    ['EXDEV', 'ERR-STO-CROSS-DEVICE'],
    ['EINVAL', 'ERR-STO-FS-UNSUPPORTED'],
    ['EPERM', 'ERR-STO-PERM-DENIED'],
    ['EACCES', 'ERR-STO-PERM-DENIED'],
    ['UNKNOWN', 'ERR-STO-FS-UNSUPPORTED'],
  ];
  for (const [code, expected] of cases) {
    const err = Object.assign(new Error(code), { code });
    assert.equal(mapProbeError(err).code, expected, code);
  }
});

test('probe: scratch naming is deterministic and bounded (no randomness, clock, PID, env, cwd)', () => {
  assert.equal(scratchName(ACTION, 0), scratchName(ACTION, 0));
  assert.notEqual(scratchName(ACTION, 0), scratchName(ACTION, 1));
  assert.notEqual(scratchName('other-action', 0), scratchName(ACTION, 0));
  assert.throws(() => scratchName(ACTION, -1), RangeError);
  assert.throws(() => scratchName(ACTION, 0x10000), RangeError);
  assert.match(scratchName(ACTION, 0), /^probe-[0-9a-f]{16}-0$/);
});

test('probe: scratch no-overwrite and ownership cleanup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wp8c-scratch-'));
  const ownership = newScratchOwnership(dir);
  const first = ownership.create(ACTION, 0, 'file');
  assert.ok(first !== undefined, 'first creation succeeds');
  const second = ownership.create(ACTION, 0, 'file');
  assert.equal(second, undefined, 'EEXIST must fail closed: an action never claims an existing object');
  ownership.cleanup();
  assert.equal(readdirSync(dir).length, 0, 'cleanup removes only owned objects');
  rmSync(dir, { recursive: true, force: true });
});

test('probe: dead-action scratch is never adopted or deleted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wp8c-scratch-'));
  // Simulate a prior dead action's leftover at the SAME derived name.
  writeFileSync(join(dir, scratchName(ACTION, 5)), 'leftover', { mode: 0o600 });
  const live = newScratchOwnership(dir);
  const created = live.create(ACTION, 5, 'file');
  assert.equal(created, undefined, 'matching digest+ordinal must not claim a pre-existing object');
  live.cleanup();
  assert.equal(readdirSync(dir).length, 1, 'dead-action scratch remains untouched');
  assert.equal(readFileSync(join(dir, scratchName(ACTION, 5)), 'utf8'), 'leftover');
  rmSync(dir, { recursive: true, force: true });
});

test('probe: success path on the supported lane', () => {
  const env = makeTmpDirs();
  const result = runCompatibilityProbe(env.capability, ACTION, env.configTmp, env.storeTmp);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.profile?.sameDevice, true);
  assert.equal(result.profile?.hardLink, 'supported');
  assert.equal(result.profile?.directoryFsync, 'supported');
  assert.equal(result.profile?.regularFileFsync, 'supported');
  assert.equal(result.profile?.exclusiveCreation, 'supported');
  assert.equal(result.profile?.noFollow, 'supported');
  // No scratch litter remains.
  assert.equal(readdirSync(env.configTmp).length, 0);
  assert.equal(readdirSync(env.storeTmp).length, 0);
  rmSync(env.dir, { recursive: true, force: true });
});

test('probe: refused after capability disposal (fail closed)', () => {
  const env = makeTmpDirs();
  env.capability.dispose();
  const result = runCompatibilityProbe(env.capability, ACTION, env.configTmp, env.storeTmp);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ERR-STO-REQ-INVALID');
  rmSync(env.dir, { recursive: true, force: true });
});
