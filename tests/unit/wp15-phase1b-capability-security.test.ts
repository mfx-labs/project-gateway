/**
 * WP-15 Phase 1B — trusted receipt producer: capability security (§20).
 *
 * Focused adversarial tests: unbranded capability rejected; forged permit
 * rejected; stale generation rejected on genuine configuration replacement;
 * a capability of another trusted domain cannot be reused; the receipt
 * producer cannot publish another record class; the raw publishRecord handle
 * is not exposed; the caller cannot self-assert responsible_role/provenance,
 * inject registry_snapshot_reference, or inject trusted outcome/facts.
 *
 * Uses the existing CAP-008…CAP-016 patterns (module-private WeakSet brands,
 * generation-bound registries, exact-record permits) — no new cryptographic
 * machinery.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { issueTrustedReceipt, createReceiptProducerAuthority } from '../../src/receipt-production/index.js';
import { createTrustedReceiptCapability, createTrustedReceiptPermit, isGenuineTrustedReceiptCapability } from '../../src/receipt-production/internal/brand.js';
import { createExecutionOutcomeCapability } from '../../src/outcome/capability.js';
import { createResultPublicationCapability } from '../../src/publication/capability.js';
import { computePayloadDigest } from '../../src/storage/format/envelope.js';
import { defaultLimitProfile } from '../../src/storage/limits/limits.js';
import { createSchemaRegistry } from '../../src/api/validate.js';
import { createProcessLocalCoordinator } from '../../src/control-plane/coordination.js';
import { buildExecutionAttemptRecordPayload } from '../../src/control-plane/records.js';
import { seedPayload, makeIntegrationEnv } from './wp12-helpers.js';
import {
  makeReceiptEnv,
  issuedOf,
  failedOf,
  receiptCleanup,
  seedOutcomeFor,
  seedOutcome,
  expectedOutcomePayload,
  makeCountingReceiptIdentity,
  WS_A,
  FIXED_NOW,
  OCCURRENCE_ID,
  ATTEMPT_RECORD_ID,
} from './wp15-phase1b-helpers.js';

after(receiptCleanup);

const REQUEST = { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID };

test('P1B: unbranded capability — a structurally compatible plain object is rejected at the authority gate', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const forged = {
    binding: { configurationIdentity: env.integration.storeEnv.config.identity, actionIdentity: 'x', operation: 'trusted-receipt-production', generation: {} },
    verify() {
      return { ok: true };
    },
    dispose() {},
  };
  const result = failedOf(issueTrustedReceipt(env.input({ capability: forged })));
  assert.deepEqual(result, { category: 'RECEIPT-CAPABILITY-DENIED', code: 'capability.not-genuine' });
  assert.equal(env.receiptRecords().length, 0);
});

test('P1B: forged permit — the store sink rejects an unbranded permit object', () => {
  const env = makeReceiptEnv();
  const payload = { record_type: 'TrustedReceipt', record_id: 'pgw:l:' + '0'.repeat(32), created_at: '2026-08-04T06:00:00.000Z', responsible_role: 'trusted-receipt-producer' };
  const result = env.boundary.publishTrustedReceipt(
    { binding: { role: 'trusted-receipt-producer', recordClass: 'trusted-receipt', recordId: payload.record_id, recordDigest: 'sha-256:' + '1'.repeat(64), canonicalBytesDigest: 'sha-256:' + '1'.repeat(64) }, dispose() {} },
    payload,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'permit.not-genuine');
});

test('P1B: disposed permit — a live check rejects a disposed genuine permit', () => {
  const env = makeReceiptEnv();
  const capability = env.capability;
  const payload = { record_type: 'TrustedReceipt', record_id: 'pgw:l:' + '0'.repeat(32), created_at: '2026-08-04T06:00:00.000Z', responsible_role: 'trusted-receipt-producer' };
  const digest = computePayloadDigest(payload);
  const permit = createTrustedReceiptPermit({ capability, role: 'trusted-receipt-producer', recordId: payload.record_id, recordDigest: digest, canonicalBytesDigest: digest });
  assert.ok(permit !== undefined);
  permit!.dispose();
  const result = env.boundary.publishTrustedReceipt(permit, payload);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'permit.disposed');
});

test('P1B: capability of another trusted domain cannot be reused — outcome and publication capabilities are rejected', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const outcomeCapability = createExecutionOutcomeCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'outcome-action' });
  const publicationCapability = createResultPublicationCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'publication-action' });
  assert.ok(outcomeCapability !== undefined && publicationCapability !== undefined);
  assert.equal(isGenuineTrustedReceiptCapability(outcomeCapability), false);
  assert.equal(isGenuineTrustedReceiptCapability(publicationCapability), false);
  for (const foreign of [outcomeCapability, publicationCapability]) {
    const result = failedOf(issueTrustedReceipt(env.input({ capability: foreign })));
    assert.deepEqual(result, { category: 'RECEIPT-CAPABILITY-DENIED', code: 'capability.not-genuine' });
  }
  assert.equal(env.receiptRecords().length, 0);
});

test('P1B: a receipt permit minted under a foreign capability is not genuine at the sink', () => {
  const env = makeReceiptEnv();
  const foreign = createExecutionOutcomeCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'outcome-action' })!;
  const payload = { record_type: 'TrustedReceipt', record_id: 'pgw:l:' + '0'.repeat(32), created_at: '2026-08-04T06:00:00.000Z', responsible_role: 'trusted-receipt-producer' };
  const digest = computePayloadDigest(payload);
  const permit = createTrustedReceiptPermit({ capability: foreign as never, role: 'trusted-receipt-producer', recordId: payload.record_id, recordDigest: digest, canonicalBytesDigest: digest });
  assert.equal(permit, undefined, 'the permit creator only accepts a genuine receipt capability');
});

test('P1B: stale generation — genuine trusted-configuration replacement invalidates earlier capabilities', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  issuedOf(issueTrustedReceipt(env.input()));
  // Genuine replacement configuration (new configuration identity for the
  // same workspace; established makeIntegrationEnv lifecycle pattern).
  const replacement = makeIntegrationEnv();
  assert.notEqual(replacement.storeEnv.config.identity, env.integration.storeEnv.config.identity, 'the replacement configuration must have a different identity');
  const capB = createTrustedReceiptCapability({ trustedConfiguration: replacement.storeEnv.config, actionIdentity: 'receipt-action-replacement' });
  assert.ok(capB !== undefined);
  // The earlier capability is stale-generation; every mutation boundary rejects it.
  assert.deepEqual(env.capability.verify(), { ok: false, reason: 'stale-generation' });
  const stale = failedOf(issueTrustedReceipt(env.input({ capability: env.capability })));
  assert.deepEqual(stale, { category: 'RECEIPT-CAPABILITY-DENIED', code: 'capability.stale-generation' });
  // Minting under the same unchanged configuration never invalidates an
  // earlier capability (SIR-WP13C-002 semantics).
  const capC = createTrustedReceiptCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'receipt-action-c' });
  assert.ok(capC !== undefined);
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID }, capability: capC })));
  assert.equal(result.outcome, 'replayed', 'same-configuration mints share the current generation; the earlier receipt replays');
});

test('P1B: the receipt producer cannot publish another record class — sink rejects non-TrustedReceipt payloads', () => {
  const env = makeReceiptEnv();
  const capability = env.capability;
  const foreignPayload = { record_type: 'ResultPublicationRecord', record_id: 'pgw:l:' + '0'.repeat(32), created_at: '2026-08-04T06:00:00.000Z', responsible_role: 'trusted-result-publisher' };
  const digest = computePayloadDigest(foreignPayload);
  const permit = createTrustedReceiptPermit({ capability, role: 'trusted-receipt-producer', recordId: foreignPayload.record_id, recordDigest: digest, canonicalBytesDigest: digest });
  assert.ok(permit !== undefined, 'the permit is class-bound to trusted-receipt; the sink performs the class confinement');
  const result = env.boundary.publishTrustedReceipt(permit, foreignPayload);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'record.class-mismatch');
  // A SupersessionRecord-shaped payload is equally rejected.
  const supersession = { record_type: 'SupersessionRecord', record_id: 'pgw:l:' + '0'.repeat(32), created_at: '2026-08-04T06:00:00.000Z' };
  const result2 = env.boundary.publishTrustedReceipt(permit, supersession);
  assert.equal(result2.ok, false);
});

test('P1B: raw publishRecord handle is not exposed — the boundary surface is the single publish method + closed reads', () => {
  const env = makeReceiptEnv();
  const keys = Object.keys(env.boundary).sort();
  assert.deepEqual(keys, ['enumerateLifecycleRecords', 'publishTrustedReceipt', 'readLifecyclePayload']);
  assert.equal('publishRecord' in env.boundary, false);
  assert.equal('publishLifecycleRecord' in env.boundary, false);
  assert.equal('publishResultPublicationRecord' in env.boundary, false);
  // the read allowlist is closed to the §3 set: a class outside it cannot be read/enumerated
  assert.deepEqual(env.boundary.enumerateLifecycleRecords('approval-record'), { ok: false, code: 'enumerate-failed', recordIds: [] });
  assert.deepEqual(env.boundary.readLifecyclePayload('issuance-record', 'pgw:l:' + '0'.repeat(32)), { ok: false, code: 'read-failed' });
});

test('P1B: caller cannot self-assert responsible_role or provenance — closed request keys reject every authority-bearing operand', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const variants: Readonly<Record<string, unknown>>[] = [
    { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID, responsibleRole: 'trusted-receipt-producer' },
    { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID, provenance: { actionIdentity: 'x' } },
    { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID, grantValidity: true },
    { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID, revocationStatus: 'revoked' },
  ];
  for (const request of variants) {
    const result = failedOf(issueTrustedReceipt(env.input({ request: request as never })));
    assert.equal(result.category, 'RECEIPT-INPUT-INVALID');
    assert.ok(result.code.startsWith('request.unknown-key'), result.code);
  }
});

test('P1B: caller cannot inject registry_snapshot_reference — the binding derives from the host registry context only', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const injected = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID, registrySnapshotReference: { registry_snapshot_id: 'pgw:g:' + 'f'.repeat(32) } } as never })));
  assert.equal(injected.category, 'RECEIPT-INPUT-INVALID');
  const issued = issuedOf(issueTrustedReceipt(env.input()));
  const durable = env.readReceipt(issued.recordId)!;
  const registryRef = durable['registry_snapshot_reference'] as Readonly<Record<string, unknown>>;
  assert.equal(registryRef['registry_snapshot_id'], env.registryCtx.registrySnapshotId);
  assert.equal(registryRef['registry_snapshot_digest'], env.registryCtx.registrySnapshotDigest);
});

test('P1B: caller cannot inject trusted outcome/facts — eligibility is reconstructed from fresh durable state', () => {
  const env = makeReceiptEnv();
  // No outcome is seeded: the ONLY way this issuance could succeed is by
  // trusting caller-supplied outcome/facts — the closed request rejects it.
  const injected = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID, outcome: { disposition: 'completed' } } as never })));
  assert.equal(injected.category, 'RECEIPT-INPUT-INVALID');
  const injectedFacts = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID, facts: { disposition: 'completed' } } as never })));
  assert.equal(injectedFacts.category, 'RECEIPT-INPUT-INVALID');
  // Without the caller facts and with no durable outcome, the honest result
  // is terminal-unverifiable — never a fabricated receipt.
  const honest = failedOf(issueTrustedReceipt(env.input()));
  assert.deepEqual(honest, { category: 'RECEIPT-LIFECYCLE-REJECTED', code: 'eligibility.terminal-unverifiable' });
  assert.equal(env.receiptRecords().length, 0);
});

test('P1B: host composition — createReceiptProducerAuthority closes over trusted infrastructure; issue() accepts ONLY ReceiptRequest (SIR-WP15-P1B-002)', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const authority = createReceiptProducerAuthority({
    trustedConfiguration: env.integration.storeEnv.config,
    bootstrapInput: env.integration.storeEnv.bootstrapInput,
    writeAction: {
      actionIdentity: 'write-action-1',
      locator: env.integration.storeEnv.dir,
      serviceUid: process.getuid?.() ?? 0,
      forbiddenRoots: [],
      configurationIdentity: env.integration.storeEnv.config.identity,
      limitProfile: defaultLimitProfile(),
    },
    locator: env.integration.storeEnv.dir,
    serviceUid: process.getuid?.() ?? 0,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
    lockTimeSource: { now: () => 1000, processStartTime: 500 },
    schemaRegistry: createSchemaRegistry(),
    actionIdentity: 'receipt-production-action-host',
    registryProvider: () => env.registryCtx,
    identity: makeCountingReceiptIdentity(),
    coordinate: createProcessLocalCoordinator(),
  });
  assert.ok(authority !== undefined);
  // The authority surface is exactly ONE method; the holder nominates only a ReceiptRequest.
  assert.deepEqual(Object.keys(authority!), ['issue']);
  const result = issuedOf(authority!.issue(REQUEST));
  assert.equal(result.outcome, 'issued');
  assert.equal(env.receiptRecords().length, 1);
  // invalid trusted configuration → no authority
  assert.equal(createReceiptProducerAuthority({
    trustedConfiguration: { bogus: true },
    bootstrapInput: env.integration.storeEnv.bootstrapInput,
    writeAction: {
      actionIdentity: 'write-action-1',
      locator: env.integration.storeEnv.dir,
      serviceUid: process.getuid?.() ?? 0,
      forbiddenRoots: [],
      configurationIdentity: 'x',
      limitProfile: defaultLimitProfile(),
    },
    locator: env.integration.storeEnv.dir,
    serviceUid: process.getuid?.() ?? 0,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
    lockTimeSource: { now: () => 1000, processStartTime: 500 },
    schemaRegistry: createSchemaRegistry(),
    actionIdentity: 'x',
    registryProvider: () => env.registryCtx,
    identity: makeCountingReceiptIdentity(),
    coordinate: createProcessLocalCoordinator(),
  }), undefined);
});

test('P1B: SIR-002 — the issuer cannot inject registry/clock/identity/coordinator/hooks through issue()', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const authority = env.authority();
  // Trusted-context operands are not request keys: every injection attempt is
  // a closed-key rejection (typed RECEIPT-INPUT-INVALID), never honored.
  const injections: Readonly<Record<string, unknown>>[] = [
    { ...REQUEST, registry: env.registryCtx },
    { ...REQUEST, registrySnapshotReference: { registry_snapshot_id: 'pgw:g:' + 'f'.repeat(32) } },
    { ...REQUEST, identity: { nowUtcIso: () => '2026-01-01T00:00:00.000Z', newRecordId: () => 'pgw:l:' + 'f'.repeat(32) } },
    { ...REQUEST, now: '2026-01-01T00:00:00.000Z' },
    { ...REQUEST, coordinate: { withLock: () => undefined } },
    { ...REQUEST, hooks: { beforeFirstReceiptPublication: () => undefined } },
    { ...REQUEST, capability: {} },
    { ...REQUEST, store: {} },
    { ...REQUEST, schemaRegistry: {} },
    { ...REQUEST, provenance: { actionIdentity: 'x' } },
    { ...REQUEST, outcome: { disposition: 'completed' } },
  ];
  for (const request of injections) {
    const result = authority!.issue(request as never);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.category, 'RECEIPT-INPUT-INVALID', JSON.stringify(Object.keys(request)));
      // Function-valued operands (identity/coordinate/hooks) are rejected by
      // the hostile-input capture as unsupported value types; every other
      // trusted-context operand is a closed-key rejection.
      assert.ok(result.code.startsWith('request.unknown-key') || result.code === 'request.hostile-input', result.code);
    }
    assert.equal(env.receiptRecords().length, 0, 'no write for any trusted-context injection');
  }
  // The host-closed identity/clock is NOT per-call: two issuances share the
  // closed identity source (record ids accumulate on one counter).
  const secondAttemptId = 'pgw:a:' + '2'.repeat(32);
  const secondAttemptRecordId = 'pgw:l:' + 'b'.repeat(32);
  seedPayload(env.store, 'execution-attempt-record', buildExecutionAttemptRecordPayload({
    recordId: secondAttemptRecordId, createdAt: FIXED_NOW, activationRecordId: env.chain.activationRecordId,
    occurrenceId: OCCURRENCE_ID, attemptId: secondAttemptId, ordinal: 2,
    bundle: env.chain.bundleReference, workspaceId: WS_A, runtimeGrantId: env.chain.grantId, registry: env.registryCtx,
  }));
  seedOutcome(env.integration.storeEnv, expectedOutcomePayload({
    registryCtx: env.registryCtx, chain: env.chain, disposition: 'failed',
    withEnforcement: false, withAssociation: false,
    overrides: { attempt_id: secondAttemptId, execution_attempt_record_id: secondAttemptRecordId, ordinal: 2 },
  }));
  const a = issuedOf(authority!.issue(REQUEST));
  const b = issuedOf(authority!.issue({ workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: secondAttemptRecordId }));
  assert.equal(a.outcome, 'issued');
  assert.equal(b.outcome, 'issued');
  assert.equal(env.receiptRecords().length, 2, 'both issuances flow through the host-closed identity/registry/coordinator');
});

test('P1B: SIR-002 — a forged AcceptedRegistryContext-like object is rejected (committed registry brand, §8)', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  // Shape-valid but UNBRANDED snapshot: a scalar-shaped lookalike is never
  // trusted current registry state.
  const forged = {
    registryProtocolId: env.registryCtx.registryProtocolId,
    registrySnapshotFormatVersion: env.registryCtx.registrySnapshotFormatVersion,
    registrySnapshotId: env.registryCtx.registrySnapshotId,
    registrySnapshotDigest: env.registryCtx.registrySnapshotDigest,
    snapshot: { snapshot_id: env.registryCtx.registrySnapshotId, snapshot_digest: env.registryCtx.registrySnapshotDigest },
  };
  const result = failedOf(issueTrustedReceipt(env.input({ registry: forged as never })));
  assert.deepEqual(result, { category: 'RECEIPT-INPUT-INVALID', code: 'input.registry-invalid' });
  // A context missing the snapshot member entirely is equally rejected.
  const withoutSnapshot = {
    registryProtocolId: env.registryCtx.registryProtocolId,
    registrySnapshotFormatVersion: '1.0',
    registrySnapshotId: env.registryCtx.registrySnapshotId,
    registrySnapshotDigest: env.registryCtx.registrySnapshotDigest,
  };
  const result2 = failedOf(issueTrustedReceipt(env.input({ registry: withoutSnapshot as never })));
  assert.deepEqual(result2, { category: 'RECEIPT-INPUT-INVALID', code: 'input.registry-invalid' });
  assert.equal(env.receiptRecords().length, 0);
});
