/**
 * WP-15 Phase 2 — privileged-consumption safety integration tests (§36).
 *
 * Exercises the committed point-of-use PUB-005 verifier
 * (`evaluatePointOfUse`, src/pointofuse/evaluate.ts) over the exact
 * correlation states:
 *
 *   - receipt durable only                       → NO privileged consumption;
 *   - successor durable, supersession absent     → NO privileged consumption
 *     (strengthened currentness check: the successor is not yet the current
 *     publication for its result subject);
 *   - exact successor + exact supersession + exact receipt correlation
 *                                               → privileged consumption is
 *     allowed (and ONLY for the exact contract-authorized scopes — the
 *     ordinary-review-only predecessor never unlocks privileged use);
 *   - mismatched receipt correlation             → NO privileged consumption
 *     (the WP-15 exact-binding strengthening: non-empty receipt_correlations
 *     alone is insufficient; the correlation must resolve to the exact
 *     result-publication-correlation TrustedReceipt).
 *
 * The records are the real durable records produced by the correlation
 * authority through the REAL WP-8 store, so the verifier sees exactly the
 * states the producer leaves behind.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCorrelationEnv,
  correlatedOf,
  correlationCleanup,
  expectedSuccessorPayload,
  expectedSupersessionPayload,
  correlationReceiptPayload,
  expectedPublicationPayload,
  nextRecordId,
  RECEIPT_RECORD_ID,
  PUBLICATION_RECORD_ID,
  RESULT_INSTANCE_ID,
  RESULT_REVISION_ID,
  RESULT_DIGEST,
  WS_A,
  FIXED_NOW,
} from './wp15-phase2-helpers.js';
import { seedRawRecord, makeRegistryContext } from './wp12-helpers.js';
import { evaluatePointOfUse } from '../../src/pointofuse/evaluate.js';
import type { PointOfUseContext } from '../../src/pointofuse/evaluate.js';

/** The real records of one store view, evaluated as point-of-use entries. */
function evaluateRecords(env: ReturnType<typeof makeCorrelationEnv>, entryIds: readonly string[]): ReturnType<typeof evaluatePointOfUse> {
  const records: Readonly<Record<string, unknown>>[] = [];
  for (const cls of ['trusted-receipt', 'result-publication-record', 'supersession-record', 'validation-record', 'execution-outcome-record', 'execution-attempt-record', 'execution-occurrence-record', 'activation-record', 'revocation-record']) {
    const enumerated = env.boundary.enumerateLifecycleRecords(cls as never);
    if (!enumerated.ok) continue;
    for (const recordId of enumerated.recordIds) {
      const read = env.boundary.readLifecyclePayload(cls as never, recordId);
      if (read.ok && read.payload !== undefined) records.push(read.payload);
    }
  }
  const ctx: PointOfUseContext = {
    currentTime: FIXED_NOW,
    registry: makeRegistryContext(),
    consumerSupport: { consumerId: 'test', supportedProtocolFeatures: [], supportedConsumerCapabilities: [], supportedExtensionNamespaces: [] },
    records,
    entryRecordIds: new Set(entryIds),
  };
  return evaluatePointOfUse(ctx);
}

function pub005(findings: ReturnType<typeof evaluatePointOfUse>): ReturnType<typeof evaluatePointOfUse> {
  return findings.filter((f) => f.ruleIds?.includes('PUB-005') === true);
}

const PRIVILEGED_SCOPES = ['completion-status', 'downstream-automation', 'authoritative-reporting'];

