/**
 * WP-13 durability S2 — outcome-recorder authority boundary tests.
 *
 * Proves the capability / exact-record permit / narrow one-class store
 * boundary / read surface / domain separation of the
 * `trusted-execution-outcome-recorder` authority against a REAL WP-8 store
 * (wp12-helpers integration environment).
 *
 * S2 scope only: no eligibility decision, no outcome construction, no
 * evidence/record-id allocation policy, no attempt lock, no replay/conflict
 * (S3). An already-constructed schema-valid ExecutionOutcomeRecord fixture
 * payload is used to exercise the authority plumbing.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupTestEnvs, makeIntegrationEnv, WRITE_ACTION, UID, WS_A } from './wp12-helpers.js';
import { defaultLimitProfile } from '../../src/storage/limits/limits.js';
import { computePayloadDigest } from '../../src/storage/format/envelope.js';
import { enumerateClass, readRecord } from '../../src/storage/read/index.js';
import { createSchemaRegistry } from '../../src/api/validate.js';
import { createOutcomeStoreBoundary } from '../../src/outcome/index.js';
import {
  createExecutionOutcomeCapability,
  createExecutionOutcomePermit,
  isGenuineExecutionOutcomeCapability,
  isGenuineExecutionOutcomePermit,
  executionOutcomePermitLive,
  type ExecutionOutcomeCapability,
  type ExecutionOutcomePermit,
} from '../../src/outcome/capability.js';
import {
  createResultPublicationCapability,
  createResultPublicationPermit,
  isGenuineResultPublicationCapability,
  isGenuineResultPublicationPermit,
} from '../../src/publication/capability.js';
import { createPublicationStoreBoundary } from '../../src/publication/index.js';
import type { OutcomeStoreBoundary } from '../../src/outcome/types.js';

const REG = {
  registry_protocol_id: 'project-gateway.registry',
  registry_snapshot_format_version: '1.0',
  registry_snapshot_id: 'pgw:g:3fb51a11f2b23ba8c171326cbba7eb64',
  registry_snapshot_digest: 'sha-256:613112612ee7803db00c6e51826b3a63ee6ce6732b17c9b09ae8aff00db47c05',
  protocol_compatibility: { mode: 'exact-release', artifact_protocol_id: 'project-gateway.artifact', artifact_protocol_version: '1.0' },
};
const BUNDLE = {
  target_protocol_version: '1.0',
  target_kind: { id: 'ExecutionBundle', version: '1.0' },
  target_instance_id: 'pgw:i:064ee0ce2bdeee0073c6d64e93b9fb60',
  target_revision_id: 'pgw:r:c55e6e260130dc58d95c600ee51db65d',
  target_digest: 'sha-256:9a59a420a06f5e00f9529708918a2b9289bcb832aa8a4c983884520f5d6be3d7',
  target_workspace_binding: { mode: 'bound', workspace_id: WS_A },
};
const OBS = {
  kind: 'external-evidence',
  evidence_id: 'pgw:e:0123456789abcdef0123456789abcdef',
  content_digest: 'sha-256:3333333333333333333333333333333333333333333333333333333333333333',
  declared_media_type: 'application/json',
  observation_role: 'evaluation-evidence',
};
const ASSOC = {
  instance_id: 'pgw:i:8b13ff16e5e2ab55f9545ce171fdfb7c',
  revision_digest: 'sha-256:551a37acb15610ce49f4ad0d23743710f5f9c1a29fec423cf5b0a414c4611500',
  association_mode: 'adopted',
  validation_record_id: 'pgw:l:595fcd28f93b03437b2d8eff4873b06c',
};

const ROOTS: string[] = [];

function outcomePayload(recordId = 'pgw:l:0a1b2c3d4e5f60718293a4b5c6d7e8f9', overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    record_type: 'ExecutionOutcomeRecord',
    record_id: recordId,
    created_at: '2026-08-04T06:01:00.000Z',
    responsible_role: 'trusted-execution-outcome-recorder',
    registry_snapshot_reference: REG,
    workspace_id: WS_A,
    bundle: BUNDLE,
    occurrence_id: 'pgw:o:07afc217d096ca56baa8fe7441667a7a',
    attempt_id: 'pgw:a:b17466cc359d45120cf977b1c506ab81',
    ordinal: 1,
    execution_attempt_record_id: 'pgw:l:189380433be2769e15623682895a5acd',
    disposition: 'completed',
    observation_evidence: OBS,
    result_association: ASSOC,
    ...overrides,
  });
}

interface S2Env {
  readonly integration: ReturnType<typeof makeIntegrationEnv>;
  readonly boundary: OutcomeStoreBoundary;
  readonly capability: ExecutionOutcomeCapability;
  readonly registry: ReturnType<typeof createSchemaRegistry>;
  /** Publish one exact record through the real boundary; returns the permit used. */
  publish(payload?: Readonly<Record<string, unknown>>, permit?: ExecutionOutcomePermit): ReturnType<OutcomeStoreBoundary['publishExactOutcomeRecord']>;
  permitFor(payload: Readonly<Record<string, unknown>>): ExecutionOutcomePermit | undefined;
  outcomeRecords(): string[];
  publicationRecords(): string[];
}

