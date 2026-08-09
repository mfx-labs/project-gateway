/**
 * WP-12 Slice 3B — decideActivation + createOccurrence FOCUSED tests.
 *
 * Covers the focused contract test surface (§26.21 activation/recovery
 * families): request boundary, rejection-vs-denial boundary, PHASE-1
 * correlation failures, PHASE-2 durable denials (revoked/expired chain,
 * grant state, policy/ceiling/consumer intersection, activation_limit),
 * replay/occurrence cardinality, and crash-recovery semantics (including
 * historical completion after revocation/expiry). Real initialized WP-8
 * store coverage lives in wp12-activation-store.test.ts.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import { buildValidationRecordPayload, buildApprovalRecordPayload, buildIssuanceRecordPayload, buildRuntimeGrantPayload, buildActivationRecordPayload } from '../../src/control-plane/records.js';
import {
  cleanupTestEnvs,
  grantChainSubjects,
  makeConfigEnv,
  makeContext,
  makeEvidence,
  makeIdentitySource,
  makeIntegrationEnv,
  makeRegistryContext,
  makeSubject,
  makeActivationKit,
  seedPayload,
  WS_A,
} from './wp12-helpers.js';
import type { ControlPlaneStoreBoundary } from '../../src/control-plane/types.js';
import type { AcceptedRegistryContext, ConsumerSupportDeclaration } from '../../src/api/types.js';

after(() => cleanupTestEnvs());

const REGISTRY = makeRegistryContext();
const ECHO = Object.freeze({ registry_snapshot_id: REGISTRY.registrySnapshotId, registry_snapshot_digest: REGISTRY.registrySnapshotDigest });
const FIXED_NOW = '2026-08-04T06:00:00.000Z';
const LATER = '2026-08-05T06:00:00.000Z';
const BUNDLE = grantChainSubjects().bundle;

const DEFAULT_CONSUMER_SUPPORT: ConsumerSupportDeclaration = Object.freeze({
  consumerId: 'test-consumer',
  supportedProtocolFeatures: [],
  supportedConsumerCapabilities: ['project-gateway.workspace-read'],
  supportedExtensionNamespaces: [],
});

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

function activationOperand(grantId: string, reservedOccurrenceId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation: 'decideActivation',
    subject: subjectOperand(BUNDLE.subject),
    workspaceId: WS_A,
    registryEcho: ECHO,
    grantId,
    reservedOccurrenceId,
    ...overrides,
  };
}

function recoveryOperand(reservedOccurrenceId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation: 'createOccurrence',
    workspaceId: WS_A,
    registryEcho: ECHO,
    reservedOccurrenceId,
    ...overrides,
  };
}

// ─── in-memory fake store ───────────────────────────────────────────────────

function makeFakeStore(): { readonly store: ControlPlaneStoreBoundary } {
  const byClass = new Map<string, Readonly<Record<string, unknown>>[]>();
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
  return { store };
}

interface FakeChainOptions {
  /** Bundle issuance overrides (expiry / activation_limit tests). */
  readonly bundleIssuance?: { readonly validUntil?: string | null; readonly activationLimit?: number };
  readonly excludeMember?: string;
  readonly registry?: AcceptedRegistryContext;
}

/**
 * Seed the genuine five-subject chain into a FAKE store using the accepted
 * record builders (fixed high record identities; never colliding with
 * identity-source ids). Returns the five issuance/approval identities.
 */
function seedFakeChain(
  store: ControlPlaneStoreBoundary,
  options: FakeChainOptions = {},
): { readonly issuanceIds: readonly string[]; readonly approvalIds: readonly string[] } {
  const registry = options.registry ?? REGISTRY;
  const { bundle, members } = grantChainSubjects(WS_A);
  const subjects = [bundle, ...members].filter((info) => info.subject.kindId !== options.excludeMember);
  const id = (base: number): string => `pgw:l:${base.toString(16).padStart(32, '0')}`;
  const issuanceIds: string[] = [];
  const approvalIds: string[] = [];
  for (let k = 0; k < subjects.length; k += 1) {
    const info = subjects[k]!;
    const validationId = id(0x2000 + k);
    seedPayload(store, 'validation-record', buildValidationRecordPayload({ recordId: validationId, createdAt: FIXED_NOW, subject: info.subject, registry }));
    const approvalId = id(0x2100 + k);
    seedPayload(store, 'approval-record', buildApprovalRecordPayload({
      recordId: approvalId, createdAt: FIXED_NOW, subject: info.subject, workspaceId: WS_A,
      purpose: 'execution-use', validationRecordIds: [validationId],
      requiredSemantics: { protocol_features: [], consumer_capabilities: [] }, validUntil: null, registry,
    }));
    approvalIds.push(approvalId);
    const isBundle = k === 0;
    const issuanceId = id(0x2200 + k);
    seedPayload(store, 'issuance-record', buildIssuanceRecordPayload({
      recordId: issuanceId, createdAt: FIXED_NOW, subject: info.subject, workspaceId: WS_A,
      useClass: 'execution-use', approvalRecordId: approvalId,
      activationLimit: isBundle ? (options.bundleIssuance?.activationLimit ?? 1) : 1,
      validUntil: isBundle ? (options.bundleIssuance?.validUntil ?? null) : null,
      registry,
    }));
    issuanceIds.push(issuanceId);
  }
  return { issuanceIds: Object.freeze(issuanceIds), approvalIds: Object.freeze(approvalIds) };
}

