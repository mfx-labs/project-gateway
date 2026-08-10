/**
 * WP-13A — execution foundation FOCUSED tests.
 *
 * Real WP-12 chain (genuine command flow on a real WP-8 store), real WP-5A
 * plan projection, real WP-5B enforcement evidence (hermetic pi-guard fake),
 * and a fake Pi host execution boundary. Covers: first attempt, exact
 * correlation, execution-time revalidation, grant revocation/expiry,
 * enforcement state gates, observation mismatch, all seven dispositions,
 * retry classification/ordinal/allowance/staleness/subject-stability,
 * restart and ambiguity fail-closed, explicit-request-only retry, and
 * zero result/receipt production.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupTestEnvs,
  grantChainSubjects,
  makeAttemptKit,
  makeAttemptConsumerSupport,
  makeContext,
  makeFakeStore,
  makeIntegrationEnv,
  makeRegistryContext,
  seedPayload,
  WS_A,
  FIXED_NOW,
} from './wp12-helpers.js';
import {
  buildValidationRecordPayload,
  buildApprovalRecordPayload,
  buildIssuanceRecordPayload,
  buildRuntimeGrantPayload,
  buildActivationRecordPayload,
  buildExecutionOccurrenceRecordPayload,
  buildRevocationRecordPayload,
} from '../../src/control-plane/records.js';
import { buildWorld, corpusArtifactSet, SUPPORT } from '../pi-adapter/helpers.js';
import { projectExecutionBundleToPi } from '../../src/adapters/pi/projection.js';
import { createPiHostBridge } from '../../src/adapters/pi/index.js';
import { mockSurface, fire, hostCtx, type MockSurface } from '../pi-adapter/unit/mock-surface.js';
import { createFakeGuard, verifiedPackageInspection } from '../pi-adapter/enforcement/fake-guard.js';
import { standardSurface, HOST_TIMESTAMP, TIMESTAMP_SOURCE } from '../pi-adapter/enforcement/world.js';
import { runTrustedEnforcement } from '../../src/adapters/pi/enforcement/index.js';
import type { PiInvocationPlan } from '../../src/adapters/pi/types.js';
import type { PiEnforcementEvidence } from '../../src/adapters/pi/enforcement/types.js';
import {
  classifyDisposition,
  createControlPlaneExecutionBoundary,
  evaluateRetryEligibility,
  executeExecutionAttempt,
  type ControlPlaneExecutionBoundary,
  type DurableAttemptFact,
  type EnforcementStateSnapshot,
  type ExecutionAttemptFailure,
  type ExecutionAttemptInput,
  type ExecutionAttemptOutcome,
  type ExecutionAttemptResult,
  type ExecutionFailureCategory,
  type ExecutionHostBoundary,
} from '../../src/execution/index.js';
import type { ControlPlaneStoreBoundary } from '../../src/control-plane/types.js';

after(() => cleanupTestEnvs());

/** Predictable identity: the first internally allocated attempt id is
 *  known BEFORE recording (WP-12 allocates `pgw:a:` ids internally). The
 *  SAME instance must feed seeding and the execution context (record-id
 *  sequence continuity); `setNow` allows trusted-time tests. */
function makePredictableIdentity(now: string = FIXED_NOW) {
  let current = now;
  let n = 0;
  let o = 0;
  let a = 0;
  return {
    nowUtcIso: () => current,
    setNow: (value: string) => {
      current = value;
    },
    newRecordId: () => {
      n += 1;
      return `pgw:l:${n.toString(16).padStart(32, '0')}`;
    },
    newOccurrenceId: () => {
      o += 1;
      return `pgw:o:${o.toString(16).padStart(32, '0')}`;
    },
    newAttemptId: () => {
      a += 1;
      return `pgw:a:${a.toString(16).padStart(32, '0')}`;
    },
    sequence: () => n,
  };
}

const FIRST_ATTEMPT_ID = 'pgw:a:00000000000000000000000000000001';
const SECOND_ATTEMPT_ID = 'pgw:a:00000000000000000000000000000002';

export type Scenario = 'completed' | 'cancelled' | 'error' | 'none' | 'timed-out' | 'crashed' | 'rejected';

interface KitWorld {
  readonly kit: ReturnType<typeof makeAttemptKit>;
  readonly world: ReturnType<typeof buildWorld>;
}

/** The WP-5A world over the WP-12 attempt kit (custom bundle + policy). */
function makeKitWorld(): KitWorld {
  const kit = makeAttemptKit(WS_A);
  const corpus = corpusArtifactSet();
  const set = {
    bundle: kit.bundle.artifact.model as unknown as Record<string, unknown>,
    task: corpus.task,
    policy: kit.policy.artifact.model as unknown as Record<string, unknown>,
    context: corpus.context,
    completion: corpus.completion,
  };
  return { kit, world: buildWorld(set) };
}

function projectPlan(world: ReturnType<typeof buildWorld>, occurrenceId: string, attemptId: string): PiInvocationPlan {
  const result = projectExecutionBundleToPi({ ...world.input(), occurrenceId, attemptId });
  if (!result.ok) throw new Error('plan projection failed');
  return result.plan;
}

/** Genuine WP-5B enforcement evidence over the first-attempt plan. */
function buildEnforcementEvidence(
  kitWorld: KitWorld,
  plan: PiInvocationPlan,
  grantId: string,
  occurrenceId: string,
): { readonly evidence: PiEnforcementEvidence; readonly surface: ReturnType<typeof standardSurface> } {
  const fake = createFakeGuard('normal');
  const surface = standardSurface();
  const result = runTrustedEnforcement({
    plan,
    eligibility: kitWorld.world.eligibility,
    activation: {
      decision: 'accepted',
      runtimeGrantId: grantId,
      reservedOccurrenceId: occurrenceId,
      resolvedOccurrenceId: occurrenceId,
      attemptId: plan.attemptId,
      grantCurrent: true,
    },
    workspaceIdentity: WS_A,
    capabilityVocabularyVersion: '1',
    expectedToolSources: [],
    evaluatorVersion: '2',
    piHost: { piIdentity: '@earendil-works/pi-coding-agent', piVersion: '0.83.0' },
    consumer: SUPPORT,
    guard: { packageInspection: verifiedPackageInspection(), api: fake.api },
    surface,
    hostTimestamp: HOST_TIMESTAMP,
    timestampSource: TIMESTAMP_SOURCE,
  });
  if (!result.ok) throw new Error(`enforcement evidence failed: ${JSON.stringify(result.findings)}`);
  return { evidence: result.evidence, surface };
}