function makeEnv(): S2Env {
  const integration = makeIntegrationEnv();
  const registry = createSchemaRegistry();
  const boundary = createOutcomeStoreBoundary({
    trustedConfiguration: integration.storeEnv.config,
    bootstrapInput: integration.storeEnv.bootstrapInput,
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
    schemaRegistry: registry,
  });
  const capability = createExecutionOutcomeCapability({
    trustedConfiguration: integration.storeEnv.config,
    actionIdentity: 'execution-outcome-recording-action-1',
  });
  if (capability === undefined) throw new Error('outcome capability minting failed');
  return {
    integration,
    boundary,
    capability,
    registry,
    permitFor(payload) {
      const digest = computePayloadDigest(payload);
      return createExecutionOutcomePermit({
        capability,
        role: 'execution-outcome-recording',
        recordId: String(payload['record_id']),
        recordDigest: digest,
        canonicalBytesDigest: digest,
      });
    },
    publish(payload = outcomePayload(), permit) {
      const p = permit ?? this.permitFor(payload);
      if (p === undefined) throw new Error('permit minting failed in test harness');
      return this.boundary.publishExactOutcomeRecord(p, payload);
    },
    outcomeRecords() {
      const result = enumerateClass({
        trustedConfiguration: integration.storeEnv.config,
        trustedInput: integration.storeEnv.bootstrapInput,
        recordClass: 'execution-outcome-record',
      });
      return result.ok ? result.items.map((i) => i.recordId).filter((id): id is string => id !== undefined) : [];
    },
    publicationRecords() {
      const result = enumerateClass({
        trustedConfiguration: integration.storeEnv.config,
        trustedInput: integration.storeEnv.bootstrapInput,
        recordClass: 'result-publication-record',
      });
      return result.ok ? result.items.map((i) => i.recordId).filter((id): id is string => id !== undefined) : [];
    },
  };
}

after(() => {
  cleanupTestEnvs();
  for (const root of ROOTS.splice(0)) rmSync(root, { recursive: true, force: true });
});

// ─── capability ─────────────────────────────────────────────────────────────

test('S2: valid capability mint/use; sibling capabilities share the generation and stay valid', () => {
  const env = makeEnv();
  assert.deepEqual(env.capability.verify(), { ok: true });
  const sibling = createExecutionOutcomeCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'execution-outcome-recording-action-2' });
  assert.ok(sibling !== undefined);
  assert.deepEqual(sibling!.verify(), { ok: true });
  // minting B never invalidates A (corrected generation semantics)
  assert.deepEqual(env.capability.verify(), { ok: true });
  // both capabilities are usable for publication
  const a = env.publish();
  assert.equal(a.ok, true);
  const second = outcomePayload('pgw:l:0a2b2c3d4e5f60718293a4b5c6d7e8f9');
  const digest = computePayloadDigest(second);
  const permitB = createExecutionOutcomePermit({ capability: sibling!, role: 'execution-outcome-recording', recordId: 'pgw:l:0a2b2c3d4e5f60718293a4b5c6d7e8f9', recordDigest: digest, canonicalBytesDigest: digest });
  assert.ok(permitB !== undefined);
  const b = env.boundary.publishExactOutcomeRecord(permitB, second);
  assert.equal(b.ok, true);
  assert.equal(env.outcomeRecords().length, 2);
});

