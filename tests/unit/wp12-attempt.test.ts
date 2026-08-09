/**
 * WP-12 Slice 4 — orchestrationDecision + recordExecutionAttempt FOCUSED tests.
 *
 * Covers the focused contract test surface (§27.6/§27.7): request/role
 * boundary, occurrence-anchored correlation, ordinal sequencing (first = 1,
 * count + 1, unique/gapless), EXE-006 retry subject stability, attempt_limit
 * enforcement, revoked/expired grant at attempt start, zero-record/
 * zero-audit orchestration decisions, crash-before/after-durability, and
 * same-bundle coordination. Real initialized WP-8 store coverage lives in
 * wp12-attempt-store.test.ts.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import {
  buildValidationRecordPayload, buildApprovalRecordPayload, buildIssuanceRecordPayload,
  buildRuntimeGrantPayload, buildActivationRecordPayload, buildExecutionOccurrenceRecordPayload,
  buildExecutionAttemptRecordPayload,
} from '../../src/control-plane/records.js';
import { ATTEMPT_ID_RE } from '../../src/control-plane/types.js';
import {
  cleanupTestEnvs,
  grantChainSubjects,
  makeContext,
  makeEvidence,
  makeAttemptKit,
  makeIdentitySource,
  makeIntegrationEnv,
  makeRegistryContext,
  makeSubject,
  registryEchoOperand,
  seedPayload,
  WS_A,
} from './wp12-helpers.js';
import type { ControlPlaneStoreBoundary } from '../../src/control-plane/types.js';
import type { AcceptedRegistryContext, ConsumerSupportDeclaration } from '../../src/api/types.js';

after(() => cleanupTestEnvs());

const REGISTRY = makeRegistryContext();
const ECHO = registryEchoOperand();
const FIXED_NOW = '2026-08-04T06:00:00.000Z';
const LATER = '2026-08-05T06:00:00.000Z';
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

// ─── in-memory fake store (payload-level; publish counting for the
// zero-publication assertions) ───────────────────────────────────────────────

function makeFakeStore(): { readonly store: ControlPlaneStoreBoundary; readonly publishCount: () => number } {
  const byClass = new Map<string, Readonly<Record<string, unknown>>[]>();
  let publishes = 0;
  const list = (recordClass: string): Readonly<Record<string, unknown>>[] => {
    let entries = byClass.get(recordClass);
    if (entries === undefined) {
      entries = [];
      byClass.set(recordClass, entries);
    }
    return entries;
  };
  const store: ControlPlaneStoreBoundary = {
    publishLifecycleRecord(recordClass, payload) {
      publishes += 1;
      const entries = list(recordClass);
      if (entries.some((entry) => entry['record_id'] === payload['record_id'])) {
        return { ok: false, outcome: 'duplicate', findings: [] };
      }
      entries.push(payload);
      return { ok: true, outcome: 'published', recordId: String(payload['record_id']), recordDigest: `sha-256:${'f'.repeat(64)}`, auditEventId: `pgw:l:${'e'.repeat(32)}` };
    },
    readLifecyclePayload(recordClass, recordId) {
      const found = list(recordClass).find((entry) => entry['record_id'] === recordId);
      return found === undefined ? { ok: false, code: 'not-found' } : { ok: true, payload: found };
    },
    enumerateLifecycleRecords(recordClass) {
      return { ok: true, recordIds: Object.freeze(list(recordClass).map((entry) => String(entry['record_id']))) };
    },
  };
  return { store, publishCount: () => publishes };
}

interface SeededAttemptEnv {
  readonly grantId: string;
  readonly occurrenceId: string;
  readonly activationRecordId: string;
  readonly attemptLimit: number;
  readonly store: ControlPlaneStoreBoundary;
  /** Present only when the env is seeded with the attempt-authorizing kit. */
  readonly kit: ReturnType<typeof makeAttemptKit> | undefined;
}

interface AttemptSeedOptions {
  readonly attemptLimit?: number;
  readonly grantNotBefore?: string;
  readonly grantNotAfter?: string;
  readonly activationDecision?: 'accepted' | 'denied';
  readonly registry?: AcceptedRegistryContext;
  readonly includeGrant?: boolean;
  readonly occurrenceWorkspace?: string;
  /** Seed with the COMMITTED fixture policy/bundle (attempt envelope NOT authorized; SIR-W12-S4-002). */
  readonly useKit?: boolean;
}

