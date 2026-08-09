/**
 * WP-12 Slice 3A — issueRuntimeGrant + RuntimeGrant revocation REAL WP-8
 * STORE tests (task §35 A–W, §31 reentrancy, §32 old-registry scenario).
 *
 * Required by the Slice-3 test contract (SCR-W12-S2-004 precedent; §26.21):
 * fake-store tests are NOT sufficient alone. Every test here runs against
 * an initialized genuine WP-8 store with real publication, real mechanical
 * write-audit, real read/enumeration, byte-identity checks, lock-layout
 * non-expansion, and zero project-file mutation.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import { createControlPlaneStoreBoundary } from '../../src/control-plane/store-boundary.js';
import { buildRuntimeGrantPayload, payloadDigestOf } from '../../src/control-plane/records.js';
import { inspectAuditHistory, enumerateClass } from '../../src/storage/read/index.js';
import {
  cleanupTestEnvs,
  grantChainSubjects,
  makeContext,
  makeEvidence,
  makeIdentitySource,
  makeIntegrationEnv,
  makeRegistryContext,
  makeStoreBoundary,
  seedFullGrantChain,
  seedRawRecord,
  WS_A,
} from './wp12-helpers.js';
import type { AcceptedRegistryContext } from '../../src/api/types.js';
import type { ControlPlaneStoreBoundary, ControlPlaneTrustedContext } from '../../src/control-plane/types.js';

after(() => cleanupTestEnvs());

const REGISTRY = makeRegistryContext();
const ECHO = Object.freeze({ registry_snapshot_id: REGISTRY.registrySnapshotId, registry_snapshot_digest: REGISTRY.registrySnapshotDigest });
const FIXED_NOW = '2026-08-04T06:00:00.000Z';
const LATER = '2026-08-05T06:00:00.000Z';
const BUNDLE = grantChainSubjects().bundle;

function subjectOperand(subject: ReturnType<typeof grantChainSubjects>['bundle']['subject']): Record<string, unknown> {
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

interface GrantEnv {
  readonly integration: ReturnType<typeof makeIntegrationEnv>;
  readonly identity: ReturnType<typeof makeIdentitySource>;
  readonly seed: ReturnType<typeof seedFullGrantChain>;
}

/** Full genuine chain on a real store; the SAME identity continues into the grant command (record-ID uniqueness). */
function grantEnv(options: Record<string, unknown> = {}): GrantEnv {
  const integration = makeIntegrationEnv(options as never);
  const identity = makeIdentitySource();
  const seed = seedFullGrantChain(integration.storeEnv, identity);
  return { integration, identity, seed };
}

function grantContext(env: GrantEnv, overrides: Record<string, unknown> = {}): ControlPlaneTrustedContext {
  return makeContext(env.integration.storeEnv, {
    store: (overrides['store'] as ControlPlaneTrustedContext['store']) ?? makeStoreBoundary(env.integration.storeEnv),
    identity: (overrides['identity'] as ReturnType<typeof makeIdentitySource>) ?? env.identity,
    grantRole: true,
    subjectArtifact: makeEvidence('ExecutionBundle').artifact,
  });
}

