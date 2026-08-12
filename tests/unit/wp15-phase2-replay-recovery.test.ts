/**
 * WP-15 Phase 2 — correlation replay/recovery + partial-state tests (§22).
 *
 * State A/B/C/D/E semantics through the REAL WP-8 store and the REAL
 * two-class boundary: crash-after-successor retry (State B recovery),
 * crash-after-supersession cold restart (State E replay), divergent
 * successor/supersession inserted under the held lock (States C/D), and
 * zero-allocation guarantees on every replay/conflict path.
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
  nextRecordId,
  RECEIPT_RECORD_ID,
  PUBLICATION_RECORD_ID,
  WS_A,
  FIXED_NOW,
} from './wp15-phase2-helpers.js';
import { createProcessLocalCoordinator, LockContentionError } from '../../src/control-plane/coordination.js';

const REQUEST = { workspaceId: WS_A, predecessorPublicationRecordId: PUBLICATION_RECORD_ID, trustedReceiptRecordId: RECEIPT_RECORD_ID };

test('phase2 recovery: crash after successor write — typed incomplete failure, then exact retry completes only the supersession (State B)', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    let hookCalls = 0;
    // One-shot crash: the first attempt dies between the successor write and
    // the supersession write.
    const hooks = {
      beforeFirstSupersessionPublication() {
        hookCalls += 1;
        if (hookCalls === 1) throw new Error('crash after successor write');
      },
    };
    const first = failedOf(env.authority({ hooks }).correlate(REQUEST));
    assert.equal(first.category, 'CORRELATION-INTERNAL-FAILURE');
    assert.equal(first.code, 'internal.hook-failure');
    // the durable successor exists; NO supersession exists (State B)
    assert.equal(env.publicationRecords().length, 2, 'the successor write stayed durable');
    assert.equal(env.supersessionRecords().length, 0, 'no supersession was written before the crash');
    // exact retry discovers the durable successor, allocates ZERO new
    // successor IDs, writes ZERO duplicate successor records, publishes the
    // exact missing SupersessionRecord, and only then reports success.
    const identity = makeCountingCorrelationIdentity();
    const retry = env.authority({ identity, hooks }).correlate(REQUEST);
    const ok = correlatedOf(retry);
    assert.equal(ok.outcome, 'recovered');
    assert.equal(ok.successorAuditEventId, undefined, 'the retry claims no successor write audit');
    assert.ok(ok.supersessionAuditEventId !== undefined, 'the retry claims exactly the new supersession write audit');
    assert.equal(identity.calls.recordId, 1, 'only the supersession identity was allocated');
    assert.equal(env.supersessionRecords().length, 1);
    assert.equal(env.publicationRecords().length, 2, 'no duplicate successor record');
  } finally {
    correlationCleanup();
  }
});

test('phase2 recovery: crash after supersession durable before response — cold restart replays the exact complete transition (State E)', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    // Complete the transition in a first authority instance.
    const first = correlatedOf(env.authority().correlate(REQUEST));
    assert.equal(first.outcome, 'correlated');
    // Simulate the response being lost: a SECOND authority instance over the
    // same durable store (no in-memory knowledge) retries the transition.
    const identity = makeCountingCorrelationIdentity();
    const retry = correlatedOf(env.authority({ identity }).correlate(REQUEST));
    assert.equal(retry.outcome, 'replayed');
    assert.equal(retry.successorRecordId, first.successorRecordId);
    assert.equal(retry.supersessionRecordId, first.supersessionRecordId);
    assert.equal(retry.successorAuditEventId, undefined);
    assert.equal(retry.supersessionAuditEventId, undefined);
    assert.equal(identity.calls.recordId, 0, 'replay allocates zero new IDs');
    assert.equal(env.publicationRecords().length, 2);
    assert.equal(env.supersessionRecords().length, 1);
  } finally {
    correlationCleanup();
  }
});

test('phase2 recovery: divergent successor inserted under the held lock — conflict, zero new IDs, no competing successor (State C)', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const identity = makeCountingCorrelationIdentity();
    const result = failedOf(env.authority({
      identity,
      hooks: {
        beforeFirstSuccessorPublication() {
          // A divergent same-subject publication appears under the lock.
          env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, nextRecordId(), FIXED_NOW, { publication_scopes: ['ordinary-review'] }));
        },
      },
    }).correlate(REQUEST));
    assert.equal(result.category, 'CORRELATION-SUCCESSOR-CONFLICT');
    assert.equal(result.code, 'successor.material-divergence');
    assert.equal(identity.calls.recordId, 0, 'no allocation on the conflicted path');
    assert.equal(env.publicationRecords().length, 2, 'the divergent claimant stays; no competing successor write');
    assert.equal(env.supersessionRecords().length, 0);
  } finally {
    correlationCleanup();
  }
});

test('phase2 recovery: divergent supersession inserted under the held lock — fail closed, no write (State D)', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const identity = makeCountingCorrelationIdentity();
    const result = failedOf(env.authority({
      identity,
      hooks: {
        beforeFirstSuccessorPublication() {
          // A divergent supersession claimant (with a divergent named
          // successor) appears under the lock.
          const divergentId = env.seedPublicationRaw(expectedSuccessorPayload(env.registryCtx, env.chain, RECEIPT_RECORD_ID, nextRecordId(), FIXED_NOW, { publication_scopes: ['ordinary-review'] }));
          env.seedSupersession(expectedSupersessionPayload(env.registryCtx, PUBLICATION_RECORD_ID, divergentId, nextRecordId(), FIXED_NOW));
        },
      },
    }).correlate(REQUEST));
    assert.equal(result.category, 'CORRELATION-PREDECESSOR-NOT-CURRENT');
    assert.equal(result.code, 'predecessor.superseded-divergent');
    assert.equal(identity.calls.recordId, 0, 'no allocation on the conflicted path');
    assert.equal(env.publicationRecords().length, 2);
    assert.equal(env.supersessionRecords().length, 1, 'the divergent supersession claimant stays; no second supersession');
  } finally {
    correlationCleanup();
  }
});

test('phase2 recovery: throwing in-lock hook — typed internal failure with zero writes', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const result = failedOf(env.authority({
      hooks: {
        beforeFirstSuccessorPublication() {
          throw new Error('hook boom');
        },
      },
    }).correlate(REQUEST));
    assert.equal(result.category, 'CORRELATION-INTERNAL-FAILURE');
    assert.equal(result.code, 'internal.hook-failure');
    assert.equal(env.publicationRecords().length, 1, 'only the predecessor exists');
    assert.equal(env.supersessionRecords().length, 0);
  } finally {
    correlationCleanup();
  }
});

test('phase2 recovery: lock contention for the same predecessor — typed lock-conflict, zero writes', () => {
  const env = makeCorrelationEnv();
  try {
    env.seedBase();
    const shared = createProcessLocalCoordinator();
    const key = `receipt-publication-correlation|${PUBLICATION_RECORD_ID}`;
    let inner: { readonly ok: boolean; readonly category?: string; readonly code?: string } | undefined;
    shared.withLock(key, () => {
      // Re-entrant acquisition of the SAME correlation key from inside the
      // held lock is contention (the coordinator is a reentrancy guard).
      const result = env.authority({ coordinate: shared }).correlate(REQUEST);
      inner = result.ok ? { ok: true } : { ok: false, category: result.category, code: result.code };
    });
    assert.deepEqual(inner, { ok: false, category: 'CORRELATION-LOCK-CONFLICT', code: 'lock.conflict' });
    assert.equal(env.publicationRecords().length, 1);
    assert.equal(env.supersessionRecords().length, 0);
    // A plain LockContentionError raised by a host coordinator maps to the
    // same typed result.
    const throwing = {
      withLock<T>(_k: string, _fn: () => T): T {
        throw new LockContentionError(key);
      },
    };
    const mapped = failedOf(env.authority({ coordinate: throwing as never }).correlate(REQUEST));
    assert.equal(mapped.category, 'CORRELATION-LOCK-CONFLICT');
    assert.equal(mapped.code, 'lock.conflict');
  } finally {
    correlationCleanup();
  }
});