function liveSnapshotFrom(evidence: PiEnforcementEvidence, surface: ReturnType<typeof standardSurface>): EnforcementStateSnapshot {
  return {
    available: true,
    active: true,
    mode: 'PROJECTED',
    projectionIdentity: evidence.projectionIdentity,
    permittedProfile: evidence.projectedAllowedTools,
    surfaceEntries: surface.entries,
  };
}

interface FakeHostOptions {
  readonly scenario: Scenario;
  readonly enforcementState?: () => EnforcementStateSnapshot;
  readonly reportSessionId?: string;
  readonly bridgeFrom?: (plan: PiInvocationPlan) => PiInvocationPlan;
  readonly throwOnExecute?: boolean;
}

function makeFakeHost(kitWorld: KitWorld, occurrenceId: string, options: FakeHostOptions): ExecutionHostBoundary & { readonly counters: { execute: number; project: number } } {
  const counters = { execute: 0, project: 0 };
  return {
    counters,
    readEnforcementState() {
      return options.enforcementState !== undefined ? options.enforcementState() : { available: false };
    },
    projectPlan(attemptId: string) {
      counters.project += 1;
      const plan = projectPlan(kitWorld.world, occurrenceId, attemptId);
      return { ok: true, plan };
    },
    execute({ plan }: { readonly plan: PiInvocationPlan }) {
      counters.execute += 1;
      if (options.throwOnExecute === true) throw new Error('host boom');
      const actualPlan = options.bridgeFrom !== undefined ? options.bridgeFrom(plan) : plan;
      const surface = mockSurface();
      const wired = createPiHostBridge(surface, actualPlan);
      if (!wired.ok || wired.bridge === undefined) return { ok: false, code: 'bridge-failed', message: 'bridge wiring failed' };
      const eventBridge = wired.bridge;
      const s = surface as MockSurface;
      fire(s, 'session_start', { reason: 'startup' }, hostCtx('sess-1'));
      fire(s, 'turn_start', { turnIndex: 0, timestamp: 1000 });
      if (options.scenario === 'completed') {
        fire(s, 'message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } });
        fire(s, 'agent_settled', {});
        fire(s, 'session_shutdown', { reason: 'quit' });
      } else if (options.scenario === 'error') {
        fire(s, 'tool_execution_start', { toolCallId: 't1', toolName: 'read' });
        fire(s, 'tool_execution_end', { toolCallId: 't1', toolName: 'read', isError: true });
      } else if (options.scenario === 'cancelled') {
        eventBridge.recordCancellation();
      }
      const sessionCorrelationId = eventBridge.sessionCorrelationId;
      const turnCorrelationId = eventBridge.turnCorrelationId;
      if (sessionCorrelationId === undefined || turnCorrelationId === undefined) {
        return { ok: false, code: 'correlation-missing', message: 'no session/turn correlation' };
      }
      return {
        ok: true,
        facts: {
          bridge: eventBridge,
          sessionCorrelationId: options.reportSessionId ?? sessionCorrelationId,
          turnCorrelationId,
          ...(options.scenario === 'timed-out' ? { timedOut: true } : {}),
          ...(options.scenario === 'crashed' ? { crashed: true } : {}),
          ...(options.scenario === 'rejected' ? { enforcementDenied: true } : {}),
        },
      };
    },
  };
}

interface AttemptEnv {
  readonly identity: ReturnType<typeof makePredictableIdentity>;
  readonly store: ControlPlaneStoreBoundary;
  readonly grantId: string;
  readonly occurrenceId: string;
  readonly kitWorld: KitWorld;
  readonly evidence: PiEnforcementEvidence;
  readonly surface: ReturnType<typeof standardSurface>;
  readonly boundary: ControlPlaneExecutionBoundary;
}

const LATER = '2027-01-01T00:00:00.000Z';

/**
 * Seed the genuine five-subject chain + RuntimeGrant + accepted activation +
 * occurrence into an in-memory fake store with the accepted record builders
 * (the WP-12 Slice-4 seeding pattern; fast, no real-store cost). The
 * occurrence's bundle reference is byte-identical to the grant's by
 * construction; the kit bundle/policy are the attempt-authorizing subjects.
 */
function seedAttemptEnv(store: ControlPlaneStoreBoundary, kit: KitWorld['kit']): { readonly grantId: string; readonly occurrenceId: string } {
  const registry = makeRegistryContext();
  const workspaceId = WS_A;
  const chain = grantChainSubjects(workspaceId);
  const bundle = { subject: { ...kit.bundle.subject, workspaceId } };
  const members = chain.members.map((member) =>
    member.subject.kindId === 'AuthorityPolicy' ? { subject: { ...kit.policy.subject, workspaceId } } : member,
  );
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
  const grantId = 'pgw:l:cccccccccccccccccccccccccccccccc';
  seedPayload(store, 'runtime-grant', buildRuntimeGrantPayload({
    recordId: grantId, createdAt: FIXED_NOW, subject: { ...bundle.subject, workspaceId }, workspaceId,
    reservedOccurrenceId: occurrenceId, attemptLimit: 2,
    validity: { not_before: FIXED_NOW, not_after: LATER },
    narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    registry,
  }));
  const activationRecordId = 'pgw:l:dddddddddddddddddddddddddddddddd';
  seedPayload(store, 'activation-record', buildActivationRecordPayload({
    recordId: activationRecordId, createdAt: FIXED_NOW, subject: { ...bundle.subject, workspaceId }, workspaceId,
    requiredIssuanceRecordIds: Object.freeze([...issuanceIds]),
    runtimeGrantId: grantId, reservedOccurrenceId: occurrenceId, decision: 'accepted', registry,
  }));
  const grantPayload = store.readLifecyclePayload('runtime-grant', grantId).payload;
  seedPayload(store, 'execution-occurrence-record', buildExecutionOccurrenceRecordPayload({
    recordId: 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', createdAt: FIXED_NOW,
    activationRecordId,
    bundle: (grantPayload !== undefined ? grantPayload['bundle'] : undefined) as Readonly<Record<string, unknown>>,
    workspaceId, occurrenceId, runtimeGrantId: grantId, registry,
  }));
  return { grantId, occurrenceId };
}

/** Seed a genuine activated occurrence + enforcement evidence over the kit
 *  (fast fake-store chain; the WP-12 Slice-4 seeding pattern). */
function makeAttemptEnv(): AttemptEnv {
  const integration = makeIntegrationEnv();
  const identity = makePredictableIdentity();
  const kitWorld = makeKitWorld();
  const fake = makeFakeStore();
  const seed = seedAttemptEnv(fake.store, kitWorld.kit);
  const plan = projectPlan(kitWorld.world, seed.occurrenceId, FIRST_ATTEMPT_ID);
  const { evidence, surface } = buildEnforcementEvidence(kitWorld, plan, seed.grantId, seed.occurrenceId);
  const context = makeContext(integration.storeEnv, {
    store: fake.store,
    identity,
    executionRecorderRole: true,
    consumerSupport: makeAttemptConsumerSupport(),
    subjectArtifact: kitWorld.kit.bundle.artifact,
    policyEvidence: kitWorld.kit.policy.artifact,
  });
  const boundary = createControlPlaneExecutionBoundary(context);
  return {
    identity,
    store: fake.store,
    grantId: seed.grantId,
    occurrenceId: seed.occurrenceId,
    kitWorld,
    evidence,
    surface,
    boundary,
  };
}

function executionInput(
  env: AttemptEnv,
  options: {
    readonly scenario?: Scenario;
    readonly previousOutcome?: ExecutionAttemptOutcome;
    readonly hostOverrides?: Partial<FakeHostOptions>;
    readonly host?: ExecutionHostBoundary;
    readonly controlPlane?: ControlPlaneExecutionBoundary;
    readonly identity?: { readonly nowUtcIso: () => string };
  } = {},
): { readonly input: ExecutionAttemptInput; readonly host: ExecutionHostBoundary & { readonly counters?: { execute: number; project: number } } } {
  const snapshot = () => liveSnapshotFrom(env.evidence, env.surface);
  const host = options.host ?? makeFakeHost(env.kitWorld, env.occurrenceId, {
    scenario: options.scenario ?? 'completed',
    enforcementState: snapshot,
    ...options.hostOverrides,
  });
  return {
    host,
    input: {
      request: { workspaceId: WS_A, reservedOccurrenceId: env.occurrenceId },
      enforcement: {
        evidence: env.evidence,
        activation: {
          decision: 'accepted',
          runtimeGrantId: env.grantId,
          reservedOccurrenceId: env.occurrenceId,
          resolvedOccurrenceId: env.occurrenceId,
          attemptId: FIRST_ATTEMPT_ID,
          grantCurrent: true,
        },
      },
      ...(options.previousOutcome !== undefined ? { previousOutcome: options.previousOutcome } : {}),
      host,
      controlPlane: options.controlPlane ?? env.boundary,
      identity: options.identity ?? env.identity,
    },
  };
}

function durableCount(env: AttemptEnv): number {
  return env.boundary.durableAttempts(env.occurrenceId).length;
}

// ─── first attempt + correlation ────────────────────────────────────────────

test('WP-13A: successful first attempt records ordinal 1 with exact correlation', () => {
  const env = makeAttemptEnv();
  const { input } = executionInput(env, { scenario: 'completed' });
  const result = executeExecutionAttempt(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.ordinal, 1);
  assert.equal(result.attemptId, FIRST_ATTEMPT_ID);
  assert.equal(result.outcome.disposition, 'completed');
  assert.equal(result.outcome.retry.eligible, false);
  assert.equal(result.outcome.retry.reason, 'terminal-completed');
  assert.equal(durableCount(env), 1);
  assert.equal(result.observation.occurrenceId, env.occurrenceId);
  assert.equal(result.observation.attemptId, FIRST_ATTEMPT_ID);
  assert.equal(result.observation.sessionCorrelationId, 'sess-1');
  assert.equal(result.observation.turnCorrelationId, 'turn:0');
  const facts = env.boundary.durableAttempts(env.occurrenceId);
  assert.equal(facts[0]?.ordinal, 1);
  assert.equal(facts[0]?.attemptId, FIRST_ATTEMPT_ID);
  assert.equal(facts[0]?.runtimeGrantId, env.grantId);
});

test('WP-13A: observation mismatch (wrong session) fails closed', () => {
  const env = makeAttemptEnv();
  // The host reports a session id the captured events cannot produce.
  const { input } = executionInput(env, { hostOverrides: { reportSessionId: 'sess-9' } });
  const result = executeExecutionAttempt(input);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.category, 'EXEC-OBSERVATION-UNCORRELATED');
  assert.equal(result.code, 'observation.session-turn-mismatch');
  assert.equal(durableCount(env), 1, 'attempt was recorded but execution failed closed');
});

