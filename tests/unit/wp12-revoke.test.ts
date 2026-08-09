/**
 * WP-12 Slice 2A — revoke focused tests (pure-core: fake store boundary +
 * real process-local coordinator).
 *
 * Proves: exact-key revoke request capture; revocation-role structural
 * authority (no request/artifact/reasonCode/echo conferral); target
 * lookup with non-disclosure; operational target classes; scope/effectiveAt/
 * reasonCode validation; registry echo correlation; duplicate (append-only,
 * future-dated-inclusive) semantics; target-derived lifecycle coordination
 * key shared with approve/issue; fail-fast lock behavior; mutation scope;
 * and Slice-1 currentness regression (issue/re-approval/re-issuance around
 * real RevocationRecord state).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import { createProcessLocalCoordinator } from '../../src/control-plane/coordination.js';
import { buildApprovalRecordPayload, buildIssuanceRecordPayload, buildRevocationRecordPayload, buildValidationRecordPayload, payloadDigestOf } from '../../src/control-plane/records.js';
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
  FIXED_NOW,
} from './wp12-helpers.js';
import type { ControlPlaneTrustedContext, DecisionCoordinator } from '../../src/control-plane/types.js';

after(() => cleanupTestEnvs());

const REGISTRY = makeRegistryContext();
const ECHO = Object.freeze({ registry_snapshot_id: REGISTRY.registrySnapshotId, registry_snapshot_digest: REGISTRY.registrySnapshotDigest });

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

function revokeOperand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation: 'revoke',
    workspaceId: WS_A,
    targetRecordType: 'ApprovalRecord',
    targetRecordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    scope: 'execution-use',
    effectiveAt: '2026-08-04T05:59:00.000Z',
    reasonCode: 'policy-withdrawn',
    registryEcho: ECHO,
    ...overrides,
  };
}

interface Env {
  readonly context: ControlPlaneTrustedContext;
  readonly store: ReturnType<typeof makeFakeStore>['store'];
  readonly state: ReturnType<typeof makeFakeStore>['state'];
}

/** Context over a fake store; host asserts the revocation role by default. */
function revokeEnv(overrides: { revokerRole?: boolean; approverRole?: boolean; issuerRole?: boolean; artifact?: boolean } = {}): Env {
  const { store, state } = makeFakeStore();
  const integration = makeIntegrationEnv();
  const context = makeContext(integration.storeEnv, {
    store,
    identity: makeIdentitySource(FIXED_NOW),
    revokerRole: overrides.revokerRole ?? true,
    approverRole: overrides.approverRole ?? true,
    issuerRole: overrides.issuerRole ?? true,
    ...(overrides.artifact === true ? { subjectArtifact: makeEvidence('TaskSpec').artifact } : {}),
  });
  return { context, store, state };
}

function seedApproval(store: Env['store'], subject = makeSubject('TaskSpec'), workspaceId = WS_A): string {
  const payload = buildApprovalRecordPayload({
    recordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    createdAt: FIXED_NOW,
    subject: subject.subject,
    workspaceId,
    purpose: 'execution-use',
    validationRecordIds: ['pgw:l:11111111111111111111111111111111'],
    requiredSemantics: { protocol_features: [], consumer_capabilities: [] },
    validUntil: null,
    registry: REGISTRY,
  });
  seedPayload(store, 'approval-record', payload);
  return 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
}

function seedIssuance(store: Env['store'], subject = makeSubject('TaskSpec'), workspaceId = WS_A): string {
  const payload = buildIssuanceRecordPayload({
    recordId: 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    createdAt: FIXED_NOW,
    subject: subject.subject,
    workspaceId,
    useClass: 'execution-use',
    approvalRecordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    activationLimit: 1,
    validUntil: null,
    registry: REGISTRY,
  });
  seedPayload(store, 'issuance-record', payload);
  return 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
}

function seedValidation(store: Env['store'], subject = makeSubject('TaskSpec')): string {
  const payload = buildValidationRecordPayload({
    recordId: 'pgw:l:11111111111111111111111111111111',
    createdAt: FIXED_NOW,
    subject: subject.subject,
    registry: REGISTRY,
  });
  seedPayload(store, 'validation-record', payload);
  return 'pgw:l:11111111111111111111111111111111';
}

