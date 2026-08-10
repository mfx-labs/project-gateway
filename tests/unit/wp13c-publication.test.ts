/**
 * WP-13C — trusted result publication FOCUSED tests.
 *
 * Real initialized WP-8 store, real WP-12 grant/activation/occurrence/
 * attempt chain (record builders, seedPayload), real WP-13B completion flow
 * (observation + enforcement + WP-4 + recordValidation) producing the real
 * handoff + durable ValidationRecord, and the real WP-13C publication
 * authority (attempt-level lock, under-lock re-read, WP-8 publishRecord via
 * the permit-gated single-class boundary).
 *
 * Covers: first publication, exact replay (no second write), different
 * result instance / material divergence conflicts, scope/receipt operand
 * rejection, ValidationRecord binding failures, stale/current-state
 * failures, capability forgery/replay/stale-generation, in-flight lock
 * contention, different-attempt independence, publishRecord failure under
 * the lock, opaque record identity, no TrustedReceipt /
 * ExecutionRetrospectiveFacts production.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanupTestEnvs, grantChainSubjects, makeContext, makeIdentitySource, makeIntegrationEnv, makeRegistryContext, seedPayload, UID, WS_A, FIXED_NOW, WRITE_ACTION } from './wp12-helpers.js';
import { buildWorld, corpusArtifactSet, SUPPORT } from '../pi-adapter/helpers.js';
import { projectExecutionBundleToPi } from '../../src/adapters/pi/projection.js';
import { createPiHostBridge, observePiExecution, isPiExecutionObservation } from '../../src/adapters/pi/index.js';
import { mockSurface, fire, hostCtx, type MockSurface } from '../pi-adapter/unit/mock-surface.js';
import { createFakeGuard, verifiedPackageInspection } from '../pi-adapter/enforcement/fake-guard.js';
import { standardSurface, HOST_TIMESTAMP, TIMESTAMP_SOURCE } from '../pi-adapter/enforcement/world.js';
import { runTrustedEnforcement } from '../../src/adapters/pi/enforcement/index.js';
import { validateArtifactSelf, createSchemaRegistry } from '../../src/api/validate.js';
import { createResultValidationBoundary, completeExecution, COMPLETION_EVALUATOR_ID, COMPLETION_EVALUATOR_CAPABILITY_PROFILE_ID } from '../../src/completion/index.js';
import {
  buildValidationRecordPayload,
  buildApprovalRecordPayload,
  buildIssuanceRecordPayload,
  buildRuntimeGrantPayload,
  buildActivationRecordPayload,
  buildExecutionOccurrenceRecordPayload,
  buildExecutionAttemptRecordPayload,
  registryReferenceFor,
} from '../../src/control-plane/records.js';
import { publishValidatedResult, createPublicationStoreBoundary } from '../../src/publication/index.js';
import { enumerateClass } from '../../src/storage/read/index.js';
import { createResultPublicationCapability } from '../../src/publication/capability.js';
import { createOutcomeStoreBoundary } from '../../src/outcome/index.js';
import { createPublicationOutcomePrecondition } from '../../src/internal/publication-outcome-context.js';
import { createProcessLocalCoordinator, LockContentionError } from '../../src/control-plane/coordination.js';
import { defaultLimitProfile } from '../../src/storage/limits/limits.js';
import { seedRawRecord } from './wp12-helpers.js';
import type { PiInvocationPlan, PiExecutionObservation } from '../../src/adapters/pi/types.js';
import type { ExecutionAttemptOutcome } from '../../src/execution/types.js';
import type { ValidatedArtifact } from '../../src/api/types.js';
import type { ControlPlaneStoreBoundary, ControlPlaneTrustedContext } from '../../src/control-plane/types.js';
import type { PublicationInput, PublicationResult, PublicationStoreBoundary } from '../../src/publication/types.js';
import type { ValidatedResultHandoff } from '../../src/completion/types.js';
import type { AcceptedRegistryContext } from '../../src/api/types.js';

const OCCURRENCE_ID = 'pgw:o:' + 'a'.repeat(32);
const ATTEMPT_ID = 'pgw:a:' + '1'.repeat(32);
const ATTEMPT_RECORD_ID = 'pgw:l:' + '2'.repeat(32);
const OCCURRENCE_RECORD_ID = 'pgw:l:' + '3'.repeat(32);
const ACTIVATION_RECORD_ID = 'pgw:l:' + '4'.repeat(32);
const GRANT_ID = 'pgw:l:' + '5'.repeat(32);
const LATER = '2026-08-05T06:00:00.000Z';
// SIR-WP13C-001 CLOSED by commit 02bce4bb (WP-13B provenance amendment):
// the real WP-13B handoff now carries the canonical schema-valid opaque
// provenance identities. The integration tests consume the REAL handoff
// unchanged — no mutation, no translation, no normalization.

const registry = createSchemaRegistry();
const contractArtifact: ValidatedArtifact = (() => {
  const report = validateArtifactSelf(corpusArtifactSet().completion, registry);
  if (report.ok !== true || report.value === undefined) throw new Error('completion contract fixture failed self-validation');
  return report.value;
})();

const roots: string[] = [];
after(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  cleanupTestEnvs();
});

// ─── WP-13B completion machinery (real flow) ────────────────────────────────

function makePlan(): PiInvocationPlan {
  const world = buildWorld();
  const result = projectExecutionBundleToPi({ ...world.input(), occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID });
  if (!result.ok || result.plan === undefined) throw new Error('plan projection failed');
  return result.plan;
}

function makeObservation(): PiExecutionObservation {
  const plan = makePlan();
  const surface = mockSurface();
  const wired = createPiHostBridge(surface, plan);
  if (!wired.ok || wired.bridge === undefined) throw new Error('bridge wiring failed');
  const s = surface as MockSurface;
  fire(s, 'session_start', { reason: 'startup' }, hostCtx('sess-1'));
  fire(s, 'turn_start', { turnIndex: 0, timestamp: 1000 });
  fire(s, 'message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'task complete' }] } });
  fire(s, 'agent_settled', {});
  fire(s, 'session_shutdown', { reason: 'quit' });
  const bridge = wired.bridge;
  if (bridge.sessionCorrelationId === undefined || bridge.turnCorrelationId === undefined) throw new Error('no session/turn correlation');
  const obs = observePiExecution(bridge, { sessionCorrelationId: bridge.sessionCorrelationId, turnCorrelationId: bridge.turnCorrelationId });
  if (!isPiExecutionObservation(obs)) throw new Error('observation not branded');
  return obs;
}

function makeEnforcementFingerprint(): string {
  const fake = createFakeGuard('normal');
  const surface = standardSurface();
  const world = buildWorld();
  const plan = makePlan();
  const result = runTrustedEnforcement({
    plan,
    eligibility: world.eligibility,
    activation: {
      decision: 'accepted',
      runtimeGrantId: GRANT_ID,
      reservedOccurrenceId: OCCURRENCE_ID,
      resolvedOccurrenceId: OCCURRENCE_ID,
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
  if (!result.ok) throw new Error('enforcement evidence failed');
  return result.evidence.evidenceFingerprint;
}

function makeOutcome(): ExecutionAttemptOutcome {
  return {
    disposition: 'completed',
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    ordinal: 1,
    observedAt: FIXED_NOW,
    retry: { eligible: false, reason: 'terminal-completed' },
  };
}

// ─── lifecycle chain seeding (real WP-8 store; record builders) ─────────────

interface SeededChain {
  readonly bundleReference: Readonly<Record<string, unknown>>;
  readonly grantId: string;
  readonly activationRecordId: string;
  readonly occurrenceRecordId: string;
  readonly attemptRecordId: string;
  readonly occurrenceId: string;
  readonly attemptId: string;
}

/**
 * Seed the genuine five-subject chain (validation/approval/issuance) +
 * runtime-grant + accepted activation + occurrence + attempt record into the
 * store (accepted record builders; the WP-12 attempt-chain pattern). The
 * occurrence/attempt bundle reference is byte-identical to the grant's by
 * construction and equals the WP-13B projected bundle reference.
 */