// ─── revalidation failures ──────────────────────────────────────────────────

test('WP-13A: revoked grant fails execution-time revalidation; nothing recorded', () => {
  const env = makeAttemptEnv();
  seedPayload(env.store, 'revocation-record', buildRevocationRecordPayload({
    recordId: 'pgw:l:ffffffffffffffffffffffffffffffff',
    createdAt: FIXED_NOW,
    targetRecordType: 'RuntimeGrant',
    targetRecordId: env.grantId,
    scope: 'execution-use',
    effectiveAt: FIXED_NOW,
    reasonCode: 'test-revocation',
    registry: makeRegistryContext(),
  }));
  const { input } = executionInput(env, { scenario: 'completed' });
  const result = executeExecutionAttempt(input);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.category, 'EXEC-REVALIDATION-FAILED');
  assert.equal(durableCount(env), 0, 'no attempt record on revalidation failure');
});

test('WP-13A: expired grant fails closed', () => {
  // Seed with the committed validity window (ends 2027-01-01); advance the
  // SAME trusted identity past the window: the grant is no longer current
  // at execution time.
  const env = makeAttemptEnv();
  env.identity.setNow('2028-01-01T00:00:00.000Z');
  const { input } = executionInput(env, { scenario: 'completed' });
  const result = executeExecutionAttempt(input);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.category, 'EXEC-REVALIDATION-FAILED');
  assert.equal(durableCount(env), 0);
});

