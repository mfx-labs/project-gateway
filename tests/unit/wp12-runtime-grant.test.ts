/**
 * WP-12 Slice 3A — issueRuntimeGrant + RuntimeGrant revocation FOCUSED tests.
 *
 * Covers the focused contract test surface (task §36): request boundary,
 * validity window, attempt limit, narrowed constraints (incl. the
 * max-resources unsupported distinction), occurrence identity, chain
 * authority derivation, and RuntimeGrant-shaped revocation semantics.
 * Real initialized WP-8 store coverage lives in wp12-runtime-grant-store.test.ts
 * (task §35); these tests use the in-memory fake store for focused failure
 * injection plus the real command flow where the contract requires it.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import { buildValidationRecordPayload, buildApprovalRecordPayload, buildIssuanceRecordPayload, buildRuntimeGrantPayload } from '../../src/control-plane/records.js';
import { OCCURRENCE_ID_RE } from '../../src/control-plane/types.js';
import {
  cleanupTestEnvs,
  grantChainSubjects,
  makeContext,
  makeEvidence,
  makeIdentitySource,
  makeIntegrationEnv,
  makeRegistryContext,
  makeSubject,
  seedPayload,
  WS_A,
} from './wp12-helpers.js';
import type { ControlPlaneStoreBoundary } from '../../src/control-plane/types.js';
import type { AcceptedRegistryContext } from '../../src/api/types.js';

after(() => cleanupTestEnvs());

const REGISTRY = makeRegistryContext();
const ECHO = Object.freeze({ registry_snapshot_id: REGISTRY.registrySnapshotId, registry_snapshot_digest: REGISTRY.registrySnapshotDigest });
const FIXED_NOW = '2026-08-04T06:00:00.000Z';
const LATER = '2026-08-05T06:00:00.000Z';

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

/** The canonical bundle subject (fixture identity). */
const BUNDLE = grantChainSubjects().bundle;

function grantOperand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation: 'issueRuntimeGrant',
    subject: subjectOperand(BUNDLE.subject),
    workspaceId: WS_A,
    registryEcho: ECHO,
    attemptLimit: 2,
    validity: { not_before: FIXED_NOW, not_after: LATER },
    narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    ...overrides,
  };
}

function revokeGrantOperand(grantRecordId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation: 'revoke',
    workspaceId: WS_A,
    targetRecordType: 'RuntimeGrant',
    targetRecordId: grantRecordId,
    scope: 'execution-use',
    effectiveAt: '2026-08-04T05:59:00.000Z',
    reasonCode: 'policy-withdrawn',
    registryEcho: ECHO,
    ...overrides,
  };
}

// ─── in-memory fake store (payload-level; shared shape with the WP-12 suite) ─

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

/**
 * Seed the genuine five-subject lifecycle chain into a FAKE store using the
 * accepted record builders (bundle first, then TaskSpec, AuthorityPolicy,
 * ContextManifest, CompletionContract). Record identities use a FIXED high
 * block (0x1000-based) so they can never collide with identity-source
 * generated record IDs (pgw:l:0000…0N) in the same test; the WP-4 graph
 * index is keyed by record identity, so a colliding candidate would resolve
 * a validation reference to the wrong record. Returns the five
 * approval/issuance identities in chain order. `excludeMember` removes one
 * required member chain (missing-dependency tests).
 */
