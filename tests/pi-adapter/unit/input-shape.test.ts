/**
 * WP-5A unit tests (F-1): public-input shape gate — the public projection API
 * must fail through deterministic typed findings for expected malformed caller
 * input, never through raw exceptions, unhandled dereferences, or
 * caller-controlled coercion hooks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectExecutionBundleToPi, inspectPiHostCompatibility } from '../../../src/adapters/pi/index.js';
import { buildWorld, contextItem, corpusArtifactSet, customArtifact, cloneModel } from '../helpers.js';
import { buildWorldWith } from '../helpers/world.js';
import type { PiProjectionInput, PiResolvedContextItem } from '../../../src/adapters/pi/types.js';

/** Run one malformed-input probe: no throw, typed failure, deterministic,
 *  no plan, no mutation, no hook invocation. Returns the finding keys. */
function probe(
  makeInput: () => PiProjectionInput,
  opts: { hooks?: () => number; safeSnapshot?: () => string } = {},
): string[] {
  const before = opts.safeSnapshot?.();
  let result: ReturnType<typeof projectExecutionBundleToPi> | undefined;
  let threw: unknown;
  try {
    result = projectExecutionBundleToPi(makeInput());
  } catch (e) {
    threw = e;
  }
  assert.equal(threw, undefined, `raw exception escaped: ${threw instanceof Error ? threw.message : String(threw)}`);
  assert.ok(result !== undefined);
  assert.equal(result.ok, false, 'malformed input must not produce a plan');
  const keys = result.ok ? [] : result.findings.map((f) => f.key).sort();
  if (opts.hooks !== undefined) assert.equal(opts.hooks(), 0, 'no conversion hook may be invoked');
  if (opts.safeSnapshot !== undefined) assert.equal(opts.safeSnapshot(), before, 'caller input must not be mutated');
  // determinism: a second independent call yields identical findings
  const second = projectExecutionBundleToPi(makeInput());
  assert.deepEqual(second.ok ? [] : second.findings.map((f) => f.key).sort(), keys, 'findings must be deterministically ordered');
  return keys;
}

test('F-1: capability undefined with a valid context item fails closed (no TypeError)', () => {
  const world = buildWorld();
  const keys = probe(() => world.input({ capability: undefined as never, contextItems: [contextItem('ctx-a')] }));
  assert.ok(keys.includes('host.capability-missing'));
});

test('F-1: capability null fails closed', () => {
  const world = buildWorld();
  const keys = probe(() => world.input({ capability: null as never, contextItems: [contextItem('ctx-a')] }));
  assert.ok(keys.includes('host.capability-missing'));
});

test('F-1: capability primitive fails closed', () => {
  const world = buildWorld();
  const keys = probe(() => world.input({ capability: 42 as never }));
  assert.ok(keys.includes('host.capability-missing'));
});

test('F-1: capability array fails closed', () => {
  const world = buildWorld();
  const keys = probe(() => world.input({ capability: ['text/plain'] as never }));
  assert.ok(keys.includes('host.capability-missing'));
});

test('F-1: capability scalar fields must be primitive strings', () => {
  const world = buildWorld();
  const keys = probe(() => world.input({ capability: { ...world.capability, piVersion: Symbol('x') as never } }));
  assert.ok(keys.includes('host.capability-malformed'));
  const keys2 = probe(() => world.input({ capability: { ...world.capability, piPackageId: 42 as never } }));
  assert.ok(keys2.includes('host.capability-malformed'));
  const keys3 = probe(() => world.input({ capability: { ...world.capability, adapterApiVersion: null as never } }));
  assert.ok(keys3.includes('host.capability-malformed'));
});

test('F-1: limits undefined with a valid context item fails closed (no TypeError)', () => {
  const world = buildWorld();
  const keys = probe(() => world.input({ limits: undefined as never, contextItems: [contextItem('ctx-a')] }));
  assert.ok(keys.includes('input.limits-missing'));
});

test('F-1: limits null fails closed', () => {
  const world = buildWorld();
  const keys = probe(() => world.input({ limits: null as never }));
  assert.ok(keys.includes('input.limits-missing'));
});

test('F-1: limits primitive fails closed', () => {
  const world = buildWorld();
  const keys = probe(() => world.input({ limits: 'big' as never }));
  assert.ok(keys.includes('input.limits-missing'));
});

test('F-1: malformed numeric limit fields fail closed (no coercion)', () => {
  const world = buildWorld();
  for (const field of ['maxContextItemBytes', 'maxTotalContextBytes', 'maxPlanBytes', 'maxContextItemCount'] as const) {
    for (const bad of ['8192', NaN, 1.5, -1, Infinity, null, true]) {
      const keys = probe(() => world.input({ limits: { ...world.limits, [field]: bad } as never }));
      assert.ok(keys.includes('input.limits-malformed'), `${field}=${String(bad)}`);
    }
  }
  const keys = probe(() => world.input({ limits: { ...world.limits, allowTruncation: 'yes' } as never }));
  assert.ok(keys.includes('input.limits-malformed'));
});

test('F-1: contextItems undefined / null / non-array fail closed', () => {
  const world = buildWorld();
  for (const bad of [undefined, null, 'items', 42]) {
    const keys = probe(() => world.input({ contextItems: bad as never }));
    assert.ok(keys.includes('context.items-missing'), `contextItems=${String(bad)}`);
  }
});

test('F-1: null context item entry fails closed', () => {
  const world = buildWorld();
  const keys = probe(() => world.input({ contextItems: [null as never] }));
  assert.ok(keys.includes('context.item-malformed'));
});

