/**
 * WP-12 Slice 2B — verifyCurrentLifecycleState focused tests (pure-core:
 * fake store boundary + real process-local coordinator).
 *
 * Proves: exact-key verify request capture (purpose XOR useClass; required
 * registry echo; required capabilityRequirements / consumerSupport; no
 * authority transport); malformed-subject → subject-invalid; approval-form
 * and issuance-form currentness (revocation/expiry/registry/multiple-
 * current/validation-chain); capability/consumer/ceiling intersection;
 * deterministic failure precedence; zero publication; zero coordinator
 * use (no mutation lock); store-failure redaction; stale-evidence
 * non-authority; and the admitted non-linearizable verify↔revoke race.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import { createProcessLocalCoordinator } from '../../src/control-plane/coordination.js';
import { buildApprovalRecordPayload, buildIssuanceRecordPayload, buildRevocationRecordPayload, buildValidationRecordPayload } from '../../src/control-plane/records.js';
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
import type { ControlPlaneTrustedContext } from '../../src/control-plane/types.js';

after(() => cleanupTestEnvs());

const REGISTRY = makeRegistryContext();
const ECHO = Object.freeze({ registry_snapshot_id: REGISTRY.registrySnapshotId, registry_snapshot_digest: REGISTRY.registrySnapshotDigest });
const OLD_REGISTRY = Object.freeze({
  ...REGISTRY,
  registrySnapshotId: 'pgw:g:11111111111111111111111111111111',
  registrySnapshotDigest: `sha-256:${'1'.repeat(64)}`,
});

/** A consumer that declares support for everything relevant (no denial source). */
const SUPPORT_ALL = Object.freeze({
  consumerId: 'test-consumer',
  supportedProtocolFeatures: ['project-gateway.protocol-v1'],
  supportedConsumerCapabilities: ['project-gateway.approval-operate', 'project-gateway.lifecycle-issue', 'project-gateway.file-edit'],
  supportedExtensionNamespaces: [],
});
/** A consumer that declares no capabilities (denial source for consumer intersection). */
const SUPPORT_NONE = Object.freeze({
  consumerId: 'test-consumer',
  supportedProtocolFeatures: [],
  supportedConsumerCapabilities: [],
  supportedExtensionNamespaces: [],
});

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

function verifyOperand(subject: ReturnType<typeof makeSubject>['subject'], overrides: Record<string, unknown> = {}, form: 'approval' | 'issuance' = 'approval'): Record<string, unknown> {
  return {
    operation: 'verifyCurrentLifecycleState',
    subject: subjectOperand(subject),
    workspaceId: WS_A,
    ...(form === 'approval' ? { purpose: 'execution-use' } : { useClass: 'execution-use' }),
    registryEcho: ECHO,
    capabilityRequirements: [],
    consumerSupport: SUPPORT_ALL,
    ...overrides,
  };
}

interface Env {
  readonly context: ControlPlaneTrustedContext;
  readonly store: ReturnType<typeof makeFakeStore>['store'];
  readonly state: ReturnType<typeof makeFakeStore>['state'];
}

/** Context over a fake store; all roles OFF by default (verify needs no role). */
function verifyEnv(overrides: { artifact?: boolean; revokerRole?: boolean } = {}): Env {
  const { store, state } = makeFakeStore();
  const integration = makeIntegrationEnv();
  const context = makeContext(integration.storeEnv, {
    store,
    identity: makeIdentitySource(FIXED_NOW),
    approverRole: false,
    issuerRole: false,
    revokerRole: overrides.revokerRole ?? false,
    ...(overrides.artifact === true ? { subjectArtifact: makeEvidence('TaskSpec').artifact } : {}),
  });
  return { context, store, state };
}

function seedValidation(store: Env['store'], subject = makeSubject('TaskSpec'), recordId = 'pgw:l:11111111111111111111111111111111'): string {
  const payload = buildValidationRecordPayload({
    recordId,
    createdAt: FIXED_NOW,
    subject: subject.subject,
    registry: REGISTRY,
  });
  seedPayload(store, 'validation-record', payload);
  return recordId;
}