function seedPublicationChain(store: ControlPlaneStoreBoundary, registryCtx: AcceptedRegistryContext): SeededChain {
  const workspaceId = WS_A;
  const subjects = [grantChainSubjects(workspaceId).bundle, ...grantChainSubjects(workspaceId).members];
  const id = (base: number): string => `pgw:l:${base.toString(16).padStart(32, '0')}`;
  for (let k = 0; k < subjects.length; k += 1) {
    const info = subjects[k]!;
    const validationId = id(0x6000 + k);
    seedPayload(store, 'validation-record', buildValidationRecordPayload({ recordId: validationId, createdAt: FIXED_NOW, subject: info.subject, registry: registryCtx }));
    const approvalId = id(0x6100 + k);
    seedPayload(store, 'approval-record', buildApprovalRecordPayload({
      recordId: approvalId, createdAt: FIXED_NOW, subject: info.subject, workspaceId,
      purpose: 'execution-use', validationRecordIds: [validationId],
      requiredSemantics: { protocol_features: [], consumer_capabilities: [] }, validUntil: null, registry: registryCtx,
    }));
    const issuanceId = id(0x6200 + k);
    seedPayload(store, 'issuance-record', buildIssuanceRecordPayload({
      recordId: issuanceId, createdAt: FIXED_NOW, subject: info.subject, workspaceId,
      useClass: 'execution-use', approvalRecordId: approvalId, activationLimit: 1, validUntil: null, registry: registryCtx,
    }));
  }
  const bundleSubject = subjects[0]!.subject;
  const bundleReference: Readonly<Record<string, unknown>> = Object.freeze({
    target_protocol_version: bundleSubject.protocolVersion,
    target_kind: Object.freeze({ id: bundleSubject.kindId, version: bundleSubject.kindVersion }),
    target_instance_id: bundleSubject.instanceId,
    target_revision_id: bundleSubject.revisionId,
    target_digest: bundleSubject.digest,
    target_workspace_binding: Object.freeze({ mode: 'bound', workspace_id: workspaceId }),
  });
  seedPayload(store, 'runtime-grant', buildRuntimeGrantPayload({
    recordId: GRANT_ID, createdAt: FIXED_NOW, subject: bundleSubject, workspaceId,
    reservedOccurrenceId: OCCURRENCE_ID, attemptLimit: 3,
    validity: { not_before: FIXED_NOW, not_after: LATER },
    narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    registry: registryCtx,
  }));
  seedPayload(store, 'activation-record', buildActivationRecordPayload({
    recordId: ACTIVATION_RECORD_ID, createdAt: FIXED_NOW, subject: bundleSubject, workspaceId,
    requiredIssuanceRecordIds: Object.freeze([]), runtimeGrantId: GRANT_ID,
    reservedOccurrenceId: OCCURRENCE_ID, decision: 'accepted', registry: registryCtx,
  }));
  seedPayload(store, 'execution-occurrence-record', buildExecutionOccurrenceRecordPayload({
    recordId: OCCURRENCE_RECORD_ID, createdAt: FIXED_NOW, activationRecordId: ACTIVATION_RECORD_ID,
    bundle: bundleReference, workspaceId, occurrenceId: OCCURRENCE_ID, runtimeGrantId: GRANT_ID, registry: registryCtx,
  }));
  seedPayload(store, 'execution-attempt-record', buildExecutionAttemptRecordPayload({
    recordId: ATTEMPT_RECORD_ID, createdAt: FIXED_NOW, activationRecordId: ACTIVATION_RECORD_ID,
    occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID, ordinal: 1,
    bundle: bundleReference, workspaceId, runtimeGrantId: GRANT_ID, registry: registryCtx,
  }));
  return { bundleReference, grantId: GRANT_ID, activationRecordId: ACTIVATION_RECORD_ID, occurrenceRecordId: OCCURRENCE_RECORD_ID, attemptRecordId: ATTEMPT_RECORD_ID, occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID };
}

/** Seed a durable ValidationRecord for the exact result subject (adoption/corner fixtures). */
function seedResultValidation(store: ControlPlaneStoreBoundary, registryCtx: AcceptedRegistryContext, handoff: ValidatedResultHandoff, recordId: string): void {
  seedPayload(store, 'validation-record', buildValidationRecordPayload({
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
    registry: registryCtx,
  }));
}

// ─── publication environment ────────────────────────────────────────────────

let recordIdCounter = 0x7000;
function nextRecordId(): string {
  return `pgw:l:${(recordIdCounter++).toString(16).padStart(32, '0')}`;
}

interface PublicationEnv {
  readonly integration: ReturnType<typeof makeIntegrationEnv>;
  readonly registryCtx: AcceptedRegistryContext;
  readonly chain: SeededChain;
  readonly wp12Context: ControlPlaneTrustedContext;
  readonly handoff: ValidatedResultHandoff;
  readonly store: ControlPlaneStoreBoundary;
  readonly boundary: ReturnType<typeof createPublicationStoreBoundary>;
  readonly capability: NonNullable<ReturnType<typeof createResultPublicationCapability>>;
  /** The genuine S2 outcome store boundary (WP-13 durability S3). */
  readonly outcomeBoundary: ReturnType<typeof createOutcomeStoreBoundary>;
  /** The branded outcome-precondition context (minted here; S3 host-composition pattern). */
  readonly outcomePrecondition: NonNullable<ReturnType<typeof createPublicationOutcomePrecondition>>;
  readonly root: string;
  /** The exact publication input (reusable; mutating copies per test). */
  input(overrides?: Partial<PublicationInput>): PublicationInput;
  publishCount(): number;
}

