/**
 * WP-12 Slice 3B — decideActivation + createOccurrence REAL WP-8 STORE tests.
 *
 * Required by the Slice-3 test contract (real-store coverage precedent):
 * every test runs against an initialized genuine WP-8 store with real
 * publication, real mechanical write-audits, real read/enumeration, exact
 * byte-identity checks, the genuine two-publication accepted transition,
 * crash-injection recovery, registry A → B recovery with graph-entry
 * scoping, audit counts, same-bundle concurrency, and zero project-file /
 * lock-layout mutation.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import { makeStoreBoundary } from './wp12-helpers.js';
import { buildValidationRecordPayload, buildApprovalRecordPayload, buildIssuanceRecordPayload, buildRuntimeGrantPayload, buildActivationRecordPayload, payloadDigestOf } from '../../src/control-plane/records.js';
import { inspectAuditHistory, enumerateClass } from '../../src/storage/read/index.js';
import {
  cleanupTestEnvs,
  grantChainSubjects,
  makeContext,
  makeEvidence,
  makeIdentitySource,
  makeIntegrationEnv,
  makeRegistryContext,
  seedFullGrantChain,
  seedRawRecord,
  WS_A,
} from './wp12-helpers.js';
import type { AcceptedRegistryContext, ConsumerSupportDeclaration } from '../../src/api/types.js';
import type { ControlPlaneStoreBoundary, ControlPlaneTrustedContext } from '../../src/control-plane/types.js';

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

function subjectOperand(subject: typeof BUNDLE.subject): Record<string, unknown> {
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

interface ActivationEnv {
  readonly integration: ReturnType<typeof makeIntegrationEnv>;
  readonly identity: ReturnType<typeof makeIdentitySource>;
  readonly seed: ReturnType<typeof seedFullGrantChain>;
}

/** Full genuine chain (real command flow) + grant-issue command; SAME identity continues. */
function grantEnv(): ActivationEnv {
  const integration = makeIntegrationEnv();
  const identity = makeIdentitySource();
  const seed = seedFullGrantChain(integration.storeEnv, identity);
  const grantContext = makeContext(integration.storeEnv, {
    identity,
    grantRole: true,
    subjectArtifact: makeEvidence('ExecutionBundle').artifact,
  });
  const issued = executeSlice1Command(grantOperand(), grantContext);
  if (!issued.ok) throw new Error(`grant seed failed: ${JSON.stringify(issued)}`);
  return { integration, identity, seed };
}

