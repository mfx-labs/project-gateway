/**
 * WP-6 Phase 2A: result/TOCTOU boundary, product boundary, and root secrecy
 * (test categories G + H + I).
 *
 * The decision is prospective trusted-process data: point-of-use
 * revalidation is mandatory, no authority or mutation semantics exist, and
 * no raw root or internal absolute path crosses the package root, findings,
 * public identity, or external projections.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as packageRoot from '../../src/index.js';
import * as trustedBarrel from '../../src/trusted/index.js';
import { evaluateExistingPathContainment, validateTrustedWorkspaceConfiguration } from '../../src/trusted/index.js';
import { requestFor, validatedConfig, validContainmentOptions, fakeExistingResolver, ROOT_ALPHA } from './containment-helpers.js';

test('G: result is prospective decision data with mandatory revalidation', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  const decision = report.decision!;
  assert.equal(decision.pointOfUseRevalidationRequired, true);
  assert.equal(decision.operationClass, 'existing-path');
  assert.equal(decision.containmentProtocolVersion, '1');
  assert.equal(decision.configurationIdentity, config.identity);
  assert.equal(decision.workspaceId, 'pgw:w:aaaaaaaaaaaaaaaa');
});

test('G: no timestamp, expiry, or freshness fields exist', () => {
  const config = validatedConfig();
  const decision = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config)).decision!;
  const keys = Object.keys(decision as unknown as Record<string, unknown>);
  for (const key of ['timestamp', 'expiresAt', 'freshness', 'validFor', 'currentTime', 'age']) {
    assert.equal(keys.includes(key), false, key);
  }
});

test('G: no authority, approval, grant, execution, or receipt fields exist', () => {
  const config = validatedConfig();
  const decision = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config)).decision!;
  const keys = Object.keys(decision as unknown as Record<string, unknown>);
  for (const key of ['approved', 'eligible', 'authorized', 'grantId', 'runtimeGrant', 'execution', 'receipt', 'activated']) {
    assert.equal(keys.includes(key), false, key);
  }
});

test('G: failure produces no partial success result or identity', () => {
  const config = validatedConfig();
  const cases = [
    requestFor(config, { path: '/etc/passwd' }),
    requestFor(config, { path: '../x' }),
    requestFor(config, { purpose: 'write' }),
    requestFor(config, { workspaceId: 'pgw:w:nonexistent1' }),
    requestFor(config, { expectedConfigurationIdentity: 'bad' }),
  ];
  for (const request of cases) {
    const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
    assert.equal(report.ok, false);
    assert.equal(report.decision, undefined);
    for (const f of report.findings) {
      assert.ok(f.code.startsWith('TCP-'));
      assert.ok(f.message.length > 0);
    }
  }
});

test('G: findings are deterministically ordered and typed', () => {
  const config = validatedConfig();
  const a = evaluateExistingPathContainment(requestFor(config, { path: '/etc/x', purpose: 'read' }), validContainmentOptions(config));
  const b = evaluateExistingPathContainment(requestFor(config, { path: '/etc/x', purpose: 'read' }), validContainmentOptions(config));
  assert.deepEqual(a, b);
  assert.equal(a.ok, false);
});

test('H: no mutation vocabulary exists anywhere in the decision surface', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  const serialized = JSON.stringify(report.decision);
  for (const token of ['write', 'create', 'persist', 'delete', 'rename', 'move', 'shell', 'exec', 'mutation']) {
    assert.ok(!serialized.includes(token), token);
  }
});

test('H: no filesystem, shell, network, Git, MCP, Pi, pi-guard, persistence, or execution behavior', () => {
  // The containment core is I/O-free; the security suite's dist-wide
  // forbidden-I/O scan covers dist/trusted/** (verified separately).
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  // The decision carries no side-effect or authority field of any kind.
  const keys = Object.keys(report.decision! as unknown as Record<string, unknown>);
  for (const key of ['filesystem', 'shellCommand', 'networkUrl', 'gitCommand', 'mcTool', 'piAction', 'guardAction', 'persisted', 'executed']) {
    assert.equal(keys.includes(key), false, key);
  }
});

test('H: package root exposes no Phase-2A containment API or types', () => {
  for (const name of [
    'evaluateExistingPathContainment',
    'computeContainmentDecisionIdentity',
    'containmentDecisionProjection',
    'CONTAINMENT_PROTOCOL_VERSION',
    'CONTAINMENT_OPERATION_CLASS',
    'CONTAINMENT_PURPOSES',
    'ExistingPathContainmentDecision',
    'ExistingPathResolver',
  ]) {
    assert.equal(name in packageRoot, false, `package root must not export ${name}`);
  }
});

test('H: internal barrel exposes only cohesive Phase-2A entry points', () => {
  for (const name of [
    'evaluateExistingPathContainment',
    'computeContainmentDecisionIdentity',
    'CONTAINMENT_PROTOCOL_VERSION',
    'CONTAINMENT_OPERATION_CLASS',
    'CONTAINMENT_PURPOSES',
  ]) {
    assert.equal(name in trustedBarrel, true, `internal barrel must retain ${name}`);
  }
  // Low-level helpers are module-local. parseWorkspaceRelativePath is the
  // single contract-authorized barrel re-export (WP-7 CON-001 / CMP-006):
  // WP-7 consumes the committed parser through the barrel, never by deep
  // import. All other low-level helpers remain module-local.
  for (const name of ['parseWorkspaceRelativePath', 'combineWorkspaceRootAndComponents', 'fromRootPathResolver', 'sortContainmentFindings', 'containmentFinding', 'failContainmentReport', 'CONTAINMENT_DECISION_DIGEST_DOMAIN']) {
    assert.equal(name in trustedBarrel, name === 'parseWorkspaceRelativePath', `internal barrel export status must match for ${name}`);
  }
});

test('H: no actual read or inspection is performed', () => {
  const config = validatedConfig();
  let resolverCalls = 0;
  const resolver = (p: string) => {
    resolverCalls++;
    return { ok: true as const, canonical: p };
  };
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config, resolver));
  assert.equal(report.ok, true);
  // The resolver was consulted for evidence only; the core performs no I/O.
  assert.equal(resolverCalls, 1);
});

test('I: findings disclose no raw root or absolute path', () => {
  const config = validatedConfig();
  const failure = evaluateExistingPathContainment(
    requestFor(config, { path: '/srv/secret-root-77/notes.md' }),
    validContainmentOptions(config, fakeExistingResolver()),
  );
  assert.equal(failure.ok, false);
  for (const f of failure.findings) {
    assert.ok(!f.message.includes('srv'), f.message);
    assert.ok(!f.message.includes('secret'), f.message);
    assert.ok(!f.message.includes('notes'), f.message);
  }
});

test('I: decision identity digest discloses no root or path material', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/secret-notes.md' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  assert.match(report.decision!.decisionIdentity, /^sha-256:[0-9a-f]{64}$/);
  assert.ok(!report.decision!.decisionIdentity.includes('secret'));
  assert.ok(!report.decision!.decisionIdentity.includes('srv'));
});

test('I: workspace IDs disclose no root material', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  assert.ok(!report.decision!.workspaceId.includes('srv'));
  assert.ok(!report.decision!.workspaceId.includes('/'));
});

test('I: no canonical bytes are returned through the decision result', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  assert.equal('canonicalUtf8' in report.decision!, false);
});

test('I: package-root imports expose no root-bearing containment value', () => {
  const rootKeys = Object.keys(packageRoot);
  for (const key of rootKeys) {
    const value = (packageRoot as Record<string, unknown>)[key];
    const text = typeof value === 'string' ? value : String(value);
    assert.ok(!text.includes('PGAP-TRUSTED-CONTAINMENT'), `root export ${key} leaks the containment domain`);
  }
});

test('I: internal resolved paths remain trusted-process internal', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  assert.equal(report.decision!.resolvedAbsolutePath, `${ROOT_ALPHA}/docs/notes.md`);
  // The Phase-1 export-surface test already proves the package root exposes
  // no trusted types; the resolved path exists only in the internal model.
  assert.equal('resolvedAbsolutePath' in packageRoot, false);
});

test('G: report ok:true carries zero findings; ok:false carries no decision', () => {
  const config = validatedConfig();
  const ok = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config));
  assert.equal(ok.ok, true);
  assert.equal(ok.findings.length, 0);
  const bad = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), {
    configuration: config,
    resolveExistingPath: () => ({ ok: false, code: 'not-found' }),
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.findings[0]!.code, 'TCP-014');
  assert.equal(bad.decision, undefined);
});

test('G: a configuration-identity mismatch cannot be bypassed by request content', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(
    requestFor(config, { path: 'x', expectedConfigurationIdentity: config.identity + '0' }),
    validContainmentOptions(config),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-010');
  assert.equal(report.decision, undefined);
});

test('H: validated configuration is consumed without mutation or reread', () => {
  const config = validatedConfig();
  const frozen = Object.isFrozen(config);
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  assert.equal(Object.isFrozen(config), frozen);
  // The configuration is still usable for further Phase-1 validation ops.
  const again = validateTrustedWorkspaceConfiguration(
    {
      configurationVersion: '1',
      capabilityVocabularyVersion: 'v1',
      provenance: { sourceKind: 'trusted-local-control-plane' },
      workspaces: [
        { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha' },
        { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' },
      ],
    },
    { hostLane: config.hostLane, resolveRootPath: (p) => p },
  );
  assert.equal(again.ok, true);
  assert.equal(again.configuration!.identity, config.identity);
});
