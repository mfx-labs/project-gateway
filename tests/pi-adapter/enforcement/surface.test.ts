/**
 * WP-5B unit tests — effective tool-surface observation (F-R1; fail closed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  observeEffectiveSurface,
  surfaceIdentity,
  resampleMatches,
} from '../../../src/adapters/pi/enforcement/surface.js';
import { computeInventoryFingerprint } from '../../../src/adapters/pi/enforcement/fingerprint.js';
import type { EffectiveToolEntry } from '../../../src/adapters/pi/enforcement/types.js';

function tool(name: string, source = 'builtin'): { name: string; sourceInfo: { source: string } } {
  return { name, sourceInfo: { source } };
}

test('observes a valid effective surface deterministically (sorted, active-bound)', () => {
  const observed = observeEffectiveSurface([tool('bash'), tool('read'), tool('grep'), tool('ls'), tool('find')], ['read', 'grep'], '2026-08-04T06:20:00.000Z');
  assert.ok(observed.ok);
  assert.ok(observed.surface);
  assert.deepEqual(observed.surface.entries.map((e: EffectiveToolEntry) => e.name), ['bash', 'find', 'grep', 'ls', 'read']);
  assert.deepEqual(observed.surface.activeTools, ['read', 'grep']);
  assert.equal(surfaceIdentity(observed.surface), computeInventoryFingerprint(observed.surface.entries));
});

test('fails closed when a registered entry lacks a name', () => {
  const observed = observeEffectiveSurface([{ sourceInfo: { source: 'builtin' } }], [], 't');
  assert.ok(!observed.ok);
  assert.ok(observed.findings.some((f) => f.key === 'surface.entry-malformed'));
});

test('fails closed when a registered entry lacks an effective source', () => {
  const observed = observeEffectiveSurface([{ name: 'read', sourceInfo: {} }], [], 't');
  assert.ok(!observed.ok);
  assert.ok(observed.findings.some((f) => f.key === 'surface.entry-malformed'));
});

test('fails closed on duplicate effective tool names', () => {
  const observed = observeEffectiveSurface([tool('read'), tool('read')], [], 't');
  assert.ok(!observed.ok);
  assert.ok(observed.findings.some((f) => f.key === 'surface.duplicate-name'));
});

test('fails closed when an active tool is not in the registered surface', () => {
  const observed = observeEffectiveSurface([tool('read')], ['bash'], 't');
  assert.ok(!observed.ok);
  assert.ok(observed.findings.some((f) => f.key === 'surface.unknown-active'));
});

test('fails closed when inventory is not an array', () => {
  const observed = observeEffectiveSurface(undefined as unknown as readonly unknown[], [], 't');
  assert.ok(!observed.ok);
  assert.ok(observed.findings.some((f) => f.key === 'surface.inventory-invalid'));
});

test('fails closed when the active set is not an array', () => {
  const observed = observeEffectiveSurface([tool('read')], 'read' as unknown as readonly unknown[], 't');
  assert.ok(!observed.ok);
  assert.ok(observed.findings.some((f) => f.key === 'surface.active-invalid'));
});

test('resampleMatches detects effective-surface change (drift)', () => {
  const fresh = () => observeEffectiveSurface([tool('read'), tool('grep')], ['read'], 't');
  const a = fresh();
  const b = fresh();
  assert.ok(a.ok && a.surface !== undefined && b.ok && b.surface !== undefined);
  assert.equal(resampleMatches(a.surface, b.surface), true);
  const drifted = observeEffectiveSurface([tool('read'), tool('grep'), tool('ls')], ['read'], 't');
  assert.ok(drifted.ok && drifted.surface !== undefined);
  assert.equal(resampleMatches(a.surface, drifted.surface), false);
});