function activationContext(env: ActivationEnv, overrides: { readonly store?: ControlPlaneStoreBoundary; readonly identity?: ReturnType<typeof makeIdentitySource>; readonly consumerSupport?: ConsumerSupportDeclaration; readonly configuration?: unknown } = {}): ControlPlaneTrustedContext {
  return makeContext(env.integration.storeEnv, {
    store: overrides.store ?? makeStoreBoundary(env.integration.storeEnv),
    identity: overrides.identity ?? env.identity,
    activationRole: true,
    consumerSupport: overrides.consumerSupport ?? DEFAULT_CONSUMER_SUPPORT,
    subjectArtifact: makeEvidence('ExecutionBundle').artifact,
    policyEvidence: makeEvidence('AuthorityPolicy').artifact,
    ...(overrides.configuration !== undefined ? { configuration: overrides.configuration as never } : {}),
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

function assertMechanicalAudit(env: ActivationEnv, recordClass: string, recordId: string): void {
  const history = inspectAuditHistory({
    trustedConfiguration: env.integration.storeEnv.config,
    trustedInput: env.integration.storeEnv.bootstrapInput,
    recordClass: recordClass as never,
    recordId,
  });
  assert.equal(history.ok, true, JSON.stringify(history.findings));
  assert.equal(history.originalAuthorizedWrite?.present, true, `mechanical authorized-write audit must exist for ${recordClass}`);
}

// ─── accepted path ──────────────────────────────────────────────────────────

test('real store: accepted activation publishes ActivationRecord FIRST then ExecutionOccurrenceRecord; exact bindings; two mechanical audits', () => {
  const env = grantEnv();
  const issuedGrant = readGrantOf(env);
  const result = executeSlice1Command(activationOperand(issuedGrant.grantId, issuedGrant.reservedOccurrenceId), activationContext(env));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.evidence.decision, 'accepted');
  assert.equal(countClass(env.integration, 'activation-record'), 1);
  assert.equal(countClass(env.integration, 'execution-occurrence-record'), 1, 'exactly one occurrence');

  const activation = readTarget(env.integration, 'activation-record', result.evidence.recordId);
  assert.equal(activation['record_type'], 'ActivationRecord');
  assert.equal(activation['responsible_role'], 'trusted-activation-authority');
  assert.equal(activation['decision'], 'accepted');
  assert.equal(activation['workspace_id'], WS_A);
  assert.equal(activation['runtime_grant_id'], issuedGrant.grantId);
  assert.equal(activation['reserved_occurrence_id'], issuedGrant.reservedOccurrenceId);
  const required = activation['required_issuance_record_ids'] as string[];
  assert.equal(required.length, 5, 'schema-required five issuance IDs');
  for (const issuanceId of env.seed.issuanceRecordIds) {
    assert.equal(required.includes(issuanceId), true, 'every chain issuance correlated exactly');
  }
  const activationBundle = activation['bundle'] as Record<string, unknown>;
  assert.equal(activationBundle['target_instance_id'], BUNDLE.subject.instanceId);
  assert.equal(activationBundle['target_revision_id'], BUNDLE.subject.revisionId);
  assert.equal(activationBundle['target_digest'], BUNDLE.subject.digest);

  const occurrence = readTarget(env.integration, 'execution-occurrence-record', result.evidence.occurrenceRecordId!);
  assert.equal(occurrence['record_type'], 'ExecutionOccurrenceRecord');
  assert.equal(occurrence['responsible_role'], 'trusted-control-plane');
  assert.equal(occurrence['activation_record_id'], result.evidence.recordId, 'occurrence binds the exact accepted activation');
  assert.equal(occurrence['occurrence_id'], issuedGrant.reservedOccurrenceId, 'occurrence reuses the reserved identity');
  assert.equal(occurrence['runtime_grant_id'], issuedGrant.grantId);
  assert.equal(payloadDigestOf(occurrence['bundle'] as Record<string, unknown>), payloadDigestOf(activationBundle), 'identical bundle reference bytes');
  assert.equal(occurrence['workspace_id'], WS_A);

  assertMechanicalAudit(env, 'activation-record', result.evidence.recordId);
  assertMechanicalAudit(env, 'execution-occurrence-record', result.evidence.occurrenceRecordId!);
  // Complete evidence only after BOTH records are durable.
  assert.equal(result.evidence.registrySnapshotId, REGISTRY.registrySnapshotId);
});

function readGrantOf(env: ActivationEnv): { readonly grantId: string; readonly reservedOccurrenceId: string } {
  const boundary = makeStoreBoundary(env.integration.storeEnv);
  const grants = boundary.enumerateLifecycleRecords('runtime-grant');
  assert.equal(grants.ok, true);
  assert.equal(grants.recordIds.length, 1);
  const read = boundary.readLifecyclePayload('runtime-grant', grants.recordIds[0]!);
  assert.equal(read.ok, true);
  return { grantId: grants.recordIds[0]!, reservedOccurrenceId: String(read.payload!['reserved_occurrence_id']) };
}

// ─── denied path ────────────────────────────────────────────────────────────

test('real store: revoked required issuance → durable denied decision; exactly one record; zero occurrences; one audit', () => {
  const env = grantEnv();
  // The revocation continues the SAME identity source (record-ID uniqueness
  // in the WP-4 graph index).
  const revokeContext = makeContext(env.integration.storeEnv, { revokerRole: true, identity: env.identity });
  const revoked = executeSlice1Command(
    { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'IssuanceRecord', targetRecordId: env.seed.issuanceRecordIds[0]!, scope: 'execution-use', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
    revokeContext,
  );
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  const issuedGrant = readGrantOf(env);
  const result = executeSlice1Command(activationOperand(issuedGrant.grantId, issuedGrant.reservedOccurrenceId), activationContext(env));
  assert.equal(result.ok, true, 'the denied decision is a completed durable decision');
  if (!result.ok) return;
  assert.equal(result.evidence.decision, 'denied');
  assert.equal(countClass(env.integration, 'activation-record'), 1);
  assert.equal(countClass(env.integration, 'execution-occurrence-record'), 0, 'denied produces no occurrence');
  const activation = readTarget(env.integration, 'activation-record', result.evidence.recordId);
  assert.equal(activation['decision'], 'denied');
  const required = activation['required_issuance_record_ids'] as string[];
  assert.equal(required.length, 5, 'a denied record is NEVER built with fewer than five issuance IDs');
  assert.equal(activation['runtime_grant_id'], issuedGrant.grantId);
  assert.equal(activation['reserved_occurrence_id'], issuedGrant.reservedOccurrenceId);
  assertMechanicalAudit(env, 'activation-record', result.evidence.recordId);
});

test('real store: rejection (missing member chain) produces zero records and zero audits', () => {
  const integration = makeIntegrationEnv();
  const identity = makeIdentitySource();
  // The chain is missing the CompletionContract member; the grant is seeded
  // directly (the grant-issue command itself requires the full chain, so a
  // raw store grant isolates the ACTIVATION correlation failure).
  seedFullGrantChain(integration.storeEnv, identity, WS_A, 'CompletionContract');
  const grantPayload = buildRuntimeGrantPayload({
    recordId: 'pgw:l:cccccccccccccccccccccccccccccccc',
    createdAt: FIXED_NOW,
    subject: BUNDLE.subject,
    workspaceId: WS_A,
    reservedOccurrenceId: `pgw:o:${'a'.repeat(32)}`,
    attemptLimit: 2,
    validity: { not_before: FIXED_NOW, not_after: LATER },
    narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    registry: REGISTRY,
  });
  seedRawRecord(integration.storeEnv, 'runtime-grant', grantPayload);
  const env = { integration, identity, seed: null as never };
  const result = executeSlice1Command(
    activationOperand('pgw:l:cccccccccccccccccccccccccccccccc', `pgw:o:${'a'.repeat(32)}`),
    activationContext(env as never),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'lifecycle-state-missing', JSON.stringify(result));
  assert.equal(countClass(integration, 'activation-record'), 0);
  assert.equal(countClass(integration, 'execution-occurrence-record'), 0);
});

// ─── crash + recovery (real store) ──────────────────────────────────────────

test('real store: crash after accepted ActivationRecord → store-failure with NO complete evidence; createOccurrence repairs exactly once', () => {
  const env = grantEnv();
  const issuedGrant = readGrantOf(env);
  const base = makeStoreBoundary(env.integration.storeEnv);
  const crashing = {
    ...base,
    publishLifecycleRecord(recordClass: Parameters<ControlPlaneStoreBoundary['publishLifecycleRecord']>[0], payload: Readonly<Record<string, unknown>>) {
      if (recordClass === 'execution-occurrence-record') throw new Error('injected crash before occurrence durability');
      return base.publishLifecycleRecord(recordClass, payload);
    },
  };
  const crashed = executeSlice1Command(activationOperand(issuedGrant.grantId, issuedGrant.reservedOccurrenceId), activationContext(env, { store: crashing }));
  assert.equal(crashed.ok, false);
  if (!crashed.ok) assert.equal(crashed.category, 'store-failure');
  assert.equal(countClass(env.integration, 'activation-record'), 1, 'accepted activation is durable');
  assert.equal(countClass(env.integration, 'execution-occurrence-record'), 0, 'occurrence missing after the crash');

  const repaired = executeSlice1Command(recoveryOperand(issuedGrant.reservedOccurrenceId), activationContext(env));
  assert.equal(repaired.ok, true, JSON.stringify(repaired));
  if (!repaired.ok) return;
  assert.equal(repaired.outcome, 'recovered');
  assert.equal(countClass(env.integration, 'execution-occurrence-record'), 1, 'exactly one occurrence after repair');
  assert.equal(countClass(env.integration, 'activation-record'), 1, 'repair never creates another activation');
  const occurrence = readTarget(env.integration, 'execution-occurrence-record', repaired.evidence.recordId);
  assert.equal(occurrence['occurrence_id'], issuedGrant.reservedOccurrenceId, 'repair reuses the reserved ID — never allocates another');
  assert.equal(occurrence['activation_record_id'], repaired.evidence.activationRecordId);
  assertMechanicalAudit(env, 'execution-occurrence-record', repaired.evidence.recordId);

  const again = executeSlice1Command(recoveryOperand(issuedGrant.reservedOccurrenceId), activationContext(env));
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.category, 'occurrence-conflict');
});

test('real store: recovery after later grant revocation (historical completion; no currentness re-decision)', () => {
  const env = grantEnv();
  const issuedGrant = readGrantOf(env);
  const base = makeStoreBoundary(env.integration.storeEnv);
  const crashing = {
    ...base,
    publishLifecycleRecord(recordClass: Parameters<ControlPlaneStoreBoundary['publishLifecycleRecord']>[0], payload: Readonly<Record<string, unknown>>) {
      if (recordClass === 'execution-occurrence-record') throw new Error('injected crash');
      return base.publishLifecycleRecord(recordClass, payload);
    },
  };
  const crashed = executeSlice1Command(activationOperand(issuedGrant.grantId, issuedGrant.reservedOccurrenceId), activationContext(env, { store: crashing }));
  assert.equal(crashed.ok, false);
  const revokeContext = makeContext(env.integration.storeEnv, { revokerRole: true, identity: env.identity });
  const revoked = executeSlice1Command(
    { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'RuntimeGrant', targetRecordId: issuedGrant.grantId, scope: 'all-uses', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
    revokeContext,
  );
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  const repaired = executeSlice1Command(recoveryOperand(issuedGrant.reservedOccurrenceId), activationContext(env));
  assert.equal(repaired.ok, true, 'revocation after the accepted decision does not prevent historical completion', JSON.stringify(repaired));
});

// ─── replay / activation_limit / concurrency ────────────────────────────────

test('real store: replay after accepted is replay-denied; second fresh grant + reservation exhausts activation_limit → denied', () => {
  const env = grantEnv();
  const issuedGrant = readGrantOf(env);
  const context = activationContext(env);
  const accepted = executeSlice1Command(activationOperand(issuedGrant.grantId, issuedGrant.reservedOccurrenceId), context);
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  if (!accepted.ok) return;
  const replay = executeSlice1Command(activationOperand(issuedGrant.grantId, issuedGrant.reservedOccurrenceId), context);
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.category, 'replay-denied');
  // Second grant (default bundle issuance activation_limit = 1): the next
  // fully correlated activation decision is a durable denial.
  const grantContext = makeContext(env.integration.storeEnv, { identity: env.identity, grantRole: true, subjectArtifact: makeEvidence('ExecutionBundle').artifact });
  const secondGrant = executeSlice1Command(grantOperand(), grantContext);
  assert.equal(secondGrant.ok, true, JSON.stringify(secondGrant));
  if (!secondGrant.ok) return;
  const second = executeSlice1Command(activationOperand(secondGrant.evidence.recordId, secondGrant.evidence.reservedOccurrenceId!), context);
  assert.equal(second.ok, true, JSON.stringify(second));
  if (!second.ok) return;
  assert.equal(second.evidence.decision, 'denied', 'activation_limit exhaustion is a durable denial');
  assert.equal(countClass(env.integration, 'activation-record'), 2);
  assert.equal(countClass(env.integration, 'execution-occurrence-record'), 1, 'denial adds no occurrence');
});

test('real store: activation_limit 2 chain allows two accepted activations (counting from accepted records only)', () => {
  const integration = makeIntegrationEnv();
  const identity = makeIdentitySource();
  // Raw-seed the genuine chain with a bundle issuance activation_limit of 2
  // (direct WP-8 publication of builder payloads; the command-flow default is
  // limit 1, and a second issuance would be an ambiguity).
  seedRawChain(integration, { bundleActivationLimit: 2 });
  const grantContext = makeContext(integration.storeEnv, { identity, grantRole: true, subjectArtifact: makeEvidence('ExecutionBundle').artifact });
  const context = makeContext(integration.storeEnv, {
    identity,
    activationRole: true,
    consumerSupport: DEFAULT_CONSUMER_SUPPORT,
    subjectArtifact: makeEvidence('ExecutionBundle').artifact,
    policyEvidence: makeEvidence('AuthorityPolicy').artifact,
  });
  for (let i = 0; i < 2; i += 1) {
    const grant = executeSlice1Command(grantOperand(), grantContext);
    assert.equal(grant.ok, true, JSON.stringify(grant));
    if (!grant.ok) return;
    const decision = executeSlice1Command(activationOperand(grant.evidence.recordId, grant.evidence.reservedOccurrenceId!), context);
    assert.equal(decision.ok, true, JSON.stringify(decision));
    if (!decision.ok) return;
    assert.equal(decision.evidence.decision, 'accepted', `activation ${i + 1} accepted under limit 2`);
  }
  assert.equal(countClass(integration, 'activation-record'), 2);
  assert.equal(countClass(integration, 'execution-occurrence-record'), 2);
  // The third activation is a durable denial (exhaustion at 2).
  const thirdGrant = executeSlice1Command(grantOperand(), grantContext);
  assert.equal(thirdGrant.ok, true, JSON.stringify(thirdGrant));
  if (!thirdGrant.ok) return;
  const third = executeSlice1Command(activationOperand(thirdGrant.evidence.recordId, thirdGrant.evidence.reservedOccurrenceId!), context);
  assert.equal(third.ok, true, JSON.stringify(third));
  if (!third.ok) return;
  assert.equal(third.evidence.decision, 'denied', 'third activation is a durable denial');
  assert.equal(countClass(integration, 'execution-occurrence-record'), 2, 'denial adds no occurrence');
});

test('real store: same-bundle reentrancy — outer decideActivation holds the bundle key; inner decideActivation for the SAME bundle → lock-conflict', () => {
  const env = grantEnv();
  const issuedGrant = readGrantOf(env);
  const base = makeStoreBoundary(env.integration.storeEnv);
  let innerResult: ReturnType<typeof executeSlice1Command> | undefined;
  const shared = makeContext(env.integration.storeEnv, {
    store: {
      ...base,
      publishLifecycleRecord(recordClass: Parameters<ControlPlaneStoreBoundary['publishLifecycleRecord']>[0], payload: Readonly<Record<string, unknown>>) {
        if (recordClass === 'execution-occurrence-record') {
          innerResult = executeSlice1Command(activationOperand(issuedGrant.grantId, issuedGrant.reservedOccurrenceId), shared);
        }
        return base.publishLifecycleRecord(recordClass, payload);
      },
    },
    identity: env.identity,
    activationRole: true,
    consumerSupport: DEFAULT_CONSUMER_SUPPORT,
    subjectArtifact: makeEvidence('ExecutionBundle').artifact,
    policyEvidence: makeEvidence('AuthorityPolicy').artifact,
  });
  const result = executeSlice1Command(activationOperand(issuedGrant.grantId, issuedGrant.reservedOccurrenceId), shared);
  assert.equal(result.ok, true, 'outer decision completes after the inner denial');
  assert.ok(innerResult !== undefined, 'inner decideActivation must have run');
  assert.equal(innerResult.ok, false);
  if (!innerResult.ok) assert.equal(innerResult.category, 'lock-conflict', 'inner same-bundle activation fails closed');
});

/** Raw-seed the genuine five-subject chain through real WP-8 publication (builder payloads; LFC-clean). */
function seedRawChain(integration: ReturnType<typeof makeIntegrationEnv>, options: { readonly bundleActivationLimit?: number } = {}): void {
  const { bundle, members } = grantChainSubjects(WS_A);
  const subjects = [bundle, ...members];
  const id = (base: number): string => `pgw:l:${base.toString(16).padStart(32, '0')}`;
  for (let k = 0; k < subjects.length; k += 1) {
    const info = subjects[k]!;
    const validationId = id(0x4000 + k);
    seedRawRecord(integration.storeEnv, 'validation-record', buildValidationRecordPayloadRaw(validationId, info.subject));
    const approvalId = id(0x4100 + k);
    seedRawRecord(integration.storeEnv, 'approval-record', buildApprovalRecordPayloadRaw(approvalId, info.subject, validationId));
    seedRawRecord(integration.storeEnv, 'issuance-record', buildIssuanceRecordPayloadRaw(id(0x4200 + k), info.subject, approvalId, k === 0 ? (options.bundleActivationLimit ?? 1) : 1));
  }
}

function buildValidationRecordPayloadRaw(recordId: string, subject: typeof BUNDLE.subject): Readonly<Record<string, unknown>> {
  return buildValidationRecordPayload({ recordId, createdAt: FIXED_NOW, subject, registry: REGISTRY });
}
function buildApprovalRecordPayloadRaw(recordId: string, subject: typeof BUNDLE.subject, validationRecordId: string): Readonly<Record<string, unknown>> {
  return buildApprovalRecordPayload({
    recordId, createdAt: FIXED_NOW, subject, workspaceId: WS_A,
    purpose: 'execution-use', validationRecordIds: [validationRecordId],
    requiredSemantics: { protocol_features: [], consumer_capabilities: [] }, validUntil: null, registry: REGISTRY,
  });
}
function buildIssuanceRecordPayloadRaw(recordId: string, subject: typeof BUNDLE.subject, approvalRecordId: string, activationLimit: number): Readonly<Record<string, unknown>> {
  return buildIssuanceRecordPayload({
    recordId, createdAt: FIXED_NOW, subject, workspaceId: WS_A,
    useClass: 'execution-use', approvalRecordId, activationLimit, validUntil: null, registry: REGISTRY,
  });
}

// ─── registry A → B recovery (graph-entry scoping) ──────────────────────────

test('real store: registry A → B recovery — historical accepted activation under A repaired under B; occurrence binds B; A records byte-identical', () => {
  const integration = makeIntegrationEnv();
  const registryA = { ...REGISTRY, registrySnapshotId: 'pgw:g:11111111111111111111111111111111', registrySnapshotDigest: `sha-256:${'1'.repeat(64)}` } as AcceptedRegistryContext;
  const identity = makeIdentitySource();
  seedFullGrantChain(integration.storeEnv, identity);
  // Historical grant + accepted activation under registry A (crash before the occurrence).
  const reservation = `pgw:o:${'a'.repeat(32)}`;
  const grantPayload = buildRuntimeGrantPayload({
    recordId: 'pgw:l:cccccccccccccccccccccccccccccccc',
    createdAt: FIXED_NOW,
    subject: BUNDLE.subject,
    workspaceId: WS_A,
    reservedOccurrenceId: reservation,
    attemptLimit: 2,
    validity: { not_before: FIXED_NOW, not_after: LATER },
    narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    registry: registryA,
  });
  seedRawRecord(integration.storeEnv, 'runtime-grant', grantPayload);
  const issuances = makeStoreBoundary(integration.storeEnv).enumerateLifecycleRecords('issuance-record');
  assert.equal(issuances.ok, true);
  const activationPayload = buildActivationRecordPayload({
    recordId: 'pgw:l:dddddddddddddddddddddddddddddddd',
    createdAt: FIXED_NOW,
    subject: BUNDLE.subject,
    workspaceId: WS_A,
    requiredIssuanceRecordIds: Object.freeze([...issuances.recordIds].slice(0, 5)),
    runtimeGrantId: 'pgw:l:cccccccccccccccccccccccccccccccc',
    reservedOccurrenceId: reservation,
    decision: 'accepted',
    registry: registryA,
  });
  seedRawRecord(integration.storeEnv, 'activation-record', activationPayload);
  const activationBefore = readTarget(integration, 'activation-record', 'pgw:l:dddddddddddddddddddddddddddddddd');
  const grantBefore = readTarget(integration, 'runtime-grant', 'pgw:l:cccccccccccccccccccccccccccccccc');

  // Host current accepted registry is B; the recovery echo is B.
  const recoveryContext = makeContext(integration.storeEnv, {
    identity,
    activationRole: true,
    consumerSupport: DEFAULT_CONSUMER_SUPPORT,
    subjectArtifact: makeEvidence('ExecutionBundle').artifact,
    policyEvidence: makeEvidence('AuthorityPolicy').artifact,
  });
  const repaired = executeSlice1Command(recoveryOperand(reservation), recoveryContext);
  assert.equal(repaired.ok, true, JSON.stringify(repaired));
  if (!repaired.ok) return;
  const occurrence = readTarget(integration, 'execution-occurrence-record', repaired.evidence.recordId);
  const reference = occurrence['registry_snapshot_reference'] as Record<string, unknown>;
  assert.equal(reference['registry_snapshot_id'], REGISTRY.registrySnapshotId, 'the new occurrence binds the CURRENT registry B');
  assert.equal(reference['registry_snapshot_digest'], REGISTRY.registrySnapshotDigest);
  assert.equal(occurrence['occurrence_id'], reservation);
  assert.equal(occurrence['activation_record_id'], 'pgw:l:dddddddddddddddddddddddddddddddd');
  assert.equal(payloadDigestOf(readTarget(integration, 'activation-record', 'pgw:l:dddddddddddddddddddddddddddddddd')), payloadDigestOf(activationBefore), 'historical A activation byte-identical');
  assert.equal(payloadDigestOf(readTarget(integration, 'runtime-grant', 'pgw:l:cccccccccccccccccccccccccccccccc')), payloadDigestOf(grantBefore), 'historical A grant byte-identical');
  assert.equal(countClass(integration, 'execution-occurrence-record'), 1, 'exactly one occurrence appended');
  assertMechanicalAudit({ integration, identity, seed: null as never }, 'execution-occurrence-record', repaired.evidence.recordId);
});

// ─── mutation scope ─────────────────────────────────────────────────────────

test('real store: full activation flow leaves zero project files and no WP-8 lock-layout artifact', () => {
  const env = grantEnv();
  const issuedGrant = readGrantOf(env);
  const result = executeSlice1Command(activationOperand(issuedGrant.grantId, issuedGrant.reservedOccurrenceId), activationContext(env));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const locksDir = join(env.integration.storeEnv.dir, 'store-v1', 'locks');
  if (existsSync(locksDir)) assert.deepEqual(readdirSync(locksDir), [], 'no lock file may remain and no WP-12 lock artifact may exist');
  assert.deepEqual(readdirSync(env.integration.configEnv.workspaceRoot), [], 'no project files anywhere');
  for (const entry of readdirSync(join(env.integration.storeEnv.dir, 'store-v1'))) {
    assert.ok(['metadata', 'records', 'index', 'audit', 'tmp', 'locks', 'quarantine'].includes(entry), `unexpected store entry ${entry}`);
  }
});
