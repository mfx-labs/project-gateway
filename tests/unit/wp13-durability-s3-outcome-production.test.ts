/**
 * WP-13 durability S3 — outcome production FOCUSED tests.
 *
 * Real initialized WP-8 store, real WP-12 chain, real WP-5A observation,
 * real WP-5B enforcement evidence, real WP-13B completion flow (handoff +
 * durable ValidationRecord), the real S2 outcome store boundary +
 * capability, and the real host composition (`createExecutionOutcomeAuthority`).
 *
 * Covers (durability decision §16–§18): new-outcome production (no-result
 * and result-associated), exact material replay (zero allocations/writes),
 * material divergence conflicts, cardinality fail-closed (no
 * enumeration-order winner), opaque identity/timestamp allocation timing,
 * correlation rejections (§17), and the Model-1 attempt-lock model (§18:
 * shared exact key with WP-13C, lock held through re-read/write, lock
 * released before WP-13C, no nested acquisition, concurrent
 * create/replay/conflict callers, independent attempt keys).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { validateLifecycleRecord, createSchemaRegistry } from '../../src/api/validate.js';
import { produceExecutionOutcome, createExecutionOutcomeAuthority, canonicalObservationContentDigest } from '../../src/outcome-production/index.js';
import { publishValidatedResult } from '../../src/publication/index.js';
import { LockContentionError, createProcessLocalCoordinator } from '../../src/control-plane/coordination.js';
import { attemptCoordinationKey } from '../../src/internal/attempt-coordination-key.js';
import { buildValidationRecordPayload, buildExecutionAttemptRecordPayload } from '../../src/control-plane/records.js';
import { defaultLimitProfile } from '../../src/storage/limits/limits.js';
import { seedPayload, UID, FIXED_NOW, WS_A } from './wp12-helpers.js';
import {
  makeS3Env,
  s3Cleanup,
  makeCountingOutcomeIdentity,
  makeThrowingOutcomeIdentity,
  makeObservation,
  makeObservationFor,
  makeNonNfcObservation,
  makeOutcome,
  nextRecordId,
  OCCURRENCE_ID,
  ATTEMPT_ID,
  ATTEMPT_RECORD_ID,
  ACTIVATION_RECORD_ID,
  GRANT_ID,
} from './wp13-durability-s3-helpers.js';
import type { OutcomeProductionResult } from '../../src/outcome-production/types.js';
import type { OutcomeStoreBoundary } from '../../src/outcome/types.js';
import type { OutcomePublicationResult } from '../../src/outcome/types.js';
import type { ValidatedResultHandoff } from '../../src/completion/types.js';

after(s3Cleanup);

const registry = createSchemaRegistry();

function producedOf(result: OutcomeProductionResult): { readonly recordId: string; readonly recordDigest: string; readonly evidenceId: string; readonly outcome: 'published' | 'replayed'; readonly auditEventId?: string } {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  return result;
}

function publishResultOf(result: { readonly ok: true; readonly outcome: 'published' | 'idempotent-replay'; readonly recordId: string; readonly recordDigest: string } | { readonly ok: false; readonly category: string; readonly code: string; readonly message: string }): { readonly outcome: 'published' | 'idempotent-replay'; readonly recordId: string; readonly recordDigest: string } {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  return result;
}

function failedOf(result: OutcomeProductionResult): { readonly category: string; readonly code: string } {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) throw new Error('unreachable');
  return { category: result.category, code: result.code };
}

/** Seed a durable passing ValidationRecord for a variant handoff subject. */
function seedResultValidation(env: ReturnType<typeof makeS3Env>, handoff: ValidatedResultHandoff, recordId: string): void {
  seedPayload(env.store, 'validation-record', buildValidationRecordPayload({
    recordId,
    createdAt: FIXED_NOW,
    subject: {
      protocolId: 'project-gateway.artifact',
      protocolVersion: '1.0',
      kindId: 'ExecutionResult' as never,
      kindVersion: '1.0',
      instanceId: handoff.resultInstanceId,
      revisionId: handoff.resultRevisionId,
      digest: handoff.resultDigest,
      workspaceId: handoff.workspaceId,
    },
    registry: env.registryCtx,
  }));
}

function readValidation(env: ReturnType<typeof makeS3Env>, recordId: string): Readonly<Record<string, unknown>> {
  const read = env.store.readLifecyclePayload('validation-record', recordId);
  if (!read.ok || read.payload === undefined) throw new Error('validation record unreadable');
  return read.payload;
}

/**
 * Test-owned fake S2 outcome store: an empty outcome domain plus an
 * injectable `publishExactOutcomeRecord` result (SIR-WP13-DUR-S3-002).
 */
function fakeOutcomeStore(publishResult: OutcomePublicationResult): OutcomeStoreBoundary {
  return {
    publishExactOutcomeRecord() {
      return publishResult;
    },
    readLifecyclePayload() {
      return { ok: false, code: 'not-found' };
    },
    enumerateLifecycleRecords() {
      return { ok: true, recordIds: [] };
    },
  };
}

/** The exact attempt key for this env's attempt (pure shared helper). */
function envKey(env: ReturnType<typeof makeS3Env>): string {
  const bundle = env.attempt['bundle'] as Readonly<Record<string, unknown>>;
  return attemptCoordinationKey({
    workspaceId: String(env.attempt['workspace_id']),
    bundleInstanceId: String(bundle['target_instance_id']),
    bundleRevisionId: String(bundle['target_revision_id']),
    bundleDigest: String(bundle['target_digest']),
    occurrenceId: String(env.attempt['occurrence_id']),
    attemptId: String(env.attempt['attempt_id']),
  });
}