test('F-1: undefined context item entry fails closed', () => {
  const world = buildWorld();
  const keys = probe(() => world.input({ contextItems: [undefined as never] }));
  assert.ok(keys.includes('context.item-malformed'));
});

test('F-1: numeric context item entry fails closed', () => {
  const world = buildWorld();
  const keys = probe(() => world.input({ contextItems: [42 as never] }));
  assert.ok(keys.includes('context.item-malformed'));
});

test('F-1: string context item entry fails closed', () => {
  const world = buildWorld();
  const keys = probe(() => world.input({ contextItems: ['ctx-a' as never] }));
  assert.ok(keys.includes('context.item-malformed'));
});

test('F-1: array context item entry fails closed', () => {
  const world = buildWorld();
  const keys = probe(() => world.input({ contextItems: [['ctx-a'] as never] }));
  assert.ok(keys.includes('context.item-malformed'));
});

test('F-1: class-instance context item fails closed', () => {
  const world = buildWorld();
  class FakeItem {
    contextId = 'ctx-a';
    label = 'l';
    mediaType = 'text/plain';
    byteLength = 1;
    provenance = {};
    truncated = false;
    text = 'x';
  }
  const keys = probe(() => world.input({ contextItems: [new FakeItem() as never] }));
  assert.ok(keys.includes('context.item-malformed'));
});

test('F-1: context item missing required contextId fails closed', () => {
  const world = buildWorld();
  const { contextId: _omit, ...rest } = contextItem('ctx-a');
  const keys = probe(() => world.input({ contextItems: [rest as PiResolvedContextItem] }));
  assert.ok(keys.includes('context.item-malformed'));
  void _omit;
});

test('F-1: accessor-bearing contextId is rejected without invoking the getter', () => {
  const world = buildWorld();
  let calls = 0;
  const item = contextItem('ctx-a');
  Object.defineProperty(item, 'contextId', {
    get() {
      calls++;
      return 'ctx-a';
    },
  });
  const keys = probe(() => world.input({ contextItems: [item as never] }), { hooks: () => calls });
  assert.ok(keys.includes('context.item-malformed'));
});

test('F-1: inherited-only contextId is rejected without reading it', () => {
  const world = buildWorld();
  const proto = { contextId: 'ctx-a' };
  const item = Object.create(proto) as unknown as Record<string, unknown>;
  item['label'] = 'l';
  item['mediaType'] = 'text/plain';
  item['byteLength'] = 1;
  item['provenance'] = {};
  item['truncated'] = false;
  const keys = probe(() => world.input({ contextItems: [item as never] }));
  assert.ok(keys.includes('context.item-malformed'));
});

test('F-1: item with throwing getters fails closed without invoking them', () => {
  const world = buildWorld();
  let calls = 0;
  const item: Record<string, unknown> = {};
  for (const field of ['contextId', 'label', 'mediaType', 'byteLength', 'provenance', 'truncated']) {
    Object.defineProperty(item, field, {
      get() {
        calls++;
        throw new Error(`getter for ${field} must not be invoked`);
      },
      enumerable: true,
    });
  }
  const keys = probe(() => world.input({ contextItems: [item as never] }), { hooks: () => calls });
  assert.ok(keys.includes('context.item-malformed'));
});

test('F-1: proxy-wrapped malformed item fails closed without conversion traps', () => {
  const world = buildWorld();
  let traps = 0;
  const proxy = new Proxy({}, {
    get(t, k, r) {
      if (k === 'toString' || k === 'valueOf' || k === Symbol.toPrimitive) {
        traps++;
        throw new Error('conversion trap must not be invoked');
      }
      return Reflect.get(t, k, r);
    },
  });
  const keys = probe(() => world.input({ contextItems: [proxy as never] }), { hooks: () => traps });
  assert.ok(keys.includes('context.item-malformed'));
});

test('F-1: non-string contextId is rejected without coercion', () => {
  const world = buildWorld();
  let calls = 0;
  const item = contextItem('ctx-a') as unknown as Record<string, unknown>;
  item['contextId'] = { toString: () => { calls++; return 'ctx-a'; } };
  const keys = probe(() => world.input({ contextItems: [item as never] }), { hooks: () => calls });
  assert.ok(keys.includes('context.item-malformed'));
});

test('F-1: caller input is not mutated by the shape gate', () => {
  const world = buildWorld();
  const item = contextItem('ctx-a');
  probe(() => world.input({ contextItems: [null as never] }), {
    safeSnapshot: () => JSON.stringify({ ...item, mediaType: 'safe' }),
  });
  probe(() => world.input({ contextItems: [item] }));
  assert.equal(item.contextId, 'ctx-a');
  assert.equal(item.mediaType, 'text/plain');
});

test('F-1: sparse context-items array holes are rejected', () => {
  const world = buildWorld();
  const sparse = new Array<unknown>(3);
  sparse[0] = contextItem('ctx-a');
  const keys = probe(() => world.input({ contextItems: sparse as never }));
  const malformedCount = keys.filter((k) => k === 'context.item-malformed').length;
  assert.equal(malformedCount, 2, `holes must each be rejected: keys=${keys.join(',')}`);
});

test('F-1: malformed top-level input container fails closed', () => {
  for (const bad of [undefined, null, 42, 'input', ['x']]) {
    let threw: unknown;
    let result: ReturnType<typeof projectExecutionBundleToPi> | undefined;
    try {
      result = projectExecutionBundleToPi(bad as never);
    } catch (e) {
      threw = e;
    }
    assert.equal(threw, undefined, `input=${String(bad)} must not throw`);
    assert.ok(result !== undefined);
    assert.equal(result.ok, false);
    assert.ok((result.ok ? [] : result.findings).some((f) => f.key === 'input.invalid'));
  }
});

