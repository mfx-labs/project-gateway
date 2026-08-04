/**
 * WP-6 Phase 1: provenance (test category H).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTrustedWorkspaceConfiguration,
  computeTrustedConfigurationIdentity,
  TRUSTED_SOURCE_KIND,
} from '../../src/trusted/index.js';
import { validConfig, validOptions } from './helpers.js';

test('H: valid trusted provenance validates and binds identity', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions());
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.provenance.sourceKind, TRUSTED_SOURCE_KIND);
  assert.ok(computeTrustedConfigurationIdentity(report.configuration!).canonicalUtf8.includes('"provenance":{"sourceKind":"trusted-local-control-plane"}'));
});

test('H: missing provenance fails closed', () => {
  const input = validConfig();
  delete (input as Record<string, unknown>)['provenance'];
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-003');
});

test('H: malformed provenance fails closed', () => {
  for (const provenance of [{}, { sourceKind: 42 }, [], 'trusted', null]) {
    const report = validateTrustedWorkspaceConfiguration(validConfig({ provenance }), validOptions());
    assert.equal(report.ok, false, JSON.stringify(provenance));
    assert.equal(report.findings[0]!.code, 'TCF-003');
  }
});

test('H: repository-controlled provenance attempts fail closed', () => {
  for (const sourceKind of ['repository', 'project', '.pi', 'project-gateway-governance', 'git']) {
    const report = validateTrustedWorkspaceConfiguration(
      validConfig({ provenance: { sourceKind } }),
      validOptions(),
    );
    assert.equal(report.ok, false, sourceKind);
    assert.equal(report.findings[0]!.code, 'TCF-004');
    assert.equal(report.findings[0]!.messageKey, 'trusted-config.provenance-untrusted-source');
  }
});

test('H: provenance participates in configuration identity', () => {
  const a = validateTrustedWorkspaceConfiguration(validConfig(), validOptions()).configuration!;
  // A repository-controlled provenance attempt fails; identity is defined only
  // for trusted provenance. Different trusted provenance records are not
  // representable in v1, so identity stability is verified by determinism.
  const b = validateTrustedWorkspaceConfiguration(validConfig(), validOptions()).configuration!;
  assert.equal(a.identity, b.identity);
});

test('H: no secret or root leakage in provenance findings', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ provenance: { sourceKind: '/srv/secret/provenance' } }),
    validOptions(),
  );
  assert.equal(report.ok, false);
  for (const f of report.findings) {
    assert.ok(!f.message.includes('srv'), f.message);
    assert.ok(!f.message.includes('secret'), f.message);
  }
});