// ─── §16 new outcome ────────────────────────────────────────────────────────

test('S3: valid retrospective-complete no-result attempt produces exactly one schema-valid outcome record', () => {
  const env = makeS3Env();
  const result = produceExecutionOutcome(env.input({
    enforcement: undefined,
    handoff: undefined,
    validation: undefined,
    outcome: makeOutcome('failed'),
  }));
  const produced = producedOf(result);
  assert.equal(produced.outcome, 'published');
  const records = env.outcomeRecords();
  assert.equal(records.length, 1);
  const record = records[0]!;
  // Schema-valid durable record (committed S1 lifecycle schema gate).
  const gate = validateLifecycleRecord(record, registry);
  assert.equal(gate.ok, true, JSON.stringify(gate));
  // Exact attempt binding + durable disposition.
  assert.equal(record['record_type'], 'ExecutionOutcomeRecord');
  assert.equal(record['responsible_role'], 'trusted-execution-outcome-recorder');
  assert.equal(record['workspace_id'], env.attempt['workspace_id']);
  assert.equal(record['occurrence_id'], env.attempt['occurrence_id']);
  assert.equal(record['attempt_id'], env.attempt['attempt_id']);
  assert.equal(record['ordinal'], 1);
  assert.equal(record['execution_attempt_record_id'], env.attempt['record_id']);
  assert.equal(record['disposition'], 'failed');
  // No enforcement group, no result association on the no-result path.
  assert.equal(record['enforcement_evidence'], undefined);
  assert.equal(record['result_association'], undefined);
  // The required observation evidence (opaque pgw:e: id, canonical digest).
  const oe = record['observation_evidence'] as Readonly<Record<string, unknown>>;
  assert.equal(oe['kind'], 'external-evidence');
  assert.match(String(oe['evidence_id']), /^pgw:e:[0-9a-f]{32}$/);
  assert.equal(oe['declared_media_type'], 'application/json');
  assert.equal(oe['observation_role'], 'evaluation-evidence');
  const digest = canonicalObservationContentDigest(env.observation);
  assert.equal(digest.ok, true);
  if (digest.ok) assert.equal(oe['content_digest'], digest.digest);
  assert.equal(env.outcomePublishCount(), 1);
});

test('S3: valid completed result-associated attempt persists the exact quartet and enforcement group from trusted inputs', () => {
  const env = makeS3Env();
  const produced = producedOf(produceExecutionOutcome(env.input()));
  assert.equal(produced.outcome, 'published');
  const record = env.outcomeRecords()[0]!;
  const ra = record['result_association'] as Readonly<Record<string, unknown>>;
  assert.deepEqual(ra, {
    instance_id: env.handoff.resultInstanceId,
    revision_digest: env.handoff.resultDigest,
    association_mode: env.handoff.associationMode,
    validation_record_id: env.handoff.validationRecordId,
  });
  const ee = record['enforcement_evidence'] as Readonly<Record<string, unknown>>;
  assert.deepEqual(ee, {
    projection_identity: env.enforcement.projectionIdentity,
    evidence_fingerprint: env.enforcement.evidenceFingerprint,
  });
  assert.equal(env.outcomePublishCount(), 1);
});

test('S3: enforcement-absent attempt yields a record without the enforcement group', () => {
  const env = makeS3Env();
  const produced = producedOf(produceExecutionOutcome(env.input({ enforcement: undefined })));
  assert.equal(produced.outcome, 'published');
  assert.equal(env.outcomeRecords()[0]!['enforcement_evidence'], undefined);
  assert.notEqual(env.outcomeRecords()[0]!['result_association'], undefined);
});

test('S3: opaque record/evidence ids and the timestamp are allocated exactly once, ONLY in the no-existing branch', () => {
  const env = makeS3Env();
  const counting = makeCountingOutcomeIdentity();
  const first = producedOf(produceExecutionOutcome(env.input({ identity: counting })));
  assert.equal(counting.calls.recordId, 1);
  assert.equal(counting.calls.evidenceId, 1);
  assert.equal(counting.calls.now, 1);
  // Exact replay: the identity/time sources are NEVER invoked.
  const second = producedOf(produceExecutionOutcome(env.input({ identity: makeThrowingOutcomeIdentity() })));
  assert.equal(second.outcome, 'replayed');
  assert.equal(second.recordId, first.recordId);
  assert.equal(second.evidenceId, first.evidenceId);
});

test('S3: malformed identity/time source values in the no-existing branch fail closed as identity failure', () => {
  const env = makeS3Env();
  const badRecordId = { ...makeCountingOutcomeIdentity(), newRecordId: () => 'not-a-record-id' };
  const r1 = failedOf(produceExecutionOutcome(env.input({ identity: badRecordId })));
  assert.equal(r1.category, 'OUTCOME-IDENTITY-FAILURE');
  assert.equal(r1.code, 'identity.record-id-invalid');
  const badEvidenceId = { ...makeCountingOutcomeIdentity(), newEvidenceId: () => 'sess-1/turn:0' };
  const r2 = failedOf(produceExecutionOutcome(env.input({ identity: badEvidenceId })));
  assert.equal(r2.category, 'OUTCOME-IDENTITY-FAILURE');
  assert.equal(r2.code, 'identity.evidence-id-invalid');
  const badTime = { ...makeCountingOutcomeIdentity(), nowUtcIso: () => 'not-a-timestamp' };
  const r3 = failedOf(produceExecutionOutcome(env.input({ identity: badTime })));
  assert.equal(r3.category, 'OUTCOME-IDENTITY-FAILURE');
  assert.equal(r3.code, 'identity.time-invalid');
  assert.equal(env.outcomePublishCount(), 0);
});

