/**
 * WP-12 Slice 2A — revoke REAL WP-8 store integration tests.
 *
 * Required by SCR-W12-S2-004: real WP-8 store coverage for 2A. Proves
 * against initialized genuine WP-8 stores: actual ApprovalRecord /
 * IssuanceRecord targets, actual RevocationRecord publication with the
 * mechanical write-audit, byte-identical targets, exactly one record,
 * duplicate behavior, old-registry historical targets revoked into the
 * current registry context, out-of-workspace non-disclosure with zero
 * publication, store-failure mapping with redaction, no WP-12 lock
 * artifact, and revoke-vs-issue race semantics under the shared lifecycle
 * coordination key.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import { createControlPlaneStoreBoundary } from '../../src/control-plane/store-boundary.js';
import { createProcessLocalCoordinator } from '../../src/control-plane/coordination.js';
import { buildApprovalRecordPayload, buildIssuanceRecordPayload, payloadDigestOf } from '../../src/control-plane/records.js';
import { enumerateClass, inspectAuditHistory } from '../../src/storage/read/index.js';
import { defaultLimitProfile } from '../../src/storage/limits/limits.js';
import {
  cleanupTestEnvs,
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
} from './wp12-helpers.js';
import type { AcceptedRegistryContext } from '../../src/api/types.js';
import type { ControlPlaneTrustedContext } from '../../src/control-plane/types.js';
import type { RecordClassId } from '../../src/storage/types.js';

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

function makeContextWith(
  env: ReturnType<typeof makeIntegrationEnv>,
  overrides: {
    readonly identity?: ReturnType<typeof makeIdentitySource>;
    readonly registry?: AcceptedRegistryContext;
    readonly store?: ControlPlaneTrustedContext['store'];
    readonly coordinate?: ControlPlaneTrustedContext['coordinate'];
    readonly approverRole?: boolean;
    readonly issuerRole?: boolean;
    readonly revokerRole?: boolean;
    readonly subjectArtifact?: ControlPlaneTrustedContext['subjectArtifact'];
    readonly validationEvidence?: ControlPlaneTrustedContext['validationEvidence'];
  } = {},
): ControlPlaneTrustedContext {
  const identity = overrides.identity ?? makeIdentitySource();
  const registry = overrides.registry ?? REGISTRY;
  return {
    configuration: env.storeEnv.config,
    registry,
    operator: {
      approverRole: overrides.approverRole ?? true,
      issuerRole: overrides.issuerRole ?? true,
      revokerRole: overrides.revokerRole ?? true,
      operatorIdentity: 'test-operator',
    },
    store: overrides.store ?? makeStoreBoundary(env.storeEnv),
    coordinate: overrides.coordinate ?? createProcessLocalCoordinator(),
    identity,
    ...(overrides.subjectArtifact !== undefined ? { subjectArtifact: overrides.subjectArtifact } : {}),
    ...(overrides.validationEvidence !== undefined ? { validationEvidence: overrides.validationEvidence } : {}),
  };
}

function fullFlowInputs(subject: ReturnType<typeof makeSubject>) {
  return {
    recordValidation: { operation: 'recordValidation', subject: subjectOperand(subject.subject), workspaceId: WS_A },
    approve: { operation: 'approve', subject: subjectOperand(subject.subject), workspaceId: WS_A, purpose: 'execution-use', validationRecordIds: [] as string[] },
    issue: { operation: 'issue', subject: subjectOperand(subject.subject), workspaceId: WS_A, useClass: 'execution-use' },
  };
}

/** Seed a raw ApprovalRecord directly through WP-8 with an arbitrary registry context. */
function seedApproval(env: ReturnType<typeof makeIntegrationEnv>, subject = makeSubject('TaskSpec'), registry: AcceptedRegistryContext = REGISTRY, workspaceId = WS_A, recordId = 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'): void {
  const payload = buildApprovalRecordPayload({
    recordId,
    createdAt: '2026-08-04T04:00:00.000Z',
    subject: subject.subject,
    workspaceId,
    purpose: 'execution-use',
    validationRecordIds: [],
    requiredSemantics: { protocol_features: [], consumer_capabilities: [] },
    validUntil: null,
    registry,
  });
  seedRawRecord(env.storeEnv, 'approval-record', payload);
}