function seedRevocation(store: Env['store'], opts: { scope?: 'all-uses' | 'execution-use'; effectiveAt?: string } = {}): void {
  const payload = buildRevocationRecordPayload({
    recordId: 'pgw:l:cccccccccccccccccccccccccccccccc',
    createdAt: FIXED_NOW,
    targetRecordType: 'ApprovalRecord',
    targetRecordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    scope: opts.scope ?? 'execution-use',
    effectiveAt: opts.effectiveAt ?? FIXED_NOW,
    reasonCode: 'policy-withdrawn',
    registry: REGISTRY,
  });
  seedPayload(store, 'revocation-record', payload);
}

/** The exact Slice-1 lifecycle coordination key encoding (family under test). */
function coordinationKey(subject: ReturnType<typeof makeSubject>['subject']): string {
  return `${subject.kindId}|${subject.instanceId}|${subject.revisionId}|${subject.digest}|${subject.workspaceId}`;
}

// ─── request / authority boundary ───────────────────────────────────────────

test('revoke: unknown and authority-bearing keys are rejected; role keys are approver-not-independent', () => {
  const { context, state } = revokeEnv();
  seedApproval(context.store);
  const before = state.publishCalls;
  for (const extra of ['configuration', 'store', 'coordinate', 'ceilings', 'auditAuthority', 'recordProvenance', 'writeAction', 'storeRoot']) {
    const result = executeSlice1Command(revokeOperand({ [extra]: 'hostile' }), context);
    assert.equal(result.ok, false, `key ${extra} must be rejected`);
    if (!result.ok) assert.equal(result.category, 'request-invalid');
  }
  for (const roleKey of ['revokerRole', 'revocationRole', 'revoker', 'revocationAuthority', 'role', 'trustedRole', 'operatorIdentity']) {
    const result = executeSlice1Command(revokeOperand({ [roleKey]: true }), context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'approver-not-independent', `role key ${roleKey} must be approver-not-independent`);
  }
  assert.equal(state.publishCalls, before, 'no publication on rejected requests');
});

