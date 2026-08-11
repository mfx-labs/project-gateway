/**
 * WP-15 Phase 1B — trusted receipt producer: event matrix, fresh-state
 * verification, denied activation, replay/conflict, eligibility, audit, and
 * registry binding. Real initialized WP-8 store, real WP-12 chain, real
 * single-class receipt boundary + capability.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateLifecycleRecord, createSchemaRegistry } from '../../src/api/validate.js';
import { issueTrustedReceipt } from '../../src/receipt-production/index.js';
import { deriveReceiptDisposition } from '../../src/lifecycle/retrospective-eligibility.js';
import {
  makeReceiptEnv,
  issuedOf,
  failedOf,
  receiptCleanup,
  expectedReceiptPayload,
  seedOutcomeFor,
  seedOutcome,
  expectedOutcomePayload,
  deniedActivationPayload,
  seedValidation,
  expectedPublicationPayload,
  seedPublication,
  makeCountingReceiptIdentity,
  nextRecordId,
  WS_A,
  FIXED_NOW,
  OCCURRENCE_ID,
  ATTEMPT_ID,
  ATTEMPT_RECORD_ID,
  OCCURRENCE_RECORD_ID,
  ACTIVATION_RECORD_ID,
  GRANT_ID,
  LATER,
  PUBLICATION_RECORD_ID,
  RESULT_DIGEST,
  VALIDATION_RECORD_ID,
} from './wp15-phase1b-helpers.js';
import { seedPayload, seedRawRecord, makeRegistryContext, grantChainSubjects } from './wp12-helpers.js';
import { buildRevocationRecordPayload, buildRuntimeGrantPayload, buildActivationRecordPayload, buildExecutionOccurrenceRecordPayload, buildExecutionAttemptRecordPayload } from '../../src/control-plane/records.js';
import { createProcessLocalCoordinator } from '../../src/control-plane/coordination.js';
import type { ReceiptRequest, ReceiptStoreBoundary } from '../../src/receipt-production/types.js';

after(receiptCleanup);

/**
 * Seed a complete variant lifecycle chain (grant + activation + occurrence)
 * over a distinct occurrence identity, reusing the standard bundle subject.
 * No attempts are seeded (callers add them as needed).
 */
function seedVariantChain(env: ReturnType<typeof makeReceiptEnv>, opts: {
  readonly grantId: string;
  readonly activationId: string;
  readonly occurrenceRecordId: string;
  readonly occurrenceId: string;
  readonly attemptLimit: number;
  readonly grantReservedOccurrenceId?: string;
  /** Subject for the RuntimeGrant ONLY (activation/occurrence keep the standard bundle unless `activationSubject` is given). */
  readonly grantSubject?: Readonly<Record<string, unknown>>;
  /** Subject driving the activation + occurrence bundle (default: the standard chain bundle subject). */
  readonly activationSubject?: Readonly<Record<string, unknown>>;
}): void {
  const activationSubject = (opts.activationSubject ?? grantChainSubjects(WS_A).bundle.subject) as import('../../src/control-plane/types.js').CanonicalSubject;
  const bundle: Readonly<Record<string, unknown>> = Object.freeze({
    target_protocol_version: activationSubject.protocolVersion,
    target_kind: Object.freeze({ id: activationSubject.kindId, version: activationSubject.kindVersion }),
    target_instance_id: activationSubject.instanceId,
    target_revision_id: activationSubject.revisionId,
    target_digest: activationSubject.digest,
    target_workspace_binding: Object.freeze({ mode: 'bound', workspace_id: WS_A }),
  });
  seedPayload(env.store, 'runtime-grant', buildRuntimeGrantPayload({
    recordId: opts.grantId, createdAt: FIXED_NOW, subject: (opts.grantSubject ?? activationSubject) as import('../../src/control-plane/types.js').CanonicalSubject, workspaceId: WS_A,
    reservedOccurrenceId: opts.grantReservedOccurrenceId ?? opts.occurrenceId,
    attemptLimit: opts.attemptLimit,
    validity: { not_before: FIXED_NOW, not_after: LATER },
    narrowedConstraints: [],
    registry: env.registryCtx,
  }));
  seedPayload(env.store, 'activation-record', buildActivationRecordPayload({
    recordId: opts.activationId, createdAt: FIXED_NOW, subject: activationSubject, workspaceId: WS_A,
    requiredIssuanceRecordIds: Object.freeze([]), runtimeGrantId: opts.grantId,
    reservedOccurrenceId: opts.occurrenceId, decision: 'accepted', registry: env.registryCtx,
  }));
  seedPayload(env.store, 'execution-occurrence-record', buildExecutionOccurrenceRecordPayload({
    recordId: opts.occurrenceRecordId, createdAt: FIXED_NOW, activationRecordId: opts.activationId,
    bundle, workspaceId: WS_A, occurrenceId: opts.occurrenceId, runtimeGrantId: opts.grantId, registry: env.registryCtx,
  }));
}

/** Seed an attempt + exact outcome for a variant chain (ordinal-1 sibling optional). */
function seedVariantAttempt(env: ReturnType<typeof makeReceiptEnv>, opts: {
  readonly attemptRecordId: string;
  readonly attemptId: string;
  readonly ordinal: number;
  readonly occurrenceId: string;
  readonly activationId: string;
  readonly grantId: string;
  readonly disposition?: string;
}): void {
  seedPayload(env.store, 'execution-attempt-record', buildExecutionAttemptRecordPayload({
    recordId: opts.attemptRecordId, createdAt: FIXED_NOW, activationRecordId: opts.activationId,
    occurrenceId: opts.occurrenceId, attemptId: opts.attemptId, ordinal: opts.ordinal,
    bundle: env.chain.bundleReference, workspaceId: WS_A, runtimeGrantId: opts.grantId, registry: env.registryCtx,
  }));
  seedOutcome(env.integration.storeEnv, expectedOutcomePayload({
    registryCtx: env.registryCtx, chain: env.chain, disposition: opts.disposition ?? 'completed',
    withEnforcement: false, withAssociation: false,
    overrides: {
      occurrence_id: opts.occurrenceId,
      attempt_id: opts.attemptId,
      execution_attempt_record_id: opts.attemptRecordId,
      ordinal: opts.ordinal,
    },
  }));
}

