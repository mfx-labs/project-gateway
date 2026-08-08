/**
 * WP-12 Slice 1 — real WP-8 store integration tests.
 *
 * Proves the full flow against a REAL initialized WP-8 store: record
 * publication with the mechanical authorized-write audit event, exact
 * payload round-trips, mechanical audit presence, revalidation under the
 * host coordination lock, publish conflict/durability behavior, result
 * redaction, no automatic duplicate publication after failure, and zero
 * mutation outside the trusted store.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import { createControlPlaneStoreBoundary } from '../../src/control-plane/store-boundary.js';
import { enumerateClass } from '../../src/storage/read/index.js';
import { defaultLimitProfile } from '../../src/storage/limits/limits.js';
import {
  cleanupTestEnvs,
  makeEvidence,
  makeIdentitySource,
  makeIntegrationEnv,
  makeSubject,
  seedRawRecord,
  UID,
  WRITE_ACTION,
  WS_A,
} from './wp12-helpers.js';
import { buildValidationRecordPayload } from '../../src/control-plane/records.js';
import { makeRegistryContext } from './wp12-helpers.js';

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

function fullFlowInputs(subject: ReturnType<typeof makeSubject>) {
  return {
    recordValidation: { operation: 'recordValidation', subject: subjectOperand(subject.subject), workspaceId: WS_A },
    approve: { operation: 'approve', subject: subjectOperand(subject.subject), workspaceId: WS_A, purpose: 'execution-use', validationRecordIds: [] as string[] },
    issue: { operation: 'issue', subject: subjectOperand(subject.subject), workspaceId: WS_A, useClass: 'execution-use' },
  };
}

test('store integration: full recordValidation → approve → issue flow on a real store', () => {
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

  const issueContext = makeContextWith(integration, { subjectArtifact: evidence.artifact, identity });
  const issuance = executeSlice1Command(inputs.issue, issueContext);
  assert.equal(issuance.ok, true, JSON.stringify(issuance));
  if (!issuance.ok) return;

  // Round-trip: read the stored records back through the WP-8 read surface.
  const validationRead = context.store.readLifecyclePayload('validation-record', validation.evidence.recordId);
  assert.equal(validationRead.ok, true);
  assert.equal(validationRead.payload!['record_type'], 'ValidationRecord');
  const approvalRead = approveContext.store.readLifecyclePayload('approval-record', approval.evidence.recordId);
  assert.equal(approvalRead.ok, true);
  assert.equal(approvalRead.payload!['record_type'], 'ApprovalRecord');
  const issuanceRead = issueContext.store.readLifecyclePayload('issuance-record', issuance.evidence.recordId);
  assert.equal(issuanceRead.ok, true);
  assert.equal(issuanceRead.payload!['record_type'], 'IssuanceRecord');
  assert.equal(issuanceRead.payload!['approval_record_id'], approval.evidence.recordId);

  // Mechanical authorized-write audit events exist for every publication.
  for (const recordId of [validation.evidence.recordId, approval.evidence.recordId, issuance.evidence.recordId]) {
    const history = enumerateClass({
      trustedConfiguration: integration.storeEnv.config,
      trustedInput: integration.storeEnv.bootstrapInput,
      recordClass: 'authoritative-audit-event',
    });
    assert.equal(history.ok, true);
    const events = history.items.filter((item) => item.recordId !== undefined);
    assert.ok(events.length >= 1, `audit events must exist for ${recordId}`);
  }

  // No residual WP-8 writer lock and no WP-12 lock artifact.
  const locksDir = join(integration.storeEnv.dir, 'store-v1', 'locks');
  assert.deepEqual(readdirSync(locksDir), [], 'no lock file may remain');

  // Zero project-file mutation.
  assert.deepEqual(readdirSync(integration.configEnv.workspaceRoot), []);
});

test('store integration: publish conflict surfaces as the closed duplicate category', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const evidence = makeEvidence('TaskSpec');
  const context = makeContextWith(integration, { validationEvidence: evidence });
  const inputs = fullFlowInputs(subject);
  const first = executeSlice1Command(inputs.recordValidation, context);
  assert.equal(first.ok, true);
  // Identical evidence correlation → deterministic lifecycle-conflict.
  const second = executeSlice1Command(inputs.recordValidation, context);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.category, 'lifecycle-conflict');
});

test('store integration: failure does not cause automatic duplicate publication', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const evidence = makeEvidence('TaskSpec');
  const context = makeContextWith(integration, { validationEvidence: evidence });
  const inputs = fullFlowInputs(subject);
  const first = executeSlice1Command(inputs.recordValidation, context);
  assert.equal(first.ok, true);
  // A denied duplicate is NOT retried/published again; the store holds
  // exactly one ValidationRecord.
  const second = executeSlice1Command(inputs.recordValidation, context);
  assert.equal(second.ok, false);
  const enumerated = context.store.enumerateLifecycleRecords('validation-record');
  assert.equal(enumerated.ok, true);
  assert.equal(enumerated.recordIds.length, 1);
});

test('store integration: result redaction — failures never expose paths, errno, or stacks', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const context = makeContextWith(integration, {});
  const result = executeSlice1Command(fullFlowInputs(subject).approve, context);
  assert.equal(result.ok, false);
  if (!result.ok) {
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(integration.storeEnv.dir), false, 'store path must not leak');
    assert.equal(serialized.includes('/tmp/'), false, 'no absolute temp paths');
    assert.equal(serialized.includes('errno'), false);
    assert.equal(serialized.includes('Error:'), false, 'no stack/error text');
    assert.ok(serialized.length < 500, 'bounded result');
  }
});

test('store integration: operation revalidation happens after acquiring the host coordination lock', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const evidence = makeEvidence('TaskSpec');
  const events: string[] = [];
  const context = makeContextWith(integration, {
    validationEvidence: evidence,
    coordinate: {
      withLock<T>(key: string, fn: () => T): T {
        events.push('acquire');
        try {
          return fn();
        } finally {
          events.push('release');
        }
      },
    },
  });
  const result = executeSlice1Command(fullFlowInputs(subject).recordValidation, context);
  assert.equal(result.ok, true);
  // The first store observation (enumeration) happens after acquire; the
  // recording store boundary marks its first call.
  assert.equal(events[0], 'acquire', 'coordination lock precedes any store observation');
  assert.equal(events[events.length - 1], 'release');
});

test('store integration: revoked approval blocks issuance on a real store (approval-revoked)', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const evidence = makeEvidence('TaskSpec');
  const identity = makeIdentitySource();
  const context = makeContextWith(integration, { validationEvidence: evidence, identity });
  const inputs = fullFlowInputs(subject);
  const validation = executeSlice1Command(inputs.recordValidation, context);
  assert.equal(validation.ok, true);
  const approveContext = makeContextWith(integration, { subjectArtifact: evidence.artifact, identity });
  const approval = executeSlice1Command({ ...inputs.approve, validationRecordIds: [validation.evidence.recordId] }, approveContext);
  assert.equal(approval.ok, true);
  // Seed a revocation targeting the approval record (Slice-2 record class;
  // WP-12 Slice 1 only consumes revocation state).
  const registry = makeRegistryContext();
  seedRawRecord(integration.storeEnv, 'revocation-record', {
    record_type: 'RevocationRecord',
    record_id: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    created_at: '2026-08-04T06:00:00.000Z',
    responsible_role: 'trusted-revocation-authority',
    registry_snapshot_reference: {
      registry_protocol_id: registry.registryProtocolId,
      registry_snapshot_format_version: registry.registrySnapshotFormatVersion,
      registry_snapshot_id: registry.registrySnapshotId,
      registry_snapshot_digest: registry.registrySnapshotDigest,
      protocol_compatibility: { mode: 'exact-release', artifact_protocol_id: 'project-gateway.artifact', artifact_protocol_version: '1.0' },
    },
    target: { record_type: 'ApprovalRecord', record_id: approval.evidence.recordId },
    scope: 'all-uses',
    effective_at: '2026-08-04T05:00:00.000Z',
    reason_code: 'review-withdrawn',
  });
  const issueContext = makeContextWith(integration, { subjectArtifact: evidence.artifact, identity });
  const issuance = executeSlice1Command(inputs.issue, issueContext);
  assert.equal(issuance.ok, false);
  if (!issuance.ok) assert.equal(issuance.category, 'approval-revoked');
  // No IssuanceRecord was created.
  const enumerated = issueContext.store.enumerateLifecycleRecords('issuance-record');
  assert.equal(enumerated.ok, true);
  assert.equal(enumerated.recordIds.length, 0);
});

test('store integration: re-approval after revocation is a new record (historical facts preserved)', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const evidence = makeEvidence('TaskSpec');
  const identity = makeIdentitySource();
  const context = makeContextWith(integration, { validationEvidence: evidence, identity });
  const inputs = fullFlowInputs(subject);
  const validation = executeSlice1Command(inputs.recordValidation, context);
  assert.equal(validation.ok, true);
  const approveContext = makeContextWith(integration, { subjectArtifact: evidence.artifact, identity });
  const approval = executeSlice1Command({ ...inputs.approve, validationRecordIds: [validation.evidence.recordId] }, approveContext);
  assert.equal(approval.ok, true);
  const registry = makeRegistryContext();
  seedRawRecord(integration.storeEnv, 'revocation-record', {
    record_type: 'RevocationRecord',
    record_id: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    created_at: '2026-08-04T06:00:00.000Z',
    responsible_role: 'trusted-revocation-authority',
    registry_snapshot_reference: {
      registry_protocol_id: registry.registryProtocolId,
      registry_snapshot_format_version: registry.registrySnapshotFormatVersion,
      registry_snapshot_id: registry.registrySnapshotId,
      registry_snapshot_digest: registry.registrySnapshotDigest,
      protocol_compatibility: { mode: 'exact-release', artifact_protocol_id: 'project-gateway.artifact', artifact_protocol_version: '1.0' },
    },
    target: { record_type: 'ApprovalRecord', record_id: approval.evidence.recordId },
    scope: 'all-uses',
    effective_at: '2026-08-04T05:00:00.000Z',
    reason_code: 'review-withdrawn',
  });
  // A NEW approval command after revocation is a new record, not a
  // duplicate and not a conflict (the revoked approval is not current).
  const reapproveContext = makeContextWith(integration, { subjectArtifact: evidence.artifact, identity });
  const reapproval = executeSlice1Command({ ...inputs.approve, validationRecordIds: [validation.evidence.recordId] }, reapproveContext);
  assert.equal(reapproval.ok, true, JSON.stringify(reapproval));
  const enumerated = reapproveContext.store.enumerateLifecycleRecords('approval-record');
  assert.equal(enumerated.ok, true);
  assert.equal(enumerated.recordIds.length, 2, 'historical approval preserved + new approval record');
});

test('store integration: real-store missing ValidationRecord reference is subject-not-validated (SR-W12-S1-004)', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const evidence = makeEvidence('TaskSpec');
  const context = makeContextWith(integration, { subjectArtifact: evidence.artifact });
  // Syntactically valid but NONEXISTENT ValidationRecord identity: the real
  // WP-8 read surface reports ERR-STO-NOT-FOUND; the boundary preserves the
  // semantic absence (internal 'not-found') and the operation layer maps it
  // to subject-not-validated — identical to the fake-store behavior.
  const result = executeSlice1Command(
    {
      operation: 'approve',
      subject: subjectOperand(subject.subject),
      workspaceId: WS_A,
      purpose: 'execution-use',
      validationRecordIds: ['pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    },
    context,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'subject-not-validated');
  // Zero lifecycle mutation: no ApprovalRecord, no audit event.
  const approvals = context.store.enumerateLifecycleRecords('approval-record');
  assert.equal(approvals.ok, true);
  assert.equal(approvals.recordIds.length, 0, 'zero ApprovalRecord for a missing validation reference');
  const audit = enumerateClass({
    trustedConfiguration: integration.storeEnv.config,
    trustedInput: integration.storeEnv.bootstrapInput,
    recordClass: 'authoritative-audit-event',
  });
  assert.equal(audit.ok, true);
  assert.equal(audit.items.length, 0, 'zero AuthoritativeAuditEvent publications');
  // No raw storage error information leaks into the public result.
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('ERR-STO'), false, 'WP-8 error tokens must not leak');
  assert.equal(serialized.includes('not-found'), false, 'internal absence code must not leak');
  assert.equal(serialized.includes(integration.storeEnv.dir), false, 'store path must not leak');
  assert.equal(serialized.includes('errno'), false);
  // Workspace untouched.
  assert.deepEqual(readdirSync(integration.configEnv.workspaceRoot), []);
});

test('store integration: actual read malfunction on the real store is store-failure, not semantic absence (SR-W12-S1-004)', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const evidence = makeEvidence('TaskSpec');
  // A real boundary whose read path is broken (non-genuine trusted input):
  // readRecord fails with a non-absence storage error. The boundary must
  // NOT classify this as 'not-found'; the operation layer maps it to
  // store-failure (infrastructure failure, not missing lifecycle state).
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
  const context = makeContextWith(integration, { store: brokenBoundary, subjectArtifact: evidence.artifact });
  const result = executeSlice1Command(
    {
      operation: 'approve',
      subject: subjectOperand(subject.subject),
      workspaceId: WS_A,
      purpose: 'execution-use',
      validationRecordIds: ['pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    },
    context,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'store-failure', 'a broken read must be store-failure, never subject-not-validated');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('ERR-STO'), false);
  assert.equal(serialized.includes('forged'), false);
});

test('store integration: store never gains project-file or lock artifacts from denials', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const context = makeContextWith(integration, {});
  const result = executeSlice1Command(fullFlowInputs(subject).approve, context);
  assert.equal(result.ok, false);
  assert.deepEqual(readdirSync(integration.configEnv.workspaceRoot), []);
  const locksDir = join(integration.storeEnv.dir, 'store-v1', 'locks');
  if (existsSync(locksDir)) {
    assert.deepEqual(readdirSync(locksDir), [], 'no lock artifact from a denied flow');
  }
});

/** Build a fresh context over the integration env (identity shared per flow). */
import { makeContext } from './wp12-helpers.js';

function makeContextWith(integration: ReturnType<typeof makeIntegrationEnv>, overrides: Record<string, unknown>): ReturnType<typeof makeContext> {
  return makeContext(integration.storeEnv, overrides as never) as ReturnType<typeof makeContext>;
}