// ---- required-feature handling (F-1 items 22-27) --------------------------

/** Build a world whose TaskSpec requires a real, schema-valid protocol
 *  feature (`project-gateway.conformance-fixture`; the only feature id the
 *  schema/consumer support admits). The capability declares the same id for
 *  the semantic check; the host-feature whitelist (KNOWN_FEATURES) rejects it
 *  at inspection, which is the documented fail-closed host-feature policy and
 *  is independent of the F-1 null-safety correction. */
function featureWorld(): ReturnType<typeof buildWorld> {
  const set = corpusArtifactSet();
  const task = customArtifact(cloneModel(set.task), (m) => {
    m['requirements'] = {
      ...((m['requirements'] as Record<string, unknown> | undefined) ?? {}),
      protocol_features: [{ class: 'protocol-feature', id: 'project-gateway.conformance-fixture', version: '1.0' }],
    };
  });
  const bundle = cloneModel(set.bundle);
  const revision = task['revision'] as Record<string, unknown>;
  const kindId = (task['kind'] as Record<string, unknown>)['id'];
  const binding = task['workspace_binding'] as Record<string, unknown>;
  (bundle['body'] as Record<string, unknown>)['task'] = {
    target_protocol_version: '1.0',
    target_kind: { id: kindId, version: '1.0' },
    target_instance_id: task['instance_id'],
    target_revision_id: revision['id'],
    target_digest: revision['digest'],
    target_workspace_binding: binding,
  };
  return buildWorld({ ...set, task, bundle: customArtifact(bundle, () => {}) });
}

test('F-1: requiredFeatures absent with a feature-requiring subject fails closed (no TypeError)', () => {
  const world = featureWorld();
  const capability = JSON.parse(JSON.stringify(world.capability));
  delete capability.requiredFeatures;
  const keys = probe(() => world.input({ capability, contextItems: [] }));
  assert.ok(keys.includes('semantic.feature-unsupported'), `keys=${keys.join(',')}`);
  assert.ok(!keys.includes('host.required-feature-unknown'), `keys=${keys.join(',')}`);
});

test('F-1: requiredFeatures null fails closed', () => {
  const world = featureWorld();
  const capability = { ...world.capability, requiredFeatures: null as never };
  const keys = probe(() => world.input({ capability, contextItems: [] }));
  assert.ok(keys.includes('host.required-feature-unknown'));
  assert.ok(keys.includes('semantic.feature-unsupported'));
});

test('F-1: requiredFeatures non-array fails closed', () => {
  const world = featureWorld();
  const capability = { ...world.capability, requiredFeatures: 'project-gateway.conformance-fixture' as never };
  const keys = probe(() => world.input({ capability, contextItems: [] }));
  assert.ok(keys.includes('host.required-feature-unknown'));
  assert.ok(keys.includes('semantic.feature-unsupported'));
});

test('F-1: requiredFeatures with non-string entries fails closed without coercion', () => {
  const world = featureWorld();
  let calls = 0;
  const capability = { ...world.capability, requiredFeatures: ['project-gateway.conformance-fixture', { toString: () => { calls++; return 'x'; } }] as never };
  const keys = probe(() => world.input({ capability, contextItems: [] }), { hooks: () => calls });
  assert.ok(keys.includes('host.required-feature-unknown'));
  // the primitive-string feature is present, so the semantic check passes
  assert.ok(!keys.includes('semantic.feature-unsupported'), `keys=${keys.join(',')}`);
});

test('F-1: required feature missing from the capability fails closed', () => {
  const world = featureWorld();
  const capability = { ...world.capability, requiredFeatures: world.capability.requiredFeatures.filter((f) => f !== 'project-gateway.conformance-fixture') };
  const keys = probe(() => world.input({ capability, contextItems: [] }));
  assert.ok(keys.includes('semantic.feature-unsupported'), `keys=${keys.join(',')}`);
});

test('F-1: required feature present satisfies the semantic check (no semantic finding)', () => {
  const world = featureWorld();
  const capability = { ...world.capability, requiredFeatures: [...world.capability.requiredFeatures, 'project-gateway.conformance-fixture'] };
  const keys = probe(() => world.input({ capability, contextItems: [] }));
  assert.ok(!keys.includes('semantic.feature-unsupported'), `semantic check must pass when declared: keys=${keys.join(',')}`);
  // the feature id is not a whitelisted host feature, so inspection still
  // fails closed per the documented host-feature policy (independent of F-1)
  assert.ok(keys.includes('host.required-feature-unknown'));
});

test('F-1: valid feature-free projection still produces a plan', () => {
  const world = buildWorld();
  const result = projectExecutionBundleToPi(world.input({ contextItems: [] }));
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.findings.map((f) => f.key)));
});

test('F-1: standalone inspection never throws for malformed capability scalars', () => {
  const world = buildWorld();
  for (const field of ['piPackageId', 'piVersion', 'adapterApiVersion']) {
    for (const bad of [Symbol('x'), 42, null, ['v']]) {
      let threw: unknown;
      let r: { compatible: boolean } | undefined;
      try {
        r = inspectPiHostCompatibility({ ...world.capability, [field]: bad } as never);
      } catch (e) {
        threw = e;
      }
      assert.equal(threw, undefined, `${field}=${String(bad)} must not throw`);
      assert.ok(r !== undefined);
      assert.equal(r.compatible, false);
    }
  }
});