function seedApproval(store: Env['store'], subject = makeSubject('TaskSpec'), opts: { recordId?: string; validUntil?: string | null; registry?: typeof REGISTRY; purpose?: string; validationRecordIds?: string[] } = {}): string {
  const recordId = opts.recordId ?? 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const payload = buildApprovalRecordPayload({
    recordId,
    createdAt: FIXED_NOW,
    subject: subject.subject,
    workspaceId: WS_A,
    purpose: (opts.purpose ?? 'execution-use') as 'execution-use',
    validationRecordIds: opts.validationRecordIds ?? ['pgw:l:11111111111111111111111111111111'],
    requiredSemantics: { protocol_features: [], consumer_capabilities: [] },
    validUntil: opts.validUntil === undefined ? null : opts.validUntil,
    registry: opts.registry ?? REGISTRY,
  });
  seedPayload(store, 'approval-record', payload);
  return recordId;
}

function seedIssuance(store: Env['store'], subject = makeSubject('TaskSpec'), opts: { recordId?: string; validUntil?: string | null; approvalRecordId?: string } = {}): string {
  const recordId = opts.recordId ?? 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const payload = buildIssuanceRecordPayload({
    recordId,
    createdAt: FIXED_NOW,
    subject: subject.subject,
    workspaceId: WS_A,
    useClass: 'execution-use',
    approvalRecordId: opts.approvalRecordId ?? 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    activationLimit: 1,
    validUntil: opts.validUntil === undefined ? null : opts.validUntil,
    registry: REGISTRY,
  });
  seedPayload(store, 'issuance-record', payload);
  return recordId;
}

function seedRevocation(store: Env['store'], targetRecordId: string, opts: { scope?: 'all-uses' | 'execution-use'; effectiveAt?: string; recordId?: string; registry?: typeof REGISTRY; targetRecordType?: 'ApprovalRecord' | 'IssuanceRecord' } = {}): void {
  const payload = buildRevocationRecordPayload({
    recordId: opts.recordId ?? 'pgw:l:cccccccccccccccccccccccccccccccc',
    createdAt: FIXED_NOW,
    targetRecordType: opts.targetRecordType ?? 'ApprovalRecord',
    targetRecordId,
    scope: opts.scope ?? 'execution-use',
    effectiveAt: opts.effectiveAt ?? FIXED_NOW,
    reasonCode: 'policy-withdrawn',
    registry: opts.registry ?? REGISTRY,
  });
  seedPayload(store, 'revocation-record', payload);
}

function expectFailure(result: ReturnType<typeof executeSlice1Command>, category: string): void {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.equal(result.category, category);
}

// ─── request capture / authority boundary ───────────────────────────────────

test('verify: unknown, authority-bearing, and role-assertion keys are rejected; hostile getters fail closed', () => {
  const { context, state } = verifyEnv();
  const subject = makeSubject('TaskSpec');
  const before = state.publishCalls;
  for (const extra of ['configuration', 'store', 'coordinate', 'ceilings', 'auditAuthority', 'recordProvenance', 'writeAction', 'storeRoot', 'verification', 'evidence']) {
    const result = executeSlice1Command(verifyOperand(subject.subject, { [extra]: 'hostile' }), context);
    assert.equal(result.ok, false, `key ${extra} must be rejected`);
    if (!result.ok) assert.equal(result.category, 'request-invalid');
  }
  for (const roleKey of ['approverRole', 'issuerRole', 'revokerRole', 'revocationRole', 'revoker', 'role', 'trustedRole', 'operatorIdentity']) {
    const result = executeSlice1Command(verifyOperand(subject.subject, { [roleKey]: true }), context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'approver-not-independent', `role key ${roleKey} must be approver-not-independent`);
  }
  const hostile = {
    operation: 'verifyCurrentLifecycleState',
    subject: subjectOperand(subject.subject),
    workspaceId: WS_A,
    get purpose() { throw new Error('trap'); },
  };
  const trapped = executeSlice1Command(hostile, context);
  assert.equal(trapped.ok, false);
  if (!trapped.ok) assert.equal(trapped.category, 'request-invalid');
  assert.equal(state.publishCalls, before, 'no publication on rejected requests');
});