interface SeededGrant {
  readonly grantId: string;
  readonly reservedOccurrenceId: string;
}

/** Seed a RuntimeGrant directly into a fake store (test fixture; 3A genuine issue path is covered elsewhere). */
function seedGrant(store: ControlPlaneStoreBoundary, overrides: Record<string, unknown> = {}): SeededGrant {
  const reservedOccurrenceId = String(overrides['reserved_occurrence_id'] ?? `pgw:o:${'a'.repeat(32)}`);
  const payload = buildRuntimeGrantPayload({
    recordId: String(overrides['record_id'] ?? 'pgw:l:cccccccccccccccccccccccccccccccc'),
    createdAt: FIXED_NOW,
    subject: BUNDLE.subject,
    workspaceId: WS_A,
    reservedOccurrenceId,
    attemptLimit: 2,
    validity: {
      not_before: String(overrides['not_before'] ?? FIXED_NOW),
      not_after: String(overrides['not_after'] ?? LATER),
    },
    narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    registry: (overrides['registry'] as AcceptedRegistryContext | undefined) ?? REGISTRY,
  });
  seedPayload(store, 'runtime-grant', payload);
  return { grantId: String(payload['record_id']), reservedOccurrenceId };
}

function activationContext(
  integration: ReturnType<typeof makeIntegrationEnv>,
  store: ControlPlaneStoreBoundary,
  overrides: {
    readonly identity?: ReturnType<typeof makeIdentitySource>;
    readonly store?: ControlPlaneStoreBoundary;
    readonly consumerSupport?: ConsumerSupportDeclaration;
    readonly configuration?: import('../../src/trusted/types.js').ValidatedTrustedWorkspaceConfiguration;
  } = {},
) {
  return makeContext(integration.storeEnv, {
    store: overrides.store ?? store,
    identity: overrides.identity ?? makeIdentitySource(),
    activationRole: true,
    consumerSupport: overrides.consumerSupport ?? DEFAULT_CONSUMER_SUPPORT,
    subjectArtifact: makeEvidence('ExecutionBundle').artifact,
    policyEvidence: makeEvidence('AuthorityPolicy').artifact,
    ...(overrides.configuration !== undefined ? { configuration: overrides.configuration } : {}),
  });
}

// ─── REQUEST boundary ───────────────────────────────────────────────────────

test('activation request: exact valid request reaches an accepted decision', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const { grantId, reservedOccurrenceId } = seedGrant(store);
  const context = activationContext(integration, store);
  const result = executeSlice1Command(activationOperand(grantId, reservedOccurrenceId), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.evidence.decision, 'accepted');
  assert.equal(result.evidence.runtimeGrantId, grantId);
  assert.equal(result.evidence.reservedOccurrenceId, reservedOccurrenceId);
  assert.equal(typeof result.evidence.occurrenceRecordId, 'string', 'accepted activation carries the occurrence identity');
  assert.equal(result.evidence.occurrenceRecordClass, 'execution-occurrence-record');
  assert.equal(store.enumerateLifecycleRecords('activation-record').recordIds.length, 1);
  assert.equal(store.enumerateLifecycleRecords('execution-occurrence-record').recordIds.length, 1, 'exactly one occurrence');
});

