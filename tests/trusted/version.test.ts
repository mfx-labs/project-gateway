/**
 * WP-6 Phase 1: configuration versioning (test category B).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTrustedWorkspaceConfiguration,
  computeTrustedConfigurationIdentity,
} from '../../src/trusted/index.js';
import { validConfig, validWorkspace, validOptions } from './helpers.js';

test('B: accepted version validates', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions());
  assert.equal(report.ok, true);
});

test('B: unknown version fails closed with TCF-001', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig({ configurationVersion: '2' }), validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-001');
  assert.equal(report.findings[0]!.messageKey, 'trusted-config.version-unsupported');
});

test('B: missing version fails closed (never inferred from fields)', () => {
  const input = validConfig();
  delete (input as Record<string, unknown>)['configurationVersion'];
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-001');
  assert.equal(report.findings[0]!.messageKey, 'trusted-config.version-missing');
});

test('B: non-string version fails closed', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig({ configurationVersion: 1 }), validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-001');
});

test('B: mixed-version input (workspace record version mismatch) fails closed', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ recordVersion: '2' })] }),
    validOptions(),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-019');
  assert.equal(report.findings[0]!.messageKey, 'trusted-config.version-mixed');
});

test('B: matching record version is accepted', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ recordVersion: '1' })] }),
    validOptions(),
  );
  assert.equal(report.ok, true);
});

test('B: version participates in identity (no implicit upgrade or downgrade)', () => {
  const a = validateTrustedWorkspaceConfiguration(validConfig(), validOptions()).configuration!;
  const b = validateTrustedWorkspaceConfiguration(validConfig(), validOptions()).configuration!;
  assert.equal(a.identity, b.identity);
  // The version is bound into the canonical bytes that produce the identity;
  // it is never inferred from field presence (missing version fails earlier).
  assert.ok(computeTrustedConfigurationIdentity(a).canonicalUtf8.includes('"configurationVersion":"1"'));
  // A workspace recordVersion that matches the top-level version is a
  // validation-time consistency check and does not alter the identity.
  const withRecordVersion = validConfig();
  (withRecordVersion['workspaces'] as Record<string, unknown>[])[0]!['recordVersion'] = '1';
  const c = validateTrustedWorkspaceConfiguration(withRecordVersion, validOptions()).configuration!;
  assert.equal(c.identity, a.identity);
});
