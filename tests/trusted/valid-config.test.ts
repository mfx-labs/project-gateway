/**
 * WP-6 Phase 1: valid configuration behavior (test category A).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTrustedWorkspaceConfiguration,
  lookupValidatedWorkspace,
  computeTrustedConfigurationIdentity,
  TRUSTED_CONFIGURATION_VERSION,
  CAPABILITY_VOCABULARY_VERSION,
  TRUSTED_HOST_LANE,
} from '../../src/trusted/index.js';
import { validConfig, validWorkspace, validOptions } from './helpers.js';

test('A: minimal valid configuration validates with stable identity', () => {
  const input = validConfig({ workspaces: [validWorkspace()] });
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, true);
  assert.equal(report.findings.length, 0);
  const config = report.configuration;
  assert.ok(config);
  assert.equal(config.configurationVersion, TRUSTED_CONFIGURATION_VERSION);
  assert.equal(config.capabilityVocabularyVersion, CAPABILITY_VOCABULARY_VERSION);
  assert.equal(config.hostLane, TRUSTED_HOST_LANE);
  assert.equal(config.workspaces.length, 1);
  assert.match(config.identity, /^sha-256:[0-9a-f]{64}$/);
  // Deterministic repeated validation.
  const again = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(again.ok, true);
  assert.equal(again.configuration?.identity, config.identity);
  assert.equal(
    computeTrustedConfigurationIdentity(again.configuration!).canonicalUtf8,
    computeTrustedConfigurationIdentity(config).canonicalUtf8,
  );
});

test('A: multiple non-overlapping workspaces validate and remain canonically ordered', () => {
  const input = validConfig({
    workspaces: [
      validWorkspace({ workspaceId: 'pgw:w:zzzzzzzzzzzzzzzz', root: '/srv/gateway/zz' }),
      validWorkspace({ workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/aa' }),
    ],
  });
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, true);
  const ids = report.configuration!.workspaces.map((w) => w.workspaceId);
  assert.deepEqual(ids, ['pgw:w:aaaaaaaaaaaaaaaa', 'pgw:w:zzzzzzzzzzzzzzzz']);
});

test('A: global and workspace capability ceilings validate', () => {
  const input = validConfig({
    globalCapabilityCeiling: { capabilities: ['project-gateway.workspace-read', 'project-gateway.git-inspect'] },
    workspaces: [
      validWorkspace({ capabilities: ['project-gateway.workspace-read'] }),
      validWorkspace({ workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' }),
    ],
  });
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, true);
  assert.deepEqual([...report.configuration!.globalCapabilityCeiling!.capabilities!], ['project-gateway.git-inspect', 'project-gateway.workspace-read']);
  assert.deepEqual([...report.configuration!.workspaces[0]!.capabilities!], ['project-gateway.workspace-read']);
  assert.equal(report.configuration!.workspaces[1]!.capabilities, undefined);
});

test('A: global and workspace numeric ceilings validate with zero and missing preserved', () => {
  const input = validConfig({
    globalActionCeiling: 0,
    workspaces: [validWorkspace({ actionCeiling: 5 })],
  });
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.globalActionCeiling, 0);
  assert.equal(report.configuration!.workspaces[0]!.actionCeiling, 5);
});

test('A: trustedExtensionSet declarations validate', () => {
  const input = validConfig({
    trustedExtensionSet: {
      version: '1',
      permittedExtensionIds: ['pi-guard'],
      supportedBuiltinToolIds: ['bash', 'edit'],
      trustedWebAccess: [{ packageId: 'pi-web-access', version: '0.1.0' }],
      expectedToolSources: [{ toolName: 'web_search', packageId: 'pi-web-access', scope: 'package' }],
    },
  });
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, true);
  const set = report.configuration!.trustedExtensionSet!;
  assert.equal(set.version, '1');
  assert.deepEqual([...set.permittedExtensionIds], ['pi-guard']);
  assert.deepEqual([...set.supportedBuiltinToolIds], ['bash', 'edit']);
  assert.equal(set.trustedWebAccess.length, 1);
  assert.equal(set.expectedToolSources.length, 1);
});

test('A: validated result is deeply immutable and exposes no canonical bytes', () => {
  const input = validConfig({
    globalCapabilityCeiling: { capabilities: ['project-gateway.workspace-read'] },
    trustedExtensionSet: { version: '1', permittedExtensionIds: ['pi-guard'] },
    workspaces: [validWorkspace({ capabilities: ['project-gateway.workspace-read'], actionCeiling: 3 })],
  });
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, true);
  const config = report.configuration!;
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.provenance), true);
  assert.equal(Object.isFrozen(config.globalCapabilityCeiling), true);
  assert.equal(Object.isFrozen(config.globalCapabilityCeiling!.capabilities), true);
  assert.equal(Object.isFrozen(config.trustedExtensionSet), true);
  for (const w of config.workspaces) {
    assert.equal(Object.isFrozen(w), true);
    if (w.capabilities) assert.equal(Object.isFrozen(w.capabilities), true);
  }
  // Correction F-5: canonical bytes stay local to identity computation and are
  // not returned through the validated runtime result.
  assert.equal('canonicalUtf8' in config, false);
  // Later caller mutation cannot change validated state.
  const caller = input as { workspaces: { root: string }[] };
  caller.workspaces[0]!.root = '/srv/attacker';
  assert.equal(config.workspaces[0]!.canonicalRoot, '/srv/gateway/alpha');
});

test('A: lookupValidatedWorkspace is exact and deterministic', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions());
  assert.equal(report.ok, true);
  const found = lookupValidatedWorkspace(report.configuration!, 'pgw:w:aaaaaaaaaaaaaaaa');
  assert.ok(found);
  assert.equal(found.canonicalRoot, '/srv/gateway/alpha');
  assert.equal(lookupValidatedWorkspace(report.configuration!, 'pgw:w:doesnotexist123'), undefined);
  // Exact string identity: near-miss identifiers do not match.
  assert.equal(lookupValidatedWorkspace(report.configuration!, 'pgw:w:aaaaaaaaaaaaaaab'), undefined);
});