const schemaRegistry = createSchemaRegistry();

function schemaValid(payload: Readonly<Record<string, unknown>>): boolean {
  const gate = validateLifecycleRecord(payload, schemaRegistry);
  return gate.ok === true && gate.value !== undefined;
}

// ─── activation-decision ────────────────────────────────────────────────────

test('P1B: activation accepted — receipt issued with exact reserved occurrence, attempt null, audit present', () => {
  const env = makeReceiptEnv();
  const identity = makeCountingReceiptIdentity();
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'activation-decision', eventRecordId: ACTIVATION_RECORD_ID }, identity })));
  assert.equal(result.outcome, 'issued');
  assert.ok(result.auditEventId !== undefined, 'a successful durable write must carry the D-6 authorized-write audit identity');
  const records = env.receiptRecords();
  assert.equal(records.length, 1);
  const durable = records[0]!;
  assert.equal(durable['record_id'], result.recordId);
  assert.equal(durable['responsible_role'], 'trusted-receipt-producer');
  assert.equal(durable['event_type'], 'activation-decision');
  assert.equal(durable['event_record_id'], ACTIVATION_RECORD_ID);
  assert.equal(durable['workspace_id'], WS_A);
  assert.equal(durable['disposition'], 'accepted');
  assert.equal(durable['occurrence_id'], OCCURRENCE_ID, 'accepted activation binds the exact reserved occurrence');
  assert.equal(durable['attempt_id'], null);
  assert.equal(schemaValid(durable), true);
  // registry binding derives from the host-supplied current context (never caller-supplied)
  const registryRef = durable['registry_snapshot_reference'] as Readonly<Record<string, unknown>>;
  assert.equal(registryRef['registry_snapshot_id'], env.registryCtx.registrySnapshotId);
  // opaque identity minted exactly once in the no-claimant branch
  assert.equal(identity.calls.recordId, 1);
});

test('P1B: activation denied — receipt issued with occurrence/attempt ABSENT, disposition denied', () => {
  const env = makeReceiptEnv();
  const deniedId = 'pgw:l:' + 'd'.repeat(32);
  seedPayload(env.store, 'activation-record', deniedActivationPayload(deniedId));
  const request: ReceiptRequest = { workspaceId: WS_A, eventType: 'activation-decision', eventRecordId: deniedId };
  const result = issuedOf(issueTrustedReceipt(env.input({ request })));
  assert.equal(result.outcome, 'issued');
  const records = env.receiptRecords();
  assert.equal(records.length, 1);
  const durable = records[0]!;
  assert.equal(durable['disposition'], 'denied');
  // A1 absent-only semantics: the keys must NOT exist (never null, never fabricated)
  assert.equal('occurrence_id' in durable, false, 'denied-activation receipt must not carry occurrence_id');
  assert.equal('attempt_id' in durable, false, 'denied-activation receipt must not carry attempt_id');
  assert.equal(schemaValid(durable), true, 'the denied-activation receipt must be schema-valid under the A1 if/then');
  assert.equal(durable['event_record_id'], deniedId);
});

// ─── occurrence-start + occurrence-level cancellation ───────────────────────

test('P1B: occurrence-start — receipt issued with disposition started, attempt null', () => {
  const env = makeReceiptEnv();
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'occurrence-start', eventRecordId: OCCURRENCE_RECORD_ID } })));
  assert.equal(result.outcome, 'issued');
  const durable = env.readReceipt(result.recordId)!;
  assert.equal(durable['disposition'], 'started');
  assert.equal(durable['occurrence_id'], OCCURRENCE_ID);
  assert.equal(durable['attempt_id'], null);
  assert.equal(schemaValid(durable), true);
});

test('P1B: cancellation occurrence-level — receipt issued with disposition cancelled, attempt null', () => {
  const env = makeReceiptEnv();
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'cancellation', eventRecordId: OCCURRENCE_RECORD_ID } })));
  assert.equal(result.outcome, 'issued');
  const durable = env.readReceipt(result.recordId)!;
  assert.equal(durable['disposition'], 'cancelled');
  assert.equal(durable['occurrence_id'], OCCURRENCE_ID);
  assert.equal(durable['attempt_id'], null);
});

// ─── attempt-correlated retrospective events ────────────────────────────────

test('P1B: attempt-start — receipt issued with disposition started after exact outcome coverage', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-start', eventRecordId: ATTEMPT_RECORD_ID } })));
  const durable = env.readReceipt(result.recordId)!;
  assert.equal(durable['disposition'], 'started');
  assert.equal(durable['occurrence_id'], OCCURRENCE_ID);
  assert.equal(durable['attempt_id'], ATTEMPT_ID);
});

test('P1B: attempt-end — one-to-one disposition for all seven committed outcomes (no lossy mapping)', () => {
  const dispositions = ['completed', 'failed', 'cancelled', 'timed-out', 'crashed', 'incomplete', 'rejected'] as const;
  for (const disposition of dispositions) {
    const env = makeReceiptEnv();
    seedOutcomeFor(env, disposition);
    const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID } })));
    const durable = env.readReceipt(result.recordId)!;
    assert.equal(durable['disposition'], disposition, `attempt-end must preserve ${disposition} exactly`);
    assert.equal(schemaValid(durable), true);
  }
});

