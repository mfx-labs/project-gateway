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
  assert.deepEqual(capability.binding.operationSet, ['namespace-initialize']); // M-1: least authority per issuance
  // No namespace identity or metadata digest exists in the binding.
  assert.equal('namespaceIdentities' in capability.binding, false);
  assert.equal('metadataDigests' in capability.binding, false);
  rmSync(parent.dir, { recursive: true, force: true });
});

// ─── WP-8-D: write/read/verify capabilities and provisioning issuer ───────

import {
  createWriteCapability,
  createReadCapability,
  createVerifyCapability,
  createProvisioningCapability,
  isGenuineWriteCapability,
  isGenuineReadCapability,
  isGenuineVerifyCapability,
  WRITE_OPERATION_SET,
  READ_OPERATION_SET,
  VERIFY_OPERATION_SET,
  type WriteCapability,
} from '../../../src/storage/capabilities/authenticity.js';
import {
  createStorageWriteActionProvenance,
  createTrustedWriteRequest,
  isGenuineStorageWriteActionProvenance,
  isGenuineTrustedWriteRequest,
} from '../../../src/storage/trusted-input/bootstrap-input.js';
import type { VerifiedStoreInstance } from '../../../src/storage/types.js';

const WRITE_ACTION = 'write-action-1';

function writeProvenance(actionIdentity = WRITE_ACTION) {
  return createStorageWriteActionProvenance({
    actionIdentity,
    locator: '/trusted/parent',
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
  });
}

function writeRequest(actionIdentity = WRITE_ACTION): NonNullable<ReturnType<typeof createTrustedWriteRequest>['request']> {
  const p = writeProvenance(actionIdentity);
  const result = createTrustedWriteRequest(genuineConfig(), p, { locator: '/trusted/parent', serviceUid: UID, forbiddenRoots: [], limitProfile: defaultLimitProfile() });
  assert.equal(result.ok, true);
  return result.request!;
}

function makeStoreInstance(overrides: Partial<VerifiedStoreInstance> = {}): VerifiedStoreInstance {
  const parent = makeParent();
  return {
    parentIdentity: parent.identity,
    namespaces: [
      { kind: 'configuration', canonicalPath: `${parent.identity.canonicalPath}/config-v1`, dev: parent.identity.dev, ino: parent.identity.ino + 1 },
      { kind: 'store-records', canonicalPath: `${parent.identity.canonicalPath}/store-v1`, dev: parent.identity.dev, ino: parent.identity.ino + 2 },
    ],
    configurationIdentity: CONFIG_IDENTITY,
    serviceUid: UID,
    limitProfile: defaultLimitProfile(),
    ...overrides,
  };
}

test('capabilities: write capability requires a genuine trusted write request and verified store instance', () => {
  const store = makeStoreInstance();
  const request = writeRequest();
  const capability = createWriteCapability({ trustedWriteRequest: request, storeInstance: store });
  assert.ok(capability !== undefined);
  assert.equal(isGenuineWriteCapability(capability), true);
  assert.deepEqual(capability!.binding.operationSet, [...WRITE_OPERATION_SET]);
  assert.equal(capability!.binding.actionIdentity, WRITE_ACTION);
  // Structural forgery of either operand fails.
  assert.equal(createWriteCapability({ trustedWriteRequest: { ...request }, storeInstance: store }), undefined);
  assert.equal(createWriteCapability({ trustedWriteRequest: request, storeInstance: { ...store, configurationIdentity: 'sha-256:' + 'b'.repeat(64) } }), undefined);
  // Cross-kind: a bootstrap input is never a write request.
  assert.equal(createWriteCapability({ trustedWriteRequest: makeInput(), storeInstance: store }), undefined);
  rmSync(store.parentIdentity.canonicalPath, { recursive: true, force: true });
});

test('capabilities: write capability verify/assertExpected/disposal semantics', () => {
  const store = makeStoreInstance();
  const capability = createWriteCapability({ trustedWriteRequest: writeRequest(), storeInstance: store })!;
  assert.deepEqual(capability.verify('record-publish'), { ok: true });
  assert.equal(capability.verify('read-record' as never).ok, false);
  const expected = {
    storeInstance: store,
    configurationIdentity: CONFIG_IDENTITY,
    serviceUid: UID,
    limitProfile: defaultLimitProfile(),
  };
  assert.deepEqual(capability.assertExpected(expected), { ok: true });
  assert.equal(capability.assertExpected({ ...expected, serviceUid: UID + 1 }).ok, false);
  assert.equal(capability.assertExpected({ ...expected, storeInstance: makeStoreInstance() }).ok, false);
  capability.dispose();
  assert.equal(capability.verify('record-publish').ok, false);
  assert.equal(capability.verify('record-publish').reason, 'disposed');
  rmSync(store.parentIdentity.canonicalPath, { recursive: true, force: true });
});

test('capabilities: write capability rejects forged, cloned, proxied and detached uses', () => {
  const store = makeStoreInstance();
  const capability = createWriteCapability({ trustedWriteRequest: writeRequest(), storeInstance: store })!;
  assert.equal(isGenuineWriteCapability(JSON.parse(JSON.stringify(capability))), false);
  assert.equal(isGenuineWriteCapability({ ...capability }), false);
  assert.equal(isGenuineWriteCapability(new Proxy(capability, {})), false);
  assert.equal(isGenuineWriteCapability(Object.create(capability)), false);
  const captured = capability.verify;
  assert.equal(captured.call({}, 'record-publish').ok, false);
  assert.equal(captured.call({}, 'record-publish').reason, 'not-genuine');
  rmSync(store.parentIdentity.canonicalPath, { recursive: true, force: true });
});