test('S3: the host composition publishes through the real S2 → WP-8 path with the D-6 mechanical audit', () => {
  const env = makeS3Env();
  const authority = createExecutionOutcomeAuthority({
    trustedConfiguration: env.integration.storeEnv.config,
    bootstrapInput: env.integration.storeEnv.bootstrapInput,
    writeAction: {
      actionIdentity: 'outcome-write-action-host',
      locator: env.integration.storeEnv.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: env.integration.storeEnv.config.identity,
      limitProfile: defaultLimitProfile(),
    },
    locator: env.integration.storeEnv.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
    lockTimeSource: { now: () => 1000, processStartTime: 500 },
    schemaRegistry: registry,
    actionIdentity: 'outcome-recording-action-host',
    publicationActionIdentity: 'result-publication-action-host',
  });
  assert.ok(authority !== undefined, 'the authority must mint under the genuine trusted configuration');
  const produced = producedOf(authority.produce({
    attempt: env.attempt,
    outcome: makeOutcome(),
    observation: env.observation,
    enforcement: env.enforcement,
    handoff: env.handoff,
    validation: env.validation,
    registry: env.registryCtx,
    records: env.store,
    coordinate: createProcessLocalCoordinator(),
    identity: makeCountingOutcomeIdentity(),
  }));
  assert.equal(produced.outcome, 'published');
  assert.match(produced.recordId, /^pgw:l:[0-9a-f]{32}$/);
  assert.ok(produced.auditEventId !== undefined, 'the WP-8 mechanical authorized-write audit event must be reported');
  // The record is durable through the composed boundary (real store).
  const enumerated = authority.boundary.enumerateLifecycleRecords('execution-outcome-record');
  assert.equal(enumerated.ok, true);
  assert.equal(enumerated.recordIds.length, 1);
  const read = authority.boundary.readLifecyclePayload('execution-outcome-record', produced.recordId);
  assert.equal(read.ok, true);
  if (read.ok && read.payload !== undefined) {
    const gate = validateLifecycleRecord(read.payload, registry);
    assert.equal(gate.ok, true, JSON.stringify(gate));
  }
});

test('S3: the trusted publication composition publishes/replays ONLY through the genuine branded outcome context (SIR-WP13-DUR-S3-001)', () => {
  const env = makeS3Env();
  const authority = createExecutionOutcomeAuthority({
    trustedConfiguration: env.integration.storeEnv.config,
    bootstrapInput: env.integration.storeEnv.bootstrapInput,
    writeAction: {
      actionIdentity: 'outcome-write-action-compose',
      locator: env.integration.storeEnv.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: env.integration.storeEnv.config.identity,
      limitProfile: defaultLimitProfile(),
    },
    locator: env.integration.storeEnv.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
    lockTimeSource: { now: () => 1000, processStartTime: 500 },
    schemaRegistry: registry,
    actionIdentity: 'outcome-recording-action-compose',
    publicationActionIdentity: 'result-publication-action-compose',
  });
  assert.ok(authority !== undefined, 'the authority must mint under the genuine trusted configuration');
  const base = {
    handoff: env.handoff,
    evaluatorProvenance: { evaluator_id: env.handoff.evaluatorId, capability_profile_id: env.handoff.capabilityProfileId },
    registry: env.registryCtx,
    coordinate: createProcessLocalCoordinator(),
    identity: { nowUtcIso: () => FIXED_NOW, newRecordId: () => nextRecordId() },
  };
  // No outcome record yet: the composition's own precondition denies BEFORE
  // any publication write (genuine context, zero durable outcomes).
  const denied = authority.publishResult(base);
  assert.equal(denied.ok, false, JSON.stringify(denied));
  if (!denied.ok) {
    assert.equal(denied.category, 'PUBLICATION-OUTCOME-REJECTED');
    assert.equal(denied.code, 'outcome.missing');
  }
  // Produce the durable outcome through the composition, then publish:
  // valid exact outcome → publication succeeds.
  producedOf(authority.produce({
    attempt: env.attempt,
    outcome: makeOutcome(),
    observation: env.observation,
    enforcement: env.enforcement,
    handoff: env.handoff,
    validation: env.validation,
    registry: env.registryCtx,
    records: env.store,
    coordinate: base.coordinate,
    identity: makeCountingOutcomeIdentity(),
  }));
  const first = publishResultOf(authority.publishResult(base));
  assert.equal(first.outcome, 'published');
  // Exact replay: the durable outcome precondition is RECHECKED and the
  // existing publication returns idempotently.
  const second = publishResultOf(authority.publishResult(base));
  assert.equal(second.outcome, 'idempotent-replay');
  assert.equal(second.recordId, first.recordId);
  // A second outcome record appears: replay is now denied — an existing
  // publication alone never bypasses the outcome precondition.
  env.seedOutcome({ overrides: { record_id: nextRecordId() } });
  const third = authority.publishResult(base);
  assert.equal(third.ok, false);
  if (!third.ok) {
    assert.equal(third.category, 'PUBLICATION-OUTCOME-REJECTED');
    assert.equal(third.code, 'outcome.multiple');
  }
});

// ─── §16 exact replay ───────────────────────────────────────────────────────

