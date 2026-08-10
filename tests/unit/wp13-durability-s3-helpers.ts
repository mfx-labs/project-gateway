/**
 * WP-13 durability S3 — shared focused test harness.
 *
 * Real initialized WP-8 store, real WP-12 grant/activation/occurrence/
 * attempt chain, real WP-5A observation, real WP-5B enforcement evidence,
 * real WP-13B completion flow (handoff + durable ValidationRecord), the
 * real S2 outcome store boundary + capability, and counting/throwing
 * identity + store wrappers for the S3 decision tests.
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cleanupTestEnvs,
  grantChainSubjects,
  makeContext,
  makeIdentitySource,
  makeIntegrationEnv,
  makeRegistryContext,
  seedPayload,
  seedRawRecord,
  UID,
  WS_A,
  FIXED_NOW,
  WRITE_ACTION,
} from './wp12-helpers.js';
import { buildWorld, corpusArtifactSet, SUPPORT } from '../pi-adapter/helpers.js';
import { projectExecutionBundleToPi } from '../../src/adapters/pi/projection.js';
import { createPiHostBridge, observePiExecution } from '../../src/adapters/pi/index.js';
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
} from '../../src/control-plane/records.js';
import { defaultLimitProfile } from '../../src/storage/limits/limits.js';
import { registryReferenceFor } from '../../src/control-plane/records.js';
import { createOutcomeStoreBoundary } from '../../src/outcome/index.js';
import { createExecutionOutcomeCapability } from '../../src/outcome/capability.js';
import { createProcessLocalCoordinator } from '../../src/control-plane/coordination.js';
import { createPublicationStoreBoundary } from '../../src/publication/index.js';
import { createResultPublicationCapability } from '../../src/publication/capability.js';
import { createPublicationOutcomePrecondition } from '../../src/internal/publication-outcome-context.js';
import { buildOutcomePayload, canonicalObservationContentDigest } from '../../src/outcome-production/index.js';
import type { PiInvocationPlan, PiExecutionObservation } from '../../src/adapters/pi/types.js';
import type { PiEnforcementEvidence } from '../../src/adapters/pi/enforcement/types.js';
import type { ExecutionAttemptOutcome } from '../../src/execution/types.js';
import type { ValidatedArtifact } from '../../src/api/types.js';
import type { ControlPlaneStoreBoundary, ControlPlaneTrustedContext } from '../../src/control-plane/types.js';
import type { OutcomeProductionInput, OutcomeIdentitySource, OutcomeProductionResult } from '../../src/outcome-production/types.js';
import type { OutcomeStoreBoundary } from '../../src/outcome/types.js';
import type { ValidatedResultHandoff } from '../../src/completion/types.js';
import type { AcceptedRegistryContext } from '../../src/api/types.js';
import type { PublicationInput, PublicationStoreBoundary } from '../../src/publication/types.js';

const OCCURRENCE_ID = 'pgw:o:' + 'a'.repeat(32);
const ATTEMPT_ID = 'pgw:a:' + '1'.repeat(32);
const ATTEMPT_RECORD_ID = 'pgw:l:' + '2'.repeat(32);
const OCCURRENCE_RECORD_ID = 'pgw:l:' + '3'.repeat(32);
const ACTIVATION_RECORD_ID = 'pgw:l:' + '4'.repeat(32);
const GRANT_ID = 'pgw:l:' + '5'.repeat(32);
const LATER = '2026-08-05T06:00:00.000Z';

export { OCCURRENCE_ID, ATTEMPT_ID, ATTEMPT_RECORD_ID, OCCURRENCE_RECORD_ID, ACTIVATION_RECORD_ID, GRANT_ID, LATER, WS_A, FIXED_NOW };

const registry = createSchemaRegistry();
const contractArtifact: ValidatedArtifact = (() => {
  const report = validateArtifactSelf(corpusArtifactSet().completion, registry);
  if (report.ok !== true || report.value === undefined) throw new Error('completion contract fixture failed self-validation');
  return report.value;
})();

const roots: string[] = [];
export function s3Cleanup(): void {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  cleanupTestEnvs();
}

export function makePlan(): PiInvocationPlan {
  return makePlanFor(OCCURRENCE_ID, ATTEMPT_ID);
}

export function makePlanFor(occurrenceId: string, attemptId: string): PiInvocationPlan {
  const world = buildWorld();
  const result = projectExecutionBundleToPi({ ...world.input(), occurrenceId, attemptId });
  if (!result.ok || result.plan === undefined) throw new Error('plan projection failed');
  return result.plan;
}

export function makeObservationFor(occurrenceId: string = OCCURRENCE_ID, attemptId: string = ATTEMPT_ID, text: string = 'task complete'): PiExecutionObservation {
  const plan = makePlanFor(occurrenceId, attemptId);
  const surface = mockSurface();
  const wired = createPiHostBridge(surface, plan);
  if (!wired.ok || wired.bridge === undefined) throw new Error('bridge wiring failed');
  const s = surface as MockSurface;
  fire(s, 'session_start', { reason: 'startup' }, hostCtx('sess-1'));
  fire(s, 'turn_start', { turnIndex: 0, timestamp: 1000 });
  fire(s, 'message_end', { message: { role: 'assistant', content: [{ type: 'text', text }] } });
  fire(s, 'agent_settled', {});
  fire(s, 'session_shutdown', { reason: 'quit' });
  const bridge = wired.bridge;
  if (bridge.sessionCorrelationId === undefined || bridge.turnCorrelationId === undefined) throw new Error('no session/turn correlation');
  return observePiExecution(bridge, { sessionCorrelationId: bridge.sessionCorrelationId, turnCorrelationId: bridge.turnCorrelationId });
}

export function makeObservation(text: string = 'task complete'): PiExecutionObservation {
  return makeObservationFor(OCCURRENCE_ID, ATTEMPT_ID, text);
}

/** A non-canonical (non-NFC) genuine observation variant. */
export function makeNonNfcObservation(): PiExecutionObservation {
  return makeObservationFor(OCCURRENCE_ID, ATTEMPT_ID, 'cafe\u0301 non-nfc');
}