test('capabilities: write capability generation advances on configuration replacement', () => {
  const store = makeStoreInstance();
  const first = createWriteCapability({ trustedWriteRequest: writeRequest(), storeInstance: store })!;
  assert.equal(first.verify('record-publish').ok, true);
  const second = createWriteCapability({ trustedWriteRequest: writeRequest(), storeInstance: store })!;
  assert.equal(second.verify('record-publish').ok, true);
  // Configuration replacement (new identity) advances the generation.
  // Trusted-configuration replacement advances the generation for the same
  // store through a new initialization (the write creator itself correlates
  // the request with the store instance and can never mint a mismatched
  // capability).
  const inputB = makeInput(genuineConfig('sha-256:' + 'b'.repeat(64)));
  const reinit = createInitializationCapability({ trustedInput: inputB, parentIdentity: store.parentIdentity })!;
  assert.equal(reinit.verify('namespace-initialize').ok, true);
  assert.equal(first.verify('record-publish').ok, false);
  assert.equal(first.verify('record-publish').reason, 'stale-generation');
  assert.equal(second.verify('record-publish').ok, false);
  rmSync(store.parentIdentity.canonicalPath, { recursive: true, force: true });
});

test('capabilities: read and verify capabilities are distinct non-mutating domains', () => {
  const store = makeStoreInstance();
  const input = makeInput();
  // The real flow initializes the store first, recording the generation.
  const initCap = createInitializationCapability({ trustedInput: input, parentIdentity: store.parentIdentity })!;
  assert.equal(initCap.verify('namespace-initialize').ok, true);
  const read = createReadCapability({ trustedInput: input, storeInstance: store });
  const verify = createVerifyCapability({ trustedInput: input, storeInstance: store });
  assert.ok(read !== undefined && verify !== undefined);
  assert.equal(isGenuineReadCapability(read), true);
  assert.equal(isGenuineVerifyCapability(verify), true);
  assert.equal(isGenuineReadCapability(verify), false, 'cross-kind substitution must fail');
  assert.equal(isGenuineVerifyCapability(read), false, 'cross-kind substitution must fail');
  assert.deepEqual(read!.binding.operationSet, [...READ_OPERATION_SET]);
  assert.deepEqual(verify!.binding.operationSet, [...VERIFY_OPERATION_SET]);
  // Forged input fails both creators.
  assert.equal(createReadCapability({ trustedInput: { ...input }, storeInstance: store }), undefined);
  assert.equal(createVerifyCapability({ trustedInput: { ...input }, storeInstance: store }), undefined);
  read!.dispose();
  verify!.dispose();
  rmSync(store.parentIdentity.canonicalPath, { recursive: true, force: true });
});

test('capabilities: provisioning issuer shares the initialization domain (M-1)', () => {
  const store = makeStoreInstance();
  const input = makeInput();
  const provisioning = createProvisioningCapability({ trustedInput: input, storeInstance: store });
  assert.ok(provisioning !== undefined);
  // Same authenticity domain: the initialization-family verifier accepts it.
  assert.equal(isGenuineInitializationCapability(provisioning), true);
  assert.deepEqual(provisioning!.verify('provision-phase3'), { ok: true });
  assert.equal(provisioning!.verify('namespace-initialize').ok, false, 'provisioning capability is scoped to provision-phase3');
  // The initialization capability cannot provision phase-3.
  const initCap = createInitializationCapability({ trustedInput: input, parentIdentity: store.parentIdentity })!;
  assert.equal(initCap.verify('provision-phase3').ok, false, 'namespace-initialize capability must not carry provision-phase3');
  // Forged trusted input fails the issuer.
  assert.equal(createProvisioningCapability({ trustedInput: { ...input }, storeInstance: store }), undefined);
  provisioning!.dispose();
  rmSync(store.parentIdentity.canonicalPath, { recursive: true, force: true });
});

test('capabilities: read/verify creators bind the recorded generation and never mint one', () => {
  const store = makeStoreInstance();
  const input = makeInput();
  // The real flow initializes the store first (recording the generation);
  // reads bind it. A configuration replacement then invalidates the read
  // capability exactly like the initialization family (CAP-008/010).
  createInitializationCapability({ trustedInput: input, parentIdentity: store.parentIdentity })!;
  const read = createReadCapability({ trustedInput: input, storeInstance: store })!;
  assert.deepEqual(read.verify('read-record'), { ok: true });
  const inputB = makeInput(genuineConfig('sha-256:' + 'b'.repeat(64)));
  createInitializationCapability({ trustedInput: inputB, parentIdentity: store.parentIdentity })!;
  assert.equal(read.verify('read-record').ok, false);
  assert.equal(read.verify('read-record').reason, 'stale-generation');
  rmSync(store.parentIdentity.canonicalPath, { recursive: true, force: true });
});

test('capabilities: write capability type-level check', () => {
  const capability: WriteCapability | undefined = undefined;
  assert.equal(capability, undefined);
});