test('S3: exact replay returns the existing durable record/id/evidence id with zero allocations and zero writes', () => {
  const env = makeS3Env();
  const seededId = env.seedOutcome();
  const durable = env.outcomeRecords()[0]!;
  const result = produceExecutionOutcome(env.input({ identity: makeThrowingOutcomeIdentity() }));
  const replayed = producedOf(result);
  assert.equal(replayed.outcome, 'replayed');
  assert.equal(replayed.recordId, seededId);
  assert.equal(replayed.recordId, durable['record_id']);
  assert.equal(replayed.evidenceId, (durable['observation_evidence'] as Readonly<Record<string, unknown>>)['evidence_id']);
  // No S2 writer call, no WP-8 write, still exactly one durable record.
  assert.equal(env.outcomePublishCount(), 0);
  assert.equal(env.outcomeRecords().length, 1);
});

// ─── §16 divergence ─────────────────────────────────────────────────────────

test('S3: disposition divergence fails closed as a typed conflict with zero allocations and zero writes', () => {
  const env = makeS3Env();
  env.seedOutcome();
  const result = produceExecutionOutcome(env.input({ identity: makeThrowingOutcomeIdentity(), outcome: makeOutcome('failed') }));
  const failed = failedOf(result);
  assert.equal(failed.category, 'OUTCOME-CONFLICT');
  assert.equal(failed.code, 'conflict.material-divergence');
  assert.equal(env.outcomePublishCount(), 0);
  assert.equal(env.outcomeRecords().length, 1);
});

test('S3: observation digest divergence fails closed as a typed conflict', () => {
  const env = makeS3Env();
  env.seedOutcome();
  const otherObservation = makeObservation('a different completion text');
  const result = produceExecutionOutcome(env.input({ identity: makeThrowingOutcomeIdentity(), observation: otherObservation }));
  const failed = failedOf(result);
  assert.equal(failed.category, 'OUTCOME-CONFLICT');
  assert.equal(failed.code, 'conflict.material-divergence');
  assert.equal(env.outcomePublishCount(), 0);
});

test('S3: enforcement group presence/value divergence fails closed both directions', () => {
  // Present in the durable record, absent in the trusted input.
  const envA = makeS3Env();
  envA.seedOutcome({ withEnforcement: true });
  const rA = failedOf(produceExecutionOutcome(envA.input({ identity: makeThrowingOutcomeIdentity(), enforcement: undefined })));
  assert.equal(rA.category, 'OUTCOME-CONFLICT');
  assert.equal(rA.code, 'conflict.material-divergence');
  // Absent in the durable record, present in the trusted input.
  const envB = makeS3Env();
  envB.seedOutcome({ withEnforcement: false });
  const rB = failedOf(produceExecutionOutcome(envB.input({ identity: makeThrowingOutcomeIdentity() })));
  assert.equal(rB.category, 'OUTCOME-CONFLICT');
  assert.equal(rB.code, 'conflict.material-divergence');
  // Wrong enforcement values in the durable record.
  const envC = makeS3Env();
  envC.seedOutcome({ overrides: { enforcement_evidence: { projection_identity: 'sha-256:' + '1'.repeat(64), evidence_fingerprint: 'sha-256:' + '2'.repeat(64) } } });
  const rC = failedOf(produceExecutionOutcome(envC.input({ identity: makeThrowingOutcomeIdentity() })));
  assert.equal(rC.category, 'OUTCOME-CONFLICT');
  assert.equal(rC.code, 'conflict.material-divergence');
  assert.equal(envA.outcomePublishCount(), 0);
  assert.equal(envB.outcomePublishCount(), 0);
  assert.equal(envC.outcomePublishCount(), 0);
});

test('S3: result quartet divergences (instance/digest/mode/validation id) each fail closed', () => {
  // instance
  const envI = makeS3Env();
  envI.seedOutcome();
  const vi = { ...envI.handoff, resultInstanceId: 'pgw:i:' + 'd'.repeat(32), resultRevisionId: 'pgw:r:' + 'e'.repeat(32), resultDigest: 'sha-256:' + 'f'.repeat(64), validationRecordId: nextRecordId() };
  seedResultValidation(envI, vi, vi.validationRecordId);
  const ri = failedOf(produceExecutionOutcome(envI.input({ identity: makeThrowingOutcomeIdentity(), handoff: vi, validation: readValidation(envI, vi.validationRecordId) })));
  assert.equal(ri.code, 'conflict.material-divergence');
  // digest
  const envD = makeS3Env();
  envD.seedOutcome();
  const vd = { ...envD.handoff, resultDigest: 'sha-256:' + 'f'.repeat(64), validationRecordId: nextRecordId() };
  seedResultValidation(envD, vd, vd.validationRecordId);
  const rd = failedOf(produceExecutionOutcome(envD.input({ identity: makeThrowingOutcomeIdentity(), handoff: vd, validation: readValidation(envD, vd.validationRecordId) })));
  assert.equal(rd.code, 'conflict.material-divergence');
  // association mode
  const envM = makeS3Env();
  envM.seedOutcome();
  const vm = { ...envM.handoff, associationMode: (envM.handoff.associationMode === 'originated' ? 'adopted' : 'originated') as 'originated' | 'adopted', validationRecordId: nextRecordId() };
  seedResultValidation(envM, vm, vm.validationRecordId);
  const rm = failedOf(produceExecutionOutcome(envM.input({ identity: makeThrowingOutcomeIdentity(), handoff: vm, validation: readValidation(envM, vm.validationRecordId) })));
  assert.equal(rm.code, 'conflict.material-divergence');
  // validation id
  const envV = makeS3Env();
  envV.seedOutcome();
  const vv = { ...envV.handoff, validationRecordId: nextRecordId() };
  seedResultValidation(envV, vv, vv.validationRecordId);
  const rv = failedOf(produceExecutionOutcome(envV.input({ identity: makeThrowingOutcomeIdentity(), handoff: vv, validation: readValidation(envV, vv.validationRecordId) })));
  assert.equal(rv.code, 'conflict.material-divergence');
  assert.equal(envI.outcomePublishCount(), 0);
  assert.equal(envD.outcomePublishCount(), 0);
  assert.equal(envM.outcomePublishCount(), 0);
  assert.equal(envV.outcomePublishCount(), 0);
});