/**
 * Seed the genuine five-subject chain + RuntimeGrant + accepted activation +
 * occurrence into a fake store using the accepted record builders (fixed
 * high record identities; never colliding with identity-source ids). The
 * occurrence's bundle reference is byte-identical to the grant's by
 * construction. `activationDecision`/`includeGrant`/`occurrenceWorkspace`
 * allow correlation-failure fixtures.
 */
function seedAttemptEnv(store: ControlPlaneStoreBoundary, options: AttemptSeedOptions = {}): SeededAttemptEnv {
  const registry = options.registry ?? REGISTRY;
  const workspaceId = options.occurrenceWorkspace ?? WS_A;
  const kit = options.useKit === false ? undefined : makeAttemptKit(WS_A);
  // Kit chain subjects: the attempt-authorizing custom policy is the bundle's
  // AuthorityPolicy member; the other three members keep the fixture
  // identities (the custom bundle only replaces the policy reference). With
  // useKit false the COMMITTED fixture policy/bundle identities are used.
  const fixtureMembers = grantChainSubjects(workspaceId).members;
  const bundle = kit !== undefined
    ? { subject: { ...kit.bundle.subject, workspaceId } }
    : { subject: { ...grantChainSubjects(workspaceId).bundle.subject, workspaceId } };
  const members = kit !== undefined
    ? fixtureMembers.map((member) =>
        member.subject.kindId === 'AuthorityPolicy' ? { subject: { ...kit.policy.subject, workspaceId } } : member,
      )
    : fixtureMembers;
  const subjects = [bundle, ...members];
  const id = (base: number): string => `pgw:l:${base.toString(16).padStart(32, '0')}`;
  const issuanceIds: string[] = [];
  for (let k = 0; k < subjects.length; k += 1) {
    const info = subjects[k]!;
    const validationId = id(0x5000 + k);
    seedPayload(store, 'validation-record', buildValidationRecordPayload({ recordId: validationId, createdAt: FIXED_NOW, subject: info.subject, registry }));
    const approvalId = id(0x5100 + k);
    seedPayload(store, 'approval-record', buildApprovalRecordPayload({
      recordId: approvalId, createdAt: FIXED_NOW, subject: info.subject, workspaceId,
      purpose: 'execution-use', validationRecordIds: [validationId],
      requiredSemantics: { protocol_features: [], consumer_capabilities: [] }, validUntil: null, registry,
    }));
    const issuanceId = id(0x5200 + k);
    seedPayload(store, 'issuance-record', buildIssuanceRecordPayload({
      recordId: issuanceId, createdAt: FIXED_NOW, subject: info.subject, workspaceId,
      useClass: 'execution-use', approvalRecordId: approvalId, activationLimit: 1, validUntil: null, registry,
    }));
    issuanceIds.push(issuanceId);
  }
  const occurrenceId = `pgw:o:${'a'.repeat(32)}`;
  const attemptLimit = options.attemptLimit ?? 3;
  const grantId = 'pgw:l:cccccccccccccccccccccccccccccccc';
  if (options.includeGrant !== false) {
    seedPayload(store, 'runtime-grant', buildRuntimeGrantPayload({
      recordId: grantId, createdAt: FIXED_NOW, subject: { ...bundle.subject, workspaceId }, workspaceId,
      reservedOccurrenceId: occurrenceId, attemptLimit,
      validity: { not_before: options.grantNotBefore ?? FIXED_NOW, not_after: options.grantNotAfter ?? LATER },
      narrowedConstraints: [{ type: 'max-actions', value: 10 }],
      registry,
    }));
  }
  const activationRecordId = 'pgw:l:dddddddddddddddddddddddddddddddd';
  const decision = options.activationDecision ?? 'accepted';
  seedPayload(store, 'activation-record', buildActivationRecordPayload({
    recordId: activationRecordId, createdAt: FIXED_NOW, subject: { ...bundle.subject, workspaceId }, workspaceId,
    requiredIssuanceRecordIds: Object.freeze([...issuanceIds]),
    runtimeGrantId: grantId, reservedOccurrenceId: occurrenceId, decision, registry,
  }));
  const grantPayload = store.readLifecyclePayload('runtime-grant', grantId).payload;
  seedPayload(store, 'execution-occurrence-record', buildExecutionOccurrenceRecordPayload({
    recordId: 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', createdAt: FIXED_NOW,
    activationRecordId, bundle: (grantPayload !== undefined ? grantPayload['bundle'] : bundleArtifactReference(bundle.subject)) as Readonly<Record<string, unknown>>,
    workspaceId, occurrenceId, runtimeGrantId: grantId, registry,
  }));
  return { grantId, occurrenceId, activationRecordId, attemptLimit, store, kit };
}