test('phase2 privileged: receipt durable only — NO privileged consumption of the ordinary-review predecessor', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    // State A: only the receipt + the ordinary-review predecessor are durable.
    const findings = pub005(evaluateRecords(env, [PUBLICATION_RECORD_ID]));
    // The ordinary-review predecessor carries no privileged scope at all, so
    // it can never unlock privileged consumption — zero PUB-005 findings AND
    // zero privileged scopes on the publication.
    assert.equal(findings.length, 0, 'an ordinary-review-only publication never unlocks privileged consumption');
    const predecessor = env.readPublication(PUBLICATION_RECORD_ID);
    assert.ok(predecessor);
    assert.deepEqual(predecessor['publication_scopes'], ['ordinary-review']);
    // Receipt existence elsewhere in storage is insufficient: the receipt is
    // in the store, yet the publication carries no correlation at all.
    assert.deepEqual(predecessor['receipt_correlations'], []);
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged: successor durable, supersession ABSENT — NO privileged consumption (currentness)', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const successorId = nextRecordId();
    env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, successorId, FIXED_NOW));
    // State B: exact successor durable, no SupersessionRecord.
    const findings = pub005(evaluateRecords(env, [successorId]));
    assert.equal(findings.length, 1, 'the successor is not the current publication until the exact supersession is durable');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-not-current');
    // The predecessor view stays non-privileged too (ordinary-review only).
    const predecessorFindings = pub005(evaluateRecords(env, [PUBLICATION_RECORD_ID]));
    assert.equal(predecessorFindings.length, 0);
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged: exact successor + exact supersession + exact receipt correlation — privileged consumption allowed for the exact scopes', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const ok = correlatedOf(env.authority().correlate({ workspaceId: WS_A, predecessorPublicationRecordId: PUBLICATION_RECORD_ID, trustedReceiptRecordId: RECEIPT_RECORD_ID }));
    assert.equal(ok.outcome, 'correlated');
    // State E view: the current publication is the receipt-correlated
    // successor with the exact contract-authorized scopes.
    const findings = pub005(evaluateRecords(env, [ok.successorRecordId]));
    assert.equal(findings.length, 0, 'the exact correlated current successor unlocks privileged consumption');
    // The successor carries exactly ordinary-review + the three
    // receipt-gated privileged scopes.
    const successor = env.readPublication(ok.successorRecordId);
    assert.ok(successor);
    assert.deepEqual(successor['publication_scopes'], ['ordinary-review', ...PRIVILEGED_SCOPES]);
    // The superseded predecessor view never unlocks privileged consumption:
    // it is ordinary-review-only (no privileged scopes at all) AND superseded.
    const predecessorFindings = pub005(evaluateRecords(env, [PUBLICATION_RECORD_ID]));
    assert.equal(predecessorFindings.length, 0, 'the superseded ordinary-review predecessor never unlocks privileged consumption');
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged: mismatched receipt correlation — NO privileged consumption (exact binding)', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const successorId = nextRecordId();
    // A schema-valid successor whose receipt_correlations entry is NOT the
    // exact correlation: points at an unrelated TrustedReceipt (a different
    // event subject), while the EXACT correlation receipt also exists.
    const unrelatedReceiptId = nextRecordId();
    seedRawRecord(env.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(env.registryCtx, env.chain, { record_id: unrelatedReceiptId, event_record_id: nextRecordId() }));
    const supersessionId = nextRecordId();
    const mismatched = expectedSuccessorPayload(env.registryCtx, env.chain, unrelatedReceiptId, successorId, FIXED_NOW);
    env.seedPublicationRaw(mismatched);
    env.seedSupersession(expectedSupersessionPayload(env.registryCtx, PUBLICATION_RECORD_ID, successorId, supersessionId, FIXED_NOW));
    const findings = pub005(evaluateRecords(env, [successorId]));
    assert.equal(findings.length, 1, 'a mismatched correlation must never unlock privileged consumption');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-without-receipt', 'the correlation does not resolve to the exact receipt');
    // Non-empty receipt_correlations alone is insufficient.
    const successor = env.readPublication(successorId);
    assert.ok(successor);
    assert.equal((successor['receipt_correlations'] as string[]).length, 1);
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged: a superseded receipt-correlated publication — NO privileged consumption (superseded)', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const ok = correlatedOf(env.authority().correlate({ workspaceId: WS_A, predecessorPublicationRecordId: PUBLICATION_RECORD_ID, trustedReceiptRecordId: RECEIPT_RECORD_ID }));
    assert.equal(ok.outcome, 'correlated');
    // A later supersession selects ANOTHER successor publication (correction
    // path): the receipt-correlated successor becomes superseded.
    const laterId = nextRecordId();
    env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, laterId, FIXED_NOW));
    env.seedSupersession(expectedSupersessionPayload(env.registryCtx, ok.successorRecordId, laterId, nextRecordId(), FIXED_NOW));
    const findings = pub005(evaluateRecords(env, [ok.successorRecordId]));
    assert.equal(findings.length, 1, 'a superseded publication never unlocks privileged consumption');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-superseded');
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged: receipt-correlated publication with a receipt of another event type — NO privileged consumption', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const successorId = nextRecordId();
    const wrongEventReceiptId = nextRecordId();
    // A schema-valid attempt-end receipt (not a correlation receipt) is
    // referenced by the publication — never an unlocking correlation.
    seedRawRecord(env.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(env.registryCtx, env.chain, {
      record_id: wrongEventReceiptId,
      event_type: 'attempt-end',
      event_record_id: env.chain.attemptRecordId,
      disposition: 'completed',
    }));
    const supersessionId = nextRecordId();
    env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, wrongEventReceiptId, successorId, FIXED_NOW));
    env.seedSupersession(expectedSupersessionPayload(env.registryCtx, PUBLICATION_RECORD_ID, successorId, supersessionId, FIXED_NOW));
    const findings = pub005(evaluateRecords(env, [successorId]));
    assert.equal(findings.length, 1, 'a receipt of another event type must not unlock privileged consumption');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-without-receipt');
  } finally {
    correlationCleanup();
  }
});