function seedFakeChain(
  store: ControlPlaneStoreBoundary,
  registry: AcceptedRegistryContext = REGISTRY,
  workspaceId: string = WS_A,
  excludeMember?: string,
): { readonly issuanceIds: readonly string[]; readonly approvalIds: readonly string[]; readonly validationRecordIds: readonly string[] } {
  const { bundle, members } = grantChainSubjects(workspaceId);
  const subjects = [bundle, ...members].filter((info) => info.subject.kindId !== excludeMember);
  const id = (base: number): string => `pgw:l:${base.toString(16).padStart(32, '0')}`;
  const issuanceIds: string[] = [];
  const approvalIds: string[] = [];
  const validationRecordIds: string[] = [];
  for (let k = 0; k < subjects.length; k += 1) {
    const info = subjects[k]!;
    const validationId = id(0x1000 + k);
    seedPayload(store, 'validation-record', buildValidationRecordPayload({ recordId: validationId, createdAt: FIXED_NOW, subject: info.subject, registry }));
    validationRecordIds.push(validationId);
    const approvalId = id(0x1100 + k);
    seedPayload(store, 'approval-record', buildApprovalRecordPayload({
      recordId: approvalId, createdAt: FIXED_NOW, subject: info.subject, workspaceId,
      purpose: 'execution-use', validationRecordIds: [validationId],
      requiredSemantics: { protocol_features: [], consumer_capabilities: [] }, validUntil: null, registry,
    }));
    approvalIds.push(approvalId);
    const issuanceId = id(0x1200 + k);
    seedPayload(store, 'issuance-record', buildIssuanceRecordPayload({
      recordId: issuanceId, createdAt: FIXED_NOW, subject: info.subject, workspaceId,
      useClass: 'execution-use', approvalRecordId: approvalId, activationLimit: 1, validUntil: null, registry,
    }));
    issuanceIds.push(issuanceId);
  }
  return { issuanceIds: Object.freeze(issuanceIds), approvalIds: Object.freeze(approvalIds), validationRecordIds: Object.freeze(validationRecordIds) };
}

/** Seed a raw RuntimeGrant into a fake store (test fixture payload). */
function seedGrant(store: ControlPlaneStoreBoundary, overrides: { readonly recordId?: string; readonly reservedOccurrenceId?: string; readonly workspaceId?: string } = {}): string {
  const workspaceId = overrides.workspaceId ?? WS_A;
  const payload = buildRuntimeGrantPayload({
    recordId: overrides.recordId ?? 'pgw:l:cccccccccccccccccccccccccccccccc',
    createdAt: FIXED_NOW,
    subject: Object.freeze({ ...BUNDLE.subject, workspaceId }),
    workspaceId,
    reservedOccurrenceId: overrides.reservedOccurrenceId ?? `pgw:o:${'f'.repeat(32)}`,
    attemptLimit: 2,
    validity: { not_before: FIXED_NOW, not_after: LATER },
    narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    registry: REGISTRY,
  });
  seedPayload(store, 'runtime-grant', payload);
  return String(payload['record_id']);
}

function grantContext(integration: ReturnType<typeof makeIntegrationEnv>, store: ControlPlaneStoreBoundary) {
  return makeContext(integration.storeEnv, {
    store,
    identity: makeIdentitySource(),
    grantRole: true,
    subjectArtifact: makeEvidence('ExecutionBundle').artifact,
  });
}

/** Store wrapper injecting read/publish failures (store-failure paths). */
function failingStore(store: ControlPlaneStoreBoundary, options: { readonly throwOnPublish?: boolean; readonly failReads?: boolean } = {}): ControlPlaneStoreBoundary {
  return {
    ...store,
    publishLifecycleRecord(recordClass, payload) {
      if (options.throwOnPublish) throw new Error('injected publish failure');
      return store.publishLifecycleRecord(recordClass, payload);
    },
    readLifecyclePayload(recordClass, recordId) {
      if (options.failReads) return { ok: false, code: 'read-failed' };
      return store.readLifecyclePayload(recordClass, recordId);
    },
    enumerateLifecycleRecords(recordClass) {
      if (options.failReads) return { ok: false, code: 'enumerate-failed', recordIds: [] };
      return store.enumerateLifecycleRecords(recordClass);
    },
  };
}

// ─── REQUEST boundary (exact-key; hostile operands fail closed) ─────────────

test('grant request: exact valid request reaches the decision (chain satisfied → granted)', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = grantContext(integration, store);
  const result = executeSlice1Command(grantOperand(), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.evidence.recordClass, 'runtime-grant');
  assert.equal(result.evidence.workspaceId, WS_A);
  assert.equal(result.evidence.attemptLimit, 2);
});

