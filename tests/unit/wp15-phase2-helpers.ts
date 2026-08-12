/**
 * WP-15 Phase 2 — receipt/publication correlation focused test harness.
 *
 * Real initialized WP-8 store, real WP-12 lifecycle chain (grant →
 * activation → occurrence → attempt), real outcome/validation/publication/
 * receipt seeding through raw WP-8 publication, the real two-class
 * correlation store boundary + capability, and counting/throwing identity +
 * store wrappers for the correlation decision tests.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cleanupTestEnvs,
  makeContext,
  makeIdentitySource,
  makeIntegrationEnv,
  makeRegistryContext,
  seedRawRecord,
  UID,
  WRITE_ACTION,
} from './wp12-helpers.js';
import {
  OCCURRENCE_ID,
  ATTEMPT_ID,
  ATTEMPT_RECORD_ID,
  VALIDATION_RECORD_ID,
  PUBLICATION_RECORD_ID,
  RESULT_INSTANCE_ID,
  RESULT_REVISION_ID,
  RESULT_DIGEST,
  WS_A,
  FIXED_NOW,
  seedLifecycleChain,
  seedOutcomeFor,
  seedValidation,
  expectedPublicationPayload,
  expectedReceiptPayload,
  makeCountingReceiptIdentity,
  type SeededChain,
  type CountingReceiptIdentity,
} from './wp15-phase1b-helpers.js';
import { defaultLimitProfile } from '../../src/storage/limits/limits.js';
import { registryReferenceFor } from '../../src/control-plane/records.js';
import { createCorrelationStoreBoundary } from '../../src/receipt-publication-correlation/store.js';
import { createReceiptPublicationCorrelationCapability } from '../../src/receipt-publication-correlation/internal/brand.js';
import { createReceiptPublicationCorrelationAuthority } from '../../src/receipt-publication-correlation/index.js';
import { createProcessLocalCoordinator } from '../../src/control-plane/coordination.js';
import { computePayloadDigest } from '../../src/storage/format/envelope.js';
import { createSchemaRegistry } from '../../src/api/validate.js';
import type { ControlPlaneStoreBoundary, ControlPlaneTrustedContext, DecisionCoordinator } from '../../src/control-plane/types.js';
import type { AcceptedRegistryContext } from '../../src/api/types.js';
import type { CorrelationIdentitySource, CorrelationInput, CorrelationRequest, CorrelationResult, CorrelationStoreBoundary } from '../../src/receipt-publication-correlation/types.js';
import type { CorrelationAuthorityOptions } from '../../src/receipt-publication-correlation/index.js';
import type { StoreEnv } from './wp12-helpers.js';

/** The exact correlation receipt record identity used by the harness. */
export const RECEIPT_RECORD_ID = 'pgw:l:' + 'b'.repeat(32);

export { OCCURRENCE_ID, ATTEMPT_ID, ATTEMPT_RECORD_ID, VALIDATION_RECORD_ID, PUBLICATION_RECORD_ID, RESULT_INSTANCE_ID, RESULT_REVISION_ID, RESULT_DIGEST, WS_A, FIXED_NOW };
export { seedOutcomeFor, seedValidation, expectedPublicationPayload, expectedReceiptPayload } from './wp15-phase1b-helpers.js';

const registry = createSchemaRegistry();

const roots: string[] = [];
export function correlationCleanup(): void {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  cleanupTestEnvs();
}

let recordIdCounter = 0x7000;
export function nextRecordId(): string {
  return `pgw:l:${(recordIdCounter++).toString(16).padStart(32, '0')}`;
}

/**
 * The exact `result-publication-correlation` TrustedReceipt payload for the
 * standard chain (attests the exact predecessor publication).
 */
export function correlationReceiptPayload(
  registryCtx: AcceptedRegistryContext,
  chain: SeededChain,
  overrides: Partial<Readonly<Record<string, unknown>>> = {},
): Readonly<Record<string, unknown>> {
  const base = expectedReceiptPayload(
    registryCtx,
    { workspaceId: WS_A, eventType: 'result-publication-correlation', eventRecordId: PUBLICATION_RECORD_ID },
    'completed',
    chain.occurrenceId,
    chain.attemptId,
    RECEIPT_RECORD_ID,
    FIXED_NOW,
  );
  return Object.freeze({ ...base, ...overrides });
}