function seedIssuance(env: ReturnType<typeof makeIntegrationEnv>, subject = makeSubject('TaskSpec'), recordId = 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'): void {
  const payload = buildIssuanceRecordPayload({
    recordId,
    createdAt: '2026-08-04T04:30:00.000Z',
    subject: subject.subject,
    workspaceId: WS_A,
    useClass: 'execution-use',
    approvalRecordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    activationLimit: 1,
    validUntil: null,
    registry: REGISTRY,
  });
  seedRawRecord(env.storeEnv, 'issuance-record', payload);
}

function countClass(env: ReturnType<typeof makeIntegrationEnv>, recordClass: RecordClassId): number {
  const result = enumerateClass({
    trustedConfiguration: env.storeEnv.config,
    trustedInput: env.storeEnv.bootstrapInput,
    recordClass,
  });
  assert.equal(result.ok, true, `enumerate ${recordClass} failed`);
  return result.items.length;
}

function readTarget(env: ReturnType<typeof makeIntegrationEnv>, recordClass: string, recordId: string): Readonly<Record<string, unknown>> {
  const boundary = createControlPlaneStoreBoundary({
    trustedConfiguration: env.storeEnv.config,
    bootstrapInput: env.storeEnv.bootstrapInput,
    writeAction: {
      actionIdentity: WRITE_ACTION,
      locator: env.storeEnv.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: env.storeEnv.config.identity,
      limitProfile: defaultLimitProfile(),
    },
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

// A. ApprovalRecord revoke on a real store ───────────────────────────────────

test('real store: ApprovalRecord revoke publishes exactly one RevocationRecord with mechanical audit; target byte-identical', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedApproval(integration, subject);
  const before = readTarget(integration, 'approval-record', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const context = makeContextWith(integration, {});
  const result = executeSlice1Command(revokeOperand(), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;

  const revocations = countClass(integration, 'revocation-record');
  assert.equal(revocations, 1, 'exactly one RevocationRecord');
  const after = readTarget(integration, 'approval-record', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(payloadDigestOf(after), payloadDigestOf(before), 'target must remain byte-identical');
  const readBack = readTarget(integration, 'revocation-record', result.evidence.recordId);
  assert.equal(readBack['record_type'], 'RevocationRecord');
  assert.equal((readBack['target'] as Record<string, unknown>)['record_id'], 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(readBack['scope'], 'execution-use');
  assert.equal(readBack['effective_at'], '2026-08-04T05:59:00.000Z');
  assert.equal(readBack['reason_code'], 'policy-withdrawn');
  assert.equal(readBack['responsible_role'], 'trusted-revocation-authority');

  // Mechanical authorized-write audit exists for the revocation publication
  // (inspectAuditHistory reports the original authorized-write event).
  const history = inspectAuditHistory({
    trustedConfiguration: integration.storeEnv.config,
    trustedInput: integration.storeEnv.bootstrapInput,
    recordClass: 'revocation-record',
    recordId: result.evidence.recordId,
  });
  assert.equal(history.ok, true, JSON.stringify(history.findings));
  assert.equal(history.originalAuthorizedWrite?.present, true, 'mechanical authorized-write audit must exist for the RevocationRecord');

  // No residual WP-8 writer lock and no WP-12 lock artifact.
  const locksDir = join(integration.storeEnv.dir, 'store-v1', 'locks');
  if (existsSync(locksDir)) assert.deepEqual(readdirSync(locksDir), [], 'no lock file may remain');
  assert.deepEqual(readdirSync(integration.configEnv.workspaceRoot), []);
});

// B. IssuanceRecord revoke on a real store ───────────────────────────────────

test('real store: IssuanceRecord revoke publishes exactly one RevocationRecord; target byte-identical', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedApproval(integration, subject);
  seedIssuance(integration, subject);
  const before = readTarget(integration, 'issuance-record', 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  const context = makeContextWith(integration, {});
  const result = executeSlice1Command(
    revokeOperand({ targetRecordType: 'IssuanceRecord', targetRecordId: 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
    context,
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(countClass(integration, 'revocation-record'), 1);
  const after = readTarget(integration, 'issuance-record', 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(payloadDigestOf(after), payloadDigestOf(before), 'target must remain byte-identical');
  const readBack = readTarget(integration, 'revocation-record', result.evidence.recordId);
  assert.equal((readBack['target'] as Record<string, unknown>)['record_type'], 'IssuanceRecord');
});

// C. Duplicate revoke on a real store ────────────────────────────────────────

test('real store: duplicate revoke is lifecycle-conflict and leaves exactly one RevocationRecord', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedApproval(integration, subject);
  const context = makeContextWith(integration, {});
  const first = executeSlice1Command(revokeOperand(), context);
  assert.equal(first.ok, true, JSON.stringify(first));
  const second = executeSlice1Command(revokeOperand(), context);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.category, 'lifecycle-conflict');
  assert.equal(countClass(integration, 'revocation-record'), 1, 'still exactly one RevocationRecord');
});

// C2. Future-dated all-uses + effective execution-use on a real store ────────

test('real store: future-dated all-uses revocation does NOT block an effective execution-use revoke; two immutable records (CASE 6, SIR-W12-S2A-001)', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedApproval(integration, subject);
  // Seed a FUTURE-dated all-uses RevocationRecord directly through WP-8.
  seedRawRecord(integration.storeEnv, 'revocation-record', {
    record_type: 'RevocationRecord',
    record_id: 'pgw:l:dddddddddddddddddddddddddddddddd',
    created_at: '2026-08-04T06:00:00.000Z',
    responsible_role: 'trusted-revocation-authority',
    registry_snapshot_reference: {
      registry_protocol_id: REGISTRY.registryProtocolId,
      registry_snapshot_format_version: REGISTRY.registrySnapshotFormatVersion,
      registry_snapshot_id: REGISTRY.registrySnapshotId,
      registry_snapshot_digest: REGISTRY.registrySnapshotDigest,
      protocol_compatibility: { mode: 'exact-release', artifact_protocol_id: 'project-gateway.artifact', artifact_protocol_version: '1.0' },
    },
    target: { record_type: 'ApprovalRecord', record_id: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    scope: 'all-uses',
    effective_at: '2030-01-01T00:00:00.000Z',
    reason_code: 'policy-withdrawn',
  });
  const before = readTarget(integration, 'approval-record', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const context = makeContextWith(integration, {});
  const result = executeSlice1Command(revokeOperand(), context); // execution-use, effective now
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(countClass(integration, 'revocation-record'), 2, 'future all-uses preserved + new execution-use appended');
  const after = readTarget(integration, 'approval-record', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(payloadDigestOf(after), payloadDigestOf(before), 'target remains byte-identical; no overwrite');
  const readBack = readTarget(integration, 'revocation-record', result.evidence.recordId);
  assert.equal(readBack['scope'], 'execution-use');
  assert.equal(readBack['effective_at'], '2026-08-04T05:59:00.000Z');
  const ref = readBack['registry_snapshot_reference'] as Record<string, unknown>;
  assert.equal(ref['registry_snapshot_id'], REGISTRY.registrySnapshotId, 'new record binds the current registry');
  // The pre-existing future all-uses record is independently immutable.
  const pending = readTarget(integration, 'revocation-record', 'pgw:l:dddddddddddddddddddddddddddddddd');
  assert.equal((pending['target'] as Record<string, unknown>)['record_id'], 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(pending['scope'], 'all-uses');
  assert.equal(pending['effective_at'], '2030-01-01T00:00:00.000Z');
  // Mechanical authorized-write audit exists for the new publication.
  const history = inspectAuditHistory({
    trustedConfiguration: integration.storeEnv.config,
    trustedInput: integration.storeEnv.bootstrapInput,
    recordClass: 'revocation-record',
    recordId: result.evidence.recordId,
  });
  assert.equal(history.ok, true, JSON.stringify(history.findings));
  assert.equal(history.originalAuthorizedWrite?.present, true, 'mechanical audit for the new execution-use RevocationRecord');
  assert.deepEqual(readdirSync(integration.configEnv.workspaceRoot), [], 'no project-file mutation');
});

// D. Historical old-registry target on a real store ──────────────────────────

test('real store: historical old-registry ApprovalRecord MAY be revoked; new RevocationRecord binds the CURRENT registry', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const oldRegistry: AcceptedRegistryContext = {
    ...REGISTRY,
    registrySnapshotId: 'pgw:g:11111111111111111111111111111111',
    registrySnapshotDigest: `sha-256:${'1'.repeat(64)}`,
  };
  seedApproval(integration, subject, oldRegistry);
  const before = readTarget(integration, 'approval-record', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const oldRef = (before['registry_snapshot_reference'] as Record<string, unknown>);
  assert.notEqual(oldRef['registry_snapshot_id'], REGISTRY.registrySnapshotId, 'target must carry an older registry snapshot');

  const context = makeContextWith(integration, {});
  const result = executeSlice1Command(revokeOperand(), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const after = readTarget(integration, 'approval-record', 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(payloadDigestOf(after), payloadDigestOf(before), 'old-registry target remains byte-identical');
  const revocation = readTarget(integration, 'revocation-record', result.evidence.recordId);
  const ref = revocation['registry_snapshot_reference'] as Record<string, unknown>;
  assert.equal(ref['registry_snapshot_id'], REGISTRY.registrySnapshotId, 'new RevocationRecord binds the CURRENT registry');
  assert.equal(ref['registry_snapshot_digest'], REGISTRY.registrySnapshotDigest);

  // Wrong request echo → registry-context-mismatch (C3), no publication.
  const wrongEchoEnv = makeIntegrationEnv();
  seedApproval(wrongEchoEnv, subject, oldRegistry);
  const wrongContext = makeContextWith(wrongEchoEnv, {});
  const mismatch = executeSlice1Command(
    revokeOperand({ registryEcho: { registry_snapshot_id: REGISTRY.registrySnapshotId, registry_snapshot_digest: `sha-256:${'0'.repeat(64)}` } }),
    wrongContext,
  );
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.category, 'registry-context-mismatch');
  assert.equal(countClass(wrongEchoEnv, 'revocation-record'), 0, 'no publication on echo mismatch');
});

// E. Out-of-workspace target on a real store ─────────────────────────────────

test('real store: out-of-workspace target is lifecycle-state-missing with zero publication and no existence disclosure', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedApproval(integration, subject, REGISTRY, 'pgw:w:99999999999999999999999999999999');
  const context = makeContextWith(integration, {});
  const outOfScope = executeSlice1Command(revokeOperand(), context);
  assert.equal(outOfScope.ok, false);
  if (!outOfScope.ok) assert.equal(outOfScope.category, 'lifecycle-state-missing');
  const missing = executeSlice1Command(revokeOperand({ targetRecordId: 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }), context);
  assert.equal(missing.ok, false);
  if (!missing.ok && !outOfScope.ok) {
    assert.equal(missing.category, outOfScope.category, 'no existence disclosure: identical category');
    assert.equal(missing.message, outOfScope.message);
  }
  assert.equal(countClass(integration, 'revocation-record'), 0, 'zero publication');
  const serialized = JSON.stringify(outOfScope);
  assert.equal(serialized.includes('9999'), false, 'out-of-workspace identity must not leak');
});

// F. Store failure / malformed authoritative state on a real store ──────────

test('real store: genuine read malfunction is store-failure, bounded and redacted', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  seedApproval(integration, subject);
  const brokenBoundary = createControlPlaneStoreBoundary({
    trustedConfiguration: integration.storeEnv.config,
    bootstrapInput: { forged: true, notGenuine: true },
    writeAction: {
      actionIdentity: WRITE_ACTION,
      locator: integration.storeEnv.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: integration.storeEnv.config.identity,
      limitProfile: defaultLimitProfile(),
    },
    locator: integration.storeEnv.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  const context = makeContextWith(integration, { store: brokenBoundary });
  const result = executeSlice1Command(revokeOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'store-failure', 'a broken read must be store-failure, never semantic absence');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('ERR-STO'), false);
  assert.equal(serialized.includes('forged'), false);
  assert.equal(serialized.includes(integration.storeEnv.dir), false, 'store path must not leak');
  assert.equal(countClass(integration, 'revocation-record'), 0);
});

// G. revoke vs issue race semantics on a real store ──────────────────────────

test('real store: issue completes first → revoke re-reads and succeeds; revoke completes first → issue is approval-revoked; true overlap → lock-conflict', () => {
  // ISSUE COMPLETES FIRST: full flow, then revoke the approval afterward.
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const evidence = makeEvidence('TaskSpec');
  const identity = makeIdentitySource();
  const context = makeContextWith(integration, { validationEvidence: evidence, identity });
  const inputs = fullFlowInputs(subject);
  const validation = executeSlice1Command(inputs.recordValidation, context);
  assert.equal(validation.ok, true, JSON.stringify(validation));
  if (!validation.ok) return;
  const approveContext = makeContextWith(integration, { subjectArtifact: evidence.artifact, identity });
  const approval = executeSlice1Command({ ...inputs.approve, validationRecordIds: [validation.evidence.recordId] }, approveContext);
  assert.equal(approval.ok, true, JSON.stringify(approval));
  if (!approval.ok) return;
  const issueContext = makeContextWith(integration, { subjectArtifact: evidence.artifact, identity, revokerRole: true });
  const issuance = executeSlice1Command(inputs.issue, issueContext);
  assert.equal(issuance.ok, true, JSON.stringify(issuance));
  const revoke = executeSlice1Command(
    revokeOperand({ targetRecordId: approval.evidence.recordId, effectiveAt: '2026-08-04T07:00:00.000Z' }),
    issueContext,
  );
  assert.equal(revoke.ok, true, 'issue completed first; revoke re-reads current state and may revoke afterward');

  // REVOKE COMPLETES FIRST: revoke the approval, then a NEW issuance attempt fails.
  const integration2 = makeIntegrationEnv();
  const subject2 = makeSubject('TaskSpec');
  const evidence2 = makeEvidence('TaskSpec');
  const identity2 = makeIdentitySource();
  const context2 = makeContextWith(integration2, { validationEvidence: evidence2, identity: identity2 });
  const inputs2 = fullFlowInputs(subject2);
  const validation2 = executeSlice1Command(inputs2.recordValidation, context2);
  assert.equal(validation2.ok, true);
  if (!validation2.ok) return;
  const approveContext2 = makeContextWith(integration2, { subjectArtifact: evidence2.artifact, identity: identity2 });
  const approval2 = executeSlice1Command({ ...inputs2.approve, validationRecordIds: [validation2.evidence.recordId] }, approveContext2);
  assert.equal(approval2.ok, true);
  if (!approval2.ok) return;
  const issueContext2 = makeContextWith(integration2, { subjectArtifact: evidence2.artifact, identity: identity2, revokerRole: true });
  const revoke2 = executeSlice1Command(revokeOperand({ targetRecordId: approval2.evidence.recordId }), issueContext2);
  assert.equal(revoke2.ok, true, JSON.stringify(revoke2));
  const deniedIssue = executeSlice1Command(inputs2.issue, issueContext2);
  assert.equal(deniedIssue.ok, false);
  if (!deniedIssue.ok) assert.equal(deniedIssue.category, 'approval-revoked', 'later issue sees the effective revocation');

  // TRUE OVERLAP: holding the lifecycle key manually → both operations fail fast.
  const integration3 = makeIntegrationEnv();
  const subject3 = makeSubject('TaskSpec');
  const evidence3 = makeEvidence('TaskSpec');
  const identity3 = makeIdentitySource();
  const context3 = makeContextWith(integration3, { validationEvidence: evidence3, identity: identity3 });
  const inputs3 = fullFlowInputs(subject3);
  const validation3 = executeSlice1Command(inputs3.recordValidation, context3);
  assert.equal(validation3.ok, true);
  if (!validation3.ok) return;
  const approveContext3 = makeContextWith(integration3, { subjectArtifact: evidence3.artifact, identity: identity3 });
  const approval3 = executeSlice1Command({ ...inputs3.approve, validationRecordIds: [validation3.evidence.recordId] }, approveContext3);
  assert.equal(approval3.ok, true);
  if (!approval3.ok) return;
  const issueContext3 = makeContextWith(integration3, { subjectArtifact: evidence3.artifact, identity: identity3, revokerRole: true });
  const key = `${subject3.subject.kindId}|${subject3.subject.instanceId}|${subject3.subject.revisionId}|${subject3.subject.digest}|${subject3.subject.workspaceId}`;
  const held = issueContext3.coordinate.withLock(key, () => ({
    issue: executeSlice1Command(inputs3.issue, issueContext3),
    revoke: executeSlice1Command(revokeOperand({ targetRecordId: approval3.evidence.recordId }), issueContext3),
  }));
  assert.equal(held.issue.ok, false);
  if (!held.issue.ok) assert.equal(held.issue.category, 'lock-conflict');
  assert.equal(held.revoke.ok, false);
  if (!held.revoke.ok) assert.equal(held.revoke.category, 'lock-conflict');
});