// ─── enforcement gates ──────────────────────────────────────────────────────

test('WP-13A: missing live enforcement state fails closed (restart never auto-reactivates)', () => {
  const env = makeAttemptEnv();
  const { input } = executionInput(env, { hostOverrides: { enforcementState: () => ({ available: false }) } });
  const result = executeExecutionAttempt(input);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.category, 'EXEC-ENFORCEMENT-UNAVAILABLE');
  assert.equal(durableCount(env), 0);
});

test('WP-13A: stale enforcement (projection identity mismatch) fails closed', () => {
  const env = makeAttemptEnv();
  const { input } = executionInput(env, {
    hostOverrides: {
      enforcementState: () => ({
        available: true,
        active: true,
        mode: 'PROJECTED',
        projectionIdentity: 'pgw:g:ffffffffffffffffffffffffffffffff',
        permittedProfile: env.evidence.projectedAllowedTools,
        surfaceEntries: env.surface.entries,
      }),
    },
  });
  const result = executeExecutionAttempt(input);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.category, 'EXEC-ENFORCEMENT-STALE');
  assert.equal(result.code, 'enforcement.identity-mismatch');
});

test('WP-13A: surface drift fails the enforcement gate', () => {
  const env = makeAttemptEnv();
  const drifted = env.surface.entries.slice(0, env.surface.entries.length - 1);
  const { input } = executionInput(env, {
    hostOverrides: {
      enforcementState: () => ({
        available: true,
        active: true,
        mode: 'PROJECTED',
        projectionIdentity: env.evidence.projectionIdentity,
        permittedProfile: env.evidence.projectedAllowedTools,
        surfaceEntries: drifted,
      }),
    },
  });
  const result = executeExecutionAttempt(input);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.category, 'EXEC-ENFORCEMENT-STALE');
  assert.equal(result.code, 'enforcement.surface-drift');
});

test('WP-13A: uncorrelated enforcement evidence (grant mismatch) fails closed', () => {
  const env = makeAttemptEnv();
  const { input } = executionInput(env, {
    hostOverrides: {},
  });
  const input2: ExecutionAttemptInput = {
    ...input,
    enforcement: {
      evidence: env.evidence,
      activation: {
        decision: 'accepted',
        runtimeGrantId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        reservedOccurrenceId: env.occurrenceId,
        resolvedOccurrenceId: env.occurrenceId,
        attemptId: FIRST_ATTEMPT_ID,
        grantCurrent: true,
      },
    },
  };
  const result = executeExecutionAttempt(input2);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.category, 'EXEC-ENFORCEMENT-UNCORRELATED');
  assert.equal(durableCount(env), 0);
});

// ─── dispositions + classification ──────────────────────────────────────────

test('WP-13A: all seven dispositions map deterministically', () => {
  const cases: { readonly scenario: Scenario; readonly disposition: string; readonly retryable: boolean }[] = [
    { scenario: 'completed', disposition: 'completed', retryable: false },
    { scenario: 'cancelled', disposition: 'cancelled', retryable: true },
    { scenario: 'error', disposition: 'failed', retryable: true },
    { scenario: 'none', disposition: 'incomplete', retryable: false },
    { scenario: 'timed-out', disposition: 'timed-out', retryable: true },
    { scenario: 'crashed', disposition: 'crashed', retryable: true },
    { scenario: 'rejected', disposition: 'rejected', retryable: false },
  ];
  for (const c of cases) {
    const env = makeAttemptEnv();
    const { input } = executionInput(env, { scenario: c.scenario });
    const result = executeExecutionAttempt(input);
    assert.equal(result.ok, true, `${c.scenario}: ${JSON.stringify(result)}`);
    if (!result.ok) continue;
    assert.equal(result.outcome.disposition, c.disposition, c.scenario);
    assert.equal(result.outcome.retry.eligible, c.retryable, c.scenario);
  }
});

test('WP-13A: classifyDisposition is the committed terminal/retryable table', () => {
  assert.equal(classifyDisposition('failed'), 'retryable');
  assert.equal(classifyDisposition('cancelled'), 'retryable');
  assert.equal(classifyDisposition('timed-out'), 'retryable');
  assert.equal(classifyDisposition('crashed'), 'retryable');
  assert.equal(classifyDisposition('completed'), 'terminal');
  assert.equal(classifyDisposition('rejected'), 'terminal');
  assert.equal(classifyDisposition('incomplete'), 'terminal');
});

// ─── retry rule ─────────────────────────────────────────────────────────────

function failedOutcome(env: AttemptEnv, ordinal: number, attemptId: string): ExecutionAttemptOutcome {
  return {
    disposition: 'failed',
    occurrenceId: env.occurrenceId,
    attemptId,
    ordinal,
    observedAt: FIXED_NOW,
    retry: { eligible: true },
  };
}

test('WP-13A: retry proposes ordinal = durable count + 1 and executes a second attempt', () => {
  const env = makeAttemptEnv();
  const first = executeExecutionAttempt(executionInput(env, { scenario: 'error' }).input);
  assert.equal(first.ok, true, JSON.stringify(first));
  if (!first.ok) return;
  assert.equal(first.ordinal, 1);
  const second = executeExecutionAttempt(executionInput(env, { scenario: 'completed', previousOutcome: first.outcome }).input);
  assert.equal(second.ok, true, JSON.stringify(second));
  if (!second.ok) return;
  assert.equal(second.ordinal, 2);
  assert.equal(second.attemptId, SECOND_ATTEMPT_ID);
  assert.equal(second.outcome.disposition, 'completed');
  assert.equal(durableCount(env), 2);
  const facts = env.boundary.durableAttempts(env.occurrenceId);
  assert.deepEqual(facts.map((f) => f.ordinal), [1, 2]);
  assert.deepEqual(facts.map((f) => f.runtimeGrantId), [env.grantId, env.grantId]);
});