test('S2: disposing one capability invalidates only that capability, not its siblings', () => {
  const env = makeEnv();
  const cap2 = createExecutionOutcomeCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'execution-outcome-recording-action-2' });
  assert.ok(cap2 !== undefined);
  cap2!.dispose();
  assert.deepEqual(cap2!.verify(), { ok: false, reason: 'disposed' });
  assert.deepEqual(env.capability.verify(), { ok: true });
  // the disposed capability can no longer mint permits
  const digest = computePayloadDigest(outcomePayload());
  const permit = createExecutionOutcomePermit({ capability: cap2!, role: 'execution-outcome-recording', recordId: 'pgw:l:0a1b2c3d4e5f60718293a4b5c6d7e8f9', recordDigest: digest, canonicalBytesDigest: digest });
  assert.equal(permit, undefined);
  // the sibling still publishes
  const result = env.publish();
  assert.equal(result.ok, true);
});

test('S2: genuine trusted-configuration replacement advances the generation; old capabilities go stale', () => {
  const env = makeEnv();
  assert.equal(env.publish().ok, true);
  const replacement = makeIntegrationEnv();
  assert.notEqual(replacement.storeEnv.config.identity, env.integration.storeEnv.config.identity);
  const capB = createExecutionOutcomeCapability({ trustedConfiguration: replacement.storeEnv.config, actionIdentity: 'execution-outcome-recording-action-replacement' });
  assert.ok(capB !== undefined);
  assert.deepEqual(env.capability.verify(), { ok: false, reason: 'stale-generation' });
  assert.deepEqual(capB!.verify(), { ok: true });
  // a permit minted under the old capability is unusable at the sink
  const payload = outcomePayload();
  const digest = computePayloadDigest(payload);
  const stalePermit = createExecutionOutcomePermit({ capability: env.capability, role: 'execution-outcome-recording', recordId: String(payload['record_id']), recordDigest: digest, canonicalBytesDigest: digest });
  assert.equal(stalePermit, undefined);
});

test('S2: forged / spread-cloned / detached / serialized capabilities fail closed', () => {
  const env = makeEnv();
  const forged = { ...env.capability };
  assert.equal(isGenuineExecutionOutcomeCapability(forged), false);
  assert.deepEqual((forged as unknown as ExecutionOutcomeCapability).verify(), { ok: false, reason: 'not-genuine' });
  // JSON serialization round-trip cannot recreate authority
  const serialized = JSON.parse(JSON.stringify(env.capability));
  assert.equal(isGenuineExecutionOutcomeCapability(serialized), false);
  // detached-method replay (CAP-015): the brand must be carried by the receiver
  const detached = { binding: env.capability.binding, verify: env.capability.verify, dispose: env.capability.dispose };
  assert.equal(isGenuineExecutionOutcomeCapability(detached), false);
  assert.deepEqual((detached as unknown as ExecutionOutcomeCapability).verify(), { ok: false, reason: 'not-genuine' });
  // a fabricated non-object fails closed
  assert.equal(isGenuineExecutionOutcomeCapability({ binding: {} }), false);
  assert.equal(isGenuineExecutionOutcomeCapability(undefined), false);
});

// ─── permit ─────────────────────────────────────────────────────────────────