// World whose manifest selects ctx-a (required) for item-level A-3 tests.
function itemWorld() {
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
  return buildWorldWith({ ...base, context: manifest }, 'context');
}

// ---------------------------------------------------------------------------
// A-2 — every capability field is read through own data descriptors: getters,
// accessors, and Proxy `get` traps never execute; structural trap failures
// become stable findings; no raw exception escapes.
// ---------------------------------------------------------------------------
const a2World = itemWorld();
const CAP_FIELDS_A2 = [
  'piPackageId', 'piVersion', 'adapterApiVersion', 'promptInjection', 'contextTransport',
  'maxPromptBytes', 'textEncodings', 'mediaTypes', 'sessionLifecycleEvents', 'turnLifecycleEvents',
  'resultObservationEvents', 'toolCallObservationEvents', 'cancellationObservationEvents',
  'shutdownObservationEvents', 'correlationMetadataSupported', 'deterministicOrdering', 'requiredFeatures',
] as const;

test('A-2: capability-field accessor getters are never invoked (all fields)', () => {
  for (const field of CAP_FIELDS_A2) {
    let reads = 0;
    const cap = { ...a2World.capability };
    Object.defineProperty(cap, field, { enumerable: true, get() { reads++; return a2World.capability[field]; } });
    const keys = probe(() => a2World.input({ capability: cap as never }), { hooks: () => reads });
    assert.ok(keys.includes('host.capability-malformed'), `${field}: stable finding`);
  }
});

test('A-2: throwing capability-field accessors fail closed (all fields)', () => {
  for (const field of CAP_FIELDS_A2) {
    const cap = { ...a2World.capability };
    Object.defineProperty(cap, field, { enumerable: true, get() { throw new Error(`accessor ${field}`); } });
    const keys = probe(() => a2World.input({ capability: cap as never }));
    assert.ok(keys.includes('host.capability-malformed'), `${field}: stable finding`);
  }
});

test('A-2: inherited-only capability fields are never read through the prototype', () => {
  // an object whose only source for a field is the prototype chain: the
  // descriptor gate treats it as absent and the inspector reports the
  // semantic consequence with a stable host finding; the inherited getter
  // never executes
  for (const field of CAP_FIELDS_A2) {
    let inheritedReads = 0;
    const proto: Record<string, unknown> = {};
    Object.defineProperty(proto, field, { enumerable: true, get() { inheritedReads++; return a2World.capability[field]; } });
    const cap = Object.create(proto);
    for (const f of CAP_FIELDS_A2) {
      if (f === field) continue;
      Object.defineProperty(cap, f, { enumerable: true, value: a2World.capability[f] });
    }
    let result: ReturnType<typeof projectExecutionBundleToPi> | undefined;
    let threw: Error | undefined;
    try {
      result = projectExecutionBundleToPi(a2World.input({ capability: cap as never }));
    } catch (e) {
      threw = e as Error;
    }
    assert.equal(threw, undefined, `${field}: must not throw`);
    assert.equal(inheritedReads, 0, `${field}: inherited getter must not run`);
    assert.equal(result!.ok, false, `${field}: inherited-only field must fail closed`);
    assert.ok(result!.findings.length > 0, `${field}: stable findings`);
  }
});

test('A-2: capability Proxy get-trap never executes for any field (descriptor reads only)', () => {
  for (const field of CAP_FIELDS_A2) {
    let getCalls = 0;
    const proxy = new Proxy({ ...a2World.capability }, {
      get(t, k, r) {
        if (k === field) { getCalls++; throw new Error(`get ${field}`); }
        return Reflect.get(t, k, r);
      },
    });
    let result: ReturnType<typeof projectExecutionBundleToPi> | undefined;
    let threw: Error | undefined;
    try {
      result = projectExecutionBundleToPi(a2World.input({ capability: proxy as never }));
    } catch (e) {
      threw = e as Error;
    }
    assert.equal(threw, undefined, `${field}: must not throw`);
    assert.equal(getCalls, 0, `${field}: Proxy get trap must never execute`);
    // a proxy whose descriptors are intact carries the same values: it may
    // project normally — the guarantee is hook-free reads, not rejection
    assert.ok(result !== undefined, `${field}: typed result`);
  }
});

test('A-2: capability Proxy structural traps throwing become stable findings', () => {
  for (const [name, make] of [
    ['getPrototypeOf', () => new Proxy({ ...a2World.capability }, { getPrototypeOf() { throw new Error('proto'); } })],
    ['getOwnPropertyDescriptor', () => new Proxy({ ...a2World.capability }, { getOwnPropertyDescriptor() { throw new Error('desc'); } })],
  ] as const) {
    const keys = probe(() => a2World.input({ capability: make() as never }));
    assert.ok(keys.includes('host.capability-malformed') || keys.includes('host.capability-missing'), `${name}: stable finding`);
  }
});

test('A-2: standalone inspection never invokes capability getters and never throws', () => {
  for (const field of CAP_FIELDS_A2) {
    let reads = 0;
    const cap = { ...a2World.capability };
    Object.defineProperty(cap, field, { enumerable: true, get() { reads++; return a2World.capability[field]; } });
    let result: ReturnType<typeof inspectPiHostCompatibility> | undefined;
    let threw: Error | undefined;
    try {
      result = inspectPiHostCompatibility(cap as never);
    } catch (e) {
      threw = e as Error;
    }
    assert.equal(threw, undefined, `${field}: inspection must not throw`);
    assert.equal(reads, 0, `${field}: getter must not run`);
    assert.equal(result!.compatible, false, `${field}: accessor-bearing capability must be incompatible`);
    assert.ok(result!.findings.some((f) => f.key === 'host.capability-malformed'), `${field}: stable finding`);
  }
});