test('WP-13A: allowance exhausted fails closed', () => {
  const env = makeAttemptEnv(); // attempt_limit 2
  const first = executeExecutionAttempt(executionInput(env, { scenario: 'error' }).input);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = executeExecutionAttempt(executionInput(env, { scenario: 'error', previousOutcome: first.outcome }).input);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const third = executeExecutionAttempt(executionInput(env, { scenario: 'error', previousOutcome: second.outcome }).input);
  assert.equal(third.ok, false);
  if (third.ok) return;
  assert.equal(third.category, 'EXEC-REVALIDATION-FAILED', JSON.stringify(third));
  assert.equal(durableCount(env), 2);
});

test('WP-13A: terminal previous outcome denies the retry (completed)', () => {
  const env = makeAttemptEnv();
  const first = executeExecutionAttempt(executionInput(env, { scenario: 'completed' }).input);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const result = executeExecutionAttempt(executionInput(env, { scenario: 'completed', previousOutcome: first.outcome }).input);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.category, 'EXEC-RETRY-DENIED');
  assert.equal(result.code, 'retry.terminal-completed');
  assert.equal(durableCount(env), 1, 'no attempt recorded for a denied retry');
});

test('WP-13A: restart requiring fresh activation fails closed (no in-session basis)', () => {
  const env = makeAttemptEnv();
  const first = executeExecutionAttempt(executionInput(env, { scenario: 'error' }).input);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  // The host lost the in-session previous outcome (restart): a retry request
  // without it is ambiguous and fails closed; a fresh activation decision
  // (new occurrence) is required.
  const result = executeExecutionAttempt(executionInput(env, { scenario: 'error' }).input);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.category, 'EXEC-RETRY-AMBIGUOUS');
  assert.equal(result.code, 'retry.basis-ambiguous');
  assert.equal(durableCount(env), 1);
});

test('WP-13A: stale retry basis (outcome not the latest durable attempt) fails closed', () => {
  const env = makeAttemptEnv();
  const first = executeExecutionAttempt(executionInput(env, { scenario: 'error' }).input);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const stale = failedOutcome(env, 1, 'pgw:a:ffffffffffffffffffffffffffffffff');
  const result = executeExecutionAttempt(executionInput(env, { scenario: 'error', previousOutcome: stale }).input);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.category, 'EXEC-RETRY-AMBIGUOUS');
  assert.equal(result.code, 'retry.basis-stale');
});

test('WP-13A: EXE-006 subject mismatch (durable grant disagreement) fails closed', () => {
  const env = makeAttemptEnv();
  const first = executeExecutionAttempt(executionInput(env, { scenario: 'error' }).input);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  // A conflicting durable fact (different grant) as the LATEST attempt makes
  // retry subject stability unprovable; the retry fails closed (defense in
  // depth — WP-12 remains the authoritative gate).
  const conflicting: DurableAttemptFact = {
    recordId: 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    attemptId: 'pgw:a:22222222222222222222222222222222',
    ordinal: 2,
    runtimeGrantId: 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    bundle: first.observation.bundleReference as unknown as Readonly<Record<string, unknown>>,
  };
  const evaluation = evaluateRetryEligibility({
    occurrenceId: env.occurrenceId,
    workspaceId: WS_A,
    previousOutcome: { ...first.outcome, attemptId: conflicting.attemptId, ordinal: 2 },
    durableAttempts: [...env.boundary.durableAttempts(env.occurrenceId), conflicting],
    orchestration: { runtimeGrantId: env.grantId, grantCurrent: true, remainingAllowance: 1 },
  });
  assert.deepEqual(evaluation, { mayPropose: false, reason: 'subject-mismatch' });
});

test('WP-13A: retry evaluation is pure and explicit-request-only (no host execution)', () => {
  const env = makeAttemptEnv();
  const evaluation = evaluateRetryEligibility({
    occurrenceId: env.occurrenceId,
    workspaceId: WS_A,
    previousOutcome: undefined,
    durableAttempts: [],
    orchestration: { runtimeGrantId: env.grantId, grantCurrent: true, remainingAllowance: 2 },
  });
  assert.deepEqual(evaluation, { mayPropose: true, ordinal: 1 });
  // Evaluating eligibility never touches the host or the control plane.
  assert.equal(durableCount(env), 0);
});