/** Count stored records of one class (real enumeration). */
function countClass(integration: ReturnType<typeof makeIntegrationEnv>, recordClass: string): number {
  const result = enumerateClass({
    trustedConfiguration: integration.storeEnv.config,
    trustedInput: integration.storeEnv.bootstrapInput,
    recordClass: recordClass as never,
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  return result.items.length;
}

/** Read one stored lifecycle payload by class + identity (real read path). */
function readTarget(integration: ReturnType<typeof makeIntegrationEnv>, recordClass: string, recordId: string): Record<string, unknown> {
  const boundary = makeStoreBoundary(integration.storeEnv);
  const read = boundary.readLifecyclePayload(recordClass as never, recordId);
  assert.equal(read.ok, true, `${recordClass} ${recordId} must exist`);
  return read.payload as Record<string, unknown>;
}

/** Seed a raw RuntimeGrant directly through WP-8 with an arbitrary registry context. */
function seedGrantRaw(env: ReturnType<typeof makeIntegrationEnv>, overrides: Record<string, unknown> = {}): string {
  const payload = buildRuntimeGrantPayload({
    recordId: String(overrides['record_id'] ?? 'pgw:l:dddddddddddddddddddddddddddddddd'),
    createdAt: FIXED_NOW,
    subject: BUNDLE.subject,
    workspaceId: WS_A,
    reservedOccurrenceId: String(overrides['reserved_occurrence_id'] ?? `pgw:o:${'e'.repeat(32)}`),
    attemptLimit: 2,
    validity: { not_before: FIXED_NOW, not_after: LATER },
    narrowedConstraints: [{ type: 'max-actions', value: 10 }],
    registry: (overrides['registry'] as AcceptedRegistryContext) ?? REGISTRY,
  });
  seedRawRecord(env.storeEnv, 'runtime-grant', payload);
  return String(payload['record_id']);
}

// ─── A–D: happy path, exact bindings, internal allocation, one audit ───────

test('real store A–D: happy-path publication; exact bundle/workspace/reservation binding; internally allocated occurrence ID; exactly one grant + one mechanical audit', () => {
  const env = grantEnv();
  const result = executeSlice1Command(grantOperand(), grantContext(env));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(countClass(env.integration, 'runtime-grant'), 1, 'exactly one RuntimeGrant');
  const stored = readTarget(env.integration, 'runtime-grant', result.evidence.recordId);
  assert.equal(stored['record_type'], 'RuntimeGrant');
  assert.equal(stored['responsible_role'], 'trusted-runtime-grant-authority');
  assert.equal(stored['workspace_id'], WS_A);
  assert.equal(stored['reserved_occurrence_id'], result.evidence.reservedOccurrenceId);
  assert.match(result.evidence.reservedOccurrenceId!, /^pgw:o:[0-9a-f]{32}$/, 'internally allocated occurrence identity');
  assert.equal(stored['attempt_limit'], 2);
  const bundle = stored['bundle'] as Record<string, unknown>;
  assert.equal((bundle['target_kind'] as Record<string, unknown>)['id'], 'ExecutionBundle');
  assert.equal(bundle['target_instance_id'], BUNDLE.subject.instanceId);
  assert.equal(bundle['target_revision_id'], BUNDLE.subject.revisionId);
  assert.equal(bundle['target_digest'], BUNDLE.subject.digest);
  assert.equal((bundle['target_workspace_binding'] as Record<string, unknown>)['workspace_id'], WS_A);
  const validity = stored['validity'] as Record<string, unknown>;
  assert.equal(validity['not_before'], FIXED_NOW);
  assert.equal(validity['not_after'], LATER);
  const constraints = stored['narrowed_constraints'] as Record<string, unknown>[];
  assert.equal(constraints.length, 1);
  assert.equal(constraints[0]!['type'], 'max-actions');
  assert.equal(constraints[0]!['value'], 10);
  // No prohibited fields on the record.
  for (const forbidden of ['approval_record_id', 'approval_record_ids', 'issuance_record_ids', 'path', 'authority_token', 'role']) {
    assert.equal(stored[forbidden] === undefined, true, `grant must not carry ${forbidden}`);
  }
  const history = inspectAuditHistory({
    trustedConfiguration: env.integration.storeEnv.config,
    trustedInput: env.integration.storeEnv.bootstrapInput,
    recordClass: 'runtime-grant',
    recordId: result.evidence.recordId,
  });
  assert.equal(history.ok, true, JSON.stringify(history.findings));
  assert.equal(history.originalAuthorizedWrite?.present, true, 'mechanical authorized-write audit must exist for the RuntimeGrant');
});

// ─── E–H: zero publication on every failure ─────────────────────────────────

test('real store E: malformed request → request-invalid with zero RuntimeGrant', () => {
  const integration = makeIntegrationEnv();
  const identity = makeIdentitySource();
  const result = executeSlice1Command(
    grantOperand({ attemptLimit: 99 }),
    makeContext(integration.storeEnv, { identity, grantRole: true, subjectArtifact: makeEvidence('ExecutionBundle').artifact }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'request-invalid');
  assert.equal(countClass(integration, 'runtime-grant'), 0);
});

test('real store F: role transport → approver-not-independent with zero RuntimeGrant', () => {
  const integration = makeIntegrationEnv();
  const identity = makeIdentitySource();
  const result = executeSlice1Command(
    grantOperand({ grantRole: true }),
    makeContext(integration.storeEnv, { identity, grantRole: true, subjectArtifact: makeEvidence('ExecutionBundle').artifact }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'approver-not-independent');
  assert.equal(countClass(integration, 'runtime-grant'), 0);
});

test('real store G: missing lifecycle dependency → lifecycle-state-missing with zero RuntimeGrant', () => {
  const integration = makeIntegrationEnv();
  const identity = makeIdentitySource();
  // Seed the chain WITHOUT the CompletionContract member.
  seedFullGrantChain(integration.storeEnv, identity, WS_A, 'CompletionContract');
  const result = executeSlice1Command(grantOperand(), grantContext({ integration, identity, seed: null as never }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'lifecycle-state-missing', JSON.stringify(result));
  assert.equal(countClass(integration, 'runtime-grant'), 0);
});

test('real store H: revoked dependency (bundle issuance) → issuance-not-authorized with zero RuntimeGrant', () => {
  const env = grantEnv();
  const revokeContext = makeContext(env.integration.storeEnv, { revokerRole: true, identity: makeIdentitySource() });
  const revoke = executeSlice1Command(
    { operation: 'revoke', workspaceId: WS_A, targetRecordType: 'IssuanceRecord', targetRecordId: env.seed.issuanceRecordIds[0]!, scope: 'execution-use', effectiveAt: FIXED_NOW, reasonCode: 'policy-withdrawn', registryEcho: ECHO },
    revokeContext,
  );
  assert.equal(revoke.ok, true, JSON.stringify(revoke));
  const result = executeSlice1Command(grantOperand(), grantContext(env));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'issuance-not-authorized', JSON.stringify(result));
  assert.equal(countClass(env.integration, 'runtime-grant'), 0);
});

// ─── I–K: ceilings and unsupported narrowing ────────────────────────────────

test('real store I–J: max-actions within the current ceiling succeeds; above a concrete ceiling → ceiling-denied with zero RuntimeGrant', () => {
  const env = grantEnv({ globalActionCeiling: 100, workspaceActionCeiling: 100 });
  const within = executeSlice1Command(grantOperand({ narrowedConstraints: [{ type: 'max-actions', value: 50 }] }), grantContext(env));
  assert.equal(within.ok, true, JSON.stringify(within));
  const env2 = grantEnv({ globalActionCeiling: 10, workspaceActionCeiling: 10 });
  const above = executeSlice1Command(grantOperand({ narrowedConstraints: [{ type: 'max-actions', value: 11 }] }), grantContext(env2));
  assert.equal(above.ok, false);
  if (!above.ok) assert.equal(above.category, 'ceiling-denied', JSON.stringify(above));
  assert.equal(countClass(env2.integration, 'runtime-grant'), 0);
});

test('real store K: max-resources → eligibility-denied with zero RuntimeGrant', () => {
  const env = grantEnv();
  const result = executeSlice1Command(grantOperand({ narrowedConstraints: [{ type: 'max-resources', value: 3 }] }), grantContext(env));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'eligibility-denied', JSON.stringify(result));
  assert.equal(countClass(env.integration, 'runtime-grant'), 0);
});

// ─── L–O: future validity, attempt bounds, occurrence collision ─────────────

test('real store L–N: future not_before accepted as record; attemptLimit 1 and 64 stored', () => {
  const env = grantEnv();
  const future = executeSlice1Command(grantOperand({ validity: { not_before: '2027-01-01T00:00:00.000Z', not_after: '2027-01-02T00:00:00.000Z' } }), grantContext(env));
  assert.equal(future.ok, true, JSON.stringify(future));
  if (!future.ok) return;
  const stored = readTarget(env.integration, 'runtime-grant', future.evidence.recordId);
  assert.equal((stored['validity'] as Record<string, unknown>)['not_before'], '2027-01-01T00:00:00.000Z');
  const one = executeSlice1Command(grantOperand({ attemptLimit: 1 }), grantContext(env));
  assert.equal(one.ok, true, JSON.stringify(one));
  if (!one.ok) return;
  assert.equal(readTarget(env.integration, 'runtime-grant', one.evidence.recordId)['attempt_limit'], 1);
  const sixtyFour = executeSlice1Command(grantOperand({ attemptLimit: 64 }), grantContext(env));
  assert.equal(sixtyFour.ok, true, JSON.stringify(sixtyFour));
  if (!sixtyFour.ok) return;
  assert.equal(readTarget(env.integration, 'runtime-grant', sixtyFour.evidence.recordId)['attempt_limit'], 64);
});

test('real store O: occurrence-ID collision → occurrence-conflict with zero new RuntimeGrant', () => {
  const env = grantEnv();
  // The deterministic identity source will allocate pgw:o:0000…01 first;
  // bind that exact ID to an existing grant (reservation state collision).
  seedGrantRaw(env.integration, { reserved_occurrence_id: 'pgw:o:00000000000000000000000000000001', record_id: 'pgw:l:cccccccccccccccccccccccccccccccc' });
  const result = executeSlice1Command(grantOperand(), grantContext(env));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'occurrence-conflict', JSON.stringify(result));
  assert.equal(countClass(env.integration, 'runtime-grant'), 1, 'only the seeded grant exists');
});

// ─── P–T: RuntimeGrant revocation on a real store ───────────────────────────

test('real store P: RuntimeGrant revoke publishes exactly one RevocationRecord; target byte-identical', () => {
  const { integration, grantRecordId } = revokeEnv();
  const before = readTarget(integration, 'runtime-grant', grantRecordId);
  const context = makeContext(integration.storeEnv, { revokerRole: true, identity: makeIdentitySource() });
  const result = executeSlice1Command(revokeGrantOperand(grantRecordId), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(countClass(integration, 'revocation-record'), 1);
  const after = readTarget(integration, 'runtime-grant', grantRecordId);
  assert.equal(payloadDigestOf(after), payloadDigestOf(before), 'revoke target must remain byte-identical');
  const revocation = readTarget(integration, 'revocation-record', result.evidence.recordId);
  assert.equal((revocation['target'] as Record<string, unknown>)['record_type'], 'RuntimeGrant');
  const history = inspectAuditHistory({
    trustedConfiguration: integration.storeEnv.config,
    trustedInput: integration.storeEnv.bootstrapInput,
    recordClass: 'revocation-record',
    recordId: result.evidence.recordId,
  });
  assert.equal(history.ok, true);
  assert.equal(history.originalAuthorizedWrite?.present, true, 'mechanical write-audit for the grant revocation');
});

/** Bare real-store env with one seeded grant (revoke-only tests; no chain needed). */
function revokeEnv(): { readonly integration: ReturnType<typeof makeIntegrationEnv>; readonly grantRecordId: string } {
  const integration = makeIntegrationEnv();
  const grantRecordId = seedGrantRaw(integration);
  return { integration, grantRecordId };
}

test('real store R–T: exact-scope duplicate conflict; equality effectiveAt == now; future all-uses coexists with effective execution-use', () => {
  const { integration, grantRecordId } = revokeEnv();
  const context = makeContext(integration.storeEnv, { revokerRole: true, identity: makeIdentitySource() });
  // T: equality effectiveAt == trustedNow is effective and publishes.
  const equality = executeSlice1Command(revokeGrantOperand(grantRecordId, { effectiveAt: FIXED_NOW }), context);
  assert.equal(equality.ok, true, JSON.stringify(equality));
  // R: exact-scope duplicate is existence-based → lifecycle-conflict.
  const duplicate = executeSlice1Command(revokeGrantOperand(grantRecordId, { effectiveAt: FIXED_NOW }), context);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.category, 'lifecycle-conflict');
  // S: a FUTURE all-uses revocation is not an exact-scope duplicate and is
  // not yet effective → it coexists with the effective execution-use record.
  const futureAllUses = executeSlice1Command(revokeGrantOperand(grantRecordId, { scope: 'all-uses', effectiveAt: '2099-01-01T00:00:00.000Z' }), context);
  assert.equal(futureAllUses.ok, true, JSON.stringify(futureAllUses));
  assert.equal(countClass(integration, 'revocation-record'), 2, 'both records coexist');
});

// ─── U: old-registry grant revocation (full §32 scenario) ───────────────────

test('real store U: historical registry-A grant revoked under current registry B; new record binds B; target byte-identical', () => {
  const integration = makeIntegrationEnv();
  const registryA = { ...REGISTRY, registrySnapshotId: 'pgw:g:11111111111111111111111111111111', registrySnapshotDigest: `sha-256:${'1'.repeat(64)}` } as AcceptedRegistryContext;
  const grantRecordId = seedGrantRaw(integration, { registry: registryA });
  const before = readTarget(integration, 'runtime-grant', grantRecordId);
  const context = makeContext(integration.storeEnv, { revokerRole: true, identity: makeIdentitySource() });
  // Request echo matches the CURRENT host registry B (the host context is B).
  const result = executeSlice1Command(revokeGrantOperand(grantRecordId), context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const after = readTarget(integration, 'runtime-grant', grantRecordId);
  assert.equal(payloadDigestOf(after), payloadDigestOf(before), 'targetability does not require old registry = current registry; target byte-identical');
  const revocation = readTarget(integration, 'revocation-record', result.evidence.recordId);
  const reference = revocation['registry_snapshot_reference'] as Record<string, unknown>;
  assert.equal(reference['registry_snapshot_id'], REGISTRY.registrySnapshotId, 'new RevocationRecord binds the CURRENT registry');
  assert.equal(reference['registry_snapshot_digest'], REGISTRY.registrySnapshotDigest);
  assert.equal(countClass(integration, 'revocation-record'), 1);
  const history = inspectAuditHistory({
    trustedConfiguration: integration.storeEnv.config,
    trustedInput: integration.storeEnv.bootstrapInput,
    recordClass: 'revocation-record',
    recordId: result.evidence.recordId,
  });
  assert.equal(history.ok, true);
  assert.equal(history.originalAuthorizedWrite?.present, true, 'normal WP-8 mechanical audit occurs');
});

// ─── V–W: mutation scope ────────────────────────────────────────────────────

test('real store V–W: no project-file mutation and no new WP-8 lock-layout artifact', () => {
  const env = grantEnv();
  const result = executeSlice1Command(grantOperand(), grantContext(env));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const grantRecordId = seedGrantRaw(env.integration);
  const revoke = executeSlice1Command(revokeGrantOperand(grantRecordId), makeContext(env.integration.storeEnv, { revokerRole: true, identity: makeIdentitySource() }));
  assert.equal(revoke.ok, true, JSON.stringify(revoke));
  assert.deepEqual(readdirSync(env.integration.configEnv.workspaceRoot), [], 'no project files anywhere');
  for (const entry of readdirSync(join(env.integration.storeEnv.dir, 'store-v1'))) {
    assert.ok(['metadata', 'records', 'index', 'audit', 'tmp', 'locks', 'quarantine'].includes(entry), `unexpected store entry ${entry}`);
  }
});


// ─── §31: operation-vs-operation reentrancy under the shared bundle key ─────

test('reentrancy A: outer issueRuntimeGrant holds the bundle key; inner revoke(RuntimeGrant) for the SAME bundle → lock-conflict', () => {
  const env = grantEnv();
  // Existing RuntimeGrant for the SAME bundle (revoke target).
  const grantRecordId = seedGrantRaw(env.integration, { record_id: 'pgw:l:cccccccccccccccccccccccccccccccc' });
  let innerResult: ReturnType<typeof executeSlice1Command> | undefined;
  const base = makeStoreBoundary(env.integration.storeEnv);
  // ONE shared context (one process-local coordinator instance) carries both
  // the grant role (outer issue) and the revocation role (inner revoke); the
  // inner same-key acquisition must contend with the outer held lock.
  const reentrant = {
    ...base,
    publishLifecycleRecord(recordClass: ControlPlaneTrustedContext['store'] extends infer S ? S extends ControlPlaneStoreBoundary ? Parameters<S['publishLifecycleRecord']>[0] : never : never, payload: Readonly<Record<string, unknown>>) {
      if (recordClass === 'runtime-grant') {
        innerResult = executeSlice1Command(revokeGrantOperand(grantRecordId), shared);
      }
      return base.publishLifecycleRecord(recordClass, payload);
    },
  };
  const shared = makeContext(env.integration.storeEnv, {
    store: reentrant,
    identity: env.identity,
    grantRole: true,
    revokerRole: true,
    subjectArtifact: makeEvidence('ExecutionBundle').artifact,
  });
  const result = executeSlice1Command(grantOperand(), shared);
  assert.equal(result.ok, true, 'outer issue completes after the inner denial');
  assert.ok(innerResult !== undefined, 'inner revoke must have run');
  assert.equal(innerResult.ok, false);
  if (!innerResult.ok) assert.equal(innerResult.category, 'lock-conflict', 'inner same-bundle revoke fails closed');
});

test('reentrancy B: outer revoke(RuntimeGrant) holds the derived bundle key; inner issueRuntimeGrant for the SAME bundle → lock-conflict; retry proceeds after release', () => {
  const env = grantEnv();
  const grantRecordId = seedGrantRaw(env.integration);
  let innerResult: ReturnType<typeof executeSlice1Command> | undefined;
  const base = makeStoreBoundary(env.integration.storeEnv);
  // ONE shared context: the outer revoke holds the bundle-derived key; the
  // inner issue for the same bundle must contend with it.
  const reentrant = {
    ...base,
    publishLifecycleRecord(recordClass: ControlPlaneTrustedContext['store'] extends infer S ? S extends ControlPlaneStoreBoundary ? Parameters<S['publishLifecycleRecord']>[0] : never : never, payload: Readonly<Record<string, unknown>>) {
      if (recordClass === 'revocation-record') {
        innerResult = executeSlice1Command(grantOperand(), shared);
      }
      return base.publishLifecycleRecord(recordClass, payload);
    },
  };
  const shared = makeContext(env.integration.storeEnv, {
    store: reentrant,
    identity: env.identity,
    grantRole: true,
    revokerRole: true,
    subjectArtifact: makeEvidence('ExecutionBundle').artifact,
  });
  const result = executeSlice1Command(revokeGrantOperand(grantRecordId), shared);
  assert.equal(result.ok, true, 'outer revoke completes');
  assert.ok(innerResult !== undefined, 'inner issue must have run');
  assert.equal(innerResult.ok, false);
  if (!innerResult.ok) assert.equal(innerResult.category, 'lock-conflict', 'inner same-bundle issue fails closed');
  // After the owner releases the lock, the retry proceeds according to
  // current state: the grant chain is still current → success.
  const retry = executeSlice1Command(grantOperand(), shared);
  assert.equal(retry.ok, true, JSON.stringify(retry));
});