test('verify: exactly one scope form — both purpose and useClass, or neither, is request-invalid', () => {
  const { context } = verifyEnv();
  const subject = makeSubject('TaskSpec');
  const both = executeSlice1Command(verifyOperand(subject.subject, { useClass: 'execution-use' }), context);
  assert.equal(both.ok, false);
  if (!both.ok) assert.equal(both.category, 'request-invalid');
  const neither = executeSlice1Command({
    operation: 'verifyCurrentLifecycleState',
    subject: subjectOperand(subject.subject),
    workspaceId: WS_A,
    registryEcho: ECHO,
    capabilityRequirements: [],
    consumerSupport: SUPPORT_ALL,
  }, context);
  assert.equal(neither.ok, false);
  if (!neither.ok) assert.equal(neither.category, 'request-invalid');
  const badPurpose = executeSlice1Command(verifyOperand(subject.subject, { purpose: 'banana' }), context);
  assert.equal(badPurpose.ok, false);
  if (!badPurpose.ok) assert.equal(badPurpose.category, 'request-invalid');
  const badUseClass = executeSlice1Command(verifyOperand(subject.subject, { useClass: 'banana' }, 'issuance'), context);
  assert.equal(badUseClass.ok, false);
  if (!badUseClass.ok) assert.equal(badUseClass.category, 'request-invalid');
});

test('verify: malformed canonical subject is subject-invalid (shape and syntax); workspace mismatch is request-invalid', () => {
  const { context } = verifyEnv();
  const subject = makeSubject('TaskSpec');
  const shape = executeSlice1Command(verifyOperand(subject.subject, { subject: { protocolId: 'x' } }), context);
  assert.equal(shape.ok, false);
  if (!shape.ok) assert.equal(shape.category, 'subject-invalid', 'subject shape failure must be subject-invalid');
  const syntax = executeSlice1Command(verifyOperand(subject.subject, { subject: { ...subjectOperand(subject.subject), kindId: 'NotAKind' } }), context);
  assert.equal(syntax.ok, false);
  if (!syntax.ok) assert.equal(syntax.category, 'subject-invalid', 'subject syntax failure must be subject-invalid');
  const wsMismatch = executeSlice1Command(verifyOperand(subject.subject, { workspaceId: 'pgw:w:99999999999999999999999999999999' }), context);
  assert.equal(wsMismatch.ok, false);
  if (!wsMismatch.ok) assert.equal(wsMismatch.category, 'request-invalid');
});

test('verify: registry echo is REQUIRED, correlation-only — missing/malformed are request-invalid, mismatch is registry-context-mismatch', () => {
  const { context } = verifyEnv();
  const subject = makeSubject('TaskSpec');
  const missing = executeSlice1Command(verifyOperand(subject.subject, { registryEcho: undefined }), context);
  expectFailure(missing, 'request-invalid');
  const malformed = executeSlice1Command(verifyOperand(subject.subject, { registryEcho: { registry_snapshot_id: 'nope' } }), context);
  expectFailure(malformed, 'request-invalid');
  const mismatch = executeSlice1Command(verifyOperand(subject.subject, { registryEcho: { registry_snapshot_id: ECHO.registry_snapshot_id, registry_snapshot_digest: `sha-256:${'0'.repeat(64)}` } }), context);
  expectFailure(mismatch, 'registry-context-mismatch');
});