test('activation request: unknown keys are request-invalid; role assertion is approver-not-independent', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const { grantId, reservedOccurrenceId } = seedGrant(store);
  const context = activationContext(integration, store);
  for (const extra of [
    { approvalRecordIds: ['pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
    { issuanceRecordIds: ['pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
    { consumerSupport: DEFAULT_CONSUMER_SUPPORT },
    { policyIdentity: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { occurrenceId: 'pgw:o:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  ]) {
    const result = executeSlice1Command(activationOperand(grantId, reservedOccurrenceId, extra), context);
    assert.equal(result.ok, false, JSON.stringify(extra));
    if (!result.ok) assert.equal(result.category, 'request-invalid', JSON.stringify(extra));
  }
  for (const extra of [{ activationRole: true }, { activationAuthority: true }]) {
    const result = executeSlice1Command(activationOperand(grantId, reservedOccurrenceId, extra), context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'approver-not-independent', JSON.stringify(extra));
  }
});

test('activation request: missing/malformed operands are request-invalid; echo mismatch is registry-context-mismatch', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const { grantId, reservedOccurrenceId } = seedGrant(store);
  const context = activationContext(integration, store);
  for (const missing of ['grantId', 'reservedOccurrenceId', 'registryEcho']) {
    const operand = activationOperand(grantId, reservedOccurrenceId);
    delete operand[missing];
    const result = executeSlice1Command(operand, context);
    assert.equal(result.ok, false, `missing ${missing}`);
    if (!result.ok) assert.equal(result.category, 'request-invalid', `missing ${missing}`);
  }
  for (const malformed of [
    activationOperand('not-a-record-id', reservedOccurrenceId),
    activationOperand(grantId, 'not-an-occurrence-id'),
  ]) {
    const result = executeSlice1Command(malformed, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'request-invalid');
  }
  const mismatched = executeSlice1Command(activationOperand(grantId, reservedOccurrenceId, {
    registryEcho: { registry_snapshot_id: 'pgw:g:11111111111111111111111111111111', registry_snapshot_digest: `sha-256:${'1'.repeat(64)}` },
  }), context);
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) assert.equal(mismatched.category, 'registry-context-mismatch');
});

test('activation request: non-ExecutionBundle subject is request-invalid; missing host activation role is lifecycle-state-missing with zero records', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const { grantId, reservedOccurrenceId } = seedGrant(store);
  const task = makeSubject('TaskSpec');
  const wrongKind = executeSlice1Command(
    activationOperand(grantId, reservedOccurrenceId, { subject: subjectOperand(task.subject) }),
    activationContext(integration, store),
  );
  assert.equal(wrongKind.ok, false);
  if (!wrongKind.ok) assert.equal(wrongKind.category, 'request-invalid');
  const noRole = executeSlice1Command(
    activationOperand(grantId, reservedOccurrenceId),
    makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), activationRole: false }),
  );
  assert.equal(noRole.ok, false);
  if (!noRole.ok) assert.equal(noRole.category, 'lifecycle-state-missing');
  assert.equal(store.enumerateLifecycleRecords('activation-record').recordIds.length, 0);
});

// ─── REJECTIONS (zero records) ──────────────────────────────────────────────

test('activation rejection: grant missing / wrong workspace / wrong bundle / reservation mismatch are lifecycle-state-missing', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const { grantId, reservedOccurrenceId } = seedGrant(store);
  const context = activationContext(integration, store);
  const missingGrant = executeSlice1Command(activationOperand('pgw:l:ffffffffffffffffffffffffffffffff', reservedOccurrenceId), context);
  assert.equal(missingGrant.ok, false);
  if (!missingGrant.ok) assert.equal(missingGrant.category, 'lifecycle-state-missing');
  // Grant bound to another workspace (same bundle reference, other reservation).
  const foreignGrant = buildRuntimeGrantPayload({
    recordId: 'pgw:l:dddddddddddddddddddddddddddddddd',
    createdAt: FIXED_NOW,
    subject: Object.freeze({ ...BUNDLE.subject, workspaceId: 'pgw:w:99999999999999999999999999999999' }),
    workspaceId: 'pgw:w:99999999999999999999999999999999',
    reservedOccurrenceId: `pgw:o:${'b'.repeat(32)}`,
    attemptLimit: 2,
    validity: { not_before: FIXED_NOW, not_after: LATER },
    narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    registry: REGISTRY,
  });
  seedPayload(store, 'runtime-grant', foreignGrant);
  const wrongWorkspace = executeSlice1Command(activationOperand('pgw:l:dddddddddddddddddddddddddddddddd', `pgw:o:${'b'.repeat(32)}`), context);
  assert.equal(wrongWorkspace.ok, false);
  if (!wrongWorkspace.ok) assert.equal(wrongWorkspace.category, 'lifecycle-state-missing');
  // Grant bound to another bundle revision (same workspace).
  const otherBundleGrant = buildRuntimeGrantPayload({
    recordId: 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    createdAt: FIXED_NOW,
    subject: Object.freeze({ ...BUNDLE.subject, revisionId: 'pgw:r:ffffffffffffffffffffffffffffffff', digest: `sha-256:${'f'.repeat(64)}` }),
    workspaceId: WS_A,
    reservedOccurrenceId: `pgw:o:${'c'.repeat(32)}`,
    attemptLimit: 2,
    validity: { not_before: FIXED_NOW, not_after: LATER },
    narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    registry: REGISTRY,
  });
  seedPayload(store, 'runtime-grant', otherBundleGrant);
  const wrongBundle = executeSlice1Command(activationOperand('pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', `pgw:o:${'c'.repeat(32)}`), context);
  assert.equal(wrongBundle.ok, false);
  if (!wrongBundle.ok) assert.equal(wrongBundle.category, 'lifecycle-state-missing');
  // Reservation mismatch: the grant's reservation differs from the request.
  const wrongReservation = executeSlice1Command(activationOperand(grantId, `pgw:o:${'d'.repeat(32)}`), context);
  assert.equal(wrongReservation.ok, false);
  if (!wrongReservation.ok) assert.equal(wrongReservation.category, 'lifecycle-state-missing');
  assert.equal(store.enumerateLifecycleRecords('activation-record').recordIds.length, 0, 'zero records on every rejection');
});