/** Seed one schema-valid exact-material ExecutionOutcomeRecord for a handoff (S3 precondition fixture). */
function seedOutcomeFor(env: PublicationEnv, handoff: ValidatedResultHandoff, attemptRecordId: string = ATTEMPT_RECORD_ID, overrides: Partial<Readonly<Record<string, unknown>>> = {}): string {
  const payload = Object.freeze({
    record_type: 'ExecutionOutcomeRecord',
    record_id: nextRecordId(),
    created_at: FIXED_NOW,
    responsible_role: 'trusted-execution-outcome-recorder',
    registry_snapshot_reference: registryReferenceFor(env.registryCtx),
    workspace_id: handoff.workspaceId,
    bundle: Object.freeze({ ...handoff.bundleReference }),
    occurrence_id: handoff.occurrenceId,
    attempt_id: handoff.attemptId,
    ordinal: handoff.ordinal,
    execution_attempt_record_id: attemptRecordId,
    disposition: 'completed',
    observation_evidence: Object.freeze({
      kind: 'external-evidence',
      evidence_id: 'pgw:e:' + '0'.repeat(32),
      content_digest: 'sha-256:' + '1'.repeat(64),
      declared_media_type: 'application/json',
      observation_role: 'evaluation-evidence',
    }),
    result_association: Object.freeze({
      instance_id: handoff.resultInstanceId,
      revision_digest: handoff.resultDigest,
      association_mode: handoff.associationMode,
      validation_record_id: handoff.validationRecordId,
    }),
    ...overrides,
  });
  return seedRawRecord(env.integration.storeEnv, 'execution-outcome-record', payload);
}

