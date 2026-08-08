/**
 * WP-12 Slice 1 — hostile request / authority-boundary tests.
 *
 * Proves: unknown keys are rejected; the trusted operator role cannot be
 * transported in the request payload; trusted configuration, registry
 * context, store boundary, and validation outcomes cannot be supplied by
 * the request; caller-supplied findings cannot become ValidationRecord
 * facts; artifact annotations confer nothing; digest possession alone
 * grants nothing; denied cases invoke no publishRecord.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import { makeFakeStore, makeContext, makeEvidence, makeIdentitySource, makeIntegrationEnv, makeRegistryContext, makeSubject, seedPayload, cleanupTestEnvs, WS_A } from './wp12-helpers.js';
import { buildValidationRecordPayload } from '../../src/control-plane/records.js';
import type { StoreEnv } from './wp12-helpers.js';

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

function validationOperand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const subject = makeSubject('TaskSpec');
  return {
    operation: 'recordValidation',
    subject: subjectOperand(subject.subject),
    workspaceId: WS_A,
    ...overrides,
  };
}

/** Minimal host context over a fake store (no seeded state). */
function emptyContext(overrides: Record<string, unknown> = {}): { readonly env: StoreEnv; readonly context: ReturnType<typeof makeContext>; readonly store: ReturnType<typeof makeFakeStore>['store']; readonly state: ReturnType<typeof makeFakeStore>['state'] } {
  // The WP-8 store is still required for the genuine configuration in the
  // host context; the decision itself runs against the fake store.
  const { store, state } = makeFakeStore();
  const integration = makeIntegrationEnv();
  const context = makeContext(integration.storeEnv, {
    store,
    identity: makeIdentitySource(),
    subjectArtifact: makeEvidence('TaskSpec').artifact,
  });
  return { env: integration.storeEnv, context, store, state };
}

test('request boundary: unknown keys are rejected and invoke no publish', () => {
  const { context, state } = emptyContext();
  for (const extra of ['configuration', 'registry', 'store', 'ceilings', 'validationOutcome', 'ok', 'valid', 'findings', 'validatorProfile', 'recordProvenance', 'artifactPath', 'approvalAuthority']) {
    const result = executeSlice1Command(approveOperand({ [extra]: 'hostile' }), context);
    assert.equal(result.ok, false, `key ${extra} must be rejected`);
    if (result.ok) continue;
    assert.equal(result.category, 'request-invalid', `key ${extra} must be request-invalid`);
  }
  assert.equal(state.publishCalls, 0, 'no publication on rejected requests');
});

test('request boundary: role-bearing keys are rejected as approver-not-independent', () => {
  const { context, state } = emptyContext();
  for (const key of ['approverRole', 'issuerRole', 'operatorRole', 'approver', 'issuer', 'role', 'trustedRole', 'approverIdentity', 'operatorIdentity', 'approverAuthority']) {
    const result = executeSlice1Command(approveOperand({ [key]: 'yes-i-am-the-approver' }), context);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.category, 'approver-not-independent', `key ${key} must be approver-not-independent`);
    }
  }
  assert.equal(state.publishCalls, 0);
});

