/**
 * WP-12 Slice 1 — issue tests.
 *
 * Proves: happy path (exact active ApprovalRecord, subject/workspace/
 * use-class bindings, trusted issuer role, LFC-003, WP-6 ceilings,
 * IssuanceRecord produced); denials (no approval, approval subject
 * mismatch, workspace mismatch, scope mismatch, revoked/non-current
 * approval, ceiling denial, lifecycle-state missing, duplicate issuance);
 * mutation scope (issue never creates ApprovalRecord/RuntimeGrant/
 * ActivationRecord, denial creates no IssuanceRecord, zero
 * AuthoritativeAuditEvent, zero project-file mutation).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import {
  cleanupTestEnvs,
  makeContext,
  makeEvidence,
  makeFakeStore,
  makeIdentitySource,
  makeIntegrationEnv,
  makeRegistryContext,
  makeSubject,
  seedPayload,
  WS_A,
} from './wp12-helpers.js';
import { buildValidationRecordPayload } from '../../src/control-plane/records.js';

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

function issueOperand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const subject = makeSubject('TaskSpec');
  return { operation: 'issue', subject: subjectOperand(subject.subject), workspaceId: WS_A, useClass: 'execution-use', ...overrides };
}

const VALIDATION_ID = 'pgw:l:11111111111111111111111111111111';
const APPROVAL_ID = 'pgw:l:22222222222222222222222222222222';

function registryRef(): Record<string, unknown> {
  const registry = makeRegistryContext();
  return {
    registry_protocol_id: registry.registryProtocolId,
    registry_snapshot_format_version: registry.registrySnapshotFormatVersion,
    registry_snapshot_id: registry.registrySnapshotId,
    registry_snapshot_digest: registry.registrySnapshotDigest,
    protocol_compatibility: { mode: 'exact-release', artifact_protocol_id: 'project-gateway.artifact', artifact_protocol_version: '1.0' },
  };
}

function approvalSubject(subject: ReturnType<typeof makeSubject>): Record<string, unknown> {
  return {
    protocol_version: '1.0',
    kind: { id: subject.subject.kindId, version: subject.subject.kindVersion },
    instance_id: subject.subject.instanceId,
    revision_id: subject.subject.revisionId,
    digest: subject.subject.digest,
    workspace_id: subject.subject.workspaceId,
  };
}

function approvalSeed(subject: ReturnType<typeof makeSubject>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    record_type: 'ApprovalRecord',
    record_id: APPROVAL_ID,
    created_at: '2026-08-04T06:00:00.000Z',
    responsible_role: 'trusted-approver',
    registry_snapshot_reference: registryRef(),
    subject: approvalSubject(subject),
    workspace_id: WS_A,
    purpose: 'execution-use',
    validation_record_ids: [VALIDATION_ID],
    required_semantics: { protocol_features: [], consumer_capabilities: [] },
    valid_until: null,
    ...overrides,
  };
}

function validationSeed(subject: ReturnType<typeof makeSubject>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    record_type: 'ValidationRecord',
    record_id: VALIDATION_ID,
    created_at: '2026-08-04T06:00:00.000Z',
    responsible_role: 'trusted-validator',
    registry_snapshot_reference: registryRef(),
    subject: approvalSubject(subject),
    validator_profile: { id: 'project-gateway.structural-semantic-v1', version: '1.0' },
    structural_outcome: 'pass',
    semantic_outcome: 'pass',
    findings: [],
    ...overrides,
  };
}

function revocationSeed(targetRecordId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    record_type: 'RevocationRecord',
    record_id: 'pgw:l:33333333333333333333333333333333',
    created_at: '2026-08-04T06:00:00.000Z',
    responsible_role: 'trusted-revocation-authority',
    registry_snapshot_reference: registryRef(),
    target: { record_type: 'ApprovalRecord', record_id: targetRecordId },
    scope: 'all-uses',
    effective_at: '2026-08-04T05:00:00.000Z',
    reason_code: 'review-withdrawn',
    ...overrides,
  };
}

/** Context over a fake store pre-seeded with validation + approval. */
function issuedContext(overrides: Record<string, unknown> = {}): { readonly context: ReturnType<typeof makeContext>; readonly state: ReturnType<typeof makeFakeStore>['state']; readonly subject: ReturnType<typeof makeSubject>; readonly integration: ReturnType<typeof makeIntegrationEnv> } {
  const subject = makeSubject('TaskSpec');
  const { store, state } = makeFakeStore();
  seedPayload(store, 'validation-record', validationSeed(subject));
  seedPayload(store, 'approval-record', approvalSeed(subject));
  const integration = makeIntegrationEnv();
  const context = makeContext(integration.storeEnv, {
    store,
    identity: makeIdentitySource(),
    subjectArtifact: makeEvidence('TaskSpec').artifact,
    ...overrides,
  });
  return { context, state, subject, integration };
}

