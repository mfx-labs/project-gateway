/**
 * WP-6 Phase 2A security correction F-2A-01: runtime configuration
 * genuineness (module-private WeakSet brand).
 *
 * Only a runtime-genuine configuration produced by a successful Phase-1
 * validation may provide workspace roots to the containment evaluator and
 * workspace lookup. Structural lookalikes, correct-digest forgeries, clones,
 * spreads, JSON round-trips, and Proxy wrappers are rejected with a
 * dedicated TCP-021 finding, zero resolver calls, and no decision or
 * identity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as packageRoot from '../../src/index.js';
import * as trustedBarrel from '../../src/trusted/index.js';
import {
  evaluateExistingPathContainment,
  validateTrustedWorkspaceConfiguration,
  lookupValidatedWorkspace,
  computeTrustedConfigurationIdentity,
  trustedConfigurationProjection,
  CONTAINMENT_PROTOCOL_VERSION,
  TRUSTED_HOST_LANE,
  type ExistingPathResolver,
  type ValidatedTrustedWorkspaceConfiguration,
} from '../../src/trusted/index.js';
import { isGenuineValidatedTrustedWorkspaceConfiguration } from '../../src/trusted/configuration-brand.js';
import { requestFor, validatedConfig, validContainmentOptions, WORKSPACE_ALPHA } from './containment-helpers.js';

const LANE = TRUSTED_HOST_LANE;

/** A structurally shaped forged configuration with an attacker-selected root. */
function forgedConfiguration(overrides: Record<string, unknown> = {}): ValidatedTrustedWorkspaceConfiguration {
  return {
    configurationVersion: '1',
    capabilityVocabularyVersion: 'v1',
    hostLane: LANE,
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [{ workspaceId: WORKSPACE_ALPHA, canonicalRoot: '/attacker/root' }],
    identity: 'sha-256:' + 'a'.repeat(64),
    ...overrides,
  } as unknown as ValidatedTrustedWorkspaceConfiguration;
}

function countingResolver(): { resolver: ExistingPathResolver; calls: () => number } {
  let calls = 0;
  return {
    resolver: (p) => {
      calls++;
      return { ok: true, canonical: p };
    },
    calls: () => calls,
  };
}

test('F2A01: genuine Phase-1 configuration is accepted', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  assert.equal(report.findings.length, 0);
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(config), true);
});

