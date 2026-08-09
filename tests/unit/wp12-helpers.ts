/**
 * WP-12 Slice 1 — shared test helpers.
 *
 * Builds: real WP-6 trusted configurations (workspace + capability
 * ceilings), the accepted registry context from the committed registry
 * fixture, real WP-8 stores + store boundaries, deterministic identity
 * sources, accepted WP-4 validation evidence over committed artifact
 * fixtures, canonical subjects, and in-memory fake stores for pure-core
 * tests. No production code is modified; all stores are test-created
 * temporary directories.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  TRUSTED_HOST_LANE,
  validateTrustedWorkspaceConfiguration,
} from '../../src/trusted/index.js';
import type { ValidatedTrustedWorkspaceConfiguration } from '../../src/trusted/types.js';
import { createSchemaRegistry, validateRegistrySnapshot, validateArtifactSelf } from '../../src/api/validate.js';
import type { AcceptedRegistryContext, ValidatedArtifact, ValidationReport } from '../../src/api/types.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createTrustedStorageBootstrapInput } from '../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../src/storage/publication/index.js';
import { recordClassProfile } from '../../src/storage/format/taxonomy.js';
import { computePayloadDigest } from '../../src/storage/format/envelope.js';
import { defaultLimitProfile } from '../../src/storage/limits/limits.js';
import { createControlPlaneStoreBoundary } from '../../src/control-plane/store-boundary.js';
import { createProcessLocalCoordinator } from '../../src/control-plane/coordination.js';
import type { ControlPlaneStoreBoundary } from '../../src/control-plane/types.js';
import type {
  AcceptedValidationEvidence,
  CanonicalSubject,
  ControlPlaneTrustedContext,
  DecisionCoordinator,
  LifecycleEnumerateResult,
  LifecycleReadResult,
  Slice1KindId,
} from '../../src/control-plane/types.js';
import type { PublishRecordResult, RecordClassId } from '../../src/storage/types.js';

export const UID = process.getuid?.() ?? 0;
export const WS_A = 'pgw:w:cf4339b1f56441936467dea1357dc30e';
export const BOOTSTRAP_ACTION = 'bootstrap-action-1';
export const WRITE_ACTION = 'write-action-1';
export const FIXED_NOW = '2026-08-04T06:00:00.000Z';
export const REGISTRY_FIXTURE = 'fixtures/registry/valid/registry-v1.json';

export function loadJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

// ─── trusted configuration ──────────────────────────────────────────────────

export interface ConfigOptions {
  readonly globalCapabilities?: readonly string[];
  readonly workspaceCapabilities?: readonly string[];
}

export interface ConfigEnv {
  readonly config: ValidatedTrustedWorkspaceConfiguration;
  readonly workspaceRoot: string;
  readonly remove: () => void;
}

export function makeConfigEnv(options: ConfigOptions = {}): ConfigEnv {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'wp12s1-cfg-'));
  const report = validateTrustedWorkspaceConfiguration(
    {
      configurationVersion: '2',
      capabilityVocabularyVersion: 'v1',
      provenance: { sourceKind: 'trusted-local-control-plane' },
      ...(options.globalCapabilities !== undefined ? { globalCapabilityCeiling: { capabilities: [...options.globalCapabilities] } } : {}),
      workspaces: [
        {
          workspaceId: WS_A,
          root: workspaceRoot,
          ...(options.workspaceCapabilities !== undefined ? { capabilities: [...options.workspaceCapabilities] } : {}),
        },
      ],
    },
    { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p) => p },
  );
  if (!report.ok || report.configuration === undefined) {
    throw new Error(`fixture configuration invalid: ${report.findings.map((f) => `${f.code}:${f.messageKey}`).join(',')}`);
  }
  return { config: report.configuration, workspaceRoot, remove: () => rmSync(workspaceRoot, { recursive: true, force: true }) };
}

/** Default Slice-1 config: both control-plane capabilities permitted. */
export const DEFAULT_GLOBAL_CAPABILITIES: readonly string[] = ['project-gateway.approval-operate', 'project-gateway.lifecycle-issue'];

// ─── registry context ───────────────────────────────────────────────────────