test('P1B: enforcement-denial — receipt disposition denied over a rejected outcome with the committed enforcement evidence', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'rejected', { withEnforcement: true });
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'enforcement-denial', eventRecordId: ATTEMPT_RECORD_ID } })));
  const durable = env.readReceipt(result.recordId)!;
  assert.equal(durable['disposition'], 'denied', 'the enforcement-denial event keeps its event-specific denied disposition');
  assert.equal(durable['occurrence_id'], OCCURRENCE_ID);
  assert.equal(durable['attempt_id'], ATTEMPT_ID);
});

test('P1B: cancellation attempt-level — receipt disposition cancelled over a cancelled outcome', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'cancelled');
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'cancellation', eventRecordId: ATTEMPT_RECORD_ID } })));
  const durable = env.readReceipt(result.recordId)!;
  assert.equal(durable['disposition'], 'cancelled');
  assert.equal(durable['occurrence_id'], OCCURRENCE_ID);
  assert.equal(durable['attempt_id'], ATTEMPT_ID);
});

test('P1B: timeout — receipt disposition timed-out over a timed-out outcome', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'timed-out');
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'timeout', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(env.readReceipt(result.recordId)!['disposition'], 'timed-out');
});

test('P1B: crash — receipt disposition crashed over a crashed outcome', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'crashed');
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'crash', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(env.readReceipt(result.recordId)!['disposition'], 'crashed');
});

// ─── result-publication-correlation (§19) ───────────────────────────────────

test('P1B: result-publication-correlation — receipt issued with disposition completed; publication stays ordinary-review', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed', { withAssociation: true });
  seedValidation(env.store, env.registryCtx);
  seedPublication(env.integration.storeEnv, expectedPublicationPayload(env.registryCtx, env.chain));
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'result-publication-correlation', eventRecordId: PUBLICATION_RECORD_ID } })));
  const durable = env.readReceipt(result.recordId)!;
  assert.equal(durable['disposition'], 'completed');
  assert.equal(durable['occurrence_id'], OCCURRENCE_ID);
  assert.equal(durable['attempt_id'], ATTEMPT_ID);
  // §19: the publication remains ordinary-review; no successor record, no
  // receipt_correlations mutation, no SupersessionRecord.
  const pubRead = env.boundary.readLifecyclePayload('result-publication-record', PUBLICATION_RECORD_ID);
  assert.equal(pubRead.ok, true);
  if (pubRead.ok && pubRead.payload !== undefined) {
    assert.deepEqual(pubRead.payload['publication_scopes'], ['ordinary-review']);
    assert.deepEqual(pubRead.payload['receipt_correlations'], []);
    assert.equal(pubRead.payload['record_type'], 'ResultPublicationRecord');
  }
});

// ─── replay / conflict (§13) ────────────────────────────────────────────────

test('P1B: replay after cold read — exactly one materially identical durable receipt returns replayed with zero allocation/write/audit', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const request: ReceiptRequest = { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID };
  const seededId = seedRawRecord(env.integration.storeEnv, 'trusted-receipt', expectedReceiptPayload(env.registryCtx, request, 'completed', OCCURRENCE_ID, ATTEMPT_ID, nextRecordId(), FIXED_NOW));
  const identity = makeCountingReceiptIdentity();
  const result = issuedOf(issueTrustedReceipt(env.input({ request, identity })));
  assert.equal(result.outcome, 'replayed');
  assert.equal(result.recordId, seededId, 'the existing durable identity is returned');
  assert.equal(result.auditEventId, undefined, 'an exact replay with no new write must not emit a successful-write audit');
  assert.equal(identity.calls.recordId, 0, 'zero new IDs on replay');
  assert.equal(env.receiptPublishCount(), 0, 'zero durable writes on replay');
  assert.equal(env.receiptRecords().length, 1);
});

test('P1B: materially divergent durable receipt — typed conflict, no write', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const request: ReceiptRequest = { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID };
  env.seedReceipt(expectedReceiptPayload(env.registryCtx, request, 'crashed', OCCURRENCE_ID, ATTEMPT_ID, nextRecordId(), FIXED_NOW));
  const identity = makeCountingReceiptIdentity();
  const result = failedOf(issueTrustedReceipt(env.input({ request, identity })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'conflict.material-divergence');
  assert.equal(identity.calls.recordId, 0);
  assert.equal(env.receiptPublishCount(), 0);
  assert.equal(env.receiptRecords().length, 1, 'no second receipt may be written');
});

test('P1B: multiple claimants — fail closed as conflict/corruption; no newest/timestamp winner', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const request: ReceiptRequest = { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID };
  env.seedReceipt(expectedReceiptPayload(env.registryCtx, request, 'completed', OCCURRENCE_ID, ATTEMPT_ID, nextRecordId(), FIXED_NOW));
  env.seedReceipt(expectedReceiptPayload(env.registryCtx, request, 'completed', OCCURRENCE_ID, ATTEMPT_ID, nextRecordId(), FIXED_NOW));
  const identity = makeCountingReceiptIdentity();
  const result = failedOf(issueTrustedReceipt(env.input({ request, identity })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'conflict.multiple-claimants');
  assert.equal(identity.calls.recordId, 0);
  assert.equal(env.receiptRecords().length, 2, 'historical receipts are never erased to resolve a conflict');
});

test('P1B: schema-invalid durable claimant — materially-exact but invalid created_at fails closed as corrupt (never replayed)', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const request: ReceiptRequest = { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID };
  // All material fields exact; schema-invalid ONLY in created_at (excluded
  // from material comparison — the record_id/created_at keys are skipped, so
  // a naive material-only check would admit this claimant as a replay).
  env.seedReceipt(expectedReceiptPayload(env.registryCtx, request, 'completed', OCCURRENCE_ID, ATTEMPT_ID, nextRecordId(), 'not-a-timestamp'));
  const identity = makeCountingReceiptIdentity();
  const result = failedOf(issueTrustedReceipt(env.input({ request, identity })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'state.receipt-corrupt', 'a schema-invalid durable claimant must never be admitted as a replay');
  assert.equal(identity.calls.recordId, 0);
  assert.equal(env.receiptPublishCount(), 0);
  assert.equal(env.receiptRecords().length, 1, 'the invalid claimant stays; no second receipt is written');
});