test('grant request: unknown key is request-invalid', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const context = grantContext(integration, store);
  for (const extra of [
    { reservedOccurrenceId: 'pgw:o:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { grantId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { approvalRecordIds: ['pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
    { issuanceRecordIds: ['pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
    { authorityPolicyId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { bundleMemberIds: ['pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
    { verificationEvidence: { ok: true } },
    { storeRoot: '/tmp/x' },
    { config: {} },
    { clock: {} },
    { provenance: {} },
  ]) {
    const result = executeSlice1Command(grantOperand(extra), context);
    assert.equal(result.ok, false, JSON.stringify(extra));
    if (!result.ok) assert.equal(result.category, 'request-invalid', JSON.stringify(extra));
  }
});

test('grant request: caller role assertion is approver-not-independent', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const context = grantContext(integration, store);
  for (const extra of [{ grantRole: true }, { grantAuthority: true }, { role: 'trusted-runtime-grant-authority' }, { operatorRole: 'grant' }]) {
    const result = executeSlice1Command(grantOperand(extra), context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'approver-not-independent', JSON.stringify(extra));
  }
});

test('grant request: missing key is request-invalid; malformed echo is request-invalid; mismatched echo is registry-context-mismatch', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const context = grantContext(integration, store);
  for (const missing of ['registryEcho', 'attemptLimit', 'validity', 'narrowedConstraints']) {
    const operand = grantOperand();
    delete operand[missing];
    const result = executeSlice1Command(operand, context);
    assert.equal(result.ok, false, `missing ${missing}`);
    if (!result.ok) assert.equal(result.category, 'request-invalid', `missing ${missing}`);
  }
  const malformedEcho = executeSlice1Command(grantOperand({ registryEcho: { registry_snapshot_id: 'nope' } }), context);
  assert.equal(malformedEcho.ok, false);
  if (!malformedEcho.ok) assert.equal(malformedEcho.category, 'request-invalid');
  const mismatched = executeSlice1Command(grantOperand({ registryEcho: { registry_snapshot_id: 'pgw:g:11111111111111111111111111111111', registry_snapshot_digest: `sha-256:${'1'.repeat(64)}` } }), context);
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) assert.equal(mismatched.category, 'registry-context-mismatch');
});

test('grant request: non-ExecutionBundle subject is request-invalid', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const context = grantContext(integration, store);
  const task = makeSubject('TaskSpec');
  const result = executeSlice1Command(grantOperand({ subject: subjectOperand(task.subject) }), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid');
});

// ─── VALIDITY window (contract §26.10) ──────────────────────────────────────

test('grant validity: equality and future not_before are accepted; reversed and malformed are request-invalid', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = grantContext(integration, store);
  const equality = executeSlice1Command(grantOperand({ validity: { not_before: LATER, not_after: LATER } }), context);
  assert.equal(equality.ok, true, JSON.stringify(equality));
  const future = executeSlice1Command(grantOperand({ validity: { not_before: '2027-01-01T00:00:00.000Z', not_after: '2027-01-02T00:00:00.000Z' } }), context);
  assert.equal(future.ok, true, JSON.stringify(future));
  const reversed = executeSlice1Command(grantOperand({ validity: { not_before: LATER, not_after: FIXED_NOW } }), context);
  assert.equal(reversed.ok, false);
  if (!reversed.ok) assert.equal(reversed.category, 'request-invalid');
  for (const malformed of [
    { not_before: 'yesterday', not_after: LATER },
    { not_before: FIXED_NOW },
    { not_before: FIXED_NOW, not_after: LATER, extra: true },
    42,
  ]) {
    const result = executeSlice1Command(grantOperand({ validity: malformed }), context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'request-invalid', JSON.stringify(malformed));
  }
});

// ─── ATTEMPT limit (contract §26.11) ────────────────────────────────────────

test('grant attemptLimit: 1 and 64 accepted; 0, 65, fractional, and non-numeric rejected', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = grantContext(integration, store);
  const one = executeSlice1Command(grantOperand({ attemptLimit: 1 }), context);
  assert.equal(one.ok, true, JSON.stringify(one));
  const sixtyFour = executeSlice1Command(grantOperand({ attemptLimit: 64 }), context);
  assert.equal(sixtyFour.ok, true, JSON.stringify(sixtyFour));
  for (const bad of [0, 65, 1.5, -1, '2', null]) {
    const result = executeSlice1Command(grantOperand({ attemptLimit: bad }), context);
    assert.equal(result.ok, false, `attemptLimit ${String(bad)}`);
    if (!result.ok) assert.equal(result.category, 'request-invalid', `attemptLimit ${String(bad)}`);
  }
});