export function makeRegistryContext(): AcceptedRegistryContext {
  const model = loadJson(REGISTRY_FIXTURE);
  const snapshot = validateRegistrySnapshot(model, createSchemaRegistry()).value;
  if (snapshot === undefined) throw new Error('registry fixture failed validation');
  return {
    registryProtocolId: 'project-gateway.registry',
    registrySnapshotFormatVersion: '1.0',
    registrySnapshotId: String(model['snapshot_id']),
    registrySnapshotDigest: String(model['snapshot_digest']),
    snapshot,
  };
}

// ─── real WP-8 store ────────────────────────────────────────────────────────

export interface StoreEnv {
  readonly dir: string;
  readonly config: ValidatedTrustedWorkspaceConfiguration;
  readonly bootstrapInput: unknown;
  readonly remove: () => void;
}

export function makeStoreEnv(config: ValidatedTrustedWorkspaceConfiguration): StoreEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wp12s1-store-'));
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: BOOTSTRAP_ACTION,
    locator: dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: config.identity,
    limitProfile: defaultLimitProfile(),
  });
  const inputResult = createTrustedStorageBootstrapInput(config, bootstrapProvenance, {
    locator: dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
  });
  if (!inputResult.ok || inputResult.input === undefined) throw new Error('trusted bootstrap input failed');
  const init = initializeTrustedStore({
    trustedConfiguration: config,
    actionProvenance: bootstrapProvenance,
    locator: dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
  });
  if (!init.ok) throw new Error(`store initialization failed: ${JSON.stringify(init.findings)}`);
  return { dir, config, bootstrapInput: inputResult.input, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export function makeStoreBoundary(env: StoreEnv): ControlPlaneStoreBoundary {
  return createControlPlaneStoreBoundary({
    trustedConfiguration: env.config,
    bootstrapInput: env.bootstrapInput,
    writeAction: {
      actionIdentity: WRITE_ACTION,
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: env.config.identity,
      limitProfile: defaultLimitProfile(),
    },
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
}

/**
 * Seed one raw lifecycle record of ANY class directly through WP-8
 * `publishRecord` (test-only seeding for revocation/supersession state;
 * WP-12 Slice 1 itself publishes only the three Slice-1 classes).
 */
export function seedRawRecord(env: StoreEnv, recordClass: RecordClassId, payload: Readonly<Record<string, unknown>>): string {
  const profile = recordClassProfile(recordClass);
  if (profile === undefined) throw new Error(`unknown record class ${recordClass}`);
  const provenance = createStorageWriteActionProvenance({
    actionIdentity: WRITE_ACTION,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: env.config.identity,
    limitProfile: defaultLimitProfile(),
  });
  const recordId = String(payload['record_id'] ?? '');
  const createdAt = String(payload['created_at'] ?? '');
  const result = publishRecord({
    trustedConfiguration: env.config,
    bootstrapInput: env.bootstrapInput,
    writeActionProvenance: provenance,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
    recordClass,
    record: {
      recordKind: profile.label,
      formatVersion: '1.0',
      recordId,
      revision: 1,
      createdAt,
      trustedActionId: WRITE_ACTION,
      payload,
      payloadDigest: computePayloadDigest(payload),
    },
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  if (!result.ok) throw new Error(`seedRawRecord failed for ${recordClass}: ${JSON.stringify(result.findings)}`);
  return recordId;
}

// ─── identity source (deterministic) ────────────────────────────────────────

export interface DeterministicIdentity {
  readonly nowUtcIso: () => string;
  readonly newRecordId: () => string;
  readonly sequence: () => number;
}

export function makeIdentitySource(now: string = FIXED_NOW): DeterministicIdentity {
  let n = 0;
  return {
    nowUtcIso: () => now,
    newRecordId: () => {
      n += 1;
      return `pgw:l:${n.toString(16).padStart(32, '0')}`;
    },
    sequence: () => n,
  };
}

// ─── canonical subject + accepted WP-4 evidence ────────────────────────────

const FIXTURE_KIND_MODELS: Readonly<Record<Slice1KindId, string>> = {
  TaskSpec: 'fixtures/artifacts/valid/task-minimal-genesis.json',
  AuthorityPolicy: 'fixtures/artifacts/valid/policy-minimal-genesis.json',
  ContextManifest: 'fixtures/artifacts/valid/context-minimal-genesis.json',
  CompletionContract: 'fixtures/artifacts/valid/completion-minimal-genesis.json',
  ExecutionBundle: 'fixtures/artifacts/valid/bundle-minimal-genesis.json',
};

export function fixtureModel(kind: Slice1KindId): Record<string, unknown> {
  return loadJson(FIXTURE_KIND_MODELS[kind]);
}

export interface SubjectInfo {
  readonly subject: CanonicalSubject;
  readonly model: Record<string, unknown>;
}

/** Canonical subject derived from the committed artifact fixture identity. */
export function makeSubject(kind: Slice1KindId = 'TaskSpec', workspaceId: string = WS_A): SubjectInfo {
  const model = fixtureModel(kind);
  const revision = model['revision'] as Record<string, unknown>;
  const kindDescriptor = model['kind'] as Record<string, unknown>;
  const protocol = model['protocol'] as Record<string, unknown>;
  return {
    subject: Object.freeze({
      protocolId: String(protocol['id']),
      protocolVersion: String(protocol['version']),
      kindId: kind,
      kindVersion: String(kindDescriptor['version']),
      instanceId: String(model['instance_id']),
      revisionId: String(revision['id']),
      digest: String(revision['digest']),
      workspaceId,
    }),
    model,
  };
}

/** Accepted WP-4 validation evidence over the committed fixture (self-semantic level). */
export function makeEvidence(kind: Slice1KindId = 'TaskSpec'): AcceptedValidationEvidence {
  const registry = createSchemaRegistry();
  const result = validateArtifactSelf(fixtureModel(kind), registry);
  if (!result.ok || result.value === undefined) {
    throw new Error(`fixture ${kind} failed WP-4 self validation: ${JSON.stringify(result.findings)}`);
  }
  const artifact = result.value as ValidatedArtifact;
  const report = { ...result, findings: Object.freeze([...result.findings]) } as ValidationReport;
  return { report, artifact };
}

// ─── full trusted context ───────────────────────────────────────────────────

export interface ContextOverrides {
  readonly configuration?: ValidatedTrustedWorkspaceConfiguration;
  readonly registry?: AcceptedRegistryContext;
  readonly store?: ControlPlaneStoreBoundary;
  readonly coordinate?: DecisionCoordinator;
  readonly identity?: DeterministicIdentity;
  readonly approverRole?: boolean;
  readonly issuerRole?: boolean;
  readonly revokerRole?: boolean;
  readonly operatorIdentity?: string;
  readonly validationEvidence?: AcceptedValidationEvidence;
  readonly subjectArtifact?: ValidatedArtifact;
  readonly approval?: ControlPlaneTrustedContext['approval'];
  readonly issuance?: ControlPlaneTrustedContext['issuance'];
  readonly schemaRegistry?: ControlPlaneTrustedContext['schemaRegistry'];
}

export function makeContext(env: StoreEnv, overrides: ContextOverrides = {}): ControlPlaneTrustedContext {
  const identity = overrides.identity ?? makeIdentitySource();
  return {
    configuration: overrides.configuration ?? env.config,
    registry: overrides.registry ?? makeRegistryContext(),
    operator: {
      approverRole: overrides.approverRole ?? true,
      issuerRole: overrides.issuerRole ?? true,
      revokerRole: overrides.revokerRole ?? false,
      operatorIdentity: overrides.operatorIdentity ?? 'test-operator',
    },
    store: overrides.store ?? makeStoreBoundary(env),
    coordinate: overrides.coordinate ?? createProcessLocalCoordinator(),
    identity,
    ...(overrides.approval !== undefined ? { approval: overrides.approval } : {}),
    ...(overrides.issuance !== undefined ? { issuance: overrides.issuance } : {}),
    ...(overrides.schemaRegistry !== undefined ? { schemaRegistry: overrides.schemaRegistry } : {}),
    ...(overrides.validationEvidence !== undefined ? { validationEvidence: overrides.validationEvidence } : {}),
    ...(overrides.subjectArtifact !== undefined ? { subjectArtifact: overrides.subjectArtifact } : {}),
  };
}

// ─── fake in-memory store (pure-core tests) ─────────────────────────────────

export interface FakeStoreState {
  readonly byClass: Map<string, Readonly<Record<string, unknown>>[]>;
  publishCalls: number;
  readCalls: number;
  enumerateCalls: number;
  failReads: boolean;
  throwOnPublish: boolean;
}

export interface FakeStoreOverrides {
  readonly failReads?: boolean;
  readonly throwOnPublish?: boolean;
}

/** In-memory fake of the WP-8 store boundary (payload-level). */
export function makeFakeStore(overrides: FakeStoreOverrides = {}): { readonly store: ControlPlaneStoreBoundary; readonly state: FakeStoreState } {
  const state: FakeStoreState = {
    byClass: new Map(),
    publishCalls: 0,
    readCalls: 0,
    enumerateCalls: 0,
    failReads: overrides.failReads ?? false,
    throwOnPublish: overrides.throwOnPublish ?? false,
  };
  const list = (recordClass: RecordClassId): Readonly<Record<string, unknown>>[] => {
    let entries = state.byClass.get(recordClass);
    if (entries === undefined) {
      entries = [];
      state.byClass.set(recordClass, entries);
    }
    return entries;
  };
  const store: ControlPlaneStoreBoundary = {
    publishLifecycleRecord(recordClass: RecordClassId, payload: Readonly<Record<string, unknown>>): PublishRecordResult {
      if (state.throwOnPublish) throw new Error('injected publish failure');
      state.publishCalls += 1;
      const entries = list(recordClass);
      const duplicate = entries.some((entry) => entry['record_id'] === payload['record_id']);
      if (duplicate) {
        return { ok: false, outcome: 'duplicate', findings: [] };
      }
      entries.push(payload);
      return { ok: true, outcome: 'published', recordId: String(payload['record_id']), recordDigest: `sha-256:${'f'.repeat(64)}`, auditEventId: `pgw:l:${'e'.repeat(32)}` };
    },
    readLifecyclePayload(recordClass: RecordClassId, recordId: string): LifecycleReadResult {
      state.readCalls += 1;
      if (state.failReads) return { ok: false, code: 'read-failed' };
      const found = list(recordClass).find((entry) => entry['record_id'] === recordId);
      return found === undefined ? { ok: false, code: 'not-found' } : { ok: true, payload: found };
    },
    enumerateLifecycleRecords(recordClass: RecordClassId): LifecycleEnumerateResult {
      state.enumerateCalls += 1;
      if (state.failReads) return { ok: false, code: 'enumerate-failed', recordIds: [] };
      return { ok: true, recordIds: Object.freeze(list(recordClass).map((entry) => String(entry['record_id']))) };
    },
  };
  return { store, state };
}

/** Seed one raw lifecycle payload directly into a fake store (test fixtures). */
export function seedPayload(store: ControlPlaneStoreBoundary, recordClass: RecordClassId, payload: Readonly<Record<string, unknown>>): void {
  const result = store.publishLifecycleRecord(recordClass, payload);
  if (!result.ok) throw new Error(`seed failed for ${recordClass}`);
}

/** Full real integration environment (config + store + boundary). */
export interface IntegrationEnv {
  readonly configEnv: ConfigEnv;
  readonly storeEnv: StoreEnv;
  readonly remove: () => void;
}

export function makeIntegrationEnv(options: ConfigOptions = {}): IntegrationEnv {
  const configEnv = makeConfigEnv({ globalCapabilities: DEFAULT_GLOBAL_CAPABILITIES, ...options });
  const storeEnv = makeStoreEnv(configEnv.config);
  const env = {
    configEnv,
    storeEnv,
    remove: () => {
      storeEnv.remove();
      configEnv.remove();
    },
  };
  registerRemover(env.remove);
  return env;
}

const removers: (() => void)[] = [];

function registerRemover(fn: () => void): void {
  removers.push(fn);
}

/** Remove every registered temporary test environment (call from `after`). */
export function cleanupTestEnvs(): void {
  for (const fn of removers.splice(0)) fn();
}