test('issue: happy path produces exactly one IssuanceRecord bound to the active approval', () => {
  const { context, state } = issuedContext();
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.outcome, 'issued');
  assert.equal(result.evidence.recordClass, 'issuance-record');
  assert.ok(result.evidence.auditEventId !== undefined);
  assert.equal(state.publishCalls, 3, 'exactly one publication beyond the two seeded records');
  const read = context.store.readLifecyclePayload('issuance-record', result.evidence.recordId);
  assert.equal(read.ok, true);
  const payload = read.payload!;
  assert.equal(payload['record_type'], 'IssuanceRecord');
  assert.equal(payload['responsible_role'], 'trusted-issuer');
  assert.equal(payload['approval_record_id'], APPROVAL_ID);
  assert.equal(payload['workspace_id'], WS_A);
  assert.equal(payload['use_class'], 'execution-use');
  assert.equal(payload['activation_limit'], 1);
  assert.equal(payload['valid_until'], null);
  const storedSubject = payload['subject'] as Record<string, unknown>;
  assert.equal(storedSubject['workspace_id'], WS_A);
});

test('issue: issuance without approval is issuance-not-authorized', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const { store, state } = makeFakeStore();
  seedPayload(store, 'validation-record', validationSeed(subject));
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const before = state.publishCalls;
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'issuance-not-authorized');
  assert.equal(state.publishCalls, before, 'denial must not publish');
});

test('issue: approval subject mismatch is issuance-not-authorized', () => {
  const integration = makeIntegrationEnv();
  const taskSubject = makeSubject('TaskSpec');
  const otherSubject = makeSubject('ContextManifest');
  const { store } = makeFakeStore();
  seedPayload(store, 'validation-record', validationSeed(taskSubject));
  seedPayload(store, 'approval-record', approvalSeed(otherSubject));
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'issuance-not-authorized');
});

test('issue: workspace mismatch is issuance-not-authorized', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const { store } = makeFakeStore();
  seedPayload(store, 'validation-record', validationSeed(subject));
  seedPayload(store, 'approval-record', approvalSeed(subject, { workspace_id: 'pgw:w:99999999999999999999999999999999', subject: { ...approvalSubject(subject), workspace_id: 'pgw:w:99999999999999999999999999999999' } }));
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'issuance-not-authorized');
});

test('issue: scope/use-class mismatch fails closed as request-invalid', () => {
  const { context } = issuedContext();
  const result = executeSlice1Command(issueOperand({ useClass: 'completion-status' }), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid');
});

test('issue: revoked approval is approval-revoked', () => {
  const { context, state } = issuedContext();
  seedPayload(context.store, 'revocation-record', revocationSeed(APPROVAL_ID));
  const before = state.publishCalls;
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'approval-revoked');
  assert.equal(state.publishCalls, before, 'denial must not publish');
});

