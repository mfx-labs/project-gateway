/**
 * WP-15 Phase 1B — trusted receipt producer: concurrency + replay/conflict
 * under the event-subject coordination lock (§12/§13/§21).
 *
 * Real initialized WP-8 store, real single-class receipt boundary +
 * capability, real process-local coordinator. The core is synchronous, so
 * "concurrent" is exercised as serialized acquisitions of the same
 * event-subject key plus the in-lock hook seam (WP-12 race-coverage
 * pattern): a hook-seeded claimant is discovered by the under-lock claimant
 * enumeration and resolves as replay or conflict — never a double write.
 * Correctness never depends on an in-memory cache: every call re-reads
 * fresh durable state.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { issueTrustedReceipt } from '../../src/receipt-production/index.js';
import { createProcessLocalCoordinator, LockContentionError } from '../../src/control-plane/coordination.js';
import {
  makeReceiptEnv,
  issuedOf,
  failedOf,
  receiptCleanup,
  expectedReceiptPayload,
  seedOutcomeFor,
  seedOutcome,
  expectedOutcomePayload,
  makeCountingReceiptIdentity,
  nextRecordId,
  WS_A,
  FIXED_NOW,
  OCCURRENCE_ID,
  ATTEMPT_ID,
  ATTEMPT_RECORD_ID,
} from './wp15-phase1b-helpers.js';
import { seedPayload } from './wp12-helpers.js';
import { buildExecutionAttemptRecordPayload } from '../../src/control-plane/records.js';
import type { ReceiptRequest } from '../../src/receipt-production/types.js';

after(receiptCleanup);

const REQUEST: ReceiptRequest = { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: ATTEMPT_RECORD_ID };

test('P1B: concurrent exact same issuance — exactly one durable receipt; the second caller resolves as replayed', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const shared = createProcessLocalCoordinator();
  const first = issuedOf(issueTrustedReceipt(env.input({ request: REQUEST, coordinate: shared })));
  assert.equal(first.outcome, 'issued');
  const second = issuedOf(issueTrustedReceipt(env.input({ request: REQUEST, coordinate: shared })));
  assert.equal(second.outcome, 'replayed', 'all successful callers resolve consistently to the single durable receipt');
  assert.equal(second.recordId, first.recordId);
  assert.equal(env.receiptRecords().length, 1, 'exactly one durable receipt for the event subject');
  assert.equal(env.receiptPublishCount(), 1, 'exactly one durable write');
  assert.equal(second.auditEventId, undefined, 'the replaying caller emits no successful-write audit');
});

test('P1B: event-subject lock contention — a second in-flight decision for the same subject fails closed as lock-conflict', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const shared = createProcessLocalCoordinator();
  const key = `trusted-receipt|attempt-end|${ATTEMPT_RECORD_ID}`;
  let inner: ReturnType<typeof issuedOf> | undefined;
  let innerFailure: { readonly category: string; readonly code: string } | undefined;
  shared.withLock(key, () => {
    // Re-entrant acquisition of the SAME event-subject key from inside the
    // held lock is contention (the coordinator is a reentrancy guard).
    const result = issueTrustedReceipt(env.input({ request: REQUEST, coordinate: shared }));
    if (result.ok) inner = result;
    else innerFailure = { category: result.category, code: result.code };
  });
  assert.equal(inner, undefined, 'the inner acquisition must fail closed');
  assert.deepEqual(innerFailure, { category: 'RECEIPT-LOCK-CONFLICT', code: 'lock.conflict' });
  assert.equal(env.receiptRecords().length, 0);
  // A plain LockContentionError raised by a host coordinator maps to the same typed result.
  const throwing = {
    withLock<T>(_key: string, _fn: () => T): T {
      throw new LockContentionError(key);
    },
  };
  const mapped = failedOf(issueTrustedReceipt(env.input({ coordinate: throwing })));
  assert.deepEqual(mapped, { category: 'RECEIPT-LOCK-CONFLICT', code: 'lock.conflict' });
});

test('P1B: divergent claimant seeded in-lock (hook) — fail closed as conflict, no double-write', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const identity = makeCountingReceiptIdentity();
  const result = failedOf(issueTrustedReceipt(env.input({
    request: REQUEST,
    identity,
    hooks: {
      beforeFirstReceiptPublication() {
        // A divergent durable claimant appears for the same event subject
        // while the decision holds the lock.
        env.seedReceipt(expectedReceiptPayload(env.registryCtx, REQUEST, 'crashed', OCCURRENCE_ID, ATTEMPT_ID, nextRecordId(), FIXED_NOW));
      },
    },
  })));
  assert.deepEqual(result, { category: 'RECEIPT-CONFLICT', code: 'conflict.material-divergence' });
  assert.equal(identity.calls.recordId, 0, 'no allocation on the conflicted path');
  assert.equal(env.receiptRecords().length, 1, 'the divergent claimant stays; no second write');
});

test('P1B: exact claimant seeded in-lock (hook) — resolves as idempotent replay of the discovered durable receipt', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const identity = makeCountingReceiptIdentity();
  let seededId = '';
  const result = issuedOf(issueTrustedReceipt(env.input({
    request: REQUEST,
    identity,
    hooks: {
      beforeFirstReceiptPublication() {
        seededId = env.seedReceipt(expectedReceiptPayload(env.registryCtx, REQUEST, 'completed', OCCURRENCE_ID, ATTEMPT_ID, nextRecordId(), FIXED_NOW));
      },
    },
  })));
  assert.equal(result.outcome, 'replayed', 'the under-lock claimant enumeration discovers the exact receipt');
  assert.equal(result.recordId, seededId);
  assert.equal(identity.calls.recordId, 0, 'zero new IDs');
  assert.equal(env.receiptPublishCount(), 0, 'zero durable writes');
  assert.equal(env.receiptRecords().length, 1);
});

test('P1B: throwing in-lock hook — typed internal failure, no write', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  const result = failedOf(issueTrustedReceipt(env.input({
    request: REQUEST,
    hooks: {
      beforeFirstReceiptPublication() {
        throw new Error('hook boom');
      },
    },
  })));
  assert.deepEqual(result, { category: 'RECEIPT-INTERNAL-FAILURE', code: 'internal.hook-failure' });
  assert.equal(env.receiptRecords().length, 0);
});

test('P1B: independent event subjects run under independent keys (no global serialization)', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  // Second attempt of the same occurrence (ordinal 2 needs its ordinal-1
  // sibling for the shared retrospective path; seed it).
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
  const shared = createProcessLocalCoordinator();
  const first = issuedOf(issueTrustedReceipt(env.input({ request: REQUEST, coordinate: shared })));
  const second = issuedOf(issueTrustedReceipt(env.input({
    request: { workspaceId: WS_A, eventType: 'attempt-end', eventRecordId: secondAttemptRecordId },
    coordinate: shared,
  })));
  assert.equal(first.outcome, 'issued');
  assert.equal(second.outcome, 'issued');
  assert.equal(env.receiptRecords().length, 2);
  assert.notEqual(first.recordId, second.recordId);
});

test('P1B: replay after cold read is cache-independent — a fresh env (cold store view) replays from durable state', () => {
  const env = makeReceiptEnv();
  seedOutcomeFor(env, 'completed');
  // Seed the exact durable receipt BEFORE the authority instance exists.
  const seededId = env.seedReceipt(expectedReceiptPayload(env.registryCtx, REQUEST, 'completed', OCCURRENCE_ID, ATTEMPT_ID, nextRecordId(), FIXED_NOW));
  // A second authority over the same store has no in-memory knowledge of the first.
  const identity = makeCountingReceiptIdentity();
  const result = issuedOf(issueTrustedReceipt(env.input({ request: REQUEST, identity })));
  assert.equal(result.outcome, 'replayed');
  assert.equal(result.recordId, seededId);
  assert.equal(env.receiptPublishCount(), 0);
});