// ─── narrowed constraints (contract §26.6 / §13 / §14) ──────────────────────

test('grant constraints: non-empty required; duplicate and malformed forms rejected', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = grantContext(integration, store);
  const empty = executeSlice1Command(grantOperand({ narrowedConstraints: [] }), context);
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.category, 'request-invalid');
  const duplicate = executeSlice1Command(grantOperand({ narrowedConstraints: [{ type: 'max-actions', value: 1 }, { type: 'max-actions', value: 2 }] }), context);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.category, 'request-invalid');
  for (const malformed of [
    [{ type: 'max-actions' }],
    [{ type: 'max-actions', value: -1 }],
    [{ type: 'max-actions', value: 1.5 }],
    [{ type: 'unknown-form', value: 1 }],
    [{ type: 'read-only', value: false }],
    [{ type: 'read-only', value: 1 }],
    [{ type: 'max-resources', value: 'many' }],
    [{ type: 'max-actions', value: 1, extra: true }],
    'not-an-array',
    [{ type: 'max-actions', value: 1 }, 'junk'],
  ]) {
    const result = executeSlice1Command(grantOperand({ narrowedConstraints: malformed }), context);
    assert.equal(result.ok, false, JSON.stringify(malformed));
    if (!result.ok) assert.equal(result.category, 'request-invalid', JSON.stringify(malformed));
  }
});

test('grant constraints: max-actions within ceiling succeeds; above a concrete ceiling is ceiling-denied', () => {
  const integration = makeIntegrationEnv({ globalActionCeiling: 10, workspaceActionCeiling: 10 });
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = grantContext(integration, store);
  const within = executeSlice1Command(grantOperand({ narrowedConstraints: [{ type: 'max-actions', value: 10 }] }), context);
  assert.equal(within.ok, true, JSON.stringify(within));
  const above = executeSlice1Command(grantOperand({ narrowedConstraints: [{ type: 'max-actions', value: 11 }] }), context);
  assert.equal(above.ok, false);
  if (!above.ok) assert.equal(above.category, 'ceiling-denied');
});

test('grant constraints: workspace actionCeiling also applies (concrete ceiling violation)', () => {
  const integration = makeIntegrationEnv({ workspaceActionCeiling: 3 });
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = grantContext(integration, store);
  const above = executeSlice1Command(grantOperand({ narrowedConstraints: [{ type: 'max-actions', value: 4 }] }), context);
  assert.equal(above.ok, false);
  if (!above.ok) assert.equal(above.category, 'ceiling-denied');
  const within = executeSlice1Command(grantOperand({ narrowedConstraints: [{ type: 'max-actions', value: 3 }] }), context);
  assert.equal(within.ok, true, JSON.stringify(within));
});

test('grant constraints: read-only and require-exact-resource boolean narrowing forms are accepted', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = grantContext(integration, store);
  const readOnly = executeSlice1Command(grantOperand({ narrowedConstraints: [{ type: 'read-only', value: true }] }), context);
  assert.equal(readOnly.ok, true, JSON.stringify(readOnly));
  const exact = executeSlice1Command(grantOperand({ narrowedConstraints: [{ type: 'require-exact-resource', value: true }] }), context);
  assert.equal(exact.ok, true, JSON.stringify(exact));
});

