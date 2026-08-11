/**
 * WP-15 Phase 1B — trusted receipt production focused test harness.
 *
 * Real initialized WP-8 store, real WP-12 lifecycle chain (grant →
 * activation → occurrence → attempt), real outcome/validation/publication
 * seeding through raw WP-8 publication, the real single-class receipt store
 * boundary + capability, and counting/throwing identity + store wrappers for
 * the receipt decision tests.
 */
import { mkdtempSync, rmSync } from 'node:fs';
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
import { defaultLimitProfile } from '../../src/storage/limits/limits.js';
import { registryReferenceFor, buildValidationRecordPayload, buildRuntimeGrantPayload, buildActivationRecordPayload, buildExecutionOccurrenceRecordPayload, buildExecutionAttemptRecordPayload } from '../../src/control-plane/records.js';
import { createReceiptStoreBoundary } from '../../src/receipt-production/store.js';
import { createTrustedReceiptCapability } from '../../src/receipt-production/internal/brand.js';
import { createReceiptProducerAuthority } from '../../src/receipt-production/index.js';
import { createProcessLocalCoordinator } from '../../src/control-plane/coordination.js';
import { computePayloadDigest } from '../../src/storage/format/envelope.js';
import { createSchemaRegistry } from '../../src/api/validate.js';
import type { ControlPlaneStoreBoundary, ControlPlaneTrustedContext, DecisionCoordinator } from '../../src/control-plane/types.js';
import type { AcceptedRegistryContext } from '../../src/api/types.js';
import type { ReceiptIdentitySource, ReceiptInput, ReceiptRequest, ReceiptResult, ReceiptStoreBoundary } from '../../src/receipt-production/types.js';
import type { ReceiptProducerAuthorityOptions } from '../../src/receipt-production/index.js';
import type { StoreEnv } from './wp12-helpers.js';

const OCCURRENCE_ID = 'pgw:o:' + 'a'.repeat(32);
const ATTEMPT_ID = 'pgw:a:' + '1'.repeat(32);
const ATTEMPT_RECORD_ID = 'pgw:l:' + '2'.repeat(32);
const OCCURRENCE_RECORD_ID = 'pgw:l:' + '3'.repeat(32);
const ACTIVATION_RECORD_ID = 'pgw:l:' + '4'.repeat(32);
const GRANT_ID = 'pgw:l:' + '5'.repeat(32);
const VALIDATION_RECORD_ID = 'pgw:l:' + '6'.repeat(32);
const PUBLICATION_RECORD_ID = 'pgw:l:' + '7'.repeat(32);
const RESULT_INSTANCE_ID = 'pgw:i:' + '8'.repeat(32);
const RESULT_REVISION_ID = 'pgw:r:' + '9'.repeat(32);
const RESULT_DIGEST = 'sha-256:' + '0'.repeat(64);
const LATER = '2026-08-05T06:00:00.000Z';

export { OCCURRENCE_ID, ATTEMPT_ID, ATTEMPT_RECORD_ID, OCCURRENCE_RECORD_ID, ACTIVATION_RECORD_ID, GRANT_ID, VALIDATION_RECORD_ID, PUBLICATION_RECORD_ID, RESULT_INSTANCE_ID, RESULT_REVISION_ID, RESULT_DIGEST, LATER, WS_A, FIXED_NOW };

const registry = createSchemaRegistry();

const roots: string[] = [];
export function receiptCleanup(): void {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  cleanupTestEnvs();
}

let recordIdCounter = 0x8000;
export function nextRecordId(): string {
  return `pgw:l:${(recordIdCounter++).toString(16).padStart(32, '0')}`;
}

/** A denied activation record (same bindings as the accepted chain, decision denied). */
export function deniedActivationPayload(recordId: string = 'pgw:l:' + 'c'.repeat(32)): Readonly<Record<string, unknown>> {
  return buildActivationRecordPayload({
    recordId,
    createdAt: FIXED_NOW,
    subject: grantChainSubjects(WS_A).bundle.subject,
    workspaceId: WS_A,
    requiredIssuanceRecordIds: Object.freeze([]),
    runtimeGrantId: GRANT_ID,
    reservedOccurrenceId: OCCURRENCE_ID,
    decision: 'denied',
    registry: makeRegistryContext(),
  });
}