test('WP-13A: evaluateRetryEligibility unit matrix', () => {
  const base = {
    occurrenceId: 'pgw:o:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    workspaceId: WS_A,
    orchestration: { runtimeGrantId: 'pgw:l:11111111111111111111111111111111', grantCurrent: true, remainingAllowance: 2 },
  };
  const bundle: Readonly<Record<string, unknown>> = Object.freeze({ target_kind: { id: 'ExecutionBundle' } });
  const attempts: readonly DurableAttemptFact[] = [
    Object.freeze({ recordId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', attemptId: 'pgw:a:11111111111111111111111111111111', ordinal: 1, runtimeGrantId: 'pgw:l:11111111111111111111111111111111', bundle }),
  ];
  const retryable = (over: Partial<ExecutionAttemptOutcome> = {}): ExecutionAttemptOutcome => ({
    disposition: 'failed',
    occurrenceId: base.occurrenceId,
    attemptId: 'pgw:a:11111111111111111111111111111111',
    ordinal: 1,
    observedAt: FIXED_NOW,
    retry: { eligible: true },
    ...over,
  });
  assert.deepEqual(evaluateRetryEligibility({ ...base, previousOutcome: undefined, durableAttempts: [] }), { mayPropose: true, ordinal: 1 });
  assert.deepEqual(evaluateRetryEligibility({ ...base, previousOutcome: retryable(), durableAttempts: attempts }), { mayPropose: true, ordinal: 2 });
  assert.deepEqual(evaluateRetryEligibility({ ...base, previousOutcome: retryable({ disposition: 'completed' }), durableAttempts: attempts }), { mayPropose: false, reason: 'terminal-completed' });
  assert.deepEqual(evaluateRetryEligibility({ ...base, previousOutcome: retryable({ disposition: 'incomplete' }), durableAttempts: attempts }), { mayPropose: false, reason: 'terminal-ambiguous' });
  assert.deepEqual(evaluateRetryEligibility({ ...base, previousOutcome: retryable({ disposition: 'rejected' }), durableAttempts: attempts }), { mayPropose: false, reason: 'terminal-rejected' });
  assert.deepEqual(evaluateRetryEligibility({ ...base, previousOutcome: retryable({ attemptId: 'pgw:a:99999999999999999999999999999999' }), durableAttempts: attempts }), { mayPropose: false, reason: 'basis-stale' });
  assert.deepEqual(evaluateRetryEligibility({ ...base, previousOutcome: retryable(), durableAttempts: [] }), { mayPropose: false, reason: 'basis-ambiguous' });
  assert.deepEqual(evaluateRetryEligibility({ ...base, previousOutcome: undefined, durableAttempts: attempts }), { mayPropose: false, reason: 'basis-ambiguous' });
  assert.deepEqual(
    evaluateRetryEligibility({
      ...base,
      previousOutcome: retryable(),
      durableAttempts: [Object.freeze({ ...attempts[0]!, runtimeGrantId: 'pgw:l:99999999999999999999999999999999' })],
    }),
    { mayPropose: false, reason: 'subject-mismatch' },
  );
  assert.deepEqual(evaluateRetryEligibility({ ...base, previousOutcome: retryable(), durableAttempts: attempts, orchestration: { ...base.orchestration, grantCurrent: false } }), { mayPropose: false, reason: 'grant-not-current' });
  assert.deepEqual(evaluateRetryEligibility({ ...base, previousOutcome: retryable(), durableAttempts: attempts, orchestration: { ...base.orchestration, remainingAllowance: 0 } }), { mayPropose: false, reason: 'allowance-exhausted' });
});

// ─── host boundary + no-production guarantees ───────────────────────────────

test('WP-13A: host boundary exception is contained (no raw text leaks)', () => {
  const env = makeAttemptEnv();
  const { input } = executionInput(env, { hostOverrides: { throwOnExecute: true } });
  const result = executeExecutionAttempt(input);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.category, 'EXEC-HOST-FAILURE');
  assert.equal(result.message.includes('boom'), false);
  assert.equal(result.message.includes('Error'), false);
});

test('WP-13A: no result/receipt production on success (attempt record only)', () => {
  const env = makeAttemptEnv();
  const { input } = executionInput(env, { scenario: 'completed' });
  const result = executeExecutionAttempt(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // The result carries no ExecutionResult / ResultPublicationRecord /
  // TrustedReceipt surface.
  assert.deepEqual(Object.keys(result).sort(), ['attemptId', 'attemptRecordId', 'observation', 'ok', 'ordinal', 'outcome']);
  // The store gained exactly the attempt record: no result-publication-record
  // and no trusted-receipt class exists.
  const publications = env.store.enumerateLifecycleRecords('result-publication-record');
  const receipts = env.store.enumerateLifecycleRecords('trusted-receipt');
  assert.equal(publications.ok, true);
  assert.equal(receipts.ok, true);
  assert.equal(publications.recordIds.length, 0);
  assert.equal(receipts.recordIds.length, 0);
});

test('WP-13A: malformed request operands fail closed as EXEC-INPUT-INVALID', () => {
  const env = makeAttemptEnv();
  const { input } = executionInput(env);
  for (const request of [
    { workspaceId: 'not-a-workspace', reservedOccurrenceId: env.occurrenceId },
    { workspaceId: WS_A, reservedOccurrenceId: 'not-an-occurrence' },
    { workspaceId: WS_A },
  ]) {
    const result = executeExecutionAttempt({ ...input, request: request as ExecutionAttemptInput['request'] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'EXEC-INPUT-INVALID');
  }
  assert.equal(durableCount(env), 0);
});

// ─── SIR-WP13A-001: boundary containment (malformed containers + throwing
// ─── boundary members; raw text never escapes; no Pi execution after a
// ─── pre-execution boundary failure) ────────────────────────────────────────

const SIR_SECRET = 'SIR-WP13A-RAW-SECRET-MUST-NOT-LEAK';

function assertContained(result: ExecutionAttemptResult, category: ExecutionFailureCategory, code: string): ExecutionAttemptFailure {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected a failure result');
  assert.equal(result.category, category);
  assert.equal(result.code, code);
  assert.ok(!result.message.includes(SIR_SECRET), 'raw exception text leaked into the message');
  assert.ok(!result.code.includes(SIR_SECRET), 'raw exception text leaked into the code');
  return result;
}

function throwingControlPlane(env: AttemptEnv, member: 'orchestrationDecision' | 'durableAttempts' | 'recordExecutionAttempt'): ControlPlaneExecutionBoundary {
  const base = env.boundary;
  if (member === 'orchestrationDecision') {
    return { ...base, orchestrationDecision: () => { throw new Error(SIR_SECRET); } };
  }
  if (member === 'durableAttempts') {
    return { ...base, durableAttempts: () => { throw new Error(SIR_SECRET); } };
  }
  return { ...base, recordExecutionAttempt: () => { throw new Error(SIR_SECRET); } };
}

function throwingHost(env: AttemptEnv, member: 'readEnforcementState' | 'projectPlan'): ExecutionHostBoundary {
  const base = makeFakeHost(env.kitWorld, env.occurrenceId, {
    scenario: 'completed',
    enforcementState: () => liveSnapshotFrom(env.evidence, env.surface),
  });
  if (member === 'readEnforcementState') {
    return { ...base, readEnforcementState: () => { throw new Error(SIR_SECRET); } };
  }
  return { ...base, projectPlan: () => { throw new Error(SIR_SECRET); } };
}

test('WP-13A: enforcement container undefined/null fails closed as EXEC-INPUT-INVALID', () => {
  const env = makeAttemptEnv();
  const { input } = executionInput(env);
  for (const enforcement of [undefined, null]) {
    const result = executeExecutionAttempt({ ...input, enforcement: enforcement as never });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.category, 'EXEC-INPUT-INVALID');
      assert.equal(result.code, 'input.enforcement-invalid');
    }
  }
  assert.equal(durableCount(env), 0);
});

test('WP-13A: missing/non-function boundary members fail closed as EXEC-INPUT-INVALID', () => {
  const env = makeAttemptEnv();
  const bad = { ...env.boundary, orchestrationDecision: 'not-a-function' as unknown as ControlPlaneExecutionBoundary['orchestrationDecision'] };
  const { input } = executionInput(env, { controlPlane: bad });
  const result = executeExecutionAttempt(input);
  assertContained(result, 'EXEC-INPUT-INVALID', 'input.boundary-invalid');
  assert.equal(durableCount(env), 0);
});

test('WP-13A: throwing orchestrationDecision is contained (EXEC-INTERNAL-FAILURE); nothing recorded, nothing executed', () => {
  const env = makeAttemptEnv();
  const { input, host } = executionInput(env, { controlPlane: throwingControlPlane(env, 'orchestrationDecision') });
  const result = executeExecutionAttempt(input);
  assertContained(result, 'EXEC-INTERNAL-FAILURE', 'control-plane.orchestration-exception');
  assert.equal(durableCount(env), 0);
  assert.equal(host.counters?.execute ?? 0, 0, 'no Pi execution after a pre-execution boundary failure');
});

test('WP-13A: throwing durableAttempts is contained (EXEC-INTERNAL-FAILURE); nothing recorded, nothing executed', () => {
  const env = makeAttemptEnv();
  const { input, host } = executionInput(env, { controlPlane: throwingControlPlane(env, 'durableAttempts') });
  const result = executeExecutionAttempt(input);
  assertContained(result, 'EXEC-INTERNAL-FAILURE', 'control-plane.attempts-exception');
  assert.equal(durableCount(env), 0);
  assert.equal(host.counters?.execute ?? 0, 0, 'no Pi execution after a pre-execution boundary failure');
});

test('WP-13A: throwing recordExecutionAttempt is contained (EXEC-INTERNAL-FAILURE); nothing recorded, nothing executed', () => {
  const env = makeAttemptEnv();
  const { input, host } = executionInput(env, { controlPlane: throwingControlPlane(env, 'recordExecutionAttempt') });
  const result = executeExecutionAttempt(input);
  assertContained(result, 'EXEC-INTERNAL-FAILURE', 'control-plane.attempt-recording-exception');
  assert.equal(durableCount(env), 0);
  assert.equal(host.counters?.execute ?? 0, 0, 'no Pi execution after a pre-execution boundary failure');
});

test('WP-13A: throwing readEnforcementState is contained (EXEC-HOST-FAILURE); nothing recorded, nothing executed', () => {
  const env = makeAttemptEnv();
  const { input, host } = executionInput(env, { host: throwingHost(env, 'readEnforcementState') });
  const result = executeExecutionAttempt(input);
  assertContained(result, 'EXEC-HOST-FAILURE', 'host.enforcement-state-exception');
  assert.equal(durableCount(env), 0);
  assert.equal(host.counters?.execute ?? 0, 0, 'no Pi execution after a pre-execution boundary failure');
});

test('WP-13A: throwing projectPlan is contained (EXEC-HOST-FAILURE); nothing executed', () => {
  const env = makeAttemptEnv();
  const { input, host } = executionInput(env, { host: throwingHost(env, 'projectPlan') });
  const result = executeExecutionAttempt(input);
  assertContained(result, 'EXEC-HOST-FAILURE', 'host.plan-exception');
  assert.equal(durableCount(env), 1, 'the attempt was recorded before plan projection');
  assert.equal(host.counters?.execute ?? 0, 0, 'no Pi execution after a pre-execution boundary failure');
});

test('WP-13A: throwing nowUtcIso is contained (EXEC-INTERNAL-FAILURE); raw text never leaks', () => {
  const env = makeAttemptEnv();
  const { input } = executionInput(env, { identity: { nowUtcIso: () => { throw new Error(SIR_SECRET); } } });
  const result = executeExecutionAttempt(input);
  assertContained(result, 'EXEC-INTERNAL-FAILURE', 'identity.time-source-invalid');
  assert.equal(durableCount(env), 1, 'the attempt record stands; the outcome construction failed closed');
});

test('WP-13A: throwing host.execute is contained (EXEC-HOST-FAILURE); raw text never leaks', () => {
  const env = makeAttemptEnv();
  const base = makeFakeHost(env.kitWorld, env.occurrenceId, {
    scenario: 'completed',
    enforcementState: () => liveSnapshotFrom(env.evidence, env.surface),
  });
  const { input } = executionInput(env, { host: { ...base, execute: () => { throw new Error(SIR_SECRET); } } });
  const result = executeExecutionAttempt(input);
  assertContained(result, 'EXEC-HOST-FAILURE', 'host.unexpected-exception');
  assert.equal(durableCount(env), 1, 'the attempt was recorded before execution');
});

// ─── SIR-WP13A-001(a): malformed host.execute RETURN shapes ────────────────

function malformedHostExecute(env: AttemptEnv, value: unknown): ExecutionHostBoundary {
  const base = makeFakeHost(env.kitWorld, env.occurrenceId, {
    scenario: 'completed',
    enforcementState: () => liveSnapshotFrom(env.evidence, env.surface),
  });
  return { ...base, execute: () => value as never };
}

test('WP-13A: host.execute null/primitive/array returns fail closed as EXEC-HOST-FAILURE', () => {
  for (const value of [null, 42, 'done', ['facts']]) {
    const env = makeAttemptEnv();
    const { input } = executionInput(env, { host: malformedHostExecute(env, value) });
    const result = executeExecutionAttempt(input);
    assertContained(result, 'EXEC-HOST-FAILURE', 'host.execution-result-malformed');
    assert.equal(durableCount(env), 1, `attempt remained recorded for ${JSON.stringify(value)}`);
  }
});

test('WP-13A: incomplete {ok:true} execute result fails closed; no fabricated identity', () => {
  const env = makeAttemptEnv();
  const { input } = executionInput(env, { host: malformedHostExecute(env, { ok: true }) });
  const result = executeExecutionAttempt(input);
  const contained = assertContained(result, 'EXEC-HOST-FAILURE', 'host.execution-result-malformed');
  assert.ok(!contained.code.includes('undefined') && !contained.message.includes('undefined'), 'no fabricated identity text');
  assert.equal(durableCount(env), 1);
});

test('WP-13A: malformed {ok:false} execute result (missing code) fails closed', () => {
  const env = makeAttemptEnv();
  const { input } = executionInput(env, { host: malformedHostExecute(env, { ok: false }) });
  const result = executeExecutionAttempt(input);
  assertContained(result, 'EXEC-HOST-FAILURE', 'host.execution-result-malformed');
  assert.equal(durableCount(env), 1);
});

test('WP-13A: object-valued host failure message is discarded; fixed bounded message used', () => {
  const env = makeAttemptEnv();
  const secretObject = { nested: { marker: SIR_SECRET } };
  const { input } = executionInput(env, { host: malformedHostExecute(env, { ok: false, code: 'host-said-no', message: secretObject }) });
  const result = executeExecutionAttempt(input);
  const contained = assertContained(result, 'EXEC-HOST-FAILURE', 'host.execute-failed:host-said-no');
  assert.equal(contained.message, 'the Pi host failed the execution attempt');
  assert.ok(!contained.message.includes(SIR_SECRET) && !contained.code.includes(SIR_SECRET), 'secret host content never reaches findings');
  assert.equal(durableCount(env), 1);
});

// ─── SIR-WP13A-001(b): malformed orchestration evidence RETURN shapes ──────

function malformedControlPlane(env: AttemptEnv, member: 'orchestrationDecision' | 'recordExecutionAttempt', value: unknown): ControlPlaneExecutionBoundary {
  const base = env.boundary;
  if (member === 'orchestrationDecision') {
    return { ...base, orchestrationDecision: () => value as never };
  }
  return { ...base, recordExecutionAttempt: () => value as never };
}

const VALID_ORCHESTRATION_EVIDENCE = {
  outcome: 'orchestrated',
  grantCurrent: true,
  remainingAllowance: 1,
  runtimeGrantId: 'pgw:l:cccccccccccccccccccccccccccccccc',
  workspaceId: WS_A,
  occurrenceRecordId: 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  activationRecordId: 'pgw:l:dddddddddddddddddddddddddddddddd',
  subject: {
    protocolId: 'project-gateway.artifact',
    protocolVersion: '1.0',
    kindId: 'ExecutionBundle',
    kindVersion: '1.0',
    instanceId: 'pgw:i:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    revisionId: 'pgw:r:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    digest: 'sha-256:' + 'a'.repeat(64),
    workspaceId: WS_A,
  },
};

test('WP-13A: orchestration evidence missing subject fails closed as EXEC-INTERNAL-FAILURE', () => {
  const env = makeAttemptEnv();
  const malformed = { ok: true, evidence: { ...VALID_ORCHESTRATION_EVIDENCE, subject: undefined } };
  const { input, host } = executionInput(env, { controlPlane: malformedControlPlane(env, 'orchestrationDecision', malformed) });
  const result = executeExecutionAttempt(input);
  assertContained(result, 'EXEC-INTERNAL-FAILURE', 'control-plane.orchestration-malformed');
  assert.equal(durableCount(env), 0);
  assert.equal(host.counters?.execute ?? 0, 0, 'no Pi execution after the malformed revalidation result');
});

test('WP-13A: malformed orchestration subject identity fails closed as EXEC-INTERNAL-FAILURE', () => {
  const env = makeAttemptEnv();
  const malformed = { ok: true, evidence: { ...VALID_ORCHESTRATION_EVIDENCE, subject: { ...VALID_ORCHESTRATION_EVIDENCE.subject, instanceId: 42 } } };
  const { input, host } = executionInput(env, { controlPlane: malformedControlPlane(env, 'orchestrationDecision', malformed) });
  const result = executeExecutionAttempt(input);
  assertContained(result, 'EXEC-INTERNAL-FAILURE', 'control-plane.orchestration-malformed');
  assert.equal(durableCount(env), 0);
  assert.equal(host.counters?.execute ?? 0, 0);
});

// ─── SIR-WP13A-001(c): attempt-record evidence with no valid identity ──────

test('WP-13A: attempt evidence without valid attempt/record id fails closed; no String(undefined) fabrication', () => {
  const env = makeAttemptEnv();
  const malformed = { ok: true, evidence: { outcome: 'attempt-recorded', attemptId: undefined, ordinal: 1, recordId: undefined } };
  const { input, host } = executionInput(env, { controlPlane: malformedControlPlane(env, 'recordExecutionAttempt', malformed) });
  const result = executeExecutionAttempt(input);
  const contained = assertContained(result, 'EXEC-INTERNAL-FAILURE', 'control-plane.attempt-recording-malformed');
  assert.ok(!contained.code.includes('undefined') && !contained.message.includes('undefined'), 'no fabricated identity text');
  assert.equal(durableCount(env), 0, 'nothing was durably recorded');
  assert.equal(host.counters?.execute ?? 0, 0, 'no Pi execution after the malformed recording result');
});

test('WP-13A: garbage attempt id (non-syntax) fails closed as EXEC-INTERNAL-FAILURE', () => {
  const env = makeAttemptEnv();
  const malformed = { ok: true, evidence: { outcome: 'attempt-recorded', attemptId: 'undefined', ordinal: 1, recordId: 'undefined' } };
  const { input } = executionInput(env, { controlPlane: malformedControlPlane(env, 'recordExecutionAttempt', malformed) });
  const result = executeExecutionAttempt(input);
  assertContained(result, 'EXEC-INTERNAL-FAILURE', 'control-plane.attempt-recording-malformed');
  assert.equal(durableCount(env), 0);
});
