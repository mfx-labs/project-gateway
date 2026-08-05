/**
 * WP-6 Phase 2B-P security correction F-2BP-FR-01: resolver-evidence
 * descriptor capture.
 *
 * ArtifactLocationResolver return values are STRICT tagged protocol
 * evidence: they are descriptor-captured exactly once (no getters, zero
 * Proxy `get`, no inherited fields, no accessors, no mixed evidence),
 * validated against exact variant shapes, and malformed evidence fails
 * closed as a typed configuration finding — never as an escaping exception.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTrustedWorkspaceConfiguration,
  lookupValidatedArtifactLocation,
  TRUSTED_HOST_LANE,
  type ArtifactLocationResolver,
} from '../../src/trusted/index.js';
import { isGenuineValidatedTrustedWorkspaceConfiguration } from '../../src/trusted/configuration-brand.js';
import { v2Config, v2Options } from './artifact-location-helpers.js';

const LANE = TRUSTED_HOST_LANE;

const configured = (workspaceId = 'pgw:w:aaaaaaaaaaaaaaaa'): Record<string, unknown> => v2Config({
  workspaces: [
    { workspaceId, root: workspaceId === 'pgw:w:aaaaaaaaaaaaaaaa' ? '/srv/gateway/alpha' : '/srv/gateway/beta', artifactLocation: '/srv/gateway/alpha/artifacts' },
  ],
});

const run = (evidence: unknown, resolver?: ArtifactLocationResolver): ReturnType<typeof validateTrustedWorkspaceConfiguration> | { threw: string } => {
  try {
    return validateTrustedWorkspaceConfiguration(configured(), v2Options(resolver ?? (() => evidence as never)));
  } catch (err) {
    return { threw: err instanceof Error ? err.message : String(err) };
  }
};

const malformedOk = (r: ReturnType<typeof validateTrustedWorkspaceConfiguration> | { threw: string }): boolean => {
  if ('threw' in r) return false;
  return r.ok === false && r.findings[0]!.code === 'TCF-034' && r.configuration === undefined;
};

test('FR01: normal genuine success evidence is accepted', () => {
  const r = run({ ok: true, canonicalPath: '/srv/gateway/alpha/artifacts', entryKind: 'directory' });
  assert.equal('threw' in r, false);
  if ('threw' in r) return;
  assert.equal(r.ok, true);
  assert.equal(r.configuration!.workspaces[0]!.artifactLocation, '/srv/gateway/alpha/artifacts');
});

test('FR01: normal tagged failure evidence fails with the intended code', () => {
  for (const [code, expected] of [
    ['not-found', 'TCF-035'],
    ['loop', 'TCF-037'],
    ['inaccessible', 'TCF-033'],
    ['ambiguous', 'TCF-041'],
    ['unsupported-entry-kind', 'TCF-036'],
    ['error', 'TCF-033'],
  ] as const) {
    const r = run({ ok: false, code });
    assert.equal('threw' in r, false, code);
    if ('threw' in r) continue;
    assert.equal(r.ok, false, code);
    assert.equal(r.findings[0]!.code, expected, code);
  }
});

test('FR01: getter discriminator/status is not invoked', () => {
  let calls = 0;
  const evidence = {
    get ok() {
      calls++;
      return true;
    },
    canonicalPath: '/srv/gateway/alpha/artifacts',
    entryKind: 'directory',
  };
  const r = run(evidence);
  assert.equal('threw' in r, false);
  assert.equal(calls, 0);
  assert.equal(malformedOk(r), true);
});

test('FR01: throwing getter does not escape (typed TCF-034)', () => {
  const evidence = {
    get ok() {
      throw new Error('boom');
    },
    canonicalPath: '/srv/gateway/alpha/artifacts',
    entryKind: 'directory',
  };
  const r = run(evidence);
  assert.equal('threw' in r, false);
  if ('threw' in r) return;
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TCF-034');
  assert.equal(r.configuration, undefined);
});

test('FR01: Proxy get trap count remains zero', () => {
  let getCount = 0;
  const target = { ok: true, canonicalPath: '/srv/gateway/alpha/artifacts', entryKind: 'directory' };
  const proxy = new Proxy(target, {
    get(t, p) {
      getCount++;
      throw new Error(`get fired: ${String(p)}`);
    },
  });
  const r = run(proxy);
  assert.equal('threw' in r, false);
  if ('threw' in r) return;
  assert.equal(r.ok, true);
  assert.equal(getCount, 0);
});

test('FR01: accessor canonicalPath is not invoked', () => {
  let calls = 0;
  const evidence = {
    ok: true,
    get canonicalPath() {
      calls++;
      return '/srv/gateway/alpha/artifacts';
    },
    entryKind: 'directory',
  };
  const r = run(evidence);
  assert.equal('threw' in r, false);
  assert.equal(calls, 0);
  assert.equal(malformedOk(r), true);
});

test('FR01: accessor entryKind is not invoked', () => {
  let calls = 0;
  const evidence = {
    ok: true,
    canonicalPath: '/srv/gateway/alpha/artifacts',
    get entryKind() {
      calls++;
      return 'directory';
    },
  };
  const r = run(evidence);
  assert.equal('threw' in r, false);
  assert.equal(calls, 0);
  assert.equal(malformedOk(r), true);
});

test('FR01: prototype-inherited discriminator/status is rejected', () => {
  const proto = { ok: true, canonicalPath: '/srv/gateway/alpha/artifacts', entryKind: 'directory' };
  const evidence = Object.create(proto);
  const r = run(evidence);
  assert.equal('threw' in r, false);
  assert.equal(malformedOk(r), true);
});

test('FR01: prototype-inherited canonical path is rejected', () => {
  const proto = { canonicalPath: '/srv/gateway/alpha/artifacts' };
  const evidence = Object.assign(Object.create(proto), { ok: true, entryKind: 'directory' });
  const r = run(evidence);
  assert.equal('threw' in r, false);
  assert.equal(malformedOk(r), true);
});

test('FR01: prototype-inherited entry kind is rejected', () => {
  const proto = { entryKind: 'directory' };
  const evidence = Object.assign(Object.create(proto), { ok: true, canonicalPath: '/srv/gateway/alpha/artifacts' });
  const r = run(evidence);
  assert.equal('threw' in r, false);
  assert.equal(malformedOk(r), true);
});

test('FR01: non-enumerable required fields are rejected', () => {
  const evidence: Record<string, unknown> = { ok: true, canonicalPath: '/srv/gateway/alpha/artifacts' };
  Object.defineProperty(evidence, 'entryKind', { value: 'directory', enumerable: false });
  const r = run(evidence);
  assert.equal('threw' in r, false);
  assert.equal(malformedOk(r), true);
});

test('FR01: symbol-bearing evidence is rejected', () => {
  const evidence: Record<string, unknown> = { ok: true, canonicalPath: '/srv/gateway/alpha/artifacts', entryKind: 'directory' };
  Object.defineProperty(evidence, Symbol('x'), { value: 1, enumerable: true });
  const r = run(evidence);
  assert.equal('threw' in r, false);
  assert.equal(malformedOk(r), true);
});

test('FR01: unsupported prototype is rejected', () => {
  for (const evidence of [new Date(), new Map(), new (class Foo {})()]) {
    const r = run(evidence);
    assert.equal('threw' in r, false);
    assert.equal(malformedOk(r), true);
  }
});

test('FR01: unknown fields are rejected', () => {
  for (const evidence of [
    { ok: true, canonicalPath: '/srv/gateway/alpha/artifacts', entryKind: 'directory', extra: 1 },
    { ok: false, code: 'not-found', extra: 1 },
    { ok: true, canonicalPath: '/srv/gateway/alpha/artifacts', entryKind: 'directory', isDirectory: true },
    { ok: false, code: 'not-found', exists: true },
  ]) {
    const r = run(evidence);
    assert.equal('threw' in r, false);
    assert.equal(malformedOk(r), true, JSON.stringify(evidence));
  }
});

test('FR01: missing descriptors are rejected', () => {
  const target = { ok: true, canonicalPath: '/srv/gateway/alpha/artifacts', entryKind: 'directory' };
  const proxy = new Proxy(target, {
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, p) {
      if (p === 'entryKind') return undefined;
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
  const r = run(proxy);
  assert.equal('threw' in r, false);
  assert.equal(malformedOk(r), true);
});

test('FR01: mutation between potential reads cannot produce mixed evidence', () => {
  // A stateful getOwnPropertyDescriptor proxy that would report different
  // values on repeated reads: the evidence is captured once, so the result
  // is either the observed consistent pass (fail closed on accessor) or a
  // typed failure — never a mixed canonical path.
  let mode = false;
  const target = { ok: true, canonicalPath: '/srv/gateway/alpha/inside', entryKind: 'directory' };
  const proxy = new Proxy(target, {
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, p) {
      const desc = Reflect.getOwnPropertyDescriptor(t, p);
      if (p === 'canonicalPath' && desc && mode) {
        return { value: '/srv/outside/x', writable: true, enumerable: true, configurable: true };
      }
      return desc;
    },
  });
  const first = run(proxy);
  mode = true;
  const second = run(proxy);
  for (const r of [first, second]) {
    assert.equal('threw' in r, false);
    if ('threw' in r) continue;
    if (r.ok) {
      assert.equal(r.configuration!.workspaces[0]!.artifactLocation, '/srv/gateway/alpha/inside');
    } else {
      assert.equal(r.configuration, undefined);
    }
  }
});

test('FR01: throwing descriptor or Proxy traps fail closed without an escaping exception', () => {
  const throwingGopd = new Proxy({ ok: true, canonicalPath: '/x', entryKind: 'directory' }, {
    getOwnPropertyDescriptor() {
      throw new Error('gopd boom');
    },
  });
  const r1 = run(throwingGopd);
  assert.equal('threw' in r1, false);
  assert.equal(malformedOk(r1), true);

  const throwingOwnKeys = new Proxy({ ok: true, canonicalPath: '/x', entryKind: 'directory' }, {
    ownKeys() {
      throw new Error('ownKeys boom');
    },
  });
  const r2 = run(throwingOwnKeys);
  assert.equal('threw' in r2, false);
  assert.equal(malformedOk(r2), true);

  const revoked = Proxy.revocable({ ok: true, canonicalPath: '/x', entryKind: 'directory' }, {});
  revoked.revoke();
  const r3 = run(revoked.proxy);
  assert.equal('threw' in r3, false);
  assert.equal(malformedOk(r3), true);
});

test('FR01: every malformed evidence case yields no configuration, identity, brand, or lookup', () => {
  const cases: unknown[] = [
    { get ok() { return true; }, canonicalPath: '/srv/gateway/alpha/artifacts', entryKind: 'directory' },
    { ok: true, get canonicalPath() { return '/srv/gateway/alpha/artifacts'; }, entryKind: 'directory' },
    Object.assign(Object.create({ ok: true }), { canonicalPath: '/x', entryKind: 'directory' }),
    { ok: true, canonicalPath: '/srv/gateway/alpha/artifacts', entryKind: 'directory', extra: 1 },
    { ok: true, canonicalPath: 42, entryKind: 'directory' },
    { ok: true, canonicalPath: '/srv/gateway/alpha/artifacts', entryKind: 'file' },
    { ok: 'yes', canonicalPath: '/x', entryKind: 'directory' },
    { ok: false, code: 'not-found', extra: 1 },
    { ok: false, code: 'unknown-status' },
    { ok: true },
    { ok: false },
    null,
    'string',
    42,
    [],
  ];
  for (const evidence of cases) {
    const r = run(evidence);
    assert.equal('threw' in r, false, JSON.stringify(evidence));
    if ('threw' in r) continue;
    assert.equal(r.ok, false, JSON.stringify(evidence));
    assert.equal(r.configuration, undefined, JSON.stringify(evidence));
    assert.equal(r.findings.length >= 1, true);
  }
});

test('FR01: resolver invocation count remains exactly one', () => {
  let calls = 0;
  const resolver: ArtifactLocationResolver = (p) => {
    calls++;
    return { ok: true, canonicalPath: p, entryKind: 'directory' };
  };
  const r = validateTrustedWorkspaceConfiguration(configured(), v2Options(resolver));
  assert.equal(r.ok, true);
  assert.equal(calls, 1);
});

test('FR01: hostile evidence does not add resolver invocations', () => {
  let calls = 0;
  const resolver: ArtifactLocationResolver = () => {
    calls++;
    return { get ok() { return true; }, canonicalPath: '/x', entryKind: 'directory' } as never;
  };
  const r = validateTrustedWorkspaceConfiguration(configured(), v2Options(resolver));
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TCF-034');
  assert.equal(calls, 1);
});

test('FR01: resolver invocation that throws retains the resolver-failure mapping (TCF-033)', () => {
  const resolver: ArtifactLocationResolver = () => {
    throw new Error('resolver boom');
  };
  const r = validateTrustedWorkspaceConfiguration(configured(), v2Options(resolver));
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TCF-033');
  assert.equal(r.configuration, undefined);
});

test('FR01: multi-workspace atomicity — one hostile evidence fails the entire load', () => {
  const input = v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
      { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta', artifactLocation: '/srv/gateway/beta/artifacts' },
    ],
  });
  let calls = 0;
  const resolver: ArtifactLocationResolver = (p) => {
    calls++;
    if (p === '/srv/gateway/alpha/artifacts') {
      return { ok: true, canonicalPath: p, entryKind: 'directory' };
    }
    // Hostile evidence for the second workspace.
    return { get ok() { return true; }, canonicalPath: p, entryKind: 'directory' } as never;
  };
  const r = validateTrustedWorkspaceConfiguration(input, v2Options(resolver));
  assert.equal(r.ok, false);
  assert.equal(r.findings[0]!.code, 'TCF-034');
  assert.equal(r.configuration, undefined);
  assert.equal(calls <= 2, true); // every configured location invoked at most once; no re-read
  // No identity, brand, or lookup escapes.
  assert.equal('identity' in (r as unknown as Record<string, unknown>), false);
  const { configuration } = r;
  assert.equal(configuration === undefined || !isGenuineValidatedTrustedWorkspaceConfiguration(configuration), true);
});

test('FR01: existing directory, failure-status, and root-relationship behavior remains unchanged', () => {
  const ok = validateTrustedWorkspaceConfiguration(configured(), v2Options((p) => ({ ok: true, canonicalPath: p, entryKind: 'directory' })));
  assert.equal(ok.ok, true);
  const notFound = validateTrustedWorkspaceConfiguration(configured(), v2Options(() => ({ ok: false, code: 'not-found' })));
  assert.equal(notFound.ok, false);
  assert.equal(notFound.findings[0]!.code, 'TCF-035');
  const outside = validateTrustedWorkspaceConfiguration(configured(), v2Options(() => ({ ok: true, canonicalPath: '/srv/outside/x', entryKind: 'directory' })));
  assert.equal(outside.ok, false);
  assert.equal(outside.findings[0]!.code, 'TCF-039');
  const root = validateTrustedWorkspaceConfiguration(configured(), v2Options(() => ({ ok: true, canonicalPath: '/', entryKind: 'directory' })));
  assert.equal(root.ok, false);
  assert.equal(root.findings[0]!.code, 'TCF-038');
  const equal = validateTrustedWorkspaceConfiguration(configured(), v2Options(() => ({ ok: true, canonicalPath: '/srv/gateway/alpha', entryKind: 'directory' })));
  assert.equal(equal.ok, false);
  assert.equal(equal.findings[0]!.code, 'TCF-040');
});