test('revoke: the revocation role is host-asserted and distinct from approver/issuer', () => {
  const subject = makeSubject('TaskSpec');
  // No revocation role asserted (helper default) → denied.
  const noRole = revokeEnv({ revokerRole: false });
  seedApproval(noRole.store, subject);
  const denied = executeSlice1Command(revokeOperand(), noRole.context);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.category, 'lifecycle-state-missing');

  // Approver role alone does not imply revoker; issuer role alone does not imply revoker.
  const approverOnly = revokeEnv({ approverRole: true, issuerRole: false, revokerRole: false });
  seedApproval(approverOnly.store, subject);
  const denied2 = executeSlice1Command(revokeOperand(), approverOnly.context);
  assert.equal(denied2.ok, false);
  if (!denied2.ok) assert.equal(denied2.category, 'lifecycle-state-missing');

  const issuerOnly = revokeEnv({ approverRole: false, issuerRole: true, revokerRole: false });
  seedApproval(issuerOnly.store, subject);
  const denied3 = executeSlice1Command(revokeOperand(), issuerOnly.context);
  assert.equal(denied3.ok, false);
  if (!denied3.ok) assert.equal(denied3.category, 'lifecycle-state-missing');

  // reasonCode / registry echo / artifact-shaped operands never confer authority.
  const echoOnly = revokeEnv({ revokerRole: false });
  seedApproval(echoOnly.store, subject);
  const denied4 = executeSlice1Command(revokeOperand({ reasonCode: 'withdraw-all', artifact: { approved: true } }), echoOnly.context);
  assert.equal(denied4.ok, false);
  if (!denied4.ok) assert.equal(denied4.category, 'request-invalid'); // artifact key is unknown → request-invalid
  const denied5 = executeSlice1Command(revokeOperand(), echoOnly.context);
  assert.equal(denied5.ok, false);
  if (!denied5.ok) assert.equal(denied5.category, 'lifecycle-state-missing', 'echo cannot confer authority');

  // Host-asserted revocation role → success.
  const withRole = revokeEnv({ revokerRole: true });
  seedApproval(withRole.store, subject);
  const ok = executeSlice1Command(revokeOperand(), withRole.context);
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test('revoke: hostile getter/accessor request fails closed at capture', () => {
  const { context, state } = revokeEnv();
  const hostile = {
    operation: 'revoke',
    workspaceId: WS_A,
    get targetRecordType() { throw new Error('trap'); },
  };
  const result = executeSlice1Command(hostile, context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid');
  assert.equal(state.publishCalls, 0);
});

// ─── target / scope / time / echo semantics ─────────────────────────────────

test('revoke: ApprovalRecord and IssuanceRecord targets are accepted; immutable classes are request-invalid', () => {
  const { context } = revokeEnv();
  seedApproval(context.store);
  const approvalTarget = executeSlice1Command(revokeOperand(), context);
  assert.equal(approvalTarget.ok, true, JSON.stringify(approvalTarget));

  const issueEnv = revokeEnv();
  seedIssuance(issueEnv.store);
  const issuanceTarget = executeSlice1Command(revokeOperand({ targetRecordType: 'IssuanceRecord', targetRecordId: 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }), issueEnv.context);
  assert.equal(issuanceTarget.ok, true, JSON.stringify(issuanceTarget));

  // Immutable / non-Slice-2 target classes are rejected at capture.
  for (const immutableType of ['ValidationRecord', 'ActivationRecord', 'ExecutionOccurrenceRecord', 'TrustedReceipt', 'SupersessionRecord', 'RuntimeGrant', 'ResultPublicationRecord']) {
    const result = executeSlice1Command(revokeOperand({ targetRecordType: immutableType }), context);
    assert.equal(result.ok, false, `immutable type ${immutableType} must be rejected`);
    if (!result.ok) assert.equal(result.category, 'request-invalid');
  }
});

test('revoke: malformed target identity/type is request-invalid; nonexistent and out-of-workspace targets are indistinguishable lifecycle-state-missing', () => {
  const { context, state } = revokeEnv();
  seedApproval(context.store);
  const before = state.publishCalls;
  const malformedId = executeSlice1Command(revokeOperand({ targetRecordId: 'not-a-record-id' }), context);
  assert.equal(malformedId.ok, false);
  if (!malformedId.ok) assert.equal(malformedId.category, 'request-invalid');
  const malformedType = executeSlice1Command(revokeOperand({ targetRecordType: 'Approvalrecord' }), context);
  assert.equal(malformedType.ok, false);
  if (!malformedType.ok) assert.equal(malformedType.category, 'request-invalid');

  // Nonexistent target.
  const missing = executeSlice1Command(revokeOperand({ targetRecordId: 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }), context);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.category, 'lifecycle-state-missing');

  // Out-of-workspace target: seeded approval lives in a different workspace.
  const otherWs = revokeEnv();
  seedApproval(otherWs.store, makeSubject('TaskSpec'), 'pgw:w:99999999999999999999999999999999');
  const outOfScope = executeSlice1Command(revokeOperand(), otherWs.context);
  assert.equal(outOfScope.ok, false);
  if (!outOfScope.ok) assert.equal(outOfScope.category, 'lifecycle-state-missing');

  // Non-disclosure: identical public failure shape (category + message) for
  // nonexistent and out-of-workspace targets.
  assert.equal(missing.ok, false);
  assert.equal(outOfScope.ok, false);
  if (!missing.ok && !outOfScope.ok) {
    assert.equal(missing.category, outOfScope.category);
    assert.equal(missing.message, outOfScope.message);
  }
  assert.equal(state.publishCalls, before);
});

test('revoke: scope validation — all-uses and execution-use accepted; publication-only and malformed scopes are request-invalid', () => {
  const { context } = revokeEnv();
  seedApproval(context.store);
  const allUses = executeSlice1Command(revokeOperand({ scope: 'all-uses' }), context);
  assert.equal(allUses.ok, true, JSON.stringify(allUses));
  for (const badScope of ['ordinary-review', 'completion-status', 'downstream-automation', 'authoritative-reporting', 'banana', '']) {
    const result = executeSlice1Command(revokeOperand({ scope: badScope }), context);
    assert.equal(result.ok, false, `scope ${badScope} must be rejected`);
    if (!result.ok) assert.equal(result.category, 'request-invalid');
  }
});

test('revoke: reasonCode syntax is bounded; malformed is request-invalid', () => {
  const { context } = revokeEnv();
  seedApproval(context.store);
  const ok = executeSlice1Command(revokeOperand({ reasonCode: 'review-withdrawn' }), context);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  for (const bad of ['UPPER', 'has space', '', 'x'.repeat(65), '-leading']) {
    const result = executeSlice1Command(revokeOperand({ reasonCode: bad }), context);
    assert.equal(result.ok, false, `reasonCode ${JSON.stringify(bad)} must be rejected`);
    if (!result.ok) assert.equal(result.category, 'request-invalid');
  }
});

test('revoke: effectiveAt semantics — past, equal, and future all accepted; malformed is request-invalid', () => {
  const { context } = revokeEnv();
  seedApproval(context.store);
  seedIssuance(context.store);
  const past = executeSlice1Command(revokeOperand({ effectiveAt: '2026-08-04T05:00:00.000Z' }), context);
  assert.equal(past.ok, true);
  const equal = executeSlice1Command(revokeOperand({ scope: 'all-uses' }), context);
  assert.equal(equal.ok, true, JSON.stringify(equal)); // distinct scope → not a duplicate
  const future = executeSlice1Command(revokeOperand({ targetRecordId: 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', targetRecordType: 'IssuanceRecord', effectiveAt: '2030-01-01T00:00:00.000Z' }), context);
  assert.equal(future.ok, true, 'future-dated effectiveAt is a valid record');
  for (const bad of ['not-a-time', '2026-13-01T00:00:00.000Z', '2026-08-04T06:00:00Z', '']) {
    const result = executeSlice1Command(revokeOperand({ effectiveAt: bad }), context);
    assert.equal(result.ok, false, `effectiveAt ${bad} must be rejected`);
    if (!result.ok) assert.equal(result.category, 'request-invalid');
  }
});

test('revoke: registry echo is REQUIRED, correlation-only — missing/malformed are request-invalid, mismatch is registry-context-mismatch', () => {
  const { context } = revokeEnv();
  seedApproval(context.store);
  const missing = executeSlice1Command(revokeOperand({ registryEcho: undefined }), context);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.category, 'request-invalid');
  const malformed = executeSlice1Command(revokeOperand({ registryEcho: { registry_snapshot_id: 'nope' } }), context);
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.category, 'request-invalid');
  const malformed2 = executeSlice1Command(revokeOperand({ registryEcho: { registry_snapshot_id: ECHO.registry_snapshot_id, registry_snapshot_digest: 'sha-256:zzz' } }), context);
  assert.equal(malformed2.ok, false);
  if (!malformed2.ok) assert.equal(malformed2.category, 'request-invalid');
  const mismatch = executeSlice1Command(revokeOperand({ registryEcho: { registry_snapshot_id: ECHO.registry_snapshot_id, registry_snapshot_digest: `sha-256:${'0'.repeat(64)}` } }), context);
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.category, 'registry-context-mismatch');
  const matching = executeSlice1Command(revokeOperand(), context);
  assert.equal(matching.ok, true, JSON.stringify(matching));
});

// ─── duplicate / append-only semantics ──────────────────────────────────────

test('revoke: duplicate same target+scope is lifecycle-conflict; append-only single record; future-dated duplicates count', () => {
  const { context, store, state } = revokeEnv();
  seedApproval(store);
  const before = state.publishCalls;
  const first = executeSlice1Command(revokeOperand(), context);
  assert.equal(first.ok, true);
  const second = executeSlice1Command(revokeOperand(), context);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.category, 'lifecycle-conflict');
  const enumerated = store.enumerateLifecycleRecords('revocation-record');
  assert.equal(enumerated.ok, true);
  assert.equal(enumerated.recordIds.length, 1, 'exactly one RevocationRecord');
  assert.equal(state.publishCalls, before + 1, 'duplicate does not publish');

  // A future-dated existing revocation still counts for duplicate semantics.
  const futureEnv = revokeEnv();
  seedApproval(futureEnv.store);
  seedRevocation(futureEnv.store, { effectiveAt: '2030-01-01T00:00:00.000Z' });
  const dup = executeSlice1Command(revokeOperand(), futureEnv.context);
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.equal(dup.category, 'lifecycle-conflict', 'future-dated revocation blocks repeat');
});

