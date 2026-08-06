/**
 * WP-8-C trusted bootstrap input and action provenance tests (ADR-028 B;
 * W8C-D01/D10/D12).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import {
  createStorageBootstrapActionProvenance,
  createTrustedStorageBootstrapInput,
  isGenuineStorageBootstrapActionProvenance,
  isGenuineTrustedStorageBootstrapInput,
} from '../../../src/storage/trusted-input/bootstrap-input.js';
import { defaultLimitProfile } from '../../../src/storage/limits/limits.js';

const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const LOCATOR = '/trusted/parent';
const UID = 1000;

function genuineConfig(identity: string = CONFIG_IDENTITY): object {
  const config = {
    configurationVersion: '1',
    capabilityVocabularyVersion: '1',
    hostLane: 'pi',
    provenance: { sourceKind: 'control-plane' },
    workspaces: [],
    identity,
  };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

function provenance(actionIdentity = 'action-1', overrides: Partial<Parameters<typeof createStorageBootstrapActionProvenance>[0]> = {}): ReturnType<typeof createStorageBootstrapActionProvenance> {
  return createStorageBootstrapActionProvenance({
    actionIdentity,
    locator: LOCATOR,
    serviceUid: UID,
    forbiddenRoots: ['/repo-a'],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
    ...overrides,
  });
}

test('trusted-input: action-provenance creator mints genuine immutable objects', () => {
  const p = provenance();
  assert.equal(isGenuineStorageBootstrapActionProvenance(p), true);
  assert.ok(Object.isFrozen(p));
  assert.ok(Object.isFrozen(p.forbiddenRoots));
  assert.ok(Object.isFrozen(p.limitProfile));
});

test('trusted-input: structural forgery of action provenance fails', () => {
  const p = provenance();
  const plain = { ...p };
  assert.equal(isGenuineStorageBootstrapActionProvenance(plain), false, 'spread copy must not be genuine');
  assert.equal(isGenuineStorageBootstrapActionProvenance(JSON.parse(JSON.stringify(p))), false, 'JSON round trip must not be genuine');
  assert.equal(isGenuineStorageBootstrapActionProvenance(structuredClone(p)), false, 'structured clone must not be genuine');
  const forged = Object.create(p);
  assert.equal(isGenuineStorageBootstrapActionProvenance(forged), false, 'prototype imitation must not be genuine');
  assert.equal(isGenuineStorageBootstrapActionProvenance(new Proxy(p, {})), false, 'proxy wrapper must not be genuine');
  assert.equal(isGenuineStorageBootstrapActionProvenance({ actionIdentity: 'action-1', locator: LOCATOR, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: defaultLimitProfile() }), false, 'plain object must not be genuine');
});

test('trusted-input: creator rejects malformed provenance fields', () => {
  assert.throws(() => provenance(''), /non-empty/);
  assert.throws(() => provenance('a', { locator: 'relative/path' }), /absolute/);
  assert.throws(() => provenance('a', { serviceUid: -1 }), /safe integer/);
  assert.throws(() => provenance('a', { configurationIdentity: 'not-a-digest' }), /sha-256/);
});

test('trusted-input: trusted-input creator requires both genuine operands', () => {
  const raw = { locator: LOCATOR, serviceUid: UID, forbiddenRoots: ['/repo-a'], limitProfile: defaultLimitProfile() };
  const config = genuineConfig();
  const p = provenance();
  assert.equal(createTrustedStorageBootstrapInput({ ...config, identity: 'sha-256:' + 'b'.repeat(64) }, p, raw).ok, false, 'forged config lookalike must fail');
  assert.equal(createTrustedStorageBootstrapInput(config, { ...p }, raw).ok, false, 'forged provenance lookalike must fail');
  const ok = createTrustedStorageBootstrapInput(config, p, raw);
  assert.equal(ok.ok, true);
  assert.equal(ok.input?.actionIdentity, 'action-1');
});

test('trusted-input: correlation mismatches fail closed', () => {
  const config = genuineConfig();
  const p = provenance();
  const raw = { locator: LOCATOR, serviceUid: UID, forbiddenRoots: ['/repo-a'], limitProfile: defaultLimitProfile() };
  assert.equal(createTrustedStorageBootstrapInput(config, p, { ...raw, locator: '/other' }).ok, false, 'locator mismatch');
  assert.equal(createTrustedStorageBootstrapInput(config, p, { ...raw, serviceUid: 2000 }).ok, false, 'service UID mismatch');
  assert.equal(createTrustedStorageBootstrapInput(config, p, { ...raw, forbiddenRoots: [] }).ok, false, 'forbidden-root set mismatch');
  assert.equal(createTrustedStorageBootstrapInput(config, p, { ...raw, limitProfile: {} }).ok, false, 'limit-profile mismatch');
  assert.equal(createTrustedStorageBootstrapInput(genuineConfig('sha-256:' + 'c'.repeat(64)), p, raw).ok, false, 'configuration identity mismatch');
});

test('trusted-input: action identity comes only from genuine action provenance', () => {
  // The genuine WP-6 configuration carries no storage action identity; the
  // input's action identity must equal the provenance's bound identity.
  const config = genuineConfig();
  const p = provenance('control-plane-action-77');
  const raw = { locator: LOCATOR, serviceUid: UID, forbiddenRoots: ['/repo-a'], limitProfile: defaultLimitProfile() };
  const result = createTrustedStorageBootstrapInput(config, p, raw);
  assert.equal(result.ok, true);
  assert.equal(result.input?.actionIdentity, 'control-plane-action-77');
});

test('trusted-input: genuine input is immutable and verifiable', () => {
  const raw = { locator: LOCATOR, serviceUid: UID, forbiddenRoots: ['/repo-a'], limitProfile: defaultLimitProfile() };
  const result = createTrustedStorageBootstrapInput(genuineConfig(), provenance(), raw);
  assert.equal(result.ok, true);
  const input = result.input!;
  assert.equal(isGenuineTrustedStorageBootstrapInput(input), true);
  assert.ok(Object.isFrozen(input));
  assert.equal(isGenuineTrustedStorageBootstrapInput(JSON.parse(JSON.stringify(input))), false);
  assert.equal(isGenuineTrustedStorageBootstrapInput(structuredClone(input)), false);
});

// ─── WP-8-D: write-action provenance and trusted write request (D-2/D-5) ──

import {
  createStorageWriteActionProvenance,
  createTrustedWriteRequest,
  isGenuineStorageWriteActionProvenance,
  isGenuineTrustedWriteRequest,
} from '../../../src/storage/trusted-input/bootstrap-input.js';

const WRITE_LOCATOR = '/trusted/parent';
const WRITE_ACTION = 'write-action-99';

function writeProvenance(actionIdentity = WRITE_ACTION, overrides: Partial<Record<string, unknown>> = {}) {
  return createStorageWriteActionProvenance({
    actionIdentity,
    locator: WRITE_LOCATOR,
    serviceUid: UID,
    forbiddenRoots: ['/repo-a'],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
    ...overrides,
  } as never);
}

test('trusted-input: write-action provenance creator validates and brands', () => {
  assert.throws(() => createStorageWriteActionProvenance({ ...writeProvenanceFields(), actionIdentity: '' } as never), TypeError);
  assert.throws(() => createStorageWriteActionProvenance({ ...writeProvenanceFields(), locator: 'relative' } as never), TypeError);
  assert.throws(() => createStorageWriteActionProvenance({ ...writeProvenanceFields(), configurationIdentity: 'not-a-digest' } as never), TypeError);
  const p = writeProvenance();
  assert.equal(isGenuineStorageWriteActionProvenance(p), true);
  assert.equal(isGenuineStorageWriteActionProvenance(JSON.parse(JSON.stringify(p))), false);
  assert.equal(isGenuineStorageWriteActionProvenance({ ...p }), false);
  assert.ok(Object.isFrozen(p));
  // Cross-domain: a bootstrap provenance is never a write provenance.
  assert.equal(isGenuineStorageWriteActionProvenance(provenance()), false);
});

function writeProvenanceFields() {
  return {
    actionIdentity: WRITE_ACTION,
    locator: WRITE_LOCATOR,
    serviceUid: UID,
    forbiddenRoots: ['/repo-a'],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
  };
}

test('trusted-input: trusted write request requires genuine config + genuine write provenance with exact correlation', () => {
  const config = genuineConfig();
  const p = writeProvenance();
  const raw = { locator: WRITE_LOCATOR, serviceUid: UID, forbiddenRoots: ['/repo-a'], limitProfile: defaultLimitProfile() };
  const ok = createTrustedWriteRequest(config, p, raw);
  assert.equal(ok.ok, true);
  assert.equal(ok.request?.actionIdentity, WRITE_ACTION);
  assert.equal(isGenuineTrustedWriteRequest(ok.request), true);
  // Forgery of either operand fails.
  assert.equal(createTrustedWriteRequest({ ...config, identity: 'sha-256:' + 'b'.repeat(64) }, p, raw).ok, false);
  assert.equal(createTrustedWriteRequest(config, { ...p }, raw).ok, false);
  // A bootstrap action provenance is never accepted as write provenance.
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: 'bootstrap-action',
    locator: WRITE_LOCATOR,
    serviceUid: UID,
    forbiddenRoots: ['/repo-a'],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
  });
  assert.equal(createTrustedWriteRequest(config, bootstrapProvenance, raw).ok, false, 'cross-domain provenance substitution must fail');
  // Correlation mismatches.
  assert.equal(createTrustedWriteRequest(config, p, { ...raw, locator: '/other' }).ok, false);
  assert.equal(createTrustedWriteRequest(config, p, { ...raw, serviceUid: 2000 }).ok, false);
  assert.equal(createTrustedWriteRequest(config, p, { ...raw, forbiddenRoots: [] }).ok, false);
  assert.equal(createTrustedWriteRequest(config, p, { ...raw, limitProfile: {} }).ok, false);
  assert.equal(createTrustedWriteRequest(genuineConfig('sha-256:' + 'c'.repeat(64)), p, raw).ok, false);
});

test('trusted-input: write request is immutable and verifiable', () => {
  const result = createTrustedWriteRequest(genuineConfig(), writeProvenance(), { locator: WRITE_LOCATOR, serviceUid: UID, forbiddenRoots: ['/repo-a'], limitProfile: defaultLimitProfile() });
  assert.equal(result.ok, true);
  const request = result.request!;
  assert.ok(Object.isFrozen(request));
  assert.equal(isGenuineTrustedWriteRequest(request), true);
  assert.equal(isGenuineTrustedWriteRequest(JSON.parse(JSON.stringify(request))), false);
  assert.equal(isGenuineTrustedWriteRequest(structuredClone(request)), false);
  // The write request and the bootstrap input are distinct domains.
  assert.equal(isGenuineTrustedWriteRequest(createTrustedStorageBootstrapInput(genuineConfig(), provenance(), { locator: LOCATOR, serviceUid: UID, forbiddenRoots: ['/repo-a'], limitProfile: defaultLimitProfile() }).input), false);
});