function makeEnv(): PublicationEnv {
  const integration = makeIntegrationEnv();
  const registryCtx = makeRegistryContext();
  const identity = makeIdentitySource();
  const wp12Context = makeContext(integration.storeEnv, { identity });
  const chain = seedPublicationChain(wp12Context.store, registryCtx);

  // Real WP-13B completion flow → real handoff + durable ValidationRecord.
  const root = mkdtempSync(join(tmpdir(), 'wp13c-'));
  roots.push(root);
  mkdirSync(join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID), { recursive: true });
  const boundary13b = createResultValidationBoundary(wp12Context);
  const completion = completeExecution({
    workspaceId: WS_A,
    attempt: {
      occurrenceId: OCCURRENCE_ID,
      attemptId: ATTEMPT_ID,
      ordinal: 1,
      attemptRecordId: ATTEMPT_RECORD_ID,
      occurrenceRecordId: OCCURRENCE_RECORD_ID,
      activationRecordId: ACTIVATION_RECORD_ID,
      runtimeGrantId: GRANT_ID,
    },
    outcome: makeOutcome(),
    observation: makeObservation(),
    completionContract: contractArtifact,
    enforcementEvidence: { evidenceFingerprint: makeEnforcementFingerprint() },
    resultRoot: root,
    serviceUid: process.getuid?.() ?? 0,
    schemaRegistry: registry,
    controlPlane: boundary13b,
    identitySource: {
      newResultInstanceId: () => 'pgw:i:' + 'a'.repeat(32),
      newResultRevisionId: () => 'pgw:r:' + 'b'.repeat(32),
      newEvidenceId: () => 'pgw:e:' + 'c'.repeat(32),
    },
  });
  if (!completion.ok || completion.decision !== 'produced') throw new Error(`completion failed: ${JSON.stringify(completion)}`);
  // The REAL WP-13B handoff, consumed unchanged: the amended WP-13B baseline
  // emits the canonical pgw:ev:/pgw:cp: provenance identities, so the
  // authority's exact-equality re-correlation holds without any patching.
  const handoff = completion.handoff;

  const boundary = createPublicationStoreBoundary({
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
  });
  const capability = createResultPublicationCapability({
    trustedConfiguration: integration.storeEnv.config,
    actionIdentity: 'result-publication-action-1',
  });
  if (capability === undefined) throw new Error('capability minting failed');
  // WP-13 durability S3: the genuine S2 outcome boundary + branded
  // outcome-precondition context (the trusted host-composition pattern).
  const outcomeBoundary = createOutcomeStoreBoundary({
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
  const outcomePrecondition = createPublicationOutcomePrecondition(outcomeBoundary);
  if (outcomePrecondition === undefined) throw new Error('outcome precondition minting failed');

  let publishCalls = 0;
  const countingStore: PublicationStoreBoundary = {
    publishResultPublicationRecord(permit, payload) {
      publishCalls += 1;
      return boundary.publishResultPublicationRecord(permit, payload);
    },
    readLifecyclePayload(recordClass, recordId) {
      return boundary.readLifecyclePayload(recordClass, recordId);
    },
    enumerateLifecycleRecords(recordClass) {
      return boundary.enumerateLifecycleRecords(recordClass);
    },
  };

  const input = (overrides: Partial<PublicationInput> = {}): PublicationInput => ({
    handoff,
    evaluatorProvenance: { evaluator_id: handoff.evaluatorId, capability_profile_id: handoff.capabilityProfileId },
    registry: registryCtx,
    store: countingStore,
    coordinate: createProcessLocalCoordinator(),
    identity: { nowUtcIso: () => FIXED_NOW, newRecordId: () => nextRecordId() },
    schemaRegistry: registry,
    capability,
    outcome: outcomePrecondition,
    ...overrides,
  });

  return {
    integration,
    registryCtx,
    chain,
    wp12Context,
    handoff,
    store: wp12Context.store,
    boundary,
    capability,
    outcomeBoundary,
    outcomePrecondition,
    root,
    input,
    publishCount: () => publishCalls,
  };
}

function publishedOf(result: PublicationResult): { readonly recordId: string; readonly recordDigest: string; readonly replay: boolean } {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  return { recordId: result.recordId, recordDigest: result.recordDigest, replay: result.outcome === 'idempotent-replay' };
}

function publicationRecords(env: PublicationEnv): Readonly<Record<string, unknown>>[] {
  const out: Readonly<Record<string, unknown>>[] = [];
  const enumerated = env.boundary.enumerateLifecycleRecords('result-publication-record');
  if (!enumerated.ok) return [];
  for (const recordId of enumerated.recordIds) {
    const read = env.boundary.readLifecyclePayload('result-publication-record', recordId);
    if (read.ok && read.payload !== undefined) out.push(read.payload);
  }
  return out;
}

// ─── first publication / replay / record shape ──────────────────────────────

test('WP-13C: first valid publication produces exactly one schema-correct ResultPublicationRecord', () => {
  const env = makeEnv();
  // WP-13 durability S3: exactly one matching durable outcome record is required.
  seedOutcomeFor(env, env.handoff);
  const result = publishValidatedResult(env.input());
  const pub = publishedOf(result);
  assert.equal(pub.replay, false);
  const records = publicationRecords(env);
  assert.equal(records.length, 1);
  const record = records[0]!;
  assert.equal(record['record_id'], pub.recordId);
  assert.equal(record['record_type'], 'ResultPublicationRecord');
  assert.equal(record['responsible_role'], 'trusted-result-publisher');
  assert.equal(record['workspace_id'], WS_A);
  assert.equal(record['occurrence_id'], OCCURRENCE_ID);
  assert.equal(record['attempt_id'], ATTEMPT_ID);
  assert.equal(record['validation_record_id'], env.handoff.validationRecordId);
  assert.equal(record['association_mode'], env.handoff.associationMode);
  assert.deepEqual(record['publication_scopes'], ['ordinary-review']);
  assert.deepEqual(record['receipt_correlations'], []);
  const subject = record['result_subject'] as Readonly<Record<string, unknown>>;
  assert.equal(subject['instance_id'], env.handoff.resultInstanceId);
  assert.equal(subject['revision_id'], env.handoff.resultRevisionId);
  assert.equal(subject['digest'], env.handoff.resultDigest);
  const provenance = record['evaluator_provenance'] as Readonly<Record<string, unknown>>;
  // SIR-WP13C-001 integration proof: the REAL WP-13B handoff carries the
  // canonical committed provenance identities, and they flow UNCHANGED into
  // the schema-valid publication record (exact correlation, no translation).
  assert.equal(env.handoff.evaluatorId, COMPLETION_EVALUATOR_ID, 'real handoff carries the canonical evaluator identity');
  assert.equal(env.handoff.capabilityProfileId, COMPLETION_EVALUATOR_CAPABILITY_PROFILE_ID, 'real handoff carries the canonical capability-profile identity');
  assert.match(env.handoff.evaluatorId, /^pgw:ev:[0-9a-f]{32}$/);
  assert.match(env.handoff.capabilityProfileId, /^pgw:cp:[0-9a-f]{32}$/);
  assert.equal(provenance['evaluator_id'], env.handoff.evaluatorId);
  assert.equal(provenance['capability_profile_id'], env.handoff.capabilityProfileId);
  const bundle = record['bundle'] as Readonly<Record<string, unknown>>;
  assert.equal(bundle['target_instance_id'], env.handoff.bundleReference['target_instance_id']);
  // The record identity is the opaque host identity source value (no
  // deterministic/content-derived lifecycle record identity).
  assert.match(pub.recordId, /^pgw:l:[0-9a-f]{32}$/);
  // No receipt / retrospective-facts classes exist (real WP-8 store check).
  assert.equal(env.integration.storeEnv.bootstrapInput !== undefined, true);
  const receipts = enumerateClass({ trustedConfiguration: env.integration.storeEnv.config, trustedInput: env.integration.storeEnv.bootstrapInput, recordClass: 'trusted-receipt' });
  assert.equal(receipts.ok && receipts.items.length === 0, true, 'no TrustedReceipt records');
  const summaries = enumerateClass({ trustedConfiguration: env.integration.storeEnv.config, trustedInput: env.integration.storeEnv.bootstrapInput, recordClass: 'execution-summary-record' });
  assert.equal(summaries.ok && summaries.items.length === 0, true, 'no execution-summary records');
});

test('WP-13C: exact replay returns the SAME durable record with zero second write', () => {
  const env = makeEnv();
  seedOutcomeFor(env, env.handoff);
  const first = publishedOf(publishValidatedResult(env.input()));
  assert.equal(env.publishCount(), 1);
  const second = publishedOf(publishValidatedResult(env.input()));
  assert.equal(second.replay, true);
  assert.equal(second.recordId, first.recordId);
  assert.equal(env.publishCount(), 1, 'no second write on exact replay');
  assert.equal(publicationRecords(env).length, 1);
});

// ─── conflicts ──────────────────────────────────────────────────────────────

test('WP-13C: a different result instance for the exact attempt fails closed (outcome precondition first)', () => {
  const env = makeEnv();
  // The single durable outcome matches the original handoff; the first
  // publication succeeds.
  seedOutcomeFor(env, env.handoff);
  publishedOf(publishValidatedResult(env.input()));
  const otherValidationId = nextRecordId();
  const other = { ...env.handoff, resultInstanceId: 'pgw:i:' + 'd'.repeat(32), resultRevisionId: 'pgw:r:' + 'e'.repeat(32), resultDigest: 'sha-256:' + 'f'.repeat(64), validationRecordId: otherValidationId };
  seedResultValidation(env.store, env.registryCtx, other, otherValidationId);
  const result = publishValidatedResult(env.input({ handoff: other }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    // The outcome precondition fails BEFORE any publication decision: one
    // durable outcome cannot match two result instances.
    assert.equal(result.category, 'PUBLICATION-OUTCOME-REJECTED');
    assert.equal(result.code, 'outcome.mismatch.instance');
  }
  assert.equal(publicationRecords(env).length, 1);
});

test('WP-13C: legacy durable publication + matching outcome — competing instance still conflicts (no double publication)', () => {
  const env = makeEnv();
  // A durable publication for instance A exists from a legacy-era run (no
  // outcome record then); the current outcome matches instance B.
  const otherValidationId = nextRecordId();
  const other = { ...env.handoff, resultInstanceId: 'pgw:i:' + 'd'.repeat(32), resultRevisionId: 'pgw:r:' + 'e'.repeat(32), resultDigest: 'sha-256:' + 'f'.repeat(64), validationRecordId: otherValidationId };
  seedResultValidation(env.store, env.registryCtx, other, otherValidationId);
  seedRawRecord(env.integration.storeEnv, 'result-publication-record', Object.freeze({
    record_type: 'ResultPublicationRecord',
    record_id: nextRecordId(),
    created_at: FIXED_NOW,
    responsible_role: 'trusted-result-publisher',
    registry_snapshot_reference: registryReferenceFor(env.registryCtx),
    result_subject: Object.freeze({
      protocol_version: '1.0',
      kind: Object.freeze({ id: 'ExecutionResult', version: '1.0' }),
      instance_id: env.handoff.resultInstanceId,
      revision_id: env.handoff.resultRevisionId,
      digest: env.handoff.resultDigest,
      workspace_id: env.handoff.workspaceId,
    }),
    evaluator_provenance: Object.freeze({ evaluator_id: env.handoff.evaluatorId, capability_profile_id: env.handoff.capabilityProfileId }),
    association_mode: env.handoff.associationMode,
    validation_record_id: env.handoff.validationRecordId,
    bundle: Object.freeze({ ...env.handoff.bundleReference }),
    workspace_id: env.handoff.workspaceId,
    occurrence_id: env.handoff.occurrenceId,
    attempt_id: env.handoff.attemptId,
    publication_scopes: Object.freeze(['ordinary-review']),
    receipt_correlations: Object.freeze([]),
  }));
  // The outcome matches the competing instance B: the precondition passes,
  // and the publication decision fails closed as a result-instance conflict.
  seedOutcomeFor(env, other, ATTEMPT_RECORD_ID, { result_association: Object.freeze({
    instance_id: other.resultInstanceId,
    revision_digest: other.resultDigest,
    association_mode: other.associationMode,
    validation_record_id: other.validationRecordId,
  }) });
  const result = publishValidatedResult(env.input({ handoff: other }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.category, 'PUBLICATION-CONFLICT');
    assert.equal(result.code, 'conflict.result-instance');
  }
  assert.equal(publicationRecords(env).length, 1);
});

test('WP-13C: same instance with divergent revision/digest fails closed (outcome precondition first)', () => {
  const env = makeEnv();
  seedOutcomeFor(env, env.handoff);
  publishedOf(publishValidatedResult(env.input()));
  const otherValidationId = nextRecordId();
  const divergent = { ...env.handoff, resultRevisionId: 'pgw:r:' + 'e'.repeat(32), resultDigest: 'sha-256:' + 'f'.repeat(64), validationRecordId: otherValidationId };
  seedResultValidation(env.store, env.registryCtx, divergent, otherValidationId);
  const result = publishValidatedResult(env.input({ handoff: divergent }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    // The single durable outcome binds the original revision digest; the
    // divergent publication request fails the outcome precondition first.
    assert.equal(result.category, 'PUBLICATION-OUTCOME-REJECTED');
    assert.equal(result.code, 'outcome.mismatch.digest');
  }
});

test('WP-13C: divergent evaluator provenance / ValidationRecord id / registry context conflict on the same instance', () => {
  // Provenance divergence: not part of the outcome precondition comparison,
  // so the precondition passes and the publication decision conflicts.
  const envA = makeEnv();
  seedOutcomeFor(envA, envA.handoff);
  publishedOf(publishValidatedResult(envA.input()));
  const otherEval = 'pgw:ev:' + 'd'.repeat(32);
  const otherCp = 'pgw:cp:' + 'e'.repeat(32);
  const provenanceVariant = { ...envA.handoff, evaluatorId: otherEval, capabilityProfileId: otherCp };
  const resultA = publishValidatedResult(envA.input({ handoff: provenanceVariant, evaluatorProvenance: { evaluator_id: otherEval, capability_profile_id: otherCp } }));
  assert.equal(resultA.ok, false);
  if (!resultA.ok) assert.equal(resultA.code, 'conflict.material-divergence');

  // ValidationRecord id divergence: a legacy durable publication binds the
  // same instance with a different validation id; the current outcome
  // matches the variant, so the precondition passes and the publication
  // decision conflicts on the divergent validation binding.
  const envB = makeEnv();
  const validationVariant = { ...envB.handoff, validationRecordId: nextRecordId() };
  seedResultValidation(envB.store, envB.registryCtx, validationVariant, validationVariant.validationRecordId);
  const legacyValidationId = nextRecordId();
  seedRawRecord(envB.integration.storeEnv, 'result-publication-record', Object.freeze({
    record_type: 'ResultPublicationRecord',
    record_id: nextRecordId(),
    created_at: FIXED_NOW,
    responsible_role: 'trusted-result-publisher',
    registry_snapshot_reference: registryReferenceFor(envB.registryCtx),
    result_subject: Object.freeze({
      protocol_version: '1.0',
      kind: Object.freeze({ id: 'ExecutionResult', version: '1.0' }),
      instance_id: validationVariant.resultInstanceId,
      revision_id: validationVariant.resultRevisionId,
      digest: validationVariant.resultDigest,
      workspace_id: validationVariant.workspaceId,
    }),
    evaluator_provenance: Object.freeze({ evaluator_id: validationVariant.evaluatorId, capability_profile_id: validationVariant.capabilityProfileId }),
    association_mode: validationVariant.associationMode,
    validation_record_id: legacyValidationId,
    bundle: Object.freeze({ ...validationVariant.bundleReference }),
    workspace_id: validationVariant.workspaceId,
    occurrence_id: validationVariant.occurrenceId,
    attempt_id: validationVariant.attemptId,
    publication_scopes: Object.freeze(['ordinary-review']),
    receipt_correlations: Object.freeze([]),
  }));
  seedOutcomeFor(envB, validationVariant);
  const resultB = publishValidatedResult(envB.input({ handoff: validationVariant }));
  assert.equal(resultB.ok, false);
  if (!resultB.ok) assert.equal(resultB.code, 'conflict.material-divergence');

  // Registry divergence: not part of the outcome precondition comparison,
  // so the precondition passes and the publication decision conflicts.
  const envC = makeEnv();
  seedOutcomeFor(envC, envC.handoff);
  publishedOf(publishValidatedResult(envC.input()));
  const otherRegistry = { ...makeRegistryContext(), registrySnapshotId: 'pgw:g:' + 'f'.repeat(32), registrySnapshotDigest: 'sha-256:' + '0'.repeat(64) };
  const resultC = publishValidatedResult(envC.input({ registry: otherRegistry }));
  assert.equal(resultC.ok, false);
  if (!resultC.ok) assert.equal(resultC.code, 'conflict.material-divergence');
  assert.equal(publicationRecords(envA).length, 1);
  assert.equal(publicationRecords(envB).length, 1);
  assert.equal(publicationRecords(envC).length, 1);
});

test('WP-13C: a publication for a different attempt is NOT an association (independent first publication)', () => {
  const env = makeEnv();
  seedOutcomeFor(env, env.handoff);
  publishedOf(publishValidatedResult(env.input()));
  // Same occurrence, different attempt id: the attempt-scoped lookup must
  // NOT discover it (the lock key and lookup are attempt-scoped). The
  // second attempt shares the occurrence chain (ordinal 2; WP-12 S4-D3).
  const otherAttempt = 'pgw:a:' + '9'.repeat(32);
  const otherAttemptRecordId = 'pgw:l:' + 'a'.repeat(32);
  seedPayload(env.store, 'execution-attempt-record', buildExecutionAttemptRecordPayload({
    recordId: otherAttemptRecordId, createdAt: FIXED_NOW, activationRecordId: ACTIVATION_RECORD_ID,
    occurrenceId: OCCURRENCE_ID, attemptId: otherAttempt, ordinal: 2,
    bundle: env.chain.bundleReference, workspaceId: WS_A, runtimeGrantId: GRANT_ID, registry: env.registryCtx,
  }));
  const variant = { ...env.handoff, attemptId: otherAttempt, artifactRelativePath: `results/${OCCURRENCE_ID}/${otherAttempt}/execution-result.json` };
  seedOutcomeFor(env, variant, otherAttemptRecordId);
  const result = publishValidatedResult(env.input({ handoff: variant }));
  const pub = publishedOf(result);
  assert.equal(pub.replay, false, 'different attempt must publish independently');
  assert.equal(publicationRecords(env).length, 2);
});

// ─── scope / receipt operand rejection ──────────────────────────────────────

test('WP-13C: scope and receipt operands are NEVER caller inputs (unknown-key rejection)', () => {
  const env = makeEnv();
  const hostile1 = publishValidatedResult({ ...env.input(), publication_scopes: ['completion-status'] } as never);
  assert.equal(hostile1.ok, false);
  if (!hostile1.ok) {
    assert.equal(hostile1.category, 'PUBLICATION-INPUT-INVALID');
    assert.equal(hostile1.code, 'input.unknown-key');
  }
  const hostile2 = publishValidatedResult({ ...env.input(), receipt_correlations: ['pgw:l:' + '0'.repeat(32)] } as never);
  assert.equal(hostile2.ok, false);
  if (!hostile2.ok) assert.equal(hostile2.code, 'input.unknown-key');
  assert.equal(publicationRecords(env).length, 0);
});

// ─── ValidationRecord binding / lifecycle state ─────────────────────────────

test('WP-13C: missing or mismatched ValidationRecord binding fails closed', () => {
  const env = makeEnv();
  // Missing: the outcome association matches the variant handoff; the
  // durable ValidationRecord itself is missing, so the independent re-read
  // denies.
  const missingVariant = { ...env.handoff, validationRecordId: nextRecordId() };
  seedOutcomeFor(env, missingVariant);
  const missing = publishValidatedResult(env.input({ handoff: missingVariant }));
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.category, 'PUBLICATION-LIFECYCLE-REJECTED');
    assert.equal(missing.code, 'lifecycle.validation-record-missing');
  }
  // A validation record whose subject does not match the handoff result ids:
  // the outcome association matches the variant, and the re-read denies on
  // the mismatched validation subject.
  const envB = makeEnv();
  const wrongSubject = { ...envB.handoff, resultInstanceId: 'pgw:i:' + 'f'.repeat(32), resultRevisionId: 'pgw:r:' + 'e'.repeat(32), resultDigest: 'sha-256:' + '0'.repeat(64) };
  seedOutcomeFor(envB, wrongSubject);
  const result = publishValidatedResult(envB.input({ handoff: wrongSubject }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'lifecycle.validation-record-mismatch');
  assert.equal(publicationRecords(env).length, 0);
  assert.equal(publicationRecords(envB).length, 0);
});

test('WP-13C: stale/current-state failures fail closed (attempt missing, grant revoked, grant expired)', () => {
  // Attempt record missing.
  const envA = makeEnv();
  const withoutAttempt: PublicationStoreBoundary = {
    ...envA.boundary,
    enumerateLifecycleRecords(recordClass) {
      if (recordClass === 'execution-attempt-record') return { ok: true, recordIds: [] };
      return envA.boundary.enumerateLifecycleRecords(recordClass);
    },
  };
  const resultA = publishValidatedResult(envA.input({ store: withoutAttempt }));
  assert.equal(resultA.ok, false);
  if (!resultA.ok) {
    assert.equal(resultA.category, 'PUBLICATION-LIFECYCLE-REJECTED');
    assert.equal(resultA.code, 'lifecycle.attempt-missing');
  }

  // Grant revoked.
  const envB = makeEnv();
  seedPayload(envB.store, 'revocation-record', {
    record_type: 'RevocationRecord',
    record_id: nextRecordId(),
    created_at: FIXED_NOW,
    responsible_role: 'trusted-revoker',
    registry_snapshot_reference: envB.registryCtx,
    target: { record_id: GRANT_ID },
    scope: 'all-uses',
    effective_at: FIXED_NOW,
    reason_code: 'retention',
  });
  const resultB = publishValidatedResult(envB.input());
  assert.equal(resultB.ok, false);
  if (!resultB.ok) assert.equal(resultB.code, 'lifecycle.grant-revoked');

  // Grant expired (publication time after the validity window).
  const envC = makeEnv();
  const resultC = publishValidatedResult(envC.input({ identity: { nowUtcIso: () => '2026-09-01T00:00:00.000Z', newRecordId: () => nextRecordId() } }));
  assert.equal(resultC.ok, false);
  if (!resultC.ok) assert.equal(resultC.code, 'lifecycle.grant-expired');
});

// ─── capability boundary ────────────────────────────────────────────────────

test('WP-13C: capability forgery / clone / detached / disposal fail closed (adversarial preserved)', () => {
  const env = makeEnv();
  seedOutcomeFor(env, env.handoff);
  // Structural forgery (spread clone): never genuine.
  const forged = { ...env.capability };
  const r1 = publishValidatedResult(env.input({ capability: forged }));
  assert.equal(r1.ok, false);
  if (!r1.ok) {
    assert.equal(r1.category, 'PUBLICATION-CAPABILITY-DENIED');
    assert.equal(r1.code, 'capability.not-genuine');
  }
  // Disposal is per-capability: disposing cap2 invalidates ONLY cap2.
  const cap2 = createResultPublicationCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'result-publication-action-2' });
  assert.ok(cap2 !== undefined);
  cap2!.dispose();
  const r2 = publishValidatedResult(env.input({ capability: cap2 }));
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.code, 'capability.disposed');
  // The same-configuration capability env.capability remains valid after
  // cap2's disposal (disposal never invalidates other capabilities).
  const r2b = publishValidatedResult(env.input({ capability: env.capability }));
  assert.equal(r2b.ok, true, JSON.stringify(r2b));
  // Detached-method replay (CAP-015): the brand must be carried by the receiver.
  const verifyOnly = { binding: env.capability.binding, verify: env.capability.verify, dispose: env.capability.dispose };
  const r5 = publishValidatedResult(env.input({ capability: verifyOnly }));
  assert.equal(r5.ok, false);
  if (!r5.ok) assert.equal(r5.code, 'capability.not-genuine');
});