/** Exact-artifact-reference form for the fixture bundle subject (fallback). */
function bundleArtifactReference(subject: ReturnType<typeof makeSubject>['subject']): Readonly<Record<string, unknown>> {
  return Object.freeze({
    target_protocol_version: subject.protocolVersion,
    target_kind: Object.freeze({ id: subject.kindId, version: subject.kindVersion }),
    target_instance_id: subject.instanceId,
    target_revision_id: subject.revisionId,
    target_digest: subject.digest,
    target_workspace_binding: Object.freeze({ mode: 'bound', workspace_id: subject.workspaceId }),
  });
}

function attemptContext(
  integration: ReturnType<typeof makeIntegrationEnv>,
  env: SeededAttemptEnv,
  overrides: { readonly identity?: ReturnType<typeof makeIdentitySource>; readonly store?: ControlPlaneStoreBoundary; readonly consumerSupport?: ConsumerSupportDeclaration } = {},
) {
  return makeContext(integration.storeEnv, {
    store: overrides.store ?? env.store,
    identity: overrides.identity ?? makeIdentitySource(),
    executionRecorderRole: true,
    consumerSupport: overrides.consumerSupport ?? DEFAULT_CONSUMER_SUPPORT,
    subjectArtifact: env.kit !== undefined ? env.kit.bundle.artifact : makeEvidence('ExecutionBundle').artifact,
    policyEvidence: env.kit !== undefined ? env.kit.policy.artifact : makeEvidence('AuthorityPolicy').artifact,
  });
}

function attemptCount(store: ControlPlaneStoreBoundary): number {
  return store.enumerateLifecycleRecords('execution-attempt-record').recordIds.length;
}

// ─── REQUEST / ROLE boundary (S4-D2) ────────────────────────────────────────

test('attempt request: exact valid request records ordinal 1 with an internally allocated pgw:a: attempt ID', () => {
  const integration = makeIntegrationEnv();
  const { store, publishCount } = makeFakeStore();
  const env = seedAttemptEnv(store);
  const context = attemptContext(integration, env);
  const before = publishCount();
  const result = executeSlice1Command(attemptOperand(env.occurrenceId, 1), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.outcome, 'attempt-recorded');
  assert.equal(result.evidence.ordinal, 1);
  assert.match(result.evidence.attemptId!, ATTEMPT_ID_RE, 'internally allocated attempt identity');
  assert.equal(result.evidence.reservedOccurrenceId, env.occurrenceId);
  assert.equal(result.evidence.runtimeGrantId, env.grantId);
  assert.equal(result.evidence.activationRecordId, env.activationRecordId);
  assert.equal(attemptCount(store), 1);
  const stored = store.readLifecyclePayload('execution-attempt-record', result.evidence.recordId).payload!;
  assert.equal(stored['record_type'], 'ExecutionAttemptRecord');
  assert.equal(stored['responsible_role'], 'trusted-execution-recorder');
  assert.equal(stored['occurrence_id'], env.occurrenceId);
  assert.equal(stored['ordinal'], 1);
  assert.equal(stored['attempt_id'], result.evidence.attemptId);
  assert.equal(stored['runtime_grant_id'], env.grantId);
  assert.equal(stored['activation_record_id'], env.activationRecordId);
  assert.equal(publishCount(), before + 1, 'exactly one publication');
});