// ─── invalid / ineligible variants (§22) ────────────────────────────────────

test('P1B: wrong source class — activation-decision over an attempt identity is invalid-event-source', () => {
  const env = makeReceiptEnv();
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'activation-decision', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(result.category, 'RECEIPT-LIFECYCLE-REJECTED');
  assert.equal(result.code, 'event.source-missing');
});

test('P1B: wrong bindings — nominated workspace diverges from the source record', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: 'pgw:w:' + 'f'.repeat(32), eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(result.category, 'RECEIPT-INPUT-INVALID');
  assert.equal(result.code, 'request.workspace-mismatch');
});

test('P1B: zero outcome — terminal-unverifiable; receipt-ineligible (valid lifecycle state, no fabrication)', () => {
  const env = makeReceiptEnv();
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(result.category, 'RECEIPT-LIFECYCLE-REJECTED');
  assert.equal(result.code, 'eligibility.terminal-unverifiable');
  assert.equal(env.receiptRecords().length, 0);
});

test('P1B: conflicting outcome state — two exact outcomes fail closed', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  seedOutcomeFor(env, 'failed');
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'state.outcome-conflict');
});

test('P1B: malformed outcome state — misanchored singleton outcome fails closed', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed', { overrides: { execution_attempt_record_id: 'pgw:l:' + 'e'.repeat(32) } });
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'state.outcome-malformed');
});

test('P1B: wrong disposition source state — enforcement-denial over a completed outcome fails closed', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed', { withEnforcement: true });
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'enforcement-denial', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'state.disposition-divergence');
});

test('P1B: missing enforcement evidence — rejected outcome without the committed evidence group fails closed', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'rejected', { withEnforcement: false });
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'enforcement-denial', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'state.disposition-divergence');
});

test('P1B: correlation receipt — missing exact publication context fails closed', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed', { withAssociation: true });
  seedValidation(env.store, env.registryCtx);
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'result-publication-correlation', eventRecordId: PUBLICATION_RECORD_ID } })));
  assert.equal(result.category, 'RECEIPT-LIFECYCLE-REJECTED');
  assert.equal(result.code, 'event.source-missing');
});

test('P1B: correlation receipt — divergent result association fails closed (shared retrospective correlation path)', () => {
  const env = makeReceiptEnv();
  // The divergent association cannot match the durable ValidationRecord, so
  // the committed shared retrospective path itself fails closed as
  // conflicting durable state (never a correlation receipt).
  seedOutcomeFor(env, 'completed', { withAssociation: true, overrides: { result_association: { instance_id: 'pgw:i:' + 'b'.repeat(32), revision_digest: RESULT_DIGEST, association_mode: 'adopted', validation_record_id: VALIDATION_RECORD_ID } } });
  seedValidation(env.store, env.registryCtx);
  seedPublication(env.integration.storeEnv, expectedPublicationPayload(env.registryCtx, env.chain));
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'result-publication-correlation', eventRecordId: PUBLICATION_RECORD_ID } })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'state.retrospective-path-failed');
  assert.equal(env.receiptRecords().length, 0);
});

test('P1B: unknown event type — invalid request, never a write', () => {
  const env = makeReceiptEnv();
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'bogus-event', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(result.category, 'RECEIPT-LIFECYCLE-REJECTED');
  assert.equal(result.code, 'event.type-unknown');
  assert.equal(env.receiptRecords().length, 0);
});

// ─── request boundary (§4) ─────────────────────────────────────────────────

test('P1B: caller cannot nominate any trusted fact — closed request keys', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const extraKeyRequests: Readonly<Record<string, unknown>>[] = [
    { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID, disposition: 'completed' },
    { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID, registrySnapshotReference: {} },
    { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID, receipt: { record_type: 'TrustedReceipt' } },
    { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID, outcome: {} },
    { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID, facts: {} },
    { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID, responsibleRole: 'trusted-receipt-producer' },
  ];
  for (const request of extraKeyRequests) {
    const result = failedOf(issueTrustedReceipt(env.input({ request: request as unknown as ReceiptRequest })));
    assert.equal(result.category, 'RECEIPT-INPUT-INVALID');
    assert.ok(result.code.startsWith('request.unknown-key'), result.code);
    assert.equal(env.receiptRecords().length, 0, 'no write for any closed-key violation');
  }
  // unknown input-level operands also fail closed
  const inputResult = failedOf(issueTrustedReceipt(env.input({ outcome: {} } as unknown as Partial<import('../../src/receipt-production/types.js').ReceiptInput>)));
  assert.equal(inputResult.category, 'RECEIPT-INPUT-INVALID');
  assert.equal(inputResult.code, 'input.unknown-key');
});

test('P1B: malformed request shapes fail closed as invalid-request', () => {
  const env = makeReceiptEnv();
  const cases: unknown[] = [
    undefined,
    {},
    { workspaceId: 'not-an-id', eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID },
    { workspaceId: WS_A, eventType: '', eventRecordId: ATTEMPT_RECORD_ID },
    { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: 'not-an-id' },
  ];
  for (const request of cases) {
    const result = failedOf(issueTrustedReceipt(env.input({ request: request as never })));
    assert.equal(result.category, 'RECEIPT-INPUT-INVALID');
  }
});

test('P1B: registry context is host-supplied and shape-gated; a malformed context is invalid-request', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const bad = failedOf(issueTrustedReceipt(env.input({ registry: { registryProtocolId: 'x' } as never })));
  assert.equal(bad.category, 'RECEIPT-INPUT-INVALID');
  assert.equal(bad.code, 'input.registry-invalid');
});

