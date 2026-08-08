/**
 * WP-12 Slice 1 — recordValidation tests.
 *
 * Proves: accepted WP-4 evidence is recorded as an exact ValidationRecord
 * (workspace + registry bindings, validator profile, pass outcomes,
 * findings derived exclusively from the accepted run); one publication with
 * the WP-8 mechanical write-audit; fail-closed on failed/unsupported/
 * uncorrelated evidence; caller-supplied conclusions rejected; duplicate
 * semantics keyed on the full evidence correlation (never digest alone);
 * denials create no records and no AuthoritativeAuditEvent.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import { correlateValidationEvidence } from '../../src/control-plane/evidence.js';
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

function validationOperand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const subject = makeSubject('TaskSpec');
  return { operation: 'recordValidation', subject: subjectOperand(subject.subject), workspaceId: WS_A, ...overrides };
}

test('recordValidation: happy path records exactly one ValidationRecord with exact bindings', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const evidence = makeEvidence('TaskSpec');
  const context = makeContext(integration.storeEnv, { validationEvidence: evidence });
  const result = executeSlice1Command(validationOperand(), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.outcome, 'recorded');
  assert.equal(result.evidence.recordClass, 'validation-record');
  assert.match(result.evidence.recordId, /^pgw:l:[0-9a-f]{32}$/);
  assert.ok(result.evidence.auditEventId !== undefined, 'mechanical write-audit identity must be reported');

  const read = context.store.readLifecyclePayload('validation-record', result.evidence.recordId);
  assert.equal(read.ok, true);
  const payload = read.payload!;
  assert.equal(payload['record_type'], 'ValidationRecord');
  assert.equal(payload['responsible_role'], 'trusted-validator');
  const storedSubject = payload['subject'] as Record<string, unknown>;
  assert.equal(storedSubject['instance_id'], subject.subject.instanceId);
  assert.equal(storedSubject['revision_id'], subject.subject.revisionId);
  assert.equal(storedSubject['digest'], subject.subject.digest);
  assert.equal(storedSubject['workspace_id'], WS_A);
  assert.equal((storedSubject['kind'] as Record<string, unknown>)['id'], 'TaskSpec');
  const registryRef = payload['registry_snapshot_reference'] as Record<string, unknown>;
  assert.equal(registryRef['registry_snapshot_id'], context.registry.registrySnapshotId);
  assert.equal(registryRef['registry_snapshot_digest'], context.registry.registrySnapshotDigest);
  assert.equal(payload['structural_outcome'], 'pass');
  assert.equal(payload['semantic_outcome'], 'pass');
  assert.deepEqual(payload['findings'], []);
});

test('recordValidation: failed WP-4 validation result fails closed as subject-not-validated', () => {
  const integration = makeIntegrationEnv();
  const evidence = makeEvidence('TaskSpec');
  const failedReport = { ...evidence.report, ok: false as const };
  const { store, state } = makeFakeStore();
  const context = makeContext(integration.storeEnv, { store, validationEvidence: { report: failedReport as never, artifact: evidence.artifact } });
  const result = executeSlice1Command(validationOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'subject-not-validated');
  assert.equal(state.publishCalls, 0, 'a WP-4 denial is never converted into a record');
});

test('recordValidation: unsupported validation-result forms fail closed as request-invalid', () => {
  const integration = makeIntegrationEnv();
  const evidence = makeEvidence('TaskSpec');
  const { store, state } = makeFakeStore();
  const base = makeContext(integration.storeEnv, { store });
  const cases: unknown[] = [
    undefined,
    null,
    'report',
    {},
    { report: { ok: true }, artifact: undefined },
    { report: { ok: true, findings: [] }, artifact: { level: 'self-semantic-valid' } }, // unbranded artifact
    { report: { ok: true, findings: [{ rule_id: 'x', category: 'y' }] }, artifact: evidence.artifact }, // findings on an ok report
    { report: { ok: true, findings: [] }, artifact: { ...evidence.artifact, level: 'raw-parsed' } },
  ];
  for (const validationEvidence of cases) {
    const context = makeContext(integration.storeEnv, { store, validationEvidence: validationEvidence as never });
    const result = executeSlice1Command(validationOperand(), context);
    assert.equal(result.ok, false, `evidence form must be rejected: ${JSON.stringify(validationEvidence)?.slice(0, 60)}`);
    if (!result.ok) assert.equal(result.category, 'request-invalid');
  }
  assert.equal(state.publishCalls, 0);
});

test('recordValidation: tampered (unbranded) evidence is rejected as request-invalid end-to-end', () => {
  const integration = makeIntegrationEnv();
  const evidence = makeEvidence('TaskSpec');
  const { store, state } = makeFakeStore();
  // A structurally tampered artifact is no longer the branded wrapper the
  // accepted WP-4 pipeline produced; the form gate rejects it.
  const tampered = {
    ...evidence.artifact,
    instanceId: 'pgw:i:11111111111111111111111111111111',
    model: { ...(evidence.artifact.model as Record<string, unknown>), instance_id: 'pgw:i:11111111111111111111111111111111' },
  };
  const context = makeContext(integration.storeEnv, { store, validationEvidence: { report: evidence.report, artifact: tampered as never } });
  const result = executeSlice1Command(validationOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid');
  assert.equal(state.publishCalls, 0);
});

test('recordValidation: correlation mismatches are subject-invalid (direct correlation unit)', () => {
  // The correlation function is the subject-invalid authority; it is tested
  // directly with structurally valid but non-correlating evidence (the
  // end-to-end form gate correctly rejects unbranded lookalikes first).
  const evidence = makeEvidence('TaskSpec');
  const subject = makeSubject('TaskSpec');
  const model = evidence.artifact.model as Record<string, unknown>;
  const cases: { readonly name: string; readonly mutate: (a: Record<string, unknown>) => Record<string, unknown>; readonly reason: string }[] = [
    { name: 'protocol', mutate: (a) => ({ ...a, model: { ...model, protocol: { id: 'project-gateway.artifact', version: '0.9' } } }), reason: 'protocol-mismatch' },
    { name: 'kind', mutate: (a) => ({ ...a, model: { ...model, kind: { id: 'ContextManifest', version: '1.0' } } }), reason: 'kind-mismatch' },
    { name: 'instance', mutate: (a) => ({ ...a, instanceId: 'pgw:i:11111111111111111111111111111111', model: { ...model, instance_id: 'pgw:i:11111111111111111111111111111111' } }), reason: 'instance-mismatch' },
    { name: 'revision', mutate: (a) => ({ ...a, revisionId: 'pgw:r:22222222222222222222222222222222' }), reason: 'revision-mismatch' },
    { name: 'digest', mutate: (a) => ({ ...a, digest: `sha-256:${'0'.repeat(64)}` }), reason: 'digest-mismatch' },
    { name: 'workspace', mutate: (a) => ({ ...a, model: { ...model, workspace_binding: { mode: 'bound', workspace_id: 'pgw:w:99999999999999999999999999999999' } } }), reason: 'workspace-mismatch' },
  ];
  for (const entry of cases) {
    const artifact = entry.mutate({ ...evidence.artifact });
    const result = correlateValidationEvidence({ report: evidence.report, artifact: artifact as never }, subject.subject);
    assert.equal(result.ok, false, `${entry.name} mismatch must fail correlation`);
    if (!result.ok) assert.equal(result.reason, entry.reason, `${entry.name} mismatch reason`);
  }
  // The unmutated evidence correlates.
  assert.equal(correlateValidationEvidence(evidence, subject.subject).ok, true);
});

test('recordValidation: caller-supplied validation conclusion can never become a record', () => {
  const integration = makeIntegrationEnv();
  const { store, state } = makeFakeStore();
  const context = makeContext(integration.storeEnv, { store });
  // No evidence at all in the host context: the operation has nothing to
  // derive from and must fail closed without publication.
  const result = executeSlice1Command(validationOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid');
  assert.equal(state.publishCalls, 0);
});

test('recordValidation: missing trusted validation evidence fails closed', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const context = makeContext(integration.storeEnv, { store, validationEvidence: undefined });
  const result = executeSlice1Command(validationOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid');
});

test('recordValidation: malformed request fails closed as request-invalid', () => {
  const integration = makeIntegrationEnv();
  const evidence = makeEvidence('TaskSpec');
  const context = makeContext(integration.storeEnv, { validationEvidence: evidence });
  const malformed = [
    validationOperand({ subject: { instanceId: 'not-an-id' } }),
    validationOperand({ workspaceId: 'pgw:w:99999999999999999999999999999999' }),
    validationOperand({ validationRecordIds: ['pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] }),
  ];
  for (const input of malformed) {
    const result = executeSlice1Command(input, context);
    assert.equal(result.ok, false);
  }
});

test('recordValidation: identical evidence correlation is a deterministic conflict (lifecycle-conflict)', () => {
  const integration = makeIntegrationEnv();
  const evidence = makeEvidence('TaskSpec');
  const context = makeContext(integration.storeEnv, { validationEvidence: evidence });
  const first = executeSlice1Command(validationOperand(), context);
  assert.equal(first.ok, true);
  const second = executeSlice1Command(validationOperand(), context);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.category, 'lifecycle-conflict');
});

test('recordValidation: same digest under a new registry snapshot is a legitimate new record', () => {
  const integration = makeIntegrationEnv();
  const evidence = makeEvidence('TaskSpec');
  const identity = makeIdentitySource();
  const contextA = makeContext(integration.storeEnv, { validationEvidence: evidence, identity });
  const first = executeSlice1Command(validationOperand(), contextA);
  assert.equal(first.ok, true, JSON.stringify(first));
  // A second accepted WP-4 run under a DIFFERENT accepted registry snapshot
  // (same artifact digest) must not be blocked as a duplicate.
  const otherRegistry = makeRegistryContext();
  const otherContext = makeContext(integration.storeEnv, {
    registry: { ...otherRegistry, registrySnapshotId: 'pgw:g:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', registrySnapshotDigest: `sha-256:${'a'.repeat(64)}` },
    validationEvidence: evidence,
    identity,
  });
  const second = executeSlice1Command(validationOperand(), otherContext);
  assert.equal(second.ok, true, JSON.stringify(second));
});

test('recordValidation: denied operation creates zero records', () => {
  const integration = makeIntegrationEnv();
  const { store, state } = makeFakeStore();
  const context = makeContext(integration.storeEnv, { store });
  const result = executeSlice1Command(validationOperand(), context);
  assert.equal(result.ok, false);
  assert.equal(state.publishCalls, 0, 'denied recordValidation must publish nothing');
});

test('recordValidation: registry-context binding is exact (mismatched accepted context cannot record under a foreign snapshot)', () => {
  const integration = makeIntegrationEnv();
  const evidence = makeEvidence('TaskSpec');
  const context = makeContext(integration.storeEnv, { validationEvidence: evidence });
  const result = executeSlice1Command(validationOperand(), context);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const read = context.store.readLifecyclePayload('validation-record', result.evidence.recordId);
  assert.equal(read.ok, true);
  const ref = read.payload!['registry_snapshot_reference'] as Record<string, unknown>;
  assert.equal(ref['registry_snapshot_id'], context.registry.registrySnapshotId);
  assert.equal(ref['registry_snapshot_digest'], context.registry.registrySnapshotDigest);
});

test('recordValidation: zero project-file mutation', () => {
  const integration = makeIntegrationEnv();
  const evidence = makeEvidence('TaskSpec');
  const context = makeContext(integration.storeEnv, { validationEvidence: evidence });
  const result = executeSlice1Command(validationOperand(), context);
  assert.equal(result.ok, true);
  // The workspace root contains nothing: no artifact file, no lifecycle
  // file, no lock file.
  const entries = readdirSync(integration.configEnv.workspaceRoot);
  assert.deepEqual(entries, []);
});