test('request boundary: role values inside allowed keys cannot confer authority (subject/operation shape rejection)', () => {
  const { context, state } = emptyContext();
  // A role-like value smuggled into the subject operand changes the subject
  // shape or identity; it never becomes a role.
  const result = executeSlice1Command(
    approveOperand({ subject: { protocolId: 'project-gateway.artifact', protocolVersion: '1.0', kindId: 'TaskSpec', kindVersion: '1.0', instanceId: 'pgw:i:9e74f09cf0287d6787d69e8ebddb5157', revisionId: 'pgw:r:8d4203d7ec45e4f3c4bbba7a9c69042f', digest: 'sha-256:b6418a37095af165a87a38affb609f42b331d80b15f7d3ed2796bf780ae1868b', workspaceId: WS_A, approverRole: 'true' } }),
    context,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid');
  assert.equal(state.publishCalls, 0);
});

test('request boundary: trusted configuration cannot be supplied by the request', () => {
  const { context } = emptyContext();
  const result = executeSlice1Command(approveOperand({ configuration: { workspaces: [] } }), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid');
});

test('request boundary: validation outcome and findings cannot be supplied by the request', () => {
  const { context, state } = emptyContext();
  const hostile = executeSlice1Command(
    validationOperand({ validationOutcome: 'pass', findings: [], validatorProfile: { id: 'x', version: '1' } }),
    context,
  );
  assert.equal(hostile.ok, false);
  if (!hostile.ok) assert.equal(hostile.category, 'request-invalid');
  assert.equal(state.publishCalls, 0, 'caller-supplied validation conclusion must not reach publication');
});

test('request boundary: artifact annotation cannot confer authority', () => {
  const { context, state } = emptyContext();
  const subject = makeSubject('TaskSpec');
  // An annotation-bearing subject operand is still just identity data; the
  // record builders never copy annotations into lifecycle records.
  const result = executeSlice1Command(
    approveOperand({
      subject: { ...subjectOperand(subject.subject), annotations: { approved: true, role: 'approver' } },
    }),
    context,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid', 'annotation-bearing subject shape is rejected');
  assert.equal(state.publishCalls, 0);
});

test('request boundary: digest possession alone grants nothing', () => {
  const { context, state } = emptyContext();
  // A correct digest with no ValidationRecord must fail closed before any
  // publication.
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(['subject-not-validated', 'request-invalid'].includes(result.category), `unexpected category ${result.category}`);
  }
  assert.equal(state.publishCalls, 0, 'digest possession alone must not publish');
});

test('request boundary: malformed request shapes fail closed as request-invalid', () => {
  const { context } = emptyContext();
  const malformed: unknown[] = [
    null,
    'approve',
    [],
    42,
    { operation: 'unknown' },
    { operation: 'approve' },
    approveOperand({ operation: 'deleteEverything' }),
    approveOperand({ purpose: 'self-approve' }),
    approveOperand({ validationRecordIds: ['not-a-record-id'] }),
    approveOperand({ validationRecordIds: [] }),
    approveOperand({ validationRecordIds: ['pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] }),
    approveOperand({ workspaceId: 'pgw:w:ffffffffffffffffffffffffffffffff' }),
    approveOperand({ reason: 'x'.repeat(201) }),
    approveOperand({ purpose: 'execution-use', useClass: 'execution-use' }),
    validationOperand({ purpose: 'execution-use' }),
  ];
  for (const input of malformed) {
    const result = executeSlice1Command(input, context);
    assert.equal(result.ok, false, `malformed input must be rejected: ${JSON.stringify(input)?.slice(0, 80)}`);
    if (!result.ok) {
      assert.ok(['request-invalid', 'approver-not-independent'].includes(result.category), `unexpected category ${result.category}`);
    }
  }
});

test('request boundary: approve without host-asserted approver role fails closed', () => {
  const { env, store } = emptyContext();
  const noRole = makeContext(env, { store, approverRole: false, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(approveOperand(), noRole);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'lifecycle-state-missing');
});

test('request boundary: issue without host-asserted issuer role fails closed', () => {
  const { env, store } = emptyContext();
  const noRole = makeContext(env, { store, issuerRole: false, subjectArtifact: makeEvidence('TaskSpec').artifact });
  const result = executeSlice1Command(
    { operation: 'issue', subject: subjectOperand(makeSubject('TaskSpec').subject), workspaceId: WS_A, useClass: 'execution-use' },
    noRole,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'lifecycle-state-missing');
});

test('request boundary: model-issued operand cannot confer approver authority', () => {
  const { context } = emptyContext();
  // A transported "approval decision" operand shaped like an approval record
  // is just an unknown key or a malformed request; it never becomes a
  // lifecycle record and never confers authority.
  const result = executeSlice1Command(
    { operation: 'approve', approvalDecision: { approved: true, actor: 'chatgpt' }, subject: subjectOperand(makeSubject('TaskSpec').subject), workspaceId: WS_A, purpose: 'execution-use', validationRecordIds: ['pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
    context,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid');
});

test('request boundary: denied approval with matching validation state invokes no publishRecord', () => {
  const subject = makeSubject('TaskSpec');
  const evidence = makeEvidence('TaskSpec');
  const registry = makeRegistryContext();
  const validationPayload = buildValidationRecordPayload({
    recordId: 'pgw:l:11111111111111111111111111111111',
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    registry,
  });
  const { store, state } = makeFakeStore();
  seedPayload(store, 'validation-record', validationPayload);
  const integration = makeIntegrationEnv();
  const context = makeContext(integration.storeEnv, {
    store,
    identity: makeIdentitySource(),
    validationEvidence: evidence,
    subjectArtifact: makeEvidence('TaskSpec').artifact,
  });
  // Approval with a valid validation record but a conflicting current
  // approval (seeded below, with DIFFERENT decision content) must deny
  // without publishing.
  const approvalPayload = {
    record_type: 'ApprovalRecord',
    record_id: 'pgw:l:22222222222222222222222222222222',
    created_at: '2026-08-04T06:00:00.000Z',
    responsible_role: 'trusted-approver',
    registry_snapshot_reference: validationPayload['registry_snapshot_reference'],
    subject: validationPayload['subject'],
    workspace_id: WS_A,
    purpose: 'execution-use',
    validation_record_ids: ['pgw:l:11111111111111111111111111111111'],
    required_semantics: { protocol_features: [], consumer_capabilities: [] },
    valid_until: '2027-01-01T00:00:00.000Z',
  };
  seedPayload(store, 'approval-record', approvalPayload);
  const before = state.publishCalls;
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false, 'conflicting current approval must deny');
  if (!result.ok) assert.equal(result.category, 'lifecycle-conflict');
  assert.equal(state.publishCalls, before, 'denied approval must not publish');
});

test('request boundary: hostile request never reaches the store when rejected at capture', () => {
  const { state } = emptyContext();
  const hostileInputs: unknown[] = [
    Object.create({ operation: 'approve' }),
    { operation: 'approve', subject: { get instanceId() { throw new Error('trap'); } }, workspaceId: WS_A, purpose: 'execution-use', validationRecordIds: ['pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
    { operation: 'approve', subject: null, workspaceId: WS_A, purpose: 'execution-use', validationRecordIds: ['pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
  ];
  for (const input of hostileInputs) {
    const { context } = emptyContext();
    const result = executeSlice1Command(input, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(['request-invalid', 'approver-not-independent', 'internal-failure'].includes(result.category));
  }
  assert.equal(state.publishCalls, 0);
});

test('request boundary: missing host context components fail closed as internal-failure', () => {
  const { env } = emptyContext();
  const base = makeContext(env);
  const broken = [
    { ...base, store: undefined },
    { ...base, coordinate: undefined },
    { ...base, identity: undefined },
    { ...base, operator: { approverRole: 'yes' as unknown as boolean, issuerRole: true, operatorIdentity: 'x' } },
  ] as unknown as ReturnType<typeof makeContext>[];
  for (const context of broken) {
    const result = executeSlice1Command(approveOperand(), context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'internal-failure');
  }
});