// ─── authority/revocation currentness (§7) ─────────────────────────────────

test('P1B: revoked grant — current revocation state rejects issuance; authority is never inferred from history', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  seedPayload(env.store, 'revocation-record', buildRevocationRecordPayload({
    recordId: nextRecordId(), createdAt: FIXED_NOW, targetRecordType: 'RuntimeGrant', targetRecordId: GRANT_ID,
    scope: 'execution-use', effectiveAt: FIXED_NOW, reasonCode: 'revoked-for-test', registry: makeRegistryContext(),
  }));
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(result.category, 'RECEIPT-LIFECYCLE-REJECTED');
  assert.equal(result.code, 'lifecycle.grant-revoked');
  assert.equal(env.receiptRecords().length, 0);
});

test('P1B: expired grant validity — issuance fails closed when the current trusted time is outside the window', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const afterExpiry = '2026-08-06T06:00:00.000Z';
  assert.ok(afterExpiry > LATER);
  const result = failedOf(issueTrustedReceipt(env.input({
    request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID },
    identity: makeCountingReceiptIdentity(afterExpiry),
  })));
  assert.equal(result.category, 'RECEIPT-LIFECYCLE-REJECTED');
  assert.equal(result.code, 'lifecycle.grant-expired');
  assert.equal(env.receiptRecords().length, 0);
});

test('P1B: denied activation requires NO live grant — a historical denial stays issuable', () => {
  const env = makeReceiptEnv();
  const deniedId = 'pgw:l:' + 'd'.repeat(32);
  seedPayload(env.store, 'activation-record', deniedActivationPayload(deniedId));
  // Revoke the grant the denied activation references: the denial receipt is
  // a fact about the decision, not an exercise of authority.
  seedPayload(env.store, 'revocation-record', buildRevocationRecordPayload({
    recordId: nextRecordId(), createdAt: FIXED_NOW, targetRecordType: 'RuntimeGrant', targetRecordId: GRANT_ID,
    scope: 'execution-use', effectiveAt: FIXED_NOW, reasonCode: 'revoked-for-test', registry: makeRegistryContext(),
  }));
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'activation-decision', eventRecordId: deniedId } })));
  assert.equal(result.outcome, 'issued');
  assert.equal(env.readReceipt(result.recordId)!['disposition'], 'denied');
});

// ─── SIR-WP15-P1B-001 — collision reread gate ──────────────────────────────

test('SIR-P1B-001: malformed collision reread — class/role/schema gates fire before JCS; typed corrupt, no throw escapes', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  // A durable receipt for ANOTHER event subject sharing the identity the
  // (broken) identity source will mint next; schema-invalid ONLY in
  // created_at — exactly the field excluded from material comparison.
  const collidingId = 'pgw:l:' + 'a1'.repeat(16);
  env.seedReceipt(expectedReceiptPayload(env.registryCtx, { workspaceId: WS_A, eventType: 'occurrence-start', eventRecordId: OCCURRENCE_RECORD_ID }, 'started', OCCURRENCE_ID, undefined, collidingId, 'not-a-timestamp'));
  const identity = {
    nowUtcIso: () => FIXED_NOW,
    newRecordId: () => collidingId,
  };
  const result = issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID }, identity }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.category, 'RECEIPT-CONFLICT', 'the malformed collision must be a typed corrupt/conflict result — never a JCS throw escaping as internal failure');
    assert.equal(result.code, 'state.receipt-corrupt');
  }
  assert.equal(env.receiptRecords().length, 1, 'no second receipt written');
});

test('SIR-P1B-001: schema-valid divergent collision reread — typed durable-record conflict', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const collidingId = 'pgw:l:' + 'a2'.repeat(16);
  env.seedReceipt(expectedReceiptPayload(env.registryCtx, { workspaceId: WS_A, eventType: 'occurrence-start', eventRecordId: OCCURRENCE_RECORD_ID }, 'started', OCCURRENCE_ID, undefined, collidingId, FIXED_NOW));
  const identity = {
    nowUtcIso: () => FIXED_NOW,
    newRecordId: () => collidingId,
  };
  const result = issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID }, identity }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.category, 'RECEIPT-CONFLICT');
    assert.equal(result.code, 'conflict.durable-record');
  }
  assert.equal(env.receiptRecords().length, 1);
});

// ─── SIR-WP15-P1B-003 — exact current chain ────────────────────────────────

test('SIR-P1B-003: duplicate valid-looking occurrences — exact cardinality fails closed (no first-match)', () => {
  const env = makeReceiptEnv();
  const dupOccurrenceRecordId = 'pgw:l:' + 'b1'.repeat(16);
  seedPayload(env.store, 'execution-occurrence-record', buildExecutionOccurrenceRecordPayload({
    recordId: dupOccurrenceRecordId, createdAt: FIXED_NOW, activationRecordId: ACTIVATION_RECORD_ID,
    bundle: env.chain.bundleReference, workspaceId: WS_A, occurrenceId: OCCURRENCE_ID, runtimeGrantId: GRANT_ID, registry: env.registryCtx,
  }));
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'activation-decision', eventRecordId: ACTIVATION_RECORD_ID } })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'state.occurrence-ambiguous');
  assert.equal(env.receiptRecords().length, 0);
});