test('S2: exact permit binds the complete record; any material change breaks the binding', () => {
  const env = makeEnv();
  const base = outcomePayload();
  const digest = computePayloadDigest(base);
  const permit = createExecutionOutcomePermit({ capability: env.capability, role: 'execution-outcome-recording', recordId: String(base['record_id']), recordDigest: digest, canonicalBytesDigest: digest });
  assert.ok(permit !== undefined);
  assert.equal(executionOutcomePermitLive(permit!), true);
  // exact record publishes
  const ok = env.boundary.publishExactOutcomeRecord(permit, base);
  assert.equal(ok.ok, true);
  // changed record id → identity mismatch
  const idChanged = outcomePayload('pgw:l:0a3b2c3d4e5f60718293a4b5c6d7e8f9');
  const r1 = env.boundary.publishExactOutcomeRecord(permit, idChanged);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.code, 'record.identity-mismatch');
  // changed disposition / observation evidence / result association / bindings → digest mismatch
  for (const [label, overrides] of [
    ['disposition', { disposition: 'crashed' }],
    ['observation evidence', { observation_evidence: { ...OBS, evidence_id: 'pgw:e:' + 'f'.repeat(32) } }],
    ['result association', { result_association: { ...ASSOC, association_mode: 'originated' } }],
    ['attempt binding', { attempt_id: 'pgw:a:0b90b90b90b90b90b90b90b90b90b90b' }],
    ['bundle binding', { bundle: { ...BUNDLE, target_revision_id: 'pgw:r:0b70b70b70b70b70b70b70b70b70b70b' } }],
  ] as [string, Readonly<Record<string, unknown>>][]) {
    const changed = outcomePayload(String(base['record_id']), overrides);
    const r = env.boundary.publishExactOutcomeRecord(permit, changed);
    assert.equal(r.ok, false, `${label} change must be rejected`);
    if (!r.ok) assert.equal(r.code, 'record.digest-mismatch', label);
  }
  // wrong record class → class mismatch
  const wrongClass = { ...base, record_type: 'ResultPublicationRecord' };
  const r2 = env.boundary.publishExactOutcomeRecord(permit, wrongClass);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.code, 'record.class-mismatch');
  // exactly one durable record after all rejections
  assert.equal(env.outcomeRecords().length, 1);
});

test('S2: permits from another authority domain never mint; foreign permits never pass the sink', () => {
  const env = makeEnv();
  const payload = outcomePayload();
  const digest = computePayloadDigest(payload);
  // a result-publication capability cannot mint an outcome permit
  const pubCap = createResultPublicationCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'result-publication-action-x' });
  assert.ok(pubCap !== undefined);
  const foreignPermit = createExecutionOutcomePermit({ capability: pubCap!, role: 'execution-outcome-recording', recordId: String(payload['record_id']), recordDigest: digest, canonicalBytesDigest: digest });
  assert.equal(foreignPermit, undefined);
  // a genuine result-publication permit cannot pass the outcome sink
  const pubPermit = createResultPublicationPermit({ capability: pubCap!, role: 'result-publication', recordId: 'pgw:l:0f86561945fd788cb719f2d5b8e81ccd', recordDigest: digest, canonicalBytesDigest: digest });
  assert.ok(pubPermit !== undefined);
  const r = env.boundary.publishExactOutcomeRecord(pubPermit, payload);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'permit.not-genuine');
  // a disposed outcome permit fails closed
  const permit = createExecutionOutcomePermit({ capability: env.capability, role: 'execution-outcome-recording', recordId: String(payload['record_id']), recordDigest: digest, canonicalBytesDigest: digest });
  assert.ok(permit !== undefined);
  permit!.dispose();
  const r2 = env.boundary.publishExactOutcomeRecord(permit, payload);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.code, 'permit.disposed');
});

// ─── store boundary ─────────────────────────────────────────────────────────