/** Seed the standard chain + outcome + validation + predecessor publication + correlation receipt. */
export function seedCorrelationBase(env: { readonly integration: ReturnType<typeof makeIntegrationEnv>; readonly registryCtx: AcceptedRegistryContext; readonly chain: SeededChain; readonly store: ControlPlaneStoreBoundary }): void {
  seedOutcomeFor(env, 'completed', { withAssociation: true });
  seedValidation(env.store, env.registryCtx);
  seedRawRecord(env.integration.storeEnv, 'result-publication-record', expectedPublicationPayload(env.registryCtx, env.chain));
  seedRawRecord(env.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(env.registryCtx, env.chain));
}

/** The exact successor ResultPublicationRecord payload the authority builds (test-side mirror). */
export function expectedSuccessorPayload(
  registryCtx: AcceptedRegistryContext,
  chain: SeededChain,
  receiptRecordId: string,
  recordId: string,
  createdAt: string,
  overrides: Partial<Readonly<Record<string, unknown>>> = {},
): Readonly<Record<string, unknown>> {
  const predecessor = expectedPublicationPayload(registryCtx, chain);
  return Object.freeze({
    record_type: 'ResultPublicationRecord',
    record_id: recordId,
    created_at: createdAt,
    responsible_role: 'trusted-result-publisher',
    registry_snapshot_reference: registryReferenceFor(registryCtx),
    result_subject: Object.freeze({ ...(predecessor['result_subject'] as Readonly<Record<string, unknown>>) }),
    evaluator_provenance: Object.freeze({ ...(predecessor['evaluator_provenance'] as Readonly<Record<string, unknown>>) }),
    association_mode: predecessor['association_mode'],
    validation_record_id: predecessor['validation_record_id'],
    bundle: Object.freeze({ ...(predecessor['bundle'] as Readonly<Record<string, unknown>>) }),
    workspace_id: predecessor['workspace_id'],
    occurrence_id: predecessor['occurrence_id'],
    attempt_id: predecessor['attempt_id'],
    publication_scopes: Object.freeze(['ordinary-review', 'completion-status', 'downstream-automation', 'authoritative-reporting']),
    receipt_correlations: Object.freeze([receiptRecordId]),
    ...overrides,
  });
}

/** The exact SupersessionRecord payload the authority builds (test-side mirror). */
export function expectedSupersessionPayload(
  registryCtx: AcceptedRegistryContext,
  predecessorRecordId: string,
  successorRecordId: string,
  recordId: string,
  createdAt: string,
  overrides: Partial<Readonly<Record<string, unknown>>> = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    record_type: 'SupersessionRecord',
    record_id: recordId,
    created_at: createdAt,
    responsible_role: 'trusted-lifecycle-authority',
    registry_snapshot_reference: registryReferenceFor(registryCtx),
    prior: Object.freeze({ subject_type: 'result-publication', record_id: predecessorRecordId }),
    successor: Object.freeze({ subject_type: 'result-publication', record_id: successorRecordId }),
    scope: 'ordinary-review',
    reason_code: 'receipt-correlation',
    ...overrides,
  });
}

// ─── correlation environment ────────────────────────────────────────────────

let identityBase = 0xa000;

/**
 * Counting identity source: minted record ids never collide across identity
 * instances (each instance owns a distinct base) so multi-correlation tests
 * can distinguish allocation from replay.
 */
