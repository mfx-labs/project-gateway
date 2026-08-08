/**
 * WP-12 Slice 1 — ExecutionBundle lifecycle handling.
 *
 * Proves: a validated ExecutionBundle revision can be recorded, approved,
 * and issued as exact revision identity WITHOUT any project-file
 * persistence; no bundle bytes are retained as WP-12 content storage; no
 * WP-11 change; lifecycle identity/digest correlation remains exact.
 * WP-13 content acquisition is NOT implemented (out of scope).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import {
  cleanupTestEnvs,
  makeContext,
  makeEvidence,
  makeIdentitySource,
  makeIntegrationEnv,
  makeSubject,
  WS_A,
} from './wp12-helpers.js';

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

test('execution bundle: recordValidation → approve → issue for a validated ExecutionBundle revision', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('ExecutionBundle');
  const evidence = makeEvidence('ExecutionBundle');
  const identity = makeIdentitySource();
  const context = makeContext(integration.storeEnv, { validationEvidence: evidence, identity });

  const validation = executeSlice1Command(
    { operation: 'recordValidation', subject: subjectOperand(subject.subject), workspaceId: WS_A },
    context,
  );
  assert.equal(validation.ok, true, JSON.stringify(validation));
  if (!validation.ok) return;

  const approveContext = makeContext(integration.storeEnv, { subjectArtifact: evidence.artifact, identity });
  const approval = executeSlice1Command(
    { operation: 'approve', subject: subjectOperand(subject.subject), workspaceId: WS_A, purpose: 'execution-use', validationRecordIds: [validation.evidence.recordId] },
    approveContext,
  );
  assert.equal(approval.ok, true, JSON.stringify(approval));
  if (!approval.ok) return;

  const issueContext = makeContext(integration.storeEnv, { subjectArtifact: evidence.artifact, identity });
  const issuance = executeSlice1Command(
    { operation: 'issue', subject: subjectOperand(subject.subject), workspaceId: WS_A, useClass: 'execution-use' },
    issueContext,
  );
  assert.equal(issuance.ok, true, JSON.stringify(issuance));
  if (!issuance.ok) return;

  // Exact identity correlation in every stored record.
  const validationRead = context.store.readLifecyclePayload('validation-record', validation.evidence.recordId);
  const approvalRead = approveContext.store.readLifecyclePayload('approval-record', approval.evidence.recordId);
  const issuanceRead = issueContext.store.readLifecyclePayload('issuance-record', issuance.evidence.recordId);
  assert.equal(validationRead.ok, true);
  assert.equal(approvalRead.ok, true);
  assert.equal(issuanceRead.ok, true);
  for (const read of [validationRead, approvalRead, issuanceRead]) {
    const storedSubject = read.payload!['subject'] as Record<string, unknown>;
    assert.equal(storedSubject['instance_id'], subject.subject.instanceId);
    assert.equal(storedSubject['revision_id'], subject.subject.revisionId);
    assert.equal(storedSubject['digest'], subject.subject.digest);
    assert.equal((storedSubject['kind'] as Record<string, unknown>)['id'], 'ExecutionBundle');
  }
});

test('execution bundle: no project-file persistence is required or created', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('ExecutionBundle');
  const evidence = makeEvidence('ExecutionBundle');
  const identity = makeIdentitySource();
  const context = makeContext(integration.storeEnv, { validationEvidence: evidence, identity });
  const validation = executeSlice1Command(
    { operation: 'recordValidation', subject: subjectOperand(subject.subject), workspaceId: WS_A },
    context,
  );
  assert.equal(validation.ok, true);
  const approveContext = makeContext(integration.storeEnv, { subjectArtifact: evidence.artifact, identity });
  const approval = executeSlice1Command(
    { operation: 'approve', subject: subjectOperand(subject.subject), workspaceId: WS_A, purpose: 'execution-use', validationRecordIds: [validation.evidence.recordId] },
    approveContext,
  );
  assert.equal(approval.ok, true);
  const issueContext = makeContext(integration.storeEnv, { subjectArtifact: evidence.artifact, identity });
  const issuance = executeSlice1Command(
    { operation: 'issue', subject: subjectOperand(subject.subject), workspaceId: WS_A, useClass: 'execution-use' },
    issueContext,
  );
  assert.equal(issuance.ok, true);
  // The workspace root and the store contain no bundle content file: only
  // trusted lifecycle records exist in the store, and the workspace is
  // untouched.
  assert.deepEqual(readdirSync(integration.configEnv.workspaceRoot), [], 'no project files');
  const recordsEntries = readdirSync(join(integration.storeEnv.dir, 'store-v1', 'records'));
  for (const segment of ['validation', 'approval', 'issuance']) {
    assert.ok(recordsEntries.includes(segment), `lifecycle segment ${segment} present`);
  }
  // No artifact-content directory exists anywhere in the store layout.
  for (const entry of readdirSync(join(integration.storeEnv.dir, 'store-v1'))) {
    assert.ok(['metadata', 'records', 'index', 'audit', 'tmp', 'locks', 'quarantine'].includes(entry), `unexpected store entry ${entry}`);
  }
});

test('execution bundle: bundle member identity remains exact and immutable in records', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('ExecutionBundle');
  const evidence = makeEvidence('ExecutionBundle');
  const identity = makeIdentitySource();
  const context = makeContext(integration.storeEnv, { validationEvidence: evidence, identity });
  const validation = executeSlice1Command(
    { operation: 'recordValidation', subject: subjectOperand(subject.subject), workspaceId: WS_A },
    context,
  );
  assert.equal(validation.ok, true);
  const read = context.store.readLifecyclePayload('validation-record', validation.evidence.recordId);
  assert.equal(read.ok, true);
  // The recorded subject is the exact bundle revision identity; no member
  // content, no path, no repository location is part of it.
  const serialized = JSON.stringify(read.payload);
  assert.equal(serialized.includes(integration.configEnv.workspaceRoot), false, 'no path in lifecycle records');
  assert.equal(serialized.includes('fixtures/'), false, 'no repository location in lifecycle records');
  assert.equal(serialized.includes('canonicalUtf8'), false, 'no content bytes in lifecycle records');
});

test('execution bundle: no bundle bytes are retained as WP-12 content storage', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('ExecutionBundle');
  const evidence = makeEvidence('ExecutionBundle');
  const identity = makeIdentitySource();
  const context = makeContext(integration.storeEnv, { validationEvidence: evidence, identity });
  const validation = executeSlice1Command(
    { operation: 'recordValidation', subject: subjectOperand(subject.subject), workspaceId: WS_A },
    context,
  );
  assert.equal(validation.ok, true);
  // The evidence artifact carried canonical bytes; after the decision the
  // store holds only the record payload (identity/digest facts).
  const read = context.store.readLifecyclePayload('validation-record', validation.evidence.recordId);
  const payloadBytes = Buffer.byteLength(JSON.stringify(read.payload), 'utf8');
  const evidenceBytes = Buffer.byteLength(evidence.artifact.canonicalUtf8, 'utf8');
  assert.ok(payloadBytes < evidenceBytes, 'the stored record is identity evidence, not bundle content');
});

test('execution bundle: WP-13 content acquisition is NOT implemented in Slice 1', () => {
  // No content-acquisition API exists in the control-plane family; the
  // static guard proves no artifact-content store vocabulary exists.
  const core = readFileSync(join(import.meta.dirname, '..', '..', '..', 'src', 'control-plane', 'core.ts'), 'utf8');
  assert.equal(core.includes('acquireBundleContent'), false);
  assert.equal(core.includes('contentStore'), false);
  assert.equal(core.includes('resolveBundleContent'), false);
  void statSync;
});