export interface SeededChain {
  readonly bundleReference: Readonly<Record<string, unknown>>;
  readonly grantId: string;
  readonly activationRecordId: string;
  readonly occurrenceRecordId: string;
  readonly attemptRecordId: string;
  readonly occurrenceId: string;
  readonly attemptId: string;
}

/** Seed the standard accepted lifecycle chain (grant → activation → occurrence → attempt). */
export function seedLifecycleChain(store: ControlPlaneStoreBoundary, registryCtx: AcceptedRegistryContext): SeededChain {
  const bundleSubject = grantChainSubjects(WS_A).bundle.subject;
  const bundleReference: Readonly<Record<string, unknown>> = Object.freeze({
    target_protocol_version: bundleSubject.protocolVersion,
    target_kind: Object.freeze({ id: bundleSubject.kindId, version: bundleSubject.kindVersion }),
    target_instance_id: bundleSubject.instanceId,
    target_revision_id: bundleSubject.revisionId,
    target_digest: bundleSubject.digest,
    target_workspace_binding: Object.freeze({ mode: 'bound', workspace_id: WS_A }),
  });
  seedPayload(store, 'runtime-grant', buildRuntimeGrantPayload({
    recordId: GRANT_ID, createdAt: FIXED_NOW, subject: bundleSubject, workspaceId: WS_A,
    reservedOccurrenceId: OCCURRENCE_ID, attemptLimit: 3,
    validity: { not_before: FIXED_NOW, not_after: LATER },
    narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    registry: registryCtx,
  }));
  seedPayload(store, 'activation-record', buildActivationRecordPayload({
    recordId: ACTIVATION_RECORD_ID, createdAt: FIXED_NOW, subject: bundleSubject, workspaceId: WS_A,
    requiredIssuanceRecordIds: Object.freeze([]), runtimeGrantId: GRANT_ID,
    reservedOccurrenceId: OCCURRENCE_ID, decision: 'accepted', registry: registryCtx,
  }));
  seedPayload(store, 'execution-occurrence-record', buildExecutionOccurrenceRecordPayload({
    recordId: OCCURRENCE_RECORD_ID, createdAt: FIXED_NOW, activationRecordId: ACTIVATION_RECORD_ID,
    bundle: bundleReference, workspaceId: WS_A, occurrenceId: OCCURRENCE_ID, runtimeGrantId: GRANT_ID, registry: registryCtx,
  }));
  seedPayload(store, 'execution-attempt-record', buildExecutionAttemptRecordPayload({
    recordId: ATTEMPT_RECORD_ID, createdAt: FIXED_NOW, activationRecordId: ACTIVATION_RECORD_ID,
    occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID, ordinal: 1,
    bundle: bundleReference, workspaceId: WS_A, runtimeGrantId: GRANT_ID, registry: registryCtx,
  }));
  return { bundleReference, grantId: GRANT_ID, activationRecordId: ACTIVATION_RECORD_ID, occurrenceRecordId: OCCURRENCE_RECORD_ID, attemptRecordId: ATTEMPT_RECORD_ID, occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID };
}