test('WP-13C: same trusted configuration — minting B never invalidates A (SIR-WP13C-002)', () => {
  const env = makeEnv();
  seedOutcomeFor(env, env.handoff);
  // Mint capability B under the SAME genuine trusted configuration.
  const capB = createResultPublicationCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'result-publication-action-3' });
  assert.ok(capB !== undefined);
  // Both capabilities are independently genuine and current.
  assert.deepEqual(env.capability.verify(), { ok: true });
  assert.deepEqual(capB!.verify(), { ok: true });
  // Use A and B in independent valid publication operations (two different
  // attempts, shared coordinator, independent lock keys).
  const otherAttempt = 'pgw:a:' + '9'.repeat(32);
  const otherAttemptRecordId = 'pgw:l:' + 'a'.repeat(32);
  seedPayload(env.store, 'execution-attempt-record', buildExecutionAttemptRecordPayload({
    recordId: otherAttemptRecordId, createdAt: FIXED_NOW, activationRecordId: ACTIVATION_RECORD_ID,
    occurrenceId: OCCURRENCE_ID, attemptId: otherAttempt, ordinal: 2,
    bundle: env.chain.bundleReference, workspaceId: WS_A, runtimeGrantId: GRANT_ID, registry: env.registryCtx,
  }));
  const shared = createProcessLocalCoordinator();
  const a = publishedOf(publishValidatedResult(env.input({ coordinate: shared })));
  const variant = { ...env.handoff, attemptId: otherAttempt, artifactRelativePath: `results/${OCCURRENCE_ID}/${otherAttempt}/execution-result.json` };
  seedOutcomeFor(env, variant, otherAttemptRecordId);
  const b = publishedOf(publishValidatedResult(env.input({ coordinate: shared, handoff: variant, capability: capB })));
  assert.notEqual(a.recordId, b.recordId);
  assert.equal(publicationRecords(env).length, 2);
  // Neither capability was staled by the other's mint.
  assert.deepEqual(env.capability.verify(), { ok: true });
  assert.deepEqual(capB!.verify(), { ok: true });
});

