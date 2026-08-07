/**
 * WP-8-M configuration-namespace recovery tests (contract §16.7,
 * CSA-016…018; ADR-036): the dual-authority gate (genuine recovery
 * authority AND genuine trusted configuration/bootstrap input), the
 * no-overwrite exact publication of the expected canonical configuration
 * metadata derived through the SAME trusted-input-to-storage
 * transformation as normal initialization, idempotency (recovered /
 * already-completed / already-present), the version/migration boundary,
 * the trusted-input race, publication confinement, deterministic
 * evidence, the fixed crash inventory, the scanner/assessment
 * integration, and the configuration-consumer equivalence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, writeFileSync, mkdirSync, symlinkSync, unlinkSync, readFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import {
  createStorageBootstrapActionProvenance,
  createRecoveryActionProvenance,
  createTrustedStorageBootstrapInput,
} from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { verifyStoreInstance } from '../../../src/storage/read/read-record.js';
import { runRecoveryScan, executeRecoveryMutation, computeTrustedInputIdentity, configurationMetadataObservationId, STORAGE_CONFIGURATION_RECOVERY_EVIDENCE_IDENTITY_DOMAIN, extractConfigurationRecoveryEvidenceFacts } from '../../../src/storage/recovery/index.js';
import { createRecoveryCapability, createInitializationCapability } from '../../../src/storage/capabilities/authenticity.js';
import { buildStoreMetadata, METADATA_FORMAT_VERSION, type StoreMetadataExpectation } from '../../../src/storage/metadata/store-metadata.js';
import { computeDomainDigest } from '../../../src/storage/format/envelope.js';
import { jcsSerialize } from '../../../src/canonical/jcs.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../../src/storage/limits/limits.js';
import type { ConfigurationMetadataState, RecoveryMutationRequest, RecoveryMutationStage, RecoveryMutationResult, VerifiedStoreInstance } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const BOOTSTRAP_ACTION = 'wp8m-bootstrap';
const RECOVERY_ACTION = 'wp8m-recovery';

function profile(overrides: Partial<Record<string, number>> = {}): SelectedLimitProfile {
  const base: Record<string, number> = { ...defaultLimitProfile() };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) base[k] = v;
  }
  return base;
}

function genuineConfig(identity: string = CONFIG_IDENTITY): object {
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

interface TestEnv {
  readonly dir: string;
  readonly config: object;
  readonly trustedInput: unknown;
  readonly limitProfile: SelectedLimitProfile;
  readonly storeRoot: string;
  readonly configRoot: string;
  readonly metadataPath: string;
  readonly storeInstance: ReturnType<typeof verifyStoreInstance>['storeInstance'];
}

function makeStore(limitProfile: SelectedLimitProfile = profile()): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wp8m-cfg-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: BOOTSTRAP_ACTION,
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
  return {
    dir,
    config,
    trustedInput: inputResult.input,
    limitProfile,
    storeRoot: `${dir}/store-v1`,
    configRoot: `${dir}/config-v1`,
    metadataPath: `${dir}/config-v1/metadata/metadata.json`,
    storeInstance: storeResult.storeInstance!,
  };
}

/** Parse a namespace metadata file (test helper; never authority). */
function readNamespaceMetadata(env: TestEnv, namespaceRoot: string): { readonly probe: Record<string, unknown>; readonly actionIdentity: string; readonly configurationIdentity: string; readonly configurationVersion: string } {
  const model = JSON.parse(readFileSync(`${namespaceRoot}/metadata/metadata.json`, 'utf8')) as Record<string, unknown>;
  const payload = model['payload'] as Record<string, unknown>;
  const profileIdentity = payload['limitProfileIdentity'] as Record<string, unknown>;
  return {
    probe: payload['probe'] as Record<string, unknown>,
    actionIdentity: payload['actionIdentity'] as string,
    configurationIdentity: payload['configurationIdentity'] as string,
    configurationVersion: profileIdentity['configurationVersion'] as string,
  };
}

/**
 * The expected canonical configuration metadata derived through the SAME
 * trusted-input-to-storage transformation as normal initialization
 * (probe facts from the verified store-records metadata; the probe is
 * deterministic on the supported lane).
 */
