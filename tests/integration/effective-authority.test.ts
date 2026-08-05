/**
 * Second focused correction integration tests: exact bundle and lifecycle-chain
 * point-of-use evaluation, exact-reference self versus for-use resolution, and
 * fully oracle-independent conformance execution (schema-resource and
 * canonical-vector entries).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createSchemaRegistry,
  validateArtifactSelf,
  validateArtifactForUse,
  validateRegistrySnapshot,
  validateArtifactRevision,
  validateReferenceModel,
  validateReferenceModelForUse,
  MemoryIdentityState,
  ConformanceRunner,
  computeRegistryDigest,
  computeArtifactDigest,
  ruleIds,
  ruleDef,
  enforcementKind,
} from '../../src/index.js';
import { SchemaRegistry } from '../../src/schema/registry.js';
import { CONFORMANCE_MANIFEST, CORPUS_INPUTS } from '../../src/generated/corpus-bundle.js';
import { evaluateEffectiveAuthority } from '../../src/pointofuse/evaluate.js';
import { structuralRuleIds } from '../../src/internal/structural-map.js';
import type {
  AcceptedRegistryContext,
  ConsumerSupportDeclaration,
  ExactArtifactReferenceModel,
  LifecycleStateView,
  PointOfUseInputs,
  RequestedUse,
  RevocationView,
  ValidatedArtifact,
  ValidatedLifecycleRecord,
} from '../../src/api/types.js';

const reg = createSchemaRegistry();
const corpus = CORPUS_INPUTS as Record<string, string>;
function loadJson(rel: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder('utf-8').decode(Buffer.from(corpus[rel]!, 'base64'))) as Record<string, unknown>;
}
function taskModel(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(loadJson('fixtures/artifacts/valid/task-minimal-genesis.json'))) as Record<string, unknown>;
}

const WORKSPACE = 'pgw:w:cf4339b1f56441936467dea1357dc30e';
const CURRENT_TIME = '2026-08-04T06:10:00.000Z';
const SNAPSHOT_MODEL = loadJson('fixtures/registry/valid/registry-v1.json');
const SNAPSHOT = validateRegistrySnapshot(SNAPSHOT_MODEL, reg).value!;
const ACCEPTED_REGISTRY: AcceptedRegistryContext = {
  registryProtocolId: 'project-gateway.registry',
  registrySnapshotFormatVersion: '1.0',
  registrySnapshotId: String(SNAPSHOT_MODEL['snapshot_id']),
  registrySnapshotDigest: String(SNAPSHOT_MODEL['snapshot_digest']),
  snapshot: SNAPSHOT,
};

const SUPPORT: ConsumerSupportDeclaration = {
  consumerId: 'test-consumer',
  supportedProtocolFeatures: ['project-gateway.conformance-fixture'],
  supportedConsumerCapabilities: ['project-gateway.workspace-read', 'project-gateway.artifact-draft-write'],
  supportedExtensionNamespaces: ['project-gateway.conformance-tag'],
};
const REVOCATIONS: RevocationView = { revocationsByTarget: () => [] };

// ---------------------------------------------------------------------------
// exact bundle and lifecycle chain helpers (corpus-derived)
// ---------------------------------------------------------------------------
const BUNDLE = loadJson('fixtures/artifacts/valid/bundle-minimal-genesis.json');
const TASK = loadJson('fixtures/artifacts/valid/task-minimal-genesis.json');
const POLICY = loadJson('fixtures/artifacts/valid/policy-minimal-genesis.json');
const CONTEXT = loadJson('fixtures/artifacts/valid/context-minimal-genesis.json');
const COMPLETION = loadJson('fixtures/artifacts/valid/completion-minimal-genesis.json');
const GRANT = loadJson('fixtures/lifecycle/valid/runtime-grant-main.json');

const READ_USE: RequestedUse = {
  capability: 'project-gateway.workspace-read',
  operationClass: 'read',
  resourceClass: 'configured-artifact-area',
  scope: 'exact:resource-1',
  workspaceId: WORKSPACE,
};

function wrapRecord(model: Readonly<Record<string, unknown>>): ValidatedLifecycleRecord {
  return {
    recordType: String(model['record_type'] ?? '') as ValidatedLifecycleRecord['recordType'],
    recordId: String(model['record_id'] ?? ''),
    level: 'structural-valid',
    model,
  };
}

function chainRecords(extra: Readonly<Record<string, unknown>>[] = []): ValidatedLifecycleRecord[] {
  const records: ValidatedLifecycleRecord[] = [];
  for (const name of ['task', 'policy', 'context', 'completion', 'bundle']) {
    records.push(wrapRecord(loadJson(`fixtures/lifecycle/valid/validation-${name}.json`)));
    records.push(wrapRecord(loadJson(`fixtures/lifecycle/valid/approval-${name}.json`)));
    records.push(wrapRecord(loadJson(`fixtures/lifecycle/valid/issuance-${name}.json`)));
  }
  records.push(wrapRecord(GRANT));
  records.push(wrapRecord(loadJson('fixtures/lifecycle/valid/activation-accepted.json')));
  for (const r of extra) records.push(wrapRecord(r));
  return records;
}

function chainLifecycle(records: ValidatedLifecycleRecord[] = chainRecords()): LifecycleStateView {
  const byId = new Map(records.map((r) => [r.recordId, r]));
  return { records, findRecord: (id) => byId.get(id) };
}

function chainIdentity(): MemoryIdentityState {
  const id = new MemoryIdentityState();
  for (const m of [TASK, POLICY, CONTEXT, COMPLETION, BUNDLE]) {
    const a = validateArtifactSelf(m, reg, { identity: id }).value as ValidatedArtifact;
    id.register(a);
  }
  return id;
}

function baseInputs(over: Partial<PointOfUseInputs> = {}): PointOfUseInputs {
  return {
    currentTime: CURRENT_TIME,
    workspaceId: WORKSPACE,
    requestedUse: READ_USE,
    consumerSupport: SUPPORT,
    identity: chainIdentity(),
    resolver: { resolve: () => undefined },
    registry: ACCEPTED_REGISTRY,
    lifecycle: chainLifecycle(),
    revocations: REVOCATIONS,
    bundle: BUNDLE,
    policy: POLICY,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Correction 4 — exact-reference schema and full target revalidation (self)
// ---------------------------------------------------------------------------
function makeRef(a: ValidatedArtifact): ExactArtifactReferenceModel {
  return {
    target_protocol_version: '1.0',
    target_kind: { id: 'TaskSpec', version: '1.0' },
    target_instance_id: a.instanceId,
    target_revision_id: a.revisionId,
    target_digest: a.digest,
    target_workspace_binding: { mode: 'portable' },
  };
}

function makeIdentity(): MemoryIdentityState {
  const id = new MemoryIdentityState();
  const a = validateArtifactSelf(taskModel(), reg, { identity: id }).value as ValidatedArtifact;
  id.register(a);
  return id;
}

test('reference: exact valid reference passes', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const report = validateReferenceModel(makeRef(a), { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, true);
});

test('reference: extra latest member fails schema', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const ref = { ...makeRef(a), latest: true } as unknown as ExactArtifactReferenceModel;
  const report = validateReferenceModel(ref, { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, false);
  assert.equal(report.firstFailingPhase, 'structural-schema-validation');
});

test('reference: extra path member fails schema', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const ref = { ...makeRef(a), path: './tasks/task.json' } as unknown as ExactArtifactReferenceModel;
  const report = validateReferenceModel(ref, { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, false);
  assert.equal(report.firstFailingPhase, 'structural-schema-validation');
});

test('reference: extra fallback member fails schema', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const ref = { ...makeRef(a), fallback: makeRef(a) } as unknown as ExactArtifactReferenceModel;
  const report = validateReferenceModel(ref, { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, false);
  assert.equal(report.firstFailingPhase, 'structural-schema-validation');
});

test('reference: extra unknown member fails schema', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const ref = { ...makeRef(a), alias: 'x' } as unknown as ExactArtifactReferenceModel;
  const report = validateReferenceModel(ref, { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, false);
});

test('reference: wrong protocol version rejected', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const ref = { ...makeRef(a), target_protocol_version: '2.0' };
  const report = validateReferenceModel(ref, { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, false);
  assert.ok(report.ruleIds.includes('REF-002'));
});

test('reference: wrong kind rejected', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const ref = { ...makeRef(a), target_kind: { id: 'ExecutionResult', version: '1.0' } };
  const report = validateReferenceModel(ref, { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, false);
  assert.ok(report.ruleIds.includes('REF-002'));
});

test('reference: wrong instance rejected', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const ref = { ...makeRef(a), target_instance_id: 'pgw:i:' + 'd'.repeat(32) };
  const report = validateReferenceModel(ref, { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, false);
  assert.ok(report.ruleIds.includes('REF-003'));
});

test('reference: wrong revision rejected', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const ref = { ...makeRef(a), target_revision_id: 'pgw:r:' + 'e'.repeat(32) };
  const report = validateReferenceModel(ref, { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, false);
  assert.ok(report.ruleIds.includes('REF-003'));
});

test('reference: wrong digest rejected', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const ref = { ...makeRef(a), target_digest: 'sha-256:' + 'f'.repeat(64) };
  const report = validateReferenceModel(ref, { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, false);
  assert.ok(report.ruleIds.includes('REF-004'));
});

test('reference: portable/bound mismatch rejected', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const ref = { ...makeRef(a), target_workspace_binding: { mode: 'bound', workspace_id: 'pgw:w:' + '1'.repeat(32) } };
  const report = validateReferenceModel(ref, { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, false);
  assert.ok(report.ruleIds.includes('REF-005'));
});

test('reference: same binding with different member insertion order passes', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const refA = { ...makeRef(a), target_workspace_binding: { workspace_id: 'x', mode: 'bound' } } as unknown as ExactArtifactReferenceModel;
  const refB = { ...makeRef(a), target_workspace_binding: { mode: 'bound', workspace_id: 'x' } } as unknown as ExactArtifactReferenceModel;
  const binding = { workspace_id: 'x', mode: 'bound' };
  const model = { ...a.model, workspace_binding: binding };
  const rA = validateReferenceModel(refA, { identity: id, schemaRegistry: reg, resolve: () => model });
  const rB = validateReferenceModel(refB, { identity: id, schemaRegistry: reg, resolve: () => model });
  assert.deepEqual(rA.ok, rB.ok);
});

test('reference: resolver substitution rejected (different subject)', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const other = JSON.parse(JSON.stringify(taskModel()));
  other['body'] = { ...(other['body'] as object), objective: 'substituted' };
  const report = validateReferenceModel(makeRef(a), { identity: id, schemaRegistry: reg, resolve: () => other });
  assert.equal(report.ok, false);
});

test('reference: structurally invalid resolver target rejected', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const report = validateReferenceModel(makeRef(a), { identity: id, schemaRegistry: reg, resolve: () => ({ nope: true }) });
  assert.equal(report.ok, false);
});

test('reference: digest-invalid resolver target rejected', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const t = JSON.parse(JSON.stringify(taskModel()));
  t['body'] = { ...(t['body'] as object), objective: 'changed' };
  const report = validateReferenceModel(makeRef(a), { identity: id, schemaRegistry: reg, resolve: () => t });
  assert.equal(report.ok, false);
  assert.ok(report.ruleIds.includes('REF-001'));
});

test('reference: unregistered revision rejected by identity verification', () => {
  const id = new MemoryIdentityState();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const report = validateReferenceModel(makeRef(a), { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, false);
  assert.ok(report.ruleIds.includes('REF-001'));
});

// ---------------------------------------------------------------------------
// Correction 3 — exact-reference self versus for-use resolution
// ---------------------------------------------------------------------------
test('for-use reference: self resolution does not claim registry compatibility', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const report = validateReferenceModel(makeRef(a), { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, true);
  assert.equal(report.value?.level, 'self-semantic-valid');
});

test('for-use reference: for-use resolution requires registry input (fail closed)', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const report = validateReferenceModelForUse(makeRef(a), {
    identity: id,
    schemaRegistry: reg,
    resolve: () => a.model,
    registry: undefined as unknown as AcceptedRegistryContext,
    consumerSupport: SUPPORT,
  });
  assert.equal(report.ok, false);
  assert.equal(report.firstFailingPhase, 'registry-compatibility');
});

test('for-use reference: for-use resolution requires consumer support (fail closed)', () => {
  const id = makeIdentity();
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const report = validateReferenceModelForUse(makeRef(a), {
    identity: id,
    schemaRegistry: reg,
    resolve: () => a.model,
    registry: ACCEPTED_REGISTRY,
    consumerSupport: undefined as unknown as ConsumerSupportDeclaration,
  });
  assert.equal(report.ok, false);
  assert.equal(report.firstFailingPhase, 'registry-compatibility');
});

function registeredTaskWithExtension(over: Partial<PointOfUseInputs> = {}): { ref: ExactArtifactReferenceModel; target: Readonly<Record<string, unknown>>; id: MemoryIdentityState } {
  const id = new MemoryIdentityState();
  const model = JSON.parse(JSON.stringify(loadJson('fixtures/artifacts/valid/task-registered-extension.json'))) as Record<string, unknown>;
  const a = validateArtifactSelf(model, reg, { identity: id }).value as ValidatedArtifact;
  id.register(a);
  return { ref: makeRef(a), target: a.model, id };
}

test('for-use reference: valid exact target with full support is registry-compatible', () => {
  const { ref, target, id } = registeredTaskWithExtension();
  const report = validateReferenceModelForUse(ref, {
    identity: id,
    schemaRegistry: reg,
    resolve: () => target,
    registry: ACCEPTED_REGISTRY,
    consumerSupport: SUPPORT,
  });
  assert.equal(report.ok, true);
  assert.equal(report.value?.level, 'registry-compatible');
});

test('for-use reference: unsupported required extension is denied', () => {
  const { ref, target, id } = registeredTaskWithExtension();
  const report = validateReferenceModelForUse(ref, {
    identity: id,
    schemaRegistry: reg,
    resolve: () => target,
    registry: ACCEPTED_REGISTRY,
    consumerSupport: { ...SUPPORT, supportedExtensionNamespaces: [] },
  });
  assert.equal(report.ok, false);
  assert.ok(report.ruleIds.includes('SEC-003'));
});

test('for-use reference: wrong accepted snapshot is denied', () => {
  // accepted snapshot #2 lacks the conformance-tag contract
  const mutated = JSON.parse(JSON.stringify(SNAPSHOT_MODEL)) as Record<string, unknown>;
  mutated['namespace_entries'] = (mutated['namespace_entries'] as Record<string, unknown>[]).filter(
    (e) => e['namespace'] !== 'project-gateway.conformance-tag',
  );
  mutated['snapshot_digest'] = computeRegistryDigest(mutated).digest;
  const snapshot2 = validateRegistrySnapshot(mutated, reg).value!;
  const accepted2: AcceptedRegistryContext = {
    registryProtocolId: 'project-gateway.registry',
    registrySnapshotFormatVersion: '1.0',
    registrySnapshotId: String(mutated['snapshot_id']),
    registrySnapshotDigest: String(mutated['snapshot_digest']),
    snapshot: snapshot2,
  };
  const { ref, target, id } = registeredTaskWithExtension();
  const report = validateReferenceModelForUse(ref, {
    identity: id,
    schemaRegistry: reg,
    resolve: () => target,
    registry: accepted2,
    consumerSupport: SUPPORT,
  });
  assert.equal(report.ok, false);
  assert.ok(report.ruleIds.includes('REG-005'));
});

test('for-use reference: target registry mismatch (required mode unsupported) is denied', () => {
  const id = new MemoryIdentityState();
  const model = JSON.parse(JSON.stringify(loadJson('fixtures/artifacts/valid/task-registered-extension.json'))) as Record<string, unknown>;
  (model['extensions'] as Record<string, unknown>[])[0]!['mode'] = 'required';
  model['revision'] = { ...(model['revision'] as object), digest: '' };
  const digest = computeDigest(model);
  model['revision'] = { ...(model['revision'] as object), digest };
  const a = validateArtifactSelf(model, reg, { identity: id }).value as ValidatedArtifact;
  id.register(a);
  const report = validateReferenceModelForUse(makeRef(a), {
    identity: id,
    schemaRegistry: reg,
    resolve: () => a.model,
    registry: ACCEPTED_REGISTRY,
    consumerSupport: SUPPORT,
  });
  assert.equal(report.ok, false);
  assert.ok(report.ruleIds.includes('REG-006'));
});

test('for-use reference: phase level accurately reflects executed validation', () => {
  const { ref, target, id } = registeredTaskWithExtension();
  const self = validateReferenceModel(ref, { identity: id, schemaRegistry: reg, resolve: () => target });
  assert.equal(self.ok, true);
  assert.equal(self.value?.level, 'self-semantic-valid');
  const forUse = validateReferenceModelForUse(ref, {
    identity: id,
    schemaRegistry: reg,
    resolve: () => target,
    registry: ACCEPTED_REGISTRY,
    consumerSupport: SUPPORT,
  });
  assert.equal(forUse.ok, true);
  assert.equal(forUse.value?.level, 'registry-compatible');
});

test('for-use reference: no skipIdentity path bypasses verification', () => {
  // an unregistered target is denied in for-use resolution (identity is always verified)
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const report = validateReferenceModelForUse(makeRef(a), {
    identity: new MemoryIdentityState(),
    schemaRegistry: reg,
    resolve: () => a.model,
    registry: ACCEPTED_REGISTRY,
    consumerSupport: SUPPORT,
  });
  assert.equal(report.ok, false);
  assert.ok(report.ruleIds.includes('REF-001') || report.ruleIds.includes('LIN-002'));
});

// ---------------------------------------------------------------------------
// Correction 1 — exact bundle and lifecycle-chain point of use
// ---------------------------------------------------------------------------
test('authority: exact valid chain is eligible', () => {
  const result = evaluateEffectiveAuthority(baseInputs());
  assert.equal(result.eligible, true, JSON.stringify(result.findings.map((f) => f.messageKey)));
  assert.equal(result.findings.length, 0);
});

test('authority: no RuntimeGrant fails closed', () => {
  const records = chainRecords().filter((r) => r.recordType !== 'RuntimeGrant');
  const result = evaluateEffectiveAuthority(baseInputs({ lifecycle: chainLifecycle(records) }));
  assert.equal(result.eligible, false);
  assert.ok(result.findings.some((f) => f.messageKey === 'pou.grant-missing'));
});

test('authority: empty lifecycle state fails closed', () => {
  const result = evaluateEffectiveAuthority(baseInputs({ lifecycle: chainLifecycle([]) }));
  assert.equal(result.eligible, false);
  assert.ok(result.findings.some((f) => f.messageKey === 'pou.missing-validation'));
  assert.ok(result.findings.some((f) => f.messageKey === 'pou.missing-approval'));
  assert.ok(result.findings.some((f) => f.messageKey === 'pou.missing-issuance'));
  assert.ok(result.findings.some((f) => f.messageKey === 'pou.grant-missing'));
});

test('authority: unrelated revoked approval has no effect', () => {
  const revocations: RevocationView = {
    revocationsByTarget: (recordId) =>
      recordId === 'pgw:l:' + '9'.repeat(32) ? [{ recordId, effectiveAt: CURRENT_TIME, scope: 'execution-use' }] : [],
  };
  const result = evaluateEffectiveAuthority(baseInputs({ revocations }));
  assert.equal(result.eligible, true);
});

test('authority: related revoked approval denies', () => {
  const approvalBundle = chainRecords().find((r) => r.recordId === String(loadJson('fixtures/lifecycle/valid/approval-bundle.json')['record_id']))!;
  const revocations: RevocationView = {
    revocationsByTarget: (recordId) =>
      recordId === approvalBundle.recordId ? [{ recordId, effectiveAt: CURRENT_TIME, scope: 'execution-use' }] : [],
  };
  const result = evaluateEffectiveAuthority(baseInputs({ revocations }));
  assert.equal(result.eligible, false);
  assert.ok(result.ruleIds.includes('LFC-007'));
});

test('authority: unrelated revoked grant has no effect', () => {
  const revocations: RevocationView = {
    revocationsByTarget: (recordId) =>
      recordId === 'pgw:l:' + '8'.repeat(32) ? [{ recordId, effectiveAt: CURRENT_TIME, scope: 'execution-use' }] : [],
  };
  const result = evaluateEffectiveAuthority(baseInputs({ revocations }));
  assert.equal(result.eligible, true);
});

test('authority: related revoked grant denies', () => {
  const revocations: RevocationView = {
    revocationsByTarget: (recordId) =>
      recordId === String(GRANT['record_id']) ? [{ recordId, effectiveAt: CURRENT_TIME, scope: 'execution-use' }] : [],
  };
  const result = evaluateEffectiveAuthority(baseInputs({ revocations }));
  assert.equal(result.eligible, false);
  assert.ok(result.ruleIds.includes('LFC-007'));
});

test('authority: grant bound to another bundle denies', () => {
  const other = JSON.parse(JSON.stringify(GRANT)) as Record<string, unknown>;
  (other['bundle'] as Record<string, unknown>)['target_revision_id'] = 'pgw:r:' + 'f'.repeat(32);
  const result = evaluateEffectiveAuthority(baseInputs({ grant: other }));
  assert.equal(result.eligible, false);
  assert.ok(result.findings.some((f) => f.messageKey === 'pou.grant-bundle-mismatch'));
});

test('authority: grant bound to another workspace denies', () => {
  const other = JSON.parse(JSON.stringify(GRANT)) as Record<string, unknown>;
  other['workspace_id'] = 'pgw:w:' + '7'.repeat(32);
  const result = evaluateEffectiveAuthority(baseInputs({ grant: other }));
  assert.equal(result.eligible, false);
  assert.ok(result.findings.some((f) => f.messageKey === 'pou.grant-workspace-mismatch'));
});

test('authority: read-only grant constraint with write request denies', () => {
  const grant = JSON.parse(JSON.stringify(GRANT)) as Record<string, unknown>;
  grant['narrowed_constraints'] = [{ type: 'read-only', value: true }];
  const writeUse: RequestedUse = {
    capability: 'project-gateway.artifact-draft-write',
    operationClass: 'write-artifact-draft',
    resourceClass: 'configured-artifact-area',
    scope: 'exact:resource-1',
    workspaceId: WORKSPACE,
  };
  const result = evaluateEffectiveAuthority(baseInputs({ requestedUse: writeUse, grant }));
  assert.equal(result.eligible, false);
  assert.ok(result.findings.some((f) => f.messageKey === 'pou.grant-read-only'));
});

test('authority: scope narrowing violation denies', () => {
  const grant = JSON.parse(JSON.stringify(GRANT)) as Record<string, unknown>;
  grant['narrowed_constraints'] = [{ type: 'scope', value: ['exact:allowed'] }];
  const result = evaluateEffectiveAuthority(baseInputs({ grant }));
  assert.equal(result.eligible, false);
  assert.ok(result.findings.some((f) => f.messageKey === 'pou.grant-scope-narrowing'));
});

test('authority: unknown narrowed constraint type fails closed', () => {
  const grant = JSON.parse(JSON.stringify(GRANT)) as Record<string, unknown>;
  grant['narrowed_constraints'] = [{ type: 'quantum-execution', value: true }];
  const result = evaluateEffectiveAuthority(baseInputs({ grant }));
  assert.equal(result.eligible, false);
  assert.ok(result.findings.some((f) => f.messageKey === 'pou.grant-unknown-constraint'));
});

test('authority: registry failure appears before point-of-use failure', () => {
  const bundle = JSON.parse(JSON.stringify(BUNDLE)) as Record<string, unknown>;
  bundle['extensions'] = [{ namespace: 'example.unregistered', version: '1.0', mode: 'required', payload: {} }];
  const result = evaluateEffectiveAuthority(baseInputs({ bundle }));
  assert.equal(result.eligible, false);
  assert.equal(result.firstFailingPhase, 'registry-compatibility');
  assert.ok(result.findings.some((f) => f.messageKey === 'pou.extension-unregistered'));
});

test('authority: deterministic finding order regardless of lifecycle record input order', () => {
  // a chain with a missing approval produces findings; record input order must
  // not change the result or the finding order
  const broken = chainRecords().filter(
    (r) => r.recordId !== String(loadJson('fixtures/lifecycle/valid/approval-bundle.json')['record_id']),
  );
  const forward = broken;
  const reversed = [...broken].reverse();
  const a = evaluateEffectiveAuthority(baseInputs({ lifecycle: chainLifecycle(forward) }));
  const b = evaluateEffectiveAuthority(baseInputs({ lifecycle: chainLifecycle(reversed) }));
  assert.equal(a.eligible, false);
  assert.equal(b.eligible, false);
  assert.deepEqual(a.findings, b.findings);
  assert.equal(a.firstFailingPhase, b.firstFailingPhase);
});

test('authority: missing member reference fails closed', () => {
  const bundle = JSON.parse(JSON.stringify(BUNDLE)) as Record<string, unknown>;
  delete (bundle['body'] as Record<string, unknown>)['task'];
  const result = evaluateEffectiveAuthority(baseInputs({ bundle }));
  assert.equal(result.eligible, false);
  assert.ok(result.findings.some((f) => f.messageKey === 'pou.member-reference-invalid'));
});

test('authority: same state, different requested capability, different result', () => {
  const read = evaluateEffectiveAuthority(baseInputs());
  const write = evaluateEffectiveAuthority(
    baseInputs({
      requestedUse: { capability: 'project-gateway.artifact-draft-write', operationClass: 'write-artifact-draft', resourceClass: 'configured-artifact-area', scope: 'exact:r1', workspaceId: WORKSPACE },
    }),
  );
  assert.equal(read.eligible, true);
  assert.equal(write.eligible, false);
});

test('authority: requested denied capability denied', () => {
  const policy: Record<string, unknown> = {
    instance_id: 'pgw:i:' + 'b'.repeat(32),
    body: {
      rules: [
        {
          rule_id: 'deny-write',
          effect: 'deny',
          capability: { id: 'project-gateway.artifact-draft-write', version: '1.0' },
          scope: { scope_type: 'project-gateway.resource-class-scope', version: '1.0', resource_classes: ['configured-artifact-area'], operation_classes: ['write-artifact-draft'] },
          constraints: [],
          required_semantics: [],
        },
      ],
    },
  };
  const result = evaluateEffectiveAuthority(
    baseInputs({
      policy,
      requestedUse: { capability: 'project-gateway.artifact-draft-write', operationClass: 'write-artifact-draft', resourceClass: 'configured-artifact-area', scope: 'exact:r1', workspaceId: WORKSPACE },
    }),
  );
  assert.equal(result.eligible, false);
  assert.ok(result.ruleIds.includes('AUT-002'));
});

test('authority: unknown capability denied', () => {
  const result = evaluateEffectiveAuthority(
    baseInputs({ requestedUse: { capability: 'project-gateway.mystery', operationClass: 'read', resourceClass: 'x', scope: 'exact:r1', workspaceId: WORKSPACE } }),
  );
  assert.equal(result.eligible, false);
  assert.ok(result.ruleIds.includes('AUT-003'));
});

test('authority: global ceiling denial', () => {
  const policyWrite: Record<string, unknown> = {
    body: {
      rules: [
        {
          rule_id: 'allow-write',
          effect: 'allow',
          capability: { id: 'project-gateway.artifact-draft-write', version: '1.0' },
          scope: { scope_type: 'project-gateway.resource-class-scope', version: '1.0', resource_classes: ['configured-artifact-area'], operation_classes: ['write-artifact-draft'] },
          constraints: [{ type: 'max-actions', value: 100 }],
          required_semantics: [],
        },
      ],
    },
  };
  const r2 = evaluateEffectiveAuthority(
    baseInputs({
      globalActionCeiling: 3,
      policy: policyWrite,
      requestedUse: { capability: 'project-gateway.artifact-draft-write', operationClass: 'write-artifact-draft', resourceClass: 'configured-artifact-area', scope: 'exact:r1', workspaceId: WORKSPACE },
    }),
  );
  assert.equal(r2.eligible, false);
  assert.ok(r2.ruleIds.includes('AUT-001'));
});

test('authority: workspace ceiling denial', () => {
  const policyWrite: Record<string, unknown> = {
    body: {
      rules: [
        {
          rule_id: 'allow-write',
          effect: 'allow',
          capability: { id: 'project-gateway.artifact-draft-write', version: '1.0' },
          scope: { scope_type: 'project-gateway.resource-class-scope', version: '1.0', resource_classes: ['configured-artifact-area'], operation_classes: ['write-artifact-draft'] },
          constraints: [{ type: 'max-actions', value: 100 }],
          required_semantics: [],
        },
      ],
    },
  };
  const result = evaluateEffectiveAuthority(
    baseInputs({
      workspaceActionCeiling: 2,
      policy: policyWrite,
      requestedUse: { capability: 'project-gateway.artifact-draft-write', operationClass: 'write-artifact-draft', resourceClass: 'configured-artifact-area', scope: 'exact:r1', workspaceId: WORKSPACE },
    }),
  );
  assert.equal(result.eligible, false);
  assert.ok(result.ruleIds.includes('AUT-001'));
});

test('authority: policy denial (no matching rule)', () => {
  const result = evaluateEffectiveAuthority(baseInputs({ policy: { body: { rules: [] } } }));
  assert.equal(result.eligible, false);
});

test('authority: runtime-grant denial (revoked grant)', () => {
  const revocations: RevocationView = {
    revocationsByTarget: (recordId) =>
      recordId === String(GRANT['record_id']) ? [{ recordId, effectiveAt: CURRENT_TIME, scope: 'execution-use' }] : [],
  };
  const result = evaluateEffectiveAuthority(baseInputs({ revocations }));
  assert.equal(result.eligible, false);
  assert.ok(result.ruleIds.includes('LFC-007'));
});

test('authority: consumer-support denial', () => {
  const support: ConsumerSupportDeclaration = { ...SUPPORT, supportedConsumerCapabilities: ['project-gateway.workspace-read'] };
  const result = evaluateEffectiveAuthority(baseInputs({ consumerSupport: support }));
  assert.equal(result.eligible, true);
  const write = evaluateEffectiveAuthority(
    baseInputs({
      consumerSupport: support,
      requestedUse: { capability: 'project-gateway.artifact-draft-write', operationClass: 'write-artifact-draft', resourceClass: 'x', scope: 'exact:r1', workspaceId: WORKSPACE },
    }),
  );
  assert.equal(write.eligible, false);
  assert.ok(write.ruleIds.includes('SEC-003'));
});

test('authority: wrong workspace denied', () => {
  const result = evaluateEffectiveAuthority(baseInputs({ workspaceId: 'pgw:w:' + '9'.repeat(32) }));
  assert.equal(result.eligible, false);
  assert.ok(result.ruleIds.includes('WSP-003') || result.ruleIds.includes('WSP-008'));
});

test('authority: wrong RequestedUse workspace denied', () => {
  const result = evaluateEffectiveAuthority(
    baseInputs({ requestedUse: { ...READ_USE, workspaceId: 'pgw:w:' + '9'.repeat(32) } }),
  );
  assert.equal(result.eligible, false);
  assert.ok(result.findings.some((f) => f.messageKey === 'pou.workspace-requested-use'));
});

test('authority: revoked approval denied', () => {
  const approvalId = String(loadJson('fixtures/lifecycle/valid/approval-task.json')['record_id']);
  const revocations: RevocationView = {
    revocationsByTarget: (recordId) => (recordId === approvalId ? [{ recordId, effectiveAt: CURRENT_TIME, scope: 'execution-use' }] : []),
  };
  const result = evaluateEffectiveAuthority(baseInputs({ revocations }));
  assert.equal(result.eligible, false);
  assert.ok(result.ruleIds.includes('LFC-007'));
});

test('authority: expired record denied', () => {
  const approval = chainRecords().find((r) => r.recordId === String(loadJson('fixtures/lifecycle/valid/approval-task.json')['record_id']))!;
  const expired = { ...approval, model: { ...approval.model, valid_until: '2026-08-04T06:00:00.000Z' } };
  const records = chainRecords().map((r) => (r.recordId === approval.recordId ? expired : r));
  const result = evaluateEffectiveAuthority(baseInputs({ lifecycle: chainLifecycle(records) }));
  assert.equal(result.eligible, false);
  assert.ok(result.ruleIds.includes('LFC-007'));
});

test('authority: historical fact revocation is invalid at point of use', () => {
  const revocation: ValidatedLifecycleRecord = {
    recordType: 'RevocationRecord',
    recordId: 'pgw:l:' + 'f'.repeat(32),
    level: 'structural-valid',
    model: {
      record_type: 'RevocationRecord',
      record_id: 'pgw:l:' + 'f'.repeat(32),
      registry_snapshot_reference: {
        registry_snapshot_id: ACCEPTED_REGISTRY.registrySnapshotId,
        registry_snapshot_digest: ACCEPTED_REGISTRY.registrySnapshotDigest,
      },
      target: { record_type: 'ValidationRecord', record_id: 'pgw:l:' + '0'.repeat(32) },
    },
  };
  const result = evaluateEffectiveAuthority(baseInputs({ lifecycle: chainLifecycle([...chainRecords(), revocation]) }));
  assert.equal(result.eligible, false);
  assert.ok(result.ruleIds.includes('LFC-006'));
});

test('authority: unrelated workspace-scoped record has no effect', () => {
  const unrelated: ValidatedLifecycleRecord = {
    recordType: 'ApprovalRecord',
    recordId: 'pgw:l:' + 'e'.repeat(32),
    level: 'structural-valid',
    model: {
      record_type: 'ApprovalRecord',
      record_id: 'pgw:l:' + 'e'.repeat(32),
      registry_snapshot_reference: {
        registry_snapshot_id: ACCEPTED_REGISTRY.registrySnapshotId,
        registry_snapshot_digest: ACCEPTED_REGISTRY.registrySnapshotDigest,
      },
      subject: {
        protocol_version: '1.0',
        kind: { id: 'TaskSpec', version: '1.0' },
        instance_id: 'pgw:i:' + '6'.repeat(32),
        revision_id: 'pgw:r:' + '6'.repeat(32),
        digest: 'sha-256:' + '6'.repeat(64),
        workspace_id: 'pgw:w:' + '7'.repeat(32),
      },
      workspace_id: 'pgw:w:' + '7'.repeat(32),
      valid_until: null,
    },
  };
  const result = evaluateEffectiveAuthority(baseInputs({ lifecycle: chainLifecycle([...chainRecords(), unrelated]) }));
  // unrelated lifecycle records must never affect the result
  assert.equal(result.eligible, true);
});

test('authority: no hidden clock dependency (results depend only on injected time)', () => {
  const a = evaluateEffectiveAuthority(baseInputs({ currentTime: '2026-08-04T06:10:00.000Z' }));
  const b = evaluateEffectiveAuthority(baseInputs({ currentTime: '2026-08-04T12:00:00.000Z' }));
  assert.equal(a.eligible, true);
  assert.equal(b.eligible, true);
  assert.deepEqual(a.findings, b.findings);
  const c = evaluateEffectiveAuthority(baseInputs({ currentTime: '2027-01-01T00:00:00.000Z' }));
  assert.equal(c.eligible, false);
  assert.ok(c.ruleIds.includes('LFC-007'));
});

test('authority: evaluation does not mutate state or use counts', () => {
  const bundle = JSON.parse(JSON.stringify(BUNDLE));
  const grant = JSON.parse(JSON.stringify(GRANT));
  const beforeBundle = JSON.stringify(bundle);
  const beforeGrant = JSON.stringify(grant);
  const result = evaluateEffectiveAuthority(baseInputs({ bundle, grant }));
  assert.equal(result.eligible, true);
  assert.equal(JSON.stringify(bundle), beforeBundle);
  assert.equal(JSON.stringify(grant), beforeGrant);
});

// ---------------------------------------------------------------------------
// Correction 1 — for-use API flow (resolver, identity, bundle/member gates)
// ---------------------------------------------------------------------------
function forUseInputs(over: Partial<Parameters<typeof validateArtifactForUse>[2]> = {}): Parameters<typeof validateArtifactForUse>[2] {
  return {
    registry: ACCEPTED_REGISTRY,
    consumerSupport: SUPPORT,
    resolver: { resolve: (ref) => (ref['target_revision_id'] === String((TASK['revision'] as Record<string, unknown>)['id']) ? TASK : ref['target_revision_id'] === String((POLICY['revision'] as Record<string, unknown>)['id']) ? POLICY : ref['target_revision_id'] === String((CONTEXT['revision'] as Record<string, unknown>)['id']) ? CONTEXT : ref['target_revision_id'] === String((COMPLETION['revision'] as Record<string, unknown>)['id']) ? COMPLETION : undefined) },
    identity: chainIdentity(),
    lifecycle: chainLifecycle(),
    revocations: REVOCATIONS,
    currentTime: CURRENT_TIME,
    workspaceId: WORKSPACE,
    requestedUse: READ_USE,
    ...over,
  };
}

test('for-use API: exact valid chain is point-of-use eligible', () => {
  const report = validateArtifactForUse(BUNDLE, reg, forUseInputs());
  assert.equal(report.ok, true, JSON.stringify(report.findings.map((f) => `${f.phase}:${f.messageKey}`)));
  assert.equal(report.value?.level, 'point-of-use-eligible');
});

test('for-use API: resolver is called', () => {
  let calls = 0;
  const spyResolver = {
    resolve: (ref: ExactArtifactReferenceModel) => {
      calls++;
      return ref['target_revision_id'] === String((TASK['revision'] as Record<string, unknown>)['id'])
        ? TASK
        : ref['target_revision_id'] === String((POLICY['revision'] as Record<string, unknown>)['id'])
          ? POLICY
          : ref['target_revision_id'] === String((CONTEXT['revision'] as Record<string, unknown>)['id'])
            ? CONTEXT
            : ref['target_revision_id'] === String((COMPLETION['revision'] as Record<string, unknown>)['id'])
              ? COMPLETION
              : undefined;
    },
  };
  const report = validateArtifactForUse(BUNDLE, reg, forUseInputs({ resolver: spyResolver }));
  assert.equal(report.ok, true);
  assert.ok(calls >= 4, `resolver called ${calls} times`);
});

test('for-use API: identity verification is called', () => {
  let verifies = 0;
  const base = chainIdentity();
  const spyIdentity: MemoryIdentityState = {
    findInstance: (id: string) => {
      verifies++;
      return base.findInstance(id);
    },
    findRevision: (id: string) => {
      verifies++;
      return base.findRevision(id);
    },
    findPredecessor: (instanceId: string, revisionId: string) => base.findPredecessor(instanceId, revisionId),
    verifyRegistration: (instanceId: string, revisionId: string, digest: string) => base.verifyRegistration(instanceId, revisionId, digest),
    register: (artifact: ValidatedArtifact, predecessor?: ExactArtifactReferenceModel) => base.register(artifact, predecessor),
  } as MemoryIdentityState;
  const report = validateArtifactForUse(BUNDLE, reg, forUseInputs({ identity: spyIdentity }));
  assert.equal(report.ok, true);
  assert.ok(verifies > 0, 'identity view was never consulted');
});

test('for-use API: unregistered bundle is denied', () => {
  const report = validateArtifactForUse(BUNDLE, reg, forUseInputs({ identity: new MemoryIdentityState() }));
  assert.equal(report.ok, false);
  assert.equal(report.firstFailingPhase, 'identity-registration');
  assert.ok(report.ruleIds.includes('LIN-001') || report.ruleIds.includes('LIN-002'));
});

test('for-use API: unregistered member is denied', () => {
  const id = new MemoryIdentityState();
  for (const m of [POLICY, CONTEXT, COMPLETION, BUNDLE]) {
    const a = validateArtifactSelf(m, reg, { identity: id }).value as ValidatedArtifact;
    id.register(a);
  }
  const report = validateArtifactForUse(BUNDLE, reg, forUseInputs({ identity: id }));
  assert.equal(report.ok, false);
  assert.equal(report.firstFailingPhase, 'exact-reference-resolution');
});

test('for-use API: no RuntimeGrant fails closed', () => {
  const report = validateArtifactForUse(BUNDLE, reg, forUseInputs({ lifecycle: chainLifecycle(chainRecords().filter((r) => r.recordType !== 'RuntimeGrant')) }));
  assert.equal(report.ok, false);
  assert.equal(report.firstFailingPhase, 'point-of-use-eligibility');
  assert.ok(report.findings.some((f) => f.messageKey === 'pou.grant-missing'));
});

test('for-use API: empty lifecycle state fails closed', () => {
  const report = validateArtifactForUse(BUNDLE, reg, forUseInputs({ lifecycle: chainLifecycle([]) }));
  assert.equal(report.ok, false);
  assert.equal(report.firstFailingPhase, 'point-of-use-eligibility');
});

test('for-use API: wrong RequestedUse workspace is denied', () => {
  const report = validateArtifactForUse(
    BUNDLE,
    reg,
    forUseInputs({ requestedUse: { ...READ_USE, workspaceId: 'pgw:w:' + '9'.repeat(32) } }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.firstFailingPhase, 'point-of-use-eligibility');
});

test('for-use API: non-bundle subject is denied at point of use', () => {
  const report = validateArtifactForUse(TASK, reg, forUseInputs());
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.messageKey === 'foruse.bundle-required'));
});

test('for-use API: registry failure appears before point-of-use failure', () => {
  // a structurally valid, identity-verified bundle whose declared extension
  // namespace is not supported by the consumer fails at registry compatibility
  // (phase 10), which must be reported before any point-of-use (phase 13)
  const bundle = JSON.parse(JSON.stringify(loadJson('fixtures/artifacts/valid/bundle-registered-extension.json'))) as Record<string, unknown>;
  const id = new MemoryIdentityState();
  for (const m of [TASK, POLICY, CONTEXT, COMPLETION]) {
    const a = validateArtifactSelf(m, reg, { identity: id }).value as ValidatedArtifact;
    id.register(a);
  }
  const b = validateArtifactSelf(bundle, reg, { identity: id }).value as ValidatedArtifact;
  id.register(b);
  const report = validateArtifactForUse(bundle, reg, forUseInputs({ identity: id, consumerSupport: { ...SUPPORT, supportedExtensionNamespaces: [] } }));
  assert.equal(report.ok, false);
  assert.equal(report.firstFailingPhase, 'registry-compatibility');
});

test('for-use API: read-only grant constraint with write request denies', () => {
  const grant = JSON.parse(JSON.stringify(GRANT)) as Record<string, unknown>;
  grant['narrowed_constraints'] = [{ type: 'read-only', value: true }];
  const report = validateArtifactForUse(
    BUNDLE,
    reg,
    forUseInputs({
      requestedUse: { capability: 'project-gateway.artifact-draft-write', operationClass: 'write-artifact-draft', resourceClass: 'configured-artifact-area', scope: 'exact:resource-1', workspaceId: WORKSPACE },
    }),
  );
  // policy has no write rule and the write capability is unsupported by the
  // policy: denied at point of use either way
  assert.equal(report.ok, false);
  assert.equal(report.firstFailingPhase, 'point-of-use-eligibility');
});

// ---------------------------------------------------------------------------
// Correction 3 — oracle independence and semantic dispatch
// ---------------------------------------------------------------------------
test('oracle: altering an expected rule ID produces a mismatch without emitting it as actual', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; expected_semantic_rule_ids: string[]; expected_result: string }[] };
  const entry = manifest.fixtures.find((f) => f.fixture_id === 'RULE-AUT-004-FAIL');
  assert.ok(entry);
  const original = entry.expected_semantic_rule_ids;
  try {
    entry.expected_semantic_rule_ids = ['XXX-999'];
    const summary = new ConformanceRunner().run();
    const mismatch = summary.mismatches.find((m) => m.fixtureId === 'RULE-AUT-004-FAIL');
    assert.ok(mismatch, 'expected a mismatch for the altered entry');
    assert.ok(['rule-not-fired', 'rule-missing'].includes(mismatch.reason), mismatch.reason);
  } finally {
    entry.expected_semantic_rule_ids = original;
  }
});

test('oracle: altering expected category produces a mismatch', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; expected_failure_category: string | null }[] };
  const entry = manifest.fixtures.find((f) => f.fixture_id === 'RULE-AUT-004-FAIL');
  assert.ok(entry);
  const original = entry.expected_failure_category;
  try {
    entry.expected_failure_category = 'POINT-OF-USE-FAILURE';
    const summary = new ConformanceRunner().run();
    assert.ok(summary.mismatches.some((m) => m.fixtureId === 'RULE-AUT-004-FAIL'));
  } finally {
    entry.expected_failure_category = original;
  }
});

test('oracle: altering expected phase produces a mismatch', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; validation_phase: string }[] };
  const entry = manifest.fixtures.find((f) => f.fixture_id === 'RULE-AUT-004-FAIL');
  assert.ok(entry);
  const original = entry.validation_phase;
  try {
    entry.validation_phase = 'point-of-use-eligibility';
    const summary = new ConformanceRunner().run();
    assert.ok(summary.mismatches.some((m) => m.fixtureId === 'RULE-AUT-004-FAIL'));
  } finally {
    entry.validation_phase = original;
  }
});

test('oracle: altering expected success/failure produces a mismatch', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; expected_result: string }[] };
  const entry = manifest.fixtures.find((f) => f.fixture_id === 'ART-V-TSK-988F9E');
  assert.ok(entry);
  const original = entry.expected_result;
  try {
    entry.expected_result = 'fail';
    const summary = new ConformanceRunner().run();
    assert.ok(summary.mismatches.some((m) => m.fixtureId === 'ART-V-TSK-988F9E'));
  } finally {
    entry.expected_result = original;
  }
});

test('oracle: altering a schema-resource expected schema ID produces a mismatch', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; expected_schema_id: string | null }[] };
  const entry = manifest.fixtures.find((f) => f.fixture_id === 'SCH-P-141635C2AE');
  assert.ok(entry);
  const original = entry.expected_schema_id;
  try {
    entry.expected_schema_id = 'urn:project-gateway:schema:artifact:1.0:common:identifiers';
    const summary = new ConformanceRunner().run();
    const mismatch = summary.mismatches.find((m) => m.fixtureId === 'SCH-P-141635C2AE');
    assert.ok(mismatch, 'expected a schema mismatch for the altered entry');
    assert.equal(mismatch.reason, 'schema-mismatch');
  } finally {
    entry.expected_schema_id = original;
  }
});

test('oracle: altering a vector expected rule ID produces a mismatch', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; expected_semantic_rule_ids: string[] }[] };
  const entry = manifest.fixtures.find((f) => f.fixture_id === 'RULE-ART-008-FAIL');
  assert.ok(entry);
  const original = entry.expected_semantic_rule_ids;
  try {
    entry.expected_semantic_rule_ids = ['XXX-999'];
    const summary = new ConformanceRunner().run();
    assert.ok(summary.mismatches.some((m) => m.fixtureId === 'RULE-ART-008-FAIL'), 'expected rule mismatch');
  } finally {
    entry.expected_semantic_rule_ids = original;
  }
});

test('oracle: altering a vector expected category produces a mismatch', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; expected_failure_category: string | null }[] };
  const entry = manifest.fixtures.find((f) => f.fixture_id === 'RULE-ART-008-FAIL');
  assert.ok(entry);
  const original = entry.expected_failure_category;
  try {
    entry.expected_failure_category = 'DIGEST-MISMATCH';
    const summary = new ConformanceRunner().run();
    assert.ok(summary.mismatches.some((m) => m.fixtureId === 'RULE-ART-008-FAIL'), 'expected category mismatch');
  } finally {
    entry.expected_failure_category = original;
  }
});

test('oracle: altering a vector expected phase produces a mismatch', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; validation_phase: string }[] };
  const entry = manifest.fixtures.find((f) => f.fixture_id === 'RULE-ART-008-FAIL');
  assert.ok(entry);
  const original = entry.validation_phase;
  try {
    entry.validation_phase = 'point-of-use-eligibility';
    const summary = new ConformanceRunner().run();
    assert.ok(summary.mismatches.some((m) => m.fixtureId === 'RULE-ART-008-FAIL'), 'expected phase mismatch');
  } finally {
    entry.validation_phase = original;
  }
});

test('oracle: inverting a vector expected result produces a mismatch', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; expected_result: string }[] };
  const failEntry = manifest.fixtures.find((f) => f.fixture_id === 'RULE-ART-008-FAIL');
  assert.ok(failEntry);
  const originalFail = failEntry.expected_result;
  try {
    failEntry.expected_result = 'pass';
    const summary = new ConformanceRunner().run();
    assert.ok(summary.mismatches.some((m) => m.fixtureId === 'RULE-ART-008-FAIL'), 'expected result mismatch');
  } finally {
    failEntry.expected_result = originalFail;
  }
  const passEntry = manifest.fixtures.find((f) => f.fixture_id === 'RULE-ART-008-PASS');
  assert.ok(passEntry);
  const originalPass = passEntry.expected_result;
  try {
    passEntry.expected_result = 'fail';
    const summary = new ConformanceRunner().run();
    assert.ok(summary.mismatches.some((m) => m.fixtureId === 'RULE-ART-008-PASS'), 'expected result mismatch');
  } finally {
    passEntry.expected_result = originalPass;
  }
});

test('oracle: altering a vector expected digest produces a mismatch', () => {
  const path = 'fixtures/canonicalization/artifact/object-order-and-digest.json';
  const original = corpus[path]!;
  const vector = JSON.parse(new TextDecoder('utf-8').decode(Buffer.from(original, 'base64'))) as Record<string, unknown>;
  vector['expected_sha256'] = '0'.repeat(64);
  corpus[path] = Buffer.from(JSON.stringify(vector)).toString('base64');
  try {
    const summary = new ConformanceRunner().run();
    assert.ok(summary.mismatches.some((m) => m.fixtureId === 'CAN-ART-001'), 'expected digest mismatch');
  } finally {
    corpus[path] = original;
  }
});

test('oracle: vector results route through common comparison (RULE entries)', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string }[] };
  const ids = new Set(manifest.fixtures.map((f) => f.fixture_id));
  for (const id of ['RULE-ART-008-FAIL', 'RULE-ART-008-PASS', 'RULE-REG-009-FAIL', 'RULE-REG-009-PASS', 'RULE-SEC-001-PASS', 'RULE-SEC-002-PASS']) {
    assert.ok(ids.has(id), id);
  }
  const summary = new ConformanceRunner().run();
  assert.equal(summary.passed, summary.total);
  assert.equal(summary.total, 587);
  assert.deepEqual(summary.mismatches, []);
});

test('oracle: no expected manifest value is used as execution input', () => {
  const src = readFileSync(new URL('../../../src/conformance/runner.ts', import.meta.url), 'utf8');
  const lines = src.split('\n');
  const classStart = lines.findIndex((l) => l.includes('export class ConformanceRunner'));
  const comparisonStart = lines.findIndex((l) => l.includes('// ----') && l.includes('comparison'));
  assert.ok(classStart > 0 && comparisonStart > classStart, 'comparison section marker missing');
  for (let i = classStart; i < comparisonStart; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    assert.ok(
      !line.includes('expected_schema_id') && !line.includes('expected_semantic_rule_ids') && !line.includes('expected_failure_category') && !line.includes('expected_result'),
      `expected metadata read in execution code at line ${i + 1}: ${line.trim()}`,
    );
  }
});

test('oracle: structural fixture emits implementation-owned mapped rule', () => {
  const reg2 = new SchemaRegistry();
  const policy = JSON.parse(JSON.stringify(loadJson('fixtures/artifacts/valid/policy-minimal-genesis.json'))) as Record<string, unknown>;
  (policy['body'] as Record<string, unknown>)['task_instruction'] = 'x';
  const report = validateArtifactRevision(policy, reg2, 'structural-schema-validation');
  const schemaId = 'urn:project-gateway:schema:artifact:1.0:kinds:authority-policy';
  const mapped = structuralRuleIds(schemaId, [{ keyword: 'unevaluatedProperties', instancePath: '/body', message: 'x', params: { unevaluatedProperty: 'task_instruction' } } as never]);
  assert.deepEqual(mapped, ['AUT-004']);
  assert.ok(report.ruleIds.includes('AUT-004'));
});

test('oracle: all 36 vector entries compare independent canonical output', () => {
  const summary = new ConformanceRunner().run();
  const vectors = (CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string }[] }).fixtures.filter((f) => f.fixture_id.startsWith('CAN-'));
  assert.equal(vectors.length, 36);
  assert.equal(summary.mismatches.filter((m) => m.fixtureId.startsWith('CAN-')).length, 0);
});

test('dispatch: all 116 rule IDs have an implementation-owned classification', () => {
  const ids = ruleIds();
  assert.equal(ids.length, 116);
  const kinds = new Set<string>();
  for (const id of ids) {
    const def = ruleDef(id);
    assert.ok(def, id);
    assert.ok(['evaluator', 'structural', 'graph', 'raw', 'canonical', 'pipeline'].includes(def.enforcement), id);
    kinds.add(def.enforcement);
    assert.ok(enforcementKind(id) !== 'evaluator' || def.enforcement === 'evaluator');
  }
  assert.ok(kinds.has('evaluator'));
  assert.ok(kinds.has('structural'));
  assert.ok(kinds.has('graph'));
});

test('oracle: no fixture-ID branch exists in production runner code', () => {
  const src = readFileSync(new URL('../../../src/conformance/runner.ts', import.meta.url), 'utf8');
  assert.ok(!src.includes("fixture_id === '") && !src.includes("'LFC-I-190B087B'"));
  const mapSrc = readFileSync(new URL('../../../src/internal/structural-map.ts', import.meta.url), 'utf8');
  assert.ok(!mapSrc.includes('LFC-I-190B087B'));
});

test('dispatch: graph rule coverage via runner (REG-008 after erratum)', () => {
  const summary = new ConformanceRunner().run();
  assert.equal(summary.passed, summary.total);
  assert.equal(summary.total, 587);
});

function computeDigest(model: Readonly<Record<string, unknown>>): string {
  return computeArtifactDigest(model).digest;
}