test('WP-13C: genuine trusted-configuration replacement invalidates earlier capabilities (SIR-WP13C-002)', () => {
  const envA = makeEnv();
  seedOutcomeFor(envA, envA.handoff);
  // A valid publication with the original capability succeeds.
  publishedOf(publishValidatedResult(envA.input()));
  // Genuine replacement configuration (new configuration identity for the
  // same workspace; established makeIntegrationEnv lifecycle pattern).
  const replacement = makeIntegrationEnv();
  assert.notEqual(replacement.storeEnv.config.identity, envA.integration.storeEnv.config.identity, 'the replacement configuration must have a different identity');
  const capB = createResultPublicationCapability({ trustedConfiguration: replacement.storeEnv.config, actionIdentity: 'result-publication-action-replacement' });
  assert.ok(capB !== undefined);
  // The earlier capability is stale-generation; every mutation-boundary
  // verification rejects it (authority admission + store sink).
  assert.deepEqual(envA.capability.verify(), { ok: false, reason: 'stale-generation' });
  const stale = publishValidatedResult(envA.input({ capability: envA.capability }));
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.category, 'PUBLICATION-CAPABILITY-DENIED');
    assert.equal(stale.code, 'capability.stale-generation');
  }
  // The newly minted capability under the replacement configuration is valid
  // and publishes successfully (a fresh publication for a second attempt of
  // the same occurrence).
  assert.deepEqual(capB!.verify(), { ok: true });
  const otherAttempt = 'pgw:a:' + '7'.repeat(32);
  const otherAttemptRecordId = 'pgw:l:' + 'c'.repeat(32);
  seedPayload(envA.store, 'execution-attempt-record', buildExecutionAttemptRecordPayload({
    recordId: otherAttemptRecordId, createdAt: FIXED_NOW, activationRecordId: ACTIVATION_RECORD_ID,
    occurrenceId: OCCURRENCE_ID, attemptId: otherAttempt, ordinal: 2,
    bundle: envA.chain.bundleReference, workspaceId: WS_A, runtimeGrantId: GRANT_ID, registry: envA.registryCtx,
  }));
  const variant = { ...envA.handoff, attemptId: otherAttempt, artifactRelativePath: `results/${OCCURRENCE_ID}/${otherAttempt}/execution-result.json` };
  seedOutcomeFor(envA, variant, otherAttemptRecordId);
  const fresh = publishedOf(publishValidatedResult(envA.input({ handoff: variant, capability: capB })));
  assert.equal(fresh.replay, false);
  assert.equal(publicationRecords(envA).length, 2);
});