test('SIR-P1B-003: one exact + one divergent occurrence claimant — ambiguous, fail closed', () => {
  const env = makeReceiptEnv();
  // Same occurrence/workspace/bundle but a DIFFERENT activation binding:
  // a divergent claimant of the exact occurrence.
  const otherActivationId = 'pgw:l:' + 'b2'.repeat(16);
  seedPayload(env.store, 'execution-occurrence-record', buildExecutionOccurrenceRecordPayload({
    recordId: 'pgw:l:' + 'b3'.repeat(16), createdAt: FIXED_NOW, activationRecordId: otherActivationId,
    bundle: env.chain.bundleReference, workspaceId: WS_A, occurrenceId: OCCURRENCE_ID, runtimeGrantId: GRANT_ID, registry: env.registryCtx,
  }));
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'activation-decision', eventRecordId: ACTIVATION_RECORD_ID } })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'state.occurrence-ambiguous');
});

test('SIR-P1B-003: wrong reservation — no occurrence for the reserved identity is lifecycle-rejected', () => {
  const env = makeReceiptEnv();
  const activationId = 'pgw:l:' + 'b4'.repeat(16);
  seedPayload(env.store, 'activation-record', buildActivationRecordPayload({
    recordId: activationId, createdAt: FIXED_NOW, subject: grantChainSubjects(WS_A).bundle.subject, workspaceId: WS_A,
    requiredIssuanceRecordIds: Object.freeze([]), runtimeGrantId: GRANT_ID,
    reservedOccurrenceId: 'pgw:o:' + 'f'.repeat(32), decision: 'accepted', registry: env.registryCtx,
  }));
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'activation-decision', eventRecordId: activationId } })));
  assert.equal(result.category, 'RECEIPT-LIFECYCLE-REJECTED');
  assert.equal(result.code, 'lifecycle.occurrence-missing');
});

test('SIR-P1B-003: divergent occurrence bundle — single claimant is malformed, fail closed', () => {
  const env = makeReceiptEnv();
  const activationId = 'pgw:l:' + 'b5'.repeat(16);
  const occId = 'pgw:o:' + 'b6'.repeat(16);
  // Activation binds the standard bundle; the occurrence claims the same
  // activation/occurrence but a divergent bundle.
  seedPayload(env.store, 'activation-record', buildActivationRecordPayload({
    recordId: activationId, createdAt: FIXED_NOW, subject: grantChainSubjects(WS_A).bundle.subject, workspaceId: WS_A,
    requiredIssuanceRecordIds: Object.freeze([]), runtimeGrantId: GRANT_ID,
    reservedOccurrenceId: occId, decision: 'accepted', registry: env.registryCtx,
  }));
  const divergentBundle: Readonly<Record<string, unknown>> = Object.freeze({
    ...env.chain.bundleReference,
    target_instance_id: 'pgw:i:' + 'f'.repeat(32),
  });
  seedPayload(env.store, 'execution-occurrence-record', buildExecutionOccurrenceRecordPayload({
    recordId: 'pgw:l:' + 'b7'.repeat(16), createdAt: FIXED_NOW, activationRecordId: activationId,
    bundle: divergentBundle, workspaceId: WS_A, occurrenceId: occId, runtimeGrantId: GRANT_ID, registry: env.registryCtx,
  }));
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'activation-decision', eventRecordId: activationId } })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'state.occurrence-malformed');
});

test('SIR-P1B-003: wrong activation binding on the occurrence — malformed, fail closed', () => {
  const env = makeReceiptEnv();
  const activationId = 'pgw:l:' + 'b8'.repeat(16);
  const otherActivationId = 'pgw:l:' + 'b9'.repeat(16);
  const occId = 'pgw:o:' + 'ba'.repeat(16);
  seedPayload(env.store, 'activation-record', buildActivationRecordPayload({
    recordId: activationId, createdAt: FIXED_NOW, subject: grantChainSubjects(WS_A).bundle.subject, workspaceId: WS_A,
    requiredIssuanceRecordIds: Object.freeze([]), runtimeGrantId: GRANT_ID,
    reservedOccurrenceId: occId, decision: 'accepted', registry: env.registryCtx,
  }));
  // The occurrence carries the exact occurrence/bundle but references a
  // DIFFERENT activation record.
  seedPayload(env.store, 'execution-occurrence-record', buildExecutionOccurrenceRecordPayload({
    recordId: 'pgw:l:' + 'bb'.repeat(16), createdAt: FIXED_NOW, activationRecordId: otherActivationId,
    bundle: env.chain.bundleReference, workspaceId: WS_A, occurrenceId: occId, runtimeGrantId: GRANT_ID, registry: env.registryCtx,
  }));
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'activation-decision', eventRecordId: activationId } })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'state.occurrence-malformed');
});

test('SIR-P1B-003: unrelated RuntimeGrant — attempt referencing a grant the activation does not bind is chain-divergent', () => {
  const env = makeReceiptEnv();
  const unrelatedGrantId = 'pgw:l:' + 'bc'.repeat(16);
  seedPayload(env.store, 'runtime-grant', buildRuntimeGrantPayload({
    recordId: unrelatedGrantId, createdAt: FIXED_NOW, subject: grantChainSubjects(WS_A).bundle.subject, workspaceId: WS_A,
    reservedOccurrenceId: OCCURRENCE_ID, attemptLimit: 3,
    validity: { not_before: FIXED_NOW, not_after: LATER },
    narrowedConstraints: [],
    registry: env.registryCtx,
  }));
  const attemptRecordId = 'pgw:l:' + 'bd'.repeat(16);
  const attemptId = 'pgw:a:' + 'be'.repeat(16);
  seedPayload(env.store, 'execution-attempt-record', buildExecutionAttemptRecordPayload({
    recordId: attemptRecordId, createdAt: FIXED_NOW, activationRecordId: ACTIVATION_RECORD_ID,
    occurrenceId: OCCURRENCE_ID, attemptId, ordinal: 2,
    bundle: env.chain.bundleReference, workspaceId: WS_A, runtimeGrantId: unrelatedGrantId, registry: env.registryCtx,
  }));
  seedOutcome(env.integration.storeEnv, expectedOutcomePayload({
    registryCtx: env.registryCtx, chain: env.chain, disposition: 'failed',
    withEnforcement: false, withAssociation: false,
    overrides: { attempt_id: attemptId, execution_attempt_record_id: attemptRecordId, ordinal: 2 },
  }));
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: attemptRecordId } })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'state.activation-grant-divergence');
});