// ─── SIR-WP15-P2-B-001 regressions: exact predecessor/receipt/candidate triangle ─

/** Seed the standard exact transition state (P1 + R attesting P1) and the privileged candidate P2 referencing R. */
function seedExactCorrelation(env: ReturnType<typeof makeCorrelationEnv>): string {
  env.seedBase();
  const successorId = nextRecordId();
  env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, successorId, FIXED_NOW));
  return successorId;
}

/** A same-subject publication payload with overrides (attested-predecessor adversarial vectors). */
function attestedVariant(env: ReturnType<typeof makeCorrelationEnv>, overrides: Partial<Readonly<Record<string, unknown>>>): Readonly<Record<string, unknown>> {
  return expectedPublicationPayload(env.registryCtx, env.chain, { record_id: nextRecordId(), ...overrides });
}

test('phase2 privileged B1: self-attestation — receipt attests the candidate itself → blocked', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const successorId = nextRecordId();
    const selfReceiptId = nextRecordId();
    // R2 attests P2 ITSELF (event_record_id == P2.record_id); no distinct
    // predecessor and no supersession exist.
    seedRawRecord(env.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(env.registryCtx, env.chain, { record_id: selfReceiptId, event_record_id: successorId }));
    env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, selfReceiptId, successorId, FIXED_NOW));
    const findings = pub005(evaluateRecords(env, [successorId]));
    assert.equal(findings.length, 1, 'self-attestation must never unlock privileged consumption');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-without-receipt');
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged B2: receipt attests a predecessor with a different workspace → blocked', () => {
  const env = makeCorrelationEnv();
  try {
    const successorId = seedExactCorrelation(env);
    const wrongWsReceiptId = nextRecordId();
    // The receipt attests P1w — a publication with a DIFFERENT workspace
    // (same result subject, same occurrence/attempt) — while the candidate's
    // own bindings still match the receipt.
    const attestedId = nextRecordId();
    seedRawRecord(env.integration.storeEnv, 'result-publication-record', attestedVariant(env, { record_id: attestedId, workspace_id: 'pgw:w:' + 'e'.repeat(32) }));
    seedRawRecord(env.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(env.registryCtx, env.chain, { record_id: wrongWsReceiptId, event_record_id: attestedId }));
    const candidateId = nextRecordId();
    env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, wrongWsReceiptId, candidateId, FIXED_NOW));
    const findings = pub005(evaluateRecords(env, [candidateId]));
    assert.equal(findings.length, 1, 'a receipt attesting a different-workspace predecessor must not unlock privileged consumption');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-without-receipt');
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged B3: receipt attests a predecessor with a different occurrence → blocked', () => {
  const env = makeCorrelationEnv();
  try {
    const successorId = seedExactCorrelation(env);
    const attestedId = nextRecordId();
    const wrongOccReceiptId = nextRecordId();
    seedRawRecord(env.integration.storeEnv, 'result-publication-record', attestedVariant(env, { record_id: attestedId, occurrence_id: 'pgw:o:' + 'd'.repeat(32) }));
    seedRawRecord(env.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(env.registryCtx, env.chain, { record_id: wrongOccReceiptId, event_record_id: attestedId, occurrence_id: 'pgw:o:' + 'd'.repeat(32) }));
    const candidateId = nextRecordId();
    env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, wrongOccReceiptId, candidateId, FIXED_NOW));
    const findings = pub005(evaluateRecords(env, [candidateId]));
    assert.equal(findings.length, 1, 'a receipt attesting a different-occurrence predecessor must not unlock privileged consumption');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-without-receipt');
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged B4: receipt attests a predecessor with a different attempt → blocked', () => {
  const env = makeCorrelationEnv();
  try {
    const successorId = seedExactCorrelation(env);
    const attestedId = nextRecordId();
    const wrongAttReceiptId = nextRecordId();
    seedRawRecord(env.integration.storeEnv, 'result-publication-record', attestedVariant(env, { record_id: attestedId, attempt_id: 'pgw:a:' + 'f'.repeat(32) }));
    seedRawRecord(env.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(env.registryCtx, env.chain, { record_id: wrongAttReceiptId, event_record_id: attestedId, attempt_id: 'pgw:a:' + 'f'.repeat(32) }));
    const candidateId = nextRecordId();
    env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, wrongAttReceiptId, candidateId, FIXED_NOW));
    const findings = pub005(evaluateRecords(env, [candidateId]));
    assert.equal(findings.length, 1, 'a receipt attesting a different-attempt predecessor must not unlock privileged consumption');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-without-receipt');
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged B5: attested predecessor with the same result instance but a DIFFERENT revision → blocked', () => {
  const env = makeCorrelationEnv();
  try {
    const successorId = seedExactCorrelation(env);
    const attestedId = nextRecordId();
    const wrongRevReceiptId = nextRecordId();
    const subject = {
      protocol_version: '1.0',
      kind: Object.freeze({ id: 'ExecutionResult', version: '1.0' }),
      instance_id: RESULT_INSTANCE_ID,
      revision_id: 'pgw:r:' + 'e'.repeat(32),
      digest: RESULT_DIGEST,
      workspace_id: WS_A,
    };
    seedRawRecord(env.integration.storeEnv, 'result-publication-record', attestedVariant(env, { record_id: attestedId, result_subject: Object.freeze(subject) }));
    seedRawRecord(env.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(env.registryCtx, env.chain, { record_id: wrongRevReceiptId, event_record_id: attestedId }));
    const candidateId = nextRecordId();
    env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, wrongRevReceiptId, candidateId, FIXED_NOW));
    const findings = pub005(evaluateRecords(env, [candidateId]));
    assert.equal(findings.length, 1, 'same instance with another revision is never exact correlation');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-without-receipt');
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged B6: attested predecessor with the same instance/revision but a DIVERGENT digest → blocked', () => {
  const env = makeCorrelationEnv();
  try {
    const successorId = seedExactCorrelation(env);
    const attestedId = nextRecordId();
    const wrongDigestReceiptId = nextRecordId();
    const subject = {
      protocol_version: '1.0',
      kind: Object.freeze({ id: 'ExecutionResult', version: '1.0' }),
      instance_id: RESULT_INSTANCE_ID,
      revision_id: RESULT_REVISION_ID,
      digest: 'sha-256:' + '9'.repeat(64),
      workspace_id: WS_A,
    };
    seedRawRecord(env.integration.storeEnv, 'result-publication-record', attestedVariant(env, { record_id: attestedId, result_subject: Object.freeze(subject) }));
    seedRawRecord(env.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(env.registryCtx, env.chain, { record_id: wrongDigestReceiptId, event_record_id: attestedId }));
    const candidateId = nextRecordId();
    env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, wrongDigestReceiptId, candidateId, FIXED_NOW));
    const findings = pub005(evaluateRecords(env, [candidateId]));
    assert.equal(findings.length, 1, 'same instance/revision with another digest is never exact correlation');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-without-receipt');
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged B7: exact legitimate predecessor receipt — eligible subject to supersession/currentness', () => {
  const env = makeCorrelationEnv();
  try {
    const successorId = seedExactCorrelation(env);
    // exact supersession P1→P2 completes the transition
    env.seedSupersession(expectedSupersessionPayload(env.registryCtx, PUBLICATION_RECORD_ID, successorId, nextRecordId(), FIXED_NOW));
    const findings = pub005(evaluateRecords(env, [successorId]));
    assert.equal(findings.length, 0, 'the exact legitimate predecessor receipt is eligible with the exact supersession');
  } finally {
    correlationCleanup();
  }
});