// ─── lock / concurrency ─────────────────────────────────────────────────────

test('WP-13C: in-flight contention fails closed; the waiter re-reads durable state after release (idempotent)', () => {
  const env = makeEnv();
  seedOutcomeFor(env, env.handoff);
  const coordinator = createProcessLocalCoordinator();
  let inner: PublicationResult | undefined;
  const racing = publishValidatedResult(
    env.input({
      coordinate: coordinator,
      hooks: {
        beforeFirstPublication: () => {
          // While the first decision holds the attempt-level lock, a second
          // invocation of the SAME attempt cannot acquire it.
          inner = publishValidatedResult(env.input({ coordinate: coordinator }));
        },
      },
    }),
  );
  const first = publishedOf(racing);
  assert.ok(inner !== undefined);
  assert.equal(inner.ok, false);
  if (!inner.ok) {
    assert.equal(inner.category, 'PUBLICATION-LOCK-CONFLICT');
    assert.equal(inner.code, 'lock.conflict');
  }
  assert.equal(env.publishCount(), 1, 'the contended invocation wrote nothing');
  // After release, the retry obtains the lock, re-reads durable state and
  // returns idempotent replay of the SAME record.
  const retry = publishedOf(publishValidatedResult(env.input({ coordinate: coordinator })));
  assert.equal(retry.replay, true);
  assert.equal(retry.recordId, first.recordId);
  assert.equal(env.publishCount(), 1);
});

test('WP-13C: competing different result instance after release fails closed (no double publication)', () => {
  const env = makeEnv();
  seedOutcomeFor(env, env.handoff);
  publishedOf(publishValidatedResult(env.input()));
  const otherValidationId = nextRecordId();
  const other = { ...env.handoff, resultInstanceId: 'pgw:i:' + 'd'.repeat(32), resultRevisionId: 'pgw:r:' + 'e'.repeat(32), resultDigest: 'sha-256:' + 'f'.repeat(64), validationRecordId: otherValidationId };
  seedResultValidation(env.store, env.registryCtx, other, otherValidationId);
  const result = publishValidatedResult(env.input({ handoff: other }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'outcome.mismatch.instance');
  assert.equal(publicationRecords(env).length, 1);
});

test('WP-13C: different attempts use independent lock keys (no unnecessary serialization)', () => {
  const env = makeEnv();
  seedOutcomeFor(env, env.handoff);
  // Different attempt ids (and lock keys): both publish independently even
  // with a SHARED coordinator (independent keys never contend), each with
  // its own capability minted under the SAME trusted configuration (no
  // stale-generation from minting — SIR-WP13C-002).
  const otherAttempt = 'pgw:a:' + '8'.repeat(32);
  const otherAttemptRecordId = 'pgw:l:' + 'b'.repeat(32);
  seedPayload(env.store, 'execution-attempt-record', buildExecutionAttemptRecordPayload({
    recordId: otherAttemptRecordId, createdAt: FIXED_NOW, activationRecordId: ACTIVATION_RECORD_ID,
    occurrenceId: OCCURRENCE_ID, attemptId: otherAttempt, ordinal: 2,
    bundle: env.chain.bundleReference, workspaceId: WS_A, runtimeGrantId: GRANT_ID, registry: env.registryCtx,
  }));
  const capB = createResultPublicationCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'result-publication-action-locks' });
  assert.ok(capB !== undefined);
  const shared = createProcessLocalCoordinator();
  const a = publishedOf(publishValidatedResult(env.input({ coordinate: shared })));
  const variant = { ...env.handoff, attemptId: otherAttempt, artifactRelativePath: `results/${OCCURRENCE_ID}/${otherAttempt}/execution-result.json` };
  seedOutcomeFor(env, variant, otherAttemptRecordId);
  const b = publishedOf(publishValidatedResult(env.input({ coordinate: shared, handoff: variant, capability: capB })));
  assert.notEqual(a.recordId, b.recordId);
  assert.equal(publicationRecords(env).length, 2);
});

