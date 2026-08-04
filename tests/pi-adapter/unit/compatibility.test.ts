/**
 * WP-5A unit tests: host capability compatibility and fingerprint (group F).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostCapabilityFingerprint,
  inspectPiHostCompatibility,
  SUPPORTED_PI_PACKAGE_ID,
  SUPPORTED_PI_VERSION,
} from '../../../src/adapters/pi/compatibility.js';
import { SUPPORTED_CAPABILITY, buildWorld } from '../helpers.js';
import { projectExecutionBundleToPi } from '../../../src/adapters/pi/index.js';
import type { PiHostCapabilityDeclaration } from '../../../src/adapters/pi/types.js';

test('F: exact Pi 0.83.0 supported capability surface accepted', () => {
  const result = inspectPiHostCompatibility(SUPPORTED_CAPABILITY);
  assert.equal(result.compatible, true, JSON.stringify(result.findings));
  assert.deepEqual(result.findings, []);
  assert.equal(result.supportedLane, 'pi-0.83.0-extension-api-v1');
});

test('F: wrong version with compatible surface is handled according to documented policy (rejected)', () => {
  const drift = { ...SUPPORTED_CAPABILITY, piVersion: '0.84.0' };
  const result = inspectPiHostCompatibility(drift);
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'host.version-drift'));
});

test('F: matching version with missing required hook is rejected', () => {
  const missingTurn = { ...SUPPORTED_CAPABILITY, turnLifecycleEvents: ['turn_start'] };
  const result = inspectPiHostCompatibility(missingTurn);
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'host.turn-events-missing'));
});

test('F: missing prompt injection is rejected', () => {
  const missing = { ...SUPPORTED_CAPABILITY, promptInjection: [] };
  const result = inspectPiHostCompatibility(missing);
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'host.prompt-injection-missing'));
});

test('F: missing result observation is rejected', () => {
  const missing = { ...SUPPORTED_CAPABILITY, resultObservationEvents: [] };
  const result = inspectPiHostCompatibility(missing);
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'host.result-observation-missing'));
});

test('F: missing lifecycle correlation is rejected', () => {
  const missing = { ...SUPPORTED_CAPABILITY, correlationMetadataSupported: false };
  const result = inspectPiHostCompatibility(missing);
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'host.correlation-unsupported'));
});

test('F: unknown required feature is rejected', () => {
  const unknown = { ...SUPPORTED_CAPABILITY, requiredFeatures: [...SUPPORTED_CAPABILITY.requiredFeatures, 'quantum-tool-execution'] };
  const result = inspectPiHostCompatibility(unknown);
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'host.required-feature-unknown'));
});

test('F: deterministic capability fingerprint', () => {
  const a = hostCapabilityFingerprint(SUPPORTED_CAPABILITY);
  const b = hostCapabilityFingerprint(SUPPORTED_CAPABILITY);
  assert.equal(a, b);
  assert.match(a, /^sha-256:[0-9a-f]{64}$/);
  // reordered arrays must not change the fingerprint (declared-value order is irrelevant)
  const reordered: PiHostCapabilityDeclaration = {
    ...SUPPORTED_CAPABILITY,
    resultObservationEvents: [...SUPPORTED_CAPABILITY.resultObservationEvents].reverse(),
    requiredFeatures: [...SUPPORTED_CAPABILITY.requiredFeatures].reverse(),
  };
  assert.equal(hostCapabilityFingerprint(reordered), a);
  // a real surface difference changes the fingerprint
  const changed = { ...SUPPORTED_CAPABILITY, toolCallObservationEvents: [...SUPPORTED_CAPABILITY.toolCallObservationEvents, 'tool_result'] };
  assert.notEqual(hostCapabilityFingerprint(changed), a);
});

test('F: no undocumented fallback exists (missing surface never downgrades)', () => {
  const empty = { ...SUPPORTED_CAPABILITY, sessionLifecycleEvents: [], turnLifecycleEvents: [], resultObservationEvents: [], toolCallObservationEvents: [], promptInjection: [], contextTransport: [] };
  const result = inspectPiHostCompatibility(empty);
  assert.equal(result.compatible, false);
  assert.ok(result.findings.length >= 5);
});

test('F: package identity and version constants match the inspected lane', () => {
  assert.equal(SUPPORTED_PI_PACKAGE_ID, '@earendil-works/pi-coding-agent');
  assert.equal(SUPPORTED_PI_VERSION, '0.83.0');
});

// ---------------------------------------------------------------------------
// F2/F6 — media capability and exact media matching policy
// ---------------------------------------------------------------------------
test('F2: empty media list is rejected with a stable finding', () => {
  const empty = { ...SUPPORTED_CAPABILITY, mediaTypes: [] };
  const result = inspectPiHostCompatibility(empty);
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'host.text-media-missing'));
  // the fingerprint reflects the declared (empty) surface deterministically
  assert.equal(hostCapabilityFingerprint(empty), hostCapabilityFingerprint(empty));
});

test('F2: text/plain media capability is accepted', () => {
  const result = inspectPiHostCompatibility(SUPPORTED_CAPABILITY);
  assert.equal(result.compatible, true, JSON.stringify(result.findings));
});

test('F2: required text support missing is rejected', () => {
  const unsupportedOnly = { ...SUPPORTED_CAPABILITY, mediaTypes: ['application/json'] };
  const result = inspectPiHostCompatibility(unsupportedOnly);
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'host.text-media-missing'));
});

test('F2: unsupported-only media list is rejected', () => {
  const result = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, mediaTypes: ['image/png'] });
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'host.text-media-missing'));
});

test('F2/F6: malformed media declarations fail closed', () => {
  // wildcards are unsupported
  const wildcard = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, mediaTypes: ['text/plain', 'text/*'] });
  assert.equal(wildcard.compatible, false);
  assert.ok(wildcard.findings.some((f) => f.key === 'host.media-wildcard-unsupported'));
  // parameters are not valid capability declarations
  const params = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, mediaTypes: ['text/plain; charset=utf-8'] });
  assert.equal(params.compatible, false);
  assert.ok(params.findings.some((f) => f.key === 'host.media-malformed'));
  // missing subtype / missing slash
  const broken = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, mediaTypes: ['text/plain', 'text'] });
  assert.equal(broken.compatible, false);
  assert.ok(broken.findings.some((f) => f.key === 'host.media-malformed'));
  // non-string entries
  const nonString = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, mediaTypes: ['text/plain', 42 as never] });
  assert.equal(nonString.compatible, false);
  assert.ok(nonString.findings.some((f) => f.key === 'host.media-malformed'));
});

test('F2: semantically reordered media declaration remains deterministic', () => {
  const a = hostCapabilityFingerprint(SUPPORTED_CAPABILITY);
  const reordered = { ...SUPPORTED_CAPABILITY, mediaTypes: [...SUPPORTED_CAPABILITY.mediaTypes].reverse() };
  assert.equal(hostCapabilityFingerprint(reordered), a);
  const ra = inspectPiHostCompatibility(SUPPORTED_CAPABILITY);
  const rb = inspectPiHostCompatibility(reordered);
  assert.deepEqual(ra.findings, rb.findings);
  assert.equal(ra.compatible, rb.compatible);
});

test('F2: compatibility finding key is stable', () => {
  const empty = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, mediaTypes: [] });
  const onlyJson = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, mediaTypes: ['application/json'] });
  const keys = [empty, onlyJson].flatMap((r) => r.findings.map((f) => f.key));
  assert.equal(keys.filter((k) => k === 'host.text-media-missing').length, 2);
});

// ---------------------------------------------------------------------------
// R-2 — non-string capability media declarations fail inspection (no coercion,
// no hook invocation, no raw exception, deterministic fingerprint)
// ---------------------------------------------------------------------------
test('R-2: string-coercible non-string media declarations are rejected without coercion', () => {
  const values: unknown[] = [
    [['text/plain']], // nested array stringifies to text/plain under String()
    [42],
    [null],
    [undefined],
    [new String('text/plain')], // wrapper object
    [{ toString: () => 'text/plain' }],
    [true],
  ];
  for (const mediaTypes of values) {
    const result = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, mediaTypes: mediaTypes as never });
    assert.equal(result.compatible, false, `mediaTypes ${JSON.stringify(mediaTypes)} must be incompatible`);
    assert.ok(result.findings.some((f) => f.key === 'host.media-malformed'), `mediaTypes ${JSON.stringify(mediaTypes)} must yield host.media-malformed`);
  }
});

test('R-2: non-array mediaTypes declaration is rejected as malformed', () => {
  const result = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, mediaTypes: 'text/plain' as never });
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'host.media-malformed'));
});

test('R-2: conversion hooks, accessors, and proxy traps are never invoked by inspection', () => {
  let hooks = 0;
  const throwingToString = {
    toString() {
      hooks++;
      throw new Error('toString must not be called');
    },
  };
  const accessor = {};
  Object.defineProperty(accessor, 'toString', {
    enumerable: true,
    get() {
      hooks++;
      throw new Error('toString accessor must not be read');
    },
  });
  const proxy = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === Symbol.toPrimitive || prop === 'toString' || prop === 'valueOf') {
          hooks++;
          throw new Error('proxy conversion trap must not be invoked');
        }
        return undefined;
      },
    },
  );
  for (const entry of [throwingToString, accessor, proxy]) {
    let result: ReturnType<typeof inspectPiHostCompatibility>;
    let threw: Error | undefined;
    try {
      result = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, mediaTypes: ['text/plain', entry as never] });
    } catch (e) {
      threw = e as Error;
    }
    assert.equal(threw, undefined, 'inspection must not throw');
    assert.equal(result!.compatible, false);
    assert.ok(result!.findings.some((f) => f.key === 'host.media-malformed'));
  }
  assert.equal(hooks, 0, 'no conversion hook, accessor, or proxy trap may be invoked');
});

test('R-2: sparse media array fails closed', () => {
  const sparse: unknown[] = ['text/plain'];
  sparse[3] = undefined; // holes iterate as undefined
  const result = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, mediaTypes: sparse as never });
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'host.media-malformed'));
});

test('R-2: mixed valid and invalid entries fail closed with distinct findings', () => {
  const result = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, mediaTypes: ['text/plain', 42 as never] });
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'host.media-malformed'));
  assert.ok(!result.findings.some((f) => f.key === 'host.text-media-missing'), 'text/plain is present; only the malformed entry is reported');
});

test('R-2: duplicate valid media entries remain compatible', () => {
  const result = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, mediaTypes: ['text/plain', 'text/plain'] });
  assert.equal(result.compatible, true, JSON.stringify(result.findings));
});

test('R-2: malformed declarations do not crash fingerprint generation', () => {
  const malformed = [
    { ...SUPPORTED_CAPABILITY, mediaTypes: [['text/plain']] },
    { ...SUPPORTED_CAPABILITY, mediaTypes: [42] },
    { ...SUPPORTED_CAPABILITY, mediaTypes: [{ toString: () => 'text/plain' }] },
    { ...SUPPORTED_CAPABILITY, mediaTypes: 'text/plain' },
  ] as never[];
  for (const decl of malformed) {
    let fp: string;
    let threw: Error | undefined;
    try {
      fp = hostCapabilityFingerprint(decl);
    } catch (e) {
      threw = e as Error;
    }
    assert.equal(threw, undefined, 'fingerprint must not throw for malformed declarations');
    assert.equal(fp!, hostCapabilityFingerprint(decl), 'fingerprint is deterministic for malformed declarations');
  }
});

test('R-2: other caller-controlled capability lists fail closed without coercion or crash', () => {
  // non-array prompt injection list: every required mechanism reported missing
  const badInjection = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, promptInjection: 'before-agent-start-message' as never });
  assert.equal(badInjection.compatible, false);
  assert.ok(badInjection.findings.some((f) => f.key === 'host.prompt-injection-missing'));
  // non-array requiredFeatures fails closed
  const badFeatures = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, requiredFeatures: 'base64-context' as never });
  assert.equal(badFeatures.compatible, false);
  assert.ok(badFeatures.findings.some((f) => f.key === 'host.required-feature-unknown'));
  // object entries in event lists are matched by identity (===), never
  // coerced: they cannot satisfy a required event and never crash inspection
  // or fingerprinting
  let hooks = 0;
  const ev = { toString: () => { hooks++; return 'session_start'; } };
  const objEvent = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, sessionLifecycleEvents: ['session_start', 'session_shutdown', ev as never] });
  assert.equal(objEvent.compatible, true, 'required events are present; the object entry is inert');
  assert.equal(hooks, 0, 'event-list object must not be coerced');
  const missingWithObj = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, sessionLifecycleEvents: ['session_start', ev as never] });
  assert.equal(missingWithObj.compatible, false, 'an object entry cannot satisfy a required event');
  assert.ok(missingWithObj.findings.some((f) => f.key === 'host.session-events-missing'));
  let fp: string | undefined;
  let threw: Error | undefined;
  try {
    fp = hostCapabilityFingerprint({ ...SUPPORTED_CAPABILITY, sessionLifecycleEvents: ['session_start', ev as never] });
  } catch (e) {
    threw = e as Error;
  }
  assert.equal(threw, undefined, 'fingerprint must not throw for object event entries');
  assert.equal(fp, hostCapabilityFingerprint({ ...SUPPORTED_CAPABILITY, sessionLifecycleEvents: ['session_start', ev as never] }), 'fingerprint deterministic for malformed event entries');
});

// ---- F-3: maxPromptBytes must be a positive safe-integer byte count --------

function inspectWithPrompt(v: unknown): { compatible: boolean; keys: string[] } {
  let result: { compatible: boolean; findings: readonly { key: string }[] } | undefined;
  let threw: unknown;
  try {
    result = inspectPiHostCompatibility({ ...SUPPORTED_CAPABILITY, maxPromptBytes: v as never });
  } catch (e) {
    threw = e;
  }
  assert.equal(threw, undefined, 'maxPromptBytes must not throw');
  assert.ok(result !== undefined);
  return { compatible: result.compatible, keys: result.findings.map((f) => f.key).sort() };
}

test('F-3: valid positive safe-integer maxPromptBytes accepted', () => {
  assert.equal(inspectWithPrompt(262144).compatible, true);
  assert.equal(inspectWithPrompt(1).compatible, true);
  assert.equal(inspectWithPrompt(Number.MAX_SAFE_INTEGER).compatible, true);
});

test('F-3: zero and negative maxPromptBytes rejected with a stable finding', () => {
  for (const bad of [0, -1, -Infinity]) {
    const r = inspectWithPrompt(bad);
    assert.equal(r.compatible, false);
    assert.ok(r.keys.includes('host.prompt-bound-malformed'), `${bad}: ${r.keys.join(',')}`);
  }
});

test('F-3: fractional maxPromptBytes rejected', () => {
  const r = inspectWithPrompt(1.5);
  assert.equal(r.compatible, false);
  assert.ok(r.keys.includes('host.prompt-bound-malformed'));
});

test('F-3: NaN and Infinity maxPromptBytes rejected without numeric coercion', () => {
  for (const bad of [NaN, Infinity]) {
    const r = inspectWithPrompt(bad);
    assert.equal(r.compatible, false, String(bad));
    assert.ok(r.keys.includes('host.prompt-bound-malformed'), `${bad}: ${r.keys.join(',')}`);
  }
});

test('F-3: numeric and non-numeric strings rejected without coercion', () => {
  for (const bad of ['8192', 'not-a-number', '']) {
    const r = inspectWithPrompt(bad);
    assert.equal(r.compatible, false, String(bad));
    assert.ok(r.keys.includes('host.prompt-bound-malformed'), `${bad}: ${r.keys.join(',')}`);
  }
});

test('F-3: boolean, null, bigint, wrapper, and hook-bearing values rejected without hooks', () => {
  let valueOfCalls = 0;
  let toStringCalls = 0;
  const withValueOf = { valueOf: () => { valueOfCalls++; return 8192; } };
  const withToString = { toString: () => { toStringCalls++; return '8192'; } };
  const cases: { label: string; value: unknown }[] = [
    { label: 'true', value: true },
    { label: 'false', value: false },
    { label: 'null', value: null },
    { label: 'bigint', value: 8192n },
    { label: 'Number-wrapper', value: new Number(8192) },
    { label: 'valueOf-object', value: withValueOf },
    { label: 'toString-object', value: withToString },
  ];
  for (const { label, value } of cases) {
    const r = inspectWithPrompt(value);
    assert.equal(r.compatible, false, label);
    assert.ok(r.keys.includes('host.prompt-bound-malformed'), `${label}: ${r.keys.join(',')}`);
  }
  assert.equal(valueOfCalls, 0, 'valueOf must never be invoked');
  assert.equal(toStringCalls, 0, 'toString must never be invoked');
});

test('F-3: undefined maxPromptBytes keeps the missing finding', () => {
  const r = inspectWithPrompt(undefined);
  assert.equal(r.compatible, false);
  assert.ok(r.keys.includes('host.max-prompt-missing'));
});

test('F-3: unsafe integer maxPromptBytes rejected', () => {
  const r = inspectWithPrompt(2 ** 53);
  assert.equal(r.compatible, false);
  assert.ok(r.keys.includes('host.prompt-bound-malformed'));
});

test('F-3: fingerprint stays deterministic and hook-free for malformed maxPromptBytes', () => {
  let valueOfCalls = 0;
  const bad = { ...SUPPORTED_CAPABILITY, maxPromptBytes: { valueOf: () => { valueOfCalls++; return 8192; } } as never };
  let fp: string | undefined;
  let threw: Error | undefined;
  try {
    fp = hostCapabilityFingerprint(bad);
  } catch (e) {
    threw = e as Error;
  }
  assert.equal(threw, undefined, 'fingerprint must not throw');
  assert.equal(valueOfCalls, 0, 'fingerprint must not invoke valueOf');
  assert.equal(fp, hostCapabilityFingerprint(bad), 'fingerprint deterministic for malformed prompt bound');
  // valid capability fingerprints remain stable
  assert.equal(hostCapabilityFingerprint(SUPPORTED_CAPABILITY), hostCapabilityFingerprint(SUPPORTED_CAPABILITY));
});

test('F-3: host prompt limit is actually enforced by projection', () => {
  const world = buildWorld();
  const tiny = { ...SUPPORTED_CAPABILITY, maxPromptBytes: 10 };
  const result = projectExecutionBundleToPi(world.input({ capability: tiny }));
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.key === 'plan.host-prompt-bound'));
});

test('F-3: fingerprint never throws for a malformed capability container', () => {
  for (const bad of [null, 42, 'x', ['m']]) {
    let threw: unknown;
    try {
      hostCapabilityFingerprint(bad as never);
    } catch (e) {
      threw = e;
    }
    assert.equal(threw, undefined, String(bad));
  }
});