test('attempt request: unknown keys are request-invalid; role assertion is approver-not-independent', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const env = seedAttemptEnv(store);
  const context = attemptContext(integration, env);
  for (const extra of [
    { grantId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { activationRecordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { attemptId: 'pgw:a:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { subject: { kindId: 'ExecutionBundle' } },
    { consumerSupport: DEFAULT_CONSUMER_SUPPORT },
    { policyIdentity: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { verificationEvidence: { ok: true } },
    { config: {} },
  ]) {
    const result = executeSlice1Command(attemptOperand(env.occurrenceId, 1, extra), context);
    assert.equal(result.ok, false, JSON.stringify(extra));
    if (!result.ok) assert.equal(result.category, 'request-invalid', JSON.stringify(extra));
    const orchestrated = executeSlice1Command(orchestrateOperand(env.occurrenceId, extra), context);
    assert.equal(orchestrated.ok, false, `orchestration ${JSON.stringify(extra)}`);
    if (!orchestrated.ok) assert.equal(orchestrated.category, 'request-invalid', JSON.stringify(extra));
  }
  for (const extra of [{ executionRecorderRole: true }, { executionRecorderAuthority: true }, { role: 'trusted-execution-recorder' }]) {
    const result = executeSlice1Command(attemptOperand(env.occurrenceId, 1, extra), context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'approver-not-independent', JSON.stringify(extra));
  }
});

test('attempt request: missing/malformed operands are request-invalid; echo mismatch is registry-context-mismatch', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const env = seedAttemptEnv(store);
  const context = attemptContext(integration, env);
  for (const missing of ['reservedOccurrenceId', 'registryEcho', 'ordinal']) {
    const operand = attemptOperand(env.occurrenceId, 1);
    delete operand[missing];
    const result = executeSlice1Command(operand, context);
    assert.equal(result.ok, false, `missing ${missing}`);
    if (!result.ok) assert.equal(result.category, 'request-invalid', `missing ${missing}`);
  }
  for (const malformed of [
    attemptOperand('not-an-occurrence-id', 1),
    attemptOperand(env.occurrenceId, 0),
    attemptOperand(env.occurrenceId, 1.5),
    attemptOperand(env.occurrenceId, -1),
    attemptOperand(env.occurrenceId, 1, { ordinal: '2' }),
    attemptOperand(env.occurrenceId, 1, { ordinal: null }),
  ]) {
    const result = executeSlice1Command(malformed, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'request-invalid');
  }
  const mismatched = executeSlice1Command(attemptOperand(env.occurrenceId, 1, {
    registryEcho: { registry_snapshot_id: 'pgw:g:11111111111111111111111111111111', registry_snapshot_digest: `sha-256:${'1'.repeat(64)}` },
  }), context);
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) assert.equal(mismatched.category, 'registry-context-mismatch');
});

test('attempt request: missing host execution-recorder role → lifecycle-state-missing with zero records (both operations)', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const env = seedAttemptEnv(store);
  const noRole = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), executionRecorderRole: false });
  const recorded = executeSlice1Command(attemptOperand(env.occurrenceId, 1), noRole);
  assert.equal(recorded.ok, false);
  if (!recorded.ok) assert.equal(recorded.category, 'lifecycle-state-missing');
  const orchestrated = executeSlice1Command(orchestrateOperand(env.occurrenceId), noRole);
  assert.equal(orchestrated.ok, false);
  if (!orchestrated.ok) assert.equal(orchestrated.category, 'lifecycle-state-missing');
  assert.equal(attemptCount(store), 0);
});

// ─── orchestrationDecision: zero records / bounded evidence (S4-D1) ─────────