test('grant constraints: max-resources is schema-valid but unsupported → eligibility-denied (NOT request-invalid, NOT ceiling-denied)', () => {
  const integration = makeIntegrationEnv({ globalActionCeiling: 100 });
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = grantContext(integration, store);
  const result = executeSlice1Command(grantOperand({ narrowedConstraints: [{ type: 'max-resources', value: 3 }] }), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'eligibility-denied', JSON.stringify(result));
  const mixed = executeSlice1Command(grantOperand({ narrowedConstraints: [{ type: 'max-resources', value: 3 }, { type: 'max-actions', value: 1 }] }), context);
  assert.equal(mixed.ok, false);
  if (!mixed.ok) assert.equal(mixed.category, 'eligibility-denied');
});

// ─── occurrence identity (contract §26.9) ───────────────────────────────────

test('grant identity: deterministic occurrence generator yields pgw:o: + 32 lowercase hex; caller cannot select the ID', () => {
  const identity = makeIdentitySource();
  const occurrenceId = identity.newOccurrenceId();
  assert.match(occurrenceId, OCCURRENCE_ID_RE);
  assert.equal(identity.newOccurrenceId(), 'pgw:o:00000000000000000000000000000002', 'deterministic sequence');
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const context = grantContext(integration, store);
  const result = executeSlice1Command(grantOperand({ reservedOccurrenceId: 'pgw:o:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid');
});

test('grant identity: allocated occurrence ID is internally bound to the grant record', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = grantContext(integration, store);
  const result = executeSlice1Command(grantOperand(), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const stored = store.readLifecyclePayload('runtime-grant', result.evidence.recordId);
  assert.equal(stored.ok, true);
  assert.equal(stored.payload!['reserved_occurrence_id'], result.evidence.reservedOccurrenceId);
  assert.match(result.evidence.reservedOccurrenceId!, OCCURRENCE_ID_RE);
});

test('grant identity: occurrence-ID collision with existing reservation state → occurrence-conflict, zero RuntimeGrant', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  // The deterministic identity source allocates pgw:o:0000...01 first; bind
  // that exact ID to an existing grant (reservation state collision).
  seedGrant(store, { reservedOccurrenceId: 'pgw:o:00000000000000000000000000000001' });
  const context = grantContext(integration, store);
  const result = executeSlice1Command(grantOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'occurrence-conflict', JSON.stringify(result));
  const grants = store.enumerateLifecycleRecords('runtime-grant');
  assert.equal(grants.ok, true);
  assert.equal(grants.recordIds.length, 1, 'zero RuntimeGrant published on collision');
});

// ─── chain authority (contract §9/§10/§11) ──────────────────────────────────

test('grant authority: missing lifecycle dependency → lifecycle-state-missing (member chain absent)', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store, REGISTRY, WS_A, 'CompletionContract');
  const context = grantContext(integration, store);
  const result = executeSlice1Command(grantOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'lifecycle-state-missing', JSON.stringify(result));
});

test('grant authority: revoked required approval → approval-revoked; revoked required issuance → issuance-not-authorized', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const chain = seedFakeChain(store);
  const context = grantContext(integration, store);
  const revokeContext = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), revokerRole: true });
  const revokedApproval = executeSlice1Command(
    { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'ApprovalRecord', targetRecordId: chain.approvalIds[0]!, scope: 'all-uses', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
    revokeContext,
  );
  assert.equal(revokedApproval.ok, true, JSON.stringify(revokedApproval));
  const afterApprovalRevoke = executeSlice1Command(grantOperand(), context);
  assert.equal(afterApprovalRevoke.ok, false);
  if (!afterApprovalRevoke.ok) assert.equal(afterApprovalRevoke.category, 'approval-revoked', JSON.stringify(afterApprovalRevoke));

  const integration2 = makeIntegrationEnv();
  const { store: store2 } = makeFakeStore();
  const chain2 = seedFakeChain(store2);
  const context2 = grantContext(integration2, store2);
  const revokeContext2 = makeContext(integration2.storeEnv, { store: store2, identity: makeIdentitySource(), revokerRole: true });
  const revokedIssuance = executeSlice1Command(
    { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'IssuanceRecord', targetRecordId: chain2.issuanceIds[0]!, scope: 'execution-use', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
    revokeContext2,
  );
  assert.equal(revokedIssuance.ok, true, JSON.stringify(revokedIssuance));
  const afterIssuanceRevoke = executeSlice1Command(grantOperand(), context2);
  assert.equal(afterIssuanceRevoke.ok, false);
  if (!afterIssuanceRevoke.ok) assert.equal(afterIssuanceRevoke.category, 'issuance-not-authorized', JSON.stringify(afterIssuanceRevoke));
});

