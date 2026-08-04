/**
 * WP-5A unit tests (R-1/R-2): the authoritative media-type parser shared by
 * capability inspection and context correlation. Covers declaration mode and
 * item mode, exact non-widening semantics, wildcard rejection, parameter
 * stripping, and coercion-free handling of non-string values.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMediaDeclaration,
  parseMediaType,
  declaredMediaTypes,
  capabilityEntryString,
} from '../../../src/adapters/pi/internal/media-type.js';

test('R: declaration mode accepts bare text/plain tokens', () => {
  const r = parseMediaDeclaration('text/plain');
  assert.equal(r.status, 'valid');
  assert.equal(r.normalized, 'text/plain');
  assert.equal(parseMediaDeclaration('TEXT/PLAIN').normalized, 'text/plain');
  assert.equal(parseMediaDeclaration(' text/plain ').normalized, 'text/plain');
});

test('R: declaration mode rejects wildcards, parameters, and malformed tokens', () => {
  assert.equal(parseMediaDeclaration('text/*').status, 'wildcard');
  assert.equal(parseMediaDeclaration('*/*').status, 'wildcard');
  assert.equal(parseMediaDeclaration('text/plain; charset=utf-8').status, 'malformed');
  assert.equal(parseMediaDeclaration('text').status, 'malformed');
  assert.equal(parseMediaDeclaration('text/').status, 'malformed');
  assert.equal(parseMediaDeclaration('/plain').status, 'malformed');
  assert.equal(parseMediaDeclaration('text//plain').status, 'malformed');
  assert.equal(parseMediaDeclaration('text/ plain').status, 'malformed');
  assert.equal(parseMediaDeclaration('').status, 'malformed');
  assert.equal(parseMediaDeclaration('   ').status, 'malformed');
});

test('R: declaration mode rejects every non-string value without coercion', () => {
  let hooks = 0;
  const values: unknown[] = [
    undefined,
    null,
    42,
    0n,
    true,
    Symbol('x'),
    () => 'text/plain',
    ['text/plain'],
    { value: 'text/plain' },
    new String('text/plain'),
    { toString: () => { hooks++; return 'text/plain'; } },
    { valueOf: () => { hooks++; return 'text/plain'; } },
  ];
  for (const v of values) {
    const r = parseMediaDeclaration(v);
    assert.equal(r.status, 'not-a-string', `value ${typeof v} must be not-a-string`);
    assert.equal(r.normalized, undefined);
  }
  assert.equal(hooks, 0, 'no coercion hook may be invoked');
});

test('R: item mode strips parameters before matching', () => {
  const r = parseMediaType('text/plain; charset=utf-8');
  assert.equal(r.status, 'valid');
  assert.equal(r.normalized, 'text/plain');
  assert.equal(parseMediaType('text/plain ; charset="utf-8"').normalized, 'text/plain');
});

test('R: item mode wildcards remain unsupported', () => {
  assert.equal(parseMediaType('text/*').status, 'wildcard');
  assert.equal(parseMediaType('text/*; x=1').status, 'wildcard');
});

test('R: item mode rejects non-strings identically to declaration mode', () => {
  for (const v of [undefined, null, 42, ['text/plain'], new String('text/plain')]) {
    assert.equal(parseMediaType(v).status, 'not-a-string');
  }
});

test('R: declaredMediaTypes collects only valid normalized declarations', () => {
  assert.deepEqual(declaredMediaTypes(['text/plain', 'TEXT/Markdown']), ['text/plain', 'text/markdown']);
  assert.deepEqual(declaredMediaTypes(['text/plain', 42, undefined, ['text/plain'], 'text/*', '']), ['text/plain']);
  assert.deepEqual(declaredMediaTypes(undefined), []);
  assert.deepEqual(declaredMediaTypes('text/plain'), []);
  const sparse: unknown[] = ['text/plain'];
  sparse[2] = 'application/octet-stream';
  assert.deepEqual(declaredMediaTypes(sparse), ['text/plain', 'application/octet-stream']);
});

test('R: capabilityEntryString is coercion-free and deterministic', () => {
  let hooks = 0;
  const obj = { toString: () => { hooks++; return 'x'; } };
  assert.equal(capabilityEntryString('text/plain'), 'text/plain');
  assert.equal(capabilityEntryString(undefined), '<undefined>');
  assert.equal(capabilityEntryString(42), '<number>');
  assert.equal(capabilityEntryString(obj), '<object>');
  assert.equal(capabilityEntryString(null), '<object>');
  assert.equal(capabilityEntryString(['a']), '<object>');
  assert.equal(hooks, 0, 'no coercion hook may be invoked');
});

test('R: parser is deterministic and never mutates input', () => {
  const input = ' TEXT/Plain; charset=utf-8 ';
  const a = parseMediaType(input);
  const b = parseMediaType(input);
  assert.deepEqual(a, b);
  assert.equal(input, ' TEXT/Plain; charset=utf-8 ', 'input must not be mutated');
});