test('verify: capabilityRequirements — malformed syntax is request-invalid; duplicates bounded', () => {
  const { context } = verifyEnv();
  const subject = makeSubject('TaskSpec');
  for (const bad of ['bogus', 'project-gateway.', 'project-gateway.UPPER', 'project-gateway.a b', 'x.y.z', 42, ['project-gateway.file-edit'], 'not-a-capability']) {
    const result = executeSlice1Command(verifyOperand(subject.subject, { capabilityRequirements: [bad] }), context);
    assert.equal(result.ok, false, `capability ${JSON.stringify(bad)} must be request-invalid`);
    if (!result.ok) assert.equal(result.category, 'request-invalid');
  }
  const dup = executeSlice1Command(verifyOperand(subject.subject, { capabilityRequirements: ['project-gateway.file-edit', 'project-gateway.file-edit'] }), context);
  expectFailure(dup, 'request-invalid');
  const tooMany = executeSlice1Command(verifyOperand(subject.subject, { capabilityRequirements: Array.from({ length: 65 }, (_, i) => `project-gateway.cap-${i}`) }), context);
  expectFailure(tooMany, 'request-invalid');
});

test('verify: consumerSupport — malformed declaration is request-invalid', () => {
  const { context } = verifyEnv();
  const subject = makeSubject('TaskSpec');
  for (const bad of [
    { consumerId: '' },
    { consumerId: 'c', supportedProtocolFeatures: [], supportedConsumerCapabilities: [], supportedExtensionNamespaces: [], extra: true },
    { consumerId: 'c', supportedProtocolFeatures: 'x', supportedConsumerCapabilities: [], supportedExtensionNamespaces: [] },
    { consumerId: 'c', supportedProtocolFeatures: [1], supportedConsumerCapabilities: [], supportedExtensionNamespaces: [] },
    { consumerId: 'c', supportedProtocolFeatures: [], supportedConsumerCapabilities: [], supportedExtensionNamespaces: [''] },
  ]) {
    const result = executeSlice1Command(verifyOperand(subject.subject, { consumerSupport: bad }), context);
    assert.equal(result.ok, false, `consumerSupport ${JSON.stringify(bad)} must be request-invalid`);
    if (!result.ok) assert.equal(result.category, 'request-invalid');
  }
});

// ─── approval form ──────────────────────────────────────────────────────────

