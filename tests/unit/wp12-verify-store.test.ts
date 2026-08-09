/**
 * WP-12 Slice 2B — verifyCurrentLifecycleState REAL WP-8 store integration
 * tests.
 *
 * Required by SCR-W12-S2-004: real WP-8 store coverage for 2B. Proves
 * against initialized genuine WP-8 stores: current approval/issuance
 * success; actual 2A revoke consumption (approval-revoked /
 * issuance-not-authorized); future-dated revocation not yet effective;
 * expiry boundaries; multiple-current conflicts; current-registry
 * mismatch; zero publication; zero new audit event; store-failure
 * redaction; ceiling narrowing with genuine host configuration.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import { createControlPlaneStoreBoundary } from '../../src/control-plane/store-boundary.js';
import { createProcessLocalCoordinator } from '../../src/control-plane/coordination.js';
import { buildApprovalRecordPayload, buildIssuanceRecordPayload, buildRevocationRecordPayload, buildValidationRecordPayload, payloadDigestOf } from '../../src/control-plane/records.js';
import { enumerateClass, inspectAuditHistory } from '../../src/storage/read/index.js';
import { defaultLimitProfile } from '../../src/storage/limits/limits.js';
import {
  cleanupTestEnvs,
  makeConfigEnv,
  makeEvidence,
  makeIdentitySource,
  makeIntegrationEnv,
  makeRegistryContext,
  makeStoreBoundary,
  makeSubject,
  seedRawRecord,
  UID,
  WRITE_ACTION,
  WS_A,
  FIXED_NOW,
} from './wp12-helpers.js';
import type { AcceptedRegistryContext } from '../../src/api/types.js';
import type { ControlPlaneTrustedContext } from '../../src/control-plane/types.js';
import type { PublishRecordResult, RecordClassId } from '../../src/storage/types.js';

after(() => cleanupTestEnvs());

const REGISTRY = makeRegistryContext();
const ECHO = Object.freeze({ registry_snapshot_id: REGISTRY.registrySnapshotId, registry_snapshot_digest: REGISTRY.registrySnapshotDigest });
const OLD_REGISTRY: AcceptedRegistryContext = {
  ...REGISTRY,
  registrySnapshotId: 'pgw:g:11111111111111111111111111111111',
  registrySnapshotDigest: `sha-256:${'1'.repeat(64)}`,
};

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

const SUPPORT_ALL = Object.freeze({
  consumerId: 'test-consumer',
  supportedProtocolFeatures: ['project-gateway.protocol-v1'],
  supportedConsumerCapabilities: ['project-gateway.approval-operate', 'project-gateway.lifecycle-issue', 'project-gateway.file-edit'],
  supportedExtensionNamespaces: [],
});

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

function revokeOperand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation: 'revoke',
    workspaceId: WS_A,
    targetRecordType: 'ApprovalRecord',
    targetRecordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    scope: 'execution-use',
    effectiveAt: FIXED_NOW,
    reasonCode: 'policy-withdrawn',
    registryEcho: ECHO,
    ...overrides,
  };
}

function makeContextWith(
  env: ReturnType<typeof makeIntegrationEnv>,
  overrides: {
    readonly identity?: ReturnType<typeof makeIdentitySource>;
    readonly registry?: AcceptedRegistryContext;
    readonly store?: ControlPlaneTrustedContext['store'];
    readonly coordinate?: ControlPlaneTrustedContext['coordinate'];
    readonly configuration?: ControlPlaneTrustedContext['configuration'];
  } = {},
): ControlPlaneTrustedContext {
  const identity = overrides.identity ?? makeIdentitySource();
  return {
    configuration: overrides.configuration ?? env.storeEnv.config,
    registry: overrides.registry ?? REGISTRY,
    operator: { approverRole: true, issuerRole: true, revokerRole: true, operatorIdentity: 'test-operator' },
    store: overrides.store ?? makeStoreBoundary(env.storeEnv),
    coordinate: overrides.coordinate ?? createProcessLocalCoordinator(),
    identity,
  };
}

function seedValidation(env: ReturnType<typeof makeIntegrationEnv>, subject = makeSubject('TaskSpec'), recordId = 'pgw:l:11111111111111111111111111111111'): string {
  const payload = buildValidationRecordPayload({ recordId, createdAt: FIXED_NOW, subject: subject.subject, registry: REGISTRY });
  seedRawRecord(env.storeEnv, 'validation-record', payload);
  return recordId;
}

function seedApproval(env: ReturnType<typeof makeIntegrationEnv>, subject = makeSubject('TaskSpec'), opts: { recordId?: string; validUntil?: string | null; registry?: AcceptedRegistryContext } = {}): string {
  const payload = buildApprovalRecordPayload({
    recordId: opts.recordId ?? 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    createdAt: FIXED_NOW,
    subject: subject.subject,
    workspaceId: WS_A,
    purpose: 'execution-use',
    validationRecordIds: ['pgw:l:11111111111111111111111111111111'],
    requiredSemantics: { protocol_features: [], consumer_capabilities: [] },
    validUntil: opts.validUntil === undefined ? null : opts.validUntil,
    registry: opts.registry ?? REGISTRY,
  });
  seedRawRecord(env.storeEnv, 'approval-record', payload);
  return opts.recordId ?? 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
}

function seedIssuance(env: ReturnType<typeof makeIntegrationEnv>, subject = makeSubject('TaskSpec'), opts: { recordId?: string; validUntil?: string | null; approvalRecordId?: string } = {}): string {
  const payload = buildIssuanceRecordPayload({
    recordId: opts.recordId ?? 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    createdAt: FIXED_NOW,
    subject: subject.subject,
    workspaceId: WS_A,
    useClass: 'execution-use',
    approvalRecordId: opts.approvalRecordId ?? 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    activationLimit: 1,
    validUntil: opts.validUntil === undefined ? null : opts.validUntil,
    registry: REGISTRY,
  });
  seedRawRecord(env.storeEnv, 'issuance-record', payload);
  return opts.recordId ?? 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
}

function seedRevocation(env: ReturnType<typeof makeIntegrationEnv>, opts: { recordId?: string; targetRecordType?: 'ApprovalRecord' | 'IssuanceRecord'; targetRecordId?: string; scope?: 'all-uses' | 'execution-use'; effectiveAt?: string; registry?: AcceptedRegistryContext } = {}): string {
  const recordId = opts.recordId ?? 'pgw:l:dddddddddddddddddddddddddddddddd';
  const payload = buildRevocationRecordPayload({
    recordId,
    createdAt: FIXED_NOW,
    targetRecordType: opts.targetRecordType ?? 'ApprovalRecord',
    targetRecordId: opts.targetRecordId ?? 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    scope: opts.scope ?? 'execution-use',
    effectiveAt: opts.effectiveAt ?? FIXED_NOW,
    reasonCode: 'policy-withdrawn',
    registry: opts.registry ?? REGISTRY,
  });
  seedRawRecord(env.storeEnv, 'revocation-record', payload);
  return recordId;
}

function countClass(env: ReturnType<typeof makeIntegrationEnv>, recordClass: RecordClassId): number {
  const result = enumerateClass({ trustedConfiguration: env.storeEnv.config, trustedInput: env.storeEnv.bootstrapInput, recordClass });
  assert.equal(result.ok, true, `enumerate ${recordClass} failed`);
  return result.items.length;
}

function readBack(env: ReturnType<typeof makeIntegrationEnv>, recordClass: string, recordId: string): Readonly<Record<string, unknown>> {
  const boundary = createControlPlaneStoreBoundary({
    trustedConfiguration: env.storeEnv.config,
    bootstrapInput: env.storeEnv.bootstrapInput,
    writeAction: { actionIdentity: WRITE_ACTION, locator: env.storeEnv.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: env.storeEnv.config.identity, limitProfile: defaultLimitProfile() },
    locator: env.storeEnv.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  const read = boundary.readLifecyclePayload(recordClass as never, recordId);
  assert.equal(read.ok, true, `read ${recordClass}/${recordId} failed`);
  assert.ok(read.payload !== undefined);
  return read.payload;
}

function auditFindings(env: ReturnType<typeof makeIntegrationEnv>, recordClass: RecordClassId, recordId: string): readonly unknown[] {
  const history = inspectAuditHistory({ trustedConfiguration: env.storeEnv.config, trustedInput: env.storeEnv.bootstrapInput, recordClass, recordId });
  assert.equal(history.ok, true, JSON.stringify(history.findings));
  return history.findings;
}

function expectFailure(result: ReturnType<typeof executeSlice1Command>, category: string): void {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.equal(result.category, category);
}

// A. Current approval success on a real store ────────────────────────────────

test('real store: current approval verifies; zero publication; zero audit side effect; no lock artifact; no coordinator use', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(integration, subject);
  seedApproval(integration, subject);
  const before = readBack(integration, 'approval-record', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const beforeFindings = auditFindings(integration, 'approval-record', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const beforeCounts = (['validation-record', 'approval-record', 'issuance-record', 'revocation-record', 'supersession-record'] as RecordClassId[]).map((c) => countClass(integration, c));

  let publishCalls = 0;
  let lockCalls = 0;
  const innerBoundary = makeStoreBoundary(integration.storeEnv);
  const countingBoundary: ControlPlaneTrustedContext['store'] = {
    ...innerBoundary,
    publishLifecycleRecord(recordClass: RecordClassId, payload: Readonly<Record<string, unknown>>): PublishRecordResult {
      publishCalls += 1;
      return innerBoundary.publishLifecycleRecord(recordClass, payload);
    },
  };
  const context = makeContextWith(integration, {
    store: countingBoundary,
    coordinate: {
      withLock<T>(key: string, fn: () => T): T {
        lockCalls += 1;
        return createProcessLocalCoordinator().withLock(key, fn);
      },
    },
  });
  const result = executeSlice1Command(verifyOperand(subject.subject), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.evidence.recordClass, 'approval-record');
  assert.equal(result.evidence.recordId, 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(result.evidence.registrySnapshotId, REGISTRY.registrySnapshotId);
  assert.equal(result.evidence.verifiedAt, FIXED_NOW);
  assert.equal(publishCalls, 0, 'verification publishes nothing');
  assert.equal(lockCalls, 0, 'verification acquires no coordination lock');
  const after = readBack(integration, 'approval-record', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(payloadDigestOf(after), payloadDigestOf(before), 'target byte-identical');
  const afterFindings = auditFindings(integration, 'approval-record', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.deepEqual(afterFindings, beforeFindings, 'verification adds no audit event');
  const afterCounts = (['validation-record', 'approval-record', 'issuance-record', 'revocation-record', 'supersession-record'] as RecordClassId[]).map((c) => countClass(integration, c));
  assert.deepEqual(afterCounts, beforeCounts, 'no lifecycle record appears or disappears');
  const locksDir = join(integration.storeEnv.dir, 'store-v1', 'locks');
  if (existsSync(locksDir)) assert.deepEqual(readdirSync(locksDir), [], 'no lock artifact');
  assert.deepEqual(readdirSync(integration.configEnv.workspaceRoot), [], 'no project-file mutation');
});

// B. Current issuance success on a real store ────────────────────────────────

test('real store: current issuance with current referenced approval verifies', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(integration, subject);
  seedApproval(integration, subject);
  seedIssuance(integration, subject);
  const context = makeContextWith(integration, {});
  const result = executeSlice1Command(verifyOperand(subject.subject, {}, 'issuance'), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.evidence.recordClass, 'issuance-record');
  assert.equal(result.evidence.recordId, 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(result.evidence.approvalRecordId, 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(result.evidence.issuanceRecordId, 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
});

// C. Actual 2A revoke of an approval → approval-revoked ──────────────────────

test('real store: actual 2A revoke makes approval-form verification approval-revoked', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(integration, subject);
  seedApproval(integration, subject);
  const context = makeContextWith(integration, {});
  const revoke = executeSlice1Command(revokeOperand(), context);
  assert.equal(revoke.ok, true, JSON.stringify(revoke));
  assert.equal(countClass(integration, 'revocation-record'), 1);
  const verify = executeSlice1Command(verifyOperand(subject.subject), context);
  expectFailure(verify, 'approval-revoked');
});

// D. Actual 2A revoke of an issuance → issuance-not-authorized ───────────────

test('real store: actual 2A revoke makes issuance-form verification issuance-not-authorized', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(integration, subject);
  seedApproval(integration, subject);
  seedIssuance(integration, subject);
  const context = makeContextWith(integration, {});
  const revoke = executeSlice1Command(
    revokeOperand({ targetRecordType: 'IssuanceRecord', targetRecordId: 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
    context,
  );
  assert.equal(revoke.ok, true, JSON.stringify(revoke));
  const verify = executeSlice1Command(verifyOperand(subject.subject, {}, 'issuance'), context);
  expectFailure(verify, 'issuance-not-authorized');
  // The referenced approval itself remains verifiable.
  const approvalVerify = executeSlice1Command(verifyOperand(subject.subject), context);
  assert.equal(approvalVerify.ok, true, JSON.stringify(approvalVerify));
});

// E. Future-dated revocation not yet effective ───────────────────────────────

test('real store: future-dated revocation does not invalidate current verification; equality effectiveAt == trustedNow does', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(integration, subject);
  seedApproval(integration, subject);
  seedRevocation(integration, { effectiveAt: '2030-01-01T00:00:00.000Z', scope: 'all-uses' });
  const context = makeContextWith(integration, {});
  const before = executeSlice1Command(verifyOperand(subject.subject), context);
  assert.equal(before.ok, true, JSON.stringify(before));
  // Equality boundary: effectiveAt == trustedNow → effective.
  const equalityEnv = makeIntegrationEnv();
  seedValidation(equalityEnv, subject);
  seedApproval(equalityEnv, subject);
  seedRevocation(equalityEnv, { effectiveAt: FIXED_NOW });
  const equalityContext = makeContextWith(equalityEnv, {});
  const equality = executeSlice1Command(verifyOperand(subject.subject), equalityContext);
  expectFailure(equality, 'approval-revoked');
});

// F/G. Expiry boundaries ─────────────────────────────────────────────────────

test('real store: expired approval is lifecycle-state-missing; expired issuance is issuance-not-authorized', () => {
  const subject = makeSubject('TaskSpec');
  const expiredApprovalEnv = makeIntegrationEnv();
  seedValidation(expiredApprovalEnv, subject);
  seedApproval(expiredApprovalEnv, subject, { validUntil: '2026-08-04T05:00:00.000Z' });
  expectFailure(executeSlice1Command(verifyOperand(subject.subject), makeContextWith(expiredApprovalEnv, {})), 'lifecycle-state-missing');

  const equalityEnv = makeIntegrationEnv();
  seedValidation(equalityEnv, subject);
  seedApproval(equalityEnv, subject, { validUntil: FIXED_NOW });
  expectFailure(executeSlice1Command(verifyOperand(subject.subject), makeContextWith(equalityEnv, {})), 'lifecycle-state-missing');

  const expiredIssuanceEnv = makeIntegrationEnv();
  seedValidation(expiredIssuanceEnv, subject);
  seedApproval(expiredIssuanceEnv, subject);
  seedIssuance(expiredIssuanceEnv, subject, { validUntil: '2026-08-04T05:00:00.000Z' });
  expectFailure(executeSlice1Command(verifyOperand(subject.subject, {}, 'issuance'), makeContextWith(expiredIssuanceEnv, {})), 'issuance-not-authorized');
});

// H/I. Multiple-current conflicts ────────────────────────────────────────────

test('real store: multiple current matching approvals are lifecycle-conflict; multiple current issuances are lifecycle-conflict', () => {
  const subject = makeSubject('TaskSpec');
  const approvalsEnv = makeIntegrationEnv();
  seedValidation(approvalsEnv, subject);
  seedApproval(approvalsEnv, subject, { recordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  seedApproval(approvalsEnv, subject, { recordId: 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' });
  const approvalsVerify = executeSlice1Command(verifyOperand(subject.subject), makeContextWith(approvalsEnv, {}));
  expectFailure(approvalsVerify, 'lifecycle-conflict');

  const issuancesEnv = makeIntegrationEnv();
  seedValidation(issuancesEnv, subject);
  seedApproval(issuancesEnv, subject);
  seedIssuance(issuancesEnv, subject, { recordId: 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
  seedIssuance(issuancesEnv, subject, { recordId: 'pgw:l:ffffffffffffffffffffffffffffffff' });
  const issuancesVerify = executeSlice1Command(verifyOperand(subject.subject, {}, 'issuance'), makeContextWith(issuancesEnv, {}));
  expectFailure(issuancesVerify, 'lifecycle-conflict');
});

// J. Registry currentness ────────────────────────────────────────────────────

test('real store: old-registry approval does not verify as current (registry-context-mismatch); relevant future revocation under an old registry also mismatches', () => {
  const subject = makeSubject('TaskSpec');
  const oldApprovalEnv = makeIntegrationEnv();
  seedValidation(oldApprovalEnv, subject);
  seedApproval(oldApprovalEnv, subject, { registry: OLD_REGISTRY });
  const oldApprovalVerify = executeSlice1Command(verifyOperand(subject.subject), makeContextWith(oldApprovalEnv, {}));
  expectFailure(oldApprovalVerify, 'registry-context-mismatch');

  // Current-registry approval + a RELEVANT (future-dated, applicable-scope)
  // revocation under an old registry → registry-context-mismatch
  // (contract §17: relevant RevocationRecord state must satisfy the
  // accepted CURRENT registry rules).
  const oldRevocationEnv = makeIntegrationEnv();
  seedValidation(oldRevocationEnv, subject);
  seedApproval(oldRevocationEnv, subject);
  seedRevocation(oldRevocationEnv, { effectiveAt: '2030-01-01T00:00:00.000Z', registry: OLD_REGISTRY });
  const oldRevocationVerify = executeSlice1Command(verifyOperand(subject.subject), makeContextWith(oldRevocationEnv, {}));
  expectFailure(oldRevocationVerify, 'registry-context-mismatch');

  // The same future-dated revocation under the CURRENT registry stays current.
  const okEnv = makeIntegrationEnv();
  seedValidation(okEnv, subject);
  seedApproval(okEnv, subject);
  seedRevocation(okEnv, { effectiveAt: '2030-01-01T00:00:00.000Z' });
  const okVerify = executeSlice1Command(verifyOperand(subject.subject), makeContextWith(okEnv, {}));
  assert.equal(okVerify.ok, true, JSON.stringify(okVerify));
});

// M. Store failure / redaction ───────────────────────────────────────────────

test('real store: genuine read malfunction is store-failure, bounded and redacted; zero publication', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedValidation(integration, subject);
  seedApproval(integration, subject);
  const brokenBoundary = createControlPlaneStoreBoundary({
    trustedConfiguration: integration.storeEnv.config,
    bootstrapInput: { forged: true, notGenuine: true },
    writeAction: { actionIdentity: WRITE_ACTION, locator: integration.storeEnv.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: integration.storeEnv.config.identity, limitProfile: defaultLimitProfile() },
    locator: integration.storeEnv.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  const context = makeContextWith(integration, { store: brokenBoundary });
  const result = executeSlice1Command(verifyOperand(subject.subject), context);
  expectFailure(result, 'store-failure');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('ERR-STO'), false);
  assert.equal(serialized.includes('forged'), false);
  assert.equal(serialized.includes(integration.storeEnv.dir), false);
  assert.equal(countClass(integration, 'revocation-record'), 0, 'no publication');
});

// N. Current ceiling narrowing ───────────────────────────────────────────────

test('real store: ceiling narrowing after historical approval — verification re-evaluates CURRENT ceilings and fails ceiling-denied', () => {
  const subject = makeSubject('TaskSpec');
  // Approval created under a permissive ceiling (file-edit permitted).
  const permissive = makeIntegrationEnv({ globalCapabilities: ['project-gateway.approval-operate', 'project-gateway.lifecycle-issue', 'project-gateway.file-edit'] });
  seedValidation(permissive, subject);
  seedApproval(permissive, subject);
  // Current host configuration is NARROWER (file-edit no longer permitted).
  const narrowed = makeConfigEnv({ globalCapabilities: ['project-gateway.approval-operate', 'project-gateway.lifecycle-issue'] });
  const context = makeContextWith(permissive, { configuration: narrowed.config });
  const denied = executeSlice1Command(
    verifyOperand(subject.subject, { capabilityRequirements: ['project-gateway.file-edit'], consumerSupport: SUPPORT_ALL }),
    context,
  );
  expectFailure(denied, 'ceiling-denied');
  // No capability requirement → the historical approval still verifies current.
  const ok = executeSlice1Command(verifyOperand(subject.subject), context);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  // Historical records are never mutated by the configuration change.
  const after = readBack(permissive, 'approval-record', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(after['registry_snapshot_reference'] !== undefined, true);
  assert.equal(countClass(permissive, 'approval-record'), 1);
});
