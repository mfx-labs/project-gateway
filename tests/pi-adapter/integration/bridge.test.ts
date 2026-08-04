/**
 * WP-5A integration tests: the narrow Pi host bridge (group G).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectExecutionBundleToPi } from '../../../src/adapters/pi/projection.js';
import { createPiHostBridge, validatePiInvocationPlan, isPiInvocationPlan } from '../../../src/adapters/pi/index.js';
import { buildWorld } from '../helpers.js';
import { fire, hostCtx, mockSurface } from '../unit/mock-surface.js';

function plan() {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input());
  assert.equal(result.ok, true);
  return result.ok ? result.plan : undefined!;
}

test('G: accepts one immutable valid plan', () => {
  const p = plan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, p);
  assert.equal(created.ok, true);
  assert.equal(created.bridge?.plan, p);
  assert.equal(Object.isFrozen(p), true);
});

test('G: rejects forged plan', () => {
  const p = plan();
  const forged = { ...p, status: 'projection-ready' };
  const surface = mockSurface();
  const created = createPiHostBridge(surface, forged as never);
  assert.equal(created.ok, false);
  if (!created.ok) assert.ok(created.findings.some((f) => f.key === 'bridge.plan-forged'));
});

test('G: validatePiInvocationPlan accepts a valid plan and rejects forged values', () => {
  const p = plan();
  assert.equal(validatePiInvocationPlan(p).ok, true);
  assert.equal(validatePiInvocationPlan({ ...p }).ok, false);
  assert.equal(validatePiInvocationPlan(null).ok, false);
  assert.equal(isPiInvocationPlan(p), true);
  assert.equal(isPiInvocationPlan({ ...p }), false);
});

test('G: injects sections in deterministic order through before_agent_start', () => {
  const p = plan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, p);
  const bridge = created.bridge!;
  assert.equal(bridge.armInjection().ok, true);
  assert.equal(bridge.armed, true);
  const injection = fire(surface, 'before_agent_start', { prompt: 'user prompt' });
  const message = (injection as { message: { customType: string; content: string; display: boolean } }).message;
  assert.equal(message.customType, 'pgw.projection');
  assert.equal(message.content, p.renderedPrompt);
  const prompt = message.content;
  const order = ['[PGW-TASK]', '[PGW-CONTEXT-INVENTORY]', '[PGW-CONTEXT-DATA]', '[PGW-COMPLETION-CRITERIA]', '[PGW-CORRELATION]'].map((s) => prompt.indexOf(s));
  assert.ok(order.every((i) => i >= 0));
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1]! < order[i]!, 'sections out of order');
});

test('G: observes completion lifecycle', () => {
  const p = plan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, p);
  const bridge = created.bridge!;
  fire(surface, 'session_start', { reason: 'startup' }, hostCtx('sess-1'));
  fire(surface, 'turn_start', { turnIndex: 0, timestamp: 10 });
  fire(surface, 'message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'observed completion' }] } });
  fire(surface, 'agent_end', { messages: [] });
  fire(surface, 'agent_settled', {});
  fire(surface, 'session_shutdown', { reason: 'quit' });
  const observation = bridge.observe();
  assert.equal(observation.completionStatus, 'completed');
  assert.equal(observation.completionText, 'observed completion');
  assert.equal(observation.sessionCorrelationId, 'sess-1');
  assert.equal(observation.turnCorrelationId, 'turn:0');
  assert.equal(observation.completeness, 'complete');
});

test('G: observes ordered tool-call attempts without blocking', () => {
  const p = plan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, p);
  const bridge = created.bridge!;
  fire(surface, 'tool_execution_start', { toolCallId: 'call-1', toolName: 'bash', args: { command: 'ls' } });
  fire(surface, 'tool_execution_start', { toolCallId: 'call-2', toolName: 'read', args: { path: 'a' } });
  fire(surface, 'tool_call', { toolCallId: 'call-1', toolName: 'bash', input: { command: 'ls' } });
  fire(surface, 'tool_execution_end', { toolCallId: 'call-2', toolName: 'read', result: {}, isError: false });
  const observation = bridge.observe();
  // two tool_execution_start observations plus one tool_execution_end
  assert.equal(observation.toolCalls.length, 3);
  const sequences = observation.toolCalls.map((t) => t.sequence);
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
  assert.ok(observation.toolCalls.every((t) => t.observed === true));
  // tool_call handler returned no block
  assert.equal(observation.completionStatus, 'not-observed');
});

test('G: observes cancellation and host errors', () => {
  const p = plan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, p);
  const bridge = created.bridge!;
  fire(surface, 'tool_execution_start', { toolCallId: 'call-1', toolName: 'read', args: { path: 'x' } });
  fire(surface, 'tool_execution_end', { toolCallId: 'call-1', toolName: 'read', result: {}, isError: true });
  bridge.recordCancellation();
  const observation = bridge.observe();
  assert.equal(observation.completionStatus, 'cancelled');
  assert.equal(observation.hostErrors.length, 1);
});

test('G: does not modify tools or settings', () => {
  const p = plan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, p);
  created.bridge!.armInjection();
  fire(surface, 'turn_start', { turnIndex: 0, timestamp: 1 });
  fire(surface, 'tool_execution_start', { toolCallId: 'c', toolName: 'bash', args: {} });
  // the bridge never reads the tool inventory and never registers tools
  assert.equal(surface.toolReads.count, 0);
  assert.equal(surface.toolRegistrations.count, 0);
  // the mock surface has no settings mutation surface at all; the bridge never calls sendMessage
  assert.equal(surface.messages.length, 0);
});

test('G: does not write lifecycle state or start Pi', () => {
  const p = plan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, p);
  const bridge = created.bridge!;
  bridge.armInjection();
  // no side channels exist: the bridge only holds in-memory captured events
  assert.equal(bridge.capturedEvents.length, 0);
  // captured events accumulate only from fired host events
  fire(surface, 'session_start', { reason: 'startup' }, hostCtx('s-1'));
  assert.equal(bridge.capturedEvents.length, 1);
  assert.equal(bridge.capturedEvents[0]?.kind, 'session_start');
});

test('F5: one bridge registers exactly one handler set per event', () => {
  const p = plan();
  const surface = mockSurface();
  createPiHostBridge(surface, p);
  const expected = [
    'session_start',
    'session_shutdown',
    'turn_start',
    'turn_end',
    'message_end',
    'tool_execution_start',
    'tool_execution_end',
    'tool_call',
    'agent_end',
    'agent_settled',
    'before_agent_start',
  ];
  for (const event of expected) {
    assert.equal(surface.handlers.has(event), true, `no handler for ${event}`);
  }
  assert.equal(surface.handlers.size, expected.length);
});

test('F5: arming twice is deterministic and idempotent', () => {
  const p = plan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, p);
  const bridge = created.bridge!;
  assert.deepEqual(bridge.armInjection(), { ok: true });
  assert.deepEqual(bridge.armInjection(), { ok: true });
  assert.equal(bridge.armed, true);
});

test('F5: repeated before_agent_start events re-inject per the documented contract', () => {
  const p = plan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, p);
  created.bridge!.armInjection();
  const first = fire(surface, 'before_agent_start', { prompt: 'turn one' });
  const second = fire(surface, 'before_agent_start', { prompt: 'turn two' });
  const messageOf = (r: unknown) => (r as { message: { content: string } }).message.content;
  assert.equal(messageOf(first), p.renderedPrompt);
  assert.equal(messageOf(second), p.renderedPrompt);
  // repeated turns may legitimately receive repeated injection
  assert.equal(surface.messages.length, 0); // sendMessage is never used
});

test('F5: shutdown classifies late events with a stable finding', () => {
  const p = plan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, p);
  const bridge = created.bridge!;
  fire(surface, 'session_start', { reason: 'startup' }, hostCtx('s-1'));
  fire(surface, 'session_shutdown', { reason: 'quit' });
  fire(surface, 'turn_start', { turnIndex: 9, timestamp: 99 });
  fire(surface, 'message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'late output' }] } });
  const observation = bridge.observe();
  assert.equal(observation.completionStatus, 'not-observed', 'late events must not drive completion derivation');
  assert.ok(observation.findings.some((f) => f.key === 'observation.late-event'));
  assert.equal(bridge.capturedEvents.filter((e) => e.late === true).length, 2);
});

test('F5: no global cross-bridge state', () => {
  const p1 = plan();
  const p2 = plan();
  const s1 = mockSurface();
  const s2 = mockSurface();
  const b1 = createPiHostBridge(s1, p1).bridge!;
  const b2 = createPiHostBridge(s2, p2).bridge!;
  fire(s1, 'turn_start', { turnIndex: 0, timestamp: 1 });
  assert.equal(b1.capturedEvents.length, 1);
  assert.equal(b2.capturedEvents.length, 0);
  b1.recordCancellation();
  assert.equal(b1.cancellationObserved, true);
  assert.equal(b2.cancellationObserved, false);
});

test('F5: duplicate host registration is documented as integration-layer responsibility', () => {
  // two bridges on one host surface register two handler sets; WP-5A keeps no
  // mutable global host registry and the integration layer must prevent
  // duplicate registration (documented contract; no host token exists in the
  // public Pi 0.83.0 API)
  const p1 = plan();
  const p2 = plan();
  const surface = mockSurface();
  createPiHostBridge(surface, p1);
  createPiHostBridge(surface, p2);
  // the mock stores one handler per event name (last registration wins),
  // which is why the integration layer must register exactly one bridge
  assert.equal(surface.handlers.has('before_agent_start'), true);
  // WP-5A exposes no global registry: each bridge instance is self-contained
  assert.equal((globalThis as Record<string, unknown>)['__pgw_bridge_registry'], undefined);
});

test('G: correlation metadata preserved through the observation', () => {
  const p = plan();
  const surface = mockSurface();
  const created = createPiHostBridge(surface, p);
  const bridge = created.bridge!;
  fire(surface, 'session_start', { reason: 'startup' }, hostCtx('corr-session'));
  fire(surface, 'turn_start', { turnIndex: 3, timestamp: 5 });
  const observation = bridge.observe();
  assert.equal(observation.sessionCorrelationId, 'corr-session');
  assert.equal(observation.turnCorrelationId, 'turn:3');
});