test('SIR-P1B-003: grant reservation mismatch — chain-divergent, fail closed', () => {
  const env = makeReceiptEnv();
  const grantId = 'pgw:l:' + 'bf'.repeat(16);
  const activationId = 'pgw:l:' + 'c1'.repeat(16);
  const occId = 'pgw:o:' + 'c2'.repeat(16);
  // Grant reserved a DIFFERENT occurrence than the chain's.
  seedVariantChain(env, { grantId, activationId, occurrenceRecordId: 'pgw:l:' + 'c3'.repeat(16), occurrenceId: occId, attemptLimit: 3, grantReservedOccurrenceId: 'pgw:o:' + 'c4'.repeat(16) });
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'activation-decision', eventRecordId: activationId } })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'state.grant-reservation-divergence');
});

test('SIR-P1B-003: grant bundle mismatch — chain-divergent, fail closed', () => {
  const env = makeReceiptEnv();
  const grantId = 'pgw:l:' + 'c5'.repeat(16);
  const activationId = 'pgw:l:' + 'c6'.repeat(16);
  const occId = 'pgw:o:' + 'c7'.repeat(16);
  const divergentSubject: Readonly<Record<string, unknown>> = Object.freeze({
    ...grantChainSubjects(WS_A).bundle.subject,
    instanceId: 'pgw:i:' + 'f'.repeat(32),
  });
  seedVariantChain(env, { grantId, activationId, occurrenceRecordId: 'pgw:l:' + 'c8'.repeat(16), occurrenceId: occId, attemptLimit: 3, grantSubject: divergentSubject });
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'activation-decision', eventRecordId: activationId } })));
  assert.equal(result.category, 'RECEIPT-CONFLICT');
  assert.equal(result.code, 'state.grant-bundle-divergence');
});

test('SIR-P1B-003: exceeded attempt allowance — ordinal beyond the grant limit is rejected (committed EXE-005 comparison)', () => {
  const env = makeReceiptEnv();
  const grantId = 'pgw:l:' + 'c9'.repeat(16);
  const activationId = 'pgw:l:' + 'ca'.repeat(16);
  const occId = 'pgw:o:' + 'cb'.repeat(16);
  seedVariantChain(env, { grantId, activationId, occurrenceRecordId: 'pgw:l:' + 'cc'.repeat(16), occurrenceId: occId, attemptLimit: 1 });
  // ordinal-1 sibling attempt (required by the shared retrospective path),
  // then the ordinal-2 attempt: 2 > attempt_limit 1 → rejected.
  seedVariantAttempt(env, { attemptRecordId: 'pgw:l:' + 'cd'.repeat(16), attemptId: 'pgw:a:' + 'ce'.repeat(16), ordinal: 1, occurrenceId: occId, activationId, grantId });
  const attemptRecordId = 'pgw:l:' + 'cf'.repeat(16);
  const attemptId = 'pgw:a:' + 'd1'.repeat(16);
  seedVariantAttempt(env, { attemptRecordId, attemptId, ordinal: 2, occurrenceId: occId, activationId, grantId });
  const result = failedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: attemptRecordId } })));
  assert.equal(result.category, 'RECEIPT-LIFECYCLE-REJECTED');
  assert.equal(result.code, 'lifecycle.attempt-allowance-exceeded');
  assert.equal(env.receiptRecords().length, 0);
});

test('SIR-P1B-003: boundary allowed ordinal — ordinal equal to the grant limit issues', () => {
  const env = makeReceiptEnv();
  const grantId = 'pgw:l:' + 'd2'.repeat(16);
  const activationId = 'pgw:l:' + 'd3'.repeat(16);
  const occId = 'pgw:o:' + 'd4'.repeat(16);
  seedVariantChain(env, { grantId, activationId, occurrenceRecordId: 'pgw:l:' + 'd5'.repeat(16), occurrenceId: occId, attemptLimit: 2 });
  seedVariantAttempt(env, { attemptRecordId: 'pgw:l:' + 'd6'.repeat(16), attemptId: 'pgw:a:' + 'd7'.repeat(16), ordinal: 1, occurrenceId: occId, activationId, grantId });
  const attemptRecordId = 'pgw:l:' + 'd8'.repeat(16);
  const attemptId = 'pgw:a:' + 'd9'.repeat(16);
  seedVariantAttempt(env, { attemptRecordId, attemptId, ordinal: 2, occurrenceId: occId, activationId, grantId });
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: attemptRecordId } })));
  assert.equal(result.outcome, 'issued');
  assert.equal(env.readReceipt(result.recordId)!['disposition'], 'completed');
});

test('SIR-P1B-003: future revocation — not applicable before effective_at', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  seedPayload(env.store, 'revocation-record', buildRevocationRecordPayload({
    recordId: nextRecordId(), createdAt: FIXED_NOW, targetRecordType: 'RuntimeGrant', targetRecordId: GRANT_ID,
    scope: 'all-uses', effectiveAt: LATER, reasonCode: 'future-revocation', registry: makeRegistryContext(),
  }));
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(result.outcome, 'issued', 'a future-dated revocation must not invalidate the chain before effective_at');
});

test('SIR-P1B-003: wrong-type revocation — a same-ID different-class target never invalidates the grant', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  seedPayload(env.store, 'revocation-record', buildRevocationRecordPayload({
    recordId: nextRecordId(), createdAt: FIXED_NOW, targetRecordType: 'ApprovalRecord', targetRecordId: GRANT_ID,
    scope: 'all-uses', effectiveAt: FIXED_NOW, reasonCode: 'wrong-type-revocation', registry: makeRegistryContext(),
  }));
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(result.outcome, 'issued', 'a revocation of another record class must not invalidate the RuntimeGrant');
});