test('activation rejection: missing member chain → lifecycle-state-missing; ambiguous issuances → lifecycle-conflict', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store, { excludeMember: 'CompletionContract' });
  const { grantId, reservedOccurrenceId } = seedGrant(store);
  const context = activationContext(integration, store);
  const missing = executeSlice1Command(activationOperand(grantId, reservedOccurrenceId), context);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.category, 'lifecycle-state-missing', JSON.stringify(missing));
  assert.equal(store.enumerateLifecycleRecords('activation-record').recordIds.length, 0);

  // Ambiguity: a SECOND current issuance for the bundle subject.
  const integration2 = makeIntegrationEnv();
  const { store: store2 } = makeFakeStore();
  const chain = seedFakeChain(store2);
  const secondBundleIssuance = buildIssuanceRecordPayload({
    recordId: 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    createdAt: FIXED_NOW,
    subject: BUNDLE.subject,
    workspaceId: WS_A,
    useClass: 'execution-use',
    approvalRecordId: chain.approvalIds[0]!,
    activationLimit: 1,
    validUntil: null,
    registry: REGISTRY,
  });
  seedPayload(store2, 'issuance-record', secondBundleIssuance);
  const grant2 = seedGrant(store2, { reserved_occurrence_id: `pgw:o:${'a'.repeat(32)}` });
  const context2 = activationContext(integration2, store2);
  const ambiguous = executeSlice1Command(activationOperand(grant2.grantId, grant2.reservedOccurrenceId), context2);
  assert.equal(ambiguous.ok, false);
  if (!ambiguous.ok) assert.equal(ambiguous.category, 'lifecycle-conflict', JSON.stringify(ambiguous));
  assert.equal(store2.enumerateLifecycleRecords('activation-record').recordIds.length, 0);
});

test('activation rejection: PHASE-1 registry incompatibility → registry-context-mismatch, zero records', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const registryA = { ...REGISTRY, registrySnapshotId: 'pgw:g:11111111111111111111111111111111', registrySnapshotDigest: `sha-256:${'1'.repeat(64)}` } as AcceptedRegistryContext;
  // The full correlated chain and the grant bind registry A; the host
  // current accepted registry is REGISTRY (B). PHASE-1 recordability of the
  // five issuances + five approvals + grant under B fails → rejection
  // (registry-context-mismatch), NOT a durable decision.
  seedFakeChain(store, { registry: registryA });
  const { grantId, reservedOccurrenceId } = seedGrant(store, { registry: registryA });
  const context = activationContext(integration, store);
  const result = executeSlice1Command(activationOperand(grantId, reservedOccurrenceId), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'registry-context-mismatch', JSON.stringify(result));
  assert.equal(store.enumerateLifecycleRecords('activation-record').recordIds.length, 0, 'rejection creates no decision record');
  assert.equal(store.enumerateLifecycleRecords('execution-occurrence-record').recordIds.length, 0);
});

test('activation failure: first publication (ActivationRecord) fails → store-failure, zero records', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const { grantId, reservedOccurrenceId } = seedGrant(store);
  const crashing = {
    ...store,
    publishLifecycleRecord(recordClass: Parameters<ControlPlaneStoreBoundary['publishLifecycleRecord']>[0], payload: Readonly<Record<string, unknown>>) {
      if (recordClass === 'activation-record') throw new Error('injected first-publication failure');
      return store.publishLifecycleRecord(recordClass, payload);
    },
  };
  const context = activationContext(integration, store, { store: crashing });
  const result = executeSlice1Command(activationOperand(grantId, reservedOccurrenceId), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'store-failure');
  assert.equal(store.enumerateLifecycleRecords('activation-record').recordIds.length, 0, 'nothing durable before the failure');
  assert.equal(store.enumerateLifecycleRecords('execution-occurrence-record').recordIds.length, 0);
});

// ─── DENIALS (durable ActivationRecord(denied); zero occurrences) ───────────

function assertDenied(result: ReturnType<typeof executeSlice1Command>, store: ControlPlaneStoreBoundary): void {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.evidence.decision, 'denied', JSON.stringify(result));
  assert.equal(store.enumerateLifecycleRecords('activation-record').recordIds.length, 1, 'exactly one ActivationRecord');
  assert.equal(store.enumerateLifecycleRecords('execution-occurrence-record').recordIds.length, 0, 'denied produces no occurrence');
}

test('activation denial: revoked required issuance → durable denied decision, no occurrence', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const chain = seedFakeChain(store);
  const { grantId, reservedOccurrenceId } = seedGrant(store);
  const revokeContext = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), revokerRole: true });
  const revoked = executeSlice1Command(
    { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'IssuanceRecord', targetRecordId: chain.issuanceIds[0]!, scope: 'execution-use', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
    revokeContext,
  );
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  const result = executeSlice1Command(activationOperand(grantId, reservedOccurrenceId), activationContext(integration, store));
  assertDenied(result, store);
});

