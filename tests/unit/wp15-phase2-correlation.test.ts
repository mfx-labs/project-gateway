/**
 * WP-15 Phase 2 — receipt/publication correlation producer core tests.
 *
 * State A (fresh correlated transition), exact successor/supersession
 * material, scope transition, receipt_correlations semantics, schema-role
 * separation, audit behavior, and the §34/§35 adversarial matrices (receipt
 * + publication), through the REAL WP-8 store and the REAL two-class
 * boundary (no pure-helper mocks for the decision path).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCorrelationEnv,
  correlatedOf,
  failedOf,
  correlationCleanup,
  makeCountingCorrelationIdentity,
  expectedSuccessorPayload,
  expectedSupersessionPayload,
  correlationReceiptPayload,
  nextRecordId,
  seedOutcomeFor,
  seedValidation,
  expectedPublicationPayload,
  RECEIPT_RECORD_ID,
  PUBLICATION_RECORD_ID,
  VALIDATION_RECORD_ID,
  RESULT_INSTANCE_ID,
  RESULT_REVISION_ID,
  RESULT_DIGEST,
  WS_A,
  OCCURRENCE_ID,
  ATTEMPT_ID,
  FIXED_NOW,
} from './wp15-phase2-helpers.js';
import { seedRawRecord } from './wp12-helpers.js';
import { buildValidationRecordPayload, registryReferenceFor } from '../../src/control-plane/records.js';
import { expectedOutcomePayload, expectedReceiptPayload } from './wp15-phase1b-helpers.js';
import { correlateReceiptPublication } from '../../src/receipt-publication-correlation/authority.js';
import { createTrustedReceiptCapability } from '../../src/receipt-production/internal/brand.js';

const OTHER_WORKSPACE = 'pgw:w:' + 'e'.repeat(32);
const OTHER_ATTEMPT = 'pgw:a:' + 'f'.repeat(32);
const OTHER_OCCURRENCE = 'pgw:o:' + 'd'.repeat(32);
const OTHER_RECEIPT = 'pgw:l:' + 'c'.repeat(32);

function baseRequest() {
  return { workspaceId: WS_A, predecessorPublicationRecordId: PUBLICATION_RECORD_ID, trustedReceiptRecordId: RECEIPT_RECORD_ID };
}

test('phase2 core: a fresh correlation publishes exactly one successor + one supersession with exact material and audit', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const identity = makeCountingCorrelationIdentity();
    const result = env.authority({ identity }).correlate(baseRequest());
    const ok = correlatedOf(result);
    assert.equal(ok.outcome, 'correlated');
    assert.equal(ok.predecessorRecordId, PUBLICATION_RECORD_ID);
    assert.equal(ok.receiptRecordId, RECEIPT_RECORD_ID);
    assert.notEqual(ok.successorRecordId, PUBLICATION_RECORD_ID);
    assert.notEqual(ok.supersessionRecordId, ok.successorRecordId);
    assert.ok(ok.successorAuditEventId !== undefined, 'a real new successor write must carry its D-6 audit identity');
    assert.ok(ok.supersessionAuditEventId !== undefined, 'a real new supersession write must carry its D-6 audit identity');
    assert.notEqual(ok.successorAuditEventId, ok.supersessionAuditEventId);
    // exactly two publication records and exactly one supersession
    assert.equal(env.publicationRecords().length, 2);
    assert.equal(env.supersessionRecords().length, 1);
    // the successor is materially exact (test-side mirror)
    const successor = env.readPublication(ok.successorRecordId);
    assert.ok(successor);
    const expectedSuccessor = expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, ok.successorRecordId, FIXED_NOW);
    for (const key of Object.keys(expectedSuccessor)) {
      assert.deepEqual(successor[key], expectedSuccessor[key], `successor field ${key}`);
    }
    // exact scope transition + exact receipt correlation (§14/§15)
    assert.deepEqual(successor['publication_scopes'], ['ordinary-review', 'completion-status', 'downstream-automation', 'authoritative-reporting']);
    assert.deepEqual(successor['receipt_correlations'], [RECEIPT_RECORD_ID]);
    // schema-role separation (§26): capability identity ≠ schema roles
    assert.equal(successor['responsible_role'], 'trusted-result-publisher');
    const supersession = env.readSupersession(ok.supersessionRecordId);
    assert.ok(supersession);
    assert.equal(supersession['responsible_role'], 'trusted-lifecycle-authority');
    assert.deepEqual(supersession['prior'], { subject_type: 'result-publication', record_id: PUBLICATION_RECORD_ID });
    assert.deepEqual(supersession['successor'], { subject_type: 'result-publication', record_id: ok.successorRecordId });
    assert.equal(supersession['scope'], 'ordinary-review');
    assert.equal(supersession['reason_code'], 'receipt-correlation');
    // the predecessor is untouched and still ordinary-review (§10)
    const predecessor = env.readPublication(PUBLICATION_RECORD_ID);
    assert.ok(predecessor);
    assert.deepEqual(predecessor['publication_scopes'], ['ordinary-review']);
    assert.deepEqual(predecessor['receipt_correlations'], []);
    // immutable non-correlation facts preserved exactly
    assert.deepEqual(successor['result_subject'], predecessor['result_subject']);
    assert.deepEqual(successor['evaluator_provenance'], predecessor['evaluator_provenance']);
    assert.equal(successor['validation_record_id'], predecessor['validation_record_id']);
    assert.deepEqual(successor['bundle'], predecessor['bundle']);
    assert.equal(successor['workspace_id'], predecessor['workspace_id']);
    assert.equal(successor['occurrence_id'], predecessor['occurrence_id']);
    assert.equal(successor['attempt_id'], predecessor['attempt_id']);
    // exactly one new successor and one new supersession became durable (the
    // host-composed authority owns its own store boundary; the durable-state
    // counts and audit identities prove exactly one write per class)
    assert.equal(env.publicationRecords().length, 2);
    assert.equal(env.supersessionRecords().length, 1);
    // two new record ids allocated (successor + supersession)
    assert.equal(identity.calls.recordId, 2);
  } finally {
    correlationCleanup();
  }
});

test('phase2 core: State E — exact successor + exact supersession replay with ZERO writes/allocations/audits', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const successorId = nextRecordId();
    const supersessionId = nextRecordId();
    env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, successorId, FIXED_NOW));
    env.seedSupersession(expectedSupersessionPayload(env.registryCtx, PUBLICATION_RECORD_ID, successorId, supersessionId, FIXED_NOW));
    const identity = makeCountingCorrelationIdentity();
    const result = env.authority({ identity }).correlate(baseRequest());
    const ok = correlatedOf(result);
    assert.equal(ok.outcome, 'replayed');
    assert.equal(ok.successorRecordId, successorId);
    assert.equal(ok.supersessionRecordId, supersessionId);
    assert.equal(ok.successorAuditEventId, undefined, 'replay must not fabricate a successor write audit');
    assert.equal(ok.supersessionAuditEventId, undefined, 'replay must not fabricate a supersession write audit');
    assert.equal(identity.calls.recordId, 0, 'zero new IDs on replay');
    assert.equal(env.publicationRecords().length, 2);
    assert.equal(env.supersessionRecords().length, 1);
  } finally {
    correlationCleanup();
  }
});

test('phase2 core: State B — exact durable successor without supersession recovers with zero successor writes and a fresh supersession audit', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const successorId = nextRecordId();
    env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, successorId, FIXED_NOW));
    const result = env.authority().correlate(baseRequest());
    const ok = correlatedOf(result);
    assert.equal(ok.outcome, 'recovered');
    assert.equal(ok.successorRecordId, successorId);
    assert.equal(ok.successorAuditEventId, undefined, 'recovery must not claim a successor write audit for a reused successor');
    assert.ok(ok.supersessionAuditEventId !== undefined, 'the newly written supersession must carry its audit identity');
    assert.equal(env.supersessionRecords().length, 1);
    assert.equal(env.publicationRecords().length, 2);
  } finally {
    correlationCleanup();
  }
});

test('phase2 core: no partial success — a failing supersession write reports a typed incomplete failure and the durable successor remains recoverable', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    // Pre-seed a DIVERGENT durable supersession under the identity the
    // authority will mint for the supersession write (host identity reuse).
    // The seeded supersession claims an UNRELATED predecessor so the
    // supersession resolution never sees it as a claimant.
    const collidingId = nextRecordId();
    env.seedSupersession(expectedSupersessionPayload(env.registryCtx, nextRecordId(), nextRecordId(), collidingId, FIXED_NOW));
    let calls = 0;
    const collidingIdentity = {
      nowUtcIso: () => FIXED_NOW,
      newRecordId: () => {
        calls += 1;
        return calls === 2 ? collidingId : `pgw:l:${(0x100000 + calls).toString(16).padStart(32, '0')}`;
      },
    };
    const result = env.authority({ identity: collidingIdentity }).correlate(baseRequest());
    assert.equal(result.ok, false);
    assert.equal((result as { category: string }).category, 'CORRELATION-SUPERSESSION-CONFLICT');
    assert.equal((result as { code: string }).code, 'conflict.durable-record');
    // the durable successor remains for exact recovery (State B retry)
    assert.equal(env.publicationRecords().length, 2, 'the successor write succeeded and stays durable');
    assert.equal(env.supersessionRecords().length, 1, 'only the pre-seeded divergent supersession exists');
    // exact retry completes the missing supersession and reports recovery
    const retry = env.authority().correlate(baseRequest());
    const ok = correlatedOf(retry);
    assert.equal(ok.outcome, 'recovered');
    assert.equal(ok.successorAuditEventId, undefined);
    assert.ok(ok.supersessionAuditEventId !== undefined);
    assert.equal(env.supersessionRecords().length, 2);
  } finally {
    correlationCleanup();
  }
});

// ─── SIR-WP15-P2-A-001 regressions (tightened S4 ambiguity gate) ────────────

test('phase2 core: A1 — predecessor + unrelated same-attempt/different-result publication is retrospective-invalid with zero writes', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    // An unrelated schema-valid publication for the SAME attempt but a
    // DIFFERENT result instance shares the S4 ambiguity surface.
    const unrelated = expectedPublicationPayload(env.registryCtx, env.chain, {
      record_id: nextRecordId(),
      result_subject: Object.freeze({
        protocol_version: '1.0',
        kind: Object.freeze({ id: 'ExecutionResult', version: '1.0' }),
        instance_id: 'pgw:i:' + '1'.repeat(32),
        revision_id: 'pgw:r:' + '2'.repeat(32),
        digest: 'sha-256:' + '3'.repeat(64),
        workspace_id: WS_A,
      }),
    });
    env.seedPublicationRaw(unrelated);
    const f = failedOf(env.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-RETROSPECTIVE-INVALID');
    assert.equal(f.code, 'subject.retrospective-publication-state');
    assert.equal(env.publicationRecords().length, 2, 'no successor write');
    assert.equal(env.supersessionRecords().length, 0, 'no supersession write');
  } finally {
    correlationCleanup();
  }
});

test('phase2 core: A2 — predecessor + exact successor + unrelated third publication is retrospective-invalid with no recovery', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const successorId = nextRecordId();
    env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, successorId, FIXED_NOW));
    // An extra unrelated same-attempt publication with another result instance.
    const unrelated = expectedPublicationPayload(env.registryCtx, env.chain, {
      record_id: nextRecordId(),
      result_subject: Object.freeze({
        protocol_version: '1.0',
        kind: Object.freeze({ id: 'ExecutionResult', version: '1.0' }),
        instance_id: 'pgw:i:' + '1'.repeat(32),
        revision_id: 'pgw:r:' + '2'.repeat(32),
        digest: 'sha-256:' + '3'.repeat(64),
        workspace_id: WS_A,
      }),
    });
    env.seedPublicationRaw(unrelated);
    const f = failedOf(env.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-RETROSPECTIVE-INVALID');
    assert.equal(f.code, 'subject.retrospective-publication-state');
    assert.equal(env.publicationRecords().length, 3, 'no recovery: the exact successor is not reused');
    assert.equal(env.supersessionRecords().length, 0);
  } finally {
    correlationCleanup();
  }
});

test('phase2 core: A4 — predecessor + exactly one same-result divergent successor passes the ambiguity-shape gate and fails in resolveSuccessor', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    // Divergent = same result instance but materially different scopes.
    const divergent = expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, nextRecordId(), FIXED_NOW, { publication_scopes: ['ordinary-review'] });
    env.seedPublicationRaw(divergent);
    const f = failedOf(env.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-SUCCESSOR-CONFLICT', 'the ambiguity-shape gate passes; the successor resolver classifies material divergence');
    assert.equal(f.code, 'successor.material-divergence');
    assert.equal(env.supersessionRecords().length, 0);
  } finally {
    correlationCleanup();
  }
});

// ─── §34 receipt adversarial matrix ─────────────────────────────────────────

test('phase2 core: §34 — receipt adversarial matrix fails closed', () => {
  // ── missing receipt ──
  const envMissing = makeCorrelationEnv();
  try {
    seedOutcomeFor(envMissing, 'completed', { withAssociation: true });
    seedValidation(envMissing.store, envMissing.registryCtx);
    seedRawRecord(envMissing.integration.storeEnv, 'result-publication-record', expectedPublicationPayload(envMissing.registryCtx, envMissing.chain));
    const f = failedOf(envMissing.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-RECEIPT-REJECTED');
    assert.equal(f.code, 'receipt.missing');
  } finally {
    correlationCleanup();
  }

  // ── schema-invalid receipt (wrong responsible role) ──
  const envRole = makeCorrelationEnv();
  try {
    envRole.seedBase();
    const badReceipt = { ...correlationReceiptPayload(envRole.registryCtx, envRole.chain), responsible_role: 'someone-else', record_id: OTHER_RECEIPT };
    seedRawRecord(envRole.integration.storeEnv, 'trusted-receipt', badReceipt);
    const f = failedOf(envRole.authority().correlate({ ...baseRequest(), trustedReceiptRecordId: OTHER_RECEIPT }));
    assert.equal(f.category, 'CORRELATION-RECEIPT-REJECTED');
    assert.equal(f.code, 'receipt.schema-invalid');
  } finally {
    correlationCleanup();
  }

  // ── wrong event type ──
  const envEvent = makeCorrelationEnv();
  try {
    envEvent.seedBase();
    const wrongEvent = correlationReceiptPayload(envEvent.registryCtx, envEvent.chain, { event_type: 'attempt-end' });
    const id = nextRecordId();
    seedRawRecord(envEvent.integration.storeEnv, 'trusted-receipt', { ...wrongEvent, record_id: id });
    const f = failedOf(envEvent.authority().correlate({ ...baseRequest(), trustedReceiptRecordId: id }));
    assert.equal(f.category, 'CORRELATION-RECEIPT-REJECTED');
    assert.equal(f.code, 'receipt.event-type');
  } finally {
    correlationCleanup();
  }

  // ── wrong disposition ──
  const envDisp = makeCorrelationEnv();
  try {
    envDisp.seedBase();
    const wrongDisp = correlationReceiptPayload(envDisp.registryCtx, envDisp.chain, { disposition: 'denied' });
    const id = nextRecordId();
    seedRawRecord(envDisp.integration.storeEnv, 'trusted-receipt', { ...wrongDisp, record_id: id });
    const f = failedOf(envDisp.authority().correlate({ ...baseRequest(), trustedReceiptRecordId: id }));
    assert.equal(f.category, 'CORRELATION-RECEIPT-REJECTED');
    assert.equal(f.code, 'receipt.disposition');
  } finally {
    correlationCleanup();
  }

  // ── receipt event_record_id for a DIFFERENT publication ──
  const envEventId = makeCorrelationEnv();
  try {
    envEventId.seedBase();
    const wrongEventId = correlationReceiptPayload(envEventId.registryCtx, envEventId.chain, { event_record_id: nextRecordId() });
    const id = nextRecordId();
    seedRawRecord(envEventId.integration.storeEnv, 'trusted-receipt', { ...wrongEventId, record_id: id });
    const f = failedOf(envEventId.authority().correlate({ ...baseRequest(), trustedReceiptRecordId: id }));
    assert.equal(f.category, 'CORRELATION-MISMATCH');
    assert.equal(f.code, 'binding.event-record');
  } finally {
    correlationCleanup();
  }

  // ── receipt different workspace ──
  const envWs = makeCorrelationEnv();
  try {
    envWs.seedBase();
    const wrongWs = correlationReceiptPayload(envWs.registryCtx, envWs.chain, { workspace_id: OTHER_WORKSPACE });
    const id = nextRecordId();
    seedRawRecord(envWs.integration.storeEnv, 'trusted-receipt', { ...wrongWs, record_id: id });
    const f = failedOf(envWs.authority().correlate({ ...baseRequest(), trustedReceiptRecordId: id }));
    assert.equal(f.category, 'CORRELATION-MISMATCH');
    assert.equal(f.code, 'binding.workspace');
  } finally {
    correlationCleanup();
  }

  // ── receipt different attempt ──
  const envAtt = makeCorrelationEnv();
  try {
    envAtt.seedBase();
    const wrongAtt = correlationReceiptPayload(envAtt.registryCtx, envAtt.chain, { attempt_id: OTHER_ATTEMPT });
    const id = nextRecordId();
    seedRawRecord(envAtt.integration.storeEnv, 'trusted-receipt', { ...wrongAtt, record_id: id });
    const f = failedOf(envAtt.authority().correlate({ ...baseRequest(), trustedReceiptRecordId: id }));
    assert.equal(f.category, 'CORRELATION-MISMATCH');
    assert.equal(f.code, 'binding.attempt');
  } finally {
    correlationCleanup();
  }

  // ── receipt different occurrence ──
  const envOcc = makeCorrelationEnv();
  try {
    envOcc.seedBase();
    const wrongOcc = correlationReceiptPayload(envOcc.registryCtx, envOcc.chain, { occurrence_id: OTHER_OCCURRENCE });
    const id = nextRecordId();
    seedRawRecord(envOcc.integration.storeEnv, 'trusted-receipt', { ...wrongOcc, record_id: id });
    const f = failedOf(envOcc.authority().correlate({ ...baseRequest(), trustedReceiptRecordId: id }));
    assert.equal(f.category, 'CORRELATION-MISMATCH');
    assert.equal(f.code, 'binding.occurrence');
  } finally {
    correlationCleanup();
  }

  // ── conflicting outcome state (two outcome claimants) ──
  const envOutcome = makeCorrelationEnv();
  try {
    envOutcome.seedBase();
    seedRawRecord(envOutcome.integration.storeEnv, 'execution-outcome-record', expectedOutcomePayload({
      registryCtx: envOutcome.registryCtx,
      chain: envOutcome.chain,
      disposition: 'completed',
      withAssociation: true,
      overrides: { record_id: nextRecordId() },
    }));
    const f = failedOf(envOutcome.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-MISMATCH');
    assert.equal(f.code, 'subject.outcome-conflict');
  } finally {
    correlationCleanup();
  }

  // ── outcome result association mismatch (exactly one divergent outcome) ──
  const envAssoc = makeCorrelationEnv();
  try {
    seedOutcomeFor(envAssoc, 'completed', {
      withAssociation: true,
      overrides: {
        result_association: {
          instance_id: 'pgw:i:' + 'a'.repeat(32),
          revision_digest: RESULT_DIGEST,
          association_mode: 'adopted',
          validation_record_id: VALIDATION_RECORD_ID,
        },
      },
    });
    seedValidation(envAssoc.store, envAssoc.registryCtx);
    seedRawRecord(envAssoc.integration.storeEnv, 'result-publication-record', expectedPublicationPayload(envAssoc.registryCtx, envAssoc.chain));
    seedRawRecord(envAssoc.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(envAssoc.registryCtx, envAssoc.chain));
    const f = failedOf(envAssoc.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-MISMATCH');
    assert.equal(f.code, 'subject.association-mismatch');
  } finally {
    correlationCleanup();
  }

  // ── validation provenance mismatch (missing ValidationRecord) ──
  const envVal = makeCorrelationEnv();
  try {
    const missingValidationId = 'pgw:l:' + '9'.repeat(32);
    seedOutcomeFor(envVal, 'completed', {
      withAssociation: true,
      overrides: {
        result_association: {
          instance_id: RESULT_INSTANCE_ID,
          revision_digest: RESULT_DIGEST,
          association_mode: 'adopted',
          validation_record_id: missingValidationId,
        },
      },
    });
    seedRawRecord(envVal.integration.storeEnv, 'result-publication-record', expectedPublicationPayload(envVal.registryCtx, envVal.chain, { validation_record_id: missingValidationId }));
    seedRawRecord(envVal.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(envVal.registryCtx, envVal.chain));
    const f = failedOf(envVal.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-MISMATCH');
    assert.equal(f.code, 'subject.validation-missing');
  } finally {
    correlationCleanup();
  }

  // ── non-passing ValidationRecord ──
  const envValFail = makeCorrelationEnv();
  try {
    seedOutcomeFor(envValFail, 'completed', { withAssociation: true });
    seedRawRecord(envValFail.integration.storeEnv, 'validation-record', {
      ...buildValidationRecordPayload({
        recordId: VALIDATION_RECORD_ID,
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
        registry: envValFail.registryCtx,
      }),
      structural_outcome: 'fail',
    });
    seedRawRecord(envValFail.integration.storeEnv, 'result-publication-record', expectedPublicationPayload(envValFail.registryCtx, envValFail.chain));
    seedRawRecord(envValFail.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(envValFail.registryCtx, envValFail.chain));
    const f = failedOf(envValFail.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-MISMATCH');
    assert.equal(f.code, 'subject.validation-invalid');
  } finally {
    correlationCleanup();
  }

  // ── malformed/conflicting durable outcome state: divergent single claimant ──
  const envMalformed = makeCorrelationEnv();
  try {
    seedOutcomeFor(envMalformed, 'completed', { withAssociation: true, overrides: { execution_attempt_record_id: nextRecordId() } });
    seedValidation(envMalformed.store, envMalformed.registryCtx);
    seedRawRecord(envMalformed.integration.storeEnv, 'result-publication-record', expectedPublicationPayload(envMalformed.registryCtx, envMalformed.chain));
    seedRawRecord(envMalformed.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(envMalformed.registryCtx, envMalformed.chain));
    const f = failedOf(envMalformed.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-MISMATCH');
    assert.equal(f.code, 'subject.outcome-malformed');
  } finally {
    correlationCleanup();
  }
});

// ─── §35 publication adversarial matrix ─────────────────────────────────────

test('phase2 core: §35 — publication adversarial matrix fails closed', () => {
  // ── missing predecessor ──
  const envMissing = makeCorrelationEnv();
  try {
    seedOutcomeFor(envMissing, 'completed', { withAssociation: true });
    seedValidation(envMissing.store, envMissing.registryCtx);
    seedRawRecord(envMissing.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(envMissing.registryCtx, envMissing.chain));
    const f = failedOf(envMissing.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-PREDECESSOR-REJECTED');
    assert.equal(f.code, 'predecessor.missing');
  } finally {
    correlationCleanup();
  }

  // ── predecessor schema-invalid / wrong responsible role ──
  const envRole = makeCorrelationEnv();
  try {
    envRole.seedBase();
    const badPredecessor = { ...(envRole.readPublication(PUBLICATION_RECORD_ID) as Readonly<Record<string, unknown>>), responsible_role: 'someone-else', record_id: nextRecordId() };
    seedRawRecord(envRole.integration.storeEnv, 'result-publication-record', badPredecessor);
    const f = failedOf(envRole.authority().correlate({ ...baseRequest(), predecessorPublicationRecordId: badPredecessor['record_id'] as string }));
    assert.equal(f.category, 'CORRELATION-PREDECESSOR-REJECTED');
    assert.equal(f.code, 'predecessor.schema-invalid');
  } finally {
    correlationCleanup();
  }

  // ── unsupported predecessor scope state ──
  const envScope = makeCorrelationEnv();
  try {
    envScope.seedBase();
    const badScope = { ...(envScope.readPublication(PUBLICATION_RECORD_ID) as Readonly<Record<string, unknown>>), publication_scopes: ['ordinary-review', 'completion-status'], record_id: nextRecordId() };
    seedRawRecord(envScope.integration.storeEnv, 'result-publication-record', badScope);
    const f = failedOf(envScope.authority().correlate({ ...baseRequest(), predecessorPublicationRecordId: badScope['record_id'] as string }));
    assert.equal(f.category, 'CORRELATION-PREDECESSOR-REJECTED');
    assert.equal(f.code, 'predecessor.scope-state');
  } finally {
    correlationCleanup();
  }

  // ── predecessor already carries a receipt correlation ──
  const envReceiptState = makeCorrelationEnv();
  try {
    envReceiptState.seedBase();
    const badState = { ...(envReceiptState.readPublication(PUBLICATION_RECORD_ID) as Readonly<Record<string, unknown>>), receipt_correlations: [RECEIPT_RECORD_ID], record_id: nextRecordId() };
    seedRawRecord(envReceiptState.integration.storeEnv, 'result-publication-record', badState);
    const f = failedOf(envReceiptState.authority().correlate({ ...baseRequest(), predecessorPublicationRecordId: badState['record_id'] as string }));
    assert.equal(f.category, 'CORRELATION-PREDECESSOR-REJECTED');
    assert.equal(f.code, 'predecessor.receipt-state');
  } finally {
    correlationCleanup();
  }

  // ── predecessor/result mismatch (no exact attempt exists) ──
  const envSubject = makeCorrelationEnv();
  try {
    seedOutcomeFor(envSubject, 'completed', { withAssociation: true });
    seedValidation(envSubject.store, envSubject.registryCtx);
    const orphanId = nextRecordId();
    const orphan = { ...expectedPublicationPayload(envSubject.registryCtx, envSubject.chain), record_id: orphanId, attempt_id: OTHER_ATTEMPT, occurrence_id: OTHER_OCCURRENCE };
    seedRawRecord(envSubject.integration.storeEnv, 'result-publication-record', orphan);
    seedRawRecord(envSubject.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(envSubject.registryCtx, envSubject.chain, { event_record_id: orphanId, occurrence_id: OTHER_OCCURRENCE, attempt_id: OTHER_ATTEMPT, record_id: RECEIPT_RECORD_ID }));
    const f = failedOf(envSubject.authority().correlate({ ...baseRequest(), predecessorPublicationRecordId: orphanId }));
    assert.equal(f.category, 'CORRELATION-MISMATCH');
    assert.equal(f.code, 'subject.attempt-missing');
  } finally {
    correlationCleanup();
  }

  // ── predecessor already superseded to a divergent successor (State D) ──
  const envSuperseded = makeCorrelationEnv();
  try {
    envSuperseded.seedBase();
    const divergent = expectedSuccessorPayload(envSuperseded.registryCtx, envSuperseded.chain, RECEIPT_RECORD_ID, nextRecordId(), FIXED_NOW, { publication_scopes: ['ordinary-review'] });
    const divergentId = envSuperseded.seedPublicationRaw(divergent);
    envSuperseded.seedSupersession(expectedSupersessionPayload(envSuperseded.registryCtx, PUBLICATION_RECORD_ID, divergentId, nextRecordId(), FIXED_NOW));
    const f = failedOf(envSuperseded.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-PREDECESSOR-NOT-CURRENT');
    assert.equal(f.code, 'predecessor.superseded-divergent');
  } finally {
    correlationCleanup();
  }

  // ── multiple supersession claimants ──
  const envMulti = makeCorrelationEnv();
  try {
    envMulti.seedBase();
    const successorId = nextRecordId();
    envMulti.seedPublicationRaw(expectedSuccessorPayload(envMulti.registryCtx, envMulti.chain, RECEIPT_RECORD_ID, successorId, FIXED_NOW));
    envMulti.seedSupersession(expectedSupersessionPayload(envMulti.registryCtx, PUBLICATION_RECORD_ID, successorId, nextRecordId(), FIXED_NOW));
    envMulti.seedSupersession(expectedSupersessionPayload(envMulti.registryCtx, PUBLICATION_RECORD_ID, successorId, nextRecordId(), FIXED_NOW));
    const f = failedOf(envMulti.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-SUPERSESSION-CONFLICT');
    assert.equal(f.code, 'supersession.multiple-claimants');
  } finally {
    correlationCleanup();
  }

  // ── schema-invalid supersession claimant ──
  const envCorrupt = makeCorrelationEnv();
  try {
    envCorrupt.seedBase();
    const successorId = nextRecordId();
    envCorrupt.seedPublicationRaw(expectedSuccessorPayload(envCorrupt.registryCtx, envCorrupt.chain, RECEIPT_RECORD_ID, successorId, FIXED_NOW));
    const bad = { ...expectedSupersessionPayload(envCorrupt.registryCtx, PUBLICATION_RECORD_ID, successorId, nextRecordId(), FIXED_NOW), created_at: 'not-a-timestamp' };
    envCorrupt.seedSupersession(bad);
    const f = failedOf(envCorrupt.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-SUPERSESSION-CONFLICT');
    assert.equal(f.code, 'supersession.corrupt-claimant');
  } finally {
    correlationCleanup();
  }

  // ── divergent successor claimant (State C) ──
  const envDivergent = makeCorrelationEnv();
  try {
    envDivergent.seedBase();
    const divergent = expectedSuccessorPayload(envDivergent.registryCtx, envDivergent.chain, RECEIPT_RECORD_ID, nextRecordId(), FIXED_NOW, { publication_scopes: ['ordinary-review'] });
    envDivergent.seedPublicationRaw(divergent);
    const f = failedOf(envDivergent.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-SUCCESSOR-CONFLICT');
    assert.equal(f.code, 'successor.material-divergence');
  } finally {
    correlationCleanup();
  }

  // ── multiple successor claimants (SIR-WP15-P2-A-001: >1 other
  //     publication on the ambiguity surface is retrospective-invalid) ──
  const envMultiSuccessor = makeCorrelationEnv();
  try {
    envMultiSuccessor.seedBase();
    envMultiSuccessor.seedPublicationRaw(expectedSuccessorPayload(envMultiSuccessor.registryCtx, envMultiSuccessor.chain, RECEIPT_RECORD_ID, nextRecordId(), FIXED_NOW));
    envMultiSuccessor.seedPublicationRaw(expectedSuccessorPayload(envMultiSuccessor.registryCtx, envMultiSuccessor.chain, RECEIPT_RECORD_ID, nextRecordId(), FIXED_NOW));
    const f = failedOf(envMultiSuccessor.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-RETROSPECTIVE-INVALID');
    assert.equal(f.code, 'subject.retrospective-publication-state');
  } finally {
    correlationCleanup();
  }

  // ── revoked predecessor (PUB-004 active-publication check) ──
  const envRevoked = makeCorrelationEnv();
  try {
    envRevoked.seedBase();
    const { registryReferenceFor: _ref } = { registryReferenceFor };
    seedRawRecord(envRevoked.integration.storeEnv, 'revocation-record', {
      record_type: 'RevocationRecord',
      record_id: nextRecordId(),
      created_at: FIXED_NOW,
      responsible_role: 'trusted-revocation-authority',
      registry_snapshot_reference: registryReferenceFor(envRevoked.registryCtx),
      target: Object.freeze({ record_type: 'ResultPublicationRecord', record_id: PUBLICATION_RECORD_ID }),
      scope: 'ordinary-review',
      effective_at: FIXED_NOW,
      reason_code: 'review-withdrawn',
    });
    const f = failedOf(envRevoked.authority().correlate(baseRequest()));
    assert.equal(f.category, 'CORRELATION-PREDECESSOR-REJECTED');
    assert.equal(f.code, 'predecessor.revoked');
  } finally {
    correlationCleanup();
  }

  // ── caller injection of transition operands is rejected ──
  const envInject = makeCorrelationEnv();
  try {
    envInject.seedBase();
    const f2 = failedOf(envInject.authority().correlate({ ...baseRequest(), publication_scopes: ['completion-status'] } as never));
    assert.equal(f2.category, 'CORRELATION-INPUT-INVALID');
    assert.ok(f2.code.startsWith('request.unknown-key'), f2.code);
  } finally {
    correlationCleanup();
  }

  // ── hostile request capture (SIR-WP15-P1B-004 discipline, §7) ──
  const envHostile = makeCorrelationEnv();
  try {
    envHostile.seedBase();
    const authority = envHostile.authority();
    const getter = { workspaceId: WS_A, predecessorPublicationRecordId: PUBLICATION_RECORD_ID, trustedReceiptRecordId: RECEIPT_RECORD_ID };
    Object.defineProperty(getter, 'trustedReceiptRecordId', { get() { return RECEIPT_RECORD_ID; }, enumerable: true });
    const fGetter = failedOf(authority.correlate(getter as never));
    assert.equal(fGetter.category, 'CORRELATION-INPUT-INVALID');
    assert.equal(fGetter.code, 'request.hostile-input');
    const inherited = Object.create({ workspaceId: WS_A, predecessorPublicationRecordId: PUBLICATION_RECORD_ID, trustedReceiptRecordId: RECEIPT_RECORD_ID });
    const fInherited = failedOf(authority.correlate(inherited as never));
    assert.equal(fInherited.category, 'CORRELATION-INPUT-INVALID');
    assert.equal(fInherited.code, 'request.hostile-input');
    const revoked = Proxy.revocable({ workspaceId: WS_A, predecessorPublicationRecordId: PUBLICATION_RECORD_ID, trustedReceiptRecordId: RECEIPT_RECORD_ID }, {});
    revoked.revoke();
    const fRevoked = failedOf(authority.correlate(revoked.proxy as never));
    assert.equal(fRevoked.category, 'CORRELATION-INPUT-INVALID');
    assert.equal(fRevoked.code, 'request.hostile-input');
  } finally {
    correlationCleanup();
  }
});

test('phase2 core: capability isolation — the Phase 1B receipt capability is rejected at the correlation authority gate', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const foreign = createTrustedReceiptCapability({ trustedConfiguration: env.integration.storeEnv.config, actionIdentity: 'receipt-production-action-1' });
    assert.ok(foreign, 'the receipt capability must mint for the same trusted configuration');
    const f = failedOf(correlateReceiptPublication(env.input({ capability: foreign })));
    assert.equal(f.category, 'CORRELATION-CAPABILITY-DENIED');
    assert.equal(f.code, 'capability.not-genuine');
  } finally {
    correlationCleanup();
  }
});

test('phase2 core: forged registry context is rejected (committed registry brand)', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const forged = { ...env.registryCtx, snapshot: { snapshot_id: 'pgw:g:' + '0'.repeat(32), snapshot_digest: 'sha-256:' + '0'.repeat(64) } };
    const f = failedOf(correlateReceiptPublication(env.input({ registry: forged as never })));
    assert.equal(f.category, 'CORRELATION-INPUT-INVALID');
    assert.equal(f.code, 'input.registry-invalid');
  } finally {
    correlationCleanup();
  }
});

test('phase2 core: the two-class sink rejects TrustedReceipt and every other class payload', () => {
  const env = makeCorrelationEnv();
  try {
    const receipt = expectedReceiptPayload(env.registryCtx, { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: nextRecordId() }, 'completed', OCCURRENCE_ID, ATTEMPT_ID, nextRecordId(), FIXED_NOW);
    // a TrustedReceipt can never reach WP-8 through the correlation surface:
    // the sink's permit gate rejects it before any class check.
    const denied = env.boundary.publishSuccessorPublication({} as never, receipt);
    assert.equal(denied.ok, false);
    assert.equal((denied as { category: string }).category, 'CORRELATION-CAPABILITY-DENIED');
    const denied2 = env.boundary.publishSupersession({} as never, receipt);
    assert.equal(denied2.ok, false);
    assert.equal((denied2 as { category: string }).category, 'CORRELATION-CAPABILITY-DENIED');
  } finally {
    correlationCleanup();
  }
});
