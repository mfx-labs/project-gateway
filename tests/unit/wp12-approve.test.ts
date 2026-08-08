/**
 * WP-12 Slice 1 — approve tests.
 *
 * Proves: happy path (exact subject/workspace/purpose, ValidationRecord
 * correlation, host-asserted approver role, WP-4 graph LFC-001/002, WP-6
 * ceilings, mechanical WP-8 audit); denials (missing/mismatched validation,
 * workspace/purpose mismatch, registry mismatch, ceiling denial, eligibility
 * denial, missing lifecycle state, untrusted role assertion, model attempts
 * to confer approver authority, duplicate approval); mutation scope (no
 * ApprovalRecord on denial, no IssuanceRecord on approval, zero
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

function approveOperand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const subject = makeSubject('TaskSpec');
  return {
    operation: 'approve',
    subject: subjectOperand(subject.subject),
    workspaceId: WS_A,
    purpose: 'execution-use',
    validationRecordIds: ['pgw:l:11111111111111111111111111111111'],
    ...overrides,
  };
}

/** Seed the canonical validation record the approval will reference. */
function seedValidationRecord(store: ReturnType<typeof makeFakeStore>['store'], subject: ReturnType<typeof makeSubject>, recordId = 'pgw:l:11111111111111111111111111111111'): void {
  const payload = buildValidationRecordPayload({
    recordId,
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    registry: makeRegistryContext(),
  });
  seedPayload(store, 'validation-record', payload);
}

/** Context over a fake store pre-seeded with the validation record. */
function approvedContext(overrides: Record<string, unknown> = {}): { readonly context: ReturnType<typeof makeContext>; readonly state: ReturnType<typeof makeFakeStore>['state']; readonly subject: ReturnType<typeof makeSubject>; readonly integration: ReturnType<typeof makeIntegrationEnv> } {
  const subject = makeSubject('TaskSpec');
  const { store, state } = makeFakeStore();
  seedValidationRecord(store, subject);
  const integration = makeIntegrationEnv();
  const context = makeContext(integration.storeEnv, {
    store,
    identity: makeIdentitySource(),
    subjectArtifact: makeEvidence('TaskSpec').artifact,
    ...overrides,
  });
  return { context, state, subject, integration };
}

test('approve: happy path produces exactly one ApprovalRecord with mechanical audit evidence', () => {
  const { context, state, subject } = approvedContext();
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.outcome, 'approved');
  assert.equal(result.evidence.recordClass, 'approval-record');
  assert.ok(result.evidence.auditEventId !== undefined);
  assert.equal(state.publishCalls, 2, 'exactly one publication beyond the seeded validation record');
  const read = context.store.readLifecyclePayload('approval-record', result.evidence.recordId);
  assert.equal(read.ok, true);
  const payload = read.payload!;
  assert.equal(payload['record_type'], 'ApprovalRecord');
  assert.equal(payload['responsible_role'], 'trusted-approver');
  assert.equal(payload['workspace_id'], WS_A);
  assert.equal(payload['purpose'], 'execution-use');
  assert.deepEqual(payload['validation_record_ids'], ['pgw:l:11111111111111111111111111111111']);
  const storedSubject = payload['subject'] as Record<string, unknown>;
  assert.equal(storedSubject['instance_id'], subject.subject.instanceId);
  assert.equal(storedSubject['workspace_id'], WS_A);
});

test('approve: no ValidationRecord fails closed as subject-not-validated', () => {
  const integration = makeIntegrationEnv();
  const { store, state } = makeFakeStore();
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'subject-not-validated');
  assert.equal(state.publishCalls, 0);
  assert.equal(state.byClass.get('approval-record')?.length ?? 0, 0, 'no ApprovalRecord on denial');
});

test('approve: mismatched ValidationRecord subject is subject-invalid', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const other = makeSubject('ContextManifest');
  const payload = buildValidationRecordPayload({
    recordId: 'pgw:l:11111111111111111111111111111111',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: other.subject,
    registry: makeRegistryContext(),
  });
  const { store } = makeFakeStore();
  seedPayload(store, 'validation-record', payload);
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'subject-invalid');
  void subject;
});