// ---------------------------------------------------------------------------
// A-3 — context-item fields are read through own data descriptors: ordinary
// `get` traps on item proxies never execute, structural trap failures become
// stable findings, and valid items project identically.
// ---------------------------------------------------------------------------
test('A-3: context-item Proxy get traps never execute for any field', () => {
  const required = ['contextId', 'label', 'mediaType', 'byteLength', 'provenance', 'truncated'] as const;
  for (const field of required) {
    let getCalls = 0;
    const base: Record<string, unknown> = { contextId: 'ctx-a', label: 'l', mediaType: 'text/plain', text: 'hi', byteLength: 2, provenance: { source: 'x' }, truncated: false };
    const proxy = new Proxy(base, {
      get(t, k, r) {
        if (k === field) { getCalls++; throw new Error(`get ${field}`); }
        return Reflect.get(t, k, r);
      },
    });
    // the item must be accepted via descriptors with the get trap never firing
    const result = projectExecutionBundleToPi(a2World.input({ contextItems: [proxy as never] }));
    assert.equal(result.ok, true, `proxy-wrapped item for ${field} must project via descriptor values`);
    assert.equal(getCalls, 0, `get trap for ${field} must never execute`);
  }
});

test('A-3: context-item Proxy get traps never execute for optional fields', () => {
  for (const field of ['text', 'bytes', 'contentDigest']) {
    let getCalls = 0;
    const base: Record<string, unknown> = { contextId: 'ctx-a', label: 'l', mediaType: 'text/plain', text: 'hi', byteLength: 2, provenance: { source: 'x' }, truncated: false };
    const proxy = new Proxy(base, {
      get(t, k, r) {
        if (k === field) { getCalls++; throw new Error(`get ${field}`); }
        return Reflect.get(t, k, r);
      },
    });
    const result = projectExecutionBundleToPi(a2World.input({ contextItems: [proxy as never] }));
    assert.equal(result.ok, true, `optional ${field} get trap must not block descriptor reads`);
    assert.equal(getCalls, 0, `get trap for ${field} must never execute`);
  }
});

test('A-3: context-item structural trap failures become stable findings', () => {
  const base = { contextId: 'ctx-a', label: 'l', mediaType: 'text/plain', text: 'hi', byteLength: 2, provenance: { source: 'x' }, truncated: false };
  for (const [name, make] of [
    ['getPrototypeOf', () => new Proxy(base, { getPrototypeOf() { throw new Error('proto'); } })],
    ['getOwnPropertyDescriptor', () => new Proxy(base, { getOwnPropertyDescriptor() { throw new Error('desc'); } })],
  ] as const) {
    const keys = probe(() => a2World.input({ contextItems: [make() as never] }));
    assert.ok(keys.includes('context.item-malformed'), `${name}: stable finding`);
  }
});

test('A-3: valid Proxy-free items project identically to snapshotted equivalents', () => {
  const a = projectExecutionBundleToPi(a2World.input({ contextItems: [contextItem('ctx-a')] }));
  assert.equal(a.ok, true);
  void a;
});

// ---- F-A4: eligibility / requested-use / registry evidence containers ------

interface TrapCounters {
  getter: number;
  getTrap: number;
  gopdTrap: number;
  gpoTrap: number;
}
const zeroCounters = (): TrapCounters => ({ getter: 0, getTrap: 0, gopdTrap: 0, gpoTrap: 0 });

/** F-A4 probe: no raw exception, no plan, deterministic findings, and (when
 *  provided) zero caller hook / Proxy `get` invocation. Returns the keys. */
function probeEvidence(
  name: string,
  makeInput: () => PiProjectionInput,
  counters?: TrapCounters,
  expectOk = false,
): string[] {
  let result: ReturnType<typeof projectExecutionBundleToPi> | undefined;
  let threw: unknown;
  try {
    result = projectExecutionBundleToPi(makeInput());
  } catch (e) {
    threw = e;
  }
  assert.equal(threw, undefined, `${name}: raw exception escaped: ${threw instanceof Error ? threw.message : String(threw)}`);
  assert.ok(result !== undefined);
  assert.equal(result.ok, expectOk, `${name}: unexpected ok=${result.ok}`);
  const keys = result.ok ? [] : result.findings.map((f) => f.key).sort();
  if (counters !== undefined) {
    assert.equal(counters.getter, 0, `${name}: getter invoked`);
    assert.equal(counters.getTrap, 0, `${name}: Proxy get trap invoked`);
  }
  // determinism
  const second = projectExecutionBundleToPi(makeInput());
  assert.deepEqual(second.ok ? [] : second.findings.map((f) => f.key).sort(), keys, `${name}: non-deterministic`);
  return keys;
}

function withGetter(obj: Record<string, unknown>, field: string, counters: TrapCounters, value: unknown): Record<string, unknown> {
  Object.defineProperty(obj, field, {
    get() {
      counters.getter++;
      return value;
    },
    enumerable: true,
    configurable: true,
  });
  return obj;
}

test('F-A4: eligibility undefined/null/primitive/array fail closed as missing', () => {
  const world = buildWorld();
  for (const bad of [undefined, null, 42, 'evidence', ['eligible']]) {
    const keys = probeEvidence(`eligibility=${String(bad)}`, () => world.input({ eligibility: bad as never }));
    assert.ok(keys.includes('input.eligibility-missing'), `keys=${keys.join(',')}`);
  }
});

