/**
 * WP-12 Slice 4 — orchestrationDecision + recordExecutionAttempt REAL WP-8
 * STORE tests. Every test runs against an initialized genuine WP-8 store
 * with real publication, real mechanical write-audits, real
 * read/enumeration, exact byte-identity checks, crash injection, registry
 * recordability, the eight-class allowlist boundary, and zero project-file /
 * lock-layout mutation.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import { makeStoreBoundary } from './wp12-helpers.js';
import { buildRuntimeGrantPayload, buildActivationRecordPayload, buildExecutionOccurrenceRecordPayload, payloadDigestOf } from '../../src/control-plane/records.js';
import { inspectAuditHistory, enumerateClass } from '../../src/storage/read/index.js';
import {
  cleanupTestEnvs,
  grantChainSubjects,
  makeAttemptKit,
  makeContext,
  makeEvidence,
  makeIdentitySource,
  makeIntegrationEnv,
  makeRegistryContext,
  registryEchoOperand,
  seedActivatedOccurrence,
  seedFullGrantChain,
  seedRawRecord,
  WS_A,
} from './wp12-helpers.js';
import type { AcceptedRegistryContext, ConsumerSupportDeclaration } from '../../src/api/types.js';
import type { ControlPlaneStoreBoundary, ControlPlaneTrustedContext } from '../../src/control-plane/types.js';

after(() => cleanupTestEnvs());

const REGISTRY = makeRegistryContext();
const ECHO = registryEchoOperand();
const FIXED_NOW = '2026-08-04T06:00:00.000Z';
const BUNDLE = grantChainSubjects().bundle;

const DEFAULT_CONSUMER_SUPPORT: ConsumerSupportDeclaration = Object.freeze({
  consumerId: 'test-consumer',
  supportedProtocolFeatures: [],
  supportedConsumerCapabilities: ['project-gateway.workspace-read'],
  supportedExtensionNamespaces: [],
});

function orchestrateOperand(occurrenceId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { operation: 'orchestrationDecision', workspaceId: WS_A, registryEcho: ECHO, reservedOccurrenceId: occurrenceId, ...overrides };
}

function attemptOperand(occurrenceId: string, ordinal: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { operation: 'recordExecutionAttempt', workspaceId: WS_A, registryEcho: ECHO, reservedOccurrenceId: occurrenceId, ordinal, ...overrides };
}

interface AttemptEnv {
  readonly integration: ReturnType<typeof makeIntegrationEnv>;
  readonly identity: ReturnType<typeof makeIdentitySource>;
  readonly kit: ReturnType<typeof makeAttemptKit>;
  readonly seed: ReturnType<typeof seedActivatedOccurrence>;
}

/** Full genuine chain + grant + accepted activation + occurrence (real command flow). */
function attemptEnv(): AttemptEnv {
  const integration = makeIntegrationEnv();
  const identity = makeIdentitySource();
  const kit = makeAttemptKit(WS_A);
  const seed = seedActivatedOccurrence(integration.storeEnv, identity, WS_A, kit);
  return { integration, identity, kit, seed };
}

function attemptContext(env: AttemptEnv, overrides: { readonly store?: ControlPlaneStoreBoundary; readonly identity?: ReturnType<typeof makeIdentitySource> } = {}): ControlPlaneTrustedContext {
  return makeContext(env.integration.storeEnv, {
    store: overrides.store ?? makeStoreBoundary(env.integration.storeEnv),
    identity: overrides.identity ?? env.identity,
    executionRecorderRole: true,
    consumerSupport: DEFAULT_CONSUMER_SUPPORT,
    subjectArtifact: env.kit.bundle.artifact,
    policyEvidence: env.kit.policy.artifact,
  });
}