test('grant authority: AuthorityPolicy chain is bundle-derived; caller cannot supply policy/member identities', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store, REGISTRY, WS_A, 'AuthorityPolicy');
  const context = grantContext(integration, store);
  const missing = executeSlice1Command(grantOperand(), context);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.category, 'lifecycle-state-missing');
  for (const extra of [
    { authorityPolicyId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { policyIdentity: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { taskSpecId: 'pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { memberIds: ['pgw:l:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
  ]) {
    const result = executeSlice1Command(grantOperand(extra), context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, 'request-invalid', JSON.stringify(extra));
  }
});

test('grant authority: a previous verifyCurrentLifecycleState success object is never grant authority', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = grantContext(integration, store);
  const staleEvidence = { ok: true, outcome: 'verified', evidence: { currentState: 'current', intersection: 'satisfied' } };
  const result = executeSlice1Command(grantOperand({ verificationEvidence: staleEvidence, verifyEvidence: staleEvidence }), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid', 'verification evidence cannot be transported as grant authority');
});

test('grant authority: grant role is host-asserted; missing host role fails closed with zero publication', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), grantRole: false, subjectArtifact: makeEvidence('ExecutionBundle').artifact });
  const result = executeSlice1Command(grantOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'lifecycle-state-missing');
  assert.equal(store.enumerateLifecycleRecords('runtime-grant').recordIds.length, 0);
});

test('grant failure: store publish failure → store-failure, zero RuntimeGrant', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = grantContext(integration, failingStore(store, { throwOnPublish: true }));
  const result = executeSlice1Command(grantOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'store-failure');
  assert.equal(store.enumerateLifecycleRecords('runtime-grant').recordIds.length, 0, 'zero RuntimeGrant on publication failure');
});

test('grant failure: store read/enumerate failure → store-failure, zero RuntimeGrant', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = grantContext(integration, failingStore(store, { failReads: true }));
  const result = executeSlice1Command(grantOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'store-failure');
  assert.equal(store.enumerateLifecycleRecords('runtime-grant').recordIds.length, 0, 'zero RuntimeGrant on read failure');
});

test('grant authority: host bundle evidence mismatch → subject-invalid, zero RuntimeGrant', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedFakeChain(store);
  const context = grantContext(integration, store);
  // A syntactically valid request subject whose revision/digest do not match
  // the host-injected validated bundle evidence (identity correlation).
  const mismatched = makeSubject('ExecutionBundle');
  const operand = grantOperand({
    subject: subjectOperand({
      ...mismatched.subject,
      revisionId: 'pgw:r:ffffffffffffffffffffffffffffffff',
      digest: `sha-256:${'f'.repeat(64)}`,
    }),
  });
  const result = executeSlice1Command(operand, context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'subject-invalid', JSON.stringify(result));
  assert.equal(store.enumerateLifecycleRecords('runtime-grant').recordIds.length, 0);
});