test('activation denial: revoked required approval → durable denied decision, no occurrence', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const chain = seedFakeChain(store);
  const { grantId, reservedOccurrenceId } = seedGrant(store);
  const revokeContext = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), revokerRole: true });
  const revoked = executeSlice1Command(
    { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'ApprovalRecord', targetRecordId: chain.approvalIds[0]!, scope: 'all-uses', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
    revokeContext,
  );
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  const result = executeSlice1Command(activationOperand(grantId, reservedOccurrenceId), activationContext(integration, store));
  assertDenied(result, store);
});

test('activation denial: expired-but-correlated bundle issuance → durable denied decision (PHASE-2, not rejection)', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store, { bundleIssuance: { validUntil: '2020-01-01T00:00:00.000Z' } });
  const { grantId, reservedOccurrenceId } = seedGrant(store);
  const result = executeSlice1Command(activationOperand(grantId, reservedOccurrenceId), activationContext(integration, store));
  assertDenied(result, store);
});

test('activation denial: revoked grant → durable denied decision; future/expired grant validity → durable denied decision', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const seeded = seedGrant(store);
  const revokeContext = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), revokerRole: true });
  const revokedGrant = executeSlice1Command(
    { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'RuntimeGrant', targetRecordId: seeded.grantId, scope: 'all-uses', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
    revokeContext,
  );
  assert.equal(revokedGrant.ok, true, JSON.stringify(revokedGrant));
  const afterRevoke = executeSlice1Command(activationOperand(seeded.grantId, seeded.reservedOccurrenceId), activationContext(integration, store));
  assertDenied(afterRevoke, store);

  const integration2 = makeIntegrationEnv();
  const { store: store2 } = makeFakeStore();
  seedFakeChain(store2);
  const futureGrant = seedGrant(store2, { record_id: 'pgw:l:dddddddddddddddddddddddddddddddd', reserved_occurrence_id: `pgw:o:${'b'.repeat(32)}`, not_before: '2099-01-01T00:00:00.000Z' });
  const notYetValid = executeSlice1Command(activationOperand(futureGrant.grantId, futureGrant.reservedOccurrenceId), activationContext(integration2, store2));
  assertDenied(notYetValid, store2);

  const integration3 = makeIntegrationEnv();
  const { store: store3 } = makeFakeStore();
  seedFakeChain(store3);
  const expiredGrant = seedGrant(store3, { record_id: 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', reserved_occurrence_id: `pgw:o:${'c'.repeat(32)}`, not_after: '2020-01-01T00:00:00.000Z' });
  const expired = executeSlice1Command(activationOperand(expiredGrant.grantId, expiredGrant.reservedOccurrenceId), activationContext(integration3, store3));
  assertDenied(expired, store3);
});

test('activation denial: consumer/enforcement support mismatch → durable denied decision', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const { grantId, reservedOccurrenceId } = seedGrant(store);
  const context = activationContext(integration, store, {
    consumerSupport: { consumerId: 'unsupported-consumer', supportedProtocolFeatures: [], supportedConsumerCapabilities: [], supportedExtensionNamespaces: [] },
  });
  const result = executeSlice1Command(activationOperand(grantId, reservedOccurrenceId), context);
  assertDenied(result, store);
});

test('activation denial: policy deny for the requested use → durable denied decision', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const kit = makeActivationKit();
  // Kit chain: bundle + policy member subjects come from the custom kit; the
  // kit policy carries an effective deny rule for the activation requested
  // use (workspace-read / read / configured-artifact-area).
  seedKitChain(store, kit);
  const grant = buildRuntimeGrantPayload({
    recordId: 'pgw:l:cccccccccccccccccccccccccccccccc',
    createdAt: FIXED_NOW,
    subject: kit.bundle.subject,
    workspaceId: WS_A,
    reservedOccurrenceId: `pgw:o:${'a'.repeat(32)}`,
    attemptLimit: 2,
    validity: { not_before: FIXED_NOW, not_after: LATER },
    narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    registry: REGISTRY,
  });
  seedPayload(store, 'runtime-grant', grant);
  const context = makeContext(integration.storeEnv, {
    store,
    identity: makeIdentitySource(),
    activationRole: true,
    consumerSupport: DEFAULT_CONSUMER_SUPPORT,
    subjectArtifact: kit.bundle.artifact,
    policyEvidence: kit.policy.artifact,
  });
  const operand = {
    operation: 'decideActivation',
    subject: subjectOperand(kit.bundle.subject),
    workspaceId: WS_A,
    registryEcho: ECHO,
    grantId: String(grant['record_id']),
    reservedOccurrenceId: `pgw:o:${'a'.repeat(32)}`,
  };
  const result = executeSlice1Command(operand, context);
  assertDenied(result, store);
});