export function makeEnforcementEvidence(): PiEnforcementEvidence {
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
  return result.evidence;
}

export function makeOutcome(disposition: ExecutionAttemptOutcome['disposition'] = 'completed'): ExecutionAttemptOutcome {
  return {
    disposition,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    ordinal: 1,
    observedAt: FIXED_NOW,
    retry: { eligible: false, reason: 'terminal-completed' },
  };
}

// ─── lifecycle chain seeding (real WP-8 store; record builders) ─────────────

export interface SeededChain {
  readonly bundleReference: Readonly<Record<string, unknown>>;
  readonly grantId: string;
  readonly activationRecordId: string;
  readonly occurrenceRecordId: string;
  readonly attemptRecordId: string;
  readonly occurrenceId: string;
  readonly attemptId: string;
}

export function seedPublicationChain(store: ControlPlaneStoreBoundary, registryCtx: AcceptedRegistryContext): SeededChain {
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

// ─── S3 environment ─────────────────────────────────────────────────────────

export interface CountingOutcomeIdentity extends OutcomeIdentitySource {
  readonly calls: { readonly recordId: number; readonly evidenceId: number; readonly now: number };
}

export function makeCountingOutcomeIdentity(now: string = FIXED_NOW): CountingOutcomeIdentity {
  const calls = { recordId: 0, evidenceId: 0, now: 0 };
  return {
    calls,
    nowUtcIso: () => {
      calls.now += 1;
      return now;
    },
    newRecordId: () => {
      calls.recordId += 1;
      return `pgw:l:${calls.recordId.toString(16).padStart(32, '0')}`;
    },
    newEvidenceId: () => {
      calls.evidenceId += 1;
      return `pgw:e:${calls.evidenceId.toString(16).padStart(32, '0')}`;
    },
  };
}

/** Throwing identity sources proving replay/conflict paths never invoke them. */
export function makeThrowingOutcomeIdentity(): OutcomeIdentitySource {
  return {
    nowUtcIso: () => {
      throw new Error('time source must not be invoked');
    },
    newRecordId: () => {
      throw new Error('record-id source must not be invoked');
    },
    newEvidenceId: () => {
      throw new Error('evidence-id source must not be invoked');
    },
  };
}

export interface S3Env {
  readonly integration: ReturnType<typeof makeIntegrationEnv>;
  readonly registryCtx: AcceptedRegistryContext;
  readonly chain: SeededChain;
  readonly wp12Context: ControlPlaneTrustedContext;
  readonly store: ControlPlaneStoreBoundary;
  readonly handoff: ValidatedResultHandoff;
  readonly observation: PiExecutionObservation;
  readonly enforcement: PiEnforcementEvidence;
  readonly outcome: ExecutionAttemptOutcome;
  readonly attempt: Readonly<Record<string, unknown>>;
  readonly validation: Readonly<Record<string, unknown>>;
  readonly outcomeBoundary: OutcomeStoreBoundary;
  readonly capability: NonNullable<ReturnType<typeof createExecutionOutcomeCapability>>;
  readonly root: string;
  /** The exact outcome-production input (reusable; mutating copies per test). */
  input(overrides?: Partial<OutcomeProductionInput>): OutcomeProductionInput;
  /** Seed one exact-material outcome record (association/enforcement toggleable). */
  seedOutcome(opts?: { readonly withAssociation?: boolean; readonly withEnforcement?: boolean; readonly overrides?: Partial<Readonly<Record<string, unknown>>> }): string;
  /** Seed one arbitrary outcome-class record (for divergence vectors). */
  seedRawOutcome(payload: Readonly<Record<string, unknown>>): string;
  /** Read every durable outcome-record payload for the exact attempt. */
  outcomeRecords(): Readonly<Record<string, unknown>>[];
  outcomePublishCount(): number;
  /** The real WP-13C publication boundary (precondition wiring). */
  readonly publicationBoundary: PublicationStoreBoundary;
  /** A minted result-publication capability (host-composition test wiring). */
  readonly publicationCapability: NonNullable<ReturnType<typeof createResultPublicationCapability>>;
  /** The exact publication input (with the genuine outcome precondition wired by default). */
  pubInput(overrides?: Partial<PublicationInput>): PublicationInput;
}

let recordIdCounter = 0x7000;
export function nextRecordId(): string {
  return `pgw:l:${(recordIdCounter++).toString(16).padStart(32, '0')}`;
}

/** The exact outcome-record payload the S3 core builds for this env (test-side). */
export function expectedOutcomePayload(env: {
  readonly registryCtx: AcceptedRegistryContext;
  readonly attempt: Readonly<Record<string, unknown>>;
  readonly outcome: ExecutionAttemptOutcome;
  readonly observation: PiExecutionObservation;
  readonly enforcement?: PiEnforcementEvidence;
  readonly handoff?: ValidatedResultHandoff;
}, overrides: Partial<Readonly<Record<string, unknown>>> = {}): Readonly<Record<string, unknown>> {
  const digest = canonicalObservationContentDigest(env.observation);
  if (!digest.ok) throw new Error('observation digest failed in helper');
  const material = {
    registryReference: registryReferenceFor(env.registryCtx),
    workspaceId: String(env.attempt['workspace_id']),
    bundle: env.attempt['bundle'] as Readonly<Record<string, unknown>>,
    occurrenceId: String(env.attempt['occurrence_id']),
    attemptId: String(env.attempt['attempt_id']),
    ordinal: env.attempt['ordinal'] as number,
    attemptRecordId: String(env.attempt['record_id']),
    disposition: env.outcome.disposition,
    observationDigest: digest.digest,
    ...(env.enforcement !== undefined
      ? { enforcement: Object.freeze({ projectionIdentity: env.enforcement.projectionIdentity, evidenceFingerprint: env.enforcement.evidenceFingerprint }) }
      : {}),
    ...(env.handoff !== undefined
      ? {
          association: Object.freeze({
            instanceId: env.handoff.resultInstanceId,
            revisionDigest: env.handoff.resultDigest,
            mode: env.handoff.associationMode,
            validationRecordId: env.handoff.validationRecordId,
          }),
        }
      : {}),
  };
  const payload = buildOutcomePayload(
    material,
    'pgw:l:0a1b2c3d4e5f60718293a4b5c6d7e8f9',
    FIXED_NOW,
    'pgw:e:0123456789abcdef0123456789abcdef',
  );
  return { ...payload, ...overrides };
}

export function makeS3Env(): S3Env {
  const integration = makeIntegrationEnv();
  const registryCtx = makeRegistryContext();
  const identity = makeIdentitySource();
  const wp12Context = makeContext(integration.storeEnv, { identity });
  const chain = seedPublicationChain(wp12Context.store, registryCtx);

  const root = mkdtempSync(join(tmpdir(), 'wp13s3-'));
  roots.push(root);
  mkdirSync(join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID), { recursive: true });
  const boundary13b = createResultValidationBoundary(wp12Context);
  const observation = makeObservation();
  const enforcement = makeEnforcementEvidence();
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
    observation,
    completionContract: contractArtifact,
    enforcementEvidence: { evidenceFingerprint: enforcement.evidenceFingerprint },
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
  const handoff = completion.handoff;

  const attemptRead = wp12Context.store.readLifecyclePayload('execution-attempt-record', ATTEMPT_RECORD_ID);
  if (!attemptRead.ok || attemptRead.payload === undefined) throw new Error('attempt record unreadable');
  const attempt = attemptRead.payload;
  const validationRead = wp12Context.store.readLifecyclePayload('validation-record', handoff.validationRecordId);
  if (!validationRead.ok || validationRead.payload === undefined) throw new Error('validation record unreadable');
  const validation = validationRead.payload;

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
  const capability = createExecutionOutcomeCapability({
    trustedConfiguration: integration.storeEnv.config,
    actionIdentity: 'outcome-recording-action-1',
  });
  if (capability === undefined) throw new Error('capability minting failed');

  const publicationBoundary = createPublicationStoreBoundary({
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
  const publicationCapability = createResultPublicationCapability({
    trustedConfiguration: integration.storeEnv.config,
    actionIdentity: 'result-publication-action-1',
  });
  if (publicationCapability === undefined) throw new Error('publication capability minting failed');
  const outcomePrecondition = createPublicationOutcomePrecondition(outcomeBoundary);
  if (outcomePrecondition === undefined) throw new Error('outcome precondition context minting failed');

  let outcomePublishCalls = 0;
  const countingOutcomeBoundary: OutcomeStoreBoundary = {
    publishExactOutcomeRecord(permit, payload) {
      outcomePublishCalls += 1;
      return outcomeBoundary.publishExactOutcomeRecord(permit, payload);
    },
    readLifecyclePayload(recordClass, recordId) {
      return outcomeBoundary.readLifecyclePayload(recordClass, recordId);
    },
    enumerateLifecycleRecords(recordClass) {
      return outcomeBoundary.enumerateLifecycleRecords(recordClass);
    },
  };

  const env: S3Env = {
    integration,
    registryCtx,
    chain,
    wp12Context,
    store: wp12Context.store,
    handoff,
    observation,
    enforcement,
    outcome: makeOutcome(),
    attempt,
    validation,
    outcomeBoundary: countingOutcomeBoundary,
    capability,
    root,
    input(overrides: Partial<OutcomeProductionInput> = {}): OutcomeProductionInput {
      return {
        attempt,
        outcome: makeOutcome(),
        observation,
        enforcement,
        handoff,
        validation,
        registry: registryCtx,
        store: countingOutcomeBoundary,
        records: wp12Context.store,
        coordinate: createProcessLocalCoordinator(),
        identity: makeCountingOutcomeIdentity(),
        schemaRegistry: registry,
        capability,
        ...overrides,
      };
    },
    seedOutcome(opts: { readonly withAssociation?: boolean; readonly withEnforcement?: boolean; readonly overrides?: Partial<Readonly<Record<string, unknown>>> } = {}): string {
      const { withAssociation = true, withEnforcement = true, overrides = {} } = opts;
      const payload = expectedOutcomePayload(
        {
          registryCtx,
          attempt,
          outcome: makeOutcome(),
          observation,
          ...(withEnforcement ? { enforcement } : {}),
          ...(withAssociation ? { handoff } : {}),
        },
        { record_id: nextRecordId(), ...overrides },
      );
      return seedRawRecord(integration.storeEnv, 'execution-outcome-record', payload);
    },
    seedRawOutcome(payload: Readonly<Record<string, unknown>>): string {
      return seedRawRecord(integration.storeEnv, 'execution-outcome-record', payload);
    },
    outcomeRecords(): Readonly<Record<string, unknown>>[] {
      const out: Readonly<Record<string, unknown>>[] = [];
      const enumerated = outcomeBoundary.enumerateLifecycleRecords('execution-outcome-record');
      if (!enumerated.ok) return [];
      for (const recordId of enumerated.recordIds) {
        const read = outcomeBoundary.readLifecyclePayload('execution-outcome-record', recordId);
        if (read.ok && read.payload !== undefined) out.push(read.payload);
      }
      return out;
    },
    outcomePublishCount: () => outcomePublishCalls,
    publicationBoundary,
    publicationCapability,
    pubInput(overrides: Partial<PublicationInput> = {}): PublicationInput {
      return {
        handoff,
        evaluatorProvenance: { evaluator_id: handoff.evaluatorId, capability_profile_id: handoff.capabilityProfileId },
        registry: registryCtx,
        store: publicationBoundary,
        coordinate: createProcessLocalCoordinator(),
        identity: { nowUtcIso: () => FIXED_NOW, newRecordId: () => nextRecordId() },
        schemaRegistry: registry,
        capability: publicationCapability,
        outcome: outcomePrecondition,
        ...overrides,
      };
    },
  };
  return env;
}