test('S2: valid capability + exact permit + exact valid record reaches WP-8 publication durably', () => {
  const env = makeEnv();
  const payload = outcomePayload();
  const result = env.publish(payload);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.outcome, 'published');
    assert.equal(result.recordId, String(payload['record_id']));
    assert.ok(/^sha-256:[0-9a-f]{64}$/.test(result.recordDigest), 'WP-8 must return the stored record digest');
  }
  // the record is durably readable through WP-8 read primitives
  assert.deepEqual(env.outcomeRecords(), [String(payload['record_id'])]);
  const read = readRecord({ trustedConfiguration: env.integration.storeEnv.config, trustedInput: env.integration.storeEnv.bootstrapInput, recordClass: 'execution-outcome-record', recordId: String(payload['record_id']) });
  assert.equal(read.ok, true);
  if (read.ok && result.ok) assert.equal(read.digest, result.recordDigest, 'the boundary must report the durable record digest');
  // publishing the exact same record again is WP-8 idempotent-duplicate (substrate semantics preserved)
  const again = env.publish(payload);
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.outcome, 'idempotent-duplicate');
  assert.equal(env.outcomeRecords().length, 1);
});

test('S2: authorized-write audit remains produced by WP-8 (D-6)', () => {
  const env = makeEnv();
  const result = env.publish();
  assert.equal(result.ok, true);
  const audit = enumerateClass({
    trustedConfiguration: env.integration.storeEnv.config,
    trustedInput: env.integration.storeEnv.bootstrapInput,
    recordClass: 'authoritative-audit-event',
  });
  assert.equal(audit.ok, true);
  assert.ok((audit.items ?? []).length >= 1, 'WP-8 must produce the mechanical authorized-write audit event');
});

test('S2: no capability / forged capability / stale capability → no write', () => {
  const env = makeEnv();
  const payload = outcomePayload();
  // forged permit object
  const forgedPermit = { binding: { recordId: String(payload['record_id']), recordDigest: 'sha-256:' + '0'.repeat(64) } };
  const r1 = env.boundary.publishExactOutcomeRecord(forgedPermit, payload);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.code, 'permit.not-genuine');
  // no capability at all: permit mint fails closed
  const digest = computePayloadDigest(payload);
  const noCap = createExecutionOutcomePermit({ capability: undefined, role: 'execution-outcome-recording', recordId: String(payload['record_id']), recordDigest: digest, canonicalBytesDigest: digest });
  assert.equal(noCap, undefined);
  assert.equal(env.outcomeRecords().length, 0);
});

test('S2: stale-generation capability is rejected at the sink even with a pre-replacement permit', () => {
  const env = makeEnv();
  const payload = outcomePayload();
  const digest = computePayloadDigest(payload);
  const permit = createExecutionOutcomePermit({ capability: env.capability, role: 'execution-outcome-recording', recordId: String(payload['record_id']), recordDigest: digest, canonicalBytesDigest: digest });
  assert.ok(permit !== undefined);
  // genuine configuration replacement ADVANCES the outcome-recorder
  // generation only once a mint under the replacement configuration arrives
  const replacement = makeIntegrationEnv();
  const capB = createExecutionOutcomeCapability({ trustedConfiguration: replacement.storeEnv.config, actionIdentity: 'execution-outcome-recording-action-replacement' });
  assert.ok(capB !== undefined);
  assert.deepEqual(env.capability.verify(), { ok: false, reason: 'stale-generation' });
  const r = env.boundary.publishExactOutcomeRecord(permit, payload);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.category, 'OUTCOME-CAPABILITY-DENIED');
    assert.equal(r.code, 'capability.stale-generation');
  }
  assert.equal(env.outcomeRecords().length, 0);
});

test('S2: structurally invalid record is rejected by the committed schema gate before any write', () => {
  const env = makeEnv();
  // a JCS-serializable, schema-invalid payload (raw session id in evidence_id)
  const invalid = outcomePayload('pgw:l:0a4b2c3d4e5f60718293a4b5c6d7e8f9', {
    observation_evidence: { ...OBS, evidence_id: 'sess-1/turn:0' },
  });
  const digest = computePayloadDigest(invalid);
  const permit = createExecutionOutcomePermit({ capability: env.capability, role: 'execution-outcome-recording', recordId: String(invalid['record_id']), recordDigest: digest, canonicalBytesDigest: digest });
  assert.ok(permit !== undefined);
  const r = env.boundary.publishExactOutcomeRecord(permit, invalid);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.category, 'OUTCOME-INPUT-INVALID');
    assert.equal(r.code, 'record.schema-invalid');
  }
  assert.equal(env.outcomeRecords().length, 0);
});