test('revoke: duplicate/scope matrix — exact repeats existence-based; subsumption effectiveness-aware (SIR-W12-S2A-001)', () => {
  // CASE 1: execution-use + execution-use → lifecycle-conflict (also covered
  // by the append-only duplicate test).
  const c1 = revokeEnv();
  seedApproval(c1.store);
  seedRevocation(c1.store, { scope: 'execution-use' });
  const r1 = executeSlice1Command(revokeOperand(), c1.context);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.category, 'lifecycle-conflict');

  // CASE 2: all-uses + all-uses → lifecycle-conflict (exact-scope repeat).
  const c2 = revokeEnv();
  seedApproval(c2.store);
  seedRevocation(c2.store, { scope: 'all-uses' });
  const r2 = executeSlice1Command(revokeOperand({ scope: 'all-uses' }), c2.context);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.category, 'lifecycle-conflict');

  // CASE 3 + CASE 7 (equality boundary): EFFECTIVE all-uses (effectiveAt ==
  // trustedNow, since both are FIXED_NOW) + execution-use → lifecycle-conflict.
  const c3 = revokeEnv();
  seedApproval(c3.store);
  seedRevocation(c3.store, { scope: 'all-uses', effectiveAt: FIXED_NOW });
  const r3 = executeSlice1Command(revokeOperand(), c3.context);
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.equal(r3.category, 'lifecycle-conflict', 'equality effectiveAt == trustedNow subsumes execution-use');

  // CASE 4: execution-use + all-uses → success (broadening; execution-use
  // never subsumes all-uses).
  const c4 = revokeEnv();
  seedApproval(c4.store);
  seedRevocation(c4.store, { scope: 'execution-use' });
  const r4 = executeSlice1Command(revokeOperand({ scope: 'all-uses' }), c4.context);
  assert.equal(r4.ok, true, JSON.stringify(r4));

  // CASE 5: FUTURE-DATED execution-use + execution-use → lifecycle-conflict
  // (exact-scope repeats are existence-based, one-way replay).
  const c5 = revokeEnv();
  seedApproval(c5.store);
  seedRevocation(c5.store, { scope: 'execution-use', effectiveAt: '2030-01-01T00:00:00.000Z' });
  const r5 = executeSlice1Command(revokeOperand(), c5.context);
  assert.equal(r5.ok, false);
  if (!r5.ok) assert.equal(r5.category, 'lifecycle-conflict', 'future-dated exact-scope repeat still conflicts');
});