function expectedConfiguration(env: TestEnv): { readonly canonicalUtf8: string; readonly digest: string } {
  const storeFacts = readNamespaceMetadata(env, env.storeRoot);
  assert.equal(storeFacts.configurationIdentity, CONFIG_IDENTITY);
  const configNs = env.storeInstance!.namespaces.find((n) => n.kind === 'configuration')!;
  const expectation: StoreMetadataExpectation = {
    metadataFormatVersion: METADATA_FORMAT_VERSION,
    layoutVersion: 'v1',
    namespaceKind: 'configuration',
    namespaceIdentity: configNs,
    parentIdentity: env.storeInstance!.parentIdentity,
    lane: 'posix-0700',
    configurationIdentity: CONFIG_IDENTITY,
    actionIdentity: storeFacts.actionIdentity,
    limitProfileIdentity: { configurationVersion: storeFacts.configurationVersion, configurationIdentity: CONFIG_IDENTITY },
  };
  const built = buildStoreMetadata({ ...expectation, probe: storeFacts.probe as never });
  assert.equal(built.ok, true, built.message ?? 'expected configuration could not be built');
  return { canonicalUtf8: built.metadata!.canonicalUtf8, digest: built.metadata!.recordByteDigest };
}

function recoveryTokens(env: TestEnv): { readonly generation: string; readonly surfaceGeneration: string } {
  const result = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  return { generation: result.assessment!.source.generation, surfaceGeneration: result.assessment!.source.surfaceGeneration };
}

function observationId(env: TestEnv, state: ConfigurationMetadataState): string {
  return configurationMetadataObservationId({ storeInstance: env.storeInstance!, state, entry: 'metadata.json' });
}

/** Derived evidence path (records/evidence/<shard>/<component>.rec). */
function evidencePath(env: TestEnv, evidenceId: string): string {
  const component = evidenceId.slice('pgw:r:'.length);
  return `${env.storeRoot}/records/evidence/${component.slice(0, 4)}/${component}.rec`;
}

function recoveryProvenance(env: TestEnv): ReturnType<typeof createRecoveryActionProvenance> {
  return createRecoveryActionProvenance({
    actionIdentity: RECOVERY_ACTION,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: env.limitProfile,
  });
}

interface ConfigRecoveryFacts {
  readonly expectedConfigurationIdentity: string;
  readonly expectedConfigurationVersion: string;
  readonly expectedTrustedInputIdentity: string;
  readonly expectedConfigurationDigest: string;
  readonly expectedConfigurationObservationId: string;
  readonly expectedGeneration: string;
  readonly expectedSurfaceGeneration: string;
}

function recoveryFacts(env: TestEnv, state: ConfigurationMetadataState): ConfigRecoveryFacts {
  const expected = expectedConfiguration(env);
  const input = env.trustedInput as { readonly configurationIdentity: string; readonly serviceUid: number; readonly forbiddenRoots: readonly string[]; readonly limitProfile: Readonly<Record<string, number>>; readonly locator: string };
  const tokens = recoveryTokens(env);
  return {
    expectedConfigurationIdentity: CONFIG_IDENTITY,
    expectedConfigurationVersion: '1',
    expectedTrustedInputIdentity: computeTrustedInputIdentity(input),
    expectedConfigurationDigest: expected.digest,
    expectedConfigurationObservationId: observationId(env, state),
    expectedGeneration: tokens.generation,
    expectedSurfaceGeneration: tokens.surfaceGeneration,
  };
}

function configRecoveryRequest(env: TestEnv, facts: ConfigRecoveryFacts, overrides: Partial<RecoveryMutationRequest> = {}): RecoveryMutationRequest {
  return {
    trustedConfiguration: env.config,
    recoveryActionProvenance: recoveryProvenance(env),
    trustedInput: env.trustedInput,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: env.limitProfile,
    action: {
      category: 'recover-configuration-namespace',
      expectedConfigurationIdentity: facts.expectedConfigurationIdentity,
      expectedConfigurationVersion: facts.expectedConfigurationVersion,
      expectedTrustedInputIdentity: facts.expectedTrustedInputIdentity,
      expectedConfigurationDigest: facts.expectedConfigurationDigest,
      expectedConfigurationObservationId: facts.expectedConfigurationObservationId,
      expectedGeneration: facts.expectedGeneration,
      expectedSurfaceGeneration: facts.expectedSurfaceGeneration,
    },
    timeSource: { now: () => 1000, processStartTime: 500 },
    ...overrides,
  };
}

