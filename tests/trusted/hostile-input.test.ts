/**
 * WP-6 Phase 1: hostile runtime inputs (test category I).
 *
 * Descriptor-derived snapshot hardening (F-EL5): ordinary getters are never
 * invoked; Proxy `get` traps are not used for protocol-significant reads
 * (objects AND arrays — correction F-1); descriptor traps and unsupported
 * structures fail closed; validated state cannot change after validation;
 * outputs are deeply frozen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTrustedWorkspaceConfiguration,
  snapshotTrustedWorkspaceConfigurationInput,
  TrustedSnapshotError,
} from '../../src/trusted/index.js';
import { validConfig, validWorkspace, validOptions } from './helpers.js';

test('I: ordinary getters are never invoked', () => {
  let invoked = 0;
  const input = validConfig();
  Object.defineProperty(input, 'configurationVersion', {
    enumerable: true,
    get() {
      invoked++;
      return '1';
    },
  });
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, false); // accessor properties are rejected
  assert.equal(invoked, 0);
  assert.equal(report.findings[0]!.code, 'TCF-016');
});

test('I: throwing getters fail closed without being invoked', () => {
  const input = validConfig();
  Object.defineProperty(input, 'provenance', {
    enumerable: true,
    get() {
      throw new Error('must not be invoked');
    },
  });
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-016');
});

test('I: Proxy get traps are not used for significant reads', () => {
  let getCalls = 0;
  const target = validConfig();
  const proxy = new Proxy(target, {
    get(t, p) {
      getCalls++;
      if (p === 'configurationVersion') throw new Error('get trap must not fire for significant reads');
      return Reflect.get(t, p);
    },
  });
  const report = validateTrustedWorkspaceConfiguration(proxy, validOptions());
  assert.equal(report.ok, true); // values come from descriptors, not `get`
  assert.equal(getCalls, 0);
});

test('I: array Proxy get traps never fire for significant reads (correction F-1)', () => {
  // A Proxy-wrapped workspaces array must be captured descriptor-derively:
  // the `get` trap (including `length` and index reads) is never invoked.
  let getCalls = 0;
  const inner = [validWorkspace()];
  const arrProxy = new Proxy(inner, {
    get(t, p) {
      getCalls++;
      throw new Error(`get trap must not fire for array reads (${String(p)})`);
    },
  });
  const input = validConfig({ workspaces: arrProxy });
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(getCalls, 0);
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.workspaces[0]!.canonicalRoot, '/srv/gateway/alpha');
});

test('I: nested Proxy-wrapped arrays are captured descriptor-derively', () => {
  let getCalls = 0;
  const caps = new Proxy(['project-gateway.workspace-read'], {
    get(t, p) {
      getCalls++;
      throw new Error(`nested array get trap fired (${String(p)})`);
    },
  });
  const input = validConfig({
    globalCapabilityCeiling: { capabilities: caps },
    workspaces: [validWorkspace({ capabilities: caps })],
  });
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(getCalls, 0);
  assert.equal(report.ok, true);
  assert.deepEqual([...report.configuration!.workspaces[0]!.capabilities!], ['project-gateway.workspace-read']);
});

test('I: array accessor index descriptors fail closed (TCF-016)', () => {
  const inner = [validWorkspace()];
  let getCalls = 0;
  const arrProxy = new Proxy(inner, {
    get(t, p) {
      getCalls++;
      return Reflect.get(t, p);
    },
    getOwnPropertyDescriptor(t, p) {
      if (p === '0') return { enumerable: true, configurable: true, get: () => validWorkspace() };
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
  const report = validateTrustedWorkspaceConfiguration(validConfig({ workspaces: arrProxy }), validOptions());
  assert.equal(getCalls, 0);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-016');
});

test('I: sparse arrays are rejected deterministically (TCF-016)', () => {
  const sparse: unknown[] = [];
  sparse[0] = validWorkspace();
  sparse[2] = validWorkspace({ workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' }); // hole at index 1
  const report = validateTrustedWorkspaceConfiguration(validConfig({ workspaces: sparse }), validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-016');
});

test('I: descriptor traps that throw fail closed (TCF-017)', () => {
  const target = validConfig();
  const proxy = new Proxy(target, {
    getOwnPropertyDescriptor() {
      throw new Error('descriptor trap failure');
    },
  });
  const report = validateTrustedWorkspaceConfiguration(proxy, validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-017');
});

test('I: descriptor changes between introspection calls fail closed when they surface an accessor', () => {
  // Intentionally stateful structural Proxy: the first validation observes
  // plain data descriptors; the second validation (same proxy object) exposes
  // an accessor for a significant key. Determinism is scoped per the accepted
  // WP-5A rule (each validation is internally consistent), and safety fails
  // closed: an accessor surfaced on any introspection pass is rejected.
  let accessorMode = false;
  const target = validConfig();
  const proxy = new Proxy(target, {
    getOwnPropertyDescriptor(t, p) {
      const desc = Reflect.getOwnPropertyDescriptor(t, p);
      if (p === 'provenance' && desc && accessorMode) {
        return { enumerable: true, configurable: true, get: () => ({ sourceKind: 'trusted-local-control-plane' }) };
      }
      return desc;
    },
  });
  const first = validateTrustedWorkspaceConfiguration(proxy, validOptions());
  assert.equal(first.ok, true);
  accessorMode = true;
  const second = validateTrustedWorkspaceConfiguration(proxy, validOptions());
  assert.equal(second.ok, false); // accessor surfaced on the later pass
  assert.equal(second.findings[0]!.code, 'TCF-016');
});

test('I: cyclic values fail closed', () => {
  const input = validConfig();
  (input as Record<string, unknown>)['self'] = input;
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-016');
  assert.equal(report.findings[0]!.messageKey, 'trusted-config.snapshot-failed');
});

test('I: unsupported prototypes fail closed', () => {
  for (const value of [new Date(), new Map(), new (class Foo {})()]) {
    const input = validConfig();
    (input as Record<string, unknown>)['workspaces'] = value;
    const report = validateTrustedWorkspaceConfiguration(input, validOptions());
    assert.equal(report.ok, false);
    assert.equal(report.findings[0]!.code, 'TCF-016');
  }
});

test('I: non-finite numbers anywhere fail closed', () => {
  const input = validConfig();
  (input as Record<string, unknown>)['globalActionCeiling'] = Number.POSITIVE_INFINITY;
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-016'); // rejected at snapshot stage
});

test('I: mutation after validation cannot change validated state', () => {
  const caller = validConfig({
    globalCapabilityCeiling: { capabilities: ['project-gateway.workspace-read'] },
    workspaces: [validWorkspace({ capabilities: ['project-gateway.workspace-read'], actionCeiling: 3 })],
  });
  const report = validateTrustedWorkspaceConfiguration(caller, validOptions());
  assert.equal(report.ok, true);
  const config = report.configuration!;
  const identityBefore = config.identity;
  // Hostile mutation of the caller container after validation.
  const callerWs = caller['workspaces'] as { root: string; actionCeiling?: number }[];
  (caller as Record<string, unknown>)['configurationVersion'] = '9';
  callerWs[0]!.root = '/srv/attacker';
  callerWs[0]!.actionCeiling = 999999;
  (caller['globalCapabilityCeiling'] as Record<string, unknown>)['capabilities'] = ['project-gateway.shell-execute'];
  assert.equal(config.configurationVersion, '1');
  assert.equal(config.workspaces[0]!.canonicalRoot, '/srv/gateway/alpha');
  assert.equal(config.workspaces[0]!.actionCeiling, 3);
  assert.deepEqual([...config.globalCapabilityCeiling!.capabilities!], ['project-gateway.workspace-read']);
  assert.equal(config.identity, identityBefore);
});

test('I: mutation during validation (via trap) cannot change frozen validated state', () => {
  // A stateful proxy mutates the underlying target while introspection runs;
  // the captured snapshot is frozen and identity is computed from the captured
  // state only (determinism scoped per the accepted WP-5A rule).
  const target = validConfig();
  const proxy = new Proxy(target, {
    getOwnPropertyDescriptor(t, p) {
      const desc = Reflect.getOwnPropertyDescriptor(t, p);
      if (p === 'workspaces' && desc) {
        (t as Record<string, unknown>)['globalActionCeiling'] = 7;
      }
      return desc;
    },
  });
  const report = validateTrustedWorkspaceConfiguration(proxy, validOptions());
  // The mutation races introspection; either the captured globalActionCeiling
  // is absent (mutation occurred after capture) or present. Safety: the
  // validated object is frozen and identity deterministic for the captured
  // state. Both outcomes must yield a frozen, valid configuration when no
  // accessor surfaced.
  if (report.ok) {
    assert.equal(Object.isFrozen(report.configuration!), true);
    assert.match(report.configuration!.identity, /^sha-256:[0-9a-f]{64}$/);
  } else {
    assert.equal(report.findings.length > 0, true);
  }
});

test('I: nested mutable containers are captured deeply and frozen', () => {
  const caller = validConfig({
    workspaces: [
      validWorkspace({ capabilities: ['project-gateway.workspace-read'] }),
    ],
  });
  const report = validateTrustedWorkspaceConfiguration(caller, validOptions());
  assert.equal(report.ok, true);
  const caps = report.configuration!.workspaces[0]!.capabilities!;
  assert.equal(Object.isFrozen(caps), true);
  // Caller mutates its nested array afterwards.
  const callerWs = caller['workspaces'] as { capabilities?: unknown }[];
  callerWs[0]!['capabilities'] = ['project-gateway.shell-execute'];
  assert.deepEqual([...caps], ['project-gateway.workspace-read']);
});

test('I: structural introspection failure is a typed fail-closed finding', () => {
  // snapshotTrustedWorkspaceConfigurationInput surfaces typed errors.
  const target = validConfig();
  Object.defineProperty(target, 'workspaces', { enumerable: true, get: () => [] });
  try {
    snapshotTrustedWorkspaceConfigurationInput(target);
    assert.fail('expected TrustedSnapshotError');
  } catch (err) {
    assert.ok(err instanceof TrustedSnapshotError);
    assert.equal(err.kind, 'accessor-property');
  }
});

test('I: deeply frozen output includes nested structures', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ trustedExtensionSet: { version: '1', permittedExtensionIds: ['pi-guard'] } }),
    validOptions(),
  );
  assert.equal(report.ok, true);
  const config = report.configuration!;
  assert.equal(Object.isFrozen(config.workspaces), true);
  assert.equal(Object.isFrozen(config.trustedExtensionSet), true);
  assert.equal(Object.isFrozen(config.trustedExtensionSet!.permittedExtensionIds), true);
  assert.equal(Object.isFrozen(config.provenance), true);
});

test('I: unexpected own string properties on arrays fail closed (TCF-016)', () => {
  const arr: unknown[] = [validWorkspace()];
  (arr as unknown as Record<string, unknown>)['extra'] = 'x';
  const report = validateTrustedWorkspaceConfiguration(validConfig({ workspaces: arr }), validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-016');
});

// ---------------------------------------------------------------------------
// correction F-RR-1: descriptor-consistent object capture (shared snapshot)
// ---------------------------------------------------------------------------
// A restrictive field (capability ceiling, numeric ceiling, trustedExtensionSet,
// provenance) that the object surface advertises through ownKeys but cannot
// describe (getOwnPropertyDescriptor -> undefined) or describes as
// non-enumerable must fail closed: silently omitting an advertised ceiling
// would widen effective authority and collapse the identity into the identity
// of a configuration where the field was genuinely absent.

test('F-RR1: advertised-but-undescribed top-level restrictive fields cannot validate (TCF-017)', () => {
  for (const key of ['globalActionCeiling', 'globalCapabilityCeiling', 'trustedExtensionSet', 'provenance']) {
    let getCalls = 0;
    const input = validConfig({
      globalActionCeiling: 5,
      globalCapabilityCeiling: { capabilities: ['project-gateway.workspace-read'] },
      trustedExtensionSet: { version: '1' },
    });
    const proxy = new Proxy(input, {
      get(t, p) {
        getCalls++;
        throw new Error(`get trap must not fire (${String(p)})`);
      },
      ownKeys(t) {
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, p) {
        if (p === key) return undefined; // advertised by ownKeys, not describable
        return Reflect.getOwnPropertyDescriptor(t, p);
      },
    });
    const report = validateTrustedWorkspaceConfiguration(proxy, validOptions());
    assert.equal(report.ok, false, key);
    assert.equal(report.findings[0]!.code, 'TCF-017', key);
    assert.equal(report.configuration, undefined, key);
    assert.equal(getCalls, 0, key);
  }
});

test('F-RR1: advertised-but-undescribed workspace restrictive fields cannot validate (TCF-017)', () => {
  for (const key of ['actionCeiling', 'capabilities']) {
    let getCalls = 0;
    const ws = validWorkspace({ actionCeiling: 3, capabilities: ['project-gateway.workspace-read'] });
    const proxy = new Proxy(ws, {
      get(t, p) {
        getCalls++;
        throw new Error(`get trap must not fire (${String(p)})`);
      },
      ownKeys(t) {
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, p) {
        if (p === key) return undefined;
        return Reflect.getOwnPropertyDescriptor(t, p);
      },
    });
    const report = validateTrustedWorkspaceConfiguration(validConfig({ workspaces: [proxy] }), validOptions());
    assert.equal(report.ok, false, key);
    assert.equal(report.findings[0]!.code, 'TCF-017', key);
    assert.equal(report.configuration, undefined, key);
    assert.equal(getCalls, 0, key);
  }
});

test('F-RR1: non-enumerable restrictive fields cannot validate (TCF-017)', () => {
  for (const key of ['globalActionCeiling', 'globalCapabilityCeiling', 'trustedExtensionSet', 'provenance']) {
    const input = validConfig({ globalActionCeiling: 5, trustedExtensionSet: { version: '1' } });
    Object.defineProperty(input, key, {
      value: input[key as keyof typeof input],
      writable: false,
      enumerable: false,
      configurable: false,
    });
    const report = validateTrustedWorkspaceConfiguration(input, validOptions());
    assert.equal(report.ok, false, key);
    assert.equal(report.findings[0]!.code, 'TCF-017', key);
    assert.equal(report.configuration, undefined, key);
  }
  for (const key of ['actionCeiling', 'capabilities']) {
    const ws = validWorkspace({ actionCeiling: 3, capabilities: ['project-gateway.workspace-read'] });
    Object.defineProperty(ws, key, {
      value: ws[key as keyof typeof ws],
      writable: false,
      enumerable: false,
      configurable: false,
    });
    const report = validateTrustedWorkspaceConfiguration(validConfig({ workspaces: [ws] }), validOptions());
    assert.equal(report.ok, false, key);
    assert.equal(report.findings[0]!.code, 'TCF-017', key);
    assert.equal(report.configuration, undefined, key);
  }
});

test('F-RR1: F-RR1 failures produce no configuration and no identity', () => {
  // Every F-RR1 rejection leaves the report without a validated configuration,
  // so no identity can escape from an inconsistent advertised surface.
  const input = validConfig({ globalActionCeiling: 5 });
  const proxy = new Proxy(input, {
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, p) {
      if (p === 'globalActionCeiling') return undefined;
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
  const report = validateTrustedWorkspaceConfiguration(proxy, validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.configuration, undefined);
  assert.equal('identity' in (report as unknown as Record<string, unknown>), false);
});

test('F-RR1: inconsistent advertised surface cannot collapse into an absent-field identity', () => {
  const absent = validateTrustedWorkspaceConfiguration(validConfig(), validOptions());
  assert.equal(absent.ok, true);
  const absentIdentity = absent.configuration!.identity;
  // A proxy advertising globalActionCeiling without a descriptor is rejected;
  // it can never be accepted with the same identity as the absent-field
  // configuration (pre-correction it validated ok:true with that identity).
  const input = validConfig({ globalActionCeiling: 5 });
  const proxy = new Proxy(input, {
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, p) {
      if (p === 'globalActionCeiling') return undefined;
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
  const report = validateTrustedWorkspaceConfiguration(proxy, validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.configuration, undefined);
  // And the genuine absent-field configuration keeps its own stable identity.
  assert.equal(absent.configuration!.identity, absentIdentity);
});

test('F-RR1: plain valid trusted configuration behavior remains unchanged', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions());
  assert.equal(report.ok, true);
  assert.equal(report.findings.length, 0);
  assert.match(report.configuration!.identity, /^sha-256:[0-9a-f]{64}$/);
  const again = validateTrustedWorkspaceConfiguration(validConfig(), validOptions());
  assert.equal(again.configuration!.identity, report.configuration!.identity);
});
