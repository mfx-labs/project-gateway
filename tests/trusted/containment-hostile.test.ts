/**
 * WP-6 Phase 2A: hostile runtime input hardening (test category F).
 *
 * The untrusted request is captured through the committed descriptor-derived
 * snapshot: ordinary getters and Proxy `get` traps are never used for
 * protocol values; missing/non-enumerable/accessor descriptors, symbols,
 * cycles, and unsupported prototypes fail closed; caller mutation after
 * capture cannot change the decision or identity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExistingPathContainment } from '../../src/trusted/index.js';
import { requestFor, validatedConfig, validContainmentOptions, identityResolver } from './containment-helpers.js';

test('F: ordinary getters are never invoked and fail closed (TCP-019)', () => {
  let invoked = 0;
  const config = validatedConfig();
  const request = requestFor(config, { path: 'docs/notes.md' });
  Object.defineProperty(request, 'path', {
    enumerable: true,
    get() {
      invoked++;
      return 'docs/notes.md';
    },
  });
  const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-019');
  assert.equal(invoked, 0);
});

test('F: throwing getters fail closed without being invoked', () => {
  let invoked = 0;
  const config = validatedConfig();
  const request = requestFor(config, { path: 'docs/notes.md' });
  Object.defineProperty(request, 'workspaceId', {
    enumerable: true,
    get() {
      invoked++;
      throw new Error('must not be invoked');
    },
  });
  const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-019');
  assert.equal(invoked, 0);
});

test('F: Proxy get traps are not used for protocol-significant reads', () => {
  let getCalls = 0;
  const config = validatedConfig();
  const target = requestFor(config, { path: 'docs/notes.md' });
  const proxy = new Proxy(target, {
    get(t, p) {
      getCalls++;
      if (p === 'path') throw new Error('get trap must not fire for protocol values');
      return Reflect.get(t, p);
    },
  });
  const report = evaluateExistingPathContainment(proxy, validContainmentOptions(config));
  assert.equal(report.ok, true);
  assert.equal(getCalls, 0);
  assert.equal(report.decision!.canonicalWorkspaceRelativePath, 'docs/notes.md');
});

test('F: listed key with missing descriptor fails closed (TCP-019)', () => {
  const config = validatedConfig();
  const target = requestFor(config, { path: 'docs/notes.md' });
  const proxy = new Proxy(target, {
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, p) {
      if (p === 'path') return undefined;
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
  const report = evaluateExistingPathContainment(proxy, validContainmentOptions(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-019');
});

test('F: listed non-enumerable field fails closed (TCP-019)', () => {
  const config = validatedConfig();
  const request = requestFor(config, { path: 'docs/notes.md' });
  Object.defineProperty(request, 'path', { value: 'docs/notes.md', enumerable: false });
  const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-019');
});

test('F: accessor fields fail closed without invocation (TCP-019)', () => {
  let invoked = 0;
  const config = validatedConfig();
  const request = requestFor(config, { path: 'docs/notes.md' });
  Object.defineProperty(request, 'purpose', {
    enumerable: true,
    get() {
      invoked++;
      return 'read';
    },
  });
  const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-019');
  assert.equal(invoked, 0);
});

test('F: symbol keys fail closed (TCP-019)', () => {
  const config = validatedConfig();
  const request = requestFor(config, { path: 'docs/notes.md' });
  (request as Record<symbol, unknown>)[Symbol('path')] = 'attacker.md';
  const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-019');
});

test('F: cyclic request values fail closed (TCP-019)', () => {
  const config = validatedConfig();
  const request = requestFor(config, { path: 'docs/notes.md' });
  (request as Record<string, unknown>)['self'] = request;
  const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-019');
});

test('F: unsupported prototypes fail closed (TCP-019)', () => {
  const config = validatedConfig();
  for (const value of [new Date(), new Map(), new (class Foo {})()]) {
    const request = requestFor(config);
    (request as Record<string, unknown>)['path'] = value;
    const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
    assert.equal(report.ok, false);
    assert.equal(report.findings[0]!.code, 'TCP-019');
  }
});

test('F: mutation during snapshot (stateful structural Proxy) stays fail-closed or frozen', () => {
  const config = validatedConfig();
  const target = requestFor(config, { path: 'docs/notes.md' });
  const proxy = new Proxy(target, {
    getOwnPropertyDescriptor(t, p) {
      const desc = Reflect.getOwnPropertyDescriptor(t, p);
      if (p === 'path' && desc) {
        (t as Record<string, unknown>)['purpose'] = 'delete'; // race with introspection
      }
      return desc;
    },
  });
  const report = evaluateExistingPathContainment(proxy, validContainmentOptions(config));
  // Either the mutation landed before capture (purpose deleted -> TCP-004) or
  // after capture (frozen valid decision); safety holds in both outcomes.
  if (report.ok) {
    assert.equal(Object.isFrozen(report.decision!), true);
    assert.match(report.decision!.decisionIdentity, /^sha-256:[0-9a-f]{64}$/);
    assert.equal(report.decision!.purpose, 'read');
  } else {
    assert.equal(report.findings.length > 0, true);
    assert.equal(report.decision, undefined);
  }
});

test('F: mutation after snapshot cannot change the decision or identity', () => {
  const config = validatedConfig();
  const request = requestFor(config, { path: 'docs/notes.md' });
  const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
  assert.equal(report.ok, true);
  const identity = report.decision!.decisionIdentity;
  (request as Record<string, unknown>)['path'] = 'attacker.md';
  (request as Record<string, unknown>)['purpose'] = 'delete';
  (request as Record<string, unknown>)['workspaceId'] = 'pgw:w:bbbbbbbbbbbbbbbb';
  assert.equal(report.decision!.canonicalWorkspaceRelativePath, 'docs/notes.md');
  assert.equal(report.decision!.purpose, 'read');
  assert.equal(report.decision!.workspaceId, 'pgw:w:aaaaaaaaaaaaaaaa');
  assert.equal(report.decision!.decisionIdentity, identity);
});

test('F: deeply frozen decision and findings', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.findings), true);
  assert.equal(Object.isFrozen(report.decision!), true);
  // Failure reports are frozen too.
  const bad = evaluateExistingPathContainment(requestFor(config, { path: '/etc/passwd' }), validContainmentOptions(config));
  assert.equal(bad.ok, false);
  assert.equal(Object.isFrozen(bad), true);
  assert.equal(Object.isFrozen(bad.findings), true);
  for (const f of bad.findings) assert.equal(Object.isFrozen(f), true);
});

test('F: strict unknown-field rejection applies to the request (TCP-003)', () => {
  const config = validatedConfig();
  for (const extra of ['unknownField', 'path2', 'operation', 'exists', 'existsFlag', 'resolutionMode']) {
    const request = requestFor(config, { [extra]: 'x' });
    const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
    assert.equal(report.ok, false, extra);
    assert.equal(report.findings[0]!.code, 'TCP-003', extra);
    assert.equal(report.findings[0]!.messageKey, 'containment.unknown-field', extra);
  }
});

test('F: non-object request input fails closed (TCP-002)', () => {
  const config = validatedConfig();
  for (const input of [null, 42, 'x', [], true]) {
    const report = evaluateExistingPathContainment(input, validContainmentOptions(config));
    assert.equal(report.ok, false, String(input));
    assert.equal(report.findings[0]!.code, 'TCP-002', String(input));
  }
});

test('F: hostile input cannot produce a decision identity', () => {
  const config = validatedConfig();
  const hostile = requestFor(config, { path: 'docs/notes.md' });
  Object.defineProperty(hostile, 'path', { enumerable: true, get: () => 'docs/notes.md' });
  const report = evaluateExistingPathContainment(hostile, validContainmentOptions(config));
  assert.equal(report.ok, false);
  assert.equal(report.decision, undefined);
  assert.equal('decisionIdentity' in (report as unknown as Record<string, unknown>), false);
});

test('F: identity resolver is required and never bypassed by request data', () => {
  const config = validatedConfig();
  // A request field claiming existence/resolution evidence is rejected as
  // unknown before resolution (TCP-003): existence evidence is resolver-only.
  const request = requestFor(config, { exists: true, resolvedPath: '/srv/gateway/alpha/x' });
  const report = evaluateExistingPathContainment(request, validContainmentOptions(config, identityResolver()));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-003');
});