/** The exact outcome-record payload for this chain (enforcement/association toggleable). */
export function expectedOutcomePayload(opts: {
  readonly registryCtx: AcceptedRegistryContext;
  readonly chain: SeededChain;
  readonly disposition?: string;
  readonly withEnforcement?: boolean;
  readonly withAssociation?: boolean;
  readonly overrides?: Partial<Readonly<Record<string, unknown>>>;
}): Readonly<Record<string, unknown>> {
  const { registryCtx, chain, disposition = 'completed', withEnforcement = true, withAssociation = true, overrides = {} } = opts;
  return Object.freeze({
    record_type: 'ExecutionOutcomeRecord',
    record_id: nextRecordId(),
    created_at: FIXED_NOW,
    responsible_role: 'trusted-execution-outcome-recorder',
    registry_snapshot_reference: registryReferenceFor(registryCtx),
    workspace_id: WS_A,
    bundle: Object.freeze({ ...chain.bundleReference }),
    occurrence_id: chain.occurrenceId,
    attempt_id: chain.attemptId,
    ordinal: 1,
    execution_attempt_record_id: chain.attemptRecordId,
    disposition,
    observation_evidence: Object.freeze({
      kind: 'external-evidence',
      evidence_id: 'pgw:e:0123456789abcdef0123456789abcdef',
      content_digest: 'sha-256:3333333333333333333333333333333333333333333333333333333333333333',
      declared_media_type: 'application/json',
      observation_role: 'evaluation-evidence',
    }),
    ...(withEnforcement
      ? {
          enforcement_evidence: Object.freeze({
            projection_identity: 'sha-256:1111111111111111111111111111111111111111111111111111111111111111',
            evidence_fingerprint: 'sha-256:2222222222222222222222222222222222222222222222222222222222222222',
          }),
        }
      : {}),
    ...(withAssociation
      ? {
          result_association: Object.freeze({
            instance_id: RESULT_INSTANCE_ID,
            revision_digest: RESULT_DIGEST,
            association_mode: 'adopted',
            validation_record_id: VALIDATION_RECORD_ID,
          }),
        }
      : {}),
    ...overrides,
  });
}

/** Seed one raw outcome record for the chain (any disposition/override). */
export function seedOutcome(env: StoreEnv, payload: Readonly<Record<string, unknown>>): string {
  return seedRawRecord(env, 'execution-outcome-record', payload);
}

/** Seed one exact-material outcome record for the standard chain. */
export function seedOutcomeFor(env: { readonly integration: ReturnType<typeof makeIntegrationEnv>; readonly registryCtx: AcceptedRegistryContext; readonly chain: SeededChain }, disposition: string, opts: { readonly withEnforcement?: boolean; readonly withAssociation?: boolean; readonly overrides?: Partial<Readonly<Record<string, unknown>>> } = {}): string {
  return seedOutcome(env.integration.storeEnv, expectedOutcomePayload({
    registryCtx: env.registryCtx,
    chain: env.chain,
    disposition,
    withEnforcement: opts.withEnforcement ?? false,
    withAssociation: opts.withAssociation ?? false,
    overrides: opts.overrides,
  }));
}

/** Seed the exact passing ValidationRecord for the correlation quartet. */
export function seedValidation(store: ControlPlaneStoreBoundary, registryCtx: AcceptedRegistryContext, recordId: string = VALIDATION_RECORD_ID): void {
  seedPayload(store, 'validation-record', buildValidationRecordPayload({
    recordId,
    createdAt: FIXED_NOW,
    subject: {
      protocolId: 'project-gateway.artifact',
      protocolVersion: '1.0',
      kindId: 'ExecutionResult' as never,
      kindVersion: '1.0',
      instanceId: RESULT_INSTANCE_ID,
      revisionId: RESULT_REVISION_ID,
      digest: RESULT_DIGEST,
      workspaceId: WS_A,
    },
    registry: registryCtx,
  }));
}

/** The exact ResultPublicationRecord payload for the chain (ordinary-review scope). */
export function expectedPublicationPayload(registryCtx: AcceptedRegistryContext, chain: SeededChain, overrides: Partial<Readonly<Record<string, unknown>>> = {}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    record_type: 'ResultPublicationRecord',
    record_id: PUBLICATION_RECORD_ID,
    created_at: FIXED_NOW,
    responsible_role: 'trusted-result-publisher',
    registry_snapshot_reference: registryReferenceFor(registryCtx),
    result_subject: Object.freeze({
      protocol_version: '1.0',
      kind: Object.freeze({ id: 'ExecutionResult', version: '1.0' }),
      instance_id: RESULT_INSTANCE_ID,
      revision_id: RESULT_REVISION_ID,
      digest: RESULT_DIGEST,
      workspace_id: WS_A,
    }),
    evaluator_provenance: Object.freeze({ evaluator_id: 'pgw:ev:f66fe624e4ae4057ca89caedf8daad41', capability_profile_id: 'pgw:cp:ccbd8effd83192143cfe9c362ca71584' }),
    association_mode: 'adopted',
    validation_record_id: VALIDATION_RECORD_ID,
    bundle: Object.freeze({ ...chain.bundleReference }),
    workspace_id: WS_A,
    occurrence_id: chain.occurrenceId,
    attempt_id: chain.attemptId,
    publication_scopes: Object.freeze(['ordinary-review']),
    receipt_correlations: Object.freeze([]),
    ...overrides,
  });
}

