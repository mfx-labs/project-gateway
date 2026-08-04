/**
 * WP-5A unit tests: observation model (group H).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectExecutionBundleToPi } from '../../../src/adapters/pi/projection.js';
import { createPiHostBridge, isPiExecutionObservation } from '../../../src/adapters/pi/index.js';
import { buildWorld } from '../helpers.js';
import { mockSurface, fire, type MockSurface } from './mock-surface.js';

function worldWithPlan() {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  return { world, plan: result.ok ? result.plan : undefined! };
}

test('H: observation is immutable', () => {
  const { plan } = worldWithPlan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, plan);
  assert.equal(created.ok, true);
  const bridge = created.bridge!;
  fire(surface, 'session_start', { reason: 'startup' }, { sessionManager: { getSessionId: () => 'sess-1' } });
  fire(surface, 'turn_start', { turnIndex: 0, timestamp: 1000 });
  fire(surface, 'message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } });
  fire(surface, 'agent_settled', {});
  fire(surface, 'session_shutdown', { reason: 'quit' });
  const observation = bridge.observe();
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(Object.isFrozen(observation.toolCalls), true);
  assert.throws(() => {
    'use strict';
    (observation as { completionStatus: string }).completionStatus = 'completed';
  });
});

test('H: observation is runtime branded; forged observation rejected', () => {
  const { plan } = worldWithPlan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, plan);
  const observation = created.bridge!.observe();
  assert.equal(isPiExecutionObservation(observation), true);
  const forged = { ...observation };
  assert.equal(isPiExecutionObservation(forged), false);
});

test('H: occurrence and attempt preserved', () => {
  const { plan } = worldWithPlan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, plan);
  const observation = created.bridge!.observe();
  assert.equal(observation.occurrenceId, plan.occurrenceId);
  assert.equal(observation.attemptId, plan.attemptId);
  assert.deepEqual(observation.bundleReference, plan.bundleReference);
});

test('H: output clearly not ExecutionResult and not TrustedReceipt', () => {
  const { plan } = worldWithPlan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, plan);
  const observation = created.bridge!.observe();
  assert.equal(observation.isAdapterObservation, true);
  assert.equal(observation.isExecutionResult, false);
  assert.equal(observation.isTrustedReceipt, false);
  assert.equal(observation.impliesAuthorization, false);
  assert.equal(observation.toolObservationImpliesPermission, false);
});

test('H: tool observation does not imply authorization', () => {
  const { plan } = worldWithPlan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, plan);
  const bridge = created.bridge!;
  fire(surface, 'tool_execution_start', { toolCallId: 'call-1', toolName: 'bash', args: { command: 'ls' } });
  fire(surface, 'tool_execution_end', { toolCallId: 'call-1', toolName: 'bash', result: {}, isError: false });
  const observation = bridge.observe();
  assert.equal(observation.toolCalls.length, 2);
  assert.equal(observation.toolObservationImpliesPermission, false);
});

test('H: host timestamp remains observational', () => {
  const { plan } = worldWithPlan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, plan);
  const bridge = created.bridge!;
  fire(surface, 'turn_start', { turnIndex: 0, timestamp: 1234567890 });
  const observation = bridge.observe();
  assert.equal(observation.startObservedAt, '1234567890');
  // the adapter never invents timestamps: with no host events there is none
  const surface2 = mockSurface();
  const created2 = createPiHostBridge(surface2, plan);
  const observation2 = created2.bridge!.observe();
  assert.equal(observation2.startObservedAt, undefined);
});

test('H: stable finding ordering', () => {
  const { plan } = worldWithPlan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, plan);
  const bridge = created.bridge!;
  // session restart produces a correlation finding
  fire(surface, 'session_start', { reason: 'new' });
  const a = bridge.observe();
  const b = bridge.observe();
  assert.deepEqual(a.findings, b.findings);
  assert.ok(a.findings.some((f) => f.key === 'observation.session-restart'));
});

test('H: completion observation captured from message_end', () => {
  const { plan } = worldWithPlan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, plan);
  const bridge = created.bridge!;
  fire(surface, 'session_start', { reason: 'startup' }, { sessionManager: { getSessionId: () => 'sess-9' } });
  fire(surface, 'turn_start', { turnIndex: 0, timestamp: 1 });
  fire(surface, 'message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'final output' }] } });
  fire(surface, 'agent_settled', {});
  fire(surface, 'session_shutdown', { reason: 'quit' });
  const observation = bridge.observe();
  assert.equal(observation.completionStatus, 'completed');
  assert.equal(observation.completionText, 'final output');
  assert.equal(observation.completeness, 'complete');
  assert.equal(observation.sessionCorrelationId, 'sess-9');
  assert.equal(observation.turnCorrelationId, 'turn:0');
});

test('H: cancellation observation', () => {
  const { plan } = worldWithPlan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, plan);
  const bridge = created.bridge!;
  fire(surface, 'turn_start', { turnIndex: 0, timestamp: 1 });
  bridge.recordCancellation();
  const observation = bridge.observe();
  assert.equal(observation.cancellationObserved, true);
  assert.equal(observation.completionStatus, 'cancelled');
  assert.equal(observation.completeness, 'cancelled');
  // observe({cancelled:true}) also records host cancellation
  const surface2 = mockSurface();
  const created2 = createPiHostBridge(surface2, plan);
  const observation2 = created2.bridge!.observe({ cancelled: true });
  assert.equal(observation2.completionStatus, 'cancelled');
});

test('H: host error observation', () => {
  const { plan } = worldWithPlan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, plan);
  const bridge = created.bridge!;
  fire(surface, 'tool_execution_start', { toolCallId: 'call-1', toolName: 'read', args: { path: 'x' } });
  fire(surface, 'tool_execution_end', { toolCallId: 'call-1', toolName: 'read', result: {}, isError: true });
  const observation = bridge.observe();
  assert.equal(observation.completionStatus, 'error');
  assert.equal(observation.hostErrors.length, 1);
});

export type { MockSurface };