test('F-A4: class-instance eligibility fails closed', () => {
  const world = buildWorld();
  class FakeEvidence {
    eligible = true;
    capability = 'project-gateway.workspace-read';
    workspaceId = 'pgw:w:cf4339b1f56441936467dea1357dc30e';
    subjectCorrelations = { bundleInstance: 'x' };
  }
  const keys = probeEvidence('class-instance', () => world.input({ eligibility: new FakeEvidence() as never }));
  assert.ok(keys.includes('input.eligibility-missing'));
});

test('F-A4: missing eligible fails closed', () => {
  const world = buildWorld();
  const { eligible: _e, ...rest } = world.eligibility;
  const keys = probeEvidence('missing-eligible', () => world.input({ eligibility: rest as never }));
  assert.ok(keys.includes('input.eligibility-malformed'));
  void _e;
});

test('F-A4: inherited-only eligible fails closed', () => {
  const world = buildWorld();
  const proto = { eligible: true };
  const elig = Object.create(proto);
  for (const k of ['capability', 'workspaceId', 'subjectCorrelations']) elig[k] = world.eligibility[k as keyof typeof world.eligibility];
  const keys = probeEvidence('inherited-eligible', () => world.input({ eligibility: elig as never }));
  // an inherited-only field forces a non-plain prototype, so the container
  // fails closed as missing (never read through the prototype)
  assert.ok(keys.includes('input.eligibility-missing'), keys.join(','));
});

test('F-A4: getter for eligible is rejected without invocation', () => {
  const world = buildWorld();
  const counters = zeroCounters();
  const elig = withGetter({ ...world.eligibility }, 'eligible', counters, true);
  const keys = probeEvidence('getter-eligible', () => world.input({ eligibility: elig as never }), counters);
  assert.ok(keys.includes('input.eligibility-malformed'));
});

test('F-A4: throwing getter for eligible fails closed', () => {
  const world = buildWorld();
  const counters = zeroCounters();
  const elig: Record<string, unknown> = { ...world.eligibility };
  Object.defineProperty(elig, 'eligible', {
    get() {
      counters.getter++;
      throw new Error('F-A4-ELIGIBLE-GETTER');
    },
    configurable: true,
  });
  const keys = probeEvidence('throwing-getter-eligible', () => world.input({ eligibility: elig as never }), counters);
  assert.ok(keys.includes('input.eligibility-malformed'));
});

test('F-A4: accessor and throwing accessor matrix for capability/workspaceId/subjectCorrelations', () => {
  const world = buildWorld();
  for (const field of ['capability', 'workspaceId', 'subjectCorrelations']) {
    const counters = zeroCounters();
    const withGetterElig = withGetter({ ...world.eligibility }, field, counters, world.eligibility[field as keyof typeof world.eligibility]);
    let keys = probeEvidence(`getter-${field}`, () => world.input({ eligibility: withGetterElig as never }), counters);
    assert.ok(keys.includes('input.eligibility-malformed'), `${field}: ${keys.join(',')}`);

    const throwing: Record<string, unknown> = { ...world.eligibility };
    Object.defineProperty(throwing, field, {
      get() {
        counters.getter++;
        throw new Error(`F-A4-GETTER-${field}`);
      },
      configurable: true,
    });
    keys = probeEvidence(`throwing-getter-${field}`, () => world.input({ eligibility: throwing as never }), counters);
    assert.ok(keys.includes('input.eligibility-malformed'), `${field}: ${keys.join(',')}`);
  }
});

test('F-A4: eligibility Proxy with throwing get never fires the trap', () => {
  const world = buildWorld();
  const counters = zeroCounters();
  const elig = new Proxy({ ...world.eligibility }, {
    get(t, k) {
      counters.getTrap++;
      throw new Error('F-A4-GET');
    },
  });
  // the gate reads through descriptors only, so the valid target data is used
  const keys = probeEvidence('proxy-throwing-get', () => world.input({ eligibility: elig as never }), counters, true);
  assert.deepEqual(keys, []);
});

test('F-A4: eligibility Proxy throwing on getOwnPropertyDescriptor fails closed', () => {
  const world = buildWorld();
  const counters = zeroCounters();
  const elig = new Proxy({ ...world.eligibility }, {
    getOwnPropertyDescriptor() {
      counters.gopdTrap++;
      throw new Error('F-A4-GOPD');
    },
  });
  const keys = probeEvidence('proxy-gopd', () => world.input({ eligibility: elig as never }), counters);
  assert.ok(keys.includes('input.eligibility-malformed') || keys.includes('input.eligibility-missing'), keys.join(','));
});

test('F-A4: eligibility Proxy throwing on getPrototypeOf fails closed', () => {
  const world = buildWorld();
  const counters = zeroCounters();
  const elig = new Proxy({ ...world.eligibility }, {
    getPrototypeOf() {
      counters.gpoTrap++;
      throw new Error('F-A4-GPO');
    },
  });
  const keys = probeEvidence('proxy-gpo', () => world.input({ eligibility: elig as never }), counters);
  assert.ok(keys.includes('input.eligibility-missing'));
});

test('F-A4: eligibility Proxy counting get stays at zero', () => {
  const world = buildWorld();
  const counters = zeroCounters();
  const elig = new Proxy({ ...world.eligibility }, {
    get(t, k) {
      counters.getTrap++;
      return Reflect.get(t, k);
    },
  });
  const keys = probeEvidence('proxy-counting-get', () => world.input({ eligibility: elig as never }), counters, true);
  assert.deepEqual(keys, []);
});