test('S2: WP-8 substrate failure propagates fail closed and writes nothing', () => {
  const env = makeEnv();
  const payload = outcomePayload();
  // A genuine WP-8 rejection: the store root is removed before the write.
  env.integration.storeEnv.remove();
  const result = env.publish(payload);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.category === 'OUTCOME-WRITE-FAILED' || result.category === 'OUTCOME-INTERNAL-FAILURE', result.category);
  }
  // nothing else was written by the boundary on the failure path
  assert.equal(env.outcomeRecords().length, 0);
});

// ─── read surface ───────────────────────────────────────────────────────────

test('S2: read surface — zero, one, and multiple verified candidates without winner selection', () => {
  const env = makeEnv();
  // zero
  let enumerated = env.boundary.enumerateLifecycleRecords('execution-outcome-record');
  assert.equal(enumerated.ok, true);
  if (enumerated.ok) assert.equal(enumerated.recordIds.length, 0);
  // one
  assert.equal(env.publish().ok, true);
  enumerated = env.boundary.enumerateLifecycleRecords('execution-outcome-record');
  assert.equal(enumerated.ok, true);
  if (enumerated.ok) assert.equal(enumerated.recordIds.length, 1);
  const read = env.boundary.readLifecyclePayload('execution-outcome-record', String(enumerated.ok ? enumerated.recordIds[0] : ''));
  assert.equal(read.ok, true);
  // multiple candidates: the boundary returns the verified set, never a winner
  assert.equal(env.publish(outcomePayload('pgw:l:0a5b2c3d4e5f60718293a4b5c6d7e8f9')).ok, true);
  assert.equal(env.publish(outcomePayload('pgw:l:0a6b2c3d4e5f60718293a4b5c6d7e8f9')).ok, true);
  enumerated = env.boundary.enumerateLifecycleRecords('execution-outcome-record');
  assert.equal(enumerated.ok, true);
  if (enumerated.ok) assert.equal(enumerated.recordIds.length, 3);
  // reads require no write capability and expose no write surface
  assert.equal(typeof env.boundary.publishExactOutcomeRecord, 'function');
  const missing = env.boundary.readLifecyclePayload('execution-outcome-record', 'pgw:l:' + 'e'.repeat(32));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, 'not-found');
  // read confinement: other classes are rejected
  const other = env.boundary.readLifecyclePayload('result-publication-record', 'pgw:l:' + 'f'.repeat(32));
  assert.equal(other.ok, false);
  const otherEnum = env.boundary.enumerateLifecycleRecords('execution-attempt-record');
  assert.equal(otherEnum.ok, false);
});

// ─── domain separation ──────────────────────────────────────────────────────