export function seedPublication(env: StoreEnv, payload: Readonly<Record<string, unknown>>): string {
  return seedRawRecord(env, 'result-publication-record', payload);
}

/** The exact receipt payload the authority builds for a request (test-side mirror). */
export function expectedReceiptPayload(registryCtx: AcceptedRegistryContext, request: ReceiptRequest, disposition: string, occurrenceId: string | undefined, attemptId: string | undefined, recordId: string, createdAt: string): Readonly<Record<string, unknown>> {
  const base = {
    record_type: 'TrustedReceipt',
    record_id: recordId,
    created_at: createdAt,
    responsible_role: 'trusted-receipt-producer',
    registry_snapshot_reference: registryReferenceFor(registryCtx),
    event_type: request.eventType,
    event_record_id: request.eventRecordId,
    workspace_id: request.workspaceId,
    disposition,
  };
  if (request.eventType === 'activation-decision' && disposition === 'denied') return Object.freeze(base);
  return Object.freeze({ ...base, occurrence_id: occurrenceId ?? null, attempt_id: attemptId ?? null });
}

// ─── receipt environment ────────────────────────────────────────────────────

export interface CountingReceiptIdentity extends ReceiptIdentitySource {
  readonly calls: { readonly recordId: number; readonly now: number };
}

let identityBase = 0x9000;

/**
 * Counting identity source: minted record ids never collide across
 * identity instances (each instance owns a distinct base) so multi-issuance
 * tests can distinguish allocation from replay.
 */
export function makeCountingReceiptIdentity(now: string = FIXED_NOW): CountingReceiptIdentity {
  const calls = { recordId: 0, now: 0 };
  const base = (identityBase += 0x100);
  return {
    calls,
    nowUtcIso: () => {
      calls.now += 1;
      return now;
    },
    newRecordId: () => {
      calls.recordId += 1;
      return `pgw:l:${(base + calls.recordId).toString(16).padStart(32, '0')}`;
    },
  };
}

/** Throwing identity sources proving replay/conflict/denial paths never allocate. */
export function makeThrowingReceiptIdentity(): ReceiptIdentitySource {
  return {
    nowUtcIso: () => {
      throw new Error('time source must not be invoked');
    },
    newRecordId: () => {
      throw new Error('record-id source must not be invoked');
    },
  };
}

export interface ReceiptEnv {
  readonly integration: ReturnType<typeof makeIntegrationEnv>;
  readonly registryCtx: AcceptedRegistryContext;
  readonly chain: SeededChain;
  readonly store: ControlPlaneStoreBoundary;
  readonly boundary: ReceiptStoreBoundary;
  readonly capability: NonNullable<ReturnType<typeof createTrustedReceiptCapability>>;
  readonly root: string;
  /** The exact receipt-issuance input (reusable; mutating copies per test). */
  input(overrides?: Partial<ReceiptInput>): ReceiptInput;
  /**
   * The composed host authority (SIR-WP15-P1B-002): closes over the host
   * registry provider, identity/clock, coordinator, boundary, capability,
   * and any host-only hooks; `issue` accepts ONLY a ReceiptRequest.
   */
  authority(opts?: { readonly identity?: ReceiptIdentitySource; readonly coordinate?: DecisionCoordinator; readonly hooks?: { readonly beforeFirstReceiptPublication?: () => void } }): ReturnType<typeof createReceiptProducerAuthority>;
  /** Read every durable receipt payload. */
  receiptRecords(): Readonly<Record<string, unknown>>[];
  /** Read one durable receipt payload. */
  readReceipt(recordId: string): Readonly<Record<string, unknown>> | undefined;
  /** Seed one raw trusted-receipt record (replay/conflict vectors). */
  seedReceipt(payload: Readonly<Record<string, unknown>>): string;
  receiptPublishCount(): number;
}

