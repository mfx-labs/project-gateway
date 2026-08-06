/**
 * WP-8-C initialization capability authenticity tests (ADR-028 C;
 * W8C-D03/D11; CAP-001…007/010…016 for the initialization kind).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createTrustedStorageBootstrapInput } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { createInitializationCapability, isGenuineInitializationCapability } from '../../../src/storage/capabilities/authenticity.js';
import { defaultLimitProfile } from '../../../src/storage/limits/limits.js';
import type { RootIdentity } from '../../../src/storage/types.js';

const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const UID = process.getuid?.() ?? 0;

function genuineConfig(identity: string = CONFIG_IDENTITY): object {
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

function makeParent(): { readonly dir: string; readonly identity: RootIdentity } {
  const dir = mkdtempSync(join(tmpdir(), 'wp8c-cap-'));
  chmodSync(dir, 0o700);
  const stat = statSync(dir);
  return { dir, identity: { canonicalPath: dir, dev: Number(stat.dev), ino: Number(stat.ino), fileType: 'directory' } };
}

function makeInput(config: object = genuineConfig(), actionIdentity = 'action-1'): NonNullable<ReturnType<typeof createTrustedStorageBootstrapInput>['input']> {
  const identity = (config as { identity: string }).identity;
  const p = createStorageBootstrapActionProvenance({
    actionIdentity,
    locator: '/trusted/parent',
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: identity,
    limitProfile: defaultLimitProfile(),
  });
  const result = createTrustedStorageBootstrapInput(config, p, { locator: '/trusted/parent', serviceUid: UID, forbiddenRoots: [], limitProfile: defaultLimitProfile() });
  assert.equal(result.ok, true);
  return result.input!;
}

test('capabilities: creator requires a genuine branded trusted input', () => {
  const parent = makeParent();
  const input = makeInput();
  const capability = createInitializationCapability({ trustedInput: input, parentIdentity: parent.identity });
  assert.ok(capability !== undefined);
  assert.equal(isGenuineInitializationCapability(capability), true);
  // Forged input operand: no capability is issued.
  const forged = { ...input };
  assert.equal(createInitializationCapability({ trustedInput: forged, parentIdentity: parent.identity }), undefined);
  rmSync(parent.dir, { recursive: true, force: true });
});

test('capabilities: verify/dispose/operation-set semantics', () => {
  const parent = makeParent();
  const capability = createInitializationCapability({ trustedInput: makeInput(), parentIdentity: parent.identity })!;
  assert.deepEqual(capability.verify('namespace-initialize'), { ok: true });
  // Wrong operation set is rejected.
  assert.equal(capability.verify('namespace-initialize' as never) !== undefined, true);
  const wrong = capability.verify('write' as never);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, 'wrong-operation');
  // Disposal kills every later use.
  capability.dispose();
  const after = capability.verify('namespace-initialize');
  assert.equal(after.ok, false);
  assert.equal(after.reason, 'disposed');
  rmSync(parent.dir, { recursive: true, force: true });
});

test('capabilities: stale generation after configuration replacement', () => {
  const parent = makeParent();
  const first = createInitializationCapability({ trustedInput: makeInput(), parentIdentity: parent.identity })!;
  assert.equal(first.verify('namespace-initialize').ok, true);
  // A new initialization with a different trusted configuration advances the
  // generation for the store identity; the old capability goes stale.
  const secondInput = makeInput(genuineConfig('sha-256:' + 'b'.repeat(64)));
  const second = createInitializationCapability({ trustedInput: secondInput, parentIdentity: parent.identity })!;
  assert.equal(second.verify('namespace-initialize').ok, true);
  const stale = first.verify('namespace-initialize');
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-generation');
  rmSync(parent.dir, { recursive: true, force: true });
});

test('capabilities: wrong-binding rejection', () => {
  const parent = makeParent();
  const otherParent = makeParent();
  const input = makeInput();
  const capability = createInitializationCapability({ trustedInput: input, parentIdentity: parent.identity })!;
  const expected = {
    parentIdentity: parent.identity,
    configurationIdentity: CONFIG_IDENTITY,
    serviceUid: UID,
    limitProfile: defaultLimitProfile(),
  };
  assert.deepEqual(capability.assertExpected(expected), { ok: true });
  assert.equal(capability.assertExpected({ ...expected, parentIdentity: otherParent.identity }).ok, false);
  assert.equal(capability.assertExpected({ ...expected, configurationIdentity: 'sha-256:' + 'f'.repeat(64) }).ok, false);
  assert.equal(capability.assertExpected({ ...expected, serviceUid: UID + 1 }).ok, false);
  assert.equal(capability.assertExpected({ ...expected, limitProfile: {} }).ok, false);
  rmSync(parent.dir, { recursive: true, force: true });
  rmSync(otherParent.dir, { recursive: true, force: true });
});

test('capabilities: serialization, clone, spread, proxy and structural forgery fail', () => {
  const parent = makeParent();
  const capability = createInitializationCapability({ trustedInput: makeInput(), parentIdentity: parent.identity })!;
  const json = JSON.parse(JSON.stringify(capability));
  assert.equal(isGenuineInitializationCapability(json), false, 'JSON round trip must not be genuine');
  // structuredClone of a brand-bearing object with methods is not transferable
  // (DataCloneError) and, if it were, would lose the private brand.
  let clone: unknown = null;
  try {
    clone = structuredClone(capability);
  } catch {
    clone = null;
  }
  assert.equal(clone === null || !isGenuineInitializationCapability(clone), true, 'structured clone must not be genuine');
  assert.equal(isGenuineInitializationCapability({ ...capability }), false, 'spread copy must not be genuine');
  assert.equal(isGenuineInitializationCapability(new Proxy(capability, {})), false, 'proxy wrapper must not be genuine');
  assert.equal(isGenuineInitializationCapability(Object.create(capability)), false, 'prototype imitation must not be genuine');
  // A captured method reference without the brand context fails on use.
  const captured = capability.verify;
  const result = captured.call({}, 'namespace-initialize');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-genuine');
  rmSync(parent.dir, { recursive: true, force: true });
});

test('capabilities: binding contains only pre-initialization facts', () => {
  const parent = makeParent();
  const input = makeInput();
  const capability = createInitializationCapability({ trustedInput: input, parentIdentity: parent.identity })!;
  assert.equal(capability.binding.parentIdentity.ino, parent.identity.ino);
  assert.equal(capability.binding.configurationIdentity, CONFIG_IDENTITY);
  assert.equal(capability.binding.actionIdentity, 'action-1');
  assert.deepEqual(capability.binding.namespaceDerivations, { configNamespace: 'config-v1', storeNamespace: 'store-v1' });
  assert.deepEqual(capability.binding.operationSet, ['namespace-initialize']);
  // No namespace identity or metadata digest exists in the binding.
  assert.equal('namespaceIdentities' in capability.binding, false);
  assert.equal('metadataDigests' in capability.binding, false);
  rmSync(parent.dir, { recursive: true, force: true });
});