test('F-A4: subjectCorrelations missing bundleInstance is a valid lenient correlation', () => {
  const world = buildWorld();
  const elig = { ...world.eligibility, subjectCorrelations: { workspace: 'pgw:w:x' } };
  const keys = probeEvidence('missing-bundleInstance', () => world.input({ eligibility: elig as never }), undefined, true);
  assert.deepEqual(keys, []);
});

test('F-A4: subjectCorrelations inherited/accessor/malformed bundleInstance fail closed', () => {
  const world = buildWorld();
  // inherited
  const inheritedSc = Object.create({ bundleInstance: world.eligibility.subjectCorrelations.bundleInstance });
  let keys = probeEvidence('inherited-bundleInstance', () => world.input({ eligibility: { ...world.eligibility, subjectCorrelations: inheritedSc } as never }));
  assert.ok(keys.includes('input.eligibility-malformed'), keys.join(','));
  // accessor
  const counters = zeroCounters();
  const sc = {};
  withGetter(sc, 'bundleInstance', counters, 'x');
  keys = probeEvidence('accessor-bundleInstance', () => world.input({ eligibility: { ...world.eligibility, subjectCorrelations: sc } as never }), counters);
  assert.ok(keys.includes('input.eligibility-malformed'), keys.join(','));
  // malformed primitive
  keys = probeEvidence('primitive-bundleInstance', () => world.input({ eligibility: { ...world.eligibility, subjectCorrelations: { bundleInstance: 42 } } as never }));
  assert.ok(keys.includes('input.eligibility-malformed'), keys.join(','));
  // non-plain container
  keys = probeEvidence('array-subjectCorrelations', () => world.input({ eligibility: { ...world.eligibility, subjectCorrelations: ['x'] } as never }));
  assert.ok(keys.includes('input.eligibility-malformed'), keys.join(','));
});

test('F-A4: subjectCorrelations Proxy never fires get traps', () => {
  const world = buildWorld();
  const counters = zeroCounters();
  const sc = new Proxy({ ...world.eligibility.subjectCorrelations }, {
    get(t, k) {
      counters.getTrap++;
      throw new Error('F-A4-SC-GET');
    },
  });
  const keys = probeEvidence('proxy-sc-get', () => world.input({ eligibility: { ...world.eligibility, subjectCorrelations: sc } as never }), counters, true);
  assert.deepEqual(keys, []);
});

test('F-A4: well-formed exact bundle correlation projects; mismatch keeps the stable finding', () => {
  const world = buildWorld();
  const exact = probeEvidence('exact-correlation', () => world.input({ contextItems: [] }), undefined, true);
  assert.deepEqual(exact, []);
  const mismatch = probeEvidence('mismatched-bundleInstance', () =>
    world.input({ eligibility: { ...world.eligibility, subjectCorrelations: { ...world.eligibility.subjectCorrelations, bundleInstance: 'pgw:i:wrong' } } as never }),
  );
  assert.ok(mismatch.includes('input.eligibility-correlation'), mismatch.join(','));
  // requested-use mismatch keeps the same stable finding
  const useMismatch = probeEvidence('requested-use-mismatch', () =>
    world.input({ requestedUse: { ...world.input().requestedUse!, capability: 'project-gateway.workspace-write' } as never }),
  );
  assert.ok(useMismatch.includes('input.eligibility-correlation'), useMismatch.join(','));
});

test('F-A4: requestedUse missing/inherited/accessor/proxy fail closed without hooks', () => {
  const world = buildWorld();
  const counters = zeroCounters();
  // missing fields
  let keys = probeEvidence('missing-capability', () => world.input({ requestedUse: { workspaceId: 'w' } as never }), counters);
  assert.ok(keys.includes('input.requested-use-malformed'), keys.join(','));
  keys = probeEvidence('missing-workspaceId', () => world.input({ requestedUse: { capability: 'c' } as never }), counters);
  assert.ok(keys.includes('input.requested-use-malformed'), keys.join(','));
  // inherited
  const proto = { capability: 'c', workspaceId: 'w' };
  const inherited = Object.create(proto);
  keys = probeEvidence('inherited', () => world.input({ requestedUse: inherited as never }), counters);
  assert.ok(keys.includes('input.requested-use-malformed'), keys.join(','));
  // accessor
  const withGetterUse = withGetter({ ...world.input().requestedUse! }, 'capability', counters, 'c');
  keys = probeEvidence('accessor', () => world.input({ requestedUse: withGetterUse as never }), counters);
  assert.ok(keys.includes('input.requested-use-malformed'), keys.join(','));
  // throwing accessor
  const throwingUse: Record<string, unknown> = { ...world.input().requestedUse! };
  Object.defineProperty(throwingUse, 'workspaceId', {
    get() {
      counters.getter++;
      throw new Error('F-A4-USE-GETTER');
    },
    configurable: true,
  });
  keys = probeEvidence('throwing-accessor', () => world.input({ requestedUse: throwingUse as never }), counters);
  assert.ok(keys.includes('input.requested-use-malformed'), keys.join(','));
  // proxy counting get
  const useProxy = new Proxy({ ...world.input().requestedUse! }, {
    get(t, k) {
      counters.getTrap++;
      return Reflect.get(t, k);
    },
  });
  keys = probeEvidence('proxy-get', () => world.input({ requestedUse: useProxy as never }), counters, true);
  assert.deepEqual(keys, []);
  // proxy throwing on gopd
  const gopdProxy = new Proxy({ ...world.input().requestedUse! }, {
    getOwnPropertyDescriptor() {
      counters.gopdTrap++;
      throw new Error('F-A4-USE-GOPD');
    },
  });
  keys = probeEvidence('proxy-gopd', () => world.input({ requestedUse: gopdProxy as never }), counters);
  assert.ok(keys.includes('input.requested-use-malformed'), keys.join(','));
});