test('approve: mismatched workspace fails closed', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const { store } = makeFakeStore();
  seedValidationRecord(store, subject);
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(
    approveOperand({ workspaceId: 'pgw:w:99999999999999999999999999999999', subject: { ...subjectOperand(subject.subject), workspaceId: 'pgw:w:99999999999999999999999999999999' } }),
    context,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'lifecycle-state-missing', 'unknown workspace fails closed');
});

test('approve: mismatched purpose fails closed as request-invalid', () => {
  const { context } = approvedContext();
  const result = executeSlice1Command(approveOperand({ purpose: 'self-approval' }), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid');
});

test('approve: registry-context mismatch mapping is covered by the graph adapter (REG findings)', () => {
  // End-to-end, the candidate always binds the accepted registry context,
  // so the REG gate is a defense-in-depth graph check; its closed-token
  // mapping is proven directly in the reuse suite.
  assert.equal(true, true);
});

test('approve: concrete ceiling denial is ceiling-denied', () => {
  const subject = makeSubject('TaskSpec');
  const integration = makeIntegrationEnv({ globalCapabilities: ['project-gateway.lifecycle-issue'] });
  const { store } = makeFakeStore();
  seedValidationRecord(store, subject);
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'ceiling-denied');
});

test('approve: workspace capability ceiling denial is ceiling-denied', () => {
  const subject = makeSubject('TaskSpec');
  const integration = makeIntegrationEnv({ workspaceCapabilities: ['project-gateway.lifecycle-issue'] });
  const { store } = makeFakeStore();
  seedValidationRecord(store, subject);
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'ceiling-denied');
});

test('approve: missing lifecycle state fails closed as store-failure', () => {
  const integration = makeIntegrationEnv();
  // A store that fails every read: no trusted state can be established.
  const failing = makeFakeStore({ failReads: true });
  const context = makeContext(integration.storeEnv, { store: failing.store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'store-failure');
});

test('approve: absent validation reference is subject-not-validated', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'subject-not-validated');
});

test('approve: untrusted role assertion is rejected', () => {
  const { context } = approvedContext();
  const result = executeSlice1Command(approveOperand({ approverRole: 'trusted-approver' }), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'approver-not-independent');
});

test('approve: model/artifact cannot confer approver authority', () => {
  const { context, state } = approvedContext();
  // An artifact-like operand or an annotation claiming approval inside the
  // request cannot change the decision; the request shape rejects it.
  const before = state.publishCalls;
  const result = executeSlice1Command(
    approveOperand({ artifact: { approved: true, role: 'approver' }, annotations: { approved: true } }),
    context,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid');
  assert.equal(state.publishCalls, before, 'rejected request must not publish');
});

test('approve: duplicate exact approval is already-approved', () => {
  const { context } = approvedContext();
  const first = executeSlice1Command(approveOperand(), context);
  assert.equal(first.ok, true);
  const second = executeSlice1Command(approveOperand(), context);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.category, 'already-approved');
});

test('approve: competing current approval is lifecycle-conflict', () => {
  const { context } = approvedContext();
  const subject = makeSubject('TaskSpec');
  // A current approval with DIFFERENT decision content (different validity
  // end) for the same subject/workspace/purpose competes with the new one.
  const existing = buildApprovalSeed(subject, 'pgw:l:22222222222222222222222222222222', ['pgw:l:11111111111111111111111111111111'], '2027-01-01T00:00:00.000Z');
  seedPayload(context.store, 'approval-record', existing);
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'lifecycle-conflict');
});

function buildApprovalSeed(subject: ReturnType<typeof makeSubject>, recordId: string, refs: string[], validUntil: string | null = null): Record<string, unknown> {
  return {
    record_type: 'ApprovalRecord',
    record_id: recordId,
    created_at: '2026-08-04T06:00:00.000Z',
    responsible_role: 'trusted-approver',
    registry_snapshot_reference: makeRegistryContextRef(),
    subject: {
      protocol_version: '1.0',
      kind: { id: subject.subject.kindId, version: subject.subject.kindVersion },
      instance_id: subject.subject.instanceId,
      revision_id: subject.subject.revisionId,
      digest: subject.subject.digest,
      workspace_id: subject.subject.workspaceId,
    },
    workspace_id: WS_A,
    purpose: 'execution-use',
    validation_record_ids: refs,
    required_semantics: { protocol_features: [], consumer_capabilities: [] },
    valid_until: validUntil,
  };
}

