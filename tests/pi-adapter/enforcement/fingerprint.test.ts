/**
 * WP-5B unit tests — normative v1 inventoryFingerprint (Part B; SIR-PG-012-001).
 *
 * The golden vector must reproduce byte-for-byte: canonical entry order
 * (UTF-8 byte order; U+E000 before U+10000 — NOT the JS `<` UTF-16 order),
 * exact UTF-8 bytes, and SHA-256 digest `02c896…7261`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  computeInventoryFingerprint,
  GOLDEN_VECTOR_DIGEST,
  GOLDEN_VECTOR_ENTRIES,
  compareUtf8Bytes,
} from '../../../src/adapters/pi/enforcement/fingerprint.js';
import type { EffectiveToolEntry } from '../../../src/adapters/pi/enforcement/types.js';

function entry(name: string, source: string): EffectiveToolEntry {
  return { name, source };
}

test('golden vector produces the exact normative digest', () => {
  const digest = computeInventoryFingerprint(GOLDEN_VECTOR_ENTRIES);
  assert.equal(digest, GOLDEN_VECTOR_DIGEST);
  assert.equal(digest, '02c896667bb20ac3813e2eb65aa5cda4bd46a4d4acb16588cc1611e49dd97261');
});

test('golden vector canonical entry order is by UTF-8 bytes (U+E000 before U+10000)', () => {
  const sorted = [...GOLDEN_VECTOR_ENTRIES].sort(compareUtf8Bytes).map((e) => JSON.stringify(e.name));
  assert.deepEqual(sorted, [
    JSON.stringify('bash'),
    JSON.stringify('caf\u00e9'),
    JSON.stringify('read'),
    JSON.stringify('web_search'),
    JSON.stringify('\uE000'),
    JSON.stringify('\u{10000}'),
  ]);
});

test('the JS `<` UTF-16 comparator would produce a DIFFERENT digest (byte-order pin)', () => {
  const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
  // UTF-16 code units: U+10000 = D800 DC00 (0xD800) < U+E000 (0xE000),
  // so a JS `<` sort would place U+10000 first — diverging from the vector.
  const serialized = (order: readonly EffectiveToolEntry[]) =>
    JSON.stringify([...order].map((e) => ({ name: e.name, source: e.source })));
  const jsComparison = (a: EffectiveToolEntry, b: EffectiveToolEntry): number =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
  const naiveFingerprint = sha256Hex(serialized([...GOLDEN_VECTOR_ENTRIES].sort(jsComparison)));
  const canonicalFingerprint = sha256Hex(serialized([...GOLDEN_VECTOR_ENTRIES].sort(compareUtf8Bytes)));
  assert.notEqual(naiveFingerprint, canonicalFingerprint);
  assert.equal(canonicalFingerprint, GOLDEN_VECTOR_DIGEST);
});

test('fingerprint is deterministic and input-order independent', () => {
  const a = [entry('bash', 'builtin'), entry('read', 'builtin'), entry('grep', 'builtin')];
  const b = [entry('grep', 'builtin'), entry('bash', 'builtin'), entry('read', 'builtin')];
  const fa = computeInventoryFingerprint(a);
  assert.equal(fa, computeInventoryFingerprint(b));
  assert.match(fa, /^[0-9a-f]{64}$/);
  // a distinct surface must not collide with the golden vector
  assert.notEqual(fa, GOLDEN_VECTOR_DIGEST);
});

test('empty surface is a stable 64-hex digest', () => {
  assert.match(computeInventoryFingerprint([]), /^[0-9a-f]{64}$/);
  assert.equal(computeInventoryFingerprint([]), computeInventoryFingerprint([]));
});

test('source change and case change alter the digest', () => {
  const builtin = computeInventoryFingerprint([entry('read', 'builtin'), entry('edit', 'builtin')]);
  const foreign = computeInventoryFingerprint([entry('read', 'builtin'), entry('edit', 'other')]);
  assert.notEqual(builtin, foreign);
  const upper = computeInventoryFingerprint([entry('read', 'builtin'), entry('Edit', 'builtin')]);
  assert.notEqual(builtin, upper);
});