test('S3: ordinal/binding divergence fails closed as a typed conflict', () => {
  const env = makeS3Env();
  env.seedOutcome({ overrides: { ordinal: 2 } });
  const result = produceExecutionOutcome(env.input({ identity: makeThrowingOutcomeIdentity() }));
  const failed = failedOf(result);
  assert.equal(failed.category, 'OUTCOME-CONFLICT');
  assert.equal(failed.code, 'conflict.material-divergence');
  assert.equal(env.outcomePublishCount(), 0);
});

// ─── §16 cardinality ────────────────────────────────────────────────────────

test('S3: two existing outcome records fail closed as a durable outcome conflict (no winner)', () => {
  const env = makeS3Env();
  env.seedOutcome();
  env.seedOutcome();
  const result = produceExecutionOutcome(env.input({ identity: makeThrowingOutcomeIdentity() }));
  const failed = failedOf(result);
  assert.equal(failed.category, 'OUTCOME-CONFLICT');
  assert.equal(failed.code, 'conflict.multiple-outcomes');
  assert.equal(env.outcomePublishCount(), 0);
  assert.equal(env.outcomeRecords().length, 2);
});

test('S3: reversed seeding order yields the SAME typed conflict (no enumeration-order selection)', () => {
  const env = makeS3Env();
  env.seedOutcome({ overrides: { record_id: 'pgw:l:' + 'b'.repeat(32) } });
  env.seedOutcome({ overrides: { record_id: 'pgw:l:' + 'a'.repeat(32) } });
  const result = produceExecutionOutcome(env.input({ identity: makeThrowingOutcomeIdentity() }));
  const failed = failedOf(result);
  assert.equal(failed.category, 'OUTCOME-CONFLICT');
  assert.equal(failed.code, 'conflict.multiple-outcomes');
  assert.equal(env.outcomePublishCount(), 0);
});

test('S3: a stale/divergent input attempt record fails closed under the lock re-read (state.attempt-diverged)', () => {
  const env = makeS3Env();
  // Mutate a field that is NOT part of any pre-lock correlation gate, so the
  // under-lock exact-current re-read is the first check to fire.
  const staleAttempt = { ...env.attempt, created_at: '2099-01-01T00:00:00.000Z' };
  const result = produceExecutionOutcome(env.input({ attempt: staleAttempt, identity: makeThrowingOutcomeIdentity() }));
  const failed = failedOf(result);
  assert.equal(failed.category, 'OUTCOME-CONFLICT');
  assert.equal(failed.code, 'state.attempt-diverged');
  assert.equal(env.outcomePublishCount(), 0);
});

test('S3: malformed/corrupt existing outcome state fails closed (wrong class marker)', () => {
  const env = makeS3Env();
  env.seedRawOutcome({
    ...(env.input().attempt as Readonly<Record<string, unknown>>),
    record_type: 'ResultPublicationRecord',
    record_id: nextRecordId(),
  });
  const result = produceExecutionOutcome(env.input({ identity: makeThrowingOutcomeIdentity() }));
  const failed = failedOf(result);
  assert.equal(failed.category, 'OUTCOME-CONFLICT');
  assert.equal(failed.code, 'state.outcome-corrupt');
  assert.equal(env.outcomePublishCount(), 0);
});

test('S3: a schema-invalid existing outcome candidate fails closed (state.outcome-corrupt)', () => {
  const env = makeS3Env();
  env.seedOutcome({ overrides: { responsible_role: 'trusted-validator' } });
  const result = produceExecutionOutcome(env.input({ identity: makeThrowingOutcomeIdentity() }));
  const failed = failedOf(result);
  assert.equal(failed.category, 'OUTCOME-CONFLICT');
  assert.equal(failed.code, 'state.outcome-corrupt');
  assert.equal(env.outcomePublishCount(), 0);
});

// ─── §SIR-002 non-published storage states ──────────────────────────────────

test('S3: ONLY the S2/WP-8 `published` storage outcome is new-outcome success (SIR-WP13-DUR-S3-002)', () => {
  const publishedResult: OutcomePublicationResult = {
    ok: true,
    outcome: 'published',
    recordId: 'pgw:l:' + '1'.repeat(32),
    recordDigest: 'sha-256:' + '2'.repeat(64),
    auditEventId: 'pgw:l:' + '3'.repeat(32),
  };
  const env = makeS3Env();
  const produced = producedOf(produceExecutionOutcome(env.input({ store: fakeOutcomeStore(publishedResult) })));
  assert.equal(produced.outcome, 'published');
  assert.equal(produced.recordId, publishedResult.recordId);
  assert.equal(produced.evidenceId, 'pgw:e:00000000000000000000000000000001', 'the evidence id is durable ONLY with a confirmed publication');
});