function countClass(integration: ReturnType<typeof makeIntegrationEnv>, recordClass: string): number {
  const result = enumerateClass({
    trustedConfiguration: integration.storeEnv.config,
    trustedInput: integration.storeEnv.bootstrapInput,
    recordClass: recordClass as never,
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  return result.items.length;
}

function readTarget(integration: ReturnType<typeof makeIntegrationEnv>, recordClass: string, recordId: string): Record<string, unknown> {
  const boundary = makeStoreBoundary(integration.storeEnv);
  const read = boundary.readLifecyclePayload(recordClass as never, recordId);
  assert.equal(read.ok, true, `${recordClass} ${recordId} must exist`);
  return read.payload as Record<string, unknown>;
}

function assertMechanicalAudit(env: AttemptEnv, recordClass: string, recordId: string): void {
  const history = inspectAuditHistory({
    trustedConfiguration: env.integration.storeEnv.config,
    trustedInput: env.integration.storeEnv.bootstrapInput,
    recordClass: recordClass as never,
    recordId,
  });
  assert.equal(history.ok, true, JSON.stringify(history.findings));
  assert.equal(history.originalAuthorizedWrite?.present, true, `mechanical authorized-write audit must exist for ${recordClass}`);
}

// ─── happy path + audit ─────────────────────────────────────────────────────

test('real store: recordExecutionAttempt publishes exactly one attempt record + one mechanical audit; exact bindings', () => {
  const env = attemptEnv();
  const context = attemptContext(env);
  const result = executeSlice1Command(attemptOperand(env.seed.reservedOccurrenceId, 1), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.outcome, 'attempt-recorded');
  assert.equal(result.evidence.ordinal, 1);
  assert.match(result.evidence.attemptId!, /^pgw:a:[0-9a-f]{32}$/, 'internally allocated attempt identity');
  assert.equal(countClass(env.integration, 'execution-attempt-record'), 1, 'exactly one attempt record');
  const stored = readTarget(env.integration, 'execution-attempt-record', result.evidence.recordId);
  assert.equal(stored['record_type'], 'ExecutionAttemptRecord');
  assert.equal(stored['responsible_role'], 'trusted-execution-recorder');
  assert.equal(stored['occurrence_id'], env.seed.reservedOccurrenceId);
  assert.equal(stored['activation_record_id'], env.seed.activationRecordId);
  assert.equal(stored['runtime_grant_id'], env.seed.grantId);
  assert.equal(stored['ordinal'], 1);
  assert.equal(stored['workspace_id'], WS_A);
  const occurrence = readTarget(env.integration, 'execution-occurrence-record', env.seed.occurrenceRecordId);
  assert.equal(payloadDigestOf(stored['bundle'] as Record<string, unknown>), payloadDigestOf(occurrence['bundle'] as Record<string, unknown>), 'byte-identical bundle reference');
  assert.equal((stored['registry_snapshot_reference'] as Record<string, unknown>)['registry_snapshot_id'], REGISTRY.registrySnapshotId);
  assertMechanicalAudit(env, 'execution-attempt-record', result.evidence.recordId);
});

test('real store: orchestrationDecision produces zero records and zero audits', () => {
  const env = attemptEnv();
  const before = countClass(env.integration, 'execution-attempt-record');
  const result = executeSlice1Command(orchestrateOperand(env.seed.reservedOccurrenceId), attemptContext(env));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.outcome, 'orchestrated');
  assert.equal(result.evidence.occurrenceRecordId, env.seed.occurrenceRecordId);
  assert.equal(result.evidence.activationRecordId, env.seed.activationRecordId);
  assert.equal(result.evidence.runtimeGrantId, env.seed.grantId);
  assert.equal(result.evidence.grantCurrent, true);
  assert.equal(result.evidence.remainingAllowance, 2, 'attempt_limit 2 minus zero durable attempts');
  assert.equal(countClass(env.integration, 'execution-attempt-record'), before, 'orchestrationDecision creates no record');
});

// ─── ordinal / allowance / replay ───────────────────────────────────────────

test('real store: sequential retries 1,2 recorded; duplicate ordinal → attempt-ordinal-conflict; allowance exhausted → attempt-ordinal-conflict', () => {
  const env = attemptEnv(); // grant attempt_limit = 2
  const context = attemptContext(env);
  const first = executeSlice1Command(attemptOperand(env.seed.reservedOccurrenceId, 1), context);
  assert.equal(first.ok, true, JSON.stringify(first));
  const second = executeSlice1Command(attemptOperand(env.seed.reservedOccurrenceId, 2), context);
  assert.equal(second.ok, true, JSON.stringify(second));
  if (!second.ok) return;
  assert.equal(second.evidence.ordinal, 2);
  const duplicate = executeSlice1Command(attemptOperand(env.seed.reservedOccurrenceId, 1), context);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.category, 'attempt-ordinal-conflict', 'crash-after-durability replay conflicts');
  const exhausted = executeSlice1Command(attemptOperand(env.seed.reservedOccurrenceId, 3), context);
  assert.equal(exhausted.ok, false);
  if (!exhausted.ok) assert.equal(exhausted.category, 'attempt-ordinal-conflict', JSON.stringify(exhausted));
  assert.equal(countClass(env.integration, 'execution-attempt-record'), 2, 'denied attempt starts consume zero');
});

// ─── currentness ────────────────────────────────────────────────────────────

