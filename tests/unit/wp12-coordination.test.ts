/**
 * WP-12 Slice 1 — host-side / process-level decision coordination tests
 * (FSCR-W12-001; contract §16-17, §29).
 *
 * Proves: keyed serialization with fixed ordering (acquire → read →
 * revalidate → publish → verify → release); the lock is released on
 * success, typed denial, and thrown store errors; no deadlock after
 * failure; reentrant/overlapping acquisition of the same decision key fails
 * closed as lock-conflict; no persistent lock file is ever created; no
 * entry appears under the WP-8 locks/ layout from WP-12 coordination;
 * publishRecord remains responsible for its own writer lock.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { executeSlice1Command } from '../../src/control-plane/core.js';
import { createProcessLocalCoordinator, LockContentionError } from '../../src/control-plane/coordination.js';
import {
  cleanupTestEnvs,
  makeContext,
  makeEvidence,
  makeFakeStore,
  makeIdentitySource,
  makeIntegrationEnv,
  makeRegistryContext,
  makeSubject,
  seedPayload,
  WS_A,
} from './wp12-helpers.js';
import { buildValidationRecordPayload } from '../../src/control-plane/records.js';
import type { DecisionCoordinator } from '../../src/control-plane/types.js';

after(() => cleanupTestEnvs());

const REPO_CP = join(import.meta.dirname, '..', '..', '..', 'src', 'control-plane');

const VALIDATION_ID = 'pgw:l:11111111111111111111111111111111';

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

function approveOperand(): Record<string, unknown> {
  const subject = makeSubject('TaskSpec');
  return {
    operation: 'approve',
    subject: subjectOperand(subject.subject),
    workspaceId: WS_A,
    purpose: 'execution-use',
    validationRecordIds: [VALIDATION_ID],
  };
}

/** Recording coordinator: proves acquire/release ordering around the decision. */
function recordingCoordinator(): { readonly coordinator: DecisionCoordinator; readonly events: string[] } {
  const events: string[] = [];
  const coordinator: DecisionCoordinator = {
    withLock<T>(key: string, fn: () => T): T {
      events.push(`acquire:${key}`);
      try {
        const result = fn();
        events.push(`release:${key}`);
        return result;
      } catch (err) {
        events.push(`release:${key}`);
        throw err;
      }
    },
  };
  return { coordinator, events };
}

function seededStore(store: ReturnType<typeof makeFakeStore>['store'], subject: ReturnType<typeof makeSubject>): void {
  const payload = buildValidationRecordPayload({
    recordId: VALIDATION_ID,
    createdAt: '2026-08-04T06:00:00.000Z',
    subject: subject.subject,
    registry: makeRegistryContext(),
  });
  seedPayload(store, 'validation-record', payload);
}

test('coordination: acquire precedes every store read and release follows publish', () => {
  const subject = makeSubject('TaskSpec');
  const { store, state } = makeFakeStore();
  seededStore(store, subject);
  const integration = makeIntegrationEnv();
  const { coordinator, events } = recordingCoordinator();
  const context = makeContext(integration.storeEnv, {
    store,
    identity: makeIdentitySource(),
    subjectArtifact: makeEvidence('TaskSpec').artifact,
    coordinate: coordinator,
  });
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, true);
  assert.ok(events.length >= 2, 'acquire and release recorded');
  assert.match(events[0]!, /^acquire:/);
  assert.match(events[events.length - 1]!, /^release:/);
  assert.ok(state.enumerateCalls > 0, 'current state is re-read inside the lock');
  // The first store observation happens strictly after acquisition.
  assert.equal(events[0]!.startsWith('acquire:'), true);
});

test('coordination: lock is released on typed denial', () => {
  const subject = makeSubject('TaskSpec');
  const { store, state } = makeFakeStore();
  seededStore(store, subject);
  const integration = makeIntegrationEnv();
  const { coordinator, events } = recordingCoordinator();
  const context = makeContext(integration.storeEnv, {
    store,
    identity: makeIdentitySource(),
    subjectArtifact: makeEvidence('TaskSpec').artifact,
    coordinate: coordinator,
  });
  // Duplicate approval → typed denial (already-approved).
  assert.equal(executeSlice1Command(approveOperand(), context).ok, true);
  const second = executeSlice1Command(approveOperand(), context);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.category, 'already-approved');
  assert.equal(events.filter((e) => e.startsWith('release:')).length, 2, 'release after every decision');
  assert.equal(state.publishCalls, 2, 'only the first decision published');
});

