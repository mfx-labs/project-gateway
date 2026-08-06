/**
 * WP-8-B tests: typed-identifier parsing, including every Appendix H
 * acceptance and rejection vector (contract 5.3, LAY-003/004).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTypedIdentifier, isCanonicalTypedIdentifier } from '../../../src/storage/index.js';

// Appendix H acceptance vectors (extracted component, shard, relative path).
const ACCEPTANCE: ReadonlyArray<{ id: string; component: string; shard: string }> = [
  { id: 'pgw:r:00000000000000000000000000000000', component: '00000000000000000000000000000000', shard: '0000' },
  { id: 'pgw:r:0123456789abcdef0123456789abcdef', component: '0123456789abcdef0123456789abcdef', shard: '0123' },
  { id: 'pgw:r:ffffffffffffffffffffffffffffffff', component: 'ffffffffffffffffffffffffffffffff', shard: 'ffff' },
  { id: 'pgw:r:00112233445566778899aabbccddeeff', component: '00112233445566778899aabbccddeeff', shard: '0011' },
];

test('identifier: Appendix H acceptance vectors parse with verbatim extraction', () => {
  for (const v of ACCEPTANCE) {
    const r = parseTypedIdentifier(v.id);
    assert.equal(r.ok, true, v.id);
    if (r.ok) {
      assert.equal(r.identifier.opaque, v.component);
      assert.equal(r.identifier.opaque.slice(0, 4), v.shard);
      assert.equal(r.identifier.prefix, 'pgw:r:');
      assert.equal(isCanonicalTypedIdentifier(v.id), true);
    }
  }
});

test('identifier: Appendix H shard-check example', () => {
  const r = parseTypedIdentifier('pgw:r:abcdef0123456789abcdef0123456789');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.identifier.opaque, 'abcdef0123456789abcdef0123456789');
    assert.equal(r.identifier.opaque.slice(0, 4), 'abcd');
  }
});

test('identifier: Appendix H rejection vectors', () => {
  const rejections: ReadonlyArray<[string, string]> = [
    ['pgw:r:0123456789ABCDEF0123456789ABCDEF', 'uppercase'],
    ['pgw:r:0123456789abcdef0123456789abcdeg', 'invalid-character'],
    ['pgw:x:0123456789abcdef0123456789abcdef', 'wrong-prefix'],
    ['pgw:r:0123456789abcdef0123456789abcd', 'too-short'],
    ['pgw:r:0123456789abcdef0123456789abcdef01', 'too-long'],
    ['pgw:r:', 'empty'],
    ['pgw:r:0123456789abcdef0123456789abcde\u00e9', 'non-ascii'],
  ];
  for (const [id, expectedReason] of rejections) {
    const r = parseTypedIdentifier(id);
    assert.equal(r.ok, false, id);
    if (!r.ok) assert.equal(r.reason, expectedReason, id);
    assert.equal(isCanonicalTypedIdentifier(id), false, id);
  }
});

test('identifier: accepted prefixes and required-prefix enforcement', () => {
  for (const prefix of ['pgw:i:', 'pgw:r:', 'pgw:w:', 'pgw:g:', 'pgw:l:']) {
    const id = `${prefix}${'a'.repeat(32)}`;
    assert.equal(parseTypedIdentifier(id).ok, true, prefix);
  }
  const r = parseTypedIdentifier('pgw:l:' + 'b'.repeat(32), 'pgw:l:');
  assert.equal(r.ok, true);
  const wrong = parseTypedIdentifier('pgw:r:' + 'c'.repeat(32), 'pgw:l:');
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.reason, 'wrong-prefix');
});

test('identifier: uppercase input is rejected, never normalized', () => {
  const upper = parseTypedIdentifier('pgw:r:0123456789ABCDEF0123456789ABCDEF');
  assert.equal(upper.ok, false);
  // The parser must not silently lowercase: re-parse of the normalized form must differ in result.
  const lower = parseTypedIdentifier('pgw:r:0123456789abcdef0123456789abcdef');
  assert.equal(lower.ok, true);
});

test('identifier: deterministic across repeated calls', () => {
  const id = 'pgw:r:abcdef0123456789abcdef0123456789';
  const a = parseTypedIdentifier(id);
  const b = parseTypedIdentifier(id);
  assert.deepEqual(a, b);
});