test('revoke: FUTURE-DATED all-uses does NOT block an effective execution-use revoke — two immutable records (CASE 6, SIR-W12-S2A-001)', () => {
  const { context, store, state } = revokeEnv();
  seedApproval(store);
  seedRevocation(store, { scope: 'all-uses', effectiveAt: '2030-01-01T00:00:00.000Z' });
  const before = state.publishCalls;
  const expectedTarget = buildApprovalRecordPayload({
    recordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    createdAt: FIXED_NOW,
    subject: makeSubject('TaskSpec').subject,
    workspaceId: WS_A,
    purpose: 'execution-use',
    validationRecordIds: ['pgw:l:11111111111111111111111111111111'],
    requiredSemantics: { protocol_features: [], consumer_capabilities: [] },
    validUntil: null,
    registry: REGISTRY,
  });
  const result = executeSlice1Command(revokeOperand(), context); // execution-use, effective now
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const revocations = store.enumerateLifecycleRecords('revocation-record');
  assert.equal(revocations.ok, true);
  assert.equal(revocations.recordIds.length, 2, 'future all-uses preserved + new execution-use appended');
  assert.equal(state.publishCalls, before + 1, 'exactly one new publication');
  const target = store.readLifecyclePayload('approval-record', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(target.ok, true);
  assert.equal(payloadDigestOf(target.payload!), payloadDigestOf(expectedTarget), 'target unchanged, no overwrite');
  const newRecord = store.readLifecyclePayload('revocation-record', result.evidence.recordId);
  assert.equal(newRecord.ok, true);
  assert.equal(newRecord.payload!['scope'], 'execution-use');
});

// ─── coordination / concurrency ─────────────────────────────────────────────

test('revoke: same-key reentrant acquisition is lock-conflict; unrelated keys are not conflated; lock releases after success', () => {
  const { context, store } = revokeEnv();
  const subject = makeSubject('TaskSpec');
  seedApproval(store, subject);
  const key = coordinationKey(subject.subject);
  const held = context.coordinate.withLock(key, () => executeSlice1Command(revokeOperand(), context));
  assert.equal(held.ok, false);
  if (!held.ok) assert.equal(held.category, 'lock-conflict', 'overlapping same-key acquisition fails fast');

  // Unrelated key unaffected: hold a different subject's key; revoke succeeds.
  const other = makeSubject('ContextManifest');
  context.coordinate.withLock(coordinationKey(other.subject), () => {
    const result = executeSlice1Command(revokeOperand(), context);
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  // Lock released after success: the same key can be re-acquired manually.
  context.coordinate.withLock(key, () => undefined);
});

test('revoke: lock releases after typed denial and after store failure; a later retry may proceed', () => {
  const { context, store, state } = revokeEnv();
  seedApproval(store);
  const first = executeSlice1Command(revokeOperand(), context);
  assert.equal(first.ok, true);
  const denied = executeSlice1Command(revokeOperand(), context);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.category, 'lifecycle-conflict');
  // Lock was released by the denial: a broader revoke (new scope) proceeds.
  const afterDenial = executeSlice1Command(revokeOperand({ scope: 'all-uses' }), context);
  assert.equal(afterDenial.ok, true, JSON.stringify(afterDenial));

  // Store failure → store-failure; lock released; retry with working store succeeds.
  const failing = revokeEnv();
  seedApproval(failing.store);
  seedIssuance(failing.store);
  failing.state.throwOnPublish = true;
  const failed = executeSlice1Command(revokeOperand({ targetRecordId: 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', targetRecordType: 'IssuanceRecord' }), failing.context);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.category, 'store-failure');
  failing.state.throwOnPublish = false;
  const retry = executeSlice1Command(revokeOperand({ targetRecordId: 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', targetRecordType: 'IssuanceRecord' }), failing.context);
  assert.equal(retry.ok, true, JSON.stringify(retry));
});

test('revoke and issue share the same lifecycle coordination-key family', () => {
  const { store, state } = makeFakeStore();
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const keys: string[] = [];
  const recording: DecisionCoordinator = {
    withLock<T>(key: string, fn: () => T): T {
      keys.push(key);
      return createProcessLocalCoordinator().withLock(key, fn);
    },
  };
  const identity = makeIdentitySource(FIXED_NOW);
  const context = makeContext(integration.storeEnv, {
    store,
    coordinate: recording,
    identity,
    revokerRole: true,
    subjectArtifact: makeEvidence('TaskSpec').artifact,
  });
  seedValidation(store, subject);
  seedApproval(store, subject);
  const issuance = executeSlice1Command({ operation: 'issue', subject: subjectOperand(subject.subject), workspaceId: WS_A, useClass: 'execution-use' }, context);
  assert.equal(issuance.ok, true, JSON.stringify(issuance));
  const revocation = executeSlice1Command(revokeOperand(), context);
  assert.equal(revocation.ok, true, JSON.stringify(revocation));
  assert.ok(keys.length >= 2, 'both operations must acquire the coordinator');
  assert.equal(keys[keys.length - 2], keys[keys.length - 1], 'issue and revoke must use the same lifecycle key');
});

test('revoke→issue direct operation reentrancy: issue re-entering during revoke\'s critical section fails lock-conflict; owner completes; later retry sees the revocation (SIR-W12-S2A-003)', () => {
  const { store, state } = makeFakeStore();
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(store, subject);
  seedApproval(store, subject);
  const identity = makeIdentitySource(FIXED_NOW);
  const issueInput = { operation: 'issue', subject: subjectOperand(subject.subject), workspaceId: WS_A, useClass: 'execution-use' };
  let inner: ReturnType<typeof executeSlice1Command> | undefined;
  const reentrantStore: Env['store'] = {
    ...store,
    publishLifecycleRecord(recordClass, payload) {
      const result = store.publishLifecycleRecord(recordClass, payload);
      // During revoke's under-lock publication window, issue re-enters for
      // the SAME lifecycle subject (exercises BOTH actual operation bodies).
      if (recordClass === 'revocation-record' && inner === undefined) {
        inner = executeSlice1Command(issueInput, context);
      }
      return result;
    },
  };
  const context = makeContext(integration.storeEnv, {
    store: reentrantStore,
    identity,
    revokerRole: true,
    subjectArtifact: makeEvidence('TaskSpec').artifact,
  });
  const revoke = executeSlice1Command(revokeOperand(), context);
  assert.equal(revoke.ok, true, JSON.stringify(revoke));
  assert.ok(inner !== undefined, 'issue must have re-entered during the revocation publication');
  assert.equal(inner.ok, false);
  if (!inner.ok) assert.equal(inner.category, 'lock-conflict', 'issue must fail fast on the key owned by revoke');
  // Owner completed; lock released: a later issue retry re-reads current
  // state and observes the effective revocation.
  const retry = executeSlice1Command(issueInput, context);
  assert.equal(retry.ok, false);
  if (!retry.ok) assert.equal(retry.category, 'approval-revoked', 'later retry sees the effective revocation');
  assert.equal(state.byClass.get('issuance-record')?.length ?? 0, 0, 'the re-entered issue never published');
  assert.equal(state.byClass.get('revocation-record')?.length ?? 0, 1, 'exactly one RevocationRecord');
});

test('issue→revoke direct operation reentrancy: revoke re-entering during issue\'s critical section fails lock-conflict; owner completes; later revoke proceeds (SIR-W12-S2A-003)', () => {
  const { store, state } = makeFakeStore();
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(store, subject);
  seedApproval(store, subject);
  const identity = makeIdentitySource(FIXED_NOW);
  const issueInput = { operation: 'issue', subject: subjectOperand(subject.subject), workspaceId: WS_A, useClass: 'execution-use' };
  let inner: ReturnType<typeof executeSlice1Command> | undefined;
  const reentrantStore: Env['store'] = {
    ...store,
    publishLifecycleRecord(recordClass, payload) {
      const result = store.publishLifecycleRecord(recordClass, payload);
      // During issue's under-lock publication window, revoke re-enters for
      // the SAME lifecycle subject.
      if (recordClass === 'issuance-record' && inner === undefined) {
        inner = executeSlice1Command(revokeOperand(), context);
      }
      return result;
    },
  };
  const context = makeContext(integration.storeEnv, {
    store: reentrantStore,
    identity,
    revokerRole: true,
    subjectArtifact: makeEvidence('TaskSpec').artifact,
  });
  const issue = executeSlice1Command(issueInput, context);
  assert.equal(issue.ok, true, JSON.stringify(issue));
  assert.ok(inner !== undefined, 'revoke must have re-entered during the issuance publication');
  assert.equal(inner.ok, false);
  if (!inner.ok) assert.equal(inner.category, 'lock-conflict', 'revoke must fail fast on the key owned by issue');
  // Owner completed; lock released: a later revoke re-reads and proceeds.
  const retry = executeSlice1Command(revokeOperand(), context);
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(state.byClass.get('revocation-record')?.length ?? 0, 1, 'the later revoke published exactly one record');
});

// ─── mutation scope / append-only invariant ─────────────────────────────────

test('revoke: success publishes exactly one RevocationRecord and leaves the target byte-identical', () => {
  const { context, store, state } = revokeEnv();
  seedApproval(store);
  const before = state.publishCalls;
  const beforePayload = store.readLifecyclePayload('approval-record', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(beforePayload.ok, true);
  const result = executeSlice1Command(revokeOperand(), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(state.publishCalls, before + 1, 'exactly one publication');
  assert.equal(result.outcome, 'revoked');
  assert.equal(result.evidence.recordClass, 'revocation-record');
  const after = store.readLifecyclePayload('approval-record', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(after.ok, true);
  assert.equal(payloadDigestOf(after.payload!), payloadDigestOf(beforePayload.payload!), 'target must remain byte-identical');
  const revocations = store.enumerateLifecycleRecords('revocation-record');
  assert.equal(revocations.ok, true);
  assert.equal(revocations.recordIds.length, 1);
});

// ─── Slice-1 currentness regression through real revocation state ──────────

test('Slice-1 regression: issue after effective approval revocation is approval-revoked; future-dated revocation does not block', () => {
  const { context, store } = revokeEnv({ artifact: true });
  const subject = makeSubject('TaskSpec');
  seedValidation(store, subject);
  seedApproval(store, subject);
  const issueInput = { operation: 'issue', subject: subjectOperand(subject.subject), workspaceId: WS_A, useClass: 'execution-use' };

  // Effective revocation (past effectiveAt, execution-use) → issue denied.
  const revoked = executeSlice1Command(revokeOperand(), context);
  assert.equal(revoked.ok, true);
  const denied = executeSlice1Command(issueInput, context);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.category, 'approval-revoked');

  // Future-dated revocation → not yet effective → issue still proceeds.
  const futureEnv = revokeEnv({ artifact: true });
  seedValidation(futureEnv.store, subject);
  seedApproval(futureEnv.store, subject);
  seedRevocation(futureEnv.store, { effectiveAt: '2030-01-01T00:00:00.000Z' });
  const issued = executeSlice1Command(issueInput, futureEnv.context);
  assert.equal(issued.ok, true, JSON.stringify(issued));
});

test('Slice-1 regression: re-approval after revocation and re-issuance after issuance revocation remain new commands/new records', () => {
  const { context, store } = revokeEnv({ artifact: true });
  const subject = makeSubject('TaskSpec');
  seedValidation(store, subject);
  seedApproval(store, subject);
  const revoked = executeSlice1Command(revokeOperand(), context);
  assert.equal(revoked.ok, true);
  // Re-approval: a new command creates a NEW ApprovalRecord (historical revoked approval does not block).
  const reapprove = executeSlice1Command(
    { operation: 'approve', subject: subjectOperand(subject.subject), workspaceId: WS_A, purpose: 'execution-use', validationRecordIds: ['pgw:l:11111111111111111111111111111111'] },
    context,
  );
  assert.equal(reapprove.ok, true, JSON.stringify(reapprove));
  if (!reapprove.ok) return;
  assert.notEqual(reapprove.evidence.recordId, 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 're-approval is a new record');
  const approvals = store.enumerateLifecycleRecords('approval-record');
  assert.equal(approvals.ok, true);
  assert.equal(approvals.recordIds.length, 2, 'revoked approval remains historical; new approval appended');

  // Re-issuance after issuance revocation: prior revoked issuance is historical.
  const reissueEnv = revokeEnv({ artifact: true });
  seedValidation(reissueEnv.store, subject);
  seedApproval(reissueEnv.store, subject);
  seedIssuance(reissueEnv.store, subject);
  const revokeIssuance = executeSlice1Command(revokeOperand({ targetRecordType: 'IssuanceRecord', targetRecordId: 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }), reissueEnv.context);
  assert.equal(revokeIssuance.ok, true, JSON.stringify(revokeIssuance));
  const reissue = executeSlice1Command({ operation: 'issue', subject: subjectOperand(subject.subject), workspaceId: WS_A, useClass: 'execution-use' }, reissueEnv.context);
  assert.equal(reissue.ok, true, JSON.stringify(reissue));
});