export function makeReceiptEnv(): ReceiptEnv {
  const integration = makeIntegrationEnv();
  const registryCtx = makeRegistryContext();
  const identity = makeIdentitySource();
  const wp12Context = makeContext(integration.storeEnv, { identity });
  const chain = seedLifecycleChain(wp12Context.store, registryCtx);

  const root = mkdtempSync(join(tmpdir(), 'wp15p1b-'));
  roots.push(root);

  const boundary = createReceiptStoreBoundary({
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
  const capability = createTrustedReceiptCapability({
    trustedConfiguration: integration.storeEnv.config,
    actionIdentity: 'receipt-production-action-1',
  });
  if (capability === undefined) throw new Error('receipt capability minting failed');

  let receiptPublishCalls = 0;
  const countingBoundary: ReceiptStoreBoundary = {
    publishTrustedReceipt(permit, payload) {
      receiptPublishCalls += 1;
      return boundary.publishTrustedReceipt(permit, payload);
    },
    readLifecyclePayload(recordClass, recordId) {
      return boundary.readLifecyclePayload(recordClass, recordId);
    },
    enumerateLifecycleRecords(recordClass) {
      return boundary.enumerateLifecycleRecords(recordClass);
    },
  };

  const env: ReceiptEnv = {
    integration,
    registryCtx,
    chain,
    store: wp12Context.store,
    boundary: countingBoundary,
    capability,
    root,
    input(overrides: Partial<ReceiptInput> = {}): ReceiptInput {
      return {
        request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID },
        registry: registryCtx,
        store: countingBoundary,
        coordinate: createProcessLocalCoordinator(),
        identity: makeCountingReceiptIdentity(),
        schemaRegistry: registry,
        capability,
        ...overrides,
      };
    },
    authority(opts: { readonly identity?: ReceiptIdentitySource; readonly coordinate?: DecisionCoordinator; readonly hooks?: { readonly beforeFirstReceiptPublication?: () => void } } = {}): ReturnType<typeof createReceiptProducerAuthority> {
      const options: ReceiptProducerAuthorityOptions = {
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
        lockTimeSource: { now: () => 1000, processStartTime: 500 },
        schemaRegistry: registry,
        actionIdentity: 'receipt-production-action-1',
        registryProvider: () => registryCtx,
        identity: opts.identity ?? makeCountingReceiptIdentity(),
        coordinate: opts.coordinate ?? createProcessLocalCoordinator(),
        ...(opts.hooks !== undefined ? { hooks: opts.hooks } : {}),
      };
      const authority = createReceiptProducerAuthority(options);
      if (authority === undefined) throw new Error('receipt authority composition failed');
      return authority;
    },
    receiptRecords(): Readonly<Record<string, unknown>>[] {
      const out: Readonly<Record<string, unknown>>[] = [];
      const enumerated = countingBoundary.enumerateLifecycleRecords('trusted-receipt');
      if (!enumerated.ok) return [];
      for (const recordId of enumerated.recordIds) {
        const read = countingBoundary.readLifecyclePayload('trusted-receipt', recordId);
        if (read.ok && read.payload !== undefined) out.push(read.payload);
      }
      return out;
    },
    readReceipt(recordId: string): Readonly<Record<string, unknown>> | undefined {
      const read = countingBoundary.readLifecyclePayload('trusted-receipt', recordId);
      return read.ok && read.payload !== undefined ? read.payload : undefined;
    },
    seedReceipt(payload: Readonly<Record<string, unknown>>): string {
      return seedRawRecord(integration.storeEnv, 'trusted-receipt', payload);
    },
    receiptPublishCount: () => receiptPublishCalls,
  };
  return env;
}

/** Assert a receipt issuance success and return the typed fields. */
export function issuedOf(result: ReceiptResult): { readonly outcome: 'issued' | 'replayed'; readonly recordId: string; readonly recordDigest: string; readonly auditEventId?: string } {
  if (!result.ok) throw new Error(`expected receipt success, got ${JSON.stringify(result)}`);
  return result;
}

/** Assert a typed receipt failure and return category/code. */
export function failedOf(result: ReceiptResult): { readonly category: string; readonly code: string } {
  if (result.ok) throw new Error(`expected receipt failure, got ${JSON.stringify(result)}`);
  return { category: result.category, code: result.code };
}

export { computePayloadDigest };