/** Seed the full chain for a custom kit (bundle + policy member from the kit). */
function seedKitChain(store: ControlPlaneStoreBoundary, kit: ReturnType<typeof makeActivationKit>): void {
  const { members } = grantChainSubjects(WS_A);
  const subjects = [
    { subject: kit.bundle.subject, model: kit.bundle.artifact.model as unknown as Record<string, unknown> },
    ...members.map((member) => (member.subject.kindId === 'AuthorityPolicy'
      ? { subject: kit.policy.subject, model: kit.policy.artifact.model as unknown as Record<string, unknown> }
      : member)),
  ];
  const id = (base: number): string => `pgw:l:${base.toString(16).padStart(32, '0')}`;
  for (let k = 0; k < subjects.length; k += 1) {
    const info = subjects[k]!;
    const validationId = id(0x3000 + k);
    seedPayload(store, 'validation-record', buildValidationRecordPayload({ recordId: validationId, createdAt: FIXED_NOW, subject: info.subject, registry: REGISTRY }));
    const approvalId = id(0x3100 + k);
    seedPayload(store, 'approval-record', buildApprovalRecordPayload({
      recordId: approvalId, createdAt: FIXED_NOW, subject: info.subject, workspaceId: WS_A,
      purpose: 'execution-use', validationRecordIds: [validationId],
      requiredSemantics: { protocol_features: [], consumer_capabilities: [] }, validUntil: null, registry: REGISTRY,
    }));
    seedPayload(store, 'issuance-record', buildIssuanceRecordPayload({
      recordId: id(0x3200 + k), createdAt: FIXED_NOW, subject: info.subject, workspaceId: WS_A,
      useClass: 'execution-use', approvalRecordId: approvalId, activationLimit: 1, validUntil: null, registry: REGISTRY,
    }));
  }
}

test('activation denial: current ceiling re-evaluation → durable denied decision (grant narrowed beyond a lowered ceiling)', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  // Grant issued with max-actions 10 (no ceilings at issue time).
  const { grantId, reservedOccurrenceId } = seedGrant(store);
  // The activation host context carries a NEW configuration with a lower
  // concrete action ceiling (ceiling re-evaluation at activation, §26.6).
  const ceilingEnv = makeConfigEnv({ globalActionCeiling: 5, workspaceActionCeiling: 5 });
  const context = activationContext(integration, store, { configuration: ceilingEnv.config });
  const result = executeSlice1Command(activationOperand(grantId, reservedOccurrenceId), context);
  assertDenied(result, store);
  ceilingEnv.remove();
});

test('activation denial: activation_limit exhaustion → durable denied decision; counting is accepted-record derived', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store, { bundleIssuance: { activationLimit: 1 } });
  const context = activationContext(integration, store);
  // First activation with the first grant: accepted (count 0 < 1).
  const firstGrant = seedGrant(store, { reserved_occurrence_id: `pgw:o:${'a'.repeat(32)}` });
  const first = executeSlice1Command(activationOperand(firstGrant.grantId, firstGrant.reservedOccurrenceId), context);
  assert.equal(first.ok, true, JSON.stringify(first));
  if (!first.ok) return;
  assert.equal(first.evidence.decision, 'accepted');
  // Second activation, fresh grant + reservation, same bundle issuance:
  // count = 1 >= limit 1 → denied.
  const secondGrant = seedGrant(store, { record_id: 'pgw:l:dddddddddddddddddddddddddddddddd', reserved_occurrence_id: `pgw:o:${'b'.repeat(32)}` });
  const second = executeSlice1Command(activationOperand(secondGrant.grantId, secondGrant.reservedOccurrenceId), context);
  assert.equal(second.ok, true, JSON.stringify(second));
  if (!second.ok) return;
  assert.equal(second.evidence.decision, 'denied', 'exhaustion is a durable denial');
  assert.equal(store.enumerateLifecycleRecords('activation-record').recordIds.length, 2, 'first accepted + second denied');
  assert.equal(store.enumerateLifecycleRecords('execution-occurrence-record').recordIds.length, 1, 'denied second decision adds no occurrence');
});

test('activation_limit: an incomplete accepted transition already consumed the allowance → next decision is a durable denial', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store, { bundleIssuance: { activationLimit: 1 } });
  const { grantId, reservedOccurrenceId } = seedGrant(store);
  const identity = makeIdentitySource();
  // First decision crashes after the accepted ActivationRecord (the
  // occurrence is never durable) — the accepted record still consumes the
  // single activation use (§26.12).
  const crashed = executeSlice1Command(
    activationOperand(grantId, reservedOccurrenceId),
    activationContext(integration, store, { store: crashingStore(store), identity }),
  );
  assert.equal(crashed.ok, false);
  if (!crashed.ok) assert.equal(crashed.category, 'store-failure');
  assert.equal(store.enumerateLifecycleRecords('activation-record').recordIds.length, 1, 'accepted record durable');
  assert.equal(store.enumerateLifecycleRecords('execution-occurrence-record').recordIds.length, 0, 'occurrence missing');
  // Second decision, fresh grant + fresh reservation: count 1 >= limit 1 →
  // durable denial (recovery of the first transition would not double-count).
  const secondGrant = seedGrant(store, { record_id: 'pgw:l:dddddddddddddddddddddddddddddddd', reserved_occurrence_id: `pgw:o:${'b'.repeat(32)}` });
  const second = executeSlice1Command(activationOperand(secondGrant.grantId, secondGrant.reservedOccurrenceId), activationContext(integration, store, { identity }));
  assert.equal(second.ok, true, JSON.stringify(second));
  if (!second.ok) return;
  assert.equal(second.evidence.decision, 'denied', 'the incomplete accepted transition already consumed the allowance');
  assert.equal(store.enumerateLifecycleRecords('activation-record').recordIds.length, 2, 'first accepted + second denied');
  assert.equal(store.enumerateLifecycleRecords('execution-occurrence-record').recordIds.length, 0, 'denial adds no occurrence');
});