test('grant authority: multiple current issuances or approvals for one required subject → lifecycle-conflict, zero RuntimeGrant', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const chain = seedFakeChain(store);
  const context = grantContext(integration, store);
  // A SECOND current issuance for the bundle subject (same workspace/use
  // class): no deterministic unique correlation → lifecycle-conflict.
  seedPayload(store, 'issuance-record', buildIssuanceRecordPayload({
    recordId: 'pgw:l:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    createdAt: FIXED_NOW, subject: BUNDLE.subject, workspaceId: WS_A,
    useClass: 'execution-use', approvalRecordId: chain.approvalIds[0]!, activationLimit: 1, validUntil: null, registry: REGISTRY,
  }));
  const issuanceAmbiguity = executeSlice1Command(grantOperand(), context);
  assert.equal(issuanceAmbiguity.ok, false);
  if (!issuanceAmbiguity.ok) assert.equal(issuanceAmbiguity.category, 'lifecycle-conflict', JSON.stringify(issuanceAmbiguity));
  assert.equal(store.enumerateLifecycleRecords('runtime-grant').recordIds.length, 0);

  // A SECOND current approval for the bundle subject → lifecycle-conflict.
  const integration2 = makeIntegrationEnv();
  const { store: store2 } = makeFakeStore();
  const chain2 = seedFakeChain(store2);
  seedPayload(store2, 'approval-record', buildApprovalRecordPayload({
    recordId: 'pgw:l:baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    createdAt: FIXED_NOW, subject: BUNDLE.subject, workspaceId: WS_A,
    purpose: 'execution-use', validationRecordIds: [chain2.validationRecordIds[0]!],
    requiredSemantics: { protocol_features: [], consumer_capabilities: [] }, validUntil: null, registry: REGISTRY,
  }));
  const context2 = grantContext(integration2, store2);
  const approvalAmbiguity = executeSlice1Command(grantOperand(), context2);
  assert.equal(approvalAmbiguity.ok, false);
  if (!approvalAmbiguity.ok) assert.equal(approvalAmbiguity.category, 'lifecycle-conflict', JSON.stringify(approvalAmbiguity));
  assert.equal(store2.enumerateLifecycleRecords('runtime-grant').recordIds.length, 0);
});

// ─── RuntimeGrant-shaped revocation (contract §26.15) ───────────────────────

test('grant revoke: RuntimeGrant target accepted; exactly one RevocationRecord; target byte-identical', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const grantRecordId = seedGrant(store);
  const before = store.readLifecyclePayload('runtime-grant', grantRecordId).payload;
  const context = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), revokerRole: true });
  const result = executeSlice1Command(revokeGrantOperand(grantRecordId), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(store.enumerateLifecycleRecords('revocation-record').recordIds.length, 1);
  const after = store.readLifecyclePayload('runtime-grant', grantRecordId).payload;
  assert.deepEqual(after, before, 'target must remain byte-identical');
  const revocation = store.readLifecyclePayload('revocation-record', result.evidence.recordId).payload;
  assert.equal((revocation!['target'] as Record<string, unknown>)['record_type'], 'RuntimeGrant');
  assert.equal((revocation!['target'] as Record<string, unknown>)['record_id'], grantRecordId);
});

test('grant revoke: exact-scope duplicate is lifecycle-conflict (existence-based, even when future-dated)', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const grantRecordId = seedGrant(store);
  const context = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), revokerRole: true });
  const first = executeSlice1Command(revokeGrantOperand(grantRecordId), context);
  assert.equal(first.ok, true, JSON.stringify(first));
  const duplicate = executeSlice1Command(revokeGrantOperand(grantRecordId), context);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.category, 'lifecycle-conflict');
  const futureDuplicate = executeSlice1Command(revokeGrantOperand(grantRecordId, { effectiveAt: '2099-01-01T00:00:00.000Z' }), context);
  assert.equal(futureDuplicate.ok, false);
  if (!futureDuplicate.ok) assert.equal(futureDuplicate.category, 'lifecycle-conflict');
});

