/**
 * WP-6 Phase 3A: bare-model capture tests (contract Section 13; F-P3-EL-21
 * Model A). Bundle/policy/grant have NO runtime brand; descriptor-safe deep
 * capture produces detached deeply frozen plain JSON values. Malformed but
 * JSON-representable semantic content remains capturable for later semantic
 * denial.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureBareModel, type ImmutableJsonValue } from '../../src/pointofuse/index.js';

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

test('F: finite non-integer numbers rejected at capture (canonical numeric profile, M-1)', () => {
  // A finite fraction is JSON-representable (snapshotJson accepts it) but not
  // canonical-input-representable (the committed JCS accepts safe integers
  // only). It must fail at the model-capture boundary, never at static
  // identity construction.
  for (const value of [{ n: 1.5 }, { a: { b: [2.5] } }, { list: [1, 2.5] }]) {
    const r = captureBareModel(value);
    assert.equal(r.ok, false, JSON.stringify(value));
  }
  // Bundle-, policy-, and grant-shaped records use the same helper.
  for (const value of [
    { instance_id: 'b-1', fractional: 1.5 },
    { instance_id: 'p-1', weight: 0.5 },
    { record_id: 'g-1', narrowed_constraints: [{ type: 'max-actions', value: 1.5 }] },
  ]) {
    const r = captureBareModel(value);
    assert.equal(r.ok, false, JSON.stringify(value));
  }
});

test('F: unsafe integers rejected; -0 and safe integers accepted (canonical numeric profile, M-1)', () => {
  // 2^53 is an integer but outside the safe range: the committed JCS rejects
  // it. -0 is normalized to 0 by the committed serializer and is admissible.
  const unsafe = captureBareModel({ n: 2 ** 53 });
  assert.equal(unsafe.ok, false);
  for (const value of [{ n: -0 }, { n: 0 }, { n: 42 }, { nested: { list: [1, 2, 3] } }]) {
    const r = captureBareModel(value);
    assert.equal(r.ok, true, JSON.stringify(value));
  }
});

test('F: captured models are JCS-serializable when capture succeeds (M-1)', async () => {
  const { jcsSerialize } = await import('../../src/canonical/jcs.js');
  const r = captureBareModel({ instanceId: 'b-1', body: { members: [], count: 3 } });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Every accepted model must serialize without throwing (no number can reach
  // static identity that the committed canonicalizer rejects).
  assert.doesNotThrow(() => jcsSerialize(r.model));
});

test('F: Number.MAX_SAFE_INTEGER accepted with exact value and deep freeze (canonical edge probe A)', async () => {
  const { jcsSerialize } = await import('../../src/canonical/jcs.js');
  const r = captureBareModel({ n: Number.MAX_SAFE_INTEGER });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal((r.model as Record<string, unknown>)['n'], Number.MAX_SAFE_INTEGER);
  assert.equal(Object.isFrozen(r.model), true);
  assert.doesNotThrow(() => jcsSerialize(r.model));
  assert.equal(jcsSerialize(r.model), '{"n":9007199254740991}');
});

test('F: negative safe integer accepted, nested placement supported (canonical edge probe B)', async () => {
  const { jcsSerialize } = await import('../../src/canonical/jcs.js');
  const r = captureBareModel({ outer: { inner: [-42, 0, 7] } });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // The captured model is a null-prototype plain JSON object (snapshotJson
  // construction); compare via spread (values) and the canonical serialization.
  assert.deepEqual({ ...((r.model as Record<string, unknown>)['outer'] as Record<string, unknown>) }, { inner: [-42, 0, 7] });
  assert.equal(Object.isFrozen(r.model), true);
  assert.doesNotThrow(() => jcsSerialize(r.model));
  assert.equal(jcsSerialize(r.model), '{"outer":{"inner":[-42,0,7]}}');
});

test('F: negative zero canonical equivalence — -0 serializes as 0 and static identity is equal (canonical edge probe C)', async () => {
  const { jcsSerialize } = await import('../../src/canonical/jcs.js');
  const { buildStaticInputProjection, computeStaticInputCorrelationIdentity } = await import('../../src/pointofuse/index.js');
  const neg = captureBareModel({ n: -0 });
  const pos = captureBareModel({ n: 0 });
  assert.equal(neg.ok && pos.ok, true);
  if (!neg.ok || !pos.ok) return;
  // The committed canonicalizer normalizes -0 to 0: equal serializations.
  assert.equal(jcsSerialize(neg.model), jcsSerialize(pos.model));
  assert.equal(jcsSerialize(neg.model), '{"n":0}');
  assert.ok(!jcsSerialize(neg.model).includes('-0'));
  // Equal canonical representation embedded in an otherwise identical static
  // projection produces equal static-input identities (existing production
  // helper; no seam).
  const projectionInput = (bundle: ImmutableJsonValue) => ({
    configurationVersion: '2' as const,
    configurationIdentity: 'sha-256:' + 'a'.repeat(64),
    capabilityVocabularyVersion: 'v1',
    inputWorkspaceId: 'ws-a',
    requestedUseWorkspaceId: 'ws-a',
    requestedUse: { capability: 'c', operationClass: 'read' as const, resourceClass: 'r', scope: 'exact:s', workspaceId: 'ws-a' },
    currentTime: '2026-01-01T00:00:00Z',
    configuredGlobalCapabilityCeiling: { state: 'absent' as const },
    configuredWorkspaceCapabilityCeiling: { state: 'absent' as const },
    configuredGlobalNumericCeiling: { state: 'absent' as const },
    configuredWorkspaceNumericCeiling: { state: 'absent' as const },
    consumerSupport: { consumerId: 'c', supportedProtocolFeatures: [], supportedConsumerCapabilities: [], supportedExtensionNamespaces: [] },
    bundle,
    policy: { instanceId: 'p' },
    grant: { state: 'absent' as const },
    registry: { registryProtocolId: 'p', registrySnapshotFormatVersion: '1', registrySnapshotId: 's', registrySnapshotDigest: 'sha-256:' + 'b'.repeat(64) },
    lifecycleRecords: [],
  });
  const negProjection = buildStaticInputProjection(projectionInput(neg.model));
  const posProjection = buildStaticInputProjection(projectionInput(pos.model));
  assert.equal(
    computeStaticInputCorrelationIdentity(negProjection),
    computeStaticInputCorrelationIdentity(posProjection),
  );
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