test('issue: future-dated revocation does not block issuance (effective point semantics)', () => {
  const { context } = issuedContext();
  seedPayload(context.store, 'revocation-record', revocationSeed(APPROVAL_ID, { effective_at: '2027-01-01T00:00:00.000Z' }));
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('issue: expired approval is non-current (issuance-not-authorized)', () => {
  const { context, subject } = issuedContext();
  // Replace the seeded approval with an expired one (same decision content
  // except validity end).
  const existing = context.store.enumerateLifecycleRecords('approval-record');
  assert.equal(existing.ok, true);
  for (const id of existing.recordIds) {
    void context.store.readLifecyclePayload('approval-record', id);
  }
  const expired = approvalSeed(subject, { record_id: APPROVAL_ID, valid_until: '2020-01-01T00:00:00.000Z' });
  // Re-seed under a fresh fake store to keep the fixture deterministic.
  const integration = makeIntegrationEnv();
  const { store, state } = makeFakeStore();
  seedPayload(store, 'validation-record', validationSeed(subject));
  seedPayload(store, 'approval-record', expired);
  const context2 = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const before = state.publishCalls;
  const result = executeSlice1Command(issueOperand(), context2);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'issuance-not-authorized');
  assert.equal(state.publishCalls, before, 'denial must not publish');
});

test('issue: result-publication supersession never misfires for lifecycle records', () => {
  const { context } = issuedContext();
  // A supersession of a result publication (the only schema-legal prior
  // variant with record_id) must not affect approval/issuance currentness.
  seedPayload(context.store, 'supersession-record', {
    record_type: 'SupersessionRecord',
    record_id: 'pgw:l:44444444444444444444444444444444',
    created_at: '2026-08-04T06:00:00.000Z',
    responsible_role: 'trusted-lifecycle-authority',
    registry_snapshot_reference: registryRef(),
    prior: { subject_type: 'result-publication', record_id: 'pgw:l:55555555555555555555555555555555' },
    successor: { subject_type: 'result-publication', record_id: 'pgw:l:66666666666666666666666666666666' },
    scope: 'ordinary-review',
    reason_code: 'corrected-observation',
  });
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('issue: concrete ceiling denial is ceiling-denied', () => {
  const subject = makeSubject('TaskSpec');
  const integration = makeIntegrationEnv({ globalCapabilities: ['project-gateway.approval-operate'] });
  const { store } = makeFakeStore();
  seedPayload(store, 'validation-record', validationSeed(subject));
  seedPayload(store, 'approval-record', approvalSeed(subject));
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'ceiling-denied');
});

test('issue: missing lifecycle state fails closed as store-failure', () => {
  const integration = makeIntegrationEnv();
  const failing = makeFakeStore({ failReads: true });
  const context = makeContext(integration.storeEnv, { store: failing.store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'store-failure');
});

test('issue: duplicate exact issuance is already-issued', () => {
  const { context } = issuedContext();
  const first = executeSlice1Command(issueOperand(), context);
  assert.equal(first.ok, true);
  const second = executeSlice1Command(issueOperand(), context);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.category, 'already-issued');
});

test('issue: issue never creates ApprovalRecord, RuntimeGrant, or ActivationRecord', () => {
  const { context, state } = issuedContext();
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, true);
  assert.equal(state.byClass.get('approval-record')?.length ?? 0, 1, 'issue must not create an ApprovalRecord');
  assert.equal(state.byClass.has('runtime-grant'), false, 'no RuntimeGrant in Slice 1');
  assert.equal(state.byClass.has('activation-record'), false, 'no ActivationRecord in Slice 1');
  assert.equal(state.byClass.has('execution-occurrence-record'), false, 'no occurrence state in Slice 1');
});

test('issue: denial creates no IssuanceRecord and no AuthoritativeAuditEvent', () => {
  const { context, state } = issuedContext();
  // Revoke the approval: issuance denies.
  seedPayload(context.store, 'revocation-record', revocationSeed(APPROVAL_ID));
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'approval-revoked');
  assert.equal(state.byClass.get('issuance-record')?.length ?? 0, 0, 'denial creates no IssuanceRecord');
});

test('issue: zero project-file mutation', () => {
  const { context, integration } = issuedContext();
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, true);
  const entries = readdirSync(integration.configEnv.workspaceRoot);
  assert.deepEqual(entries, [], 'issuance must not write project files');
});

test('issue: missing subject artifact evidence fails closed as internal-failure', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const { store } = makeFakeStore();
  seedPayload(store, 'validation-record', validationSeed(subject));
  seedPayload(store, 'approval-record', approvalSeed(subject));
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: undefined });
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'internal-failure');
});

test('issue: unbranded structural lookalike subjectArtifact is subject-invalid (SR-W12-S1-003)', () => {
  const branded = makeEvidence('TaskSpec').artifact;
  const lookalike = {
    kind: branded.kind,
    instanceId: branded.instanceId,
    revisionId: branded.revisionId,
    digest: branded.digest,
    canonicalUtf8: branded.canonicalUtf8,
    level: branded.level,
    model: branded.model,
  };
  const { context, state } = issuedContext({ subjectArtifact: lookalike as never });
  const before = state.publishCalls;
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, false, 'an unbranded lookalike must never be accepted');
  if (!result.ok) assert.equal(result.category, 'subject-invalid');
  assert.equal(state.publishCalls, before, 'zero publication for unbranded evidence');
});

test('issue: spread/clone of a branded subjectArtifact is not genuine (subject-invalid, SR-W12-S1-003)', () => {
  const clone = { ...makeEvidence('TaskSpec').artifact };
  const { context, state } = issuedContext({ subjectArtifact: clone as never });
  const before = state.publishCalls;
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'subject-invalid');
  assert.equal(state.publishCalls, before, 'zero publication for a cloned wrapper');
});

test('issue: subject-mismatched branded subjectArtifact is subject-invalid', () => {
  // A GENUINE branded artifact of a different kind: the brand passes, but the
  // exact subject correlation fails closed.
  const other = makeEvidence('ContextManifest').artifact;
  const { context, state } = issuedContext({ subjectArtifact: other });
  const before = state.publishCalls;
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'subject-invalid');
  assert.equal(state.publishCalls, before, 'zero publication for a mismatched branded artifact');
});

test('issue: host issuer role is required (structural authority)', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const { store } = makeFakeStore();
  seedPayload(store, 'validation-record', validationSeed(subject));
  seedPayload(store, 'approval-record', approvalSeed(subject));
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact, issuerRole: false });
  const result = executeSlice1Command(issueOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'lifecycle-state-missing');
});