test('orchestrationDecision: bounded evidence with zero records and zero publications', () => {
  const integration = makeIntegrationEnv();
  const { store, publishCount } = makeFakeStore();
  const env = seedAttemptEnv(store, { attemptLimit: 2 });
  const context = attemptContext(integration, env);
  const before = publishCount();
  const result = executeSlice1Command(orchestrateOperand(env.occurrenceId), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.outcome, 'orchestrated');
  assert.equal(result.evidence.occurrenceRecordId, 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
  assert.equal(result.evidence.activationRecordId, env.activationRecordId);
  assert.equal(result.evidence.runtimeGrantId, env.grantId);
  assert.equal(result.evidence.grantCurrent, true);
  assert.equal(result.evidence.remainingAllowance, 2, 'attempt_limit 2 minus zero durable attempts');
  assert.equal(attemptCount(store), 0, 'orchestrationDecision creates no attempt record');
  assert.equal(publishCount(), before, 'orchestrationDecision performs zero publications');
});

test('orchestrationDecision: exhausted allowance → attempt-ordinal-conflict, zero records', () => {
  const integration = makeIntegrationEnv();
  const { store, publishCount } = makeFakeStore();
  const env = seedAttemptEnv(store, { attemptLimit: 1 });
  const context = attemptContext(integration, env);
  const before = publishCount();
  const first = executeSlice1Command(attemptOperand(env.occurrenceId, 1), context);
  assert.equal(first.ok, true, JSON.stringify(first));
  const decided = executeSlice1Command(orchestrateOperand(env.occurrenceId), context);
  assert.equal(decided.ok, false);
  if (!decided.ok) assert.equal(decided.category, 'attempt-ordinal-conflict', JSON.stringify(decided));
  assert.equal(attemptCount(store), 1, 'no additional record from the decision');
  assert.equal(publishCount(), before + 1, 'only the first attempt published');
});

// ─── correlation failures (S4-D2) ───────────────────────────────────────────

test('attempt correlation: missing occurrence → lifecycle-state-missing, zero records', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const env = seedAttemptEnv(store);
  const context = attemptContext(integration, env);
  for (const operand of [attemptOperand(`pgw:o:${'f'.repeat(32)}`, 1), orchestrateOperand(`pgw:o:${'f'.repeat(32)}`)]) {
    const result = executeSlice1Command(operand, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'lifecycle-state-missing');
  }
  assert.equal(attemptCount(store), 0);
});

test('attempt correlation: occurrence without accepted activation → occurrence-conflict', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const env = seedAttemptEnv(store, { activationDecision: 'denied' });
  const context = attemptContext(integration, env);
  const result = executeSlice1Command(attemptOperand(env.occurrenceId, 1), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'occurrence-conflict', JSON.stringify(result));
  assert.equal(attemptCount(store), 0);
});

test('attempt correlation: missing grant → lifecycle-state-missing', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const env = seedAttemptEnv(store, { includeGrant: false });
  const context = attemptContext(integration, env);
  const result = executeSlice1Command(attemptOperand(env.occurrenceId, 1), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'lifecycle-state-missing', JSON.stringify(result));
  assert.equal(attemptCount(store), 0);
});

test('attempt correlation: workspace mismatch → lifecycle-state-missing', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const env = seedAttemptEnv(store, { occurrenceWorkspace: 'pgw:w:99999999999999999999999999999999' });
  const context = attemptContext(integration, env);
  const result = executeSlice1Command(attemptOperand(env.occurrenceId, 1), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'lifecycle-state-missing', JSON.stringify(result));
  assert.equal(attemptCount(store), 0);
});

// ─── ordinal semantics (S4-D3) ──────────────────────────────────────────────