test('S3: every non-published S2 storage outcome is a fail-closed write failure — never success, never replay (SIR-WP13-DUR-S3-002)', () => {
  const nonPublished: readonly OutcomePublicationResult[] = [
    { ok: true, outcome: 'idempotent-duplicate', recordId: 'pgw:l:' + '1'.repeat(32), recordDigest: 'sha-256:' + '2'.repeat(64) },
    { ok: true, outcome: 'duplicate', recordId: 'pgw:l:' + '1'.repeat(32), recordDigest: 'sha-256:' + '2'.repeat(64) },
    { ok: true, outcome: 'conflict-revision', recordId: 'pgw:l:' + '1'.repeat(32), recordDigest: 'sha-256:' + '2'.repeat(64) },
    { ok: false, category: 'OUTCOME-WRITE-FAILED', code: 'write.publish-failed', message: 'the WP-8 publication substrate rejected the outcome record' },
    { ok: false, category: 'OUTCOME-CAPABILITY-DENIED', code: 'permit.not-genuine', message: 'the outcome publication permit is not genuine' },
    { ok: false, category: 'OUTCOME-INPUT-INVALID', code: 'record.schema-invalid', message: 'the outcome record failed committed lifecycle schema validation' },
  ];
  for (const injected of nonPublished) {
    const env = makeS3Env();
    const result = produceExecutionOutcome(env.input({ store: fakeOutcomeStore(injected) }));
    assert.equal(result.ok, false, JSON.stringify(injected));
    if (!result.ok) {
      // A storage duplicate must NEVER become semantic replay, and a
      // never-durable freshly allocated evidence identity must NEVER be
      // returned inside any success (failures carry no success outcome).
      assert.equal('outcome' in result, false, 'a fail-closed result must never carry a success outcome (never replay, never published)');
      if (injected.ok === true) {
        assert.equal(result.category, 'OUTCOME-WRITE-FAILED');
        assert.equal(result.code, 'write.not-published');
      } else {
        assert.equal(result.category, injected.category);
        assert.equal(result.code, injected.code);
      }
    }
  }
});

// ─── §17 correlation rejections (no write on any rejection) ────────────────

test('S3: fake/unbranded observation is rejected', () => {
  const env = makeS3Env();
  const fake = { ...env.observation };
  const result = produceExecutionOutcome(env.input({ observation: fake as never }));
  const failed = failedOf(result);
  assert.equal(failed.category, 'OUTCOME-INPUT-INVALID');
  assert.equal(failed.code, 'input.observation-not-genuine');
  assert.equal(env.outcomePublishCount(), 0);
});

test('S3: wrong-occurrence and wrong-attempt genuine observations are rejected', () => {
  const env = makeS3Env();
  const wrongOccurrence = makeObservationFor('pgw:o:' + 'b'.repeat(32), ATTEMPT_ID);
  const r1 = failedOf(produceExecutionOutcome(env.input({ observation: wrongOccurrence })));
  assert.equal(r1.code, 'input.observation-correlation');
  const wrongAttempt = makeObservationFor(OCCURRENCE_ID, 'pgw:a:' + '9'.repeat(32));
  const r2 = failedOf(produceExecutionOutcome(env.input({ observation: wrongAttempt })));
  assert.equal(r2.code, 'input.observation-correlation');
  assert.equal(env.outcomePublishCount(), 0);
});

test('S3: wrong-bundle observation is rejected (exact bundle reference correlation)', () => {
  const env = makeS3Env();
  const mutatedAttempt = {
    ...env.attempt,
    bundle: { ...(env.attempt['bundle'] as Readonly<Record<string, unknown>>), target_instance_id: 'pgw:i:' + 'd'.repeat(32) },
  };
  const result = produceExecutionOutcome(env.input({ attempt: mutatedAttempt as never }));
  const failed = failedOf(result);
  assert.equal(failed.category, 'OUTCOME-INPUT-INVALID');
  assert.equal(failed.code, 'input.observation-correlation');
  assert.equal(env.outcomePublishCount(), 0);
});

test('S3: raw session/turn correlation ids are NEVER evidence identities (digest-bound material only)', () => {
  const env = makeS3Env();
  producedOf(produceExecutionOutcome(env.input()));
  const record = env.outcomeRecords()[0]!;
  const serialized = JSON.stringify(record);
  assert.match(String((record['observation_evidence'] as Readonly<Record<string, unknown>>)['evidence_id']), /^pgw:e:[0-9a-f]{32}$/);
  assert.ok(!serialized.includes(String(env.observation.sessionCorrelationId)), 'the session id must not appear in the durable record');
  assert.ok(!serialized.includes(String(env.observation.turnCorrelationId)), 'the turn id must not appear in the durable record');
});

test('S3: invalid observation canonicalization (non-NFC material) is rejected', () => {
  const env = makeS3Env();
  const nonNfc = makeNonNfcObservation();
  const result = produceExecutionOutcome(env.input({ observation: nonNfc }));
  const failed = failedOf(result);
  assert.equal(failed.category, 'OUTCOME-INPUT-INVALID');
  assert.equal(failed.code, 'input.observation-canonicalization');
  assert.equal(env.outcomePublishCount(), 0);
});

test('S3: wrong/mismatched enforcement evidence is rejected (genuine fingerprint + exact plan identity)', () => {
  const env = makeS3Env();
  const tamperedFingerprint = { ...env.enforcement, evidenceFingerprint: 'sha-256:' + '1'.repeat(64) };
  const r1 = failedOf(produceExecutionOutcome(env.input({ enforcement: tamperedFingerprint })));
  assert.equal(r1.category, 'OUTCOME-INPUT-INVALID');
  assert.equal(r1.code, 'input.enforcement-correlation');
  const tamperedPlanIdentity = { ...env.enforcement, inputPlanIdentity: 'sha-256:' + '2'.repeat(64) };
  const r2 = failedOf(produceExecutionOutcome(env.input({ enforcement: tamperedPlanIdentity })));
  assert.equal(r2.code, 'input.enforcement-correlation');
  // Malformed enforcement shape (missing required canonical members).
  const malformed = { ...env.enforcement, authorityInputIdentities: undefined } as never;
  const r3 = failedOf(produceExecutionOutcome(env.input({ enforcement: malformed })));
  assert.equal(r3.code, 'input.enforcement-correlation');
  assert.equal(env.outcomePublishCount(), 0);
});