test('SIR-P1B-003: out-of-scope revocation — a revocation of an unrelated grant does not invalidate the chain', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const otherGrantId = 'pgw:l:' + 'da'.repeat(16);
  seedPayload(env.store, 'revocation-record', buildRevocationRecordPayload({
    recordId: nextRecordId(), createdAt: FIXED_NOW, targetRecordType: 'RuntimeGrant', targetRecordId: otherGrantId,
    scope: 'all-uses', effectiveAt: FIXED_NOW, reasonCode: 'other-grant-revocation', registry: makeRegistryContext(),
  }));
  const result = issuedOf(issueTrustedReceipt(env.input({ request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(result.outcome, 'issued', 'a revocation of an unrelated authority must not invalidate the chain');
});

test('SIR-P1B-003: revocation enumeration failure — fail closed as state-unverifiable', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const failingBoundary: ReceiptStoreBoundary = {
    ...env.boundary,
    enumerateLifecycleRecords(recordClass) {
      if (recordClass === 'revocation-record') return { ok: false, code: 'enumerate-failed', recordIds: [] };
      return env.boundary.enumerateLifecycleRecords(recordClass);
    },
  };
  const result = failedOf(issueTrustedReceipt(env.input({ store: failingBoundary, request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID } })));
  assert.equal(result.category, 'RECEIPT-STATE-UNVERIFIABLE');
  assert.equal(result.code, 'state.revocation-enumerate-failed');
  assert.equal(env.receiptRecords().length, 0);
});

// ─── SIR-WP15-P1B-004 — hostile input capture ──────────────────────────────

test('SIR-P1B-004: hostile request objects fail closed as typed invalid-request (no untyped exception escapes)', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const hostileRequests: unknown[] = [
    // getter field (accessor descriptor — never invoked)
    { get workspaceId() { return WS_A; }, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID },
    // inherited required fields (non-plain prototype — never satisfies)
    Object.create({ workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID }),
    // throwing ownKeys Proxy
    new Proxy({}, { ownKeys() { throw new Error('ownKeys boom'); } }),
    // throwing getOwnPropertyDescriptor Proxy
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('gopd boom'); } }),
    // revoked Proxy
    (() => { const r = Proxy.revocable({ workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID }, {}); r.revoke(); return r.proxy; })(),
    // extra property
    { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID, disposition: 'completed' },
    // missing own property
    { workspaceId: WS_A, eventType: 'attempt-end' },
  ];
  for (const [index, request] of hostileRequests.entries()) {
    const result = failedOf(issueTrustedReceipt(env.input({ request: request as never })));
    assert.equal(result.category, 'RECEIPT-INPUT-INVALID', `hostile request #${index}`);
    assert.equal(env.receiptRecords().length, 0, `no write for hostile request #${index}`);
  }
});

// ─── SIR-WP15-P1B-005 — single disposition authority ───────────────────────

test('SIR-P1B-005: Phase 1A deriveReceiptDisposition is the single authoritative derivation matrix', () => {
  const acceptedActivation = buildActivationRecordPayload({
    recordId: 'pgw:l:' + 'dc'.repeat(16), createdAt: FIXED_NOW, subject: grantChainSubjects(WS_A).bundle.subject, workspaceId: WS_A,
    requiredIssuanceRecordIds: Object.freeze([]), runtimeGrantId: GRANT_ID,
    reservedOccurrenceId: OCCURRENCE_ID, decision: 'accepted', registry: makeRegistryContext(),
  });
  assert.deepEqual(deriveReceiptDisposition('activation-decision', acceptedActivation, undefined), { ok: true, disposition: 'accepted' });
  assert.deepEqual(deriveReceiptDisposition('activation-decision', deniedActivationPayload(), undefined), { ok: true, disposition: 'denied' });
  assert.deepEqual(deriveReceiptDisposition('occurrence-start', {}, undefined), { ok: true, disposition: 'started' });
  assert.deepEqual(deriveReceiptDisposition('attempt-start', {}, undefined), { ok: true, disposition: 'started' });
  for (const disposition of ['completed', 'failed', 'cancelled', 'timed-out', 'crashed', 'incomplete', 'rejected']) {
    assert.deepEqual(deriveReceiptDisposition('attempt-end', {}, { disposition }), { ok: true, disposition });
  }
  // enforcement-denial: denied ONLY when rejected + committed evidence group
  const evidence = { enforcement_evidence: { projection_identity: 'sha-256:' + '1'.repeat(64), evidence_fingerprint: 'sha-256:' + '2'.repeat(64) } };
  assert.deepEqual(deriveReceiptDisposition('enforcement-denial', {}, { disposition: 'rejected', ...evidence }), { ok: true, disposition: 'denied' });
  assert.deepEqual(deriveReceiptDisposition('enforcement-denial', {}, { disposition: 'rejected' }), { ok: false });
  assert.deepEqual(deriveReceiptDisposition('enforcement-denial', {}, { disposition: 'completed' }), { ok: false });
  assert.deepEqual(deriveReceiptDisposition('cancellation', {}, undefined), { ok: true, disposition: 'cancelled' });
  assert.deepEqual(deriveReceiptDisposition('timeout', {}, undefined), { ok: true, disposition: 'timed-out' });
  assert.deepEqual(deriveReceiptDisposition('crash', {}, undefined), { ok: true, disposition: 'crashed' });
  assert.deepEqual(deriveReceiptDisposition('result-publication-correlation', {}, undefined), { ok: true, disposition: 'completed' });
  assert.deepEqual(deriveReceiptDisposition('bogus-event', {}, undefined), { ok: false });
  assert.deepEqual(deriveReceiptDisposition('activation-decision', {}, undefined), { ok: false });
});