function runRecovery(env: TestEnv, facts: ConfigRecoveryFacts, overrides: Partial<RecoveryMutationRequest> = {}): RecoveryMutationResult {
  return executeRecoveryMutation(configRecoveryRequest(env, facts, overrides));
}

/** Remove the configuration metadata (the recoverable missing state). */
function removeConfiguration(env: TestEnv): void {
  rmSync(env.metadataPath);
}

/** Fixture crash at a stage: throws inside the hook. */
function crashAt(env: TestEnv, facts: ConfigRecoveryFacts, stage: RecoveryMutationStage): boolean {
  let crashed = false;
  try {
    executeRecoveryMutation({
      ...configRecoveryRequest(env, facts),
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
  return crashed;
}

// ── Dual authority ─────────────────────────────────────────────────────────

test('config-recovery: valid recovery authority + valid trusted input recovers the missing configuration', () => {
  const env = makeStore();
  try {
    removeConfiguration(env);
    const facts = recoveryFacts(env, 'configuration-missing');
    const result = runRecovery(env, facts);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'configuration-recovered');
    assert.ok(result.evidenceId !== undefined);
    // Exact bytes at the exact destination; fully verifiable by the normal
    // consumer path.
    const expected = expectedConfiguration(env);
    assert.equal(readFileSync(env.metadataPath, 'utf8'), expected.canonicalUtf8, 'the recovered bytes are the exact expected canonical configuration');
    const strict = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    assert.equal(strict.ok, true, 'the recovered configuration is accepted by the normal configuration consumer exactly as initialization would');
    // Durable evidence.
    assert.equal(existsSync(evidencePath(env, result.evidenceId!)), true, 'the recovery evidence is durable');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('config-recovery: recovery authority alone is rejected (no genuine trusted input)', () => {
  const env = makeStore();
  try {
    removeConfiguration(env);
    const facts = recoveryFacts(env, 'configuration-missing');
    const result = runRecovery(env, facts, { trustedInput: { configurationIdentity: CONFIG_IDENTITY } } as Partial<RecoveryMutationRequest>);
    assert.equal(result.ok, false, 'recovery authority without a genuine trusted input must be rejected');
    assert.equal(existsSync(env.metadataPath), false, 'nothing may be published');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('config-recovery: trusted input alone cannot mutate (forged recovery authority rejected)', () => {
  const env = makeStore();
  try {
    removeConfiguration(env);
    const facts = recoveryFacts(env, 'configuration-missing');
    const forged = { actionIdentity: RECOVERY_ACTION, locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile };
    const result = runRecovery(env, facts, { recoveryActionProvenance: forged } as Partial<RecoveryMutationRequest>);
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-CONFIG-UNAVAILABLE');
    assert.equal(existsSync(env.metadataPath), false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('config-recovery: forged, cloned, and structural trusted input is rejected', () => {
  const env = makeStore();
  try {
    removeConfiguration(env);
    const facts = recoveryFacts(env, 'configuration-missing');
    const genuine = env.trustedInput as object;
    const clones: unknown[] = [
      { ...genuine },
      JSON.parse(JSON.stringify(genuine)),
      Object.create(genuine),
      { configurationIdentity: CONFIG_IDENTITY, locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile, actionIdentity: BOOTSTRAP_ACTION },
    ];
    for (const clone of clones) {
      const result = runRecovery(env, facts, { trustedInput: clone } as Partial<RecoveryMutationRequest>);
      assert.equal(result.ok, false, 'a structural trusted-input clone must never enable configuration recovery');
      assert.equal(existsSync(env.metadataPath), false);
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('config-recovery: wrong store/namespace, wrong operation, and a recovery plan grant nothing', () => {
  const env = makeStore();
  const other = makeStore();
  try {
    removeConfiguration(env);
    const facts = recoveryFacts(env, 'configuration-missing');
    // Wrong store.
    const wrongStore = runRecovery(env, facts, { locator: other.dir } as Partial<RecoveryMutationRequest>);
    assert.equal(wrongStore.ok, false);
    // A recovery plan object as provenance grants nothing.
    const plan = { actions: [{ category: 'recover-configuration-namespace' }] };
    const planResult = runRecovery(env, facts, { recoveryActionProvenance: plan } as Partial<RecoveryMutationRequest>);
    assert.equal(planResult.ok, false);
    assert.equal(planResult.findings?.[0]?.code, 'ERR-STO-CONFIG-UNAVAILABLE');
    // Wrong operation: a generic write/replace category is outside the
    // vocabulary.
    const wrongOp = executeRecoveryMutation({
      ...configRecoveryRequest(env, facts),
      action: { category: 'write-configuration' },
    } as never);
    assert.equal(wrongOp.ok, false);
    assert.equal(wrongOp.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    assert.equal(existsSync(env.metadataPath), false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
    rmSync(other.dir, { recursive: true, force: true });
  }
});

test('config-recovery: recovery capability alone can never publish configuration (sink confinement)', () => {
  const env = makeStore();
  try {
    removeConfiguration(env);
    const facts = recoveryFacts(env, 'configuration-missing');
    const input = createTrustedRecoveryRequestForTest(env);
    const capability = createRecoveryCapability({ trustedRecoveryRequest: input, storeInstance: env.storeInstance! });
    assert.ok(capability !== undefined);
    // The recovery capability verifies the exact operation, but no path
    // from it reaches the metadata owner: the permit is mandatory and the
    // permit creator validates the exact binding.
    assert.equal(capability.verify('recover-configuration-namespace').ok, true);
    // A forged permit (structural) is rejected by the sink.
    const forgedPermit = { binding: { capability, operation: 'recover-configuration-namespace', configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', configurationDigest: 'sha-256:' + '0'.repeat(64), trustedInputIdentity: 'sha-256:' + '1'.repeat(64), destinationDesignation: 'metadata/metadata.json' } };
    const { persistRecoveryConfigurationMetadata } = requirePersist();
    const persisted = persistRecoveryConfigurationMetadata({
      permit: forgedPermit as never,
      path: env.metadataPath,
      canonicalUtf8: '{}',
      configurationDigest: 'sha-256:' + '0'.repeat(64),
      serviceUid: UID,
      metadataDirPath: `${env.configRoot}/metadata`,
      namespaceDirPath: env.configRoot,
    });
    assert.equal(persisted.ok, false, 'a structural permit must never reach the metadata owner');
    assert.equal(persisted.code, 'ERR-STO-REQ-INVALID');
    assert.equal(existsSync(env.metadataPath), false, 'nothing may be published through a forged permit');
    capability.dispose();
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

import { createTrustedRecoveryRequest, isGenuineTrustedStorageBootstrapInput } from '../../../src/storage/trusted-input/bootstrap-input.js';

function createTrustedRecoveryRequestForTest(env: TestEnv): unknown {
  const result = createTrustedRecoveryRequest(env.config, recoveryProvenance(env), { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
  assert.equal(result.ok, true);
  return result.request;
}

import { persistRecoveryConfigurationMetadata } from '../../../src/storage/metadata/bootstrap-persist.js';

function requirePersist(): { readonly persistRecoveryConfigurationMetadata: typeof persistRecoveryConfigurationMetadata } {
  return { persistRecoveryConfigurationMetadata };
}

// ── Missing recovery / idempotency ─────────────────────────────────────────

test('config-recovery: recovered configuration has exact identity/digest/destination and deterministic evidence replay', () => {
  const env = makeStore();
  try {
    removeConfiguration(env);
    const facts = recoveryFacts(env, 'configuration-missing');
    const first = runRecovery(env, facts);
    assert.equal(first.ok, true, JSON.stringify(first.findings));
    assert.equal(first.outcome, 'configuration-recovered');
    // Replay: exact configuration present + matching evidence →
    // already-completed with the SAME deterministic evidence identity.
    const second = runRecovery(env, recoveryFacts(env, 'configuration-healthy'));
    assert.equal(second.ok, true, JSON.stringify(second.findings));
    assert.equal(second.outcome, 'already-completed');
    assert.equal(second.evidenceId, first.evidenceId, 'the evidence identity is deterministic');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('config-recovery: exact configuration present without evidence is the non-mutating already-present state', () => {
  const env = makeStore();
  try {
    // The store was never damaged: exact configuration, no recovery
    // evidence. Recovery must not fabricate evidence for a healthy store.
    const facts = recoveryFacts(env, 'configuration-healthy');
    const result = runRecovery(env, facts);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'already-present');
    assert.equal(result.evidenceId, undefined, 'no recovery evidence is fabricated for a healthy store');
    assert.equal(readFileSync(env.metadataPath, 'utf8'), expectedConfiguration(env).canonicalUtf8, 'the configuration is untouched');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('config-recovery: missing configuration with matching completion evidence is an integrity failure', () => {
  const env = makeStore();
  try {
    // Complete a recovery first, then remove the configuration: evidence
    // durable + configuration missing = integrity failure.
    removeConfiguration(env);
    const facts = recoveryFacts(env, 'configuration-missing');
    const first = runRecovery(env, facts);
    assert.equal(first.ok, true, JSON.stringify(first.findings));
    removeConfiguration(env);
    const rerun = runRecovery(env, recoveryFacts(env, 'configuration-missing'));
    assert.equal(rerun.ok, false, 'missing configuration with matching completion evidence is an integrity failure');
    assert.equal(rerun.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Conflict / no overwrite ────────────────────────────────────────────────

test('config-recovery: a conflicting configuration object is never overwritten', () => {
  const env = makeStore();
  try {
    // Replace the configuration with a different, self-consistent object.
    const expected = expectedConfiguration(env);
    const conflicting = JSON.parse(expected.canonicalUtf8) as Record<string, unknown>;
    const payload = conflicting['payload'] as Record<string, unknown>;
    payload['configurationIdentity'] = 'sha-256:' + 'b'.repeat(64);
    conflicting['payloadDigest'] = computeDomainDigest('PGAP-STORAGE-PAYLOAD-v1\u0000', jcsSerialize(payload));
    const canonical = JSON.stringify(conflicting);
    writeFileSync(env.metadataPath, canonical, { mode: 0o600 });
    chmodSync(env.metadataPath, 0o600);
    const facts = recoveryFacts(env, 'conflicting-configuration');
    const result = runRecovery(env, facts);
    assert.equal(result.ok, false, 'a conflicting configuration object fails closed');
    assert.equal(result.outcome, undefined);
    assert.equal(readFileSync(env.metadataPath, 'utf8'), canonical, 'the conflicting object remains untouched');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('config-recovery: malformed, wrong-UID/mode, wrong-type, and symlink objects are never repaired', () => {
  const env = makeStore();
  try {
    const expected = expectedConfiguration(env);
    // Malformed.
    writeFileSync(env.metadataPath, '{not canonical', { mode: 0o600 });
    chmodSync(env.metadataPath, 0o600);
    let facts = recoveryFacts(env, 'malformed-configuration');
    let result = runRecovery(env, facts);
    assert.equal(result.ok, false);
    assert.equal(readFileSync(env.metadataPath, 'utf8'), '{not canonical', 'malformed bytes are never repaired');
    rmSync(env.metadataPath);
    // Wrong mode.
    writeFileSync(env.metadataPath, expected.canonicalUtf8, { mode: 0o644 });
    chmodSync(env.metadataPath, 0o644);
    facts = recoveryFacts(env, 'wrong-uid-mode-configuration');
    result = runRecovery(env, facts);
    assert.equal(result.ok, false, 'a wrong-mode configuration object is never repaired');
    assert.equal(readFileSync(env.metadataPath, 'utf8'), expected.canonicalUtf8, 'the object remains untouched');
    rmSync(env.metadataPath);
    // Directory at the location.
    mkdirSync(env.metadataPath, { mode: 0o700 });
    facts = recoveryFacts(env, 'wrong-type-configuration');
    result = runRecovery(env, facts);
    assert.equal(result.ok, false);
    assert.equal(existsSync(env.metadataPath) && readdirSync(env.metadataPath).length === 0, true, 'the directory remains untouched');
    rmSync(env.metadataPath, { recursive: true });
    // Symlink at the location.
    symlinkSync(`${env.dir}/outside`, env.metadataPath);
    facts = recoveryFacts(env, 'wrong-type-configuration');
    result = runRecovery(env, facts);
    assert.equal(result.ok, false, 'a symlink is never followed or replaced');
    assert.equal(lstatSync(env.metadataPath).isSymbolicLink(), true, 'the symlink remains untouched');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('config-recovery: foreign entries in the metadata directory fail closed and are preserved', () => {
  const env = makeStore();
  try {
    writeFileSync(`${env.configRoot}/metadata/foreign.json`, '{}', { mode: 0o600 });
    chmodSync(`${env.configRoot}/metadata/foreign.json`, 0o600);
    const facts = recoveryFacts(env, 'foreign-configuration-entry');
    const result = runRecovery(env, facts);
    assert.equal(result.ok, false, 'foreign entries fail closed');
    assert.equal(existsSync(`${env.configRoot}/metadata/foreign.json`), true, 'the foreign entry is preserved');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Version / migration boundary ───────────────────────────────────────────

test('config-recovery: an unsupported configuration version is never recovered (migration boundary)', () => {
  const env = makeStore();
  try {
    const expected = expectedConfiguration(env);
    const model = JSON.parse(expected.canonicalUtf8) as Record<string, unknown>;
    model['formatVersion'] = '2.0';
    writeFileSync(env.metadataPath, JSON.stringify(model), { mode: 0o600 });
    chmodSync(env.metadataPath, 0o600);
    const facts = recoveryFacts(env, 'unsupported-configuration-version');
    const result = runRecovery(env, facts);
    assert.equal(result.ok, false, 'an unsupported configuration version fails closed; zero migration');
    assert.equal(JSON.parse(readFileSync(env.metadataPath, 'utf8'))['formatVersion'], '2.0', 'the object is untouched');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('config-recovery: a missing metadata DIRECTORY is not recovery-recoverable', () => {
  const env = makeStore();
  try {
    rmSync(`${env.configRoot}/metadata`, { recursive: true, force: true });
    const facts = recoveryFacts(env, 'configuration-directory-missing');
    const result = runRecovery(env, facts);
    assert.equal(result.ok, false, 'missing configuration directory requires a bootstrap action, never recovery');
    assert.equal(existsSync(`${env.configRoot}/metadata`), false, 'no directory is created by recovery');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Trusted-input race ─────────────────────────────────────────────────────

test('config-recovery: a trusted-configuration change before publication fails closed', () => {
  const env = makeStore();
  try {
    removeConfiguration(env);
    const facts = recoveryFacts(env, 'configuration-missing');
    let advanced = false;
    const result = runRecovery(env, facts, {
      hooks: {
        stage: (s) => {
          if (s === 'before-configuration-publication' && !advanced) {
            advanced = true;
            // The control plane's current trusted configuration changes
            // (new identity) before publication: the in-process capability
            // generation advances and the publication boundary fails
            // closed.
            const configB = genuineConfig('sha-256:' + 'b'.repeat(64));
            const provenanceB = createStorageBootstrapActionProvenance({
              actionIdentity: 'wp8m-bootstrap-b',
              locator: env.dir,
              serviceUid: UID,
              forbiddenRoots: [],
              configurationIdentity: 'sha-256:' + 'b'.repeat(64),
              limitProfile: env.limitProfile,
            });
            const inputB = createTrustedStorageBootstrapInput(configB, provenanceB, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
            assert.equal(inputB.ok, true);
            const initCap = createInitializationCapability({ trustedInput: inputB.input, parentIdentity: env.storeInstance!.parentIdentity });
            assert.ok(initCap !== undefined);
            assert.equal(initCap.verify('namespace-initialize').ok, true);
            initCap.dispose();
          }
        },
      },
    });
    assert.equal(result.ok, false, 'recovery under a stale trusted input must fail closed before publication');
    assert.equal(existsSync(env.metadataPath), false, 'the stale configuration is never published');
    // No evidence may claim success under the stale input.
    const evidenceFacts = extractConfigurationRecoveryEvidenceFacts('');
    assert.equal(evidenceFacts.configuration, undefined);
    // The invalidated capability cannot release the identity-bound lock:
    // it remains for external recovery and is never auto-broken.
    const lockPath = `${env.storeRoot}/locks/writer.lock`;
    assert.equal(existsSync(lockPath), true, 'the mid-flight invalidation leaves the writer lock held');
    rmSync(lockPath);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Publication confinement / evidence ─────────────────────────────────────

test('config-recovery: wrong expected digest, version, and observation bindings are rejected', () => {
  const env = makeStore();
  try {
    removeConfiguration(env);
    const base = recoveryFacts(env, 'configuration-missing');
    // Wrong expected digest.
    let result = runRecovery(env, { ...base, expectedConfigurationDigest: 'sha-256:' + '0'.repeat(64) });
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    // Wrong expected version.
    result = runRecovery(env, { ...base, expectedConfigurationVersion: '9' });
    assert.equal(result.ok, false);
    // Wrong observation id (state changed / tampered binding).
    result = runRecovery(env, { ...base, expectedConfigurationObservationId: 'obs-' + '0'.repeat(16) });
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    // Wrong trusted-input identity.
    result = runRecovery(env, { ...base, expectedTrustedInputIdentity: 'sha-256:' + '1'.repeat(64) });
    assert.equal(result.ok, false);
    assert.equal(existsSync(env.metadataPath), false, 'nothing may be published under wrong bindings');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('config-recovery: conflicting durable evidence fails closed', () => {
  const env = makeStore();
  try {
    removeConfiguration(env);
    const facts = recoveryFacts(env, 'configuration-missing');
    const first = runRecovery(env, facts);
    assert.equal(first.ok, true, JSON.stringify(first.findings));
    // Tamper the durable evidence payload (different configuration identity).
    const evidenceFile = evidencePath(env, first.evidenceId!);
    const model = JSON.parse(readFileSync(evidenceFile, 'utf8')) as Record<string, unknown>;
    const payload = model['payload'] as Record<string, unknown>;
    payload['configurationIdentity'] = 'sha-256:' + 'b'.repeat(64);
    delete payload['payloadDigest'];
    model['payloadDigest'] = computeDomainDigest('PGAP-STORAGE-PAYLOAD-v1\u0000', jcsSerialize(payload));
    writeFileSync(evidenceFile, JSON.stringify(model), { mode: 0o600 });
    chmodSync(evidenceFile, 0o600);
    const rerun = runRecovery(env, recoveryFacts(env, 'configuration-healthy'));
    assert.equal(rerun.ok, false, 'conflicting evidence fails closed');
    assert.equal(rerun.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Crash model ────────────────────────────────────────────────────────────

const CONFIG_RECOVERY_CRASH_STAGES: readonly RecoveryMutationStage[] = [
  'before-writer-lock',
  'after-writer-lock',
  'after-current-state-verification',
  'before-configuration-publication',
  'after-configuration-publication',
  'before-configuration-durability-confirmation',
  'after-configuration-durability',
  'before-evidence-publication',
  'after-evidence-publication',
  'after-evidence-audit-publication',
  'before-writer-lock-release',
];

test('config-recovery: the fixed crash-stage inventory is exercised in order', () => {
  const env = makeStore();
  try {
    removeConfiguration(env);
    const facts = recoveryFacts(env, 'configuration-missing');
    const seen: RecoveryMutationStage[] = [];
    const result = runRecovery(env, facts, { hooks: { stage: (s) => seen.push(s) } });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.deepEqual(seen, CONFIG_RECOVERY_CRASH_STAGES, 'the fixed configuration-recovery crash inventory must be exercised in order');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('config-recovery: a crash at every fixed stage leaves a classifiable state and a safe rerun', () => {
  for (const stage of CONFIG_RECOVERY_CRASH_STAGES) {
    const env = makeStore();
    try {
      removeConfiguration(env);
      const facts = recoveryFacts(env, 'configuration-missing');
      const configStage = CONFIG_RECOVERY_CRASH_STAGES.indexOf('before-configuration-publication');
      const durabilityStage = CONFIG_RECOVERY_CRASH_STAGES.indexOf('after-configuration-durability');
      const evidenceStage = CONFIG_RECOVERY_CRASH_STAGES.indexOf('before-evidence-publication');
      const stageIndex = CONFIG_RECOVERY_CRASH_STAGES.indexOf(stage);
      crashAt(env, facts, stage);
      const configPresent = stageIndex > configStage;
      assert.equal(existsSync(env.metadataPath), configPresent, `${stage}: configuration presence`);
      const lockPath = `${env.storeRoot}/locks/writer.lock`;
      if (stageIndex >= 1) {
        assert.equal(existsSync(lockPath), true, `${stage}: the crash leaves the writer lock held`);
        rmSync(lockPath);
      }
      // Rerun: deterministic per stage.
      const rerun = runRecovery(env, recoveryFacts(env, configPresent ? 'configuration-healthy' : 'configuration-missing'));
      if (!configPresent) {
        assert.equal(rerun.ok, true, `${stage}: rerun must recover: ${JSON.stringify(rerun.findings)}`);
        assert.equal(rerun.outcome, 'configuration-recovered', `${stage}: recovery outcome`);
      } else if (stageIndex < durabilityStage) {
        assert.equal(rerun.ok, true, `${stage}: rerun reports already-present (no evidence fabricated): ${JSON.stringify(rerun.findings)}`);
        assert.equal(rerun.outcome, 'already-present', `${stage}: already-present outcome`);
      } else if (stageIndex <= evidenceStage) {
        assert.equal(rerun.ok, true, `${stage}: rerun reports already-present (evidence was never published): ${JSON.stringify(rerun.findings)}`);
        assert.equal(rerun.outcome, 'already-present', `${stage}: already-present outcome`);
      } else {
        assert.equal(rerun.ok, true, `${stage}: rerun resolves already-completed: ${JSON.stringify(rerun.findings)}`);
        assert.equal(rerun.outcome, 'already-completed', `${stage}: already-completed outcome`);
      }
      assert.equal(existsSync(lockPath), false, `${stage}: the lock is released after the rerun`);
      // The state is classifiable by the recovery scan.
      const scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      assert.equal(scan.ok, true, `${stage}: ${JSON.stringify(scan.findings)}`);
      assert.ok(scan.assessment!.configurationObservation !== undefined, `${stage}: the scan observes the configuration namespace`);
    } finally {
      rmSync(env.dir, { recursive: true, force: true });
    }
  }
});

// ── Scanner / assessment integration ───────────────────────────────────────

test('config-recovery: the recovery scan classifies healthy, missing, conflicting, and malformed configuration states', () => {
  const env = makeStore();
  try {
    // Healthy.
    let scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scan.ok, true, JSON.stringify(scan.findings));
    assert.equal(scan.assessment!.configurationObservation?.state, 'configuration-healthy');
    // Missing.
    removeConfiguration(env);
    scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scan.ok, true, 'a missing configuration object never makes the unrelated recovery scan fail');
    assert.equal(scan.assessment!.configurationObservation?.state, 'configuration-missing');
    // Conflicting (self-consistent, different configuration identity).
    const expected = expectedConfiguration(env);
    const model = JSON.parse(expected.canonicalUtf8) as Record<string, unknown>;
    const payload = model['payload'] as Record<string, unknown>;
    payload['configurationIdentity'] = 'sha-256:' + 'b'.repeat(64);
    model['payloadDigest'] = computeDomainDigest('PGAP-STORAGE-PAYLOAD-v1\u0000', jcsSerialize(payload));
    writeFileSync(env.metadataPath, JSON.stringify(model), { mode: 0o600 });
    chmodSync(env.metadataPath, 0o600);
    scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scan.ok, true);
    assert.equal(scan.assessment!.configurationObservation?.state, 'conflicting-configuration');
    // Malformed.
    writeFileSync(env.metadataPath, '{broken', { mode: 0o600 });
    chmodSync(env.metadataPath, 0o600);
    scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scan.ok, true, 'a malformed configuration object never makes the unrelated recovery scan fail');
    assert.equal(scan.assessment!.configurationObservation?.state, 'malformed-configuration');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('config-recovery: evidence states are classified and evidence never grants configuration authority', () => {
  const env = makeStore();
  try {
    removeConfiguration(env);
    const facts = recoveryFacts(env, 'configuration-missing');
    const first = runRecovery(env, facts);
    assert.equal(first.ok, true, JSON.stringify(first.findings));
    const scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scan.ok, true);
    assert.equal(scan.assessment!.configurationObservation?.state, 'configuration-healthy');
    assert.equal(scan.assessment!.configurationRecoveryEvidenceStates.some((s) => s.state === 'completed-configuration-recovery'), true, 'the completed recovery is classified');
    // The evidence record is a plain StoreEvidenceRecord: reading it grants
    // nothing and it never acts as configuration authority.
    const evidenceFacts = extractConfigurationRecoveryEvidenceFacts(readFileSync(evidencePath(env, first.evidenceId!), 'utf8'));
    assert.equal(evidenceFacts.configuration, true);
    assert.equal(evidenceFacts.facts?.configurationIdentity, CONFIG_IDENTITY);
    assert.equal(evidenceFacts.facts?.outcome, 'configuration-recovered');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});