test('verify approval form: current approval succeeds with bounded evidence; zero publish; zero coordinator use; no role needed', () => {
  const { context, store, state } = verifyEnv({ revokerRole: false });
  const subject = makeSubject('TaskSpec');
  seedValidation(store, subject);
  seedApproval(store, subject);
  const before = state.publishCalls;
  let lockCalls = 0;
  const contextWithRecorder: ControlPlaneTrustedContext = {
    ...context,
    coordinate: {
      withLock<T>(_key: string, fn: () => T): T {
        lockCalls += 1;
        return createProcessLocalCoordinator().withLock(_key, fn);
      },
    },
  };
  const result = executeSlice1Command(verifyOperand(subject.subject), contextWithRecorder);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.outcome, 'verified');
  assert.equal(lockCalls, 0, 'verification must never acquire the mutation coordination lock');
  assert.equal(state.publishCalls, before, 'verification must publish nothing');
  const evidence = result.evidence;
  assert.equal(evidence.recordClass, 'approval-record');
  assert.equal(evidence.recordId, 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(evidence.purpose, 'execution-use');
  assert.equal(evidence.approvalRecordId, 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(evidence.registrySnapshotId, REGISTRY.registrySnapshotId);
  assert.equal(evidence.registrySnapshotDigest, REGISTRY.registrySnapshotDigest);
  assert.equal(evidence.verifiedAt, FIXED_NOW);
  assert.equal(evidence.currentState, 'current');
  assert.equal(evidence.intersection, 'satisfied');
  assert.equal(evidence.issuanceRecordId, undefined);
  assert.equal(evidence.auditEventId, undefined, 'no audit event identity for a read-only verification');
  // Bounded shape: only the accepted evidence keys are present.
  const keys = Object.keys(evidence).sort();
  assert.deepEqual(keys, [
    'approvalRecordId', 'currentState', 'intersection', 'purpose', 'recordClass', 'recordId', 'registrySnapshotDigest',
    'registrySnapshotId', 'subject', 'verifiedAt', 'workspaceId',
  ]);
});

test('verify approval form: no matching approval is lifecycle-state-missing; non-matching purpose is excluded', () => {
  const { context, store } = verifyEnv();
  const subject = makeSubject('TaskSpec');
  const missing = executeSlice1Command(verifyOperand(subject.subject), context);
  expectFailure(missing, 'lifecycle-state-missing');
  // An approval for a DIFFERENT exact subject is not a match (exact canonical
  // subject correlation); the request-purpose filter additionally excludes
  // any stored approval under a different purpose.
  seedValidation(store, subject);
  const other = makeSubject('ContextManifest');
  seedValidation(store, other, 'pgw:l:22222222222222222222222222222222');
  seedApproval(store, other);
  const noMatch = executeSlice1Command(verifyOperand(subject.subject), context);
  expectFailure(noMatch, 'lifecycle-state-missing');
});

test('verify approval form: effective and equality-boundary revocations are approval-revoked; future-dated revocation stays current', () => {
  const { context, store } = verifyEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(store, subject);
  seedApproval(store, subject);
  seedRevocation(store, 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { effectiveAt: FIXED_NOW }); // equality: effectiveAt == trustedNow
  const revoked = executeSlice1Command(verifyOperand(subject.subject), context);
  expectFailure(revoked, 'approval-revoked');

  const futureEnv = verifyEnv();
  seedValidation(futureEnv.store);
  seedApproval(futureEnv.store);
  seedRevocation(futureEnv.store, 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { effectiveAt: '2030-01-01T00:00:00.000Z' });
  const future = executeSlice1Command(verifyOperand(subject.subject), futureEnv.context);
  assert.equal(future.ok, true, JSON.stringify(future));
});

test('verify approval form: expired approval (validUntil < now and == now) is lifecycle-state-missing', () => {
  for (const validUntil of ['2026-08-04T05:00:00.000Z', FIXED_NOW]) {
    const { context, store } = verifyEnv();
    const subject = makeSubject('TaskSpec');
    seedValidation(store, subject);
    seedApproval(store, subject, { validUntil });
    const result = executeSlice1Command(verifyOperand(subject.subject), context);
    expectFailure(result, 'lifecycle-state-missing');
  }
});

test('verify approval form: multiple current matching approvals are lifecycle-conflict (no arbitrary selection)', () => {
  const { context, store } = verifyEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(store, subject);
  seedApproval(store, subject, { recordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  seedApproval(store, subject, { recordId: 'pgw:l:dddddddddddddddddddddddddddddddd' });
  const result = executeSlice1Command(verifyOperand(subject.subject), context);
  expectFailure(result, 'lifecycle-conflict');
});

test('verify approval form: old-registry approval is registry-context-mismatch, not current', () => {
  const { context, store } = verifyEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(store, subject);
  seedApproval(store, subject, { registry: OLD_REGISTRY });
  const result = executeSlice1Command(verifyOperand(subject.subject), context);
  expectFailure(result, 'registry-context-mismatch');
});

test('verify approval form: broken validation chain makes the approval unusable (lifecycle-state-missing)', () => {
  const { context, store } = verifyEnv();
  const subject = makeSubject('TaskSpec');
  // No ValidationRecord exists for the reference → LFC-001/002 via the accepted graph.
  seedApproval(store, subject, { validationRecordIds: ['pgw:l:99999999999999999999999999999999'] });
  const result = executeSlice1Command(verifyOperand(subject.subject), context);
  expectFailure(result, 'lifecycle-state-missing');
});

// ─── issuance form ──────────────────────────────────────────────────────────

test('verify issuance form: current issuance with current referenced approval succeeds', () => {
  const { context, store, state } = verifyEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(store, subject);
  seedApproval(store, subject);
  seedIssuance(store, subject);
  const before = state.publishCalls;
  const result = executeSlice1Command(verifyOperand(subject.subject, {}, 'issuance'), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.evidence.recordClass, 'issuance-record');
  assert.equal(result.evidence.recordId, 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(result.evidence.issuanceRecordId, 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(result.evidence.approvalRecordId, 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(result.evidence.useClass, 'execution-use');
  assert.equal(state.publishCalls, before);
});

test('verify issuance form: missing / revoked / expired issuance is issuance-not-authorized', () => {
  const subject = makeSubject('TaskSpec');
  const missingEnv = verifyEnv();
  seedValidation(missingEnv.store, subject);
  seedApproval(missingEnv.store, subject);
  expectFailure(executeSlice1Command(verifyOperand(subject.subject, {}, 'issuance'), missingEnv.context), 'issuance-not-authorized');

  const revokedEnv = verifyEnv();
  seedValidation(revokedEnv.store, subject);
  seedApproval(revokedEnv.store, subject);
  seedIssuance(revokedEnv.store, subject);
  seedRevocation(revokedEnv.store, 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', { recordId: 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', targetRecordType: 'IssuanceRecord' });
  expectFailure(executeSlice1Command(verifyOperand(subject.subject, {}, 'issuance'), revokedEnv.context), 'issuance-not-authorized');

  const expiredEnv = verifyEnv();
  seedValidation(expiredEnv.store, subject);
  seedApproval(expiredEnv.store, subject);
  seedIssuance(expiredEnv.store, subject, { validUntil: '2026-08-04T05:00:00.000Z' });
  expectFailure(executeSlice1Command(verifyOperand(subject.subject, {}, 'issuance'), expiredEnv.context), 'issuance-not-authorized');
});

test('verify issuance form: multiple current issuances are lifecycle-conflict', () => {
  const { context, store } = verifyEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(store, subject);
  seedApproval(store, subject);
  seedIssuance(store, subject, { recordId: 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
  seedIssuance(store, subject, { recordId: 'pgw:l:ffffffffffffffffffffffffffffffff' });
  const result = executeSlice1Command(verifyOperand(subject.subject, {}, 'issuance'), context);
  expectFailure(result, 'lifecycle-conflict');
});

test('verify issuance form: revoked referenced approval is approval-revoked; expired or missing referenced approval is issuance-not-authorized', () => {
  const subject = makeSubject('TaskSpec');
  const revokedApprovalEnv = verifyEnv();
  seedValidation(revokedApprovalEnv.store, subject);
  seedApproval(revokedApprovalEnv.store, subject);
  seedIssuance(revokedApprovalEnv.store, subject);
  seedRevocation(revokedApprovalEnv.store, 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  expectFailure(
    executeSlice1Command(verifyOperand(subject.subject, {}, 'issuance'), revokedApprovalEnv.context),
    'approval-revoked',
  );

  const expiredApprovalEnv = verifyEnv();
  seedValidation(expiredApprovalEnv.store, subject);
  seedApproval(expiredApprovalEnv.store, subject, { validUntil: '2026-08-04T05:00:00.000Z' });
  seedIssuance(expiredApprovalEnv.store, subject);
  expectFailure(
    executeSlice1Command(verifyOperand(subject.subject, {}, 'issuance'), expiredApprovalEnv.context),
    'issuance-not-authorized',
  );

  const missingApprovalEnv = verifyEnv();
  seedValidation(missingApprovalEnv.store, subject);
  seedIssuance(missingApprovalEnv.store, subject, { approvalRecordId: 'pgw:l:99999999999999999999999999999999' });
  expectFailure(
    executeSlice1Command(verifyOperand(subject.subject, {}, 'issuance'), missingApprovalEnv.context),
    'issuance-not-authorized',
  );
});

// ─── intersection ───────────────────────────────────────────────────────────

test('verify: capability/consumer/ceiling intersection — unknown capability and consumer denial are eligibility-denied; ceiling denial is ceiling-denied', () => {
  const subject = makeSubject('TaskSpec');
  // Unknown but well-formed capability → eligibility-denied (state current).
  const unknownEnv = verifyEnv();
  seedValidation(unknownEnv.store, subject);
  seedApproval(unknownEnv.store, subject);
  expectFailure(
    executeSlice1Command(verifyOperand(subject.subject, { capabilityRequirements: ['project-gateway.unknown-thing'] }), unknownEnv.context),
    'eligibility-denied',
  );

  // Known capability NOT in the current host ceiling → ceiling-denied.
  const ceilingEnv = verifyEnv();
  seedValidation(ceilingEnv.store, subject);
  seedApproval(ceilingEnv.store, subject);
  expectFailure(
    executeSlice1Command(verifyOperand(subject.subject, { capabilityRequirements: ['project-gateway.file-edit'] }), ceilingEnv.context),
    'ceiling-denied',
  );

  // Known capability permitted by the ceiling but unsupported by the consumer → eligibility-denied.
  const consumerEnv = verifyEnv();
  seedValidation(consumerEnv.store, subject);
  seedApproval(consumerEnv.store, subject);
  expectFailure(
    executeSlice1Command(verifyOperand(subject.subject, { capabilityRequirements: ['project-gateway.approval-operate'], consumerSupport: SUPPORT_NONE }), consumerEnv.context),
    'eligibility-denied',
  );

  // All supported → success (only ceiling-permitted capabilities requested).
  const okEnv = verifyEnv();
  seedValidation(okEnv.store, subject);
  seedApproval(okEnv.store, subject);
  const ok = executeSlice1Command(
    verifyOperand(subject.subject, { capabilityRequirements: ['project-gateway.approval-operate', 'project-gateway.lifecycle-issue'], consumerSupport: SUPPORT_ALL }),
    okEnv.context,
  );
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test('verify: failure precedence — state failures win over intersection failures; revoked approvals are historical, not blocking', () => {
  const subject = makeSubject('TaskSpec');
  // F before I/J: a revoked approval is approval-revoked even with an unknown requested capability.
  const revokedEnv = verifyEnv();
  seedValidation(revokedEnv.store, subject);
  seedApproval(revokedEnv.store, subject);
  seedRevocation(revokedEnv.store, 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  expectFailure(
    executeSlice1Command(verifyOperand(subject.subject, { capabilityRequirements: ['project-gateway.unknown-thing'] }), revokedEnv.context),
    'approval-revoked',
  );
  // E: two current approvals → lifecycle-conflict.
  const twoEnv = verifyEnv();
  seedValidation(twoEnv.store, subject);
  seedApproval(twoEnv.store, subject, { recordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  seedApproval(twoEnv.store, subject, { recordId: 'pgw:l:dddddddddddddddddddddddddddddddd' });
  expectFailure(executeSlice1Command(verifyOperand(subject.subject), twoEnv.context), 'lifecycle-conflict');
  // A revoked approval is historical: one revoked + one current → the current one verifies.
  const mixedEnv = verifyEnv();
  seedValidation(mixedEnv.store, subject);
  seedApproval(mixedEnv.store, subject, { recordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  seedApproval(mixedEnv.store, subject, { recordId: 'pgw:l:dddddddddddddddddddddddddddddddd' });
  seedRevocation(mixedEnv.store, 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const mixed = executeSlice1Command(verifyOperand(subject.subject), mixedEnv.context);
  assert.equal(mixed.ok, true, JSON.stringify(mixed));
  if (mixed.ok) assert.equal(mixed.evidence.recordId, 'pgw:l:dddddddddddddddddddddddddddddddd');
});

// ─── store failure / mutation discipline ────────────────────────────────────

test('verify: store failure is store-failure, bounded and redacted; no publication', () => {
  const { store, state } = makeFakeStore({ failReads: true });
  const integration = makeIntegrationEnv();
  const context = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(FIXED_NOW) });
  const subject = makeSubject('TaskSpec');
  const result = executeSlice1Command(verifyOperand(subject.subject), context);
  expectFailure(result, 'store-failure');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('ERR-STO'), false);
  assert.equal(serialized.includes('read-failed'), false);
  assert.equal(serialized.includes(integration.storeEnv.dir), false);
  assert.equal(state.publishCalls, 0);
});

test('verify: verification succeeds even while another operation holds the lifecycle key (no lock dependency)', () => {
  const { context, store } = verifyEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(store, subject);
  seedApproval(store, subject);
  const key = `${subject.subject.kindId}|${subject.subject.instanceId}|${subject.subject.revisionId}|${subject.subject.digest}|${subject.subject.workspaceId}`;
  const held = context.coordinate.withLock(key, () => executeSlice1Command(verifyOperand(subject.subject), context));
  assert.equal(held.ok, true, JSON.stringify(held));
});

// ─── stale evidence / replay / non-authorizing ──────────────────────────────

test('verify: success evidence is non-authorizing — mutating operations reject it; stale evidence never replays', () => {
  const { context, store } = verifyEnv({ revokerRole: true });
  const subject = makeSubject('TaskSpec');
  seedValidation(store, subject);
  seedApproval(store, subject);
  const first = executeSlice1Command(verifyOperand(subject.subject), context);
  assert.equal(first.ok, true, JSON.stringify(first));
  if (!first.ok) return;
  const oldEvidence = first.evidence;

  // No mutating operation accepts a verification result as an operand.
  for (const op of [
    { operation: 'approve', subject: subjectOperand(subject.subject), workspaceId: WS_A, purpose: 'execution-use', validationRecordIds: ['pgw:l:11111111111111111111111111111111'], verification: oldEvidence },
    { operation: 'issue', subject: subjectOperand(subject.subject), workspaceId: WS_A, useClass: 'execution-use', verification: oldEvidence },
    { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'ApprovalRecord', targetRecordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', scope: 'execution-use', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO, verification: oldEvidence },
  ]) {
    const result = executeSlice1Command(op, context);
    assert.equal(result.ok, false, `op ${op.operation} must reject verification evidence`);
    if (!result.ok) assert.equal(result.category, 'request-invalid');
  }

  // State changes invalidate the old result: revoke → fresh verify fails.
  const revoke = executeSlice1Command(
    { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'ApprovalRecord', targetRecordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', scope: 'execution-use', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
    context,
  );
  assert.equal(revoke.ok, true, JSON.stringify(revoke));
  const fresh = executeSlice1Command(verifyOperand(subject.subject), context);
  expectFailure(fresh, 'approval-revoked');
});

// ─── admitted non-linearizable race (§25) ───────────────────────────────────

test('verify: admitted race — a revoke published during the read window is not observed; verification completes with its observed state and mutates nothing; a later verify sees the revocation', () => {
  const { store, state } = makeFakeStore();
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(store, subject);
  seedApproval(store, subject);
  const identity = makeIdentitySource(FIXED_NOW);
  let injected = false;
  const racyStore: Env['store'] = {
    ...store,
    enumerateLifecycleRecords(recordClass) {
      // During verification's read window (after revocations were already
      // observed), a REAL concurrent revoke publishes for the same subject.
      if (recordClass === 'supersession-record' && !injected) {
        injected = true;
        const inner = executeSlice1Command(
          { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'ApprovalRecord', targetRecordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', scope: 'execution-use', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
          context,
        );
        assert.equal(inner.ok, true, JSON.stringify(inner));
      }
      return store.enumerateLifecycleRecords(recordClass);
    },
  };
  const context = makeContext(integration.storeEnv, { store: racyStore, identity, revokerRole: true });
  const result = executeSlice1Command(verifyOperand(subject.subject), context);
  // The verifier may complete using the state it observed (non-linearizable;
  // non-authorizing evidence — contract §25.17).
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(injected, true, 'the concurrent revoke must have run');
  assert.equal(state.byClass.get('revocation-record')?.length ?? 0, 1, 'the concurrent revoke published exactly one record; verification itself published nothing');
  const publishCount = state.publishCalls;
  assert.equal(publishCount, 3, 'exactly two seed publications + the one concurrent revoke; verification itself published nothing');
  // A later evaluation observes the authoritative current state.
  const fresh = executeSlice1Command(verifyOperand(subject.subject), context);
  expectFailure(fresh, 'approval-revoked');
});