// ─── SIR-WP15-P2-B-002 regressions: claimant-first exact supersession currentness ─

test('phase2 privileged C1: exact predecessor→candidate supersession — allowed when every other correlation condition passes', () => {
  const env = makeCorrelationEnv();
  try {
    const successorId = seedExactCorrelation(env);
    env.seedSupersession(expectedSupersessionPayload(env.registryCtx, PUBLICATION_RECORD_ID, successorId, nextRecordId(), FIXED_NOW));
    const findings = pub005(evaluateRecords(env, [successorId]));
    assert.equal(findings.length, 0);
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged C2: supersession binds the attested predecessor to a DIFFERENT successor → blocked', () => {
  const env = makeCorrelationEnv();
  try {
    const successorId = seedExactCorrelation(env);
    const otherSuccessorId = nextRecordId();
    env.seedSupersession(expectedSupersessionPayload(env.registryCtx, PUBLICATION_RECORD_ID, otherSuccessorId, nextRecordId(), FIXED_NOW));
    const findings = pub005(evaluateRecords(env, [successorId]));
    assert.equal(findings.length, 1, 'a supersession to another successor never makes this candidate current');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-supersession-divergent');
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged C3: multiple SupersessionRecord claimants for the attested predecessor → blocked', () => {
  const env = makeCorrelationEnv();
  try {
    const successorId = seedExactCorrelation(env);
    env.seedSupersession(expectedSupersessionPayload(env.registryCtx, PUBLICATION_RECORD_ID, successorId, nextRecordId(), FIXED_NOW));
    env.seedSupersession(expectedSupersessionPayload(env.registryCtx, PUBLICATION_RECORD_ID, nextRecordId(), nextRecordId(), FIXED_NOW));
    const findings = pub005(evaluateRecords(env, [successorId]));
    assert.equal(findings.length, 1, 'multiple claimants fail closed — no first/latest/enumeration winner');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-supersession-divergent');
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged C4: schema-invalid claimant naming the attested predecessor → blocked', () => {
  const env = makeCorrelationEnv();
  try {
    const successorId = seedExactCorrelation(env);
    const bad = { ...expectedSupersessionPayload(env.registryCtx, PUBLICATION_RECORD_ID, successorId, nextRecordId(), FIXED_NOW), created_at: 'not-a-timestamp' };
    env.seedSupersession(bad);
    const findings = pub005(evaluateRecords(env, [successorId]));
    assert.equal(findings.length, 1, 'a schema-invalid claimant is never ignored');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-supersession-divergent');
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged C5: no SupersessionRecord for the attested predecessor → blocked (partial State B)', () => {
  const env = makeCorrelationEnv();
  try {
    const successorId = seedExactCorrelation(env);
    const findings = pub005(evaluateRecords(env, [successorId]));
    assert.equal(findings.length, 1, 'the required predecessor→candidate transition is incomplete');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-not-current');
  } finally {
    correlationCleanup();
  }
});

test('phase2 privileged C6: exact candidate later superseded → remains blocked (existing semantics)', () => {
  const env = makeCorrelationEnv();
  try {
    const successorId = seedExactCorrelation(env);
    env.seedSupersession(expectedSupersessionPayload(env.registryCtx, PUBLICATION_RECORD_ID, successorId, nextRecordId(), FIXED_NOW));
    const laterId = nextRecordId();
    env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, laterId, FIXED_NOW));
    env.seedSupersession(expectedSupersessionPayload(env.registryCtx, successorId, laterId, nextRecordId(), FIXED_NOW));
    const findings = pub005(evaluateRecords(env, [successorId]));
    assert.equal(findings.length, 1, 'a later-superseded candidate stays blocked');
    assert.equal(findings[0]!.messageKey, 'pointofuse.privileged-superseded');
  } finally {
    correlationCleanup();
  }
});
