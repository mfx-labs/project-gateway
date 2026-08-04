/**
 * WP-6 Phase 1: capability ceilings (test category E).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrustedWorkspaceConfiguration, CAPABILITY_VOCABULARY_V1 } from '../../src/trusted/index.js';
import { isKnownCapability } from '../../src/trusted/capabilities.js';
import { validConfig, validWorkspace, validOptions } from './helpers.js';

test('E: canonical sets are sorted and deduplicated', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({
      globalCapabilityCeiling: { capabilities: ['project-gateway.git-inspect', 'project-gateway.workspace-read'] },
    }),
    validOptions(),
  );
  assert.equal(report.ok, true);
  assert.deepEqual(
    [...report.configuration!.globalCapabilityCeiling!.capabilities!],
    ['project-gateway.git-inspect', 'project-gateway.workspace-read'],
  );
});

test('E: duplicate capability declarations fail closed', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({
      globalCapabilityCeiling: { capabilities: ['project-gateway.workspace-read', 'project-gateway.workspace-read'] },
    }),
    validOptions(),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-013');
});

test('E: unknown capability identifiers fail closed (repository cannot extend vocabulary)', () => {
  for (const id of ['project-gateway.delete-everything', 'project-gateway.conformance-alpha', 'custom.capability', 'workspace-read']) {
    const report = validateTrustedWorkspaceConfiguration(
      validConfig({
        workspaces: [validWorkspace({ capabilities: [id] })],
      }),
      validOptions(),
    );
    assert.equal(report.ok, false, id);
    assert.equal(report.findings[0]!.code, 'TCF-012');
  }
});

test('E: explicit empty set validates and is distinct from missing', () => {
  const empty = validateTrustedWorkspaceConfiguration(
    validConfig({
      globalCapabilityCeiling: { capabilities: [] },
      workspaces: [validWorkspace({ capabilities: [] })],
    }),
    validOptions(),
  );
  assert.equal(empty.ok, true);
  assert.deepEqual([...empty.configuration!.globalCapabilityCeiling!.capabilities!], []);
  assert.deepEqual([...empty.configuration!.workspaces[0]!.capabilities!], []);
});

test('E: missing capability set inside a declared global ceiling is preserved as absent', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig({ globalCapabilityCeiling: {} }), validOptions());
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.globalCapabilityCeiling!.capabilities, undefined);
});

test('E: vocabulary-version mismatch fails closed', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig({ capabilityVocabularyVersion: 'v2' }), validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-021');
});

test('E: missing vocabulary version fails closed (no inference)', () => {
  const input = validConfig();
  delete (input as Record<string, unknown>)['capabilityVocabularyVersion'];
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-020');
});

test('E: canonical order of the accepted vocabulary is fixed', () => {
  assert.equal(CAPABILITY_VOCABULARY_V1[0], 'project-gateway.workspace-read');
  assert.ok(CAPABILITY_VOCABULARY_V1.includes('project-gateway.lifecycle-issue'));
  assert.equal(CAPABILITY_VOCABULARY_V1.length, 18);
  for (const id of CAPABILITY_VOCABULARY_V1) assert.equal(isKnownCapability(id), true);
});

test('E: non-string capability entries fail closed', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ globalCapabilityCeiling: { capabilities: [42] } }),
    validOptions(),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-011');
});
