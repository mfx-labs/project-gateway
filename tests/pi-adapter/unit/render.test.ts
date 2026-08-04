/**
 * WP-5A unit tests (F-2): the public renderer must never implicitly convert
 * caller-controlled media values — malformed media renders as the fixed
 * `mediaType=invalid` placeholder with stable findings; no raw throw, no
 * caller hook, no coercion, deterministic output, valid input byte-identical.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderContextBlock,
  renderContextBlocks,
  renderContextInventory,
  renderCorrelationFooter,
  renderPrompt,
  renderTaskSection,
  renderCompletionCriteria,
  CTX_BEGIN_MARKER,
  CTX_END_MARKER,
} from '../../../src/adapters/pi/render.js';
import { contextItem } from '../helpers.js';
import type { PiResolvedContextItem } from '../../../src/adapters/pi/types.js';

function malformedKeys(result: { findings: readonly { key: string }[] }): string[] {
  return result.findings.map((f) => f.key).sort();
}

test('F-2: valid primitive text/plain renders correctly with byte framing', () => {
  const item = contextItem('ctx-a', { text: 'hello' });
  const a = renderContextBlock(item, 4096, false);
  const b = renderContextBlock(item, 4096, false);
  assert.equal(a.findings.length, 0);
  assert.ok(a.block.startsWith(`${CTX_BEGIN_MARKER} contextId=ctx-a mediaType=text/plain byteLength=5 truncated=false`));
  assert.ok(a.block.endsWith(CTX_END_MARKER));
  assert.equal(a.block, b.block, 'deterministic for equal inputs');
  assert.equal(a.meta.byteLength, 5);
  assert.equal(a.meta.mediaType, 'text/plain');
});

test('F-2: mediaType Symbol renders the invalid placeholder without throwing', () => {
  const item = contextItem('ctx-a', { mediaType: Symbol('x') as never });
  const result = renderContextBlock(item, 4096, false);
  assert.ok(result.block.includes('mediaType=invalid'));
  assert.ok(result.block.includes(`contextId=ctx-a`));
  assert.deepEqual(malformedKeys(result), ['context.media-malformed']);
});

test('F-2: numeric mediaType renders the invalid placeholder', () => {
  const result = renderContextBlock(contextItem('ctx-a', { mediaType: 42 as never }), 4096, false);
  assert.ok(result.block.includes('mediaType=invalid'));
  assert.deepEqual(malformedKeys(result), ['context.media-malformed']);
});

test('F-2: boolean mediaType renders the invalid placeholder', () => {
  const result = renderContextBlock(contextItem('ctx-a', { mediaType: true as never }), 4096, false);
  assert.ok(result.block.includes('mediaType=invalid'));
  assert.deepEqual(malformedKeys(result), ['context.media-malformed']);
});

test('F-2: null mediaType renders the invalid placeholder', () => {
  const result = renderContextBlock(contextItem('ctx-a', { mediaType: null as never }), 4096, false);
  assert.ok(result.block.includes('mediaType=invalid'));
  assert.deepEqual(malformedKeys(result), ['context.media-malformed']);
});

test('F-2: undefined mediaType renders the invalid placeholder', () => {
  const result = renderContextBlock(contextItem('ctx-a', { mediaType: undefined as never }), 4096, false);
  assert.ok(result.block.includes('mediaType=invalid'));
  assert.deepEqual(malformedKeys(result), ['context.media-malformed']);
});

test('F-2: array mediaType renders the invalid placeholder (no stringification)', () => {
  const result = renderContextBlock(contextItem('ctx-a', { mediaType: ['text/plain'] as never }), 4096, false);
  assert.ok(result.block.includes('mediaType=invalid'));
  assert.ok(!result.block.includes('text/plain,'));
  assert.deepEqual(malformedKeys(result), ['context.media-malformed']);
});

test('F-2: String wrapper mediaType renders the invalid placeholder', () => {
  const result = renderContextBlock(contextItem('ctx-a', { mediaType: new String('text/plain') as never }), 4096, false);
  assert.ok(result.block.includes('mediaType=invalid'));
  assert.deepEqual(malformedKeys(result), ['context.media-malformed']);
});

test('F-2: object with counting toString is never converted', () => {
  let calls = 0;
  const media = { toString: () => { calls++; return 'text/plain'; } };
  const result = renderContextBlock(contextItem('ctx-a', { mediaType: media as never }), 4096, false);
  assert.equal(calls, 0, 'toString must never be invoked');
  assert.ok(result.block.includes('mediaType=invalid'));
  assert.deepEqual(malformedKeys(result), ['context.media-malformed']);
});

test('F-2: object with throwing toString never throws', () => {
  const media = {
    toString() {
      throw new Error('toString must not be invoked');
    },
  };
  const result = renderContextBlock(contextItem('ctx-a', { mediaType: media as never }), 4096, false);
  assert.ok(result.block.includes('mediaType=invalid'));
  assert.deepEqual(malformedKeys(result), ['context.media-malformed']);
});

test('F-2: object with throwing valueOf never throws', () => {
  const media = {
    valueOf() {
      throw new Error('valueOf must not be invoked');
    },
  };
  const result = renderContextBlock(contextItem('ctx-a', { mediaType: media as never }), 4096, false);
  assert.ok(result.block.includes('mediaType=invalid'));
  assert.deepEqual(malformedKeys(result), ['context.media-malformed']);
});

test('F-2: accessor-bearing media value is never read through its accessor', () => {
  let calls = 0;
  const media: Record<string, unknown> = {};
  Object.defineProperty(media, 'toString', {
    get() {
      calls++;
      throw new Error('accessor must not be read');
    },
  });
  const result = renderContextBlock(contextItem('ctx-a', { mediaType: media as never }), 4096, false);
  assert.equal(calls, 0, 'accessor must not be invoked');
  assert.ok(result.block.includes('mediaType=invalid'));
  assert.deepEqual(malformedKeys(result), ['context.media-malformed']);
});

test('F-2: proxy media value triggers no conversion trap', () => {
  let traps = 0;
  const media = new Proxy({ value: 'text/plain' }, {
    get(t, k, r) {
      if (k === 'toString' || k === 'valueOf' || k === Symbol.toPrimitive) {
        traps++;
        throw new Error('conversion trap must not be invoked');
      }
      return Reflect.get(t, k, r);
    },
  });
  const result = renderContextBlock(contextItem('ctx-a', { mediaType: media as never }), 4096, false);
  assert.equal(traps, 0, 'no proxy conversion trap may be invoked');
  assert.ok(result.block.includes('mediaType=invalid'));
  assert.deepEqual(malformedKeys(result), ['context.media-malformed']);
});

test('F-2: wildcard mediaType renders the invalid placeholder with a stable finding', () => {
  const result = renderContextBlock(contextItem('ctx-a', { mediaType: 'text/*' }), 4096, false);
  assert.ok(result.block.includes('mediaType=invalid'));
  assert.deepEqual(malformedKeys(result), ['context.media-undeclared']);
});

test('F-2: malformed primitive mediaType renders the invalid placeholder', () => {
  const result = renderContextBlock(contextItem('ctx-a', { mediaType: 'text/ plain' }), 4096, false);
  assert.ok(result.block.includes('mediaType=invalid'));
  assert.deepEqual(malformedKeys(result), ['context.media-malformed']);
});

test('F-2: malformed media is never represented as a valid declared media type', () => {
  for (const bad of [Symbol('x'), 42, ['text/plain'], new String('text/plain'), { toString: () => 'text/plain' }]) {
    const result = renderContextBlock(contextItem('ctx-a', { mediaType: bad as never }), 4096, false);
    assert.ok(!result.block.includes('mediaType=text/plain'), `malformed ${String(bad)} must not render as text/plain`);
    assert.ok(result.block.includes('mediaType=invalid'));
  }
});

test('F-2: non-string contextId and label render fixed placeholders without throwing', () => {
  const item = { ...contextItem('ctx-a'), contextId: Symbol('id'), label: { toString: () => 'L' } } as unknown as PiResolvedContextItem;
  const result = renderContextBlock(item, 4096, false);
  assert.ok(result.block.includes('contextId=invalid'));
  assert.equal(result.meta.label, 'invalid');
  assert.ok(result.block.includes('mediaType=text/plain'), 'valid media still renders');
});

test('F-2: null item fails closed with a stable finding', () => {
  const result = renderContextBlock(null as never, 4096, false);
  assert.equal(result.block, '');
  assert.deepEqual(malformedKeys(result), ['context.item-malformed']);
  assert.equal(result.meta.contextId, 'invalid');
});

test('F-2: renderContextBlocks with non-array items fails closed', () => {
  const result = renderContextBlocks(null as never, { maxContextItemBytes: 10, maxTotalContextBytes: 100, maxPlanBytes: 100, maxContextItemCount: 4, allowTruncation: false });
  assert.deepEqual(malformedKeys(result), ['context.items-missing']);
  assert.deepEqual(result.blocks, []);
});

test('F-2: renderContextBlocks with malformed limits fails closed', () => {
  const result = renderContextBlocks([contextItem('ctx-a')], null as never);
  assert.deepEqual(malformedKeys(result), ['input.limits-missing']);
});

test('F-2: renderContextInventory with hostile entries renders placeholders without coercion', () => {
  let calls = 0;
  const entries = [
    { contextId: Symbol('id'), requirement: 'required', priority: 1, purpose: 'p' },
    { contextId: 'ctx-b', requirement: { toString: () => { calls++; return 'required'; } }, priority: NaN, purpose: 'p2' },
  ] as never;
  const out = renderContextInventory(entries);
  assert.equal(calls, 0, 'no conversion hook may be invoked');
  assert.ok(out.includes('- invalid | label-see-data-block | requirement=required | priority=1 | purpose=p'));
  assert.ok(out.includes('- ctx-b | label-see-data-block | requirement=unknown | priority=NaN | purpose=p2'));
});

test('F-2: renderCorrelationFooter with hostile fields renders placeholders without coercion', () => {
  let calls = 0;
  const fields = [
    { key: Symbol('k'), value: 'v' },
    { key: 'occurrence_id', value: { toString: () => { calls++; return 'x'; } } },
  ] as never;
  const out = renderCorrelationFooter(fields);
  assert.equal(calls, 0, 'no conversion hook may be invoked');
  assert.ok(out.includes('- invalid: v'));
  assert.ok(out.includes('- occurrence_id: invalid'));
});

test('F-2: renderTaskSection / renderCompletionCriteria with null models never throw', () => {
  assert.equal(renderTaskSection(null as never), '[PGW-TASK]\n[/PGW-TASK]');
  assert.equal(renderCompletionCriteria(null as never), '[PGW-COMPLETION-CRITERIA]\n[/PGW-COMPLETION-CRITERIA]');
  assert.equal(renderTaskSection(42 as never), '[PGW-TASK]\n[/PGW-TASK]');
  assert.equal(renderCompletionCriteria('x' as never), '[PGW-COMPLETION-CRITERIA]\n[/PGW-COMPLETION-CRITERIA]');
});

test('F-2: renderPrompt with non-string segments never coerces', () => {
  let calls = 0;
  const out = renderPrompt('preamble', Symbol('t') as never, 'inv', ['block'], { toString: () => { calls++; return 'crit'; } } as never, 'footer');
  assert.equal(calls, 0, 'no conversion hook may be invoked');
  assert.ok(out.startsWith('preamble'));
  assert.ok(out.includes('[PGW-CONTEXT-DATA]'));
  assert.ok(out.includes('[/PGW-CONTEXT-DATA]'));
  // the non-string completion segment renders as empty without conversion
  assert.ok(!out.includes('crit'));
});

test('F-2: item-bound finding uses the placeholder contextId, never the raw value', () => {
  const item = { ...contextItem('ctx-a'), contextId: Symbol('id'), text: 'x'.repeat(100) } as unknown as PiResolvedContextItem;
  const result = renderContextBlock(item, 10, false);
  assert.ok(result.block.includes('contextId=invalid'));
  assert.ok(result.findings.some((f) => f.key === 'context.item-bound'));
  assert.ok(result.findings.every((f) => !f.message.includes('Symbol')), 'raw value must never enter findings');
});

test('F-2: caller input is not mutated by the renderer', () => {
  const item = contextItem('ctx-a', { mediaType: Symbol('x') as never });
  const snapshot = () => JSON.stringify({ contextId: item.contextId, label: item.label, byteLength: item.byteLength, truncated: item.truncated });
  const before = snapshot();
  renderContextBlock(item, 4096, false);
  assert.equal(snapshot(), before);
});

test('F-2: valid binary block with declared base64 transport renders byte framing', () => {
  const item = contextItem('ctx-a', { mediaType: 'application/octet-stream', text: undefined, bytes: new Uint8Array([1, 2, 3]), byteLength: 3 });
  const result = renderContextBlock(item, 4096, false);
  assert.equal(result.findings.length, 0);
  assert.ok(result.block.includes('mediaType=application/octet-stream'));
  assert.ok(result.block.includes('AQID'), 'base64 content present');
});

// ---------------------------------------------------------------------------
// A-1 — public renderContextBlock maxBytes must be strictly validated:
// coercion-free, hook-free, non-throwing, deterministic fail-closed
// ---------------------------------------------------------------------------
test('A-1: valid non-negative safe-integer maxBytes renders byte-correct output', () => {
  const item = { contextId: 'ctx-a', label: 'lbl', mediaType: 'text/plain', text: 'hello world', byteLength: 11, provenance: {}, truncated: false };
  const r = renderContextBlock(item, 100, false);
  assert.equal(r.findings.length, 0);
  assert.ok(r.block.includes('[PGW-CTX-BEGIN] contextId=ctx-a mediaType=text/plain byteLength=11 truncated=false'));
  assert.ok(r.block.endsWith('[PGW-CTX-END]'));
  const declared = Number(r.block.match(/byteLength=(\d+)/)![1]);
  const contentStart = r.block.indexOf('\n', r.block.indexOf('[PGW-CTX-BEGIN]')) + 1;
  const content = r.block.slice(contentStart, r.block.indexOf('[PGW-CTX-END]') - 1);
  assert.equal(declared, Buffer.byteLength(content, 'utf8'));
});

test('A-1: zero maxBytes is a valid bound (empty payload, deterministic)', () => {
  const r = renderContextBlock({ contextId: 'c', label: 'l', mediaType: 'text/plain', text: 'abc', byteLength: 3, provenance: {}, truncated: false }, 0, true);
  assert.equal(r.findings.length, 0);
  assert.ok(r.block.includes('byteLength=0 truncated=true'));
});

test('A-1: malformed maxBytes values fail closed with a stable finding and no coercion', () => {
  let valueOfCalls = 0;
  let toStringCalls = 0;
  const item = { contextId: 'c', label: 'l', mediaType: 'text/plain', text: 'abc', byteLength: 3, provenance: {}, truncated: false };
  const cases: { label: string; value: unknown }[] = [
    { label: 'negative', value: -5 },
    { label: 'fraction', value: 3.5 },
    { label: 'NaN', value: NaN },
    { label: 'Infinity', value: Infinity },
    { label: '-Infinity', value: -Infinity },
    { label: 'numeric string', value: '50' },
    { label: 'non-numeric string', value: 'abc' },
    { label: 'boolean true', value: true },
    { label: 'boolean false', value: false },
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'bigint', value: 10n },
    { label: 'Number wrapper', value: new Number(100) },
    { label: 'array', value: [100] },
    { label: 'Symbol', value: Symbol('x') },
    { label: 'counting valueOf', value: { valueOf: () => { valueOfCalls++; return 100; } } },
    { label: 'throwing valueOf', value: { valueOf: () => { valueOfCalls++; throw new Error('VALUEOF'); } } },
    { label: 'counting toString', value: { toString: () => { toStringCalls++; return '100'; } } },
    { label: 'throwing toString', value: { toString: () => { toStringCalls++; throw new Error('TOSTRING'); } } },
  ];
  for (const { label, value } of cases) {
    let result: ReturnType<typeof renderContextBlock> | undefined;
    let threw: Error | undefined;
    try {
      result = renderContextBlock(item, value as never, true);
    } catch (e) {
      threw = e as Error;
    }
    assert.equal(threw, undefined, `${label}: must not throw`);
    assert.ok(result !== undefined, `${label}: typed result`);
    assert.ok(result!.findings.some((f) => f.key === 'render.bound-malformed'), `${label}: stable render.bound-malformed finding`);
    assert.equal(result!.block, '', `${label}: deterministic fail-closed block`);
    assert.equal(result!.meta.byteLength, 0, `${label}: no valid bound represented`);
  }
  assert.equal(valueOfCalls, 0, 'valueOf must never be invoked');
  assert.equal(toStringCalls, 0, 'toString must never be invoked');
});

test('A-1: proxy with coercion and structural traps never executes for maxBytes', () => {
  let traps = 0;
  const proxy = new Proxy(
    {},
    {
      get(_t, k) {
        if (k === Symbol.toPrimitive || k === 'valueOf' || k === 'toString') {
          traps++;
          throw new Error('conversion trap must not run');
        }
        return undefined;
      },
    },
  );
  const item = { contextId: 'c', label: 'l', mediaType: 'text/plain', text: 'abc', byteLength: 3, provenance: {}, truncated: false };
  let result: ReturnType<typeof renderContextBlock> | undefined;
  let threw: Error | undefined;
  try {
    result = renderContextBlock(item, proxy as never, true);
  } catch (e) {
    threw = e as Error;
  }
  assert.equal(threw, undefined, 'proxy maxBytes must not throw');
  assert.ok(result!.findings.some((f) => f.key === 'render.bound-malformed'));
  assert.equal(traps, 0, 'no conversion trap may run');
});

test('A-1: non-boolean allowTruncation is treated as false without coercion', () => {
  const item = { contextId: 'c', label: 'l', mediaType: 'text/plain', text: 'x'.repeat(10), byteLength: 10, provenance: {}, truncated: false };
  for (const flag of ['yes', 1, null, undefined, {}]) {
    const r = renderContextBlock(item, 5, flag as never);
    assert.ok(r.findings.some((f) => f.key === 'context.item-bound'), `truncation must be denied for allowTruncation=${String(flag)}`);
    assert.ok(!r.block.includes('truncated=true'), 'no silent truncation');
  }
});

test('A-1: scalar-safe truncation and byte framing remain correct for valid bounds', () => {
  const item = { contextId: 'c', label: 'l', mediaType: 'text/plain', text: '\u{1F600}'.repeat(20), byteLength: 80, provenance: {}, truncated: false };
  const r = renderContextBlock(item, 10, true);
  assert.equal(r.findings.length, 0);
  assert.ok(r.block.includes('truncated=true'));
  const declared = Number(r.block.match(/byteLength=(\d+)/)![1]);
  assert.equal(declared, 8, 'two full 4-byte scalars within a 10-byte budget');
  const contentStart = r.block.indexOf('\n', r.block.indexOf('[PGW-CTX-BEGIN]')) + 1;
  const content = r.block.slice(contentStart, r.block.indexOf('[PGW-CTX-END]') - 1);
  assert.equal(declared, Buffer.byteLength(content, 'utf8'));
  assert.ok(!content.includes('\uFFFD'), 'no U+FFFD repair');
});