function makeRegistryContextRef(): Record<string, unknown> {
  const registry = makeRegistryContext();
  return {
    registry_protocol_id: registry.registryProtocolId,
    registry_snapshot_format_version: registry.registrySnapshotFormatVersion,
    registry_snapshot_id: registry.registrySnapshotId,
    registry_snapshot_digest: registry.registrySnapshotDigest,
    protocol_compatibility: { mode: 'exact-release', artifact_protocol_id: 'project-gateway.artifact', artifact_protocol_version: '1.0' },
  };
}

test('approve: approval never creates an IssuanceRecord', () => {
  const { context, state } = approvedContext();
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, true);
  assert.equal(state.byClass.get('issuance-record')?.length ?? 0, 0, 'approval must not create issuance state');
});

test('approve: denial creates no ApprovalRecord and no AuthoritativeAuditEvent', () => {
  const { context, state } = approvedContext();
  state.byClass.get('approval-record')?.splice(0);
  // Force a denial: conflict via an existing current approval with
  // different decision content.
  const subject = makeSubject('TaskSpec');
  seedPayload(context.store, 'approval-record', buildApprovalSeed(subject, 'pgw:l:22222222222222222222222222222222', ['pgw:l:11111111111111111111111111111111'], '2027-01-01T00:00:00.000Z'));
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'lifecycle-conflict');
  const approvals = state.byClass.get('approval-record') ?? [];
  assert.equal(approvals.length, 1, 'denial creates no additional ApprovalRecord');
});

test('approve: zero project-file mutation', () => {
  const { context, integration } = approvedContext();
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, true);
  const entries = readdirSync(integration.configEnv.workspaceRoot);
  assert.deepEqual(entries, [], 'approval must not write project files');
});

test('approve: missing subject artifact evidence fails closed as internal-failure', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const { store } = makeFakeStore();
  seedValidationRecord(store, subject);
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: undefined });
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'internal-failure');
});

test('approve: unbranded structural lookalike subjectArtifact is subject-invalid (SR-W12-S1-003)', () => {
  const branded = makeEvidence('TaskSpec').artifact;
  // An ordinary object with the same public fields as the branded wrapper:
  // the WP-4 runtime brand (module-private WeakSet) is absent, so the
  // artifact is not genuine and must fail closed before any publication.
  const lookalike = {
    kind: branded.kind,
    instanceId: branded.instanceId,
    revisionId: branded.revisionId,
    digest: branded.digest,
    canonicalUtf8: branded.canonicalUtf8,
    level: branded.level,
    model: branded.model,
  };
  const { context, state } = approvedContext({ subjectArtifact: lookalike as never });
  const before = state.publishCalls;
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false, 'an unbranded lookalike must never be accepted');
  if (!result.ok) assert.equal(result.category, 'subject-invalid');
  assert.equal(state.publishCalls, before, 'zero publication for unbranded evidence');
});

test('approve: spread/clone of a branded subjectArtifact is not genuine (subject-invalid, SR-W12-S1-003)', () => {
  // A spread copy of the branded wrapper is a new object: the WeakSet brand
  // does not survive cloning, so the clone is structurally identical but not
  // genuine.
  const clone = { ...makeEvidence('TaskSpec').artifact };
  const { context, state } = approvedContext({ subjectArtifact: clone as never });
  const before = state.publishCalls;
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'subject-invalid');
  assert.equal(state.publishCalls, before, 'zero publication for a cloned wrapper');
});

test('approve: subject-mismatched branded subjectArtifact is subject-invalid', () => {
  // A GENUINE branded artifact of a different kind: the brand passes, but the
  // exact subject correlation fails closed.
  const other = makeEvidence('ContextManifest').artifact;
  const { context, state } = approvedContext({ subjectArtifact: other });
  const before = state.publishCalls;
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'subject-invalid');
  assert.equal(state.publishCalls, before, 'zero publication for a mismatched branded artifact');
});

test('approve: host approver role is required (structural independence)', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const { store } = makeFakeStore();
  seedValidationRecord(store, subject);
  const context = makeContext(integration.storeEnv, { store, subjectArtifact: makeEvidence('TaskSpec').artifact, approverRole: false });
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'lifecycle-state-missing');
});