// ─── replay / cardinality ───────────────────────────────────────────────────

test('activation replay: retry after accepted and after denied is replay-denied', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = activationContext(integration, store);
  const grant = seedGrant(store);
  const first = executeSlice1Command(activationOperand(grant.grantId, grant.reservedOccurrenceId), context);
  assert.equal(first.ok, true, JSON.stringify(first));
  const replay = executeSlice1Command(activationOperand(grant.grantId, grant.reservedOccurrenceId), context);
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.category, 'replay-denied');

  // Denied-then-replay: revoke the chain issuance first, then a fresh grant.
  const integration2 = makeIntegrationEnv();
  const { store: store2 } = makeFakeStore();
  const chain2 = seedFakeChain(store2);
  const revokeContext = makeContext(integration2.storeEnv, { store: store2, identity: makeIdentitySource(), revokerRole: true });
  executeSlice1Command(
    { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'IssuanceRecord', targetRecordId: chain2.issuanceIds[0]!, scope: 'execution-use', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
    revokeContext,
  );
  const deniedGrant = seedGrant(store2, { record_id: 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', reserved_occurrence_id: `pgw:o:${'c'.repeat(32)}` });
  const context2 = activationContext(integration2, store2);
  const denied = executeSlice1Command(activationOperand(deniedGrant.grantId, deniedGrant.reservedOccurrenceId), context2);
  assert.equal(denied.ok, true, JSON.stringify(denied));
  if (!denied.ok) return;
  assert.equal(denied.evidence.decision, 'denied');
  const deniedReplay = executeSlice1Command(activationOperand(deniedGrant.grantId, deniedGrant.reservedOccurrenceId), context2);
  assert.equal(deniedReplay.ok, false);
  if (!deniedReplay.ok) assert.equal(deniedReplay.category, 'replay-denied');
});

// ─── createOccurrence recovery ──────────────────────────────────────────────

/** Simulate the crash: the second publication (occurrence) throws. */
function crashingStore(store: ControlPlaneStoreBoundary): ControlPlaneStoreBoundary {
  return {
    ...store,
    publishLifecycleRecord(recordClass, payload) {
      if (recordClass === 'execution-occurrence-record') throw new Error('injected crash before occurrence durability');
      return store.publishLifecycleRecord(recordClass, payload);
    },
  };
}

test('recovery: crash after accepted ActivationRecord → store-failure, no complete evidence; createOccurrence repairs exactly once', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const { grantId, reservedOccurrenceId } = seedGrant(store);
  // ONE continuing identity across the crashed decision and the repair so
  // record identities stay unique (the graph index is keyed by record ID).
  const identity = makeIdentitySource();
  const context = activationContext(integration, store, { store: crashingStore(store), identity });
  const crashed = executeSlice1Command(activationOperand(grantId, reservedOccurrenceId), context);
  assert.equal(crashed.ok, false, 'incomplete transition must not return success');
  if (!crashed.ok) assert.equal(crashed.category, 'store-failure');
  assert.equal(store.enumerateLifecycleRecords('activation-record').recordIds.length, 1, 'accepted activation is durable');
  assert.equal(store.enumerateLifecycleRecords('execution-occurrence-record').recordIds.length, 0, 'occurrence missing');

  // Recovery: exactly one occurrence appended; no new activation; no new occurrence ID.
  const recoveryContext = activationContext(integration, store, { identity });
  const repaired = executeSlice1Command(recoveryOperand(reservedOccurrenceId), recoveryContext);
  assert.equal(repaired.ok, true, JSON.stringify(repaired));
  if (!repaired.ok) return;
  assert.equal(repaired.outcome, 'recovered');
  assert.equal(repaired.evidence.reservedOccurrenceId, reservedOccurrenceId);
  assert.equal(repaired.evidence.activationRecordId, store.enumerateLifecycleRecords('activation-record').recordIds[0]);
  assert.equal(store.enumerateLifecycleRecords('execution-occurrence-record').recordIds.length, 1);
  assert.equal(store.enumerateLifecycleRecords('activation-record').recordIds.length, 1, 'recovery never creates another activation');
  const occurrence = store.readLifecyclePayload('execution-occurrence-record', repaired.evidence.recordId).payload!;
  assert.equal(occurrence['occurrence_id'], reservedOccurrenceId, 'recovery reuses the reserved ID, never allocates another');
  // A second repair attempt fails closed.
  const again = executeSlice1Command(recoveryOperand(reservedOccurrenceId), recoveryContext);
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.category, 'occurrence-conflict');
});