test('F2A01: plain forged lookalike is rejected (TCP-021)', () => {
  const forged = forgedConfiguration();
  const report = evaluateExistingPathContainment(requestFor(forged, { path: 'x' }), {
    configuration: forged,
    resolveExistingPath: () => ({ ok: true, canonical: '/attacker/root/x' }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-021');
  assert.equal(report.findings[0]!.messageKey, 'containment.configuration-not-genuine');
  assert.equal(report.decision, undefined);
});

test('F2A01: forged object with a correctly recomputed configuration digest is rejected', () => {
  // Recompute a valid-looking digest over the forged fields: a matching
  // digest string is NOT proof of genuineness.
  const forged = forgedConfiguration();
  const recomputed = computeTrustedConfigurationIdentity(forged as never);
  const digestForged = forgedConfiguration({ identity: recomputed.digest });
  const report = evaluateExistingPathContainment(requestFor(digestForged, { path: 'x' }), {
    configuration: digestForged,
    resolveExistingPath: () => ({ ok: true, canonical: '/attacker/root/x' }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-021');
  assert.equal(report.decision, undefined);
});

test('F2A01: forged object with attacker-selected canonical root is rejected', () => {
  const forged = forgedConfiguration({ workspaces: [{ workspaceId: WORKSPACE_ALPHA, canonicalRoot: '/attacker/root' }] });
  const report = evaluateExistingPathContainment(requestFor(forged, { path: 'x' }), {
    configuration: forged,
    resolveExistingPath: () => ({ ok: true, canonical: '/attacker/root/x' }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-021');
  assert.equal(report.decision, undefined);
});

test('F2A01: spread of a genuine configuration is rejected', () => {
  const config = validatedConfig();
  const spread = { ...config } as unknown as ValidatedTrustedWorkspaceConfiguration;
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(spread), false);
  const report = evaluateExistingPathContainment(requestFor(spread, { path: 'x' }), {
    configuration: spread,
    resolveExistingPath: () => ({ ok: true, canonical: '/srv/gateway/alpha/x' }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-021');
});

test('F2A01: shallow clone is rejected', () => {
  const config = validatedConfig();
  const clone = Object.assign({}, config) as unknown as ValidatedTrustedWorkspaceConfiguration;
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(clone), false);
  const report = evaluateExistingPathContainment(requestFor(clone, { path: 'x' }), {
    configuration: clone,
    resolveExistingPath: () => ({ ok: true, canonical: '/srv/gateway/alpha/x' }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-021');
});

test('F2A01: deep JSON clone is rejected', () => {
  const config = validatedConfig();
  const deepClone = JSON.parse(JSON.stringify(config)) as ValidatedTrustedWorkspaceConfiguration;
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(deepClone), false);
  const report = evaluateExistingPathContainment(requestFor(deepClone, { path: 'x' }), {
    configuration: deepClone,
    resolveExistingPath: () => ({ ok: true, canonical: '/srv/gateway/alpha/x' }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-021');
});

test('F2A01: manually deep-frozen clone is rejected', () => {
  const config = validatedConfig();
  const clone = structuredClone(config) as ValidatedTrustedWorkspaceConfiguration;
  const frozen = Object.freeze(clone);
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(frozen), false);
  const report = evaluateExistingPathContainment(requestFor(frozen, { path: 'x' }), {
    configuration: frozen,
    resolveExistingPath: () => ({ ok: true, canonical: '/srv/gateway/alpha/x' }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-021');
});

test('F2A01: Proxy wrapping a genuine configuration is rejected', () => {
  const config = validatedConfig();
  const proxy = new Proxy(config, {});
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(proxy), false);
  const report = evaluateExistingPathContainment(requestFor(proxy, { path: 'x' }), {
    configuration: proxy,
    resolveExistingPath: () => ({ ok: true, canonical: '/srv/gateway/alpha/x' }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-021');
});

test('F2A01: a separately and successfully validated equivalent configuration is accepted', () => {
  const a = validatedConfig();
  const b = validatedConfig();
  assert.notEqual(a, b); // distinct branded objects
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(a), true);
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(b), true);
  const ra = evaluateExistingPathContainment(requestFor(a, { path: 'docs/notes.md' }), validContainmentOptions(a));
  const rb = evaluateExistingPathContainment(requestFor(b, { path: 'docs/notes.md' }), validContainmentOptions(b));
  assert.equal(ra.ok, true);
  assert.equal(rb.ok, true);
  assert.equal(ra.decision!.decisionIdentity, rb.decision!.decisionIdentity);
});

test('F2A01: failed Phase-1 validation produces no branded object', () => {
  const failing = validateTrustedWorkspaceConfiguration(
    {
      configurationVersion: '1',
      capabilityVocabularyVersion: 'v1',
      provenance: { sourceKind: 'trusted-local-control-plane' },
      workspaces: [{ workspaceId: WORKSPACE_ALPHA, root: '/srv/gateway/alpha' }],
      unknownTopLevel: 1,
    },
    { hostLane: LANE, resolveRootPath: (p) => p },
  );
  assert.equal(failing.ok, false);
  assert.equal(failing.configuration, undefined);
  // The rejected input object itself is not branded.
  const input = {
    configurationVersion: '1',
    capabilityVocabularyVersion: 'v1',
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [{ workspaceId: WORKSPACE_ALPHA, root: '/srv/gateway/alpha' }],
  };
  validateTrustedWorkspaceConfiguration(input, { hostLane: LANE, resolveRootPath: () => null });
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(input), false);
});

test('F2A01: non-genuine configuration fails before resolver invocation (zero calls)', () => {
  const forged = forgedConfiguration();
  const { resolver, calls } = countingResolver();
  const report = evaluateExistingPathContainment(requestFor(forged, { path: 'x' }), {
    configuration: forged,
    resolveExistingPath: resolver,
  });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-021');
  assert.equal(calls(), 0);
});

test('F2A01: non-genuine configuration produces no decision or identity', () => {
  const forged = forgedConfiguration();
  const report = evaluateExistingPathContainment(requestFor(forged, { path: 'x' }), {
    configuration: forged,
    resolveExistingPath: () => ({ ok: true, canonical: '/attacker/root/x' }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.decision, undefined);
  assert.equal('decisionIdentity' in (report as unknown as Record<string, unknown>), false);
  // TCP-021 is deterministic and root-safe.
  assert.equal(report.findings[0]!.message, 'trusted configuration is not a runtime-genuine validated configuration');
  assert.ok(!report.findings[0]!.message.includes('attacker'));
});

test('F2A01: lookupValidatedWorkspace does not expose records from a non-genuine configuration', () => {
  const forged = forgedConfiguration();
  assert.equal(lookupValidatedWorkspace(forged, WORKSPACE_ALPHA), undefined);
  const config = validatedConfig();
  assert.ok(lookupValidatedWorkspace(config, WORKSPACE_ALPHA));
  const clone = { ...config } as unknown as ValidatedTrustedWorkspaceConfiguration;
  assert.equal(lookupValidatedWorkspace(clone, WORKSPACE_ALPHA), undefined);
});

test('F2A01: brand state is absent from serialization, projections, digest bytes, and declarations', () => {
  const config = validatedConfig();
  const serialized = JSON.stringify(config);
  assert.ok(!serialized.includes('brand'));
  assert.ok(!serialized.includes('WeakSet'));
  assert.equal(Object.getOwnPropertySymbols(config).length, 0);
  // The identity projection and canonical bytes contain no brand material.
  const projection = trustedConfigurationProjection(config);
  assert.deepEqual(Object.keys(projection).sort(), [
    'capabilityVocabularyVersion',
    'configurationVersion',
    'hostLane',
    'provenance',
    'workspaces',
  ].sort());
  const canonicalUtf8 = computeTrustedConfigurationIdentity(config).canonicalUtf8;
  assert.ok(!canonicalUtf8.includes('brand'));
  assert.ok(!canonicalUtf8.includes('WeakSet'));
  // Findings never carry brand tokens.
  const bad = evaluateExistingPathContainment(requestFor(forgedConfiguration(), { path: 'x' }), {
    configuration: forgedConfiguration(),
    resolveExistingPath: () => ({ ok: true, canonical: '/x' }),
  });
  for (const f of bad.findings) {
    assert.ok(!f.message.includes('brand'));
    assert.ok(!f.message.includes('WeakSet'));
  }
});

test('F2A01: no marking or predicate operation is exported from the barrel or package root', () => {
  for (const name of ['markValidatedTrustedWorkspaceConfiguration', 'isGenuineValidatedTrustedWorkspaceConfiguration']) {
    assert.equal(name in trustedBarrel, false, `barrel must not export ${name}`);
    assert.equal(name in packageRoot, false, `package root must not export ${name}`);
  }
});

test('F2A01: containment protocol version is still required for genuine configurations', () => {
  const config = validatedConfig();
  const request = requestFor(config, { containmentProtocolVersion: '9' });
  const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-001');
});
