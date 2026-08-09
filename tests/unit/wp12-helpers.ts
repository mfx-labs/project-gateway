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
import { createSchemaRegistry, validateRegistrySnapshot, validateArtifactSelf, computeArtifactDigest } from '../../src/api/validate.js';
import type { AcceptedRegistryContext, ConsumerSupportDeclaration, ValidatedArtifact, ValidationReport } from '../../src/api/types.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createTrustedStorageBootstrapInput } from '../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../src/storage/publication/index.js';
import { recordClassProfile } from '../../src/storage/format/taxonomy.js';
import { computePayloadDigest } from '../../src/storage/format/envelope.js';
import { defaultLimitProfile } from '../../src/storage/limits/limits.js';
import { createControlPlaneStoreBoundary } from '../../src/control-plane/store-boundary.js';
import { createProcessLocalCoordinator } from '../../src/control-plane/coordination.js';
import { executeSlice1Command } from '../../src/control-plane/core.js';
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
  readonly globalActionCeiling?: number;
  readonly workspaceActionCeiling?: number;
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
      ...(options.globalActionCeiling !== undefined ? { globalActionCeiling: options.globalActionCeiling } : {}),
      workspaces: [
        {
          workspaceId: WS_A,
          root: workspaceRoot,
          ...(options.workspaceCapabilities !== undefined ? { capabilities: [...options.workspaceCapabilities] } : {}),
          ...(options.workspaceActionCeiling !== undefined ? { actionCeiling: options.workspaceActionCeiling } : {}),
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
  readonly newOccurrenceId: () => string;
  readonly newAttemptId: () => string;
  readonly sequence: () => number;
}

export function makeIdentitySource(now: string = FIXED_NOW): DeterministicIdentity {
  let n = 0;
  let o = 0;
  let a = 0;
  return {
    nowUtcIso: () => now,
    newRecordId: () => {
      n += 1;
      return `pgw:l:${n.toString(16).padStart(32, '0')}`;
    },
    newOccurrenceId: () => {
      o += 1;
      return `pgw:o:${o.toString(16).padStart(32, '0')}`;
    },
    newAttemptId: () => {
      a += 1;
      return `pgw:a:${a.toString(16).padStart(32, '0')}`;
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
  readonly grantRole?: boolean;
  readonly activationRole?: boolean;
  readonly executionRecorderRole?: boolean;
  readonly operatorIdentity?: string;
  readonly validationEvidence?: AcceptedValidationEvidence;
  readonly subjectArtifact?: ValidatedArtifact;
  readonly policyEvidence?: ValidatedArtifact;
  readonly consumerSupport?: ConsumerSupportDeclaration;
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
      ...(overrides.grantRole !== undefined ? { grantRole: overrides.grantRole } : {}),
      ...(overrides.activationRole !== undefined ? { activationRole: overrides.activationRole } : {}),
      ...(overrides.executionRecorderRole !== undefined ? { executionRecorderRole: overrides.executionRecorderRole } : {}),
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
    ...(overrides.policyEvidence !== undefined ? { policyEvidence: overrides.policyEvidence } : {}),
    ...(overrides.consumerSupport !== undefined ? { consumerSupport: overrides.consumerSupport } : {}),
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

// ─── Slice-3A grant chain seeding (real command flow) ───────────────────────

/** The exact four required ExecutionBundle member kinds (ADR-006). */
export const BUNDLE_MEMBER_KINDS = ['TaskSpec', 'AuthorityPolicy', 'ContextManifest', 'CompletionContract'] as const;

/** Canonical subject of one bundle member derived from the bundle body reference. */
export function memberSubjectOf(kind: (typeof BUNDLE_MEMBER_KINDS)[number], workspaceId: string = WS_A): SubjectInfo {
  const bundleModel = fixtureModel('ExecutionBundle');
  const body = bundleModel['body'] as Record<string, unknown>;
  const bodyKey: Record<string, string> = {
    TaskSpec: 'task',
    AuthorityPolicy: 'authority_policy',
    ContextManifest: 'context_manifest',
    CompletionContract: 'completion_contract',
  };
  const ref = body[bodyKey[kind]!] as Record<string, unknown>;
  const kindDescriptor = ref['target_kind'] as Record<string, unknown>;
  return {
    subject: Object.freeze({
      protocolId: 'project-gateway.artifact',
      protocolVersion: String(ref['target_protocol_version']),
      kindId: kind,
      kindVersion: String(kindDescriptor['version']),
      instanceId: String(ref['target_instance_id']),
      revisionId: String(ref['target_revision_id']),
      digest: String(ref['target_digest']),
      workspaceId,
    }),
    model: fixtureModel(kind),
  };
}

/** All five required grant-chain subjects: the bundle first, then the four members. */
export function grantChainSubjects(workspaceId: string = WS_A): { readonly bundle: SubjectInfo; readonly members: readonly SubjectInfo[] } {
  const bundle = makeSubject('ExecutionBundle', workspaceId);
  const members = BUNDLE_MEMBER_KINDS.map((kind) => memberSubjectOf(kind, workspaceId));
  return { bundle, members };
}

export interface GrantChainSeed {
  readonly subjects: readonly SubjectInfo[];
  readonly validationRecordIds: readonly string[];
  readonly approvalRecordIds: readonly string[];
  readonly issuanceRecordIds: readonly string[];
}

/**
 * Slice-3B activation kit: a custom AuthorityPolicy (schema-valid rules) and
 * an ExecutionBundle whose authority_policy reference points at it, with
 * canonical digests recomputed and WP-4 self-semantic validation performed.
 * Used to prove policy/consumer/ceiling intersection behavior (check 7)
 * without touching committed fixtures.
 */
export interface ActivationKit {
  readonly policy: { readonly subject: CanonicalSubject; readonly artifact: ValidatedArtifact; readonly evidence: AcceptedValidationEvidence };
  readonly bundle: { readonly subject: CanonicalSubject; readonly artifact: ValidatedArtifact; readonly evidence: AcceptedValidationEvidence };
}

/**
 * Build a validated custom AuthorityPolicy: the committed minimal policy
 * plus an extra rule (default: a workspace-read deny rule for the
 * activation requested use). Returns the recomputed revision identity.
 */
export function makeCustomPolicy(
  extraRule: Readonly<Record<string, unknown>>,
  workspaceId: string = WS_A,
): { readonly model: Record<string, unknown>; readonly subject: CanonicalSubject; readonly artifact: ValidatedArtifact } {
  const base = fixtureModel('AuthorityPolicy');
  const model = structuredClone(base) as Record<string, unknown>;
  const body = model['body'] as Record<string, unknown>;
  const rules = body['rules'] as Record<string, unknown>[];
  rules.push({ ...extraRule });
  const digest = computeArtifactDigest(model);
  const revision = model['revision'] as Record<string, unknown>;
  revision['digest'] = digest.digest;
  const validated = validateArtifactSelf(model, createSchemaRegistry());
  if (!validated.ok || validated.value === undefined) {
    throw new Error(`custom policy failed WP-4 validation: ${JSON.stringify(validated.findings)}`);
  }
  const kind = model['kind'] as Record<string, unknown>;
  const protocol = model['protocol'] as Record<string, unknown>;
  const subject = Object.freeze({
    protocolId: String(protocol['id']),
    protocolVersion: String(protocol['version']),
    kindId: 'AuthorityPolicy' as const,
    kindVersion: String(kind['version']),
    instanceId: String(model['instance_id']),
    revisionId: String(revision['id']),
    digest: String(revision['digest']),
    workspaceId,
  });
  return { model, subject, artifact: validated.value };
}

/**
 * Build a validated ExecutionBundle whose authority_policy member points at
 * the custom policy (fresh revision identity + recomputed digest).
 */
export function makeCustomBundle(
  policySubject: CanonicalSubject,
  workspaceId: string = WS_A,
): { readonly model: Record<string, unknown>; readonly subject: CanonicalSubject; readonly artifact: ValidatedArtifact } {
  const base = fixtureModel('ExecutionBundle');
  const model = structuredClone(base) as Record<string, unknown>;
  const body = model['body'] as Record<string, unknown>;
  body['authority_policy'] = {
    target_protocol_version: '1.0',
    target_kind: { id: 'AuthorityPolicy', version: policySubject.kindVersion },
    target_instance_id: policySubject.instanceId,
    target_revision_id: policySubject.revisionId,
    target_digest: policySubject.digest,
    target_workspace_binding: { mode: 'bound', workspace_id: workspaceId },
  };
  const revision = model['revision'] as Record<string, unknown>;
  revision['id'] = `pgw:r:${'c'.repeat(32)}`;
  // The canonical projection covers revision.id but excludes revision.digest,
  // so the digest must be computed AFTER the identity change.
  revision['digest'] = computeArtifactDigest(model).digest;
  const validated = validateArtifactSelf(model, createSchemaRegistry());
  if (!validated.ok || validated.value === undefined) {
    throw new Error(`custom bundle failed WP-4 validation: ${JSON.stringify(validated.findings)}`);
  }
  const kind = model['kind'] as Record<string, unknown>;
  const protocol = model['protocol'] as Record<string, unknown>;
  const subject = Object.freeze({
    protocolId: String(protocol['id']),
    protocolVersion: String(protocol['version']),
    kindId: 'ExecutionBundle' as const,
    kindVersion: String(kind['version']),
    instanceId: String(model['instance_id']),
    revisionId: String(revision['id']),
    digest: String(revision['digest']),
    workspaceId,
  });
  return { model, subject, artifact: validated.value };
}

/**
 * The default check-7 deny rule: an effective deny for the activation
 * requested use (workspace-read / read / configured-artifact-area).
 */
export function activationDenyRule(): Readonly<Record<string, unknown>> {
  return {
    rule_id: 'deny-activation-use',
    effect: 'deny',
    capability: { id: 'project-gateway.workspace-read', version: '1.0' },
    scope: {
      scope_type: 'project-gateway.resource-class-scope',
      version: '1.0',
      resource_classes: ['configured-artifact-area'],
      operation_classes: ['read'],
    },
    constraints: [],
    required_semantics: [],
  };
}

/** Full activation kit (custom policy + matching bundle), WP-4 validated. */
export function makeActivationKit(workspaceId: string = WS_A): ActivationKit {
  const policy = makeCustomPolicy(activationDenyRule(), workspaceId);
  const bundle = makeCustomBundle(policy.subject, workspaceId);
  const report = validateArtifactSelf(bundle.model, createSchemaRegistry());
  void report;
  return {
    policy: {
      subject: policy.subject,
      artifact: policy.artifact,
      evidence: { report: { ok: true, findings: [] } as never, artifact: policy.artifact },
    },
    bundle: {
      subject: bundle.subject,
      artifact: bundle.artifact,
      evidence: { report: { ok: true, findings: [] } as never, artifact: bundle.artifact },
    },
  };
}

/**
 * Seed the complete genuine lifecycle chain (recordValidation → approve →
 * issue for the exact bundle and its four exact members) through the real
 * Slice-1 command flow on a real WP-8 store. Returns the five correlated
 * record identities in subject order (bundle first, then members). The
 * caller MUST continue using the same identity source for later commands in
 * the same test so record identities stay unique. `excludeMember` removes
 * one required member chain (missing-dependency tests). When `kit` is
 * provided, the AuthorityPolicy member and the bundle subjects come from the
 * custom kit (check-7 policy tests).
 */
export function seedFullGrantChain(
  env: StoreEnv,
  identity: DeterministicIdentity,
  workspaceId: string = WS_A,
  excludeMember?: (typeof BUNDLE_MEMBER_KINDS)[number],
  kit?: ActivationKit,
): GrantChainSeed {
  const { bundle, members } = grantChainSubjects(workspaceId);
  const bundleInfo = kit !== undefined ? { subject: kit.bundle.subject, model: kit.bundle.artifact.model as unknown as Record<string, unknown> } : bundle;
  const memberInfos = members.map((member) => {
    if (kit !== undefined && member.subject.kindId === 'AuthorityPolicy') {
      return { subject: kit.policy.subject, model: kit.policy.artifact.model as unknown as Record<string, unknown> };
    }
    return member;
  });
  const subjects = [bundleInfo, ...memberInfos].filter((info) => info.subject.kindId !== excludeMember);
  const validationRecordIds: string[] = [];
  const approvalRecordIds: string[] = [];
  const issuanceRecordIds: string[] = [];
  for (const info of subjects) {
    const evidence = kit !== undefined && info.subject.kindId === 'AuthorityPolicy'
      ? kit.policy.evidence
      : kit !== undefined && info.subject.kindId === 'ExecutionBundle'
        ? kit.bundle.evidence
        : makeEvidence(info.subject.kindId);
    const validation = executeSlice1Command(
      { operation: 'recordValidation', subject: subjectOperandOf(info.subject), workspaceId: info.subject.workspaceId },
      makeContext(env, { validationEvidence: evidence, identity }),
    );
    if (!validation.ok) throw new Error(`chain seed recordValidation failed: ${JSON.stringify(validation)}`);
    validationRecordIds.push(validation.evidence.recordId);
    const approval = executeSlice1Command(
      { operation: 'approve', subject: subjectOperandOf(info.subject), workspaceId: info.subject.workspaceId, purpose: 'execution-use', validationRecordIds: [validation.evidence.recordId] },
      makeContext(env, { subjectArtifact: evidence.artifact, identity }),
    );
    if (!approval.ok) throw new Error(`chain seed approve failed: ${JSON.stringify(approval)}`);
    approvalRecordIds.push(approval.evidence.recordId);
    const issuance = executeSlice1Command(
      { operation: 'issue', subject: subjectOperandOf(info.subject), workspaceId: info.subject.workspaceId, useClass: 'execution-use' },
      makeContext(env, { subjectArtifact: evidence.artifact, identity }),
    );
    if (!issuance.ok) throw new Error(`chain seed issue failed: ${JSON.stringify(issuance)}`);
    issuanceRecordIds.push(issuance.evidence.recordId);
  }
  return { subjects: Object.freeze(subjects), validationRecordIds: Object.freeze(validationRecordIds), approvalRecordIds: Object.freeze(approvalRecordIds), issuanceRecordIds: Object.freeze(issuanceRecordIds) };
}

function subjectOperandOf(subject: CanonicalSubject): Record<string, unknown> {
  return {
    protocolId: subject.protocolId,
    protocolVersion: subject.protocolVersion,
    kindId: subject.kindId,
    kindVersion: subject.kindVersion,
    instanceId: subject.instanceId,
    revisionId: subject.revisionId,
    digest: subject.digest,
    workspaceId: subject.workspaceId,
  };
}

// ─── Slice-4 activated-occurrence seeding (genuine command flow) ────────────

/** A genuine activated occurrence on a real store (full Slice-3 command flow). */
export interface ActivatedOccurrenceSeed {
  readonly grantId: string;
  readonly reservedOccurrenceId: string;
  readonly activationRecordId: string;
  readonly occurrenceRecordId: string;
}

/** Default attempt-friendly consumer support (workspace-read supported). */
export function makeAttemptConsumerSupport(): ConsumerSupportDeclaration {
  return Object.freeze({
    consumerId: 'test-consumer',
    supportedProtocolFeatures: [],
    supportedConsumerCapabilities: ['project-gateway.workspace-read'],
    supportedExtensionNamespaces: [],
  });
}

/**
 * Seed the complete genuine activation transition (chain → RuntimeGrant →
 * accepted ActivationRecord → ExecutionOccurrenceRecord) through the real
 * Slice-1/3 command flow on a real WP-8 store. The caller MUST continue
 * using the SAME identity source for later commands in the same test.
 * When `kit` is provided (Slice-4 attempt tests), the bundle and policy
 * evidence come from the attempt-authorizing custom kit.
 */
export function seedActivatedOccurrence(
  env: StoreEnv,
  identity: DeterministicIdentity,
  workspaceId: string = WS_A,
  kit?: ActivationKit,
): ActivatedOccurrenceSeed {
  const seed = kit !== undefined
    ? seedFullGrantChain(env, identity, workspaceId, undefined, kit)
    : seedFullGrantChain(env, identity, workspaceId);
  const bundleSubject = seed.subjects[0]!.subject;
  const bundleArtifact = kit !== undefined ? kit.bundle.artifact : makeEvidence('ExecutionBundle').artifact;
  const grantContext = makeContext(env, { identity, grantRole: true, subjectArtifact: bundleArtifact });
  const grant = executeSlice1Command(
    {
      operation: 'issueRuntimeGrant',
      subject: subjectOperandOf(bundleSubject),
      workspaceId,
      registryEcho: registryEchoOperand(),
      attemptLimit: 2,
      validity: { not_before: FIXED_NOW, not_after: '2027-01-01T00:00:00.000Z' },
      narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    },
    grantContext,
  );
  if (!grant.ok) throw new Error(`attempt-seed grant failed: ${JSON.stringify(grant)}`);
  const activationContext = makeContext(env, {
    identity,
    activationRole: true,
    consumerSupport: makeAttemptConsumerSupport(),
    subjectArtifact: bundleArtifact,
    policyEvidence: kit !== undefined ? kit.policy.artifact : makeEvidence('AuthorityPolicy').artifact,
  });
  const activation = executeSlice1Command(
    {
      operation: 'decideActivation',
      subject: subjectOperandOf(bundleSubject),
      workspaceId,
      registryEcho: registryEchoOperand(),
      grantId: grant.evidence.recordId,
      reservedOccurrenceId: grant.evidence.reservedOccurrenceId!,
    },
    activationContext,
  );
  if (!activation.ok || activation.evidence.decision !== 'accepted' || activation.evidence.occurrenceRecordId === undefined) {
    throw new Error(`attempt-seed activation failed: ${JSON.stringify(activation)}`);
  }
  return {
    grantId: grant.evidence.recordId,
    reservedOccurrenceId: grant.evidence.reservedOccurrenceId!,
    activationRecordId: activation.evidence.recordId,
    occurrenceRecordId: activation.evidence.occurrenceRecordId,
  };
}

/** The fixed registry echo operand matching the default host context registry. */
export function registryEchoOperand(): { readonly registry_snapshot_id: string; readonly registry_snapshot_digest: string } {
  const registry = makeRegistryContext();
  return Object.freeze({
    registry_snapshot_id: registry.registrySnapshotId,
    registry_snapshot_digest: registry.registrySnapshotDigest,
  });
}

// ─── Slice-4 attempt-policy kit (WP-4-validated custom policy) ──────────────

/**
 * Build a validated AuthorityPolicy that authorizes the accepted attempt
 * requested use (workspace-read / read / configured-artifact-area /
 * attempt:start). The committed fixture policy's `require-exact-resource`
 * constraint only authorizes `exact:` scopes; the attempt stage scope is a
 * distinct governance stage that a host policy must explicitly authorize
 * (policy is authority — fail closed otherwise). The rules REPLACE the
 * fixture base rule (which would otherwise deny the attempt scope), and the
 * revision digest is recomputed (WP-4 self-semantic validation).
 */
export function makeAttemptPolicy(
  workspaceId: string = WS_A,
): { readonly model: Record<string, unknown>; readonly subject: CanonicalSubject; readonly artifact: ValidatedArtifact } {
  const base = fixtureModel('AuthorityPolicy');
  const model = structuredClone(base) as Record<string, unknown>;
  const body = model['body'] as Record<string, unknown>;
  body['rules'] = [
    {
      rule_id: 'allow-attempt-start',
      effect: 'allow',
      capability: { id: 'project-gateway.workspace-read', version: '1.0' },
      scope: {
        scope_type: 'project-gateway.resource-class-scope',
        version: '1.0',
        resource_classes: ['configured-artifact-area'],
        operation_classes: ['read'],
      },
      constraints: [],
      required_semantics: [],
    },
  ];
  const digest = computeArtifactDigest(model);
  const revision = model['revision'] as Record<string, unknown>;
  revision['digest'] = digest.digest;
  const validated = validateArtifactSelf(model, createSchemaRegistry());
  if (!validated.ok || validated.value === undefined) {
    throw new Error(`attempt policy failed WP-4 validation: ${JSON.stringify(validated.findings)}`);
  }
  const kind = model['kind'] as Record<string, unknown>;
  const protocol = model['protocol'] as Record<string, unknown>;
  const subject = Object.freeze({
    protocolId: String(protocol['id']),
    protocolVersion: String(protocol['version']),
    kindId: 'AuthorityPolicy' as const,
    kindVersion: String(kind['version']),
    instanceId: String(model['instance_id']),
    revisionId: String(revision['id']),
    digest: String(revision['digest']),
    workspaceId,
  });
  return { model, subject, artifact: validated.value };
}

/** Full Slice-4 kit (attempt-authorizing policy + matching bundle), WP-4 validated. */
export function makeAttemptKit(workspaceId: string = WS_A): ActivationKit {
  const policy = makeAttemptPolicy(workspaceId);
  const bundle = makeCustomBundle(policy.subject, workspaceId);
  return {
    policy: {
      subject: policy.subject,
      artifact: policy.artifact,
      evidence: { report: { ok: true, findings: [] } as never, artifact: policy.artifact },
    },
    bundle: {
      subject: bundle.subject,
      artifact: bundle.artifact,
      evidence: { report: { ok: true, findings: [] } as never, artifact: bundle.artifact },
    },
  };
}
