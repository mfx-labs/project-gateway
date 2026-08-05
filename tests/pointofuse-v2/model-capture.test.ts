/**
 * WP-6 Phase 3A: bare-model capture tests (contract Section 13; F-P3-EL-21
 * Model A). Bundle/policy/grant have NO runtime brand; descriptor-safe deep
 * capture produces detached deeply frozen plain JSON values. Malformed but
 * JSON-representable semantic content remains capturable for later semantic
 * denial.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureBareModel } from '../../src/pointofuse/index.js';

test('F: valid nested JSON model captures deeply frozen', () => {
  const r = captureBareModel({ instanceId: 'b-1', body: { members: [{ kind: 'TaskSpec', instanceId: 't-1' }] } });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(Object.isFrozen(r.model), true);
  assert.equal(Object.isFrozen((r.model as Record<string, unknown>)['body']), true);
});

test('F: object-key reordering does not affect identity', async () => {
  const a = captureBareModel({ x: 1, y: { z: 2 } });
  const b = captureBareModel({ y: { z: 2 }, x: 1 });
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  // Identity is computed at whole-projection JCS serialization; canonical JCS
  // sorts keys, so the two captured models serialize identically.
  const { jcsSerialize } = await import('../../src/canonical/jcs.js');
  assert.equal(jcsSerialize(a.model), jcsSerialize(b.model));
});

test('F: array order remains meaningful', async () => {
  const a = captureBareModel({ list: [1, 2] });
  const b = captureBareModel({ list: [2, 1] });
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  const { jcsSerialize } = await import('../../src/canonical/jcs.js');
  assert.notEqual(jcsSerialize(a.model), jcsSerialize(b.model));
});

test('F: functions rejected', () => {
  const r = captureBareModel({ fn: () => 1 });
  assert.equal(r.ok, false);
});

test('F: cycles rejected', () => {
  const model: Record<string, unknown> = { name: 'x' };
  model['self'] = model;
  const r = captureBareModel(model);
  assert.equal(r.ok, false);
});

test('F: symbols rejected', () => {
  const model: Record<string, unknown> = { name: 'x' };
  (model as Record<symbol, unknown>)[Symbol('s')] = 1;
  const r = captureBareModel(model);
  assert.equal(r.ok, false);
});

test('F: unsupported prototype rejected', () => {
  for (const value of [new Date(), new Map(), new (class Foo {})()]) {
    const r = captureBareModel(value);
    assert.equal(r.ok, false);
  }
});

test('F: non-finite numbers rejected', () => {
  for (const value of [{ n: NaN }, { n: Infinity }, { n: -Infinity }]) {
    const r = captureBareModel(value);
    assert.equal(r.ok, false);
  }
});

test('F: malformed but JSON-representable grant constraint captured successfully', () => {
  const r = captureBareModel({
    record_id: 'grant-1',
    narrowed_constraints: [{ type: 'max-actions', value: 'not-a-number' }],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const constraints = (r.model as Record<string, unknown>)['narrowed_constraints'] as readonly Record<string, unknown>[];
  assert.equal(constraints[0]!['value'], 'not-a-number');
});

test('F: non-record models rejected (arrays and primitives)', () => {
  for (const value of [[1, 2], 'str', 42, null, true]) {
    const r = captureBareModel(value);
    assert.equal(r.ok, false, String(value));
  }
});

test('F: hostile accessor rejected without invocation', () => {
  let invoked = 0;
  const model: Record<string, unknown> = { name: 'x' };
  Object.defineProperty(model, 'secret', {
    enumerable: true,
    get() {
      invoked++;
      return 'value';
    },
  });
  const r = captureBareModel(model);
  assert.equal(r.ok, false);
  assert.equal(invoked, 0);
});

test('F: mutation after capture has no effect', () => {
  const source: Record<string, unknown> = { name: 'original' };
  const r = captureBareModel(source);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  source['name'] = 'mutated';
  assert.equal((r.model as Record<string, unknown>)['name'], 'original');
});
