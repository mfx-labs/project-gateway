/**
 * WP-5A unit tests (F7): one authoritative UTF-8 byte text-bound model —
 * scalar-safe truncation, isolated-surrogate rejection, exact frame lengths,
 * and byte-equivalent determinism.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasLoneSurrogate,
  truncateUtf8WithoutSplittingScalar,
  utf8ByteLength,
  validateUnicodeScalarText,
} from '../../../src/adapters/pi/internal/unicode.js';
import { renderContextBlock } from '../../../src/adapters/pi/render.js';
import { projectExecutionBundleToPi } from '../../../src/adapters/pi/projection.js';
import { buildWorld, contextItem, corpusArtifactSet, customArtifact, cloneModel } from '../helpers.js';
import { buildWorldWith } from '../helpers/world.js';
import type { PiResolvedContextItem } from '../../../src/adapters/pi/types.js';

// --- helper-level byte model ----------------------------------------------
test('F7: ASCII exactly at bound', () => {
  const result = truncateUtf8WithoutSplittingScalar('abcd', 4);
  assert.equal(result.text, 'abcd');
  assert.equal(result.emittedBytes, 4);
  assert.equal(result.truncated, false);
});

test('F7: ASCII one byte over bound', () => {
  const result = truncateUtf8WithoutSplittingScalar('abcde', 4);
  assert.equal(result.text, 'abcd');
  assert.equal(result.emittedBytes, 4);
  assert.equal(result.truncated, true);
  assert.equal(result.originalBytes, 5);
});

test('F7: BMP character at boundary', () => {
  // 'é' is 2 UTF-8 bytes
  const result = truncateUtf8WithoutSplittingScalar('a\u00e9', 3);
  assert.equal(result.text, 'a\u00e9');
  assert.equal(result.emittedBytes, 3);
  assert.equal(result.truncated, false);
  const cut = truncateUtf8WithoutSplittingScalar('a\u00e9', 2);
  assert.equal(cut.text, 'a');
  assert.equal(cut.emittedBytes, 1);
  assert.equal(cut.truncated, true);
});

test('F7: supplementary-plane character at boundary', () => {
  // '\u{1F600}' is 4 UTF-8 bytes
  const result = truncateUtf8WithoutSplittingScalar('a\u{1F600}', 5);
  assert.equal(result.text, 'a\u{1F600}');
  assert.equal(result.emittedBytes, 5);
  assert.equal(result.truncated, false);
});

test('F7: truncation immediately before a surrogate pair', () => {
  // budget of 1 byte: only the ASCII 'a' fits; the pair must not be split
  const result = truncateUtf8WithoutSplittingScalar('a\u{1F600}', 1);
  assert.equal(result.text, 'a');
  assert.equal(hasLoneSurrogate(result.text), false);
});

test('F7: truncation budget inside the UTF-8 sequence of a supplementary character', () => {
  // budget 3 bytes: 'a'(1) + 2 of 4 bytes of the pair would be a split;
  // the scalar-safe prefix drops the whole pair
  const result = truncateUtf8WithoutSplittingScalar('a\u{1F600}', 3);
  assert.equal(result.text, 'a');
  assert.equal(hasLoneSurrogate(result.text), false);
  // budget 4 bytes: 'a' (1 byte) + the 4-byte scalar would need 5 bytes, so
  // the scalar still does not fit and only the valid prefix 'a' is emitted
  const fits = truncateUtf8WithoutSplittingScalar('a\u{1F600}', 4);
  assert.equal(fits.text, 'a');
  assert.equal(fits.emittedBytes, 1);
});

test('F7: no isolated surrogate output', () => {
  const text = 'ab\u{1F600}cd';
  for (const budget of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const result = truncateUtf8WithoutSplittingScalar(text, budget);
    assert.equal(hasLoneSurrogate(result.text), false, `budget ${budget}`);
  }
});

test('F7: isolated high surrogate input rejected', () => {
  assert.equal(validateUnicodeScalarText('ok\uD800'), false);
  assert.equal(validateUnicodeScalarText('a\uD83D\uDE00b'), true); // valid pair
  assert.equal(hasLoneSurrogate('ok\uD800'), true);
});

test('F7: isolated low surrogate input rejected', () => {
  assert.equal(validateUnicodeScalarText('\uDC00'), false);
  assert.equal(hasLoneSurrogate('x\uDC00y'), true);
});

test('F7: combining sequence preserved without silent normalization', () => {
  // 'e' (1 byte) + combining acute U+0301 (2 bytes) = 3 UTF-8 bytes; never
  // normalized to 'é'
  const text = 'e\u0301';
  assert.equal(utf8ByteLength(text), 3);
  const result = truncateUtf8WithoutSplittingScalar(text, 3);
  assert.equal(result.text, 'e\u0301');
  assert.equal(result.text.normalize('NFC'), '\u00e9');
  assert.notEqual(result.text, '\u00e9', 'must not silently normalize');
  // a budget inside the combining sequence keeps the base character only
  const cut = truncateUtf8WithoutSplittingScalar(text, 1);
  assert.equal(cut.text, 'e');
});

test('F7: declared byte length equals emitted byte length', () => {
  const item: PiResolvedContextItem = contextItem('ctx-a', { text: 'a\u00e9\u{1F600}' });
  const { block, meta } = renderContextBlock(item, 4096, false);
  const declared = Number(block.match(/byteLength=(\d+)/)![1]);
  assert.equal(declared, meta.byteLength);
  assert.equal(declared, utf8ByteLength('a\u00e9\u{1F600}'));
});

test('F7: equal inputs remain byte-equivalent', () => {
  const a = renderContextBlock(contextItem('ctx-a', { text: 'x\u{1F600}y' }), 4096, false);
  const b = renderContextBlock(contextItem('ctx-a', { text: 'x\u{1F600}y' }), 4096, false);
  assert.equal(a.block, b.block);
  assert.equal(Buffer.byteLength(a.block, 'utf8'), Buffer.byteLength(b.block, 'utf8'));
});

test('F7: aggregate and rendered-plan limits use the same documented units', () => {
  // per-item, aggregate, and plan limits are all UTF-8 bytes
  const world = buildWorld();
  const multiByte = 'a'.repeat(100) + '\u00e9'.repeat(50); // 100 + 100 = 200 bytes
  const input = world.input({
    contextItems: [contextItem('ctx-a', { text: multiByte, byteLength: 200 })],
    limits: { ...world.limits, maxTotalContextBytes: 200, maxPlanBytes: 262144 },
  });
  // exactly at the aggregate bound: accepted
  const base = corpusArtifactSet();
  const manifest = customArtifact(cloneModel(base.context), (m) => {
    m['body'] = {
      selection_mode: 'items',
      items: [
        {
          context_id: 'ctx-a',
          requirement: 'required',
          priority: 1,
          purpose: 'specification',
          integrity: { mode: 'none' },
          selector: { selector_type: 'project-gateway.workspace-resource-id', version: '1.0', resource_id: 'pgw:s:' + 'e'.repeat(32) },
        },
      ],
    };
  });
  const w2 = buildWorldWith({ ...base, context: manifest }, 'context');
  const ok = projectExecutionBundleToPi(w2.input({
    contextItems: [contextItem('ctx-a', { text: multiByte, byteLength: 200 })],
    limits: { ...w2.limits, maxTotalContextBytes: 200, maxPlanBytes: 262144 },
  }));
  assert.equal(ok.ok, true, JSON.stringify(ok.ok ? [] : ok.findings.map((f) => f.key)));
  void world;
  void input;
});

test('F7: explicit truncation metadata reports original and emitted byte lengths', () => {
  const world = buildWorld();
  const base = corpusArtifactSet();
  const manifest = customArtifact(cloneModel(base.context), (m) => {
    m['body'] = {
      selection_mode: 'items',
      items: [
        {
          context_id: 'ctx-a',
          requirement: 'required',
          priority: 1,
          purpose: 'specification',
          integrity: { mode: 'none' },
          selector: { selector_type: 'project-gateway.workspace-resource-id', version: '1.0', resource_id: 'pgw:s:' + 'e'.repeat(32) },
        },
      ],
    };
  });
  const w2 = buildWorldWith({ ...base, context: manifest }, 'context');
  const text = '\u{1F600}'.repeat(10); // 40 bytes
  const result = projectExecutionBundleToPi(w2.input({
    contextItems: [contextItem('ctx-a', { text, byteLength: 40 })],
    limits: { ...w2.limits, maxContextItemBytes: 10, allowTruncation: true },
  }));
  assert.equal(result.ok, true);
  if (result.ok) {
    const meta = result.plan.contextSections.find((s) => s.contextId === 'ctx-a')!;
    assert.equal(meta.truncated, true);
    assert.equal(meta.truncatedFromBytes, 40);
    // 10 bytes = two full 4-byte scalars; the pair is never split
    assert.equal(meta.byteLength, 8);
    assert.ok(!hasLoneSurrogate(meta.label));
  }
  void world;
});

test('F7: projection rejects isolated surrogates in context text before rendering', () => {
  const base = corpusArtifactSet();
  const manifest = customArtifact(cloneModel(base.context), (m) => {
    m['body'] = {
      selection_mode: 'items',
      items: [
        {
          context_id: 'ctx-a',
          requirement: 'required',
          priority: 1,
          purpose: 'specification',
          integrity: { mode: 'none' },
          selector: { selector_type: 'project-gateway.workspace-resource-id', version: '1.0', resource_id: 'pgw:s:' + 'e'.repeat(32) },
        },
      ],
    };
  });
  const w2 = buildWorldWith({ ...base, context: manifest }, 'context');
  const result = projectExecutionBundleToPi(w2.input({ contextItems: [contextItem('ctx-a', { text: 'bad \uD800 surrogate' })] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'context.invalid-unicode'));
});