test('attempt ordinal: first = 1; sequential retries accepted; duplicate/stale/skipped → attempt-ordinal-conflict', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const env = seedAttemptEnv(store, { attemptLimit: 3 });
  const context = attemptContext(integration, env);
  // Skipped first ordinal.
  const skippedFirst = executeSlice1Command(attemptOperand(env.occurrenceId, 2), context);
  assert.equal(skippedFirst.ok, false);
  if (!skippedFirst.ok) assert.equal(skippedFirst.category, 'attempt-ordinal-conflict');
  assert.equal(attemptCount(store), 0);
  // Sequential retries 1, 2, 3.
  for (const ordinal of [1, 2, 3]) {
    const result = executeSlice1Command(attemptOperand(env.occurrenceId, ordinal), context);
    assert.equal(result.ok, true, `ordinal ${ordinal}: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.evidence.ordinal, ordinal);
  }
  assert.equal(attemptCount(store), 3);
  // Duplicate of a durable ordinal.
  const duplicate = executeSlice1Command(attemptOperand(env.occurrenceId, 2), context);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.category, 'attempt-ordinal-conflict');
  // Stale proposal (next is 4, propose 5) and gap proposal (propose 4 while count is 2).
  const integration2 = makeIntegrationEnv();
  const { store: store2 } = makeFakeStore();
  const env2 = seedAttemptEnv(store2, { attemptLimit: 5 });
  const context2 = attemptContext(integration2, env2);
  assert.equal(executeSlice1Command(attemptOperand(env2.occurrenceId, 1), context2).ok, true);
  assert.equal(executeSlice1Command(attemptOperand(env2.occurrenceId, 2), context2).ok, true);
  const gap = executeSlice1Command(attemptOperand(env2.occurrenceId, 4), context2);
  assert.equal(gap.ok, false);
  if (!gap.ok) assert.equal(gap.category, 'attempt-ordinal-conflict');
  const stale = executeSlice1Command(attemptOperand(env2.occurrenceId, 3), context2);
  assert.equal(stale.ok, true, 'count + 1 proposal remains valid');
});

test('attempt ordinal: EXE-006 retry subject stability — substituted grant → attempt-ordinal-conflict', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const env = seedAttemptEnv(store);
  // Corrupted historical first attempt binding a DIFFERENT grant for the
  // same occurrence (raw-seeded): the retry must fail closed on the
  // substitution (EXE-006).
  const firstBundle = (store.readLifecyclePayload('execution-occurrence-record', 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee').payload!)['bundle'];
  seedPayload(store, 'execution-attempt-record', buildExecutionAttemptRecordPayload({
    recordId: 'pgw:l:11111111111111111111111111111111', createdAt: FIXED_NOW,
    activationRecordId: env.activationRecordId, occurrenceId: env.occurrenceId,
    attemptId: `pgw:a:${'b'.repeat(32)}`, ordinal: 1,
    bundle: firstBundle as Readonly<Record<string, unknown>>, workspaceId: WS_A,
    runtimeGrantId: 'pgw:l:ffffffffffffffffffffffffffffffff', registry: REGISTRY,
  }));
  const context = attemptContext(integration, env);
  const retry = executeSlice1Command(attemptOperand(env.occurrenceId, 2), context);
  assert.equal(retry.ok, false);
  if (!retry.ok) assert.equal(retry.category, 'attempt-ordinal-conflict', JSON.stringify(retry));
  assert.equal(attemptCount(store), 1, 'no additional attempt recorded');
});

// ─── allowance (S4-D4) ──────────────────────────────────────────────────────

test('attempt allowance: exhaustion → attempt-ordinal-conflict; within limit accepted', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const env = seedAttemptEnv(store, { attemptLimit: 2 });
  const context = attemptContext(integration, env);
  assert.equal(executeSlice1Command(attemptOperand(env.occurrenceId, 1), context).ok, true);
  assert.equal(executeSlice1Command(attemptOperand(env.occurrenceId, 2), context).ok, true);
  const exhausted = executeSlice1Command(attemptOperand(env.occurrenceId, 3), context);
  assert.equal(exhausted.ok, false);
  if (!exhausted.ok) assert.equal(exhausted.category, 'attempt-ordinal-conflict', JSON.stringify(exhausted));
  assert.equal(attemptCount(store), 2, 'denied attempt start consumes zero');
});

// ─── currentness (S4-D6) ────────────────────────────────────────────────────

test('attempt currentness: revoked grant at attempt start → eligibility-denied, zero records (both operations)', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const env = seedAttemptEnv(store);
  const revokeContext = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), revokerRole: true });
  const revoked = executeSlice1Command(
    { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'RuntimeGrant', targetRecordId: env.grantId, scope: 'all-uses', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
    revokeContext,
  );
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  const context = attemptContext(integration, env);
  for (const operand of [attemptOperand(env.occurrenceId, 1), orchestrateOperand(env.occurrenceId)]) {
    const result = executeSlice1Command(operand, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'eligibility-denied', JSON.stringify(result));
  }
  assert.equal(attemptCount(store), 0);
});

test('attempt currentness: expired and not-yet-valid grant → eligibility-denied, zero records', () => {
  for (const validity of [{ grantNotAfter: '2020-01-01T00:00:00.000Z' }, { grantNotBefore: '2099-01-01T00:00:00.000Z' }]) {
    const integration = makeIntegrationEnv();
    const { store } = makeFakeStore();
    const env = seedAttemptEnv(store, validity);
    const context = attemptContext(integration, env);
    const result = executeSlice1Command(attemptOperand(env.occurrenceId, 1), context);
    assert.equal(result.ok, false, JSON.stringify(validity));
    if (!result.ok) assert.equal(result.category, 'eligibility-denied', JSON.stringify(validity));
    assert.equal(attemptCount(store), 0);
  }
});

// ─── crash / retry behavior (S4-D6) ─────────────────────────────────────────

test('attempt crash: failure before durability → store-failure, zero records; same ordinal retried cleanly', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const env = seedAttemptEnv(store);
  const identity = makeIdentitySource();
  const crashing = {
    ...store,
    publishLifecycleRecord(recordClass: Parameters<ControlPlaneStoreBoundary['publishLifecycleRecord']>[0], payload: Readonly<Record<string, unknown>>) {
      if (recordClass === 'execution-attempt-record') throw new Error('injected crash before attempt durability');
      return store.publishLifecycleRecord(recordClass, payload);
    },
  };
  const crashed = executeSlice1Command(attemptOperand(env.occurrenceId, 1), attemptContext(integration, env, { store: crashing, identity }));
  assert.equal(crashed.ok, false);
  if (!crashed.ok) assert.equal(crashed.category, 'store-failure');
  assert.equal(attemptCount(store), 0, 'nothing durable before the crash');
  const retried = executeSlice1Command(attemptOperand(env.occurrenceId, 1), attemptContext(integration, env, { identity }));
  assert.equal(retried.ok, true, 'same ordinal retried cleanly after crash-before-durability');
});

test('attempt crash: durable attempt consumes the ordinal; same-ordinal retry → attempt-ordinal-conflict', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const env = seedAttemptEnv(store);
  const context = attemptContext(integration, env);
  const first = executeSlice1Command(attemptOperand(env.occurrenceId, 1), context);
  assert.equal(first.ok, true, JSON.stringify(first));
  if (!first.ok) return;
  const replay = executeSlice1Command(attemptOperand(env.occurrenceId, 1), context);
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.category, 'attempt-ordinal-conflict', 'crash-after-durability replay conflicts');
  assert.equal(attemptCount(store), 1);
});

// ─── fixture policy (SIR-W12-S4-002) ────────────────────────────────────────

test('attempt currentness: committed fixture policy (attempt envelope NOT authorized) → eligibility-denied, zero publications (both operations)', () => {
  const integration = makeIntegrationEnv();
  const { store, publishCount } = makeFakeStore();
  // Fixture policy/bundle identities (no kit): the committed fixture policy's
  // require-exact-resource constraint does NOT authorize the attempt stage
  // envelope — policy is authority, fail closed.
  const env = seedAttemptEnv(store, { useKit: false });
  const context = attemptContext(integration, env);
  const before = publishCount();
  for (const operand of [attemptOperand(env.occurrenceId, 1), orchestrateOperand(env.occurrenceId)]) {
    const result = executeSlice1Command(operand, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'eligibility-denied', JSON.stringify(result));
  }
  assert.equal(attemptCount(store), 0, 'zero unintended lifecycle publication');
  assert.equal(publishCount(), before, 'zero unintended lifecycle publication');
});

// ─── coordination (S4-D5) ───────────────────────────────────────────────────

test('attempt coordination: same-bundle reentrancy — outer recordExecutionAttempt holds the bundle key; inner orchestrationDecision → lock-conflict', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const env = seedAttemptEnv(store);
  const base = { ...store };
  let innerResult: ReturnType<typeof executeSlice1Command> | undefined;
  const shared = attemptContext(integration, env, {
    store: {
      ...base,
      publishLifecycleRecord(recordClass: Parameters<ControlPlaneStoreBoundary['publishLifecycleRecord']>[0], payload: Readonly<Record<string, unknown>>) {
        if (recordClass === 'execution-attempt-record') {
          innerResult = executeSlice1Command(orchestrateOperand(env.occurrenceId), shared);
        }
        return store.publishLifecycleRecord(recordClass, payload);
      },
    },
  });
  const result = executeSlice1Command(attemptOperand(env.occurrenceId, 1), shared);
  assert.equal(result.ok, true, 'outer attempt recording completes after the inner denial');
  assert.ok(innerResult !== undefined, 'inner orchestration decision must have run');
  assert.equal(innerResult.ok, false);
  if (!innerResult.ok) assert.equal(innerResult.category, 'lock-conflict', 'inner same-bundle orchestration decision fails closed');
});