export function makeCountingCorrelationIdentity(now: string = FIXED_NOW): CountingReceiptIdentity {
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
export function makeThrowingCorrelationIdentity(): CorrelationIdentitySource {
  return {
    nowUtcIso: () => {
      throw new Error('time source must not be invoked');
    },
    newRecordId: () => {
      throw new Error('record-id source must not be invoked');
    },
  };
}

export interface CorrelationEnv {
  readonly integration: ReturnType<typeof makeIntegrationEnv>;
  readonly registryCtx: AcceptedRegistryContext;
  readonly chain: SeededChain;
  readonly store: ControlPlaneStoreBoundary;
  readonly boundary: CorrelationStoreBoundary;
  readonly capability: NonNullable<ReturnType<typeof createReceiptPublicationCorrelationCapability>>;
  readonly root: string;
  /** The exact correlation input (reusable; mutating copies per test). */
  input(overrides?: Partial<CorrelationInput>): CorrelationInput;
  /**
   * The composed host authority (§5): closes over the host registry
   * provider, identity/clock, coordinator, boundary, capability, and any
   * host-only hooks; `correlate` accepts ONLY a CorrelationRequest.
   * Composition failure throws (the host fails closed).
   */
  authority(opts?: {
    readonly identity?: CorrelationIdentitySource;
    readonly coordinate?: DecisionCoordinator;
    readonly hooks?: { readonly beforeFirstSuccessorPublication?: () => void; readonly beforeFirstSupersessionPublication?: () => void };
  }): NonNullable<ReturnType<typeof createReceiptPublicationCorrelationAuthority>>;
  /** Seed the standard base state (outcome + validation + predecessor + receipt). */
  seedBase(): void;
  /** Read every durable result-publication-record payload. */
  publicationRecords(): Readonly<Record<string, unknown>>[];
  /** Read every durable supersession-record payload. */
  supersessionRecords(): Readonly<Record<string, unknown>>[];
  /** Read one durable supersession payload. */
  readSupersession(recordId: string): Readonly<Record<string, unknown>> | undefined;
  /** Read one durable publication payload. */
  readPublication(recordId: string): Readonly<Record<string, unknown>> | undefined;
  /** Seed one raw supersession-record (replay/conflict vectors). */
  seedSupersession(payload: Readonly<Record<string, unknown>>): string;
  /** Seed one raw result-publication-record (successor conflict vectors). */
  seedPublicationRaw(payload: Readonly<Record<string, unknown>>): string;
  successorPublishCount(): number;
  supersessionPublishCount(): number;
}

export function makeCorrelationEnv(): CorrelationEnv {
  const integration = makeIntegrationEnv();
  const registryCtx = makeRegistryContext();
  const identity = makeIdentitySource();
  const wp12Context = makeContext(integration.storeEnv, { identity });
  const chain = seedLifecycleChain(wp12Context.store, registryCtx);

  const root = mkdtempSync(join(tmpdir(), 'wp15p2-'));
  roots.push(root);

  const boundary = createCorrelationStoreBoundary({
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
  const capability = createReceiptPublicationCorrelationCapability({
    trustedConfiguration: integration.storeEnv.config,
    actionIdentity: 'correlation-action-1',
  });
  if (capability === undefined) throw new Error('correlation capability minting failed');

  let successorPublishCalls = 0;
  let supersessionPublishCalls = 0;
  const countingBoundary: CorrelationStoreBoundary = {
    publishSuccessorPublication(permit, payload) {
      successorPublishCalls += 1;
      return boundary.publishSuccessorPublication(permit, payload);
    },
    publishSupersession(permit, payload) {
      supersessionPublishCalls += 1;
      return boundary.publishSupersession(permit, payload);
    },
    readLifecyclePayload(recordClass, recordId) {
      return boundary.readLifecyclePayload(recordClass, recordId);
    },
    enumerateLifecycleRecords(recordClass) {
      return boundary.enumerateLifecycleRecords(recordClass);
    },
  };

  const env: CorrelationEnv = {
    integration,
    registryCtx,
    chain,
    store: wp12Context.store,
    boundary: countingBoundary,
    capability,
    root,
    input(overrides: Partial<CorrelationInput> = {}): CorrelationInput {
      return {
        request: { workspaceId: WS_A, predecessorPublicationRecordId: PUBLICATION_RECORD_ID, trustedReceiptRecordId: RECEIPT_RECORD_ID },
        registry: registryCtx,
        store: countingBoundary,
        coordinate: createProcessLocalCoordinator(),
        identity: makeCountingCorrelationIdentity(),
        schemaRegistry: registry,
        capability,
        ...overrides,
      };
    },
    authority(opts: {
      readonly identity?: CorrelationIdentitySource;
      readonly coordinate?: DecisionCoordinator;
      readonly hooks?: { readonly beforeFirstSuccessorPublication?: () => void; readonly beforeFirstSupersessionPublication?: () => void };
    } = {}): NonNullable<ReturnType<typeof createReceiptPublicationCorrelationAuthority>> {
      const options: CorrelationAuthorityOptions = {
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
        actionIdentity: 'correlation-action-1',
        registryProvider: () => registryCtx,
        identity: opts.identity ?? makeCountingCorrelationIdentity(),
        coordinate: opts.coordinate ?? createProcessLocalCoordinator(),
        ...(opts.hooks !== undefined ? { hooks: opts.hooks } : {}),
      };
      const authority = createReceiptPublicationCorrelationAuthority(options);
      if (authority === undefined) throw new Error('correlation authority composition failed');
      return authority;
    },
    seedBase(): void {
      seedCorrelationBase(env);
    },
    publicationRecords(): Readonly<Record<string, unknown>>[] {
      const out: Readonly<Record<string, unknown>>[] = [];
      const enumerated = countingBoundary.enumerateLifecycleRecords('result-publication-record');
      if (!enumerated.ok) return [];
      for (const recordId of enumerated.recordIds) {
        const read = countingBoundary.readLifecyclePayload('result-publication-record', recordId);
        if (read.ok && read.payload !== undefined) out.push(read.payload);
      }
      return out;
    },
    supersessionRecords(): Readonly<Record<string, unknown>>[] {
      const out: Readonly<Record<string, unknown>>[] = [];
      const enumerated = countingBoundary.enumerateLifecycleRecords('supersession-record');
      if (!enumerated.ok) return [];
      for (const recordId of enumerated.recordIds) {
        const read = countingBoundary.readLifecyclePayload('supersession-record', recordId);
        if (read.ok && read.payload !== undefined) out.push(read.payload);
      }
      return out;
    },
    readSupersession(recordId: string): Readonly<Record<string, unknown>> | undefined {
      const read = countingBoundary.readLifecyclePayload('supersession-record', recordId);
      return read.ok && read.payload !== undefined ? read.payload : undefined;
    },
    readPublication(recordId: string): Readonly<Record<string, unknown>> | undefined {
      const read = countingBoundary.readLifecyclePayload('result-publication-record', recordId);
      return read.ok && read.payload !== undefined ? read.payload : undefined;
    },
    seedSupersession(payload: Readonly<Record<string, unknown>>): string {
      return seedRawRecord(integration.storeEnv, 'supersession-record', payload);
    },
    seedPublicationRaw(payload: Readonly<Record<string, unknown>>): string {
      return seedRawRecord(integration.storeEnv, 'result-publication-record', payload);
    },
    successorPublishCount: () => successorPublishCalls,
    supersessionPublishCount: () => supersessionPublishCalls,
  };
  return env;
}

/** Assert a correlation success and return the typed fields. */
export function correlatedOf(result: CorrelationResult): { readonly outcome: 'correlated' | 'recovered' | 'replayed'; readonly predecessorRecordId: string; readonly successorRecordId: string; readonly supersessionRecordId: string; readonly receiptRecordId: string; readonly successorAuditEventId?: string; readonly supersessionAuditEventId?: string } {
  if (!result.ok) throw new Error(`expected correlation success, got ${JSON.stringify(result)}`);
  return result;
}

/** Assert a typed correlation failure and return category/code. */
export function failedOf(result: CorrelationResult): { readonly category: string; readonly code: string } {
  if (result.ok) throw new Error(`expected correlation failure, got ${JSON.stringify(result)}`);
  return { category: result.category, code: result.code };
}

export { computePayloadDigest };
