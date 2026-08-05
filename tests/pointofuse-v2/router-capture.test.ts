/**
 * WP-6 Phase 3A: router-shell exact-shape capture tests (contract Sections 3,
 * 6, 10, 11). The shell carries only the route version, the legacy
 * declaration, and the nested input reference; nested data is captured
 * separately. Capture must be exact-own with zero getter invocation and zero
 * Proxy `get`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureRouterRequest } from '../../src/pointofuse/index.js';
import { countingGetProxy } from './helpers.js';

const v1Shell = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  routeProtocolVersion: '1',
  legacyCompatibilityMode: 'explicit-legacy-test',
  inputs: { workspaceId: 'ws-a' },
  ...overrides,
});

const v2Shell = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  routeProtocolVersion: '2',
  inputs: { pointOfUseInputsProtocolVersion: '2', workspaceId: 'ws-a' },
  ...overrides,
});

test('A: valid v1 shell captured with exact literals', () => {
  const r = captureRouterRequest(v1Shell());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.shell.variant, 'v1');
  assert.equal(r.shell.routeProtocolVersion, '1');
  assert.equal(r.shell.legacyCompatibilityMode, 'explicit-legacy-test');
  assert.deepEqual(r.shell.inputs, { workspaceId: 'ws-a' });
});

test('A: valid v2 shell captured with exact literal', () => {
  const r = captureRouterRequest(v2Shell());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.shell.variant, 'v2');
  assert.equal(r.shell.routeProtocolVersion, '2');
  assert.deepEqual(r.shell.inputs, { pointOfUseInputsProtocolVersion: '2', workspaceId: 'ws-a' });
});

test('A: v1 shell missing legacy declaration fails closed (deterministic: route-tag)', () => {
  // A two-key shell { routeProtocolVersion, inputs } is the v2 shape; with
  // routeProtocolVersion "1" it is a malformed v1 (missing declaration) and
  // fails deterministically as route-tag.
  const shell = v1Shell();
  delete shell['legacyCompatibilityMode'];
  const r = captureRouterRequest(shell);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, 'route-tag');
});

test('A: v2 shell carrying legacyCompatibilityMode fails closed (deterministic: route-tag)', () => {
  // A three-key shell is the v1 shape; with routeProtocolVersion "2" the
  // outer version check fails deterministically as route-tag.
  const r = captureRouterRequest(v2Shell({ legacyCompatibilityMode: 'explicit-legacy-test' }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, 'route-tag');
});

test('A: unknown shell field rejected', () => {
  for (const shell of [v1Shell({ extra: 1 }), v2Shell({ extra: 1 })]) {
    const r = captureRouterRequest(shell);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'shell-structural');
  }
});

test('A: missing routeProtocolVersion rejected', () => {
  const shell = v2Shell();
  delete shell['routeProtocolVersion'];
  const r = captureRouterRequest(shell);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'shell-structural');
});

test('A: symbol field rejected', () => {
  const shell = v2Shell();
  (shell as Record<symbol, unknown>)[Symbol('x')] = 1;
  const r = captureRouterRequest(shell);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'shell-structural');
});

test('A: inherited shell fields rejected', () => {
  const proto = v2Shell();
  const shell = Object.create(proto);
  const r = captureRouterRequest(shell);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'shell-structural');
});

test('A: accessor shell field rejected without invocation', () => {
  let invoked = 0;
  const shell = v2Shell();
  Object.defineProperty(shell, 'routeProtocolVersion', {
    enumerable: true,
    get() {
      invoked++;
      return '2';
    },
  });
  const r = captureRouterRequest(shell);
  assert.equal(r.ok, false);
  assert.equal(invoked, 0);
  if (!r.ok) assert.equal(r.code, 'shell-structural');
});

test('A: non-enumerable shell field rejected', () => {
  const shell = v2Shell();
  Object.defineProperty(shell, 'inputs', { value: {}, enumerable: false });
  const r = captureRouterRequest(shell);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'shell-structural');
});

test('A: Proxy get counter remains zero during shell capture', () => {
  const { proxy, getCalls } = countingGetProxy(v2Shell());
  const r = captureRouterRequest(proxy);
  assert.equal(r.ok, true);
  assert.equal(getCalls(), 0);
});

test('A: throwing getter never invoked', () => {
  const shell = v2Shell();
  Object.defineProperty(shell, 'inputs', {
    enumerable: true,
    get() {
      throw new Error('must not fire');
    },
  });
  const r = captureRouterRequest(shell);
  assert.equal(r.ok, false);
});

test('A: descriptor trap fails closed', () => {
  const shell = new Proxy(v2Shell(), {
    getOwnPropertyDescriptor() {
      throw new Error('gopd');
    },
  });
  const r = captureRouterRequest(shell);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'shell-structural');
});

test('A: ownKeys trap fails closed', () => {
  const shell = new Proxy(v2Shell(), {
    ownKeys() {
      throw new Error('ownKeys');
    },
  });
  const r = captureRouterRequest(shell);
  assert.equal(r.ok, false);
});

test('A: revoked Proxy fails closed', () => {
  const revoked = Proxy.revocable(v2Shell(), {});
  revoked.revoke();
  const r = captureRouterRequest(revoked.proxy);
  assert.equal(r.ok, false);
});

test('A: non-object shell rejected', () => {
  for (const value of ['x', 42, null, ['a']]) {
    const r = captureRouterRequest(value);
    assert.equal(r.ok, false);
  }
});

test('A: outer route-version failure (route-tag) precedes legacy-declaration failure', () => {
  const r = captureRouterRequest({ routeProtocolVersion: '9', legacyCompatibilityMode: 'bogus', inputs: {} });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'route-tag');
});

test('A: wrong legacy literal is legacy-declaration', () => {
  const r = captureRouterRequest(v1Shell({ legacyCompatibilityMode: 'production' }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'legacy-declaration');
});

test('A: outer version number 2 rejected as route-tag', () => {
  const r = captureRouterRequest({ routeProtocolVersion: 2, inputs: {} });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'route-tag');
});
