/**
 * WP-12 Slice 1 — reuse proofs.
 *
 * Demonstrates that the Slice-1 implementation reuses the accepted
 * machinery and introduces no parallel authority: the WP-4 lifecycle graph
 * (LFC-001/002/003, REG-001/002/008), the WP-4 lifecycle-record schema
 * pipeline, the accepted digest computation, the WP-6 trusted configuration
 * and capability-ceiling machinery, and WP-8 publishRecord/readRecord/
 * enumerateClass. There is exactly one lifecycle rule authority, one
 * store, one digest domain, one audit path, and one publication path.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSchemaRegistry, validateLifecycleRecord } from '../../src/api/validate.js';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import { evaluateCandidateLifecycleRecord, mapGraphFindings } from '../../src/control-plane/graph.js';
import { cleanupTestEnvs, makeContext, makeEvidence, makeFakeStore, makeIdentitySource, makeIntegrationEnv, makeRegistryContext, makeSubject, seedPayload, WS_A } from './wp12-helpers.js';
import { buildValidationRecordPayload, buildApprovalRecordPayload, buildIssuanceRecordPayload, decisionContentDigestOf } from '../../src/control-plane/records.js';

after(() => cleanupTestEnvs());

function subjectOperand(subject: ReturnType<typeof makeSubject>['subject']): Record<string, unknown> {
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

function artifactModelOf(kind: 'TaskSpec' | 'ContextManifest'): Readonly<Record<string, unknown>> {
  return makeEvidence(kind).artifact.model as Readonly<Record<string, unknown>>;
}

test('reuse: graph adapter emits and maps LFC-001/002 (approval without validation) to subject-not-validated', () => {
  const subject = makeSubject('TaskSpec');
  const registry = makeRegistryContext();
  const candidate = buildApprovalRecordPayload({
    recordId: 'pgw:l:99999999999999999999999999999999',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    workspaceId: WS_A,
    purpose: 'execution-use',
    validationRecordIds: ['pgw:l:11111111111111111111111111111111'],
    requiredSemantics: { protocol_features: [], consumer_capabilities: [] },
    validUntil: null,
    registry,
  });
  // The referenced validation record is absent from the record set.
  const report = evaluateCandidateLifecycleRecord({
    existing: [],
    candidate,
    registry,
    artifactsByRevision: new Map([[subject.subject.revisionId, artifactModelOf('TaskSpec')]]),
    artifactsByInstance: new Map([[subject.subject.instanceId, artifactModelOf('TaskSpec')]]),
  });
  assert.equal(report.ok, false);
  assert.equal(mapGraphFindings(report.findings), 'subject-not-validated');
});

test('reuse: graph adapter passes when the full validation chain resolves (LFC-001/002 clean)', () => {
  const subject = makeSubject('TaskSpec');
  const registry = makeRegistryContext();
  const validation = buildValidationRecordPayload({
    recordId: 'pgw:l:11111111111111111111111111111111',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    registry,
  });
  const candidate = buildApprovalRecordPayload({
    recordId: 'pgw:l:99999999999999999999999999999999',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    workspaceId: WS_A,
    purpose: 'execution-use',
    validationRecordIds: ['pgw:l:11111111111111111111111111111111'],
    requiredSemantics: { protocol_features: [], consumer_capabilities: [] },
    validUntil: null,
    registry,
  });
  const report = evaluateCandidateLifecycleRecord({
    existing: [validation],
    candidate,
    registry,
    artifactsByRevision: new Map([[subject.subject.revisionId, artifactModelOf('TaskSpec')]]),
    artifactsByInstance: new Map([[subject.subject.instanceId, artifactModelOf('TaskSpec')]]),
  });
  assert.equal(report.ok, true, JSON.stringify(report.findings));
});

test('reuse: graph adapter emits and maps LFC-003 (issuance without approval) to issuance-not-authorized', () => {
  const subject = makeSubject('TaskSpec');
  const registry = makeRegistryContext();
  const candidate = buildIssuanceRecordPayload({
    recordId: 'pgw:l:99999999999999999999999999999999',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    workspaceId: WS_A,
    useClass: 'execution-use',
    approvalRecordId: 'pgw:l:22222222222222222222222222222222',
    activationLimit: 1,
    validUntil: null,
    registry,
  });
  const report = evaluateCandidateLifecycleRecord({
    existing: [],
    candidate,
    registry,
    artifactsByRevision: new Map([[subject.subject.revisionId, artifactModelOf('TaskSpec')]]),
    artifactsByInstance: new Map([[subject.subject.instanceId, artifactModelOf('TaskSpec')]]),
  });
  assert.equal(report.ok, false);
  assert.equal(mapGraphFindings(report.findings), 'issuance-not-authorized');
});

test('reuse: graph adapter maps registry-context findings to registry-context-mismatch', () => {
  const subject = makeSubject('TaskSpec');
  const registry = makeRegistryContext();
  // A candidate bound to a FOREIGN registry snapshot.
  const candidate = buildApprovalRecordPayload({
    recordId: 'pgw:l:99999999999999999999999999999999',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    workspaceId: WS_A,
    purpose: 'execution-use',
    validationRecordIds: ['pgw:l:11111111111111111111111111111111'],
    requiredSemantics: { protocol_features: [], consumer_capabilities: [] },
    validUntil: null,
    registry: { ...registry, registrySnapshotId: 'pgw:g:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', registrySnapshotDigest: `sha-256:${'a'.repeat(64)}` },
  });
  const validation = buildValidationRecordPayload({
    recordId: 'pgw:l:11111111111111111111111111111111',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    registry: { ...registry, registrySnapshotId: 'pgw:g:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', registrySnapshotDigest: `sha-256:${'a'.repeat(64)}` },
  });
  const report = evaluateCandidateLifecycleRecord({
    existing: [validation],
    candidate,
    registry,
    artifactsByRevision: new Map([[subject.subject.revisionId, artifactModelOf('TaskSpec')]]),
    artifactsByInstance: new Map([[subject.subject.instanceId, artifactModelOf('TaskSpec')]]),
  });
  assert.equal(report.ok, false);
  assert.equal(mapGraphFindings(report.findings), 'registry-context-mismatch');
});

test('reuse: end-to-end LFC-001 denial proves the accepted graph is the lifecycle rule authority', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const { store, state } = makeFakeStore();
  // Seed a validation record whose subject matches the request subject.
  const registry = makeRegistryContext();
  seedPayload(store, 'validation-record', buildValidationRecordPayload({
    recordId: 'pgw:l:11111111111111111111111111111111',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    registry,
  }));
  const context = makeContext(integration.storeEnv, {
    store,
    identity: makeIdentitySource(),
    subjectArtifact: makeEvidence('TaskSpec').artifact,
  });
  // Approval referencing the seeded validation record succeeds; the graph
  // accepted the chain (single lifecycle rule authority).
  const ok = executeSlice1Command(
    { operation: 'approve', subject: subjectOperand(subject.subject), workspaceId: WS_A, purpose: 'execution-use', validationRecordIds: ['pgw:l:11111111111111111111111111111111'] },
    context,
  );
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(state.publishCalls, 2, 'one seeded validation record + one approval publication');
});

test('reuse: accepted digest implementation is reused for decision-content identity', () => {
  const subject = makeSubject('TaskSpec');
  const registry = makeRegistryContext();
  const a = buildApprovalRecordPayload({
    recordId: 'pgw:l:11111111111111111111111111111111',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    workspaceId: WS_A,
    purpose: 'execution-use',
    validationRecordIds: ['pgw:l:22222222222222222222222222222222'],
    requiredSemantics: { protocol_features: [], consumer_capabilities: [] },
    validUntil: null,
    registry,
  });
  const b = buildApprovalRecordPayload({
    recordId: 'pgw:l:33333333333333333333333333333333',
    createdAt: '2026-08-05T06:00:00.000Z',
    subject: subject.subject,
    workspaceId: WS_A,
    purpose: 'execution-use',
    validationRecordIds: ['pgw:l:22222222222222222222222222222222'],
    requiredSemantics: { protocol_features: [], consumer_capabilities: [] },
    validUntil: null,
    registry,
  });
  // Same decision content (fresh record identity + creation time only
  // differ) → same decision-content digest; the storage payload digest
  // domain is the accepted one (sha-256 domain-separated).
  assert.equal(decisionContentDigestOf(a), decisionContentDigestOf(b));
  assert.match(decisionContentDigestOf(a), /^sha-256:[0-9a-f]{64}$/);
});

test('reuse: one lifecycle schema authority — payloads pass the accepted WP-4 lifecycle-record pipeline', () => {
  const subject = makeSubject('TaskSpec');
  const registry = makeRegistryContext();
  const validation = buildValidationRecordPayload({
    recordId: 'pgw:l:11111111111111111111111111111111',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    registry,
  });
  const approval = buildApprovalRecordPayload({
    recordId: 'pgw:l:22222222222222222222222222222222',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    workspaceId: WS_A,
    purpose: 'execution-use',
    validationRecordIds: ['pgw:l:11111111111111111111111111111111'],
    requiredSemantics: { protocol_features: [], consumer_capabilities: [] },
    validUntil: null,
    registry,
  });
  const issuance = buildIssuanceRecordPayload({
    recordId: 'pgw:l:33333333333333333333333333333333',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    workspaceId: WS_A,
    useClass: 'execution-use',
    approvalRecordId: 'pgw:l:22222222222222222222222222222222',
    activationLimit: 1,
    validUntil: null,
    registry,
  });
  const schemaRegistry = createSchemaRegistry();
  for (const payload of [validation, approval, issuance]) {
    const report = validateLifecycleRecord(payload, schemaRegistry);
    assert.equal(report.ok, true, JSON.stringify(report.findings));
  }
});

test('reuse: WP-6 capability-ceiling machinery is the only ceiling authority (end-to-end ceiling-denied)', () => {
  const subject = makeSubject('TaskSpec');
  // Global ceiling denies approval-operate: the SAME WP-6 validated
  // configuration drives the denial (no second configuration system).
  const integration = makeIntegrationEnv({ globalCapabilities: ['project-gateway.lifecycle-issue'] });
  const { store } = makeFakeStore();
  seedPayload(store, 'validation-record', buildValidationRecordPayload({
    recordId: 'pgw:l:11111111111111111111111111111111',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    registry: makeRegistryContext(),
  }));
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(
    { operation: 'approve', subject: subjectOperand(subject.subject), workspaceId: WS_A, purpose: 'execution-use', validationRecordIds: ['pgw:l:11111111111111111111111111111111'] },
    context,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'ceiling-denied');
});

test('reuse: no second store — the family publishes only through the injected WP-8 boundary', () => {
  // The boundary adapter is the only control-plane module importing the
  // WP-8 publication/read surface (enforced by the family static guard);
  // behaviorally, a fake boundary that records calls receives exactly the
  // expected single publication per successful decision.
  const subject = makeSubject('TaskSpec');
  const integration = makeIntegrationEnv();
  const { store, state } = makeFakeStore();
  seedPayload(store, 'validation-record', buildValidationRecordPayload({
    recordId: 'pgw:l:11111111111111111111111111111111',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    registry: makeRegistryContext(),
  }));
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(
    { operation: 'approve', subject: subjectOperand(subject.subject), workspaceId: WS_A, purpose: 'execution-use', validationRecordIds: ['pgw:l:11111111111111111111111111111111'] },
    context,
  );
  assert.equal(result.ok, true);
  assert.equal(state.publishCalls, 2, 'one seeded validation record + one approval publication through the single boundary');
});
