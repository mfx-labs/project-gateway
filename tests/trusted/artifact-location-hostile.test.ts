/**
 * WP-6 Phase 2B-P: hostile version-2 input (test category F).
 *
 * The committed descriptor-derived snapshot and strict version-specific
 * shape validation apply to version-2 input: no getters, zero Proxy `get`
 * for protocol values, missing/non-enumerable/accessor descriptors,
 * symbols, cycles, unsupported prototypes, caller-supplied existence or
 * entry-kind flags, and caller-supplied artifact-kind lists all fail closed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrustedWorkspaceConfiguration } from '../../src/trusted/index.js';
import { v2Config, v2Options, validatedV2Config } from './artifact-location-helpers.js';

const configured = (): Record<string, unknown> => v2Config({
  workspaces: [
    { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
  ],
});

test('F: ordinary getters are never invoked and fail closed', () => {
  let invoked = 0;
  const input = configured();
  Object.defineProperty(input['workspaces'] as Record<string, unknown>[], '0', {
    enumerable: true,
    get() {
      invoked++;
      return { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' };
    },
  });
  const report = validateTrustedWorkspaceConfiguration(input, v2Options());
  assert.equal(report.ok, false);
  assert.equal(invoked, 0);
});

test('F: throwing getters fail closed without being invoked', () => {
  let invoked = 0;
  const input = configured();
  Object.defineProperty(input, 'configurationVersion', {
    enumerable: true,
    get() {
      invoked++;
      throw new Error('must not be invoked');
    },
  });
  const report = validateTrustedWorkspaceConfiguration(input, v2Options());
  assert.equal(report.ok, false);
  assert.equal(invoked, 0);
});

test('F: Proxy get traps are not used for protocol-significant reads', () => {
  let getCalls = 0;
  const target = configured();
  const proxy = new Proxy(target, {
    get(t, p) {
      getCalls++;
      if (p === 'workspaces') throw new Error('get trap must not fire');
      return Reflect.get(t, p);
    },
  });
  const report = validateTrustedWorkspaceConfiguration(proxy, v2Options());
  assert.equal(report.ok, true);
  assert.equal(getCalls, 0);
});

test('F: listed key with missing descriptor fails closed (TCF-017)', () => {
  const target = configured();
  const proxy = new Proxy(target, {
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, p) {
      if (p === 'configurationVersion') return undefined;
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
  const report = validateTrustedWorkspaceConfiguration(proxy, v2Options());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-017');
});

test('F: non-enumerable artifactLocation fails closed (TCF-017)', () => {
  const input = configured();
  const ws = (input['workspaces'] as Record<string, unknown>[])[0]!;
  Object.defineProperty(ws, 'artifactLocation', { value: '/srv/gateway/alpha/artifacts', enumerable: false });
  const report = validateTrustedWorkspaceConfiguration(input, v2Options());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-017');
});

test('F: accessor artifactLocation fails closed without invocation', () => {
  let invoked = 0;
  const input = configured();
  const ws = (input['workspaces'] as Record<string, unknown>[])[0]!;
  Object.defineProperty(ws, 'artifactLocation', {
    enumerable: true,
    get() {
      invoked++;
      return '/srv/gateway/alpha/artifacts';
    },
  });
  const report = validateTrustedWorkspaceConfiguration(input, v2Options());
  assert.equal(report.ok, false);
  assert.equal(invoked, 0);
});

test('F: symbol keys fail closed', () => {
  const input = configured();
  (input as Record<symbol, unknown>)[Symbol('artifactLocation')] = '/attacker';
  const report = validateTrustedWorkspaceConfiguration(input, v2Options());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-016');
});

test('F: cycles fail closed', () => {
  const input = configured();
  (input as Record<string, unknown>)['self'] = input;
  const report = validateTrustedWorkspaceConfiguration(input, v2Options());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-016');
});

test('F: unsupported prototypes fail closed', () => {
  for (const value of [new Date(), new Map(), new (class Foo {})()]) {
    const input = configured();
    (input as Record<string, unknown>)['workspaces'] = value;
    const report = validateTrustedWorkspaceConfiguration(input, v2Options());
    assert.equal(report.ok, false);
    assert.equal(report.findings[0]!.code, 'TCF-016');
  }
});

test('F: mutation during snapshot (stateful structural Proxy) stays fail-closed or frozen', () => {
  const target = configured();
  const proxy = new Proxy(target, {
    getOwnPropertyDescriptor(t, p) {
      const desc = Reflect.getOwnPropertyDescriptor(t, p);
      if (p === 'workspaces' && desc) {
        (t as Record<string, unknown>)['globalActionCeiling'] = 7;
      }
      return desc;
    },
  });
  const report = validateTrustedWorkspaceConfiguration(proxy, v2Options());
  if (report.ok) {
    assert.equal(Object.isFrozen(report.configuration!), true);
    assert.match(report.configuration!.identity, /^sha-256:[0-9a-f]{64}$/);
  } else {
    assert.equal(report.configuration, undefined);
  }
});

test('F: mutation after snapshot cannot change the validated output or identity', () => {
  const input = configured();
  const report = validateTrustedWorkspaceConfiguration(input, v2Options());
  assert.equal(report.ok, true);
  const identity = report.configuration!.identity;
  const ws = (input['workspaces'] as Record<string, unknown>[])[0]!;
  ws['artifactLocation'] = '/attacker/root';
  (input as Record<string, unknown>)['configurationVersion'] = '9';
  assert.equal(report.configuration!.workspaces[0]!.artifactLocation, '/srv/gateway/alpha/artifacts');
  assert.equal(report.configuration!.identity, identity);
});

test('F: unknown version-2 workspace field fails closed (TCF-025)', () => {
  for (const extra of ['artifactKinds', 'kind', 'writeMode', 'overwritePolicy', 'filenameTemplate', 'sourceTree', 'persist']) {
    const ws = { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts', [extra]: 'x' };
    const report = validateTrustedWorkspaceConfiguration(v2Config({ workspaces: [ws] }), v2Options());
    assert.equal(report.ok, false, extra);
    assert.equal(report.findings[0]!.code, 'TCF-025', extra);
  }
});

test('F: caller-supplied existence flag rejected as unknown field', () => {
  const ws = { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts', exists: true };
  const report = validateTrustedWorkspaceConfiguration(v2Config({ workspaces: [ws] }), v2Options());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-025');
});

test('F: caller-supplied entry-kind flag rejected as unknown field', () => {
  const ws = { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts', isDirectory: true };
  const report = validateTrustedWorkspaceConfiguration(v2Config({ workspaces: [ws] }), v2Options());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-025');
});

test('F: caller-supplied artifact-kind list rejected as unknown field', () => {
  const input = configured();
  (input as Record<string, unknown>)['artifactKinds'] = ['TaskSpec', 'ExecutionBundle'];
  const report = validateTrustedWorkspaceConfiguration(input, v2Options());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-025');
});

test('F: deeply frozen v2 validated output', () => {
  const config = validatedV2Config(configured());
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.workspaces), true);
  assert.equal(Object.isFrozen(config.workspaces[0]), true);
});
