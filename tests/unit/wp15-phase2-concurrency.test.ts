/**
 * WP-15 Phase 2 — correlation concurrency tests (§33).
 *
 * Same predecessor + same receipt (serialized acquisitions of the same
 * correlation key), same predecessor + divergent receipt (fail closed, no
 * competing successor), and independent predecessors (independent keys —
 * no global serialization). The core is synchronous, so "concurrent" is
 * exercised as serialized acquisitions of the same key plus the in-lock
 * hook seam (WP-12 race-coverage pattern), through the REAL WP-8 store and
 * the REAL two-class boundary.
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
  correlationReceiptPayload,
  nextRecordId,
  RECEIPT_RECORD_ID,
  PUBLICATION_RECORD_ID,
  WS_A,
  FIXED_NOW,
} from './wp15-phase2-helpers.js';
import { seedRawRecord, seedPayload } from './wp12-helpers.js';
import { expectedOutcomePayload, expectedPublicationPayload } from './wp15-phase1b-helpers.js';
import { buildExecutionAttemptRecordPayload, buildValidationRecordPayload } from '../../src/control-plane/records.js';
import { createProcessLocalCoordinator } from '../../src/control-plane/coordination.js';

const REQUEST = { workspaceId: WS_A, predecessorPublicationRecordId: PUBLICATION_RECORD_ID, trustedReceiptRecordId: RECEIPT_RECORD_ID };

test('phase2 concurrency: same predecessor + same receipt — exactly one successor and one supersession; the second caller replays consistently', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const shared = createProcessLocalCoordinator();
    const first = correlatedOf(env.authority({ coordinate: shared }).correlate(REQUEST));
    assert.equal(first.outcome, 'correlated');
    const second = correlatedOf(env.authority({ coordinate: shared }).correlate(REQUEST));
    assert.equal(second.outcome, 'replayed', 'all successful callers resolve consistently to the single durable transition');
    assert.equal(second.successorRecordId, first.successorRecordId);
    assert.equal(second.supersessionRecordId, first.supersessionRecordId);
    assert.equal(second.successorAuditEventId, undefined, 'the replaying caller emits no successful-write audit');
    assert.equal(second.supersessionAuditEventId, undefined);
    assert.equal(env.publicationRecords().length, 2, 'exactly one successor publication');
    assert.equal(env.supersessionRecords().length, 1, 'exactly one supersession');
  } finally {
    correlationCleanup();
  }
});

test('phase2 concurrency: same predecessor + divergent receipt — fail closed; no competing successor', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const shared = createProcessLocalCoordinator();
    const first = correlatedOf(env.authority({ coordinate: shared }).correlate(REQUEST));
    assert.equal(first.outcome, 'correlated');
    // A second receipt ALSO attesting the same predecessor (same event
    // source, distinct receipt identity) is a divergent unlocking
    // correlation: the durable transition already binds the FIRST receipt.
    const secondReceiptId = nextRecordId();
    seedRawRecord(env.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(env.registryCtx, env.chain, { record_id: secondReceiptId }));
    const second = failedOf(env.authority({ coordinate: shared }).correlate({ ...REQUEST, trustedReceiptRecordId: secondReceiptId }));
    assert.equal(second.category, 'CORRELATION-PREDECESSOR-NOT-CURRENT');
    assert.equal(second.code, 'predecessor.superseded-divergent');
    assert.equal(env.publicationRecords().length, 2, 'no competing successor');
    assert.equal(env.supersessionRecords().length, 1);
  } finally {
    correlationCleanup();
  }
});

test('phase2 concurrency: independent predecessors — independent correlation keys, both transitions complete (no global serialization)', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    // A second independent predecessor: ordinal-2 attempt of the same
    // occurrence with its own outcome, validation, publication, and receipt.
    const secondAttemptId = 'pgw:a:' + '2'.repeat(32);
    const secondAttemptRecordId = 'pgw:l:' + 'b'.repeat(32);
    const secondValidationId = 'pgw:l:' + 'd'.repeat(32);
    const secondInstanceId = 'pgw:i:' + 'a'.repeat(32);
    const secondRevisionId = 'pgw:r:' + 'a'.repeat(32);
    const secondDigest = 'sha-256:' + '1'.repeat(64);
    const secondPublicationId = 'pgw:l:' + 'e'.repeat(32);
    const secondReceiptId = 'pgw:l:' + 'f'.repeat(32);
    seedPayload(env.store, 'execution-attempt-record', buildExecutionAttemptRecordPayload({
      recordId: secondAttemptRecordId, createdAt: FIXED_NOW, activationRecordId: env.chain.activationRecordId,
      occurrenceId: env.chain.occurrenceId, attemptId: secondAttemptId, ordinal: 2,
      bundle: env.chain.bundleReference, workspaceId: WS_A, runtimeGrantId: env.chain.grantId, registry: env.registryCtx,
    }));
    seedRawRecord(env.integration.storeEnv, 'execution-outcome-record', expectedOutcomePayload({
      registryCtx: env.registryCtx, chain: env.chain, disposition: 'completed', withEnforcement: false, withAssociation: true,
      overrides: {
        record_id: nextRecordId(),
        attempt_id: secondAttemptId,
        execution_attempt_record_id: secondAttemptRecordId,
        ordinal: 2,
        result_association: {
          instance_id: secondInstanceId,
          revision_digest: secondDigest,
          association_mode: 'adopted',
          validation_record_id: secondValidationId,
        },
      },
    }));
    seedRawRecord(env.integration.storeEnv, 'validation-record', buildValidationRecordPayload({
      recordId: secondValidationId,
      createdAt: FIXED_NOW,
      subject: {
        protocolId: 'project-gateway.artifact',
        protocolVersion: '1.0',
        kindId: 'ExecutionResult' as never,
        kindVersion: '1.0',
        instanceId: secondInstanceId,
        revisionId: secondRevisionId,
        digest: secondDigest,
        workspaceId: WS_A,
      },
      registry: env.registryCtx,
    }));
    seedRawRecord(env.integration.storeEnv, 'result-publication-record', expectedPublicationPayload(env.registryCtx, env.chain, {
      record_id: secondPublicationId,
      attempt_id: secondAttemptId,
      result_subject: Object.freeze({
        protocol_version: '1.0',
        kind: Object.freeze({ id: 'ExecutionResult', version: '1.0' }),
        instance_id: secondInstanceId,
        revision_id: secondRevisionId,
        digest: secondDigest,
        workspace_id: WS_A,
      }),
      validation_record_id: secondValidationId,
    }));
    seedRawRecord(env.integration.storeEnv, 'trusted-receipt', correlationReceiptPayload(env.registryCtx, env.chain, {
      record_id: secondReceiptId,
      event_record_id: secondPublicationId,
      attempt_id: secondAttemptId,
    }));

    const shared = createProcessLocalCoordinator();
    const first = correlatedOf(env.authority({ coordinate: shared }).correlate(REQUEST));
    const second = correlatedOf(env.authority({ coordinate: shared }).correlate({ ...REQUEST, predecessorPublicationRecordId: secondPublicationId, trustedReceiptRecordId: secondReceiptId }));
    assert.equal(first.outcome, 'correlated');
    assert.equal(second.outcome, 'correlated');
    assert.notEqual(first.successorRecordId, second.successorRecordId);
    assert.notEqual(first.supersessionRecordId, second.supersessionRecordId);
    assert.equal(env.publicationRecords().length, 4, 'two predecessors + two successors');
    assert.equal(env.supersessionRecords().length, 2);
  } finally {
    correlationCleanup();
  }
});

test('phase2 concurrency: exact claimant seeded in-lock (hook) — resolves as idempotent replay of the discovered durable successor', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    let seededId = '';
    const identity = makeCountingCorrelationIdentity();
    const result = correlatedOf(env.authority({
      identity,
      hooks: {
        beforeFirstSuccessorPublication() {
          // The exact durable successor appears under the lock (a concurrent
          // writer completed the successor write).
          seededId = env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, nextRecordId(), FIXED_NOW));
        },
      },
    }).correlate(REQUEST));
    assert.equal(result.outcome, 'recovered', 'the under-lock claimant discovery reuses the durable successor');
    assert.equal(result.successorRecordId, seededId);
    assert.equal(result.successorAuditEventId, undefined, 'no successor write audit for the reused successor');
    assert.ok(result.supersessionAuditEventId !== undefined, 'only the missing supersession is newly written');
    assert.equal(env.publicationRecords().length, 2);
    assert.equal(env.supersessionRecords().length, 1);
  } finally {
    correlationCleanup();
  }
});