test('S3: partial result association (handoff without ValidationRecord) is rejected', () => {
  const env = makeS3Env();
  const result = produceExecutionOutcome(env.input({ validation: undefined }));
  const failed = failedOf(result);
  assert.equal(failed.category, 'OUTCOME-INPUT-INVALID');
  assert.equal(failed.code, 'input.validation-missing');
  assert.equal(env.outcomePublishCount(), 0);
});

test('S3: handoff without a passing ValidationRecord is rejected', () => {
  const env = makeS3Env();
  const failing = { ...env.validation, structural_outcome: 'fail' };
  const result = produceExecutionOutcome(env.input({ validation: failing }));
  const failed = failedOf(result);
  assert.equal(failed.category, 'OUTCOME-INPUT-INVALID');
  assert.equal(failed.code, 'input.validation-invalid');
  assert.equal(env.outcomePublishCount(), 0);
});

test('S3: ValidationRecord for wrong instance/digest/workspace is rejected', () => {
  const env = makeS3Env();
  const subject = env.validation['subject'] as Readonly<Record<string, unknown>>;
  const wrongInstance = { ...env.validation, subject: { ...subject, instance_id: 'pgw:i:' + 'd'.repeat(32) } };
  const r1 = failedOf(produceExecutionOutcome(env.input({ validation: wrongInstance })));
  assert.equal(r1.code, 'input.validation-mismatch');
  const wrongDigest = { ...env.validation, subject: { ...subject, digest: 'sha-256:' + '0'.repeat(64) } };
  const r2 = failedOf(produceExecutionOutcome(env.input({ validation: wrongDigest })));
  assert.equal(r2.code, 'input.validation-mismatch');
  const wrongWorkspace = { ...env.validation, subject: { ...subject, workspace_id: 'pgw:w:' + 'e'.repeat(32) } };
  const r3 = failedOf(produceExecutionOutcome(env.input({ validation: wrongWorkspace })));
  assert.equal(r3.code, 'input.validation-mismatch');
  assert.equal(env.outcomePublishCount(), 0);
});

test('S3: the result association is built from the trusted handoff, never from the project-visible result file', () => {
  const env = makeS3Env();
  // The project-visible result artifact is deleted before production; the
  // durable quartet must still come out byte-identical to the handoff.
  rmSync(join(env.root, 'results', OCCURRENCE_ID, ATTEMPT_ID), { recursive: true, force: true });
  const produced = producedOf(produceExecutionOutcome(env.input()));
  const record = env.outcomeRecords()[0]!;
  const ra = record['result_association'] as Readonly<Record<string, unknown>>;
  assert.equal(ra['instance_id'], env.handoff.resultInstanceId);
  assert.equal(ra['revision_digest'], env.handoff.resultDigest);
  assert.equal(ra['association_mode'], env.handoff.associationMode);
  assert.equal(ra['validation_record_id'], env.handoff.validationRecordId);
  assert.equal(produced.recordId, record['record_id']);
});

// ─── §18 Model-1 lock ───────────────────────────────────────────────────────

test('S3: outcome and WP-13C derive byte-for-byte the SAME decision key for the same attempt', () => {
  const env = makeS3Env();
  const outcomeKeys: string[] = [];
  const outcomeCoordinator = {
    withLock<T>(key: string, fn: () => T): T {
      outcomeKeys.push(key);
      return fn();
    },
  };
  const first = producedOf(produceExecutionOutcome(env.input({ coordinate: outcomeCoordinator })));
  assert.equal(first.outcome, 'published');
  const publicationKeys: string[] = [];
  const publicationCoordinator = {
    withLock<T>(key: string, fn: () => T): T {
      publicationKeys.push(key);
      return fn();
    },
  };
  const pub = publishValidatedResult(env.pubInput({ coordinate: publicationCoordinator }));
  assert.equal(pub.ok, true, JSON.stringify(pub));
  assert.equal(outcomeKeys.length, 1);
  assert.equal(publicationKeys.length, 1);
  assert.equal(outcomeKeys[0], publicationKeys[0], 'outcome and publication must resolve the SAME attempt coordination key');
  assert.equal(outcomeKeys[0], envKey(env), 'the shared pure key derivation is pinned');
});

test('S3: the outcome lock is held through the re-read and the write, and released completely before return', () => {
  const env = makeS3Env();
  const coordinate = createProcessLocalCoordinator();
  const key = envKey(env);
  let lockHeldAtWrite = false;
  let nestedAcquired = false;
  const result = produceExecutionOutcome(env.input({
    coordinate,
    hooks: {
      beforeFirstOutcomePublication() {
        try {
          coordinate.withLock(key, () => {
            nestedAcquired = true;
          });
          lockHeldAtWrite = false;
        } catch (err) {
          lockHeldAtWrite = err instanceof LockContentionError;
        }
      },
    },
  }));
  const produced = producedOf(result);
  assert.equal(produced.outcome, 'published');
  assert.equal(lockHeldAtWrite, true, 'the attempt lock must be held when the no-existing branch runs');
  assert.equal(nestedAcquired, false, 'nested acquisition of the same key must never occur');
  // The lock is fully released after produce returns.
  let released = false;
  coordinate.withLock(key, () => {
    released = true;
  });
  assert.equal(released, true, 'the outcome lock must be released completely before WP-13C begins');
});