test('recovery: no accepted activation → lifecycle-state-missing; denied activation → lifecycle-state-missing; multiple activations → occurrence-conflict', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = activationContext(integration, store);
  const none = executeSlice1Command(recoveryOperand(`pgw:o:${'f'.repeat(32)}`), context);
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.category, 'lifecycle-state-missing');

  // Denied activation only (revoke issuance first → activation denied).
  const integration2 = makeIntegrationEnv();
  const { store: store2 } = makeFakeStore();
  const chain2 = seedFakeChain(store2);
  const revokeContext = makeContext(integration2.storeEnv, { store: store2, identity: makeIdentitySource(), revokerRole: true });
  executeSlice1Command(
    { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'IssuanceRecord', targetRecordId: chain2.issuanceIds[0]!, scope: 'execution-use', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
    revokeContext,
  );
  const deniedGrant = seedGrant(store2, { record_id: 'pgw:l:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', reserved_occurrence_id: `pgw:o:${'c'.repeat(32)}` });
  const context2 = activationContext(integration2, store2);
  const denied = executeSlice1Command(activationOperand(deniedGrant.grantId, deniedGrant.reservedOccurrenceId), context2);
  assert.equal(denied.ok, true, JSON.stringify(denied));
  const deniedRecovery = executeSlice1Command(recoveryOperand(deniedGrant.reservedOccurrenceId), context2);
  assert.equal(deniedRecovery.ok, false);
  if (!deniedRecovery.ok) assert.equal(deniedRecovery.category, 'lifecycle-state-missing');

  // Multiple competing activations for one reservation (raw-seeded).
  const integration3 = makeIntegrationEnv();
  const { store: store3 } = makeFakeStore();
  const reservation = `pgw:o:${'d'.repeat(32)}`;
  for (const recordId of ['pgw:l:11111111111111111111111111111111', 'pgw:l:22222222222222222222222222222222']) {
    seedPayload(store3, 'activation-record', buildActivationRecordPayload({
      recordId, createdAt: FIXED_NOW, subject: BUNDLE.subject, workspaceId: WS_A,
      requiredIssuanceRecordIds: ['pgw:l:33333333333333333333333333333333', 'pgw:l:44444444444444444444444444444444', 'pgw:l:55555555555555555555555555555555', 'pgw:l:66666666666666666666666666666666', 'pgw:l:77777777777777777777777777777777'],
      runtimeGrantId: 'pgw:l:88888888888888888888888888888888',
      reservedOccurrenceId: reservation,
      decision: 'accepted',
      registry: REGISTRY,
    }));
  }
  const context3 = activationContext(integration3, store3);
  const competing = executeSlice1Command(recoveryOperand(reservation), context3);
  assert.equal(competing.ok, false);
  if (!competing.ok) assert.equal(competing.category, 'occurrence-conflict');
});

test('recovery: historical completion after later grant revocation, issuance revocation, and grant expiry', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const chain = seedFakeChain(store);
  const seeded = seedGrant(store);
  const identity = makeIdentitySource();
  const context = activationContext(integration, store, { store: crashingStore(store), identity });
  const crashed = executeSlice1Command(activationOperand(seeded.grantId, seeded.reservedOccurrenceId), context);
  assert.equal(crashed.ok, false);
  // Now revoke the grant, revoke the bundle issuance, and let the grant expire.
  const revokeContext = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), revokerRole: true });
  for (const target of [
    { targetRecordType: 'RuntimeGrant', targetRecordId: seeded.grantId },
    { targetRecordType: 'IssuanceRecord', targetRecordId: chain.issuanceIds[0]! },
  ]) {
    const revoked = executeSlice1Command(
      { operation: 'revoke', workspaceId: WS_A, ...target, scope: 'all-uses', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
      revokeContext,
    );
    assert.equal(revoked.ok, true, JSON.stringify(revoked));
  }
  // Historical completion: recovery must NOT reconsider currentness.
  const repaired = executeSlice1Command(recoveryOperand(seeded.reservedOccurrenceId), activationContext(integration, store, { identity }));
  assert.equal(repaired.ok, true, JSON.stringify(repaired));
  if (!repaired.ok) return;
  assert.equal(store.enumerateLifecycleRecords('execution-occurrence-record').recordIds.length, 1);
  const activation = store.readLifecyclePayload('activation-record', repaired.evidence.activationRecordId!).payload!;
  assert.equal(activation['decision'], 'accepted', 'recovery never re-decides accepted→denied');
});