test('real store: revoked grant at attempt start → eligibility-denied, zero records (both operations)', () => {
  const env = attemptEnv();
  const revokeContext = makeContext(env.integration.storeEnv, { revokerRole: true, identity: env.identity });
  const revoked = executeSlice1Command(
    { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'RuntimeGrant', targetRecordId: env.seed.grantId, scope: 'all-uses', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
    revokeContext,
  );
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  const context = attemptContext(env);
  for (const operand of [attemptOperand(env.seed.reservedOccurrenceId, 1), orchestrateOperand(env.seed.reservedOccurrenceId)]) {
    const result = executeSlice1Command(operand, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'eligibility-denied', JSON.stringify(result));
  }
  assert.equal(countClass(env.integration, 'execution-attempt-record'), 0);
});

// ─── crash / retry ──────────────────────────────────────────────────────────

test('real store: crash before attempt durability → store-failure, zero records; same ordinal retried cleanly', () => {
  const env = attemptEnv();
  const base = makeStoreBoundary(env.integration.storeEnv);
  const crashing = {
    ...base,
    publishLifecycleRecord(recordClass: Parameters<ControlPlaneStoreBoundary['publishLifecycleRecord']>[0], payload: Readonly<Record<string, unknown>>) {
      if (recordClass === 'execution-attempt-record') throw new Error('injected crash before attempt durability');
      return base.publishLifecycleRecord(recordClass, payload);
    },
  };
  const crashed = executeSlice1Command(attemptOperand(env.seed.reservedOccurrenceId, 1), attemptContext(env, { store: crashing }));
  assert.equal(crashed.ok, false);
  if (!crashed.ok) assert.equal(crashed.category, 'store-failure');
  assert.equal(countClass(env.integration, 'execution-attempt-record'), 0, 'nothing durable before the crash');
  const retried = executeSlice1Command(attemptOperand(env.seed.reservedOccurrenceId, 1), attemptContext(env));
  assert.equal(retried.ok, true, 'same ordinal retried cleanly after crash-before-durability');
  assert.equal(countClass(env.integration, 'execution-attempt-record'), 1);
  assertMechanicalAudit(env, 'execution-attempt-record', retried.evidence.recordId);
});

// ─── registry recordability (A → B) ─────────────────────────────────────────

test('real store: A-bound correlation chain under B → registry-context-mismatch, zero records/audits (BOTH operations, SIR-W12-S4-001)', () => {
  const integration = makeIntegrationEnv();
  const identity = makeIdentitySource();
  // Genuine chain under the CURRENT registry; the grant/activation/occurrence
  // bind registry A (historical state). Attempts under B must fail the
  // PHASE-1-style REG recordability gate → registry-context-mismatch for
  // recordExecutionAttempt AND orchestrationDecision, with zero
  // records/audits from orchestrationDecision.
  seedFullGrantChain(integration.storeEnv, identity);
  const registryA = { ...REGISTRY, registrySnapshotId: 'pgw:g:11111111111111111111111111111111', registrySnapshotDigest: `sha-256:${'1'.repeat(64)}` } as AcceptedRegistryContext;
  const occurrenceId = `pgw:o:${'a'.repeat(32)}`;
  const grantPayload = buildRuntimeGrantPayload({
    recordId: 'pgw:l:cccccccccccccccccccccccccccccccc',
    createdAt: FIXED_NOW, subject: BUNDLE.subject, workspaceId: WS_A,
    reservedOccurrenceId: occurrenceId, attemptLimit: 2,
    validity: { not_before: FIXED_NOW, not_after: '2027-01-01T00:00:00.000Z' },
    narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    registry: registryA,
  });
  seedRawRecord(integration.storeEnv, 'runtime-grant', grantPayload);
  const issuances = makeStoreBoundary(integration.storeEnv).enumerateLifecycleRecords('issuance-record');
  assert.equal(issuances.ok, true);
  const activationPayload = buildActivationRecordPayload({
    recordId: 'pgw:l:dddddddddddddddddddddddddddddddd',
    createdAt: FIXED_NOW, subject: BUNDLE.subject, workspaceId: WS_A,
    requiredIssuanceRecordIds: Object.freeze([...issuances.recordIds].slice(0, 5)),
    runtimeGrantId: 'pgw:l:cccccccccccccccccccccccccccccccc',
    reservedOccurrenceId: occurrenceId, decision: 'accepted', registry: registryA,
  });
  seedRawRecord(integration.storeEnv, 'activation-record', activationPayload);
  seedRawRecord(integration.storeEnv, 'execution-occurrence-record', buildExecutionOccurrenceRecordPayload({
    recordId: 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', createdAt: FIXED_NOW,
    activationRecordId: 'pgw:l:dddddddddddddddddddddddddddddddd',
    bundle: grantPayload['bundle'] as Readonly<Record<string, unknown>>,
    workspaceId: WS_A, occurrenceId, runtimeGrantId: 'pgw:l:cccccccccccccccccccccccccccccccc', registry: registryA,
  }));
  const context = makeContext(integration.storeEnv, {
    identity, executionRecorderRole: true,
    consumerSupport: DEFAULT_CONSUMER_SUPPORT,
    subjectArtifact: makeEvidence('ExecutionBundle').artifact,
    policyEvidence: makeEvidence('AuthorityPolicy').artifact,
  });
  const recorded = executeSlice1Command(attemptOperand(occurrenceId, 1), context);
  assert.equal(recorded.ok, false);
  if (!recorded.ok) assert.equal(recorded.category, 'registry-context-mismatch', JSON.stringify(recorded));
  const orchestrated = executeSlice1Command(orchestrateOperand(occurrenceId), context);
  assert.equal(orchestrated.ok, false);
  if (!orchestrated.ok) assert.equal(orchestrated.category, 'registry-context-mismatch', JSON.stringify(orchestrated));
  assert.equal(countClass(integration, 'execution-attempt-record'), 0, 'zero records from either operation');
  // Zero mechanical audits from orchestrationDecision: nothing was published,
  // so no attempt audit event exists (the audit probe on any attempt identity
  // is a not-found — the negative proof).
  const history = inspectAuditHistory({
    trustedConfiguration: integration.storeEnv.config,
    trustedInput: integration.storeEnv.bootstrapInput,
    recordClass: 'execution-attempt-record',
    recordId: 'pgw:l:00000000000000000000000000000000',
  });
  assert.equal(history.ok, false, 'no attempt audit may exist for an unpublished attempt');
  assert.equal(history.findings?.some((f) => f.code === 'ERR-STO-NOT-FOUND'), true, 'the audit probe must be a not-found');
});

// ─── allowlist / mutation scope ─────────────────────────────────────────────

test('real store: the eight-class publication allowlist rejects a non-allowlisted class', () => {
  const integration = makeIntegrationEnv();
  const boundary = makeStoreBoundary(integration.storeEnv);
  assert.throws(
    () => boundary.publishLifecycleRecord('trusted-receipt' as never, { record_id: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', created_at: FIXED_NOW } as never),
    TypeError,
    'the boundary must reject classes outside the eight-class allowlist',
  );
});

test('real store: full attempt flow leaves zero project files and no WP-8 lock-layout artifact', () => {
  const env = attemptEnv();
  const result = executeSlice1Command(attemptOperand(env.seed.reservedOccurrenceId, 1), attemptContext(env));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const locksDir = join(env.integration.storeEnv.dir, 'store-v1', 'locks');
  if (existsSync(locksDir)) assert.deepEqual(readdirSync(locksDir), [], 'no lock file may remain and no WP-12 lock artifact may exist');
  assert.deepEqual(readdirSync(env.integration.configEnv.workspaceRoot), [], 'no project files anywhere');
  for (const entry of readdirSync(join(env.integration.storeEnv.dir, 'store-v1'))) {
    assert.ok(['metadata', 'records', 'index', 'audit', 'tmp', 'locks', 'quarantine'].includes(entry), `unexpected store entry ${entry}`);
  }
});

// ─── coordination ───────────────────────────────────────────────────────────

test('real store: same-bundle reentrancy — outer recordExecutionAttempt holds the bundle key; inner orchestrationDecision → lock-conflict', () => {
  const env = attemptEnv();
  const base = makeStoreBoundary(env.integration.storeEnv);
  let innerResult: ReturnType<typeof executeSlice1Command> | undefined;
  const shared = makeContext(env.integration.storeEnv, {
    store: {
      ...base,
      publishLifecycleRecord(recordClass: Parameters<ControlPlaneStoreBoundary['publishLifecycleRecord']>[0], payload: Readonly<Record<string, unknown>>) {
        if (recordClass === 'execution-attempt-record') {
          innerResult = executeSlice1Command(orchestrateOperand(env.seed.reservedOccurrenceId), shared);
        }
        return base.publishLifecycleRecord(recordClass, payload);
      },
    },
    identity: env.identity,
    executionRecorderRole: true,
    consumerSupport: DEFAULT_CONSUMER_SUPPORT,
    subjectArtifact: env.kit.bundle.artifact,
    policyEvidence: env.kit.policy.artifact,
  });
  const result = executeSlice1Command(attemptOperand(env.seed.reservedOccurrenceId, 1), shared);
  assert.equal(result.ok, true, 'outer attempt recording completes after the inner denial');
  assert.ok(innerResult !== undefined, 'inner orchestration decision must have run');
  assert.equal(innerResult.ok, false);
  if (!innerResult.ok) assert.equal(innerResult.category, 'lock-conflict', 'inner same-bundle orchestration decision fails closed');
});