test('S2: result publisher cannot write outcomes; outcome recorder cannot write publications', () => {
  const env = makeEnv();
  // outcome capability + outcome permit through the OUTCOME boundary works
  assert.equal(env.publish().ok, true);
  // a result-publication permit cannot pass the outcome sink
  const outcomePayload2 = outcomePayload('pgw:l:0a7b2c3d4e5f60718293a4b5c6d7e8f9');
  const digest = computePayloadDigest(outcomePayload2);
  const pubCap = createResultPublicationCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'result-publication-action-y' });
  assert.ok(pubCap !== undefined);
  const pubPermit = createResultPublicationPermit({ capability: pubCap!, role: 'result-publication', recordId: String(outcomePayload2['record_id']), recordDigest: digest, canonicalBytesDigest: digest });
  assert.ok(pubPermit !== undefined);
  const r = env.boundary.publishExactOutcomeRecord(pubPermit, outcomePayload2);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'permit.not-genuine');
  // an outcome permit can never pass the result-publication sink
  const pubBoundary = createPublicationStoreBoundary({
    trustedConfiguration: env.integration.storeEnv.config,
    bootstrapInput: env.integration.storeEnv.bootstrapInput,
    writeAction: {
      actionIdentity: WRITE_ACTION,
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
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  const outcomePermit = env.permitFor(outcomePayload('pgw:l:0a8b2c3d4e5f60718293a4b5c6d7e8f9'));
  assert.ok(outcomePermit !== undefined);
  const pubPayload = {
    record_type: 'ResultPublicationRecord',
    record_id: 'pgw:l:0f86561945fd788cb719f2d5b8e81ccd',
    created_at: '2026-08-04T06:01:00.000Z',
    responsible_role: 'trusted-result-publisher',
    registry_snapshot_reference: REG,
    result_subject: { protocol_version: '1.0', kind: { id: 'ExecutionResult', version: '1.0' }, instance_id: ASSOC.instance_id, revision_id: 'pgw:r:66f1c853ded0e0f67d4392d6c8b792fa', digest: ASSOC.revision_digest, workspace_id: WS_A },
    evaluator_provenance: { evaluator_id: 'pgw:ev:f66fe624e4ae4057ca89caedf8daad41', capability_profile_id: 'pgw:cp:ccbd8effd83192143cfe9c362ca71584' },
    association_mode: 'adopted',
    validation_record_id: ASSOC.validation_record_id,
    bundle: BUNDLE,
    workspace_id: WS_A,
    occurrence_id: 'pgw:o:07afc217d096ca56baa8fe7441667a7a',
    attempt_id: 'pgw:a:b17466cc359d45120cf977b1c506ab81',
    publication_scopes: ['ordinary-review'],
    receipt_correlations: [],
  };
  const pubResult = pubBoundary.publishResultPublicationRecord(outcomePermit, pubPayload);
  assert.equal(pubResult.ok, false);
  assert.equal(env.publicationRecords().length, 0);
  // cross-domain capability rejection at mint time
  assert.equal(isGenuineResultPublicationCapability(env.capability), false);
  assert.equal(isGenuineExecutionOutcomeCapability(pubCap), false);
});

test('S2: domains have independent generations and configurations', () => {
  const env = makeEnv();
  const pubCap = createResultPublicationCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'result-publication-action-z' });
  assert.ok(pubCap !== undefined);
  // outcome capability usable
  assert.deepEqual(env.capability.verify(), { ok: true });
  assert.deepEqual(pubCap!.verify(), { ok: true });
  // genuine configuration replacement (a mint under the replacement identity
  // in EACH domain advances that domain's generation); the domains keep
  // SEPARATE generation registries — no shared generation namespace.
  const replacement = makeIntegrationEnv();
  const pubCapB = createResultPublicationCapability({ trustedConfiguration: replacement.storeEnv.config, actionIdentity: 'result-publication-action-replacement' });
  assert.ok(pubCapB !== undefined);
  const outcomeCapB = createExecutionOutcomeCapability({ trustedConfiguration: replacement.storeEnv.config, actionIdentity: 'execution-outcome-recording-action-replacement' });
  assert.ok(outcomeCapB !== undefined);
  assert.deepEqual(env.capability.verify(), { ok: false, reason: 'stale-generation' });
  assert.deepEqual(pubCap!.verify(), { ok: false, reason: 'stale-generation' });
  assert.deepEqual(pubCapB!.verify(), { ok: true });
  assert.deepEqual(outcomeCapB!.verify(), { ok: true });
  // a NEW mint in the outcome domain under the ORIGINAL configuration
  // identity cannot resurrect the old generation: the configuration
  // identity change is recorded per domain, and the outcome registry is
  // separate from the publication registry.
  const outcomeCapC = createExecutionOutcomeCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'execution-outcome-recording-action-c' });
  assert.ok(outcomeCapC !== undefined);
  assert.deepEqual(env.capability.verify(), { ok: false, reason: 'stale-generation' });
  // the publication domain's generation is untouched by the outcome mints
  assert.deepEqual(pubCapB!.verify(), { ok: true });
});