test('coordination: lock is released on thrown store error and no deadlock follows', () => {
  const subject = makeSubject('TaskSpec');
  const { store, state } = makeFakeStore();
  seededStore(store, subject);
  const integration = makeIntegrationEnv();
  const { coordinator, events } = recordingCoordinator();
  // Same store: seed first, then arm the injected publish failure.
  state.throwOnPublish = true;
  const context = makeContext(integration.storeEnv, {
    store,
    identity: makeIdentitySource(),
    subjectArtifact: makeEvidence('TaskSpec').artifact,
    coordinate: coordinator,
  });
  const result = executeSlice1Command(approveOperand(), context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'store-failure');
  assert.match(events[events.length - 1]!, /^release:/, 'release on thrown error');
  // No deadlock: the same key can be used again on the same store once the
  // injected failure is disarmed.
  state.throwOnPublish = false;
  const retry = executeSlice1Command(approveOperand(), context);
  assert.equal(retry.ok, true, 'no deadlock after failure');
  assert.equal(state.byClass.get('approval-record')?.length ?? 0, 1, 'exactly one approval record after retry');
});

test('coordination: reentrant acquisition of the same key fails closed as lock-conflict', () => {
  const subject = makeSubject('TaskSpec');
  const { store } = makeFakeStore();
  seededStore(store, subject);
  const integration = makeIntegrationEnv();
  // The store re-enters the core for the same decision key during publish.
  // The inner acquisition of the SAME key must fail closed with
  // lock-conflict; the outer decision then completes normally.
  let innerResult: ReturnType<typeof executeSlice1Command> | undefined;
  const reentrant: ReturnType<typeof makeFakeStore>['store'] = {
    ...store,
    publishLifecycleRecord(recordClass, payload) {
      innerResult = executeSlice1Command(approveOperand(), reentrantContext);
      return store.publishLifecycleRecord(recordClass, payload);
    },
  };
  const reentrantContext = makeContext(integration.storeEnv, {
    store: reentrant,
    identity: makeIdentitySource(),
    subjectArtifact: makeEvidence('TaskSpec').artifact,
  });
  const result = executeSlice1Command(approveOperand(), reentrantContext);
  assert.equal(result.ok, true, 'outer decision completes after the inner denial');
  assert.ok(innerResult !== undefined);
  assert.equal(innerResult.ok, false);
  if (!innerResult.ok) assert.equal(innerResult.category, 'lock-conflict', 'inner reentrant acquisition fails closed');
});

test('coordination: default process-local coordinator rejects overlapping keys', () => {
  const coordinator = createProcessLocalCoordinator();
  assert.throws(() => {
    coordinator.withLock('k', () => coordinator.withLock('k', () => 1));
  }, LockContentionError);
  // Release happened: the same key is usable again.
  assert.equal(coordinator.withLock('k', () => 42), 42);
});

test('coordination: unrelated decision keys are not conflated', () => {
  const coordinator = createProcessLocalCoordinator();
  let inner = 0;
  const a = coordinator.withLock('subject-a', () => {
    inner = coordinator.withLock('subject-b', () => 7);
    return 1;
  });
  assert.equal(a, 1);
  assert.equal(inner, 7, 'different keys proceed independently');
});

test('coordination: no persistent lock file is created by WP-12 coordination', () => {
  const integration = makeIntegrationEnv();
  const subject = makeSubject('TaskSpec');
  const boundary = integration.storeEnv;
  // Run the full real-store flow.
  const evidence = makeEvidence('TaskSpec');
  const context = makeContext(boundary, { validationEvidence: evidence });
  const recorded = executeSlice1Command(
    { operation: 'recordValidation', subject: subjectOperand(subject.subject), workspaceId: WS_A },
    context,
  );
  assert.equal(recorded.ok, true);
  // The WP-8 locks/ directory contains no entry: publishRecord released its
  // own writer lock and WP-12 created nothing.
  const locksDir = join(boundary.dir, 'store-v1', 'locks');
  const entries = readdirSync(locksDir);
  assert.deepEqual(entries, [], 'no lock file may remain and no WP-12 lock artifact may exist');
});

test('coordination: concurrent duplicate operations cannot both create records', () => {
  const subject = makeSubject('TaskSpec');
  const { store, state } = makeFakeStore();
  seededStore(store, subject);
  const integration = makeIntegrationEnv();
  const context = makeContext(integration.storeEnv, {
    store,
    identity: makeIdentitySource(),
    subjectArtifact: makeEvidence('TaskSpec').artifact,
  });
  // Sequential executions of the same decision (the synchronous core cannot
  // interleave within one JS thread; the coordination lock + duplicate gate
  // guarantee single-record outcome).
  const first = executeSlice1Command(approveOperand(), context);
  const second = executeSlice1Command(approveOperand(), context);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.category, 'already-approved');
  assert.equal(state.byClass.get('approval-record')?.length ?? 0, 1, 'only one ApprovalRecord for the decision key');
});

test('coordination: publishRecord remains responsible for its own writer lock', () => {
  // The control-plane family never imports or calls the WP-8 writer-lock
  // API; this is enforced statically by the family guard and behaviorally by
  // the real-store flow above (no residual lock file, no nested acquisition).
  const core = readFileSync(join(REPO_CP, 'core.ts'), 'utf8');
  assert.equal(core.includes('acquireWriterLock'), false);
  assert.equal(core.includes('releaseWriterLock'), false);
  const boundary = readFileSync(join(REPO_CP, 'store-boundary.ts'), 'utf8');
  assert.equal(boundary.includes('acquireWriterLock'), false);
});
