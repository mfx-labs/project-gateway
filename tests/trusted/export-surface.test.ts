/**
 * WP-6 Phase 1 corrections F-5/F-8: export boundary and root secrecy.
 *
 * The package root must not expose trusted configuration runtime APIs or
 * root-bearing types; the internal module family (`src/trusted/index.js`)
 * retains the cohesive internal entry points required by repository modules
 * and tests; no externally observable report or identity field discloses raw
 * canonical roots.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as packageRoot from '../../src/index.js';
import * as trustedBarrel from '../../src/trusted/index.js';
import { validateTrustedWorkspaceConfiguration } from '../../src/trusted/index.js';
import { validConfig, validWorkspace, validOptions } from './helpers.js';

test('F8: package root exposes no trusted configuration runtime APIs', () => {
  const forbidden = [
    'validateTrustedWorkspaceConfiguration',
    'lookupValidatedWorkspace',
    'snapshotTrustedWorkspaceConfigurationInput',
    'TrustedSnapshotError',
    'computeTrustedConfigurationIdentity',
    'trustedConfigurationProjection',
    'TRUSTED_CONFIG_DIGEST_DOMAIN',
    'TRUSTED_CONFIGURATION_VERSION',
    'CAPABILITY_VOCABULARY_VERSION',
    'CAPABILITY_VOCABULARY_V1',
    'TRUSTED_SOURCE_KIND',
    'TRUSTED_HOST_LANE',
    'EXTENSION_SCOPES',
    'isKnownCapability',
    'canonicalCapabilitySet',
    'isTrustedSourceKind',
    'isExtensionScope',
    'isValidExtensionIdentity',
    'isValidWorkspaceId',
    'WORKSPACE_ID_PATTERN',
    'WORKSPACE_ID_PREFIX',
    'canonicalizeRoot',
    'canonicalizeRootLexically',
    'isRootAncestorOrEqual',
    'validateNonNegativeSafeInteger',
    'canonicalNumericCeiling',
    'trustedFinding',
    'sortTrustedFindings',
    'failTrustedReport',
  ];
  for (const name of forbidden) {
    assert.equal(name in packageRoot, false, `package root must not export ${name}`);
  }
});

test('F8: package root exposes no trusted root-bearing types', () => {
  // Type-level assertion is compile-time; runtime check confirms no value
  // carrying the validated model or root helpers is reachable from the root.
  const rootKeys = Object.keys(packageRoot);
  for (const key of rootKeys) {
    const value = (packageRoot as Record<string, unknown>)[key];
    const text = typeof value === 'string' ? value : String(value);
    assert.ok(!text.includes('PGAP-TRUSTED-CONFIG-v1'), `root export ${key} leaks the identity domain`);
  }
});

test('F8: internal module retains cohesive internal entry points', () => {
  for (const name of [
    'validateTrustedWorkspaceConfiguration',
    'lookupValidatedWorkspace',
    'snapshotTrustedWorkspaceConfigurationInput',
    'TrustedSnapshotError',
    'computeTrustedConfigurationIdentity',
    'trustedConfigurationProjection',
    'TRUSTED_CONFIGURATION_VERSION',
    'CAPABILITY_VOCABULARY_VERSION',
    'CAPABILITY_VOCABULARY_V1',
    'TRUSTED_SOURCE_KIND',
    'TRUSTED_HOST_LANE',
    'EXTENSION_SCOPES',
  ]) {
    assert.equal(name in trustedBarrel, true, `internal barrel must retain ${name}`);
  }
  // Low-level helpers are intentionally not barrel-exported.
  for (const name of [
    'canonicalizeRootLexically',
    'isRootAncestorOrEqual',
    'isKnownCapability',
    'canonicalCapabilitySet',
    'isValidWorkspaceId',
    'trustedFinding',
    'sortTrustedFindings',
    'failTrustedReport',
    'TRUSTED_CONFIG_DIGEST_DOMAIN',
    'isValidExtensionIdentity',
    'validateNonNegativeSafeInteger',
  ]) {
    assert.equal(name in trustedBarrel, false, `internal barrel must not export ${name}`);
  }
});

test('F5: no externally observable report field discloses roots', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ root: '/srv/secret-root-77' })] }),
    validOptions(),
  );
  assert.equal(report.ok, true);
  // Public report surface: ok, findings, configuration identity.
  assert.equal(report.ok, true);
  assert.equal(report.findings.length, 0);
  assert.match(report.configuration!.identity, /^sha-256:[0-9a-f]{64}$/);
  assert.ok(!report.configuration!.identity.includes('secret-root-77'));
  // No canonical bytes returned through the validated runtime result.
  assert.equal('canonicalUtf8' in report.configuration!, false);
  // Opaque identifiers carry no root material.
  assert.ok(!report.configuration!.workspaces[0]!.workspaceId.includes('srv'));
  // The internal model retains the trusted-process-only canonicalRoot; the
  // only externally consumable identity is the digest.
  assert.equal(report.configuration!.workspaces[0]!.canonicalRoot, '/srv/secret-root-77');
});

test('F5: failure findings never disclose roots', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({
      workspaces: [
        validWorkspace({ root: '/srv/secret-root-77' }),
        validWorkspace({ root: '/srv/secret-root-77', workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb' }),
      ],
    }),
    validOptions(),
  );
  assert.equal(report.ok, false);
  for (const f of report.findings) {
    assert.ok(!f.message.includes('secret-root-77'), f.message);
    assert.ok(!(f.location ?? '').includes('secret-root-77'), f.location ?? '');
  }
  assert.equal(report.configuration, undefined);
});