test('grant revoke: effective all-uses subsumes execution-use; future all-uses does not; execution-use never subsumes all-uses', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const grantRecordId = seedGrant(store);
  const context = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), revokerRole: true });
  const allUses = executeSlice1Command(revokeGrantOperand(grantRecordId, { scope: 'all-uses', effectiveAt: FIXED_NOW }), context);
  assert.equal(allUses.ok, true, JSON.stringify(allUses));
  const subsumed = executeSlice1Command(revokeGrantOperand(grantRecordId, { scope: 'execution-use' }), context);
  assert.equal(subsumed.ok, false);
  if (!subsumed.ok) assert.equal(subsumed.category, 'lifecycle-conflict');

  const integration2 = makeIntegrationEnv();
  const { store: store2 } = makeFakeStore();
  const grantRecordId2 = seedGrant(store2);
  const context2 = makeContext(integration2.storeEnv, { store: store2, identity: makeIdentitySource(), revokerRole: true });
  const execUse = executeSlice1Command(revokeGrantOperand(grantRecordId2, { scope: 'execution-use', effectiveAt: FIXED_NOW }), context2);
  assert.equal(execUse.ok, true, JSON.stringify(execUse));
  const futureAllUses = executeSlice1Command(revokeGrantOperand(grantRecordId2, { scope: 'all-uses', effectiveAt: '2099-01-01T00:00:00.000Z' }), context2);
  assert.equal(futureAllUses.ok, true, JSON.stringify(futureAllUses));
  const again = executeSlice1Command(revokeGrantOperand(grantRecordId2, { scope: 'execution-use', effectiveAt: '2099-01-02T00:00:00.000Z' }), context2);
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.category, 'lifecycle-conflict');
});

test('grant revoke: equality effectiveAt == trustedNow is effective', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const grantRecordId = seedGrant(store);
  const context = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), revokerRole: true });
  const equality = executeSlice1Command(revokeGrantOperand(grantRecordId, { effectiveAt: FIXED_NOW }), context);
  assert.equal(equality.ok, true, JSON.stringify(equality));
  const duplicate = executeSlice1Command(revokeGrantOperand(grantRecordId, { effectiveAt: FIXED_NOW }), context);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.category, 'lifecycle-conflict');
});

test('grant revoke: old-registry RuntimeGrant target MAY be revoked; new record binds the CURRENT registry', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  const oldRegistry = makeRegistryContext();
  const oldPayload = buildRuntimeGrantPayload({
    recordId: 'pgw:l:cccccccccccccccccccccccccccccccc',
    createdAt: FIXED_NOW,
    subject: BUNDLE.subject,
    workspaceId: WS_A,
    reservedOccurrenceId: `pgw:o:${'f'.repeat(32)}`,
    attemptLimit: 2,
    validity: { not_before: FIXED_NOW, not_after: LATER },
    narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    registry: { ...oldRegistry, registrySnapshotId: 'pgw:g:11111111111111111111111111111111', registrySnapshotDigest: `sha-256:${'1'.repeat(64)}` },
  });
  seedPayload(store, 'runtime-grant', oldPayload);
  const before = store.readLifecyclePayload('runtime-grant', 'pgw:l:cccccccccccccccccccccccccccccccc').payload;
  const context = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), revokerRole: true });
  const result = executeSlice1Command(revokeGrantOperand('pgw:l:cccccccccccccccccccccccccccccccc'), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const revocation = store.readLifecyclePayload('revocation-record', result.evidence.recordId).payload;
  const reference = revocation!['registry_snapshot_reference'] as Record<string, unknown>;
  assert.equal(reference['registry_snapshot_id'], REGISTRY.registrySnapshotId, 'new RevocationRecord binds the current registry');
  const after = store.readLifecyclePayload('runtime-grant', 'pgw:l:cccccccccccccccccccccccccccccccc').payload;
  assert.deepEqual(after, before, 'historical target remains byte-identical');
});

test('grant revoke: grant target outside the trusted workspace is lifecycle-state-missing', () => {
  const integration = makeIntegrationEnv();
  const { store } = makeFakeStore();
  seedGrant(store, { workspaceId: 'pgw:w:99999999999999999999999999999999' });
  const context = makeContext(integration.storeEnv, { store, identity: makeIdentitySource(), revokerRole: true });
  const result = executeSlice1Command(revokeGrantOperand('pgw:l:cccccccccccccccccccccccccccccccc'), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'lifecycle-state-missing');
  assert.equal(store.enumerateLifecycleRecords('revocation-record').recordIds.length, 0, 'no disclosure, no publication');
});