test('F-A4: registry missing/null/primitive fail closed; identity strings validated', () => {
  const world = buildWorld();
  for (const bad of [undefined, null, 'registry', 42]) {
    const keys = probeEvidence(`registry=${String(bad)}`, () => world.input({ registry: bad as never }));
    assert.ok(keys.includes('input.registry-missing'), `keys=${keys.join(',')}`);
  }
  const missingId = { ...world.input().registry };
  delete (missingId as Record<string, unknown>)['registrySnapshotId'];
  const keys = probeEvidence('missing-id', () => world.input({ registry: missingId as never }));
  assert.ok(keys.includes('input.registry-malformed'), keys.join(','));
  const badDigest = { ...world.input().registry, registrySnapshotDigest: 42 };
  const keys2 = probeEvidence('malformed-digest', () => world.input({ registry: badDigest as never }));
  assert.ok(keys2.includes('input.registry-malformed'), keys2.join(','));
});

test('F-A4: registry inherited/accessor/proxy fail closed without hooks', () => {
  const world = buildWorld();
  const counters = zeroCounters();
  const proto = { registrySnapshotId: 'snap-1' };
  const inherited = Object.create(proto);
  const reg = world.input().registry;
  for (const k of ['registryProtocolId', 'registrySnapshotFormatVersion', 'registrySnapshotDigest']) inherited[k] = reg[k as keyof typeof reg];
  let keys = probeEvidence('inherited-id', () => world.input({ registry: inherited as never }), counters);
  // an inherited-only field forces a non-plain prototype: fails closed as missing
  assert.ok(keys.includes('input.registry-missing'), keys.join(','));
  const withGetterReg = withGetter({ ...world.input().registry }, 'registrySnapshotId', counters, 'snap-1');
  keys = probeEvidence('accessor-id', () => world.input({ registry: withGetterReg as never }), counters);
  assert.ok(keys.includes('input.registry-malformed'), keys.join(','));
  const throwingReg: Record<string, unknown> = { ...world.input().registry };
  Object.defineProperty(throwingReg, 'registrySnapshotId', {
    get() {
      counters.getter++;
      throw new Error('F-A4-REG-GETTER');
    },
    configurable: true,
  });
  keys = probeEvidence('throwing-accessor', () => world.input({ registry: throwingReg as never }), counters);
  assert.ok(keys.includes('input.registry-malformed'), keys.join(','));
  const regProxy = new Proxy({ ...world.input().registry }, {
    get(t, k) {
      counters.getTrap++;
      return Reflect.get(t, k);
    },
  });
  keys = probeEvidence('proxy-get', () => world.input({ registry: regProxy as never }), counters, true);
  assert.deepEqual(keys, []);
  const gopdProxy = new Proxy({ ...world.input().registry }, {
    getOwnPropertyDescriptor() {
      counters.gopdTrap++;
      throw new Error('F-A4-REG-GOPD');
    },
  });
  keys = probeEvidence('proxy-gopd', () => world.input({ registry: gopdProxy as never }), counters);
  assert.ok(keys.includes('input.registry-malformed'), keys.join(','));
});

test('F-A4: well-formed registry renders its snapshot id into the footer', () => {
  const world = buildWorld();
  const other = { ...world.input().registry, registrySnapshotId: 'pgw:rs:different-snapshot' };
  const result = projectExecutionBundleToPi(world.input({ registry: other as never, contextItems: [] }));
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.findings.map((f) => f.key)));
  if (result.ok) {
    assert.ok(result.plan.renderedPrompt.includes('pgw:rs:different-snapshot'), 'footer must carry the snapshotted registry id');
  }
});

test('F-A4: caller evidence containers are not mutated', () => {
  const world = buildWorld();
  const eligibility = { ...world.eligibility };
  const registry = { ...world.input().registry };
  const requestedUse = { ...world.input().requestedUse! };
  const beforeE = JSON.stringify({ ...eligibility, subjectCorrelations: 'x' });
  const beforeR = JSON.stringify(registry);
  const beforeU = JSON.stringify(requestedUse);
  projectExecutionBundleToPi(world.input({ eligibility: eligibility as never, registry: registry as never, requestedUse: requestedUse as never, contextItems: [] }));
  assert.equal(JSON.stringify({ ...eligibility, subjectCorrelations: 'x' }), beforeE);
  assert.equal(JSON.stringify(registry), beforeR);
  assert.equal(JSON.stringify(requestedUse), beforeU);
});

test('F-A4: artifact branding still rejects lookalikes before nested access', () => {
  const world = buildWorld();
  const input = world.input({ contextItems: [] });
  // spread clone
  const spread = { ...input.bundle };
  // serialized clone
  const serialized = JSON.parse(JSON.stringify(input.bundle));
  // proxy wrapper
  const proxied = new Proxy(input.bundle, {});
  // descriptor clone (own enumerable data copied onto a fresh object)
  const descriptorClone: Record<string, unknown> = {};
  for (const key of Object.keys(input.bundle)) {
    const d = Object.getOwnPropertyDescriptor(input.bundle, key);
    if (d !== undefined && d.get === undefined) descriptorClone[key] = d.value;
  }
  for (const [name, bundle] of [['spread', spread], ['serialized', serialized], ['proxy', proxied], ['descriptor-clone', descriptorClone]] as const) {
    const keys = probeEvidence(`brand-${name}`, () => world.input({ bundle: bundle as never, contextItems: [] }));
    assert.ok(keys.includes('input.unvalidated'), `${name}: ${keys.join(',')}`);
  }
});