// ─── publishRecord failure under the lock ───────────────────────────────────

test('WP-13C: publishRecord failure while the lock is held is typed and writes nothing', () => {
  const env = makeEnv();
  seedOutcomeFor(env, env.handoff);
  const failingStore: PublicationStoreBoundary = {
    ...env.boundary,
    publishResultPublicationRecord() {
      return { ok: false, outcome: 'failed', findings: [] };
    },
  };
  const result = publishValidatedResult(env.input({ store: failingStore }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.category, 'PUBLICATION-WRITE-FAILED');
    assert.equal(result.code, 'write.publish-failed');
  }
  assert.equal(publicationRecords(env).length, 0);
});

// ─── input hygiene / boundary containment ───────────────────────────────────

test('WP-13C: malformed handoff / provenance / boundaries fail closed as PUBLICATION-INPUT-INVALID', () => {
  const env = makeEnv();
  const cases: readonly { readonly label: string; readonly input: PublicationInput }[] = [
    { label: 'workspace', input: env.input({ handoff: { ...env.handoff, workspaceId: 'garbage' } }) },
    { label: 'occurrence', input: env.input({ handoff: { ...env.handoff, occurrenceId: 'garbage' } }) },
    { label: 'attempt', input: env.input({ handoff: { ...env.handoff, attemptId: 'garbage' } }) },
    { label: 'disposition', input: env.input({ handoff: { ...env.handoff, disposition: 'failed' } as never }) },
    { label: 'instance', input: env.input({ handoff: { ...env.handoff, resultInstanceId: 'garbage' } }) },
    { label: 'digest', input: env.input({ handoff: { ...env.handoff, resultDigest: 'garbage' } }) },
    { label: 'validation', input: env.input({ handoff: { ...env.handoff, validationRecordId: 'garbage' } }) },
    { label: 'path', input: env.input({ handoff: { ...env.handoff, artifactRelativePath: '../escape.json' } }) },
    { label: 'provenance-syntax', input: env.input({ evaluatorProvenance: { evaluator_id: 'not-an-id', capability_profile_id: env.handoff.capabilityProfileId } }) },
    { label: 'provenance-mismatch', input: env.input({ evaluatorProvenance: { evaluator_id: 'pgw:ev:' + 'd'.repeat(32), capability_profile_id: env.handoff.capabilityProfileId } }) },
    { label: 'registry', input: env.input({ registry: { registryProtocolId: '' } as never }) },
    { label: 'store', input: env.input({ store: {} as never }) },
    { label: 'coordinate', input: env.input({ coordinate: {} as never }) },
    { label: 'identity', input: env.input({ identity: {} as never }) },
    { label: 'schema', input: env.input({ schemaRegistry: {} as never }) },
  ];
  for (const c of cases) {
    const result = publishValidatedResult(c.input);
    assert.equal(result.ok, false, c.label);
    if (!result.ok) {
      assert.equal(result.category, 'PUBLICATION-INPUT-INVALID', `${c.label}: ${JSON.stringify(result)}`);
    }
  }
  // A non-genuine capability is a capability denial, not an input error.
  const denied = publishValidatedResult(env.input({ capability: {} }));
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.category, 'PUBLICATION-CAPABILITY-DENIED');
    assert.equal(denied.code, 'capability.not-genuine');
  }
  assert.equal(publicationRecords(env).length, 0);
});

test('WP-13C: throwing / malformed trusted boundaries fail typed and closed (no raw leakage)', () => {
  const env = makeEnv();
  seedOutcomeFor(env, env.handoff);
  const SECRET = 'WP13C-SECRET-MARKER';
  // Throwing store boundary.
  const throwingStore: PublicationStoreBoundary = {
    ...env.boundary,
    publishResultPublicationRecord() {
      throw new Error(SECRET);
    },
  };
  const r1 = publishValidatedResult(env.input({ store: throwingStore }));
  assert.equal(r1.ok, false);
  if (!r1.ok) {
    assert.equal(r1.category, 'PUBLICATION-INTERNAL-FAILURE');
    assert.equal(r1.code, 'internal.publish-exception');
    assert.equal(JSON.stringify(r1).includes(SECRET), false);
  }
  // Malformed successful return from the store boundary.
  const malformedStore: PublicationStoreBoundary = {
    ...env.boundary,
    publishResultPublicationRecord() {
      return null as never;
    },
  };
  const r2 = publishValidatedResult(env.input({ store: malformedStore }));
  assert.equal(r2.ok, false);
  if (!r2.ok) {
    assert.equal(r2.category, 'PUBLICATION-INTERNAL-FAILURE');
    assert.equal(r2.code, 'internal.publish-malformed');
  }
  // Throwing identity source.
  const throwingIdentity = {
    nowUtcIso: () => {
      throw new Error(SECRET);
    },
    newRecordId: () => 'pgw:l:' + '0'.repeat(32),
  };
  const r3 = publishValidatedResult(env.input({ identity: throwingIdentity }));
  assert.equal(r3.ok, false);
  if (!r3.ok) {
    assert.equal(r3.category, 'PUBLICATION-INTERNAL-FAILURE');
    assert.equal(r3.code, 'identity.time-invalid');
    assert.equal(JSON.stringify(r3).includes(SECRET), false);
  }
  // Throwing capability verify.
  const forgedVerify = { binding: env.capability.binding, verify: () => { throw new Error(SECRET); }, dispose: () => {} };
  const r4 = publishValidatedResult(env.input({ capability: forgedVerify }));
  assert.equal(r4.ok, false);
  if (!r4.ok) {
    assert.equal(r4.category, 'PUBLICATION-CAPABILITY-DENIED');
    assert.equal(JSON.stringify(r4).includes(SECRET), false);
  }
  // Throwing coordinator (non-contention error).
  const throwingCoordinator = {
    withLock: () => {
      throw new Error(SECRET);
    },
  };
  const r5 = publishValidatedResult(env.input({ coordinate: throwingCoordinator }));
  assert.equal(r5.ok, false);
  if (!r5.ok) {
    assert.equal(r5.category, 'PUBLICATION-INTERNAL-FAILURE');
    assert.equal(r5.code, 'lock.unexpected-exception');
    assert.equal(JSON.stringify(r5).includes(SECRET), false);
  }
  // LockContentionError from the coordinator maps to lock-conflict.
  const contending = {
    withLock: () => {
      throw new LockContentionError('some-key');
    },
  };
  const r6 = publishValidatedResult(env.input({ coordinate: contending }));
  assert.equal(r6.ok, false);
  if (!r6.ok) {
    assert.equal(r6.category, 'PUBLICATION-LOCK-CONFLICT');
    assert.equal(r6.code, 'lock.conflict');
  }
});