test('S3: composition never calls WP-13C while the outcome lock is held (nested publication fails closed)', () => {
  const env = makeS3Env();
  const coordinate = createProcessLocalCoordinator();
  let nestedPublication: unknown;
  const result = produceExecutionOutcome(env.input({
    coordinate,
    hooks: {
      beforeFirstOutcomePublication() {
        nestedPublication = publishValidatedResult(env.pubInput({ coordinate }));
      },
    },
  }));
  const produced = producedOf(result);
  assert.equal(produced.outcome, 'published');
  assert.ok(nestedPublication !== undefined);
  const nested = nestedPublication as { readonly ok: boolean; readonly category?: string; readonly code?: string };
  assert.equal(nested.ok, false, 'WP-13C must never run inside the held outcome lock');
  if (!nested.ok) {
    assert.equal(nested.category, 'PUBLICATION-LOCK-CONFLICT');
    assert.equal(nested.code, 'lock.conflict');
  }
});

test('S3: production ordering — outcome operation releases its lock before WP-13C publishes', () => {
  const env = makeS3Env();
  const coordinate = createProcessLocalCoordinator();
  const produced = producedOf(produceExecutionOutcome(env.input({ coordinate })));
  assert.equal(produced.outcome, 'published');
  // WP-13C immediately after, SAME coordinator, SAME attempt key: no
  // contention proves the outcome lock was fully released (Model-1 step 6).
  const pub = publishValidatedResult(env.pubInput({ coordinate }));
  assert.equal(pub.ok, true, JSON.stringify(pub));
  if (pub.ok) assert.equal(pub.outcome, 'published');
  // The outcome precondition is satisfied by the produced durable record.
  assert.equal(env.outcomeRecords().length, 1);
});

test('S3: concurrent exact outcome callers — one creates, the later caller replays the exact material', () => {
  const env = makeS3Env();
  const coordinate = createProcessLocalCoordinator();
  const first = producedOf(produceExecutionOutcome(env.input({ coordinate, identity: makeCountingOutcomeIdentity() })));
  assert.equal(first.outcome, 'published');
  const counting = makeCountingOutcomeIdentity();
  const second = producedOf(produceExecutionOutcome(env.input({ coordinate, identity: counting })));
  assert.equal(second.outcome, 'replayed');
  assert.equal(second.recordId, first.recordId);
  assert.equal(second.evidenceId, first.evidenceId);
  assert.equal(counting.calls.recordId, 0, 'replay must not allocate a record id');
  assert.equal(counting.calls.evidenceId, 0, 'replay must not allocate an evidence id');
  assert.equal(counting.calls.now, 0, 'replay must not obtain a timestamp');
  assert.equal(env.outcomePublishCount(), 1, 'only the first caller writes');
});

test('S3: concurrent divergent callers — the first valid durable outcome wins; the later caller conflicts', () => {
  const env = makeS3Env();
  const coordinate = createProcessLocalCoordinator();
  const first = producedOf(produceExecutionOutcome(env.input({ coordinate })));
  assert.equal(first.outcome, 'published');
  const second = produceExecutionOutcome(env.input({ coordinate, identity: makeThrowingOutcomeIdentity(), outcome: makeOutcome('failed') }));
  const failed = failedOf(second);
  assert.equal(failed.category, 'OUTCOME-CONFLICT');
  assert.equal(failed.code, 'conflict.material-divergence');
  assert.equal(env.outcomePublishCount(), 1, 'the divergent caller must not write');
  assert.equal(env.outcomeRecords().length, 1);
});

test('S3: different attempts use independent keys and independent outcome records', () => {
  const env = makeS3Env();
  const OTHER_ATTEMPT = 'pgw:a:' + '9'.repeat(32);
  const OTHER_ATTEMPT_RECORD_ID = 'pgw:l:' + 'a'.repeat(32);
  seedPayload(env.store, 'execution-attempt-record', buildExecutionAttemptRecordPayload({
    recordId: OTHER_ATTEMPT_RECORD_ID,
    createdAt: FIXED_NOW,
    activationRecordId: ACTIVATION_RECORD_ID,
    occurrenceId: OCCURRENCE_ID,
    attemptId: OTHER_ATTEMPT,
    ordinal: 2,
    bundle: env.chain.bundleReference,
    workspaceId: WS_A,
    runtimeGrantId: GRANT_ID,
    registry: env.registryCtx,
  }));
  const attemptB = env.store.readLifecyclePayload('execution-attempt-record', OTHER_ATTEMPT_RECORD_ID);
  if (!attemptB.ok || attemptB.payload === undefined) throw new Error('attempt B unreadable');
  const observationB = makeObservationFor(OCCURRENCE_ID, OTHER_ATTEMPT);
  const sharedIdentity = makeCountingOutcomeIdentity();
  const first = producedOf(produceExecutionOutcome(env.input({ identity: sharedIdentity })));
  const second = producedOf(produceExecutionOutcome(env.input({
    attempt: attemptB.payload,
    observation: observationB,
    enforcement: undefined,
    handoff: undefined,
    validation: undefined,
    identity: sharedIdentity,
  })));
  assert.equal(second.outcome, 'published');
  assert.notEqual(second.recordId, first.recordId);
  assert.equal(env.outcomeRecords().length, 2, 'each attempt gets its own outcome record');
  const keyA = envKey(env);
  const bundle = attemptB.payload['bundle'] as Readonly<Record<string, unknown>>;
  const keyB = attemptCoordinationKey({
    workspaceId: WS_A,
    bundleInstanceId: String(bundle['target_instance_id']),
    bundleRevisionId: String(bundle['target_revision_id']),
    bundleDigest: String(bundle['target_digest']),
    occurrenceId: OCCURRENCE_ID,
    attemptId: OTHER_ATTEMPT,
  });
  assert.notEqual(keyA, keyB, 'different attempts must use independent coordination keys');
});
